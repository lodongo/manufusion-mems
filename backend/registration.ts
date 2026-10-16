import { createHash } from 'node:crypto';
import { audit } from './audit';
import {
    HttpError,
    checkPassword,
    clientInfo,
    createAuthUser,
    createDoc,
    deleteAuthUser,
    deleteDoc,
    emailDomain,
    fieldEq,
    getDoc,
    isAuthEmailVerified,
    isBuiltinPublicEmail,
    isObj,
    isStaffDomain,
    isValidEmail,
    listDocs,
    nowIso,
    randomId,
    rateLimit,
    runQuery,
    safe,
    str,
    text,
    updateFields,
    writeDoc,
    type Doc,
    type Obj,
    type Plain,
} from './core';
import { allocateOrgCode, publicRoute, purgeRegistrationFiles, releaseStaleDomainClaim, staff, type StaffContext } from './guards';
import { seedOrgRoles } from './org';

// ---------------------------------------------------------------------------
// Organization registration with documents and MEMS approval.
// Files are stored server-side only, in Firestore chunks under
// organizations/{orgId}/registration_files/{fileId}/chunks/{n}.
// ---------------------------------------------------------------------------

const REF = {
    countries: 'reference/countries',
    currencies: 'reference/currencies',
    metadata: 'reference/metadata',
    publicEmailDomains: 'reference/publicEmailDomains',
};

type FileKind = 'registration' | 'identity' | 'photo';
interface FileRule {
    label: string;
    min: number;
    max: number;
    types: string[];
}

const FILE_RULES: Record<FileKind, FileRule> = {
    registration: { label: 'registration document', min: 1, max: 3, types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
    identity: { label: 'identity document', min: 1, max: 2, types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
    photo: { label: 'photo', min: 1, max: 1, types: ['image/jpeg', 'image/png', 'image/webp'] },
};

const MAX_FILE_BYTES = 1_600_000;
const MAX_TOTAL_BYTES = 3_700_000;
const CHUNK_CHARS = 700_000;
const PENDING = ['pending_approval', 'pending_verification'];

interface ParsedFile {
    kind: FileKind;
    name: string;
    contentType: string;
    size: number;
    base64: string;
    sha256: string;
}

function sniff(buf: Buffer): string {
    if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    return '';
}

function parseFiles(raw: unknown): ParsedFile[] {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length > 6) throw new HttpError(400, 'Too many files attached.');
    const rules = FILE_RULES as Record<string, FileRule | undefined>;
    const files = list.map((item): ParsedFile => {
        if (!isObj(item)) throw new HttpError(400, 'A file could not be read. Please attach it again.');
        const kind = str(item.kind);
        const rule = rules[kind];
        if (!rule) throw new HttpError(400, 'Unknown document type.');
        const b64 = str(item.data);
        if (!b64 || b64.length > MAX_FILE_BYTES * 1.4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new HttpError(400, 'A file could not be read. Please attach it again.');
        const buf = Buffer.from(b64, 'base64');
        if (!buf.length) throw new HttpError(400, 'A file is empty. Please attach it again.');
        if (buf.length > MAX_FILE_BYTES) throw new HttpError(400, 'Each file must be 1.5 MB or smaller.');
        const type = sniff(buf);
        if (!type || !rule.types.includes(type)) {
            throw new HttpError(400, kind === 'photo' ? 'The photo must be a JPG, PNG or WEBP image.' : `The ${rule.label} must be a PDF, JPG, PNG or WEBP file.`);
        }
        const name = str(item.name).replace(/[^\w.\- ]+/g, '_').slice(0, 100) || kind;
        return { kind: kind as FileKind, name, contentType: type, size: buf.length, base64: buf.toString('base64'), sha256: createHash('sha256').update(buf).digest('hex') };
    });
    for (const [kind, rule] of Object.entries(FILE_RULES)) {
        const count = files.filter((f) => f.kind === kind).length;
        if (count < rule.min) throw new HttpError(400, kind === 'photo' ? 'Attach a photo of yourself.' : `Attach at least one ${rule.label}.`);
        if (count > rule.max) throw new HttpError(400, `Attach no more than ${rule.max} ${rule.label}${rule.max > 1 ? 's' : ''}.`);
    }
    if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) throw new HttpError(400, 'All files together must be 3.5 MB or smaller.');
    return files;
}

function listItems(doc: Doc | null): Obj[] {
    const value = doc?.data.items;
    return Array.isArray(value) ? value.filter(isObj) : [];
}

function validDate(value: string, label: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `Enter the ${label}.`);
    const t = Date.parse(`${value}T00:00:00Z`);
    if (Number.isNaN(t) || t > Date.now() || t < Date.parse('1900-01-01T00:00:00Z')) throw new HttpError(400, `Enter a valid ${label}.`);
    return value;
}

const ORG_ID_RE = /^[A-Za-z0-9]{10,40}$/;

function record(ctx: StaffContext, action: string, orgId: string, label: string, details = '') {
    return audit([{ category: 'approval', action, actor: ctx.actor, meta: ctx.meta, orgId, target: { type: 'organization', id: orgId, label }, details }]);
}

async function loadOrg(orgId: string): Promise<Doc> {
    const org = ORG_ID_RE.test(orgId) ? await getDoc(`organizations/${orgId}`) : null;
    if (!org) throw new HttpError(404, 'Organization not found.');
    return org;
}

const normStatus = (s: string) => (s === 'pending_verification' ? 'pending_approval' : s);

export const registrationHandler = [
    publicRoute(async (body, meta) => {
        const email = str(body.email).trim().toLowerCase();
        const domain = emailDomain(email);
        const client = clientInfo(body.client);
        const attempt = `Org: ${str(body.organizationName).slice(0, 100)} · Reg no: ${str(body.registrationNumber).slice(0, 60)} · Phone: ${str(body.phoneLocal).slice(0, 20)} · Country: ${str(body.countryCode).slice(0, 2)}`;
        let domainClaimed = false;
        try {
            await rateLimit('org-register', meta.ip, 5, 3600);
            const notOpen = new HttpError(503, 'Organization registration is not open yet. Please try again later.');
            if (str((await getDoc('system/setup'))?.data.status) !== 'complete') throw notOpen;
            const [countriesDoc, currenciesDoc, metadataDoc, domainsDoc] = await Promise.all([
                getDoc(REF.countries),
                getDoc(REF.currencies),
                getDoc(REF.metadata),
                getDoc(REF.publicEmailDomains),
            ]);
            if (!countriesDoc || !currenciesDoc || !metadataDoc || !domainsDoc) throw notOpen;
            const countries = listItems(countriesDoc);
            const currencies = listItems(currenciesDoc);
            const metaLists = listItems(metadataDoc);
            const blocked = new Set((Array.isArray(domainsDoc.data.items) ? (domainsDoc.data.items as Plain[]) : []).map((d) => str(d).toLowerCase()));
            const codesFor = (key: string) => {
                const list = metaLists.find((l) => str(l.key) === key);
                return new Set((Array.isArray(list?.items) ? (list?.items as Plain[]) : []).map((i) => (isObj(i) ? str(i.code) : '')).filter(Boolean));
            };
            const pick = (key: string, listKey: string, message: string, required = true) => {
                const codes = codesFor(listKey);
                if (!codes.size) throw notOpen;
                const value = str(body[key]);
                if (!value && !required) return '';
                if (!codes.has(value)) throw new HttpError(400, message);
                return value;
            };
            const findCountry = (key: string, message: string) => {
                const c = countries.find((x) => str(x.iso2) === str(body[key]));
                if (!c) throw new HttpError(400, message);
                return c;
            };

            // Organization
            const organizationName = text(body, 'organizationName', 2, 100, 'Enter your organization name.');
            const legalEntityType = pick('legalEntityType', 'legalEntityTypes', 'Choose a legal entity type from the list.');
            const industry = pick('industry', 'industries', 'Choose an industry from the list.');
            const companySize = pick('companySize', 'companySizes', 'Choose a company size from the list.');

            // Local registration
            const country = findCountry('countryCode', 'Choose the country of registration from the list.');
            const registrationNumber = text(body, 'registrationNumber', 2, 60, 'Enter the registration number.');
            const registrationAuthority = text(body, 'registrationAuthority', 2, 120, 'Enter the registering authority.');
            const registrationDate = validDate(str(body.registrationDate), 'registration date');
            const taxId = text(body, 'taxId', 2, 40, 'Enter the tax identification number.');
            const currency = currencies.find((c) => str(c.code) === str(body.currencyCode));
            if (!currency) throw new HttpError(400, 'Choose a currency from the list.');
            const city = text(body, 'city', 2, 80, 'Enter the city or town of your local office.');

            // Origin and headquarters
            const origin = findCountry('originCountryCode', 'Choose the country of origin from the list.');
            const hqCountry = findCountry('hqCountryCode', 'Choose the headquarters country from the list.');
            const hqCity = text(body, 'hqCity', 2, 80, 'Enter the headquarters city.');
            const hqAddress = text(body, 'hqAddress', 5, 200, 'Enter the headquarters physical address.');
            const hqPostalAddress = text(body, 'hqPostalAddress', 0, 120, 'Postal address can be up to 120 characters.');

            // Registrant
            const title = pick('title', 'titles', 'Choose a title from the list.', false);
            const firstName = text(body, 'firstName', 1, 40, 'Enter your first name.');
            const lastName = text(body, 'lastName', 1, 40, 'Enter your last name.');
            const jobTitle = text(body, 'jobTitle', 2, 80, 'Enter your job title.');
            const idType = pick('idType', 'identityDocumentTypes', 'Choose an identity document type from the list.');
            const idNumber = text(body, 'idNumber', 3, 40, 'Enter your identity document number.');
            if (!isValidEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
            if (blocked.has(domain) || isBuiltinPublicEmail(email)) {
                throw new HttpError(400, "Public email addresses are not allowed. Use your organization's email address.");
            }
            if (isStaffDomain(domain)) throw new HttpError(400, 'Manufusion email addresses cannot be used to register an organization.');
            const local = str(body.phoneLocal).replace(/\D/g, '').replace(/^0+/, '');
            const phone = `${str(country.dialCode)}${local}`;
            if (local.length < 6 || local.length > 12 || !/^\+[1-9]\d{7,14}$/.test(phone)) throw new HttpError(400, 'Enter a valid telephone number.');
            const password = str(body.password);
            checkPassword(password);
            if (body.declaration !== true) throw new HttpError(400, 'Confirm the declaration to continue.');

            // Documents
            const files = parseFiles(body.files);

            // One organization per email extension.
            await releaseStaleDomainClaim(domain, meta);
            const existing = (await runQuery({ from: [{ collectionId: 'organizations' }], where: fieldEq('domain', domain), limit: 5 })).filter(
                (o) => str(o.data.status) !== 'rejected'
            );
            if (existing.length || !(await writeDoc(`org_domains/${domain}`, { orgId: '', claimedAt: nowIso(), status: 'pending' }, { exists: false }))) {
                throw new HttpError(409, `An organization using @${domain} is already registered. Ask its administrator to add you as a user.`);
            }
            domainClaimed = true;

            const modules: Obj = {};
            for (const m of (await listDocs('modules')).filter((d) => d.data.mandatory === true)) modules[m.id] = true;
            const orgCode = await allocateOrgCode();
            const now = nowIso();
            const uid = await createAuthUser({ email, password, displayName: `${firstName} ${lastName}`, phoneNumber: phone });
            let orgId = '';
            try {
                const org = await createDoc('organizations', {
                    name: organizationName,
                    code: orgCode,
                    domain,
                    legalEntityType,
                    industry,
                    companySize,
                    countryCode: str(country.iso2),
                    countryName: str(country.name),
                    currencyCode: str(currency.code),
                    city,
                    registration: { number: registrationNumber, authority: registrationAuthority, date: registrationDate, taxId },
                    originCountryCode: str(origin.iso2),
                    originCountryName: str(origin.name),
                    hq: { countryCode: str(hqCountry.iso2), countryName: str(hqCountry.name), city: hqCity, address: hqAddress, postalAddress: hqPostalAddress },
                    registrant: { uid, title, firstName, lastName, jobTitle, email, phone, idType, idNumber },
                    status: 'pending_approval',
                    creatorEmailVerified: false,
                    modules,
                    createdBy: uid,
                    createdAt: now,
                });
                orgId = org.id;
                for (const f of files) {
                    const fileId = randomId(8);
                    const chunks = Math.ceil(f.base64.length / CHUNK_CHARS);
                    const base = `organizations/${orgId}/registration_files/${fileId}`;
                    await writeDoc(base, { kind: f.kind, name: f.name, contentType: f.contentType, size: f.size, sha256: f.sha256, chunks, uploadedAt: now });
                    for (let i = 0; i < chunks; i++) {
                        await writeDoc(`${base}/chunks/${i}`, { index: i, data: f.base64.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) });
                    }
                }
                await seedOrgRoles(orgId);
                await writeDoc(`users/${uid}`, {
                    uid, email, title, firstName, lastName, phone, jobTitle, role: 'org_super_admin', status: 'active', orgId, createdAt: now, lastLoginAt: '',
                });
                await writeDoc(`org_domains/${domain}`, { orgId, claimedAt: now, status: 'active' });
                await writeDoc(`org_codes/${orgCode}`, { orgId, assignedAt: now });
            } catch (err) {
                await deleteAuthUser(uid);
                if (orgId) {
                    await safe(() => purgeRegistrationFiles(orgId), undefined);
                    await safe(() => deleteDoc(`organizations/${orgId}/roles/org_super_admin`), undefined);
                    await safe(() => deleteDoc(`organizations/${orgId}/roles/org_user`), undefined);
                    await safe(() => deleteDoc(`organizations/${orgId}`), undefined);
                }
                throw err;
            }
            await audit([
                {
                    category: 'registration',
                    action: 'tenant.register',
                    actor: { uid, email, role: 'org_super_admin', orgId },
                    meta,
                    client,
                    target: { type: 'organization', id: orgId, label: organizationName },
                    details: `${orgCode} · @${domain} · Reg no ${registrationNumber} · ${str(country.name)} · Phone ${phone} · ${files.length} documents · awaiting approval`,
                },
            ]);
            return { ok: true, status: 'pending_approval', code: orgCode };
        } catch (err) {
            if (domainClaimed) await safe(() => deleteDoc(`org_domains/${domain}`), undefined);
            await audit([
                {
                    category: 'registration',
                    action: 'tenant.register_attempt',
                    outcome: err instanceof HttpError && err.status < 500 ? 'blocked' : 'failure',
                    actor: { uid: '', email: email || 'unknown' },
                    meta,
                    client,
                    target: { type: 'organization', label: str(body.organizationName).slice(0, 100) },
                    details: `${err instanceof Error ? err.message : 'Error'} · ${attempt}`,
                },
            ]);
            throw err;
        }
    }),
];

export const registrationRoutes = {
    // Full registration record for review (MEMS staff only).
    'POST /api/admin/registrations/get': [
        staff('admin.registrations.get', 'read', async ({ body }) => {
            const org = await loadOrg(str(body.orgId));
            const d = org.data;
            const reg = isObj(d.registration) ? d.registration : {};
            const hq = isObj(d.hq) ? d.hq : {};
            const registrant = isObj(d.registrant) ? d.registrant : {};
            const files = await listDocs(`organizations/${org.id}/registration_files`);
            const createdBy = str(d.createdBy);
            const emailVerified = d.creatorEmailVerified === true || (createdBy ? await safe(() => isAuthEmailVerified(createdBy), false) : false);
            return {
                id: org.id,
                code: str(d.code),
                name: str(d.name),
                status: normStatus(str(d.status)),
                domain: str(d.domain),
                legalEntityType: str(d.legalEntityType),
                industry: str(d.industry),
                companySize: str(d.companySize),
                countryName: str(d.countryName),
                city: str(d.city),
                currencyCode: str(d.currencyCode),
                submittedAt: str(d.createdAt),
                registration: { number: str(reg.number), authority: str(reg.authority), date: str(reg.date), taxId: str(reg.taxId) },
                originCountryName: str(d.originCountryName),
                hq: { countryName: str(hq.countryName), city: str(hq.city), address: str(hq.address), postalAddress: str(hq.postalAddress) },
                registrant: {
                    title: str(registrant.title),
                    firstName: str(registrant.firstName),
                    lastName: str(registrant.lastName),
                    jobTitle: str(registrant.jobTitle),
                    email: str(registrant.email),
                    phone: str(registrant.phone),
                    idType: str(registrant.idType),
                    idNumber: str(registrant.idNumber),
                },
                emailVerified,
                files: files.map((f) => ({
                    id: f.id,
                    kind: str(f.data.kind),
                    name: str(f.data.name),
                    contentType: str(f.data.contentType),
                    size: Number(f.data.size ?? 0),
                    uploadedAt: str(f.data.uploadedAt),
                })),
                decision: {
                    approvedAt: str(d.approvedAt),
                    approvedBy: str(d.approvedBy),
                    rejectedAt: str(d.rejectedAt),
                    rejectedBy: str(d.rejectedBy),
                    rejectionReason: str(d.rejectionReason),
                },
            };
        }),
    ],

    // Streams one uploaded document back to MEMS staff. Every view is audited.
    'POST /api/admin/registrations/file': [
        staff('admin.registrations.file', 'read', async (ctx) => {
            const org = await loadOrg(str(ctx.body.orgId));
            const fileId = str(ctx.body.fileId);
            if (!/^[a-f0-9]{16}$/.test(fileId)) throw new HttpError(400, 'Invalid file.');
            const base = `organizations/${org.id}/registration_files/${fileId}`;
            const meta = await getDoc(base);
            if (!meta) throw new HttpError(404, 'File not found.');
            const chunks = (await listDocs(`${base}/chunks`)).sort((a, b) => Number(a.data.index ?? a.id) - Number(b.data.index ?? b.id));
            const data = chunks.map((c) => str(c.data.data)).join('');
            await record(ctx, 'registration.document_viewed', org.id, str(org.data.name), `${str(meta.data.kind)}: ${str(meta.data.name)}`);
            return { name: str(meta.data.name), contentType: str(meta.data.contentType), data };
        }),
    ],

    // Approve, reject or (for rejected registrations) permanently delete. MEMS super admin only.
    'POST /api/admin/registrations/decide': [
        staff('admin.registrations.decide', 'super', async (ctx) => {
            const org = await loadOrg(str(ctx.body.orgId));
            const decision = str(ctx.body.decision);
            const status = normStatus(str(org.data.status));
            const name = str(org.data.name);
            const now = nowIso();
            if (decision === 'approve') {
                if (!PENDING.includes(str(org.data.status))) throw new HttpError(400, 'Only pending registrations can be approved.');
                await updateFields(`organizations/${org.id}`, { status: 'active', approvedAt: now, approvedBy: ctx.actor.email, rejectionReason: '' });
                await record(ctx, 'tenant.approved', org.id, name, str(org.data.code));
                return { status: 'active' };
            }
            if (decision === 'reject') {
                if (!PENDING.includes(str(org.data.status))) throw new HttpError(400, 'Only pending registrations can be rejected.');
                const reason = text(ctx.body, 'reason', 5, 500, 'Give a reason for the rejection (5 to 500 characters).');
                await updateFields(`organizations/${org.id}`, { status: 'rejected', rejectedAt: now, rejectedBy: ctx.actor.email, rejectionReason: reason });
                const domain = str(org.data.domain);
                if (domain) {
                    const claim = await getDoc(`org_domains/${domain}`);
                    if (claim && str(claim.data.orgId) === org.id) await deleteDoc(`org_domains/${domain}`);
                }
                await record(ctx, 'tenant.rejected', org.id, name, reason);
                return { status: 'rejected' };
            }
            if (decision === 'delete') {
                if (status !== 'rejected') throw new HttpError(400, 'Only rejected registrations can be deleted.');
                const users = await runQuery({ from: [{ collectionId: 'users' }], where: fieldEq('orgId', org.id) });
                for (const u of users) {
                    await deleteAuthUser(u.id);
                    await deleteDoc(`users/${u.id}`);
                }
                await purgeRegistrationFiles(org.id);
                for (const role of await listDocs(`organizations/${org.id}/roles`)) await deleteDoc(`organizations/${org.id}/roles/${role.id}`);
                await deleteDoc(`organizations/${org.id}`);
                await record(ctx, 'tenant.purged', org.id, name, `${str(org.data.code)} · ${users.length} account(s) and all documents deleted`);
                return { status: 'deleted' };
            }
            throw new HttpError(400, 'Unknown decision.');
        }),
    ],
};
