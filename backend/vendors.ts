import { HttpError, deleteDoc, getDoc, isObj, listDocs, nowIso, str, writeDoc, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { record } from './org';
import { nextOrgCounter } from './positions';
import { KIND_LABEL, LINE_KINDS, adopted, can, requireProcurement, type LineKind } from './procurementSetup';
import { VENDOR_META_LISTS } from './vendorMetaDefaults';
import { seedModuleMetadata } from './moduleDefaults';

// ---------------------------------------------------------------------------
// Vendors (VND + 6 digits). A vendor is registered as a draft, submitted, and approved by someone else.
//
//   organizations/{org}/vendors/{VND000001}                       the vendor, its scopes, bank details, documents and history
//   organizations/{org}/vendors/{id}/documents/{docId}            one file each (PDF, JPEG, PNG, 450 KB)
//
// What a vendor is (all lists come from MEMS Modules > PRC > Metadata):
//   class      OEM, OCM, authorised distributor, general supplier, service contractor ...
//   sourcing   multi-source, preferred, framework, single source, sole source, nominated ...
//   scopes     for each of material, service and asset: up to 10 subcategories the organization has adopted
//
// Status flow
//   draft --submit--> pending_approval --approve--> approved <--suspend / reinstate--> suspended
//   pending_approval --return--> returned (edit, submit again)     pending_approval --reject--> rejected
//   approved|suspended --reopen (reason)--> returned: the vendor cannot be used until it is approved again
// Controls: whoever created or edited a vendor cannot approve it. A tax PIN, registration number or bank account
// already on another vendor is refused. Changes to the name, tax PIN or bank details of a reopened vendor are
// written to its history. Bank account numbers are masked for people who only view vendors. Everything is audited.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const ID = /^VND\d{6}$/;
const MAX_PER_KIND = 10;
const MAX_DOCS = 30;
const OVERRIDE_DAYS = 30;
const MAX_DRAFTS = 25;
const MAX_FILE_CHARS = 620_000;
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const EDITORS_MAX = 40;

const STATUS_LABEL: Record<string, string> = {
    draft: 'Draft',
    pending_approval: 'Pending approval',
    returned: 'Returned for correction',
    approved: 'Approved',
    suspended: 'Suspended',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
};

export const vendorsPath = (orgId: string) => `organizations/${orgId}/vendors`;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const o = (v: unknown): Obj => (isObj(v) ? v : {});
const today = () => new Date().toISOString().slice(0, 10);
const cleanText = (v: unknown) => str(v).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
const oneLine = (v: unknown, max: number) => cleanText(v).replace(/\s+/g, ' ').slice(0, max);
const nameOfUser = (u: Doc | null | undefined) => (u ? [str(u.data.firstName), str(u.data.lastName)].filter(Boolean).join(' ') || str(u.data.email) : '');
const normalize = (v: unknown) => str(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

// ----- Master data (database first, shipped defaults as fallback) -----

export interface Meta extends Obj {
    code: string;
    label: string;
    description: string;
}
export async function metaList(key: string): Promise<Meta[]> {
    const doc = await getDoc(`module_workspaces/PRC/metadata/${key}`);
    const fromDb = Array.isArray(doc?.data.items) ? (doc!.data.items as unknown[]).filter(isObj) : [];
    const items: Obj[] = fromDb.length ? fromDb : (VENDOR_META_LISTS.find((l) => l.key === key)?.items ?? []);
    return items
        .filter((i) => i.selectable !== false && i.active !== false)
        .map((i): Meta => ({ ...i, code: str(i.code), label: str(i.label), description: str(i.description) }))
        .filter((i) => i.code && i.label);
}
async function allMeta() {
    const [classes, sourcing, legalTypes, documents, paymentTerms, incoterms, risks] = await Promise.all([
        metaList('vendorClasses'),
        metaList('vendorSourcingChannels'),
        metaList('vendorLegalTypes'),
        metaList('vendorDocumentTypes'),
        metaList('vendorPaymentTerms'),
        metaList('vendorIncoterms'),
        metaList('vendorRiskRatings'),
    ]);
    return { classes, sourcing, legalTypes, documents, paymentTerms, incoterms, risks };
}
type AllMeta = Awaited<ReturnType<typeof allMeta>>;

function pick(list: Meta[], code: string, what: string): Meta | null {
    if (!code) return null;
    const m = list.find((x) => x.code === code);
    if (!m) throw new HttpError(400, `Choose a ${what} from the list.`);
    return m;
}

// ----- Access -----

const canView = (ctx: OrgContext) => can(ctx, 'PRC.vendors.view') || can(ctx, 'PRC.vendors.manage') || can(ctx, 'PRC.vendors.approve');
function requireView(ctx: OrgContext) {
    requireProcurement(ctx);
    if (!canView(ctx)) throw new HttpError(403, 'You do not have permission to view vendors.');
}
const editorsOf = (d: Obj) => (Array.isArray(d.editors) ? (d.editors as unknown[]).map(str) : []);
const history = (d: Obj) => objs(d.history);

function visible(ctx: OrgContext, d: Obj): boolean {
    const status = str(d.status);
    if (str(d.createdBy) === ctx.uid) return true;
    if (status === 'draft' && can(ctx, 'PRC.vendors.override')) return true;
    if (status === 'draft' || status === 'cancelled') return false;
    if (can(ctx, 'PRC.vendors.manage') || can(ctx, 'PRC.vendors.approve')) return true;
    return canView(ctx) && ['approved', 'suspended'].includes(status);
}

function flags(ctx: OrgContext, d: Obj) {
    const status = str(d.status);
    const manage = can(ctx, 'PRC.vendors.manage');
    const approve = can(ctx, 'PRC.vendors.approve');
    const creator = str(d.createdBy) === ctx.uid;
    const touched = editorsOf(d).includes(ctx.uid) || creator;
    const edit = manage && ((status === 'draft' && creator) || status === 'returned');
    return {
        edit,
        submit: edit,
        discard: status === 'draft' && creator && manage,
        decide: status === 'pending_approval' && approve && !touched,
        blocked: status === 'pending_approval' && approve && touched ? 'You created or edited this vendor, so someone else must approve it.' : '',
        suspend: status === 'approved' && approve,
        reinstate: status === 'suspended' && approve,
        reopen: ['approved', 'suspended'].includes(status) && manage,
        seeBank: creator || manage || approve,
        override: can(ctx, 'PRC.vendors.override') && ['draft', 'returned'].includes(status) && !touched,
    };
}

const maskAccount = (n: string) => (n.length <= 4 ? '••••' : `${'•'.repeat(Math.min(n.length - 4, 12))}${n.slice(-4)}`);

// ----- Reading the vendor from a request -----

function email(v: unknown, at: string): string {
    const s = oneLine(v, 120).toLowerCase();
    if (s && !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) throw new HttpError(400, `${at}: enter a valid email address.`);
    return s;
}
function phone(v: unknown, at: string): string {
    const s = oneLine(v, 25);
    if (s && !/^\+?[0-9][0-9 ()-]{5,24}$/.test(s)) throw new HttpError(400, `${at}: enter a valid phone number, for example +254 700 000 000.`);
    return s;
}
function patterned(v: unknown, re: RegExp, at: string, hint: string, upper = true): string {
    const s = oneLine(v, 40);
    const t = upper ? s.toUpperCase() : s;
    if (t && !re.test(t)) throw new HttpError(400, `${at}: ${hint}`);
    return t;
}

async function readScopes(ctx: OrgContext, raw: unknown): Promise<Array<{ kind: LineKind; categoryCode: string; categoryName: string; subcategoryCode: string; subcategoryName: string }>> {
    const asked = objs(raw);
    const out: Array<{ kind: LineKind; categoryCode: string; categoryName: string; subcategoryCode: string; subcategoryName: string }> = [];
    const adoptions = new Map(await Promise.all(LINE_KINDS.map(async (k) => [k, await adopted(ctx.orgId, k)] as const)));
    for (const s of asked) {
        const kind = str(s.kind) as LineKind;
        if (!LINE_KINDS.includes(kind)) throw new HttpError(400, 'Choose Material, Service or Asset for each scope.');
        const cat = adoptions.get(kind)!.categories.find((c) => c.code === str(s.categoryCode));
        const subCode = str(s.subcategoryCode);
        const sub = subCode ? cat?.subcategories.find((x) => x.code === subCode) : undefined;
        if (!cat || (subCode && !sub)) throw new HttpError(400, `Choose only ${KIND_LABEL[kind]} categories that your organization has approved in Procurement setup.`);
        if (out.some((x) => x.kind === kind && x.categoryCode === cat.code && x.subcategoryCode === (sub?.code ?? ''))) continue;
        out.push({ kind, categoryCode: cat.code, categoryName: cat.name, subcategoryCode: sub?.code ?? '', subcategoryName: sub?.name ?? '' });
    }
    if (out.length > MAX_PER_KIND) throw new HttpError(400, `Choose at most ${MAX_PER_KIND} categories for one vendor.`);
    return out;
}

async function readVendor(ctx: OrgContext, b: Obj, m: AllMeta): Promise<Obj> {
    const legalName = oneLine(b.legalName, 120);
    if (legalName.length < 3) throw new HttpError(400, 'Enter the legal name of the vendor (at least 3 characters).');
    const legalType = pick(m.legalTypes, str(b.legalTypeCode), 'legal type');
    const cls = pick(m.classes, str(b.classCode), 'vendor class');
    const sourcing = pick(m.sourcing, str(b.sourcingCode), 'sourcing channel');
    const terms = pick(m.paymentTerms, str(b.paymentTermsCode), 'payment term');
    const inco = pick(m.incoterms, str(b.incotermCode), 'Incoterm');
    const risk = pick(m.risks, str(b.riskCode), 'risk rating');

    const website = oneLine(b.website, 200);
    if (website && !/^https?:\/\/[^\s]{3,190}$/i.test(website)) throw new HttpError(400, 'Website: start with http:// or https://.');
    let year: number | null = null;
    if (b.yearEstablished !== undefined && b.yearEstablished !== null && String(b.yearEstablished).trim() !== '') {
        year = Number(b.yearEstablished);
        if (!Number.isInteger(year) || year < 1800 || year > new Date().getUTCFullYear()) throw new HttpError(400, 'Year established: enter a year such as 2008.');
    }
    const brands = (Array.isArray(b.brands) ? (b.brands as unknown[]) : []).map((x) => oneLine(x, 60)).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
    if (brands.length > 10) throw new HttpError(400, 'List up to 10 brands or manufacturers.');
    const bank = o(b.bank);
    const conflict = str(b.conflict);
    if (conflict && !['none', 'declared'].includes(conflict)) throw new HttpError(400, 'Choose whether a conflict of interest exists.');
    const currency = oneLine(b.currencyCode, 3).toUpperCase();
    if (currency && !/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Currency: use a three letter code such as KES.');
    const known = await currencyList();
    if (currency && known.length && !known.some((c) => c.code === currency)) throw new HttpError(400, 'Choose the trading currency from the list.');

    return {
        legalName,
        tradeName: oneLine(b.tradeName, 120),
        legalTypeCode: legalType?.code ?? '',
        legalTypeLabel: legalType?.label ?? '',
        registrationNumber: patterned(b.registrationNumber, /^[A-Z0-9/.-]{3,30}$/, 'Registration number', 'use 3 to 30 letters, digits, / . or -.'),
        taxPin: patterned(b.taxPin, /^[A-Z0-9-]{5,20}$/, 'Tax PIN', 'use 5 to 20 letters, digits or -.'),
        vatNumber: patterned(b.vatNumber, /^[A-Z0-9-]{5,20}$/, 'VAT number', 'use 5 to 20 letters, digits or -.'),
        yearEstablished: year,
        website,
        classCode: cls?.code ?? '',
        classLabel: cls?.label ?? '',
        sourcingCode: sourcing?.code ?? '',
        sourcingLabel: sourcing?.label ?? '',
        sourcingJustification: cleanText(b.sourcingJustification).slice(0, 600),
        brands,
        scopes: await readScopes(ctx, b.scopes),
        contact: { name: oneLine(b.contactName, 80), title: oneLine(b.contactTitle, 80), email: email(b.contactEmail, 'Contact email'), phone: phone(b.contactPhone, 'Contact phone') },
        address: { country: oneLine(b.country, 60), city: oneLine(b.city, 60), street: oneLine(b.street, 160) },
        currencyCode: currency,
        paymentTermsCode: terms?.code ?? '',
        paymentTermsLabel: terms?.label ?? '',
        incotermCode: inco?.code ?? '',
        incotermLabel: inco?.label ?? '',
        bank: {
            bankName: oneLine(bank.bankName, 80),
            branch: oneLine(bank.branch, 80),
            accountName: oneLine(bank.accountName, 120),
            accountNumber: patterned(bank.accountNumber, /^[A-Z0-9-]{5,34}$/, 'Account number', 'use 5 to 34 letters, digits or -.'),
            swift: patterned(bank.swift, /^[A-Z0-9]{8}([A-Z0-9]{3})?$/, 'SWIFT or BIC code', 'use 8 or 11 letters and digits.'),
        },
        conflict,
        conflictNotes: cleanText(b.conflictNotes).slice(0, 600),
        sanctionsScreened: b.sanctionsScreened === true,
        riskCode: risk?.code ?? '',
        riskLabel: risk?.label ?? '',
        riskNotes: cleanText(b.riskNotes).slice(0, 600),
    };
}

const overridesOf = (d: Obj) => objs(d.overrides);
const activeOverride = (d: Obj, typeCode: string) => overridesOf(d).some((x) => str(x.typeCode) === typeCode && x.resolved !== true && str(x.expiresAt) >= today());

async function currencyList(): Promise<Array<{ code: string; name: string }>> {
    const doc = await getDoc('reference/currencies');
    return objs(doc?.data.items)
        .filter((c) => c.enabled !== false && /^[A-Z]{3}$/.test(str(c.code)))
        .map((c) => ({ code: str(c.code), name: str(c.name) }));
}

/** What still has to be completed before the vendor can be submitted. */
function gapsOf(d: Obj, m: AllMeta): string[] {
    const out: string[] = [];
    const need = (ok: boolean, what: string) => {
        if (!ok) out.push(what);
    };
    const contact = o(d.contact);
    const address = o(d.address);
    const bank = o(d.bank);
    const scopes = objs(d.scopes);
    need(!!str(d.legalTypeCode), 'Legal type');
    need(!!str(d.registrationNumber), 'Registration number');
    need(!!str(d.taxPin), 'Tax PIN');
    need(!!str(d.classCode), 'Vendor class');
    need(!!str(d.sourcingCode), 'Sourcing channel');
    const cls = m.classes.find((c) => c.code === str(d.classCode));
    const src = m.sourcing.find((c) => c.code === str(d.sourcingCode));
    if (src?.needsJustification === true) need(cleanText(d.sourcingJustification).length >= 20, `Justification for ${src.label.toLowerCase()} (at least 20 characters)`);
    if (cls?.needsAuthorisation === true) need(Array.isArray(d.brands) && (d.brands as unknown[]).length > 0, 'Brands or manufacturers represented');
    need(scopes.length > 0, 'At least one category the vendor supplies');
    need(!!str(contact.name), 'Contact person');
    need(!!str(contact.email), 'Contact email');
    need(!!str(contact.phone), 'Contact phone');
    need(!!str(address.country) && !!str(address.city), 'Country and city');
    need(!!str(d.currencyCode), 'Trading currency');
    need(!!str(d.paymentTermsCode), 'Payment terms');
    if (scopes.some((s) => str(s.kind) !== 'service')) need(!!str(d.incotermCode), 'Incoterm (for materials and assets)');
    need(!!str(bank.bankName) && !!str(bank.accountName) && !!str(bank.accountNumber), 'Bank name, account name and account number');
    need(!!str(d.riskCode), 'Risk rating');
    need(str(d.conflict) === 'none' || str(d.conflict) === 'declared', 'Conflict of interest answer');
    if (str(d.conflict) === 'declared') need(cleanText(d.conflictNotes).length >= 10, 'Details of the conflict of interest');
    need(d.sanctionsScreened === true, 'Sanctions and exclusion list screening confirmed');

    const docs = objs(d.documents);
    for (const t of m.documents) {
        const forClasses = Array.isArray(t.forClasses) ? (t.forClasses as unknown[]).map(str) : [];
        const required = t.required === true && (!forClasses.length || forClasses.includes(str(d.classCode)));
        if (required) need(docs.some((x) => str(x.typeCode) === t.code) || activeOverride(d, t.code), `Document: ${t.label}`);
    }
    for (const x of docs) if (x.expires === true && str(x.expiry) < today()) out.push(`Document expired: ${str(x.typeName)}`);
    return out;
}

async function duplicateOf(ctx: OrgContext, id: string, v: Obj): Promise<string> {
    const others = (await listDocs(vendorsPath(ctx.orgId))).filter((x) => x.id !== id && !['rejected', 'cancelled'].includes(str(x.data.status)));
    const pin = normalize(v.taxPin);
    const reg = normalize(v.registrationNumber);
    const acct = normalize(o(v.bank).accountNumber);
    for (const x of others) {
        if (pin && normalize(x.data.taxPin) === pin) return `${x.id} already uses this tax PIN.`;
        if (reg && normalize(x.data.registrationNumber) === reg) return `${x.id} already uses this registration number.`;
        if (acct && normalize(o(x.data.bank).accountNumber) === acct) return `${x.id} already uses this bank account. A shared account needs review by the vendor approver.`;
    }
    return '';
}

// ----- Writes -----

async function lock<T>(ctx: OrgContext, id: string, fn: () => Promise<T>): Promise<T> {
    const path = `organizations/${ctx.orgId}/procurement_vendor_locks/${id}`;
    if (!(await writeDoc(path, { by: ctx.uid, at: nowIso() }, { exists: false }))) throw new HttpError(409, 'This vendor is being updated by someone else. Try again in a moment.');
    try {
        return await fn();
    } finally {
        await deleteDoc(path);
    }
}

async function load(ctx: OrgContext, id: string): Promise<Doc> {
    requireView(ctx);
    if (!ID.test(id)) throw new HttpError(404, 'Vendor not found.');
    const doc = await getDoc(`${vendorsPath(ctx.orgId)}/${id}`);
    if (!doc || !visible(ctx, doc.data)) throw new HttpError(404, 'Vendor not found.');
    return doc;
}

interface Change {
    patch: Obj;
    label: string;
    event?: string;
    note?: string;
}

/** One change to a vendor under a lock, re-checked against the current state, added to the history and audited. */
async function change(ctx: OrgContext, id: string, action: string, allowed: (f: ReturnType<typeof flags>, d: Obj) => boolean, deny: string, run: (d: Obj) => Promise<Change>) {
    await load(ctx, id);
    return lock(ctx, id, async () => {
        const path = `${vendorsPath(ctx.orgId)}/${id}`;
        const fresh = await getDoc(path);
        if (!fresh) throw new HttpError(404, 'Vendor not found.');
        const d = fresh.data;
        if (!allowed(flags(ctx, d), d)) throw new HttpError(403, deny);
        const c = await run(d);
        const at = nowIso();
        const next: Obj = { ...d, ...c.patch, updatedAt: at, version: (Number(d.version) || 1) + 1 };
        if (c.event) next.history = [...history(d), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: c.event, note: c.note ?? '', from: str(d.status), to: str(next.status) }];
        const editors = editorsOf(d);
        if (['save', 'document.add', 'document.remove', 'submit', 'reopen'].includes(action) && !editors.includes(ctx.uid)) next.editors = [...editors, ctx.uid].slice(-EDITORS_MAX);
        await writeDoc(path, next);
        await record(ctx, `org.procurement.vendor.${action}`, id, `${c.label}${c.note ? `. ${c.note}` : ''}`.slice(0, 400));
        return { ok: true, id, status: str(next.status), version: Number(next.version) };
    });
}

function row(d: Obj, id: string) {
    const scopes = objs(d.scopes);
    const docs = objs(d.documents);
    return {
        id,
        number: str(d.number) || id,
        legalName: str(d.legalName),
        tradeName: str(d.tradeName),
        status: str(d.status),
        statusLabel: STATUS_LABEL[str(d.status)] ?? str(d.status),
        classLabel: str(d.classLabel),
        sourcingLabel: str(d.sourcingLabel),
        riskLabel: str(d.riskLabel),
        kinds: LINE_KINDS.filter((k) => scopes.some((s) => str(s.kind) === k)).map((k) => KIND_LABEL[k]).join(', '),
        scopeCount: scopes.length,
        country: str(o(d.address).country),
        taxPin: str(d.taxPin),
        documentCount: docs.length,
        expiringDocs: docs.filter((x) => x.expires === true && str(x.expiry) !== '' && str(x.expiry) < new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)).length,
        createdByName: str(d.createdByName),
        updatedAt: str(d.updatedAt),
        createdAt: str(d.createdAt),
    };
}

const STAGES = [
    { key: 'open', label: 'Open' },
    { key: 'sent', label: 'Sent to supplier, not delivered' },
    { key: 'partial', label: 'Delivered partially' },
    { key: 'full', label: 'Delivered in full' },
];
interface Tot {
    count: number;
    value: number;
    paid: number;
    pending: number;
}
const blank = (): Tot => ({ count: 0, value: 0, paid: 0, pending: 0 });
const tally = (t: Tot, value: number, paid: number) => {
    t.count += 1;
    t.value += value;
    t.paid += paid;
    t.pending += Math.max(0, value - paid);
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const fin = (t: Tot): Tot => ({ count: t.count, value: r2(t.value), paid: r2(t.paid), pending: r2(t.pending) });

const reasonOf = (b: Obj) => {
    const r = str(b.reason).trim();
    if (r.length < 10 || r.length > 300) throw new HttpError(400, 'Give a reason of 10 to 300 characters.');
    return r;
};

export const vendorRoutes = {
    // Lists for the registration form, the adopted subcategories each kind can use, and what the person may do.
    'POST /api/org/procurement/vendors/options': [
        orgRoute('org.procurement.vendors.options', null, async (ctx) => {
            requireView(ctx);
            // The shipped lists are copied into the database the first time they are needed, so MEMS administration can maintain them.
            try {
                await seedModuleMetadata('PRC');
            } catch {
                /* the shipped defaults still apply */
            }
            const [m, kinds] = await Promise.all([allMeta(), Promise.all(LINE_KINDS.map(async (k) => ({ kind: k, label: KIND_LABEL[k], categories: (await adopted(ctx.orgId, k)).categories })))]);
            return {
                meta: m,
                kinds,
                maxPerKind: MAX_PER_KIND,
                currency: str(ctx.org.data.currencyCode),
                currencies: await currencyList(),
                can: { manage: can(ctx, 'PRC.vendors.manage'), approve: can(ctx, 'PRC.vendors.approve'), override: can(ctx, 'PRC.vendors.override'), sla: can(ctx, 'PRC.vendors.sla') },
                limits: { documents: MAX_DOCS, fileKb: 450 },
            };
        }),
    ],

    'POST /api/org/procurement/vendors/list': [
        orgRoute('org.procurement.vendors.list', null, async (ctx) => {
            requireView(ctx);
            const docs = (await listDocs(vendorsPath(ctx.orgId))).filter((v) => visible(ctx, v.data));
            const approve = can(ctx, 'PRC.vendors.approve');
            const views: Record<string, Doc[]> = {
                approved: docs.filter((v) => ['approved', 'suspended'].includes(str(v.data.status))),
                mine: docs.filter((v) => str(v.data.createdBy) === ctx.uid && str(v.data.status) !== 'cancelled'),
                approvals: approve ? docs.filter((v) => str(v.data.status) === 'pending_approval' && flags(ctx, v.data).decide) : [],
                all: docs,
            };
            const view = str(ctx.body.view) || 'approved';
            if (!(view in views)) throw new HttpError(400, 'Choose a view.');
            return {
                rows: views[view].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 2000).map((v) => row(v.data, v.id)),
                counts: Object.fromEntries(Object.entries(views).map(([k, v]) => [k, v.length])),
            };
        }),
    ],

    'POST /api/org/procurement/vendors/get': [
        orgRoute('org.procurement.vendors.get', null, async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const d = doc.data;
            const f = flags(ctx, d);
            const bank = o(d.bank);
            const m = await allMeta();
            return {
                ...row(d, doc.id),
                legalTypeLabel: str(d.legalTypeLabel),
                registrationNumber: str(d.registrationNumber),
                vatNumber: str(d.vatNumber),
                yearEstablished: d.yearEstablished ?? null,
                website: str(d.website),
                classCode: str(d.classCode),
                legalTypeCode: str(d.legalTypeCode),
                sourcingCode: str(d.sourcingCode),
                sourcingJustification: str(d.sourcingJustification),
                brands: Array.isArray(d.brands) ? d.brands : [],
                scopes: objs(d.scopes),
                contact: o(d.contact),
                address: o(d.address),
                currencyCode: str(d.currencyCode),
                paymentTermsCode: str(d.paymentTermsCode),
                paymentTermsLabel: str(d.paymentTermsLabel),
                incotermCode: str(d.incotermCode),
                incotermLabel: str(d.incotermLabel),
                bank: { bankName: str(bank.bankName), branch: str(bank.branch), accountName: str(bank.accountName), accountNumber: f.seeBank ? str(bank.accountNumber) : maskAccount(str(bank.accountNumber)), swift: str(bank.swift) },
                conflict: str(d.conflict),
                conflictNotes: str(d.conflictNotes),
                srmScore: typeof d.srmScore === 'number' ? d.srmScore : null,
                srmAt: str(d.srmAt),
                srmNote: str(d.srmNote),
                slas: objs(d.slas).map((x) => ({
                    id: str(x.id),
                    ref: str(x.ref),
                    title: str(x.title),
                    validFrom: str(x.validFrom),
                    validTo: str(x.validTo),
                    status: str(x.status) === 'ended' ? 'ended' : str(x.validTo) && str(x.validTo) < today() ? 'expired' : 'active',
                    categoryKeys: Array.isArray(x.categoryKeys) ? (x.categoryKeys as unknown[]).map(str) : [],
                    maxLeadTimeDays: Number(x.maxLeadTimeDays) || 0,
                    minWarrantyMonths: Number(x.minWarrantyMonths) || 0,
                    paymentTermsCode: str(x.paymentTermsCode),
                    paymentTermsLabel: str(x.paymentTermsLabel),
                    notes: str(x.notes),
                    byName: str(x.byName),
                    at: str(x.at),
                    endedAt: str(x.endedAt),
                    endReason: str(x.endReason),
                })),
                canSla: can(ctx, 'PRC.vendors.sla') && ['approved', 'suspended'].includes(str(d.status)),
                canSrm: can(ctx, 'PRC.vendors.manage') && str(d.status) === 'approved',
                sanctionsScreened: d.sanctionsScreened === true,
                riskCode: str(d.riskCode),
                riskNotes: str(d.riskNotes),
                documents: objs(d.documents).map((x) => ({ id: str(x.id), typeCode: str(x.typeCode), typeName: str(x.typeName), number: str(x.number), expiry: str(x.expiry), expires: x.expires === true, name: str(x.name), type: str(x.type), size: Number(x.size) || 0, uploadedAt: str(x.uploadedAt), uploadedBy: str(x.uploadedBy) })),
                history: history(d).map((h) => ({ at: str(h.at), byName: str(h.byName), action: str(h.action), note: str(h.note), from: str(h.from), to: str(h.to) })),
                overrides: overridesOf(d).map((x) => ({ typeCode: str(x.typeCode), typeName: str(x.typeName), reason: str(x.reason), byName: str(x.byName), at: str(x.at), expiresAt: str(x.expiresAt), resolved: x.resolved === true, active: x.resolved !== true && str(x.expiresAt) >= today() })),
                missingDocs: f.override
                    ? m.documents
                          .filter((t) => {
                              const fc = Array.isArray(t.forClasses) ? (t.forClasses as unknown[]).map(str) : [];
                              return t.required === true && (!fc.length || fc.includes(str(d.classCode))) && !objs(d.documents).some((x) => str(x.typeCode) === t.code) && !activeOverride(d, t.code);
                          })
                          .map((t) => ({ code: t.code, label: t.label }))
                    : [],
                returnReason: ['returned', 'rejected'].includes(str(d.status)) ? str(d.returnReason) : '',
                suspendReason: str(d.status) === 'suspended' ? str(d.suspendReason) : '',
                gaps: f.edit ? gapsOf(d, m) : [],
                version: Number(d.version) || 1,
                can: f,
                mine: str(d.createdBy) === ctx.uid,
            };
        }),
    ],

    // Creates a draft (VND number allocated now) or saves changes to an editable vendor.
    'POST /api/org/procurement/vendors/save': [
        orgRoute('org.procurement.vendors.save', 'PRC.vendors.manage', async (ctx) => {
            requireProcurement(ctx);
            const m = await allMeta();
            const v = await readVendor(ctx, ctx.body, m);
            const id = str(ctx.body.id);
            if (!id) {
                const mine = (await listDocs(vendorsPath(ctx.orgId))).filter((x) => str(x.data.createdBy) === ctx.uid && str(x.data.status) === 'draft');
                if (mine.length >= MAX_DRAFTS) throw new HttpError(409, `You already have ${MAX_DRAFTS} draft vendors. Submit or discard some first.`);
                const clash = await duplicateOf(ctx, '', v);
                if (clash) throw new HttpError(409, clash);
                const n = await nextOrgCounter(ctx.orgId, 'vendorSeq');
                if (n > 999_999) throw new HttpError(500, 'The vendor number range is exhausted.');
                const newId = `VND${String(n).padStart(6, '0')}`;
                const at = nowIso();
                const data: Obj = {
                    ...v,
                    number: newId,
                    status: 'draft',
                    createdBy: ctx.uid,
                    createdByName: nameOfUser(ctx.me),
                    editors: [ctx.uid],
                    documents: [],
                    documentSeq: 0,
                    history: [{ at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'drafted', note: '', from: '', to: 'draft' }],
                    createdAt: at,
                    updatedAt: at,
                    version: 1,
                };
                if (!(await writeDoc(`${vendorsPath(ctx.orgId)}/${newId}`, data, { exists: false }))) throw new HttpError(409, 'That vendor number is already in use. Please try again.');
                await record(ctx, 'org.procurement.vendor.draft', newId, str(v.legalName));
                return { ok: true, id: newId };
            }
            const clash = await duplicateOf(ctx, id, v);
            if (clash) throw new HttpError(409, clash);
            return change(ctx, id, 'save', (f) => f.edit, 'You cannot change this vendor in its current status.', async (d) => {
                const sensitive: string[] = [];
                if (str(d.status) === 'returned') {
                    if (str(d.legalName) !== str(v.legalName)) sensitive.push('legal name');
                    if (str(d.taxPin) !== str(v.taxPin)) sensitive.push('tax PIN');
                    if (JSON.stringify(o(d.bank)) !== JSON.stringify(o(v.bank))) sensitive.push('bank details');
                    if (str(d.classCode) !== str(v.classCode) || str(d.sourcingCode) !== str(v.sourcingCode)) sensitive.push('class or sourcing channel');
                }
                return {
                    patch: v,
                    label: 'Vendor details saved',
                    event: sensitive.length ? 'edited' : undefined,
                    note: sensitive.length ? `Changed ${sensitive.join(', ')}` : undefined,
                };
            });
        }),
    ],

    'POST /api/org/procurement/vendors/document/add': [
        orgRoute('org.procurement.vendors.document.add', 'PRC.vendors.manage', async (ctx) => {
            const type = str(ctx.body.type);
            const data = str(ctx.body.data);
            if (!FILE_TYPES.includes(type) || !data.startsWith(`data:${type};base64,`) || !/^data:(application\/pdf|image\/jpeg|image\/png);base64,[A-Za-z0-9+/=]+$/.test(data) || data.length > MAX_FILE_CHARS)
                throw new HttpError(400, 'Documents must be PDF, JPEG or PNG files of up to 450 KB each.');
            const meta = (await metaList('vendorDocumentTypes')).find((x) => x.code === str(ctx.body.typeCode));
            if (!meta) throw new HttpError(400, 'Choose the document type.');
            const expires = meta.expires === true;
            const expiry = str(ctx.body.expiry);
            if (expires && (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(Date.parse(`${expiry}T00:00:00Z`)))) throw new HttpError(400, 'Enter the expiry date of the document.');
            if (expires && expiry < today()) throw new HttpError(400, 'That document has already expired. Attach a current one.');
            const name = str(ctx.body.name).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 120) || 'document';
            const number = oneLine(ctx.body.number, 40);
            const id = str(ctx.body.id);
            return change(ctx, id, 'document.add', (f) => f.edit, 'You cannot attach documents to this vendor now.', async (d) => {
                const kept = objs(d.documents);
                if (kept.length >= MAX_DOCS) throw new HttpError(400, `Attach up to ${MAX_DOCS} documents.`);
                const seq = (Number(d.documentSeq) || 0) + 1;
                const docId = `${id}_${seq}`;
                const at = nowIso();
                await writeDoc(`${vendorsPath(ctx.orgId)}/${id}/documents/${docId}`, { name, type, data, uploadedBy: ctx.uid, uploadedAt: at }, { exists: false });
                const entry = { id: docId, typeCode: meta.code, typeName: meta.label, number, expiry: expires ? expiry : '', expires, name, type, size: Math.round((data.length * 3) / 4), uploadedAt: at, uploadedBy: nameOfUser(ctx.me) };
                return { patch: { documents: [...kept, entry], documentSeq: seq, overrides: overridesOf(d).map((x) => (str(x.typeCode) === meta.code && x.resolved !== true ? { ...x, resolved: true, resolvedAt: at } : x)) }, label: 'Document attached', note: `${meta.label}: ${name}` };
            });
        }),
    ],

    // A temporary, time-limited waiver of a required document that cannot be uploaded. Separate permission, written reason, audited.
    'POST /api/org/procurement/vendors/document/override': [
        orgRoute('org.procurement.vendors.document.override', 'PRC.vendors.override', async (ctx) => {
            const m = await allMeta();
            const id = str(ctx.body.id);
            const type = m.documents.find((x) => x.code === str(ctx.body.typeCode));
            if (!type) throw new HttpError(400, 'Choose the document type.');
            const reason = cleanText(ctx.body.reason);
            if (reason.length < 20 || reason.length > 300) throw new HttpError(400, 'Give the reason the document cannot be uploaded (20 to 300 characters).');
            if (ctx.body.confirm !== true) throw new HttpError(400, 'Confirm that you accept responsibility for this override.');
            return change(ctx, id, 'document.override', (f) => f.override, 'You cannot grant an override on this vendor. It must be a draft or returned vendor that you did not create or edit.', async (d) => {
                if (objs(d.documents).some((x) => str(x.typeCode) === type.code)) throw new HttpError(409, 'That document is already attached.');
                if (activeOverride(d, type.code)) throw new HttpError(409, 'That document already has an open override.');
                if (overridesOf(d).length >= 20) throw new HttpError(409, 'This vendor has reached the limit of overrides.');
                const at = nowIso();
                const expiresAt = new Date(Date.now() + OVERRIDE_DAYS * 86_400_000).toISOString().slice(0, 10);
                const entry = { typeCode: type.code, typeName: type.label, reason, at, by: ctx.uid, byName: nameOfUser(ctx.me), expiresAt, resolved: false };
                return { patch: { overrides: [...overridesOf(d), entry] }, event: 'document override', label: 'Temporary document override granted', note: `${type.label} until ${expiresAt}: ${reason}` };
            });
        }),
    ],

    // Purchase orders raised against this vendor, by stage and by period, with what has been paid and what is pending.
    'POST /api/org/procurement/vendors/orders': [
        orgRoute('org.procurement.vendors.orders', null, async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const currency = str(ctx.org.data.currencyCode);
            const allowed = can(ctx, 'PRC.po.view') || can(ctx, 'PRC.po.manage') || can(ctx, 'PRC.po.approve');
            const none = { allowed, currency, totals: fin(blank()), stages: STAGES.map((s) => ({ ...s, ...fin(blank()) })), years: [] as string[], byYear: [] as unknown[], byMonth: [] as unknown[], orders: [] as unknown[] };
            if (!allowed) return none;
            const pos = (await listDocs(`organizations/${ctx.orgId}/procurement_orders`)).filter((p) => str(p.data.vendorId) === doc.id && STAGES.some((s) => s.key === str(p.data.status)));
            await record(ctx, 'org.procurement.vendor.orders.view', doc.id, `${pos.length} order(s)`);
            const total = blank();
            const stages = new Map(STAGES.map((s) => [s.key, blank()]));
            const years = new Map<string, Tot>();
            const months = new Map<string, Tot>();
            const rows = pos.map((p) => {
                const value = Number(p.data.baseTotal) || 0;
                const paid = Math.min(value, Number(p.data.paid) || 0);
                const date = (str(p.data.approvedAt) || str(p.data.createdAt)).slice(0, 10);
                tally(total, value, paid);
                tally(stages.get(str(p.data.status))!, value, paid);
                if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                    for (const [map, key] of [[years, date.slice(0, 4)], [months, date.slice(0, 7)]] as const) {
                        if (!map.has(key)) map.set(key, blank());
                        tally(map.get(key)!, value, paid);
                    }
                }
                return { id: p.id, number: str(p.data.number) || p.id, status: str(p.data.status), statusLabel: STAGES.find((s) => s.key === str(p.data.status))?.label ?? '', date, total: Number(p.data.total) || 0, currency: str(p.data.currency) || currency, base: r2(value), paid: r2(paid), pending: r2(Math.max(0, value - paid)) };
            });
            return {
                allowed,
                currency,
                totals: fin(total),
                stages: STAGES.map((s) => ({ ...s, ...fin(stages.get(s.key)!) })),
                years: [...years.keys()].sort().reverse(),
                byYear: [...years.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, t]) => ({ key, ...fin(t) })),
                byMonth: [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, t]) => ({ key, ...fin(t) })),
                orders: rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 2000),
            };
        }),
    ],

    // Service level agreements with an approved supplier. The purchase order validation compares each order with these.
    'POST /api/org/procurement/vendors/sla/add': [
        orgRoute('org.procurement.vendors.sla.add', 'PRC.vendors.sla', async (ctx) => {
            const id = str(ctx.body.id);
            const m = await allMeta();
            const title = oneLine(ctx.body.title, 120);
            if (title.length < 3) throw new HttpError(400, 'Give the agreement a title (at least 3 characters).');
            const ref = oneLine(ctx.body.ref, 40);
            const validFrom = str(ctx.body.validFrom);
            const validTo = str(ctx.body.validTo);
            const okDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
            if (!okDate(validFrom) || !okDate(validTo)) throw new HttpError(400, 'Enter the start and end dates of the agreement.');
            if (validTo < validFrom) throw new HttpError(400, 'The agreement cannot end before it starts.');
            if (validTo < today()) throw new HttpError(400, 'That agreement has already ended.');
            const maxLead = ctx.body.maxLeadTimeDays === '' || ctx.body.maxLeadTimeDays == null ? 0 : Number(ctx.body.maxLeadTimeDays);
            const minWarranty = ctx.body.minWarrantyMonths === '' || ctx.body.minWarrantyMonths == null ? 0 : Number(ctx.body.minWarrantyMonths);
            if (!Number.isInteger(maxLead) || maxLead < 0 || maxLead > 730) throw new HttpError(400, 'The longest lead time is a whole number of days up to 730.');
            if (!Number.isInteger(minWarranty) || minWarranty < 0 || minWarranty > 240) throw new HttpError(400, 'The shortest warranty is a whole number of months up to 240.');
            const terms = str(ctx.body.paymentTermsCode) ? m.paymentTerms.find((t) => t.code === str(ctx.body.paymentTermsCode)) : undefined;
            if (str(ctx.body.paymentTermsCode) && !terms) throw new HttpError(400, 'Choose payment terms from the list.');
            if (!maxLead && !minWarranty && !terms) throw new HttpError(400, 'Agree at least one measurable term: longest lead time, shortest warranty or payment terms.');
            const keys = Array.isArray(ctx.body.categoryKeys) ? (ctx.body.categoryKeys as unknown[]).map(str) : [];
            if (keys.length > 10) throw new HttpError(400, 'Choose up to 10 categories.');
            const notes = cleanText(ctx.body.notes).slice(0, 400);
            return change(ctx, id, 'sla.add', () => can(ctx, 'PRC.vendors.sla'), 'You cannot add an agreement for this vendor.', async (d) => {
                if (!['approved', 'suspended'].includes(str(d.status))) throw new HttpError(409, 'Agreements are recorded for approved suppliers.');
                const supplied = new Set(objs(d.scopes).map((s) => `${str(s.kind)}|${str(s.categoryCode)}`));
                if (keys.some((k) => !supplied.has(k))) throw new HttpError(400, 'An agreement can only cover categories the supplier is approved for.');
                const list = objs(d.slas);
                if (list.length >= 40) throw new HttpError(400, 'This supplier has reached the limit of 40 agreements.');
                const seq = (Number(d.slaSeq) || 0) + 1;
                const at = nowIso();
                const entry = { id: `SLA${String(seq).padStart(3, '0')}`, ref, title, validFrom, validTo, categoryKeys: keys, maxLeadTimeDays: maxLead, minWarrantyMonths: minWarranty, paymentTermsCode: terms?.code ?? '', paymentTermsLabel: terms?.label ?? '', notes, status: 'active', by: ctx.uid, byName: nameOfUser(ctx.me), at };
                return { patch: { slas: [...list, entry], slaSeq: seq }, event: 'service level agreement added', label: 'Service level agreement added', note: `${entry.id} ${title}, ${validFrom} to ${validTo}` };
            });
        }),
    ],

    'POST /api/org/procurement/vendors/sla/end': [
        orgRoute('org.procurement.vendors.sla.end', 'PRC.vendors.sla', async (ctx) => {
            const id = str(ctx.body.id);
            const slaId = str(ctx.body.slaId);
            const reason = reasonOf(ctx.body);
            return change(ctx, id, 'sla.end', () => can(ctx, 'PRC.vendors.sla'), 'You cannot end agreements for this vendor.', async (d) => {
                const found = objs(d.slas).find((x) => str(x.id) === slaId);
                if (!found) throw new HttpError(404, 'Agreement not found.');
                if (str(found.status) === 'ended') throw new HttpError(409, 'That agreement has already ended.');
                const at = nowIso();
                return { patch: { slas: objs(d.slas).map((x) => (str(x.id) === slaId ? { ...x, status: 'ended', endedAt: at, endedBy: ctx.uid, endReason: reason } : x)) }, event: 'service level agreement ended', label: 'Service level agreement ended', note: `${slaId}: ${reason}` };
            });
        }),
    ],

    'POST /api/org/procurement/vendors/document/remove': [
        orgRoute('org.procurement.vendors.document.remove', 'PRC.vendors.manage', async (ctx) => {
            const id = str(ctx.body.id);
            return change(ctx, id, 'document.remove', (f) => f.edit, 'You cannot remove documents from this vendor now.', async (d) => {
                const docId = str(ctx.body.docId);
                const found = objs(d.documents).find((x) => str(x.id) === docId);
                if (!found) throw new HttpError(404, 'Document not found.');
                await deleteDoc(`${vendorsPath(ctx.orgId)}/${id}/documents/${docId}`);
                return { patch: { documents: objs(d.documents).filter((x) => str(x.id) !== docId) }, label: 'Document removed', note: `${str(found.typeName)}: ${str(found.name)}` };
            });
        }),
    ],

    'POST /api/org/procurement/vendors/document': [
        orgRoute('org.procurement.vendors.document', null, async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const docId = str(ctx.body.docId);
            if (!objs(doc.data.documents).some((x) => str(x.id) === docId)) throw new HttpError(404, 'Document not found.');
            const file = await getDoc(`${vendorsPath(ctx.orgId)}/${doc.id}/documents/${docId}`);
            if (!file) throw new HttpError(404, 'Document not found.');
            await record(ctx, 'org.procurement.vendor.document.view', doc.id, str(file.data.name));
            return { name: str(file.data.name), type: str(file.data.type), data: str(file.data.data) };
        }),
    ],

    'POST /api/org/procurement/vendors/submit': [
        orgRoute('org.procurement.vendors.submit', 'PRC.vendors.manage', async (ctx) => {
            if (ctx.body.accuracy !== true) throw new HttpError(400, 'Confirm that the information is accurate and the documents are genuine.');
            const m = await allMeta();
            const id = str(ctx.body.id);
            return change(ctx, id, 'submit', (f) => f.submit, 'You cannot submit this vendor.', async (d) => {
                const gaps = gapsOf(d, m);
                if (gaps.length) throw new HttpError(400, `Complete these first: ${gaps.slice(0, 6).join('; ')}${gaps.length > 6 ? ` and ${gaps.length - 6} more` : ''}.`);
                const clash = await duplicateOf(ctx, id, d);
                if (clash) throw new HttpError(409, clash);
                return { patch: { status: 'pending_approval', submittedAt: nowIso(), submittedBy: ctx.uid, returnReason: '' }, event: str(d.status) === 'draft' ? 'submitted' : 'resubmitted', label: 'Submitted for approval' };
            });
        }),
    ],

    'POST /api/org/procurement/vendors/discard': [
        orgRoute('org.procurement.vendors.discard', 'PRC.vendors.manage', async (ctx) => {
            const id = str(ctx.body.id);
            return change(ctx, id, 'discard', (f) => f.discard, 'Only the creator can discard a draft vendor.', async (d) => {
                for (const x of objs(d.documents)) await deleteDoc(`${vendorsPath(ctx.orgId)}/${id}/documents/${str(x.id)}`);
                return { patch: { status: 'cancelled', documents: [], returnReason: 'Draft discarded' }, event: 'discarded', label: 'Draft discarded' };
            });
        }),
    ],

    'POST /api/org/procurement/vendors/approve': [
        orgRoute('org.procurement.vendors.approve', 'PRC.vendors.approve', async (ctx) => {
            const m = await allMeta();
            const id = str(ctx.body.id);
            const note = oneLine(ctx.body.note, 300);
            return change(ctx, id, 'approve', (f) => f.decide, 'You cannot approve this vendor. Someone who did not create or edit it must approve it.', async (d) => {
                const gaps = gapsOf(d, m).filter((g) => g.startsWith('Document expired') || g.startsWith('Document:'));
                if (gaps.length) throw new HttpError(409, `${gaps.join('; ')}. Return the vendor for a current document.`);
                if (overridesOf(d).some((x) => x.resolved !== true) && ctx.body.acknowledgeOverrides !== true) throw new HttpError(409, 'This vendor has a temporary document override. Confirm that you accept it.');
                return { patch: { status: 'approved', approvedAt: nowIso(), approvedBy: ctx.uid, approvedByName: nameOfUser(ctx.me), returnReason: '' }, event: 'approved', label: 'Vendor approved', note };
            });
        }),
    ],

    'POST /api/org/procurement/vendors/return': [
        orgRoute('org.procurement.vendors.return', 'PRC.vendors.approve', async (ctx) => {
            const reason = reasonOf(ctx.body);
            return change(ctx, str(ctx.body.id), 'return', (f) => f.decide, 'You cannot return this vendor.', async () => ({ patch: { status: 'returned', returnReason: reason }, event: 'returned', label: 'Vendor returned for correction', note: reason }));
        }),
    ],

    'POST /api/org/procurement/vendors/reject': [
        orgRoute('org.procurement.vendors.reject', 'PRC.vendors.approve', async (ctx) => {
            const reason = reasonOf(ctx.body);
            return change(ctx, str(ctx.body.id), 'reject', (f) => f.decide, 'You cannot reject this vendor.', async () => ({ patch: { status: 'rejected', returnReason: reason }, event: 'rejected', label: 'Vendor rejected', note: reason }));
        }),
    ],

    'POST /api/org/procurement/vendors/suspend': [
        orgRoute('org.procurement.vendors.suspend', 'PRC.vendors.approve', async (ctx) => {
            const reason = reasonOf(ctx.body);
            return change(ctx, str(ctx.body.id), 'suspend', (f) => f.suspend, 'You cannot suspend this vendor.', async () => ({ patch: { status: 'suspended', suspendReason: reason }, event: 'suspended', label: 'Vendor suspended', note: reason }));
        }),
    ],

    'POST /api/org/procurement/vendors/reinstate': [
        orgRoute('org.procurement.vendors.reinstate', 'PRC.vendors.approve', async (ctx) => {
            const reason = reasonOf(ctx.body);
            return change(ctx, str(ctx.body.id), 'reinstate', (f) => f.reinstate, 'You cannot reinstate this vendor.', async () => ({ patch: { status: 'approved', suspendReason: '' }, event: 'reinstated', label: 'Vendor reinstated', note: reason }));
        }),
    ],

    // Changing an approved vendor is a controlled step: it returns to approval and cannot be used until approved again.
    'POST /api/org/procurement/vendors/reopen': [
        orgRoute('org.procurement.vendors.reopen', 'PRC.vendors.manage', async (ctx) => {
            const reason = reasonOf(ctx.body);
            return change(ctx, str(ctx.body.id), 'reopen', (f) => f.reopen, 'You cannot reopen this vendor.', async () => ({
                patch: { status: 'returned', returnReason: `Reopened for change: ${reason}`, suspendReason: '' },
                event: 'reopened',
                label: 'Vendor reopened for change. It cannot be used until approved again',
                note: reason,
            }));
        }),
    ],
};
