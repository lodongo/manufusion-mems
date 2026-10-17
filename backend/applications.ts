import { storage } from './platform/sdk';
import {
    HttpError,
    checkPassword,
    clientInfo,
    createAuthUser,
    createDoc,
    deleteAuthUser,
    deleteDoc,
    emailDomain,
    emailVerificationRequired,
    fieldEq,
    getDoc,
    isBuiltinPublicEmail,
    isObj,
    isStaffDomain,
    isValidEmail,
    listDocs,
    nowIso,
    randomId,
    rateLimit,
    runQuery,
    str,
    text,
    updateAuthUser,
    updateFields,
    writeDoc,
    type Doc,
    type Fields,
    type Obj,
    type Plain,
} from './core';
import { audit } from './audit';
import { allocateOrgCode, isTokenStale, publicRoute, releaseStaleDomainClaim, secure, staff, type SecureContext, type StaffContext } from './guards';
import { seedOrgRoles } from './org';
import { buildTheme, readBranding } from './branding';

// Staged organization registration.
//   applications/{uid}   one application per applicant account (uid = Firebase user)
//   users/{uid}          role 'applicant' until approved, then 'org_super_admin'
//   org_domains/{domain} claim held by the application (one organization per extension)
//   storage applications/{uid}/...  uploaded documents (private, signed URLs only)

const SECTIONS = ['applicant', 'organization', 'registration', 'headquarters', 'identity', 'branding'];
const EDITABLE = new Set(['draft', 'returned']);
const MAX_FILE_BYTES = 3 * 1024 * 1024;

const DOC_SLOTS: Record<string, { label: string; required: boolean; imageOnly: boolean; step: 'documents' | 'branding' }> = {
    registrationCertificate: { label: 'Certificate of registration', required: true, imageOnly: false, step: 'documents' },
    taxCertificate: { label: 'Tax registration certificate', required: false, imageOnly: false, step: 'documents' },
    idFront: { label: 'ID document (front)', required: true, imageOnly: false, step: 'documents' },
    idBack: { label: 'ID document (back)', required: false, imageOnly: false, step: 'documents' },
    logo: { label: 'Organization logo', required: true, imageOnly: true, step: 'branding' },
    photo: { label: 'Applicant photo', required: true, imageOnly: true, step: 'branding' },
};

interface Refs {
    codes: (key: string) => Set<string>;
    entry: (key: string, code: string) => Obj | undefined;
    blocked: Set<string>;
    country: (iso2: string) => Obj | undefined;
    currency: (code: string) => Obj | undefined;
}

async function loadRefs(): Promise<Refs> {
    const [c, cur, m, d] = await Promise.all([
        getDoc('reference/countries'),
        getDoc('reference/currencies'),
        getDoc('reference/metadata'),
        getDoc('reference/publicEmailDomains'),
    ]);
    if (!c || !cur || !m || !d) throw new HttpError(503, 'Organization registration is not open yet. Please try again later.');
    const items = (doc: Doc) => (Array.isArray(doc.data.items) ? (doc.data.items as Plain[]).filter(isObj) : []);
    const countries = items(c);
    const currencies = items(cur);
    const lists = items(m);
    const blocked = new Set((Array.isArray(d.data.items) ? (d.data.items as Plain[]) : []).map((x) => str(x).toLowerCase()));
    return {
        blocked,
        country: (iso2) => countries.find((x) => str(x.iso2) === iso2),
        currency: (code) => currencies.find((x) => str(x.code) === code),
        codes: (key) => {
            const list = lists.find((l) => str(l.key) === key);
            return new Set((Array.isArray(list?.items) ? (list.items as Plain[]) : []).filter(isObj).filter((i) => i.active !== false).map((i) => str(i.code)).filter(Boolean));
        },
        entry: (key, code) => {
            const list = lists.find((l) => str(l.key) === key);
            return (Array.isArray(list?.items) ? (list.items as Plain[]) : []).filter(isObj).find((i) => str(i.code) === code && i.active !== false);
        },
    };
}

function strMap(value: Plain | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (isObj(value)) for (const key of Object.keys(value)) if (typeof value[key] === 'string') out[key] = value[key] as string;
    return out;
}

function docsMap(value: Plain | undefined): Record<string, { path: string; name: string; contentType: string; size: number; uploadedAt: string }> {
    const out: Record<string, { path: string; name: string; contentType: string; size: number; uploadedAt: string }> = {};
    if (!isObj(value)) return out;
    for (const slot of Object.keys(value)) {
        const v = value[slot];
        if (isObj(v) && str(v.path)) {
            out[slot] = { path: str(v.path), name: str(v.name), contentType: str(v.contentType), size: typeof v.size === 'number' ? v.size : 0, uploadedAt: str(v.uploadedAt) };
        }
    }
    return out;
}

function completeness(d: Fields) {
    const a = strMap(d.applicant);
    const o = strMap(d.organization);
    const r = strMap(d.registration);
    const h = strMap(d.headquarters);
    const i = strMap(d.identity);
    const b = strMap(d.branding);
    const docs = docsMap(d.documents);
    const slotsDone = (step: 'documents' | 'branding') => Object.entries(DOC_SLOTS).every(([slot, def]) => def.step !== step || !def.required || !!docs[slot]);
    return {
        applicant: !!(a.firstName && a.lastName && a.phone),
        organization: !!(o.name && o.legalEntityType && o.industryCategory && o.industry && o.companySize && o.currencyCode),
        registration: !!(r.countryCode && r.registrationNumber && r.registrationDate && r.originCountryCode),
        headquarters: !!(h.countryCode && h.city && h.address),
        identity: !!(i.idType && i.idNumber),
        documents: slotsDone('documents'),
        branding: !!(b.displayName && b.slogan && b.preset && b.brandColor) && slotsDone('branding'),
    };
}

function appOut(doc: Doc) {
    const d = doc.data;
    const docs = docsMap(d.documents);
    return {
        uid: doc.id,
        email: str(d.email),
        domain: str(d.domain),
        status: str(d.status),
        applicant: strMap(d.applicant),
        organization: strMap(d.organization),
        registration: strMap(d.registration),
        headquarters: strMap(d.headquarters),
        identity: strMap(d.identity),
        branding: strMap(d.branding),
        documents: Object.fromEntries(Object.entries(docs).map(([slot, v]) => [slot, { name: v.name, contentType: v.contentType, size: v.size, uploadedAt: v.uploadedAt }])),
        completeness: completeness(d),
        reviewNote: str(d.reviewNote),
        reviewedAt: str(d.reviewedAt),
        reviewedBy: str(d.reviewedBy),
        orgId: str(d.orgId),
        orgCode: str(d.orgCode),
        createdAt: str(d.createdAt),
        updatedAt: str(d.updatedAt),
        submittedAt: str(d.submittedAt),
    };
}

function pick(b: Record<string, unknown>, key: string, allowed: Set<string>, message: string, required = true): string {
    const value = str(b[key]).trim();
    if (!value && !required) return '';
    if (!allowed.has(value)) throw new HttpError(400, message);
    return value;
}

function readApplicant(b: Record<string, unknown>, refs: Refs): Fields {
    const title = pick(b, 'title', refs.codes('titles'), 'Choose a title from the list.', false);
    const firstName = text(b, 'firstName', 1, 40, 'Enter your first name.');
    const lastName = text(b, 'lastName', 1, 40, 'Enter your last name.');
    const phoneCountry = str(b.phoneCountry).toUpperCase();
    const country = refs.country(phoneCountry);
    if (!country) throw new HttpError(400, 'Choose the country for your telephone number.');
    const phoneLocal = str(b.phoneLocal).replace(/\D/g, '').replace(/^0+/, '');
    const phone = `${str(country.dialCode)}${phoneLocal}`;
    if (phoneLocal.length < 6 || phoneLocal.length > 12 || !/^\+[1-9]\d{7,14}$/.test(phone)) throw new HttpError(400, 'Enter a valid telephone number.');
    return { title, firstName, lastName, phoneCountry, phoneLocal, phone };
}

function readOrganization(b: Record<string, unknown>, refs: Refs): Fields {
    const name = text(b, 'name', 2, 100, 'Enter the organization name (2 to 100 characters).');
    const legalEntityType = pick(b, 'legalEntityType', refs.codes('legalEntityTypes'), 'Choose a legal entity type from the list.');
    const industryCategory = pick(b, 'industryCategory', refs.codes('industryCategories'), 'Choose an industry category from the list.');
    const industry = pick(b, 'industry', refs.codes('industries'), 'Choose an industry subcategory from the list.');
    if (str(refs.entry('industries', industry)?.categoryCode) !== industryCategory) {
        throw new HttpError(400, 'The industry subcategory must belong to the selected industry category.');
    }
    const companySize = pick(b, 'companySize', refs.codes('companySizes'), 'Choose a company size from the list.');
    const currencyCode = str(b.currencyCode);
    if (!refs.currency(currencyCode)) throw new HttpError(400, 'Choose a base currency from the list.');
    const website = str(b.website).trim();
    if (website && (website.length > 200 || !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(website))) throw new HttpError(400, 'The website must start with https://');
    return { name, legalEntityType, industryCategory, industry, industrySubcategory: industry, companySize, currencyCode, website };
}

function readRegistration(b: Record<string, unknown>, refs: Refs): Fields {
    const countryCode = str(b.countryCode).toUpperCase();
    if (!refs.country(countryCode)) throw new HttpError(400, 'Choose the country of registration.');
    const registrationNumber = str(b.registrationNumber).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9/\-. ]{1,59}$/.test(registrationNumber)) throw new HttpError(400, 'Enter the registration number as shown on the certificate.');
    const registrationDate = str(b.registrationDate);
    const parsed = Date.parse(registrationDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(registrationDate) || Number.isNaN(parsed) || parsed > Date.now() || parsed < Date.parse('1800-01-01')) {
        throw new HttpError(400, 'Enter a valid registration date (not in the future).');
    }
    const taxNumber = str(b.taxNumber).trim();
    if (taxNumber && !/^[A-Za-z0-9][A-Za-z0-9/\-. ]{1,39}$/.test(taxNumber)) throw new HttpError(400, 'Enter a valid tax number.');
    const originCountryCode = str(b.originCountryCode).toUpperCase();
    let originOther = '';
    if (originCountryCode === 'OTHER') {
        originOther = text(b, 'originOther', 2, 60, 'Enter the country of origin.');
    } else if (!refs.country(originCountryCode)) {
        throw new HttpError(400, 'Choose the country of origin.');
    }
    return { countryCode, registrationNumber, registrationDate, taxNumber, originCountryCode, originOther };
}

function readHeadquarters(b: Record<string, unknown>, refs: Refs): Fields {
    const countryCode = str(b.countryCode).toUpperCase();
    if (!refs.country(countryCode)) throw new HttpError(400, 'Choose the headquarters country.');
    return {
        countryCode,
        city: text(b, 'city', 2, 80, 'Enter the headquarters city or town.'),
        address: text(b, 'address', 5, 200, 'Enter the physical address (5 to 200 characters).'),
        postalAddress: text(b, 'postalAddress', 0, 120, 'Postal address can be up to 120 characters.'),
    };
}

function readIdentity(b: Record<string, unknown>, refs: Refs): Fields {
    const idType = pick(b, 'idType', refs.codes('identityDocumentTypes'), 'Choose an identity document type from the list.');
    const idNumber = str(b.idNumber).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9\- ]{2,39}$/.test(idNumber)) throw new HttpError(400, 'Enter the identity document number.');
    return { idType, idNumber };
}

function detectFile(buf: Buffer): { contentType: string; ext: string } | null {
    if (buf.length > 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return { contentType: 'application/pdf', ext: 'pdf' };
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { contentType: 'image/jpeg', ext: 'jpg' };
    if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: 'image/png', ext: 'png' };
    return null;
}

async function isSetupComplete(): Promise<boolean> {
    return str((await getDoc('system/setup'))?.data.status) === 'complete';
}

interface ApplicantContext extends SecureContext {
    app: Doc;
}

function applicantRoute(name: string, needsVerified: boolean, fn: (ctx: ApplicantContext) => Promise<unknown>) {
    return secure(name, async (ctx) => {
        const me = await getDoc(`users/${ctx.uid}`);
        if (!me || str(me.data.role) !== 'applicant') throw new HttpError(403, 'No registration application belongs to this account.');
        if (str(me.data.status) === 'disabled') throw new HttpError(403, 'Your account has been disabled.');
        if (isTokenStale(me, ctx.claims)) throw new HttpError(401, 'Your session has expired. Please log in again.');
        ctx.actor.role = 'applicant';
        const app = await getDoc(`applications/${ctx.uid}`);
        if (!app) throw new HttpError(404, 'Application not found.');
        if (needsVerified && !ctx.claims.emailVerified && (await emailVerificationRequired())) throw new HttpError(403, 'Verify your email address to continue.');
        return fn({ ...ctx, app });
    });
}

function requireEditable(app: Doc) {
    if (!EDITABLE.has(str(app.data.status))) throw new HttpError(400, 'This application can no longer be changed.');
}

function record(ctx: SecureContext, action: string, target: string, details = '', orgId = '') {
    return audit([{ category: 'registration', action, actor: ctx.actor, meta: ctx.meta, target: { type: 'application', label: target }, details, orgId }]);
}

export const applicationRoutes = {
    'POST /api/applications/start': [
        publicRoute(async (body, meta) => {
            const email = str(body.email).trim().toLowerCase();
            const domain = emailDomain(email);
            const client = clientInfo(body.client);
            let claimed = false;
            try {
                await rateLimit('application-start', meta.ip, 5, 3600);
                if (!(await isSetupComplete())) throw new HttpError(503, 'Organization registration is not open yet. Please try again later.');
                const refs = await loadRefs();
                const applicant = readApplicant(body, refs);
                if (!isValidEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
                if (refs.blocked.has(domain) || isBuiltinPublicEmail(email)) {
                    throw new HttpError(400, "Public email addresses are not allowed. Use your organization's email address.");
                }
                if (isStaffDomain(domain)) throw new HttpError(400, 'Manufusion email addresses cannot be used to register an organization.');
                checkPassword(str(body.password));

                await releaseStaleDomainClaim(domain, meta);
                const existing = (await runQuery({ from: [{ collectionId: 'organizations' }], where: fieldEq('domain', domain), limit: 5 })).filter(
                    (o) => str(o.data.status) !== 'rejected'
                );
                const conflict = new HttpError(
                    409,
                    `An organization or registration using @${domain} already exists. If you started it, log in to continue. Otherwise ask your organization's administrator to add you.`
                );
                if (existing.length) throw conflict;
                if (!(await writeDoc(`org_domains/${domain}`, { orgId: '', applicationId: '', status: 'application', claimedAt: nowIso() }, { exists: false }))) throw conflict;
                claimed = true;

                const now = nowIso();
                const uid = await createAuthUser({
                    email,
                    password: str(body.password),
                    displayName: `${str(applicant.firstName)} ${str(applicant.lastName)}`,
                    phoneNumber: str(applicant.phone),
                });
                try {
                    await writeDoc(`users/${uid}`, {
                        uid,
                        email,
                        title: applicant.title,
                        firstName: applicant.firstName,
                        lastName: applicant.lastName,
                        phone: applicant.phone,
                        role: 'applicant',
                        status: 'active',
                        createdAt: now,
                        lastLoginAt: '',
                    });
                    await writeDoc(`applications/${uid}`, {
                        uid,
                        email,
                        domain,
                        status: 'draft',
                        applicant,
                        organization: {},
                        registration: {},
                        headquarters: {},
                        identity: {},
                        branding: {},
                        documents: {},
                        createdAt: now,
                        updatedAt: now,
                    });
                    await writeDoc(`org_domains/${domain}`, { orgId: '', applicationId: uid, status: 'application', claimedAt: now });
                } catch (err) {
                    await deleteAuthUser(uid);
                    await deleteDoc(`users/${uid}`);
                    await deleteDoc(`applications/${uid}`);
                    throw err;
                }
                await audit([
                    {
                        category: 'registration',
                        action: 'application.start',
                        actor: { uid, email, role: 'applicant' },
                        meta,
                        client,
                        target: { type: 'application', id: uid, label: email },
                        details: `@${domain} · Phone: ${str(applicant.phone)}`,
                    },
                ]);
                return { ok: true };
            } catch (err) {
                if (claimed) {
                    const claim = await getDoc(`org_domains/${domain}`);
                    if (claim && !str(claim.data.applicationId) && !str(claim.data.orgId)) await deleteDoc(`org_domains/${domain}`);
                }
                await audit([
                    {
                        category: 'registration',
                        action: 'application.start_attempt',
                        outcome: err instanceof HttpError && err.status < 500 ? 'blocked' : 'failure',
                        actor: { uid: '', email: email || 'unknown' },
                        meta,
                        client,
                        target: { type: 'application', label: email },
                        details: `${err instanceof Error ? err.message : 'Error'} · Phone: ${str(body.phoneLocal)}`,
                    },
                ]);
                throw err;
            }
        }),
    ],

    'POST /api/applications/me': [
        applicantRoute('application.me', false, async ({ app }) => ({ application: appOut(app), verificationRequired: await emailVerificationRequired() })),
    ],

    'POST /api/applications/save': [
        applicantRoute('application.save', true, async (ctx) => {
            requireEditable(ctx.app);
            const section = str(ctx.body.section);
            if (!SECTIONS.includes(section)) throw new HttpError(400, 'Unknown section.');
            const data = (isObj(ctx.body.data) ? ctx.body.data : {}) as Record<string, unknown>;
            let value: Fields;
            if (section === 'branding') {
                value = readBranding(data);
            } else {
                const refs = await loadRefs();
                value =
                    section === 'applicant'
                        ? readApplicant(data, refs)
                        : section === 'organization'
                          ? readOrganization(data, refs)
                          : section === 'registration'
                            ? readRegistration(data, refs)
                            : section === 'headquarters'
                              ? readHeadquarters(data, refs)
                              : readIdentity(data, refs);
            }
            if (section === 'applicant') {
                const me = await getDoc(`users/${ctx.uid}`);
                const changes: Record<string, unknown> = { displayName: `${str(value.firstName)} ${str(value.lastName)}` };
                if (str(value.phone) !== str(me?.data.phone)) changes.phoneNumber = value.phone;
                await updateAuthUser(ctx.uid, changes);
                await updateFields(`users/${ctx.uid}`, { title: value.title, firstName: value.firstName, lastName: value.lastName, phone: value.phone });
            }
            await updateFields(`applications/${ctx.uid}`, { [section]: value, updatedAt: nowIso() });
            await record(ctx, 'application.save', ctx.actor.email, `Section: ${section}`);
            const fresh = await getDoc(`applications/${ctx.uid}`);
            return { application: appOut(fresh ?? ctx.app) };
        }),
    ],

    'POST /api/applications/upload': [
        applicantRoute('application.upload', true, async (ctx) => {
            requireEditable(ctx.app);
            await rateLimit('application-upload', ctx.uid, 60, 3600);
            const slot = str(ctx.body.slot);
            const def = DOC_SLOTS[slot];
            if (!def) throw new HttpError(400, 'Unknown document type.');
            const data = str(ctx.body.data);
            if (!data || data.length > Math.ceil((MAX_FILE_BYTES * 4) / 3) + 8 || !/^[A-Za-z0-9+/=]+$/.test(data)) {
                throw new HttpError(400, 'The file must be a PDF or photo no larger than 3 MB.');
            }
            const buf = Buffer.from(data, 'base64');
            if (buf.length === 0 || buf.length > MAX_FILE_BYTES) throw new HttpError(400, 'The file must be no larger than 3 MB.');
            const detected = detectFile(buf);
            if (!detected) throw new HttpError(400, 'Only PDF, JPEG or PNG files are accepted.');
            if (def.imageOnly && detected.contentType === 'application/pdf') throw new HttpError(400, 'Please upload an image (JPEG or PNG).');
            const path = `applications/${ctx.uid}/${slot}_${randomId(6)}.${detected.ext}`;
            const [ok] = await storage.write([{ path, content: data, contentType: detected.contentType }]);
            if (!ok) throw new HttpError(502, 'The file could not be stored. Please try again.');
            const previous = docsMap(ctx.app.data.documents)[slot];
            if (previous) await storage.delete([previous.path]);
            const name = str(ctx.body.fileName).replace(/[^\w .()-]/g, '').slice(0, 100) || `${slot}.${detected.ext}`;
            const documents: Obj = isObj(ctx.app.data.documents) ? { ...ctx.app.data.documents } : {};
            documents[slot] = { path, name, contentType: detected.contentType, size: buf.length, uploadedAt: nowIso() };
            await updateFields(`applications/${ctx.uid}`, { documents, updatedAt: nowIso() });
            await record(ctx, 'application.upload', ctx.actor.email, `${def.label} (${Math.round(buf.length / 1024)} KB)`);
            const fresh = await getDoc(`applications/${ctx.uid}`);
            return { application: appOut(fresh ?? ctx.app) };
        }),
    ],

    'POST /api/applications/document-url': [
        applicantRoute('application.document_url', false, async (ctx) => {
            const doc = docsMap(ctx.app.data.documents)[str(ctx.body.slot)];
            if (!doc) throw new HttpError(404, 'Document not found.');
            const [signed] = await storage.url([doc.path]);
            return { url: signed?.url ?? '' };
        }),
    ],

    'POST /api/applications/submit': [
        applicantRoute('application.submit', true, async (ctx) => {
            requireEditable(ctx.app);
            if (ctx.body.declaration !== true) throw new HttpError(400, 'Please confirm the declaration before submitting.');
            const done = completeness(ctx.app.data);
            const missing = Object.entries(done).filter(([, ok]) => !ok).map(([key]) => key);
            if (missing.length) throw new HttpError(400, `Complete these steps first: ${missing.join(', ')}.`);
            const now = nowIso();
            await updateFields(`applications/${ctx.uid}`, { status: 'submitted', submittedAt: now, updatedAt: now, declarationAt: now });
            await record(ctx, 'application.submit', ctx.actor.email, str(strMap(ctx.app.data.organization).name));
            const fresh = await getDoc(`applications/${ctx.uid}`);
            return { application: appOut(fresh ?? ctx.app) };
        }),
    ],

    'POST /api/admin/applications/list': [
        staff('admin.applications.list', 'read', async () => {
            const docs = await listDocs('applications');
            return {
                applications: docs
                    .map((d) => {
                        const a = strMap(d.data.applicant);
                        return {
                            uid: d.id,
                            email: str(d.data.email),
                            domain: str(d.data.domain),
                            status: str(d.data.status),
                            organizationName: strMap(d.data.organization).name ?? '',
                            applicantName: `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim(),
                            createdAt: str(d.data.createdAt),
                            updatedAt: str(d.data.updatedAt),
                            submittedAt: str(d.data.submittedAt),
                        };
                    })
                    .sort((a, b) => (b.submittedAt || b.updatedAt).localeCompare(a.submittedAt || a.updatedAt)),
            };
        }),
    ],

    'POST /api/admin/applications/get': [
        staff('admin.applications.get', 'read', async (ctx) => {
            const uid = str(ctx.body.uid);
            const app = /^[A-Za-z0-9]{6,128}$/.test(uid) ? await getDoc(`applications/${uid}`) : null;
            if (!app) throw new HttpError(404, 'Application not found.');
            const docs = docsMap(app.data.documents);
            const slots = Object.keys(docs);
            const urls = slots.length ? await storage.url(slots.map((s) => docs[s].path)) : [];
            const documents: Record<string, { name: string; contentType: string; size: number; uploadedAt: string; url: string; label: string }> = {};
            slots.forEach((slot) => {
                documents[slot] = {
                    name: docs[slot].name,
                    contentType: docs[slot].contentType,
                    size: docs[slot].size,
                    uploadedAt: docs[slot].uploadedAt,
                    url: urls.find((u) => u.path === docs[slot].path)?.url ?? '',
                    label: DOC_SLOTS[slot]?.label ?? slot,
                };
            });
            await audit([{ category: 'admin', action: 'application.view', actor: ctx.actor, meta: ctx.meta, target: { type: 'application', id: uid, label: str(app.data.email) } }]);
            return { application: appOut(app), documents };
        }),
    ],

    'POST /api/admin/applications/decide': [
        staff('admin.applications.decide', 'super', async (ctx: StaffContext) => {
            const uid = str(ctx.body.uid);
            const decision = str(ctx.body.decision);
            const note = str(ctx.body.note).trim().slice(0, 1000);
            if (!['approve', 'return', 'reject'].includes(decision)) throw new HttpError(400, 'Choose approve, return or reject.');
            if (decision !== 'approve' && note.length < 5) throw new HttpError(400, 'Give the applicant a reason (at least 5 characters).');
            const app = /^[A-Za-z0-9]{6,128}$/.test(uid) ? await getDoc(`applications/${uid}`) : null;
            if (!app) throw new HttpError(404, 'Application not found.');
            if (str(app.data.status) !== 'submitted') throw new HttpError(400, 'Only submitted applications can be decided.');
            const now = nowIso();
            const domain = str(app.data.domain);

            if (decision === 'return') {
                await updateFields(`applications/${uid}`, { status: 'returned', reviewNote: note, reviewedAt: now, reviewedBy: ctx.actor.email, updatedAt: now });
                await record(ctx, 'application.return', str(app.data.email), note);
                return { status: 'returned' };
            }
            if (decision === 'reject') {
                await updateFields(`applications/${uid}`, { status: 'rejected', reviewNote: note, reviewedAt: now, reviewedBy: ctx.actor.email, updatedAt: now });
                const claim = await getDoc(`org_domains/${domain}`);
                if (claim && str(claim.data.applicationId) === uid && !str(claim.data.orgId)) await deleteDoc(`org_domains/${domain}`);
                await record(ctx, 'application.reject', str(app.data.email), note);
                return { status: 'rejected' };
            }

            const done = completeness(app.data);
            if (Object.values(done).some((ok) => !ok)) throw new HttpError(400, 'The application is incomplete.');
            const refs = await loadRefs();
            const org = strMap(app.data.organization);
            const reg = strMap(app.data.registration);
            const hq = strMap(app.data.headquarters);
            const brand = strMap(app.data.branding);
            const docs = docsMap(app.data.documents);
            const existing = (await runQuery({ from: [{ collectionId: 'organizations' }], where: fieldEq('domain', domain), limit: 5 })).filter(
                (o) => str(o.data.status) !== 'rejected'
            );
            if (existing.length) throw new HttpError(409, `An organization using @${domain} already exists.`);
            const modules: Obj = {};
            for (const m of await listDocs('modules')) if (m.data.mandatory === true) modules[m.id] = true;
            const code = await allocateOrgCode();
            const created = await createDoc('organizations', {
                name: org.name,
                code,
                domain,
                legalEntityType: org.legalEntityType,
                industryCategory: org.industryCategory,
                industry: org.industry,
                industrySubcategory: org.industry,
                companySize: org.companySize,
                currencyCode: org.currencyCode,
                website: org.website ?? '',
                countryCode: reg.countryCode,
                countryName: str(refs.country(reg.countryCode)?.name),
                city: hq.city,
                registration: reg,
                headquarters: { ...hq, countryName: str(refs.country(hq.countryCode)?.name) },
                branding: {
                    displayName: brand.displayName,
                    slogan: brand.slogan,
                    preset: brand.preset,
                    brandColor: brand.brandColor,
                    theme: buildTheme(brand.preset, brand.brandColor),
                    logoPath: docs.logo?.path ?? '',
                },
                status: 'active',
                creatorEmailVerified: true,
                modules,
                applicationId: uid,
                createdBy: uid,
                createdAt: now,
                approvedAt: now,
                approvedBy: ctx.actor.email,
            });
            await seedOrgRoles(created.id);
            await writeDoc(`org_codes/${code}`, { orgId: created.id, assignedAt: now });
            await writeDoc(`org_domains/${domain}`, { orgId: created.id, applicationId: uid, status: 'active', claimedAt: now });
            await updateFields(`users/${uid}`, { role: 'org_super_admin', orgId: created.id, photoPath: docs.photo?.path ?? '', updatedAt: now });
            await updateFields(`applications/${uid}`, {
                status: 'approved',
                orgId: created.id,
                orgCode: code,
                reviewNote: note,
                reviewedAt: now,
                reviewedBy: ctx.actor.email,
                updatedAt: now,
            });
            await record(ctx, 'application.approve', `${org.name} (${code})`, `@${domain}`, created.id);
            return { status: 'approved', orgId: created.id, code };
        }),
    ],
};
