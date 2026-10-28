import { HttpError, deleteDoc, getDoc, isObj, listDocs, nowIso, str, writeDoc, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { bypass } from './testModeCore';
import { record } from './org';
import { nextOrgCounter } from './positions';
import { KIND_LABEL, LINE_KINDS, can, requireProcurement, requirementsPath, type LineKind } from './procurementSetup';
import { METHODS, describeApproval, getAuthority, resolveAuthority } from './procurementPolicy';
import { covers, deskScope, inScope, lineKeyOf, ownersOf, type DeskScope } from './buyerGroups';
import { metaList, vendorsPath } from './vendors';
import { lastPricesFor } from './purchaseOrders';

// ---------------------------------------------------------------------------
// Quotations (QTN + 9 digits): procurement works an acknowledged purchase requirement towards an award.
//
//   organizations/{org}/procurement_quotations/{QTN000000001}              the case: items, review, invited vendors, quotes, sign-offs
//   organizations/{org}/procurement_quotations/{id}/files/{fileId}         one quote document each (PDF, JPEG, PNG, 450 KB)
//   organizations/{org}/procurement_setup/evaluation                       the evaluation metrics (weights, class order), versioned
//
// 1. Review: procurement reviews the items and decides the mode of procurement (direct, single source, RFQ, RFP, RFT,
//    open tender), or records that it is still being researched or consulted on. The chart of authority suggests the
//    method, the quotes needed and the evaluators from the estimated value. Choosing less competition than the chart
//    asks for needs a written reason.
// 2. Invite vendors (approved vendors), record each quote by item, attach the vendor's document.
// 3. Evaluate: the technical team gives its preference, evaluators sign off, and the quotes are scored with the
//    configured metrics. A metric with no data for a quote is skipped or counted as zero, as configured (SRM: skipped).
// 4. Recommend the winning quote. The chart of authority then shows who must approve the spend.
//
// Buyer groups decide who sees and works a case. Everything is audited.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const ID = /^QTN\d{9}$/;
const MAX_INVITES = 15;
const MAX_FILES_PER_QUOTE = 5;
const MAX_FILE_CHARS = 620_000;
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const OPEN = ['reviewing', 'researching', 'consulting', 'sourcing', 'recommended'];

const STATUS_LABEL: Record<string, string> = {
    reviewing: 'Under review',
    researching: 'Researching the best method',
    consulting: 'Consulting on the best method',
    sourcing: 'Sourcing: quotes being collected',
    recommended: 'Recommended',
    cancelled: 'Cancelled',
};
/** How competitive a method is. Choosing a lower number than the chart of authority asks for needs a reason. */
const COMPETITION: Record<string, number> = { direct: 0, single_source: 0, rfq: 1, rfp: 1, rft: 2, open_tender: 3 };

const casesPath = (orgId: string) => `organizations/${orgId}/procurement_quotations`;
const evalPath = (orgId: string) => `organizations/${orgId}/procurement_setup/evaluation`;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const o = (v: unknown): Obj => (isObj(v) ? v : {});
const today = () => new Date().toISOString().slice(0, 10);
const nameOfUser = (u: Doc | null | undefined) => (u ? [str(u.data.firstName), str(u.data.lastName)].filter(Boolean).join(' ') || str(u.data.email) : '');
const cleanText = (v: unknown) => str(v).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
const oneLine = (v: unknown, max: number) => cleanText(v).replace(/\s+/g, ' ').slice(0, max);
const num = (v: unknown): number | null => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : NaN;
};
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const reasonOf = (b: Obj, min = 10) => {
    const r = cleanText(b.reason);
    if (r.length < min || r.length > 400) throw new HttpError(400, `Give a reason of ${min} to 400 characters.`);
    return r;
};

// ----- Evaluation metrics -----

interface Criterion {
    code: string;
    label: string;
    note: string;
    enabled: boolean;
    weight: number;
    /** What happens when a quote has no data for the metric: leave it out of that quote's score, or count it as zero. */
    whenMissing: 'skip' | 'zero';
}
export interface EvalConfig {
    criteria: Criterion[];
    classOrder: string[];
    version: number;
    updatedAt: string;
    updatedBy: string;
}
const DEFAULT_CRITERIA: Criterion[] = [
    { code: 'price', label: 'Price', note: 'Net total of the quote after discounts. The lowest price scores 100.', enabled: true, weight: 40, whenMissing: 'zero' },
    { code: 'technical', label: 'Technical team preference', note: 'The technical team marks a quote preferred (100), acceptable (60) or not acceptable (excluded).', enabled: true, weight: 20, whenMissing: 'skip' },
    { code: 'vendorClass', label: 'Vendor class', note: 'Higher in the class order scores higher: OEM first, then OCM, then the rest. Not used when every item is a service.', enabled: true, weight: 10, whenMissing: 'zero' },
    { code: 'warranty', label: 'Warranty', note: 'Months of warranty offered. The longest scores 100.', enabled: true, weight: 10, whenMissing: 'zero' },
    { code: 'leadTime', label: 'Lead time', note: 'Days to deliver. The shortest scores 100.', enabled: true, weight: 10, whenMissing: 'zero' },
    { code: 'discount', label: 'Discount rate', note: 'Overall discount offered. The highest scores 100.', enabled: true, weight: 5, whenMissing: 'zero' },
    { code: 'srm', label: 'Last SRM score', note: 'The vendor\'s last supplier relationship score (0 to 100). A vendor with no score is not scored on this.', enabled: true, weight: 5, whenMissing: 'skip' },
];
/** OEM, OCM, authorised distributor, manufacturer, importer, stockist, general supplier, then the service classes. */
const DEFAULT_CLASS_ORDER = ['VCL-001', 'VCL-002', 'VCL-003', 'VCL-004', 'VCL-009', 'VCL-006', 'VCL-005', 'VCL-007', 'VCL-008'];

export async function evaluationConfig(orgId: string): Promise<EvalConfig> {
    const doc = await getDoc(evalPath(orgId));
    if (!doc) return { criteria: DEFAULT_CRITERIA, classOrder: DEFAULT_CLASS_ORDER, version: 0, updatedAt: '', updatedBy: '' };
    const saved = new Map(objs(doc.data.criteria).map((c): [string, Obj] => [str(c.code), c]));
    const criteria = DEFAULT_CRITERIA.map((d): Criterion => {
        const s = saved.get(d.code);
        return s ? { ...d, enabled: s.enabled !== false, weight: Number(s.weight) || 0, whenMissing: str(s.whenMissing) === 'zero' ? 'zero' : 'skip' } : d;
    });
    const order = Array.isArray(doc.data.classOrder) ? (doc.data.classOrder as unknown[]).map(str) : DEFAULT_CLASS_ORDER;
    return { criteria, classOrder: order, version: Number(doc.data.version) || 1, updatedAt: str(doc.data.updatedAt), updatedBy: str(doc.data.updatedBy) };
}

// ----- A quote -----

const BID_FIELDS_NOTE = 'Mandatory: reference, date, validity, currency, payment terms, lead time, unit price and quantity for each item quoted, and the vendor document. Optional: discount, warranty, incoterm, delivery terms, brand, origin, compliance, notes.';

/** A vendor scope covers a case line when kind and category match and the scope is the whole category or the same subcategory. */
function scopeCovers(scopes: Obj[], key: string): boolean {
    const [k, c, s] = key.split('|');
    return scopes.some((x) => str(x.kind) === k && str(x.categoryCode) === c && (str(x.subcategoryCode) === '' || str(x.subcategoryCode) === s));
}

/** Latest conversion of each currency to the organization currency, from the platform currency list. */
async function latestRates(orgCurrency: string) {
    const doc = await getDoc('reference/currencies');
    const per = new Map<string, number>([['USD', 1]]);
    const list: Array<{ code: string; name: string }> = [];
    for (const c of objs(doc?.data.items)) {
        if (c.enabled === false || !/^[A-Z]{3}$/.test(str(c.code))) continue;
        list.push({ code: str(c.code), name: str(c.name) });
        const u = Number(c.unitsPerUsd);
        if (u > 0) per.set(str(c.code), u);
    }
    const rate = (code: string): number | null => {
        if (!code) return null;
        if (code === orgCurrency) return 1;
        const q = per.get(code);
        const b = per.get(orgCurrency);
        return q && b ? Math.round((b / q) * 1e6) / 1e6 : null;
    };
    return { list, rate, asOf: str(doc?.data.ratesUpdatedAt) || str(doc?.data.loadedAt) };
}
type Rates = Awaited<ReturnType<typeof latestRates>>;

function totalsWithLatest(q: Obj, orgCurrency: string, fxl: Rates) {
    const t = totalsOf(q, orgCurrency);
    const latestRate = fxl.rate(str(q.currency));
    return { ...t, latestRate, latestBase: latestRate ? money2(t.total * latestRate) : (null as number | null) };
}

function money2(n: number) {
    return round(n, 2);
}

/** Totals of a quote in its own currency and in the organization currency. */
function totalsOf(q: Obj, orgCurrency: string) {
    const lines = objs(q.lines).filter((l) => l.bid !== false);
    const sub = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * (1 - (Number(l.discountPct) || 0) / 100), 0);
    const total = money2(sub * (1 - (Number(q.discountPct) || 0) / 100));
    const fx = str(q.currency) === orgCurrency ? 1 : Number(q.fxRate) || 0;
    return { total, base: fx > 0 ? money2(total * fx) : null as number | null };
}

/** What a quote still lacks. A quote with gaps is kept but is not ranked. */
function gapsOf(q: Obj, _caseLines: Obj[], orgCurrency: string): string[] {
    const out: string[] = [];
    if (!str(q.ref)) out.push('Quote reference');
    if (!str(q.date)) out.push('Quote date');
    if (!str(q.validUntil)) out.push('Valid until');
    if (!/^[A-Z]{3}$/.test(str(q.currency))) out.push('Currency');
    else if (str(q.currency) !== orgCurrency && !(Number(q.fxRate) > 0)) out.push(`Exchange rate to ${orgCurrency}`);
    if (!str(q.paymentTermsCode)) out.push('Terms of payment');
    if (!(Number(q.leadTimeDays) >= 0) || q.leadTimeDays === null || q.leadTimeDays === undefined || q.leadTimeDays === '') out.push('Lead time');
    const bids = objs(q.lines).filter((l) => l.bid !== false);
    if (!bids.length) out.push('Price for at least one item');
    for (const l of bids) if (!(Number(l.unitPrice) > 0) || !(Number(l.quantity) > 0)) out.push(`Price and quantity for item ${Number(l.no)}`);
    if (!objs(q.attachments).length) out.push('The vendor\'s quotation document');
    return out;
}

// ----- Analysis -----

interface Ranked {
    quoteId: string;
    vendorId: string;
    vendorName: string;
    total: number;
    base: number | null;
    scores: Record<string, number | null>;
    used: string[];
    skipped: string[];
    score: number;
    rank: number | null;
    eligible: boolean;
    flags: string[];
}

/** Scores the quotes with the configured metrics. Only complete, valid, fully covering quotes are ranked. */
function analyse(c: Obj, quotes: Obj[], vendors: Map<string, Doc>, cfg: EvalConfig, classCount: number, orgCurrency: string): Ranked[] {
    const caseLines = objs(c.lines);
    const goods = caseLines.some((l) => str(l.type) !== 'service');
    const t = today();
    const rows = quotes.map((q) => {
        const v = vendors.get(str(q.vendorId));
        const flags: string[] = [];
        const gaps = gapsOf(q, caseLines, orgCurrency);
        if (gaps.length) flags.push(`Incomplete: ${gaps.join(', ')}`);
        const bidNos = new Set(objs(q.lines).filter((l) => l.bid !== false && Number(l.unitPrice) > 0).map((l) => Number(l.no)));
        const missingItems = caseLines.filter((l) => !bidNos.has(Number(l.no)));
        if (missingItems.length) flags.push(`Covers ${caseLines.length - missingItems.length} of ${caseLines.length} items`);
        if (str(q.validUntil) && str(q.validUntil) < t) flags.push(`Validity ended ${str(q.validUntil)}`);
        if (str(o(q.tech).preference) === 'not_acceptable') flags.push('Technical team does not accept this quote');
        if (!v || str(v.data.status) !== 'approved') flags.push('Vendor is not an approved vendor');
        const tot = totalsOf(q, orgCurrency);
        return { q, v, tot, flags, eligible: flags.length === 0 && tot.base !== null };
    });
    const elig = rows.filter((r) => r.eligible);

    const warrantyOf = (q: Obj): number | null => {
        const w = num(q.warrantyMonths);
        if (w !== null && !Number.isNaN(w)) return w;
        const ls = objs(q.lines).map((l) => num(l.warrantyMonths)).filter((x): x is number => x !== null && !Number.isNaN(x));
        return ls.length ? Math.min(...ls) : null;
    };
    const leadOf = (q: Obj): number | null => {
        const base = num(q.leadTimeDays);
        const ls = objs(q.lines).map((l) => num(l.leadTimeDays)).filter((x): x is number => x !== null && !Number.isNaN(x));
        const all = [...(base !== null && !Number.isNaN(base) ? [base] : []), ...ls];
        return all.length ? Math.max(...all) : null;
    };
    const minPrice = Math.min(...elig.map((r) => r.tot.base as number));
    const maxWarranty = Math.max(0, ...elig.map((r) => warrantyOf(r.q) ?? 0));
    const leads = elig.map((r) => leadOf(r.q)).filter((x): x is number => x !== null && x > 0);
    const minLead = leads.length ? Math.min(...leads) : 0;
    const maxDiscount = Math.max(0, ...elig.map((r) => Number(r.q.discountPct) || 0));
    const enabled = cfg.criteria.filter((x) => x.enabled && x.weight > 0);

    const scored = rows.map((r): Ranked => {
        const q = r.q;
        const raw: Record<string, number | null> = {};
        if (r.eligible) {
            raw.price = (r.tot.base as number) > 0 ? round((minPrice / (r.tot.base as number)) * 100, 1) : 0;
            const pref = str(o(q.tech).preference);
            raw.technical = pref === 'preferred' ? 100 : pref === 'acceptable' ? 60 : null;
            const idx = cfg.classOrder.indexOf(str(r.v?.data.classCode));
            raw.vendorClass = !goods ? null : idx < 0 ? 0 : round(((cfg.classOrder.length - idx) / Math.max(1, cfg.classOrder.length)) * 100, 1);
            const w = warrantyOf(q);
            raw.warranty = w === null ? null : maxWarranty > 0 ? round((w / maxWarranty) * 100, 1) : null;
            const l = leadOf(q);
            raw.leadTime = l === null ? null : l <= 0 ? 100 : minLead > 0 ? round((minLead / l) * 100, 1) : 100;
            const dsc = num(q.discountPct);
            raw.discount = dsc === null || Number.isNaN(dsc) ? null : maxDiscount > 0 ? round((dsc / maxDiscount) * 100, 1) : 0;
            const srm = num(r.v?.data.srmScore);
            raw.srm = srm === null || Number.isNaN(srm) ? null : Math.max(0, Math.min(100, srm));
        }
        const used: string[] = [];
        const skipped: string[] = [];
        let sum = 0;
        let weights = 0;
        for (const k of enabled) {
            // The class metric is switched off for the whole case when every item is a service.
            if (k.code === 'vendorClass' && !goods) {
                skipped.push(k.code);
                continue;
            }
            const val = raw[k.code];
            if (val === null || val === undefined) {
                if (k.whenMissing === 'skip' || !r.eligible) {
                    skipped.push(k.code);
                    continue;
                }
                used.push(k.code);
                weights += k.weight;
                continue;
            }
            used.push(k.code);
            weights += k.weight;
            sum += val * k.weight;
        }
        return {
            quoteId: str(q.id),
            vendorId: str(q.vendorId),
            vendorName: str(q.vendorName),
            total: r.tot.total,
            base: r.tot.base,
            scores: raw,
            used,
            skipped,
            score: r.eligible && weights > 0 ? round(sum / weights, 1) : 0,
            rank: null,
            eligible: r.eligible,
            flags: r.flags,
        };
    });
    const order = scored.filter((s) => s.eligible).sort((a, b) => b.score - a.score || (a.base ?? 0) - (b.base ?? 0));
    order.forEach((s, i) => {
        s.rank = i + 1;
    });
    void classCount;
    return scored.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.vendorName.localeCompare(b.vendorName));
}

// ----- Access -----

const canView = (ctx: OrgContext) => can(ctx, 'PRC.quotes.view') || can(ctx, 'PRC.quotes.manage') || can(ctx, 'PRC.quotes.evaluate');
function requireView(ctx: OrgContext) {
    requireProcurement(ctx);
    if (!canView(ctx)) throw new HttpError(403, 'You do not have permission to view quotations.');
}
function requireManage(ctx: OrgContext) {
    requireProcurement(ctx);
    if (!can(ctx, 'PRC.quotes.manage')) throw new HttpError(403, 'You do not have permission to manage quotations.');
}
const visibleTo = (scope: DeskScope, d: Obj) => covers(scope, objs(d.lines));
/** Buyers see their groups' cases. Evaluators (the technical team) see every case they may be asked to evaluate. */
async function scopeOf(ctx: OrgContext): Promise<DeskScope> {
    const s = await deskScope(ctx);
    return !s.all && can(ctx, 'PRC.quotes.evaluate') ? { ...s, all: true } : s;
}

async function lock<T>(ctx: OrgContext, id: string, fn: () => Promise<T>): Promise<T> {
    const path = `organizations/${ctx.orgId}/procurement_quotation_locks/${id}`;
    if (!(await writeDoc(path, { by: ctx.uid, at: nowIso() }, { exists: false }))) throw new HttpError(409, 'This quotation is being updated by someone else. Try again in a moment.');
    try {
        return await fn();
    } finally {
        await deleteDoc(path);
    }
}

async function load(ctx: OrgContext, body: Obj, forWrite = false): Promise<{ id: string; doc: Doc; scope: DeskScope }> {
    requireView(ctx);
    if (forWrite) requireManage(ctx);
    const id = str(body.id);
    if (!ID.test(id)) throw new HttpError(404, 'Quotation not found.');
    const [doc, scope] = await Promise.all([getDoc(`${casesPath(ctx.orgId)}/${id}`), scopeOf(ctx)]);
    if (!doc || !visibleTo(scope, doc.data)) throw new HttpError(404, 'Quotation not found.');
    return { id, doc, scope };
}

interface Change {
    patch: Obj;
    label: string;
    event?: string;
    note?: string;
    result?: Obj;
}

/** One change to a case under a lock, re-read, checked and added to the history and the audit trail. */
async function change(ctx: OrgContext, body: Obj, action: string, write: boolean, run: (d: Obj, id: string) => Promise<Change>) {
    const { id } = await load(ctx, body, write);
    return lock(ctx, id, async () => {
        const path = `${casesPath(ctx.orgId)}/${id}`;
        const fresh = await getDoc(path);
        if (!fresh) throw new HttpError(404, 'Quotation not found.');
        const d = fresh.data;
        const c = await run(d, id);
        const at = nowIso();
        const next: Obj = { ...d, ...c.patch, updatedAt: at, version: (Number(d.version) || 1) + 1 };
        if (c.event) next.history = [...objs(d.history), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: c.event, note: c.note ?? '', from: str(d.status), to: str(next.status) }];
        await writeDoc(path, next);
        await record(ctx, `org.procurement.quote.${action}`, id, `${c.label}${c.note ? `. ${c.note}` : ''}`.slice(0, 400));
        return { ok: true, id, status: str(next.status), ...(c.result ?? {}) };
    });
}

const history = (d: Obj) => objs(d.history);
const estimateOf = (d: Obj): number | null => {
    const manual = num(o(d.review).estimateTotal);
    if (manual !== null && !Number.isNaN(manual) && manual > 0) return manual;
    const sum = objs(d.lines).reduce((s, l) => s + (Number(l.budget) || 0), 0);
    return sum > 0 ? round(sum) : null;
};

/** Sign-offs that still count: made on the current quotes, with no conflict of interest declared. */
const validSigns = (d: Obj) => objs(d.signs).filter((s) => Number(s.rev) === (Number(d.rev) || 0) && str(s.conflict) === 'none');

function row(d: Obj, id: string) {
    const lines = objs(d.lines);
    const quotes = objs(d.quotes);
    return {
        id,
        number: str(d.number) || id,
        requirementId: str(d.requirementId),
        requirementTitle: str(d.requirementTitle),
        requester: str(d.requesterName),
        status: str(d.status),
        statusLabel: STATUS_LABEL[str(d.status)] ?? str(d.status),
        mode: str(o(d.review).mode),
        modeLabel: METHODS.find((m) => m.code === str(o(d.review).mode))?.label ?? (str(o(d.review).mode) === 'research' ? 'Research' : str(o(d.review).mode) === 'consult' ? 'Consult' : ''),
        groups: str(d.groupNames),
        items: lines.length,
        invited: objs(d.invites).length,
        received: quotes.length,
        estimate: estimateOf(d),
        recommended: str(o(d.recommendation).vendorName),
        createdByName: str(d.createdByName),
        createdAt: str(d.createdAt),
        updatedAt: str(d.updatedAt),
    };
}

/** Snapshot of the items taken from the requirement, so the case still reads the same if the requirement is later changed. */
function snapshotLine(l: Obj): Obj {
    return {
        no: Number(l.no),
        type: str(l.type),
        source: str(l.source),
        categoryCode: str(l.categoryCode),
        categoryName: str(l.categoryName),
        subcategoryCode: str(l.subcategoryCode),
        subcategoryName: str(l.subcategoryName),
        itemCode: str(o(l.master).code),
        itemName: str(l.itemName),
        requirement: str(l.requirement),
        technical: str(l.technical),
        attributeView: objs(l.attributeView).map((a) => ({ name: str(a.name), value: str(a.value), unit: str(a.unit) })),
        quantity: Number(l.quantity) || 0,
        unit: str(l.unit),
        dateRequired: str(l.dateRequired),
        urgency: str(l.urgency),
        budget: typeof l.budget === 'number' ? l.budget : null,
        costCenterCode: str(l.costCenterCode),
        costCenterName: str(l.costCenterName),
        glCode: str(l.glCode),
        warehouseName: str(l.warehouseName),
    };
}

// ----- Reading a quote from a request -----

async function readQuote(ctx: OrgContext, body: Obj, d: Obj, vendor: Doc, existing?: Obj): Promise<Obj> {
    const [terms, incoterms] = await Promise.all([metaList('vendorPaymentTerms'), metaList('vendorIncoterms')]);
    const orgCurrency = str(ctx.org.data.currencyCode);
    const t = today();
    const date = str(body.date);
    const valid = str(body.validUntil);
    const dateOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
    if (date && !dateOk(date)) throw new HttpError(400, 'Enter a valid quote date.');
    if (date && date > t) throw new HttpError(400, 'The quote date cannot be in the future.');
    if (valid && !dateOk(valid)) throw new HttpError(400, 'Enter a valid date for "valid until".');
    if (date && valid && valid < date) throw new HttpError(400, '"Valid until" cannot be before the quote date.');
    const currency = str(body.currency).trim().toUpperCase();
    if (currency && !/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Choose the currency from the list.');
    const known = (await latestRates(orgCurrency)).list;
    if (currency && known.length && !known.some((c) => c.code === currency)) throw new HttpError(400, 'Choose the currency from the list.');
    const fx = num(body.fxRate);
    if (fx !== null && (Number.isNaN(fx) || fx <= 0 || fx > 1e7)) throw new HttpError(400, 'Enter an exchange rate above zero.');
    const payment = str(body.paymentTermsCode);
    if (payment && !terms.some((x) => x.code === payment)) throw new HttpError(400, 'Choose terms of payment from the list.');
    const inco = str(body.incotermCode);
    if (inco && !incoterms.some((x) => x.code === inco)) throw new HttpError(400, 'Choose an incoterm from the list.');
    const days = (v: unknown, what: string, max: number): number | null => {
        const n = num(v);
        if (n === null) return null;
        if (Number.isNaN(n) || n < 0 || n > max || !Number.isInteger(n)) throw new HttpError(400, `${what} must be a whole number from 0 to ${max}.`);
        return n;
    };
    const pct = (v: unknown, what: string): number | null => {
        const n = num(v);
        if (n === null) return null;
        if (Number.isNaN(n) || n < 0 || n > 100) throw new HttpError(400, `${what} must be between 0 and 100.`);
        return round(n, 2);
    };
    const caseNos = new Set(objs(d.lines).map((l) => Number(l.no)));
    const given = objs(body.lines);
    const lines = objs(d.lines).map((cl) => {
        const g = given.find((x) => Number(x.no) === Number(cl.no));
        if (!g || g.bid === false) return { no: Number(cl.no), bid: false };
        const price = num(g.unitPrice);
        const qty = num(g.quantity);
        if (price !== null && (Number.isNaN(price) || price < 0 || price > 1e12)) throw new HttpError(400, `Item ${Number(cl.no)}: enter a unit price of zero or more.`);
        if (qty !== null && (Number.isNaN(qty) || qty < 0 || qty > 1e9)) throw new HttpError(400, `Item ${Number(cl.no)}: enter a quantity of zero or more.`);
        const compliance = str(g.compliance);
        if (compliance && !['full', 'partial', 'none'].includes(compliance)) throw new HttpError(400, `Item ${Number(cl.no)}: choose how the offer complies with the specification.`);
        return {
            no: Number(cl.no),
            bid: true,
            unitPrice: price === null ? 0 : round(price, 4),
            quantity: qty === null ? Number(cl.quantity) || 0 : round(qty, 3),
            discountPct: pct(g.discountPct, `Item ${Number(cl.no)} discount`),
            leadTimeDays: days(g.leadTimeDays, `Item ${Number(cl.no)} lead time`, 3650),
            warrantyMonths: days(g.warrantyMonths, `Item ${Number(cl.no)} warranty`, 600),
            brand: oneLine(g.brand, 80),
            origin: oneLine(g.origin, 60),
            compliance,
            note: oneLine(g.note, 200),
        };
    });
    for (const g of given) if (!caseNos.has(Number(g.no))) throw new HttpError(400, 'A quoted item is not part of this quotation.');
    void orgCurrency;
    const cls = (await metaList('vendorClasses')).find((x) => x.code === str(vendor.data.classCode));
    return {
        ...(existing ?? {}),
        vendorId: vendor.id,
        vendorName: str(vendor.data.legalName),
        classCode: str(vendor.data.classCode),
        classLabel: cls?.label ?? str(vendor.data.classLabel),
        ref: oneLine(body.ref, 40),
        date,
        validUntil: valid,
        currency,
        fxRate: fx,
        paymentTermsCode: payment,
        paymentTermsLabel: terms.find((x) => x.code === payment)?.label ?? '',
        incotermCode: inco,
        incotermLabel: incoterms.find((x) => x.code === inco)?.label ?? '',
        leadTimeDays: days(body.leadTimeDays, 'Lead time', 3650),
        warrantyMonths: days(body.warrantyMonths, 'Warranty', 600),
        discountPct: pct(body.discountPct, 'Discount'),
        deliveryTerms: oneLine(body.deliveryTerms, 200),
        vatIncluded: typeof body.vatIncluded === 'boolean' ? body.vatIncluded : null,
        notes: cleanText(body.notes).slice(0, 600),
        lines,
    };
}

async function vendorMap(orgId: string): Promise<Map<string, Doc>> {
    return new Map((await listDocs(vendorsPath(orgId))).map((v): [string, Doc] => [v.id, v]));
}

export const quotationRoutes = {
    // What the screens need: permissions, methods, lists for terms, and the evaluation metrics.
    'POST /api/org/procurement/quotes/options': [
        orgRoute('org.procurement.quotes.options', null, async (ctx) => {
            requireView(ctx);
            const fx = await latestRates(str(ctx.org.data.currencyCode));
            const [terms, incoterms, cfg, scope] = await Promise.all([metaList('vendorPaymentTerms'), metaList('vendorIncoterms'), evaluationConfig(ctx.orgId), scopeOf(ctx)]);
            return {
                methods: METHODS,
                currency: str(ctx.org.data.currencyCode),
                currencies: fx.list,
                rates: Object.fromEntries(fx.list.map((c) => [c.code, fx.rate(c.code)]).filter((e) => e[1] !== null)),
                ratesAsOf: fx.asOf,
                terms: terms.map((x) => ({ code: x.code, label: x.label })),
                incoterms: incoterms.map((x) => ({ code: x.code, label: x.label })),
                evaluation: cfg,
                fieldsNote: BID_FIELDS_NOTE,
                scope: { enabled: scope.enabled, all: scope.all },
                can: { manage: can(ctx, 'PRC.quotes.manage'), evaluate: can(ctx, 'PRC.quotes.evaluate'), srm: can(ctx, 'PRC.vendors.manage'), metrics: can(ctx, 'PRC.authority.manage') },
            };
        }),
    ],

    // Cases in the person's buyer groups, and acknowledged requirements that still have items to source.
    'POST /api/org/procurement/quotes/list': [
        orgRoute('org.procurement.quotes.list', null, async (ctx) => {
            requireView(ctx);
            const scope = await scopeOf(ctx);
            const [cases, reqs] = await Promise.all([listDocs(casesPath(ctx.orgId)), listDocs(requirementsPath(ctx.orgId))]);
            const mine = cases.filter((c) => visibleTo(scope, c.data));
            const taken = new Set<string>();
            for (const c of cases) if (str(c.data.status) !== 'cancelled') for (const l of objs(c.data.lines)) taken.add(`${str(c.data.requirementId)}|${Number(l.no)}`);
            const ready = reqs
                .filter((r) => str(r.data.status) === 'acknowledged')
                .map((r) => {
                    const free = inScope(scope, objs(r.data.lines)).filter((l) => !taken.has(`${r.id}|${Number(l.no)}`));
                    return { r, free };
                })
                .filter((x) => x.free.length > 0)
                .map(({ r, free }) => ({
                    id: r.id,
                    title: str(r.data.title),
                    requester: str(r.data.requesterName),
                    acknowledgedAt: str(r.data.acknowledgedAt),
                    items: free.map((l) => ({ no: Number(l.no), type: str(l.type), requirement: str(l.requirement), quantity: Number(l.quantity) || 0, unit: str(l.unit), subcategoryName: str(l.subcategoryName), budget: typeof l.budget === 'number' ? l.budget : null, dateRequired: str(l.dateRequired), urgency: str(l.urgency) })),
                }));
            const view = str(ctx.body.view) || 'cases';
            return {
                rows: mine.sort((a, b) => b.id.localeCompare(a.id)).slice(0, 1000).map((c) => row(c.data, c.id)).filter((r) => (view === 'open' ? OPEN.includes(r.status) : true)),
                ready: can(ctx, 'PRC.quotes.manage') ? ready : [],
                counts: { cases: mine.length, open: mine.filter((c) => OPEN.includes(str(c.data.status))).length, ready: can(ctx, 'PRC.quotes.manage') ? ready.length : 0 },
            };
        }),
    ],

    'POST /api/org/procurement/quotes/create': [
        orgRoute('org.procurement.quotes.create', 'PRC.quotes.manage', async (ctx) => {
            requireProcurement(ctx);
            const reqId = str(ctx.body.requirementId);
            if (!/^REQ\d{9}$/.test(reqId)) throw new HttpError(404, 'Purchase requirement not found.');
            const [req, scope, cases] = await Promise.all([getDoc(`${requirementsPath(ctx.orgId)}/${reqId}`), scopeOf(ctx), listDocs(casesPath(ctx.orgId))]);
            if (!req || str(req.data.status) !== 'acknowledged') throw new HttpError(409, 'Only a requirement acknowledged by procurement can be sourced.');
            const want = new Set((Array.isArray(ctx.body.lineNos) ? (ctx.body.lineNos as unknown[]) : []).map(Number));
            if (!want.size) throw new HttpError(400, 'Choose at least one item to source.');
            const taken = new Set<string>();
            for (const c of cases) if (str(c.data.status) !== 'cancelled' && str(c.data.requirementId) === reqId) for (const l of objs(c.data.lines)) taken.add(String(Number(l.no)));
            const lines = inScope(scope, objs(req.data.lines)).filter((l) => want.has(Number(l.no)));
            if (lines.length !== want.size) throw new HttpError(403, 'Some of those items are outside your buyer groups or no longer exist.');
            if (lines.some((l) => taken.has(String(Number(l.no))))) throw new HttpError(409, 'Some of those items are already in another quotation.');
            const owners = await ownersOf(ctx.orgId);
            const groupNames = Array.from(new Set(lines.map((l) => owners.get(lineKeyOf(l))?.name).filter((x): x is string => !!x))).join(', ');
            const n = await nextOrgCounter(ctx.orgId, 'quotationSeq');
            if (n > 999_999_999) throw new HttpError(500, 'The quotation number range is exhausted.');
            const id = `QTN${String(n).padStart(9, '0')}`;
            const at = nowIso();
            const data: Obj = {
                number: id,
                requirementId: reqId,
                requirementTitle: str(req.data.title),
                requesterName: str(req.data.requesterName),
                groupNames,
                status: 'reviewing',
                lines: lines.map(snapshotLine),
                review: {},
                invites: [],
                quotes: [],
                signs: [],
                rev: 0,
                fileSeq: 0,
                quoteSeq: 0,
                createdBy: ctx.uid,
                createdByName: nameOfUser(ctx.me),
                createdAt: at,
                updatedAt: at,
                version: 1,
                history: [{ at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'opened', note: `${lines.length} item(s) from ${reqId}`, from: '', to: 'reviewing' }],
            };
            if (!(await writeDoc(`${casesPath(ctx.orgId)}/${id}`, data, { exists: false }))) throw new HttpError(409, 'That quotation number is already in use. Please try again.');
            await record(ctx, 'org.procurement.quote.create', id, `${lines.length} item(s) of ${reqId}`);
            return { ok: true, id };
        }),
    ],

    'POST /api/org/procurement/quotes/get': [
        orgRoute('org.procurement.quotes.get', null, async (ctx) => {
            const { id, doc } = await load(ctx, ctx.body);
            const d = doc.data;
            const cfg = await evaluationConfig(ctx.orgId);
            const [authority, vendors, classes] = await Promise.all([getAuthority(ctx.orgId), vendorMap(ctx.orgId), metaList('vendorClasses')]);
            const orgCurrency = str(ctx.org.data.currencyCode);
            const quotes = objs(d.quotes);
            const estimate = estimateOf(d);
            const suggested = estimate !== null ? resolveAuthority(authority, estimate) : null;
            const ranked = analyse(d, quotes, vendors, cfg, classes.length, orgCurrency);
            const rec = o(d.recommendation);
            const recQuote = ranked.find((r) => r.quoteId === str(rec.quoteId));
            const award = recQuote?.base ?? null;
            const awardAuthority = award !== null ? resolveAuthority(authority, award) : null;
            const minQuotes = suggested?.sourcing.minQuotes ?? 1;
            const minEvaluators = Math.max(suggested?.sourcing.minEvaluators ?? 1, suggested?.requires.tenderCommittee ?? 0);
            const status = str(d.status);
            const writable = can(ctx, 'PRC.quotes.manage') && ['reviewing', 'researching', 'consulting', 'sourcing'].includes(status);
            const fxl = await latestRates(orgCurrency);
            const last = await lastPricesFor(ctx.orgId, orgCurrency, objs(d.lines), id);
            return {
                ...row(d, id),
                lines: objs(d.lines).map((l) => ({ ...l, lastPrice: last.get(Number(l.no)) ?? null })),
                review: d.review ?? {},
                invites: objs(d.invites).map((i) => {
                    const v = vendors.get(str(i.vendorId));
                    const scopes = objs(v?.data.scopes);
                    const caseKeys = objs(d.lines).map(lineKeyOf);
                    const matched = caseKeys.filter((k) => scopeCovers(scopes, k)).length;
                    const contact = o(v?.data.contact);
                    return {
                        ...i,
                        classLabel: str(v?.data.classLabel),
                        sourcingLabel: str(v?.data.sourcingLabel),
                        riskLabel: str(v?.data.riskLabel),
                        srmScore: typeof v?.data.srmScore === 'number' ? v.data.srmScore : null,
                        vendorStatus: str(v?.data.status),
                        contactName: str(contact.name),
                        contactEmail: str(contact.email),
                        contactPhone: str(contact.phone),
                        conflict: str(v?.data.conflict),
                        scopeMatch: caseKeys.length === 0 ? 'full' : matched === caseKeys.length ? 'full' : matched === 0 ? 'none' : 'partial',
                    };
                }),
                quotes: quotes.map((q) => ({ ...q, ...totalsWithLatest(q, orgCurrency, fxl), gaps: gapsOf(q, objs(d.lines), orgCurrency), attachments: objs(q.attachments) })),
                ranking: ranked,
                signs: objs(d.signs).map((s) => ({ ...s, stale: Number(s.rev) !== (Number(d.rev) || 0), counts: Number(s.rev) === (Number(d.rev) || 0) && str(s.conflict) === 'none' })),
                recommendation: d.recommendation ?? null,
                authority: {
                    estimate,
                    suggested,
                    minQuotes,
                    minEvaluators,
                    validSigns: validSigns(d).length,
                    award,
                    awardAuthority,
                    approvers: awardAuthority ? await describeApproval(ctx.orgId, authority, awardAuthority) : suggested ? await describeApproval(ctx.orgId, authority, suggested) : [],
                    version: authority.version,
                    controls: authority.controls,
                },
                evaluation: cfg,
                history: history(d).map((h) => ({ at: str(h.at), byName: str(h.byName), action: str(h.action), note: str(h.note), from: str(h.from), to: str(h.to) })),
                currency: orgCurrency,
                ratesAsOf: fxl.asOf,
                can: {
                    review: writable,
                    invite: writable && status === 'sourcing',
                    record: writable && status === 'sourcing',
                    technical: can(ctx, 'PRC.quotes.evaluate') && status === 'sourcing',
                    sign: can(ctx, 'PRC.quotes.evaluate') && status === 'sourcing',
                    recommend: can(ctx, 'PRC.quotes.manage') && status === 'sourcing',
                    reopen: can(ctx, 'PRC.quotes.manage') && status === 'recommended',
                    cancel: can(ctx, 'PRC.quotes.manage') && OPEN.includes(status),
                },
            };
        }),
    ],

    // Review of the requirement: choose the mode of procurement, or record that it is still being researched or consulted on.
    'POST /api/org/procurement/quotes/review': [
        orgRoute('org.procurement.quotes.review', 'PRC.quotes.manage', async (ctx) =>
            change(ctx, ctx.body, 'review', true, async (d) => {
                if (!['reviewing', 'researching', 'consulting', 'sourcing'].includes(str(d.status))) throw new HttpError(409, 'This quotation can no longer be reviewed.');
                const mode = str(ctx.body.mode);
                const note = cleanText(ctx.body.note).slice(0, 600);
                const byName = nameOfUser(ctx.me);
                const at = nowIso();
                if (mode === 'research' || mode === 'consult') {
                    if (objs(d.quotes).length) throw new HttpError(409, 'Quotes have already been recorded, so the mode cannot go back to research or consultation.');
                    if (note.length < 10) throw new HttpError(400, `Say ${mode === 'research' ? 'what is being researched' : 'who is being consulted and about what'} (at least 10 characters).`);
                    return {
                        patch: { status: mode === 'research' ? 'researching' : 'consulting', review: { mode, note, reviewedBy: ctx.uid, byName, at } },
                        event: mode === 'research' ? 'researching' : 'consulting',
                        note,
                        label: mode === 'research' ? 'Reviewed: researching the best method' : 'Reviewed: consulting on the best method',
                    };
                }
                if (!METHODS.some((m) => m.code === mode)) throw new HttpError(400, 'Choose a mode of procurement.');
                if (objs(d.quotes).length && mode !== str(o(d.review).mode)) throw new HttpError(409, 'Quotes have already been recorded, so the mode of procurement cannot be changed.');
                const typed = num(ctx.body.estimateTotal);
                if (typed !== null && (Number.isNaN(typed) || typed <= 0 || typed > 1e13)) throw new HttpError(400, 'Enter an estimated value above zero.');
                const estimate = typed !== null ? round(typed) : estimateOf(d);
                if (estimate === null) throw new HttpError(400, 'No budget was given on the items. Enter an estimated value so the chart of authority can suggest the method.');
                const authority = await getAuthority(ctx.orgId);
                const sug = resolveAuthority(authority, estimate);
                const reason = cleanText(ctx.body.deviationReason).slice(0, 600);
                if ((COMPETITION[mode] ?? 0) < (COMPETITION[sug.sourcing.method] ?? 0) && reason.length < 20)
                    throw new HttpError(400, `For ${estimate.toLocaleString()} the chart of authority asks for ${sug.sourcing.methodLabel}. Choosing less competition needs a written reason of at least 20 characters.`);
                if (mode === 'single_source' && reason.length < 20) throw new HttpError(400, 'Single or sole source buying needs a written justification of at least 20 characters.');
                const closing = str(ctx.body.closingDate);
                if (closing && (!/^\d{4}-\d{2}-\d{2}$/.test(closing) || closing < today())) throw new HttpError(400, 'The closing date cannot be in the past.');
                return {
                    patch: {
                        status: 'sourcing',
                        review: { mode, note, estimateTotal: typed !== null ? round(typed) : null, suggestedMethod: sug.sourcing.method, minQuotes: sug.sourcing.minQuotes, minEvaluators: sug.sourcing.minEvaluators, deviationReason: reason, closingDate: closing, authorityVersion: authority.version, reviewedBy: ctx.uid, byName, at },
                    },
                    event: 'method decided',
                    note: `${METHODS.find((m) => m.code === mode)?.label}. Estimate ${estimate.toLocaleString()}; the chart of authority suggests ${sug.sourcing.methodLabel} with ${sug.sourcing.minQuotes} quote(s).${reason ? ` ${reason}` : ''}`.slice(0, 380),
                    label: `Reviewed: ${METHODS.find((m) => m.code === mode)?.label}`,
                };
            })
        ),
    ],

    // Approved vendors that can be invited, found by name or number.
    'POST /api/org/procurement/quotes/vendors': [
        orgRoute('org.procurement.quotes.vendors', null, async (ctx) => {
            const { doc } = await load(ctx, ctx.body, true);
            const q = str(ctx.body.q).trim().toLowerCase().slice(0, 60);
            if (q.length < 2) return { items: [] };
            const caseKeys = objs(doc.data.lines).map(lineKeyOf);
            const items = (await listDocs(vendorsPath(ctx.orgId)))
                .filter((v) => str(v.data.status) === 'approved' && `${str(v.data.number)} ${str(v.data.legalName)} ${str(v.data.tradeName)}`.toLowerCase().includes(q))
                .slice(0, 30)
                .map((v) => {
                    const scopes = objs(v.data.scopes);
                    const matched = caseKeys.filter((k) => scopeCovers(scopes, k)).length;
                    return { id: v.id, number: str(v.data.number) || v.id, name: str(v.data.legalName), classLabel: str(v.data.classLabel), sourcingLabel: str(v.data.sourcingLabel), srmScore: typeof v.data.srmScore === 'number' ? v.data.srmScore : null, scopeMatch: matched === caseKeys.length ? 'full' : matched === 0 ? 'none' : 'partial' };
                });
            return { items };
        }),
    ],

    'POST /api/org/procurement/quotes/invite': [
        orgRoute('org.procurement.quotes.invite', 'PRC.quotes.manage', async (ctx) =>
            change(ctx, ctx.body, 'invite', true, async (d) => {
                if (str(d.status) !== 'sourcing') throw new HttpError(409, 'Decide the mode of procurement first.');
                const vendor = await getDoc(`${vendorsPath(ctx.orgId)}/${str(ctx.body.vendorId)}`);
                if (!vendor) throw new HttpError(404, 'Vendor not found.');
                const authority = await getAuthority(ctx.orgId);
                const status = str(vendor.data.status);
                if (authority.controls.requireApprovedVendor ? status !== 'approved' : ['rejected', 'cancelled', 'suspended', 'draft'].includes(status)) throw new HttpError(409, 'Only approved vendors can be invited.');
                const invites = objs(d.invites);
                if (invites.some((i) => str(i.vendorId) === vendor.id)) throw new HttpError(409, 'That vendor is already invited.');
                if (invites.length >= MAX_INVITES) throw new HttpError(400, `Invite up to ${MAX_INVITES} vendors.`);
                const entry = { vendorId: vendor.id, vendorNumber: str(vendor.data.number) || vendor.id, vendorName: str(vendor.data.legalName), invitedAt: nowIso(), invitedBy: nameOfUser(ctx.me), status: 'invited', note: oneLine(ctx.body.note, 200) };
                return { patch: { invites: [...invites, entry] }, event: 'vendor invited', note: entry.vendorName, label: `Vendor invited: ${entry.vendorName}` };
            })
        ),
    ],

    'POST /api/org/procurement/quotes/invite/update': [
        orgRoute('org.procurement.quotes.invite.update', 'PRC.quotes.manage', async (ctx) =>
            change(ctx, ctx.body, 'invite.update', true, async (d) => {
                if (str(d.status) !== 'sourcing') throw new HttpError(409, 'This quotation is not collecting quotes.');
                const vendorId = str(ctx.body.vendorId);
                const invites = objs(d.invites);
                const inv = invites.find((i) => str(i.vendorId) === vendorId);
                if (!inv) throw new HttpError(404, 'That vendor is not invited.');
                const action = str(ctx.body.action);
                if (action === 'remove') {
                    if (objs(d.quotes).some((q) => str(q.vendorId) === vendorId)) throw new HttpError(409, 'This vendor has a recorded quote. Remove the quote first.');
                    return { patch: { invites: invites.filter((i) => str(i.vendorId) !== vendorId) }, event: 'vendor removed', note: str(inv.vendorName), label: `Vendor removed: ${str(inv.vendorName)}` };
                }
                if (!['declined', 'no_response', 'invited'].includes(action)) throw new HttpError(400, 'Choose declined, no response or invited.');
                if (objs(d.quotes).some((q) => str(q.vendorId) === vendorId)) throw new HttpError(409, 'This vendor has a recorded quote.');
                const note = oneLine(ctx.body.note, 200);
                return { patch: { invites: invites.map((i) => (str(i.vendorId) === vendorId ? { ...i, status: action, note } : i)) }, event: `vendor ${action}`, note: `${str(inv.vendorName)}${note ? `: ${note}` : ''}`, label: `Vendor ${action}: ${str(inv.vendorName)}` };
            })
        ),
    ],

    // Records or changes one vendor's quote. Mandatory fields are listed as gaps until they are given; a quote with gaps is not ranked.
    'POST /api/org/procurement/quotes/quote/save': [
        orgRoute('org.procurement.quotes.quote.save', 'PRC.quotes.manage', async (ctx) =>
            change(ctx, ctx.body, 'quote.save', true, async (d) => {
                if (str(d.status) !== 'sourcing') throw new HttpError(409, 'This quotation is not collecting quotes.');
                const vendorId = str(ctx.body.vendorId);
                const inv = objs(d.invites).find((i) => str(i.vendorId) === vendorId);
                if (!inv) throw new HttpError(400, 'Invite the vendor before recording its quote.');
                const vendor = await getDoc(`${vendorsPath(ctx.orgId)}/${vendorId}`);
                if (!vendor) throw new HttpError(404, 'Vendor not found.');
                const quotes = objs(d.quotes);
                const existing = quotes.find((q) => str(q.vendorId) === vendorId);
                const read = await readQuote(ctx, ctx.body, d, vendor, existing);
                const at = nowIso();
                let id = str(existing?.id);
                let seq = Number(d.quoteSeq) || 0;
                if (!existing) {
                    seq += 1;
                    id = `Q${seq}`;
                }
                const quote: Obj = { ...read, id, tech: existing?.tech ?? {}, attachments: existing?.attachments ?? [], createdBy: str(existing?.createdBy) || ctx.uid, createdByName: str(existing?.createdByName) || nameOfUser(ctx.me), createdAt: str(existing?.createdAt) || at, updatedAt: at };
                const next = existing ? quotes.map((q) => (str(q.id) === id ? quote : q)) : [...quotes, quote];
                const invites = objs(d.invites).map((i) => (str(i.vendorId) === vendorId ? { ...i, status: 'received', note: '' } : i));
                const gaps = gapsOf(quote, objs(d.lines), str(ctx.org.data.currencyCode));
                // A change to the quotes makes earlier sign-offs and a recommendation stale.
                return { patch: { quotes: next, invites, quoteSeq: seq, rev: (Number(d.rev) || 0) + 1 }, event: existing ? 'quote changed' : 'quote received', note: `${str(inv.vendorName)}${str(quote.ref) ? `, ref ${str(quote.ref)}` : ''}`, label: `${existing ? 'Quote changed' : 'Quote recorded'}: ${str(inv.vendorName)}`, result: { quoteId: id, gaps } };
            })
        ),
    ],

    'POST /api/org/procurement/quotes/quote/remove': [
        orgRoute('org.procurement.quotes.quote.remove', 'PRC.quotes.manage', async (ctx) => {
            const reason = reasonOf(ctx.body);
            return change(ctx, ctx.body, 'quote.remove', true, async (d, id) => {
                if (str(d.status) !== 'sourcing') throw new HttpError(409, 'This quotation is not collecting quotes.');
                const qid = str(ctx.body.quoteId);
                const quotes = objs(d.quotes);
                const q = quotes.find((x) => str(x.id) === qid);
                if (!q) throw new HttpError(404, 'Quote not found.');
                for (const a of objs(q.attachments)) await deleteDoc(`${casesPath(ctx.orgId)}/${id}/files/${str(a.id)}`);
                const invites = objs(d.invites).map((i) => (str(i.vendorId) === str(q.vendorId) ? { ...i, status: 'invited' } : i));
                return { patch: { quotes: quotes.filter((x) => str(x.id) !== qid), invites, rev: (Number(d.rev) || 0) + 1 }, event: 'quote removed', note: `${str(q.vendorName)}: ${reason}`, label: `Quote removed: ${str(q.vendorName)}` };
            });
        }),
    ],

    'POST /api/org/procurement/quotes/quote/file/add': [
        orgRoute('org.procurement.quotes.quote.file.add', 'PRC.quotes.manage', async (ctx) => {
            const type = str(ctx.body.type);
            const data = str(ctx.body.data);
            if (!FILE_TYPES.includes(type) || !/^data:(application\/pdf|image\/jpeg|image\/png);base64,[A-Za-z0-9+/=]+$/.test(data) || !data.startsWith(`data:${type};base64,`) || data.length > MAX_FILE_CHARS)
                throw new HttpError(400, 'Attach a PDF, JPEG or PNG file of up to 450 KB.');
            const name = str(ctx.body.name).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 120) || 'quotation';
            return change(ctx, ctx.body, 'quote.file.add', true, async (d, id) => {
                if (str(d.status) !== 'sourcing') throw new HttpError(409, 'This quotation is not collecting quotes.');
                const qid = str(ctx.body.quoteId);
                const quotes = objs(d.quotes);
                const q = quotes.find((x) => str(x.id) === qid);
                if (!q) throw new HttpError(404, 'Record the quote before attaching its document.');
                if (objs(q.attachments).length >= MAX_FILES_PER_QUOTE) throw new HttpError(400, `Attach up to ${MAX_FILES_PER_QUOTE} files to a quote.`);
                const seq = (Number(d.fileSeq) || 0) + 1;
                const fileId = `${id}_F${seq}`;
                const at = nowIso();
                await writeDoc(`${casesPath(ctx.orgId)}/${id}/files/${fileId}`, { name, type, data, uploadedBy: ctx.uid, uploadedAt: at }, { exists: false });
                const meta = { id: fileId, name, type, size: Math.round((data.length * 3) / 4), uploadedAt: at, uploadedBy: nameOfUser(ctx.me) };
                const next = quotes.map((x) => (str(x.id) === qid ? { ...x, attachments: [...objs(x.attachments), meta] } : x));
                return { patch: { quotes: next, fileSeq: seq, rev: (Number(d.rev) || 0) + 1 }, event: 'quote file', note: `${str(q.vendorName)}: ${name}`, label: 'Quote document attached' };
            });
        }),
    ],

    'POST /api/org/procurement/quotes/quote/file/remove': [
        orgRoute('org.procurement.quotes.quote.file.remove', 'PRC.quotes.manage', async (ctx) =>
            change(ctx, ctx.body, 'quote.file.remove', true, async (d, id) => {
                if (str(d.status) !== 'sourcing') throw new HttpError(409, 'This quotation is not collecting quotes.');
                const fileId = str(ctx.body.fileId);
                const quotes = objs(d.quotes);
                const q = quotes.find((x) => objs(x.attachments).some((a) => str(a.id) === fileId));
                if (!q) throw new HttpError(404, 'File not found.');
                await deleteDoc(`${casesPath(ctx.orgId)}/${id}/files/${fileId}`);
                const next = quotes.map((x) => (str(x.id) === str(q.id) ? { ...x, attachments: objs(x.attachments).filter((a) => str(a.id) !== fileId) } : x));
                return { patch: { quotes: next, rev: (Number(d.rev) || 0) + 1 }, event: 'quote file removed', note: str(q.vendorName), label: 'Quote document removed' };
            })
        ),
    ],

    'POST /api/org/procurement/quotes/quote/file': [
        orgRoute('org.procurement.quotes.quote.file', null, async (ctx) => {
            const { id, doc } = await load(ctx, ctx.body);
            const fileId = str(ctx.body.fileId);
            if (!objs(doc.data.quotes).some((q) => objs(q.attachments).some((a) => str(a.id) === fileId))) throw new HttpError(404, 'File not found.');
            const file = await getDoc(`${casesPath(ctx.orgId)}/${id}/files/${fileId}`);
            if (!file) throw new HttpError(404, 'File not found.');
            await record(ctx, 'org.procurement.quote.file.view', id, str(file.data.name));
            return { name: str(file.data.name), type: str(file.data.type), data: str(file.data.data) };
        }),
    ],

    // The technical team's preference for a quote. A quote they do not accept is left out of the ranking.
    'POST /api/org/procurement/quotes/technical': [
        orgRoute('org.procurement.quotes.technical', 'PRC.quotes.evaluate', async (ctx) =>
            change(ctx, ctx.body, 'technical', false, async (d) => {
                if (str(d.status) !== 'sourcing') throw new HttpError(409, 'This quotation is not collecting quotes.');
                const qid = str(ctx.body.quoteId);
                const pref = str(ctx.body.preference);
                if (!['preferred', 'acceptable', 'not_acceptable', ''].includes(pref)) throw new HttpError(400, 'Choose preferred, acceptable or not acceptable.');
                const note = oneLine(ctx.body.note, 300);
                if (pref === 'not_acceptable' && note.length < 10) throw new HttpError(400, 'Say why the quote is not acceptable (at least 10 characters).');
                const quotes = objs(d.quotes);
                const q = quotes.find((x) => str(x.id) === qid);
                if (!q) throw new HttpError(404, 'Quote not found.');
                const tech = pref ? { preference: pref, note, by: ctx.uid, byName: nameOfUser(ctx.me), at: nowIso() } : {};
                return { patch: { quotes: quotes.map((x) => (str(x.id) === qid ? { ...x, tech } : x)), rev: (Number(d.rev) || 0) + 1 }, event: 'technical view', note: `${str(q.vendorName)}: ${pref || 'cleared'}${note ? `. ${note}` : ''}`, label: `Technical preference: ${str(q.vendorName)} ${pref || 'cleared'}` };
            })
        ),
    ],

    // An evaluator confirms they reviewed the quotes and declares any conflict of interest. A sign-off lapses when the quotes change.
    'POST /api/org/procurement/quotes/sign': [
        orgRoute('org.procurement.quotes.sign', 'PRC.quotes.evaluate', async (ctx) =>
            change(ctx, ctx.body, 'sign', false, async (d) => {
                if (str(d.status) !== 'sourcing') throw new HttpError(409, 'This quotation is not collecting quotes.');
                if (!objs(d.quotes).length) throw new HttpError(409, 'There are no quotes to evaluate yet.');
                const conflict = str(ctx.body.conflict);
                if (!['none', 'declared'].includes(conflict)) throw new HttpError(400, 'Declare whether you have a conflict of interest.');
                const note = oneLine(ctx.body.note, 300);
                if (conflict === 'declared' && note.length < 10) throw new HttpError(400, 'Describe the conflict of interest (at least 10 characters).');
                if (ctx.body.confirm !== true) throw new HttpError(400, 'Confirm that you reviewed the quotes.');
                const signs = objs(d.signs).filter((s) => str(s.uid) !== ctx.uid);
                const entry = { uid: ctx.uid, name: nameOfUser(ctx.me), at: nowIso(), conflict, note, rev: Number(d.rev) || 0 };
                return { patch: { signs: [...signs, entry] }, event: 'evaluator signed', note: conflict === 'declared' ? `Conflict declared: ${note}` : '', label: `Evaluator sign-off by ${entry.name}${conflict === 'declared' ? ' (conflict declared; does not count)' : ''}` };
            })
        ),
    ],

    'POST /api/org/procurement/quotes/recommend': [
        orgRoute('org.procurement.quotes.recommend', 'PRC.quotes.manage', async (ctx) =>
            change(ctx, ctx.body, 'recommend', true, async (d) => {
                if (str(d.status) !== 'sourcing') throw new HttpError(409, 'Only a quotation that is collecting quotes can be recommended.');
                const review = o(d.review);
                const [cfg, vendors, authority, classes] = await Promise.all([evaluationConfig(ctx.orgId), vendorMap(ctx.orgId), getAuthority(ctx.orgId), metaList('vendorClasses')]);
                const orgCurrency = str(ctx.org.data.currencyCode);
                const ranked = analyse(d, objs(d.quotes), vendors, cfg, classes.length, orgCurrency);
                const chosen = ranked.find((r) => r.quoteId === str(ctx.body.quoteId));
                if (!chosen) throw new HttpError(404, 'Quote not found.');
                if (!chosen.eligible) throw new HttpError(409, `That quote cannot be recommended: ${chosen.flags.join('; ')}.`);
                const estimate = estimateOf(d) ?? chosen.base ?? 0;
                const sug = resolveAuthority(authority, estimate);
                const minQuotes = Number(review.minQuotes) || sug.sourcing.minQuotes;
                const minSigns = Math.max(Number(review.minEvaluators) || sug.sourcing.minEvaluators, sug.requires.tenderCommittee);
                const reason = cleanText(ctx.body.reason).slice(0, 600);
                const shortfall = cleanText(ctx.body.shortfallReason).slice(0, 600);
                const top = ranked.find((r) => r.rank === 1);
                if (top && top.quoteId !== chosen.quoteId && reason.length < 20) throw new HttpError(400, `${top.vendorName} ranks first. Recommending another vendor needs a written reason of at least 20 characters.`);
                if (objs(d.quotes).length < minQuotes && shortfall.length < 20) throw new HttpError(400, `The chart of authority asks for ${minQuotes} quote(s) and ${objs(d.quotes).length} were received. Explain the shortfall in at least 20 characters.`);
                // Platform testing override: one valid sign-off (the super admin's own) stands in for the evaluation panel.
                if (validSigns(d).length < minSigns && !(validSigns(d).length >= 1 && bypass(ctx, 'prc.quotes.min_evaluators'))) throw new HttpError(409, `${minSigns} evaluator sign-off(s) are needed on the current quotes and ${validSigns(d).length} are valid. A sign-off lapses when a quote changes.`);
                const rec = { quoteId: chosen.quoteId, vendorId: chosen.vendorId, vendorName: chosen.vendorName, total: chosen.total, base: chosen.base, score: chosen.score, rank: chosen.rank, reason, shortfallReason: shortfall, by: ctx.uid, byName: nameOfUser(ctx.me), at: nowIso(), evaluationVersion: cfg.version, authorityVersion: authority.version, ranking: ranked.map((r) => ({ vendorName: r.vendorName, total: r.total, base: r.base, score: r.score, rank: r.rank, flags: r.flags })) };
                return { patch: { status: 'recommended', recommendation: rec }, event: 'recommended', note: `${chosen.vendorName}, ${chosen.total.toLocaleString()}, score ${chosen.score}${reason ? `. ${reason}` : ''}`.slice(0, 380), label: `Recommended: ${chosen.vendorName}` };
            })
        ),
    ],

    'POST /api/org/procurement/quotes/reopen': [
        orgRoute('org.procurement.quotes.reopen', 'PRC.quotes.manage', async (ctx) => {
            const reason = reasonOf(ctx.body);
            return change(ctx, ctx.body, 'reopen', true, async (d) => {
                if (str(d.status) !== 'recommended') throw new HttpError(409, 'Only a recommended quotation can be reopened.');
                return { patch: { status: 'sourcing', recommendation: null, rev: (Number(d.rev) || 0) + 1 }, event: 'reopened', note: reason, label: 'Reopened for changes' };
            });
        }),
    ],

    'POST /api/org/procurement/quotes/cancel': [
        orgRoute('org.procurement.quotes.cancel', 'PRC.quotes.manage', async (ctx) => {
            const reason = reasonOf(ctx.body);
            return change(ctx, ctx.body, 'cancel', true, async (d) => {
                if (!OPEN.includes(str(d.status))) throw new HttpError(409, 'This quotation is already closed.');
                return { patch: { status: 'cancelled', cancelReason: reason }, event: 'cancelled', note: reason, label: 'Cancelled' };
            });
        }),
    ],

    // Evaluation metrics (weights, what to do when data is missing, and the order of vendor classes).
    'POST /api/org/procurement/evaluation/get': [
        orgRoute('org.procurement.evaluation.get', null, async (ctx) => {
            requireProcurement(ctx);
            if (!(canView(ctx) || can(ctx, 'PRC.setup.view') || can(ctx, 'PRC.authority.manage'))) throw new HttpError(403, 'You do not have permission to view the evaluation metrics.');
            const [cfg, classes] = await Promise.all([evaluationConfig(ctx.orgId), metaList('vendorClasses')]);
            return { config: cfg, classes: classes.map((c) => ({ code: c.code, label: c.label })), canManage: can(ctx, 'PRC.authority.manage') };
        }),
    ],

    'POST /api/org/procurement/evaluation/save': [
        orgRoute('org.procurement.evaluation.save', 'PRC.authority.manage', async (ctx) => {
            requireProcurement(ctx);
            const reason = reasonOf(ctx.body);
            const given = new Map(objs(ctx.body.criteria).map((c): [string, Obj] => [str(c.code), c]));
            const criteria = DEFAULT_CRITERIA.map((d): Criterion => {
                const g = given.get(d.code);
                if (!g) throw new HttpError(400, `The metric ${d.label} is missing.`);
                const weight = Number(g.weight);
                if (!Number.isInteger(weight) || weight < 0 || weight > 100) throw new HttpError(400, `${d.label}: the weight must be a whole number from 0 to 100.`);
                return { ...d, enabled: g.enabled !== false, weight, whenMissing: str(g.whenMissing) === 'zero' ? 'zero' : 'skip' };
            });
            const on = criteria.filter((c) => c.enabled);
            if (!criteria.find((c) => c.code === 'price')?.enabled) throw new HttpError(400, 'Price must stay on.');
            if (on.reduce((s, c) => s + c.weight, 0) !== 100) throw new HttpError(400, `The weights of the metrics that are on must add up to 100. They add up to ${on.reduce((s, c) => s + c.weight, 0)}.`);
            const classes = await metaList('vendorClasses');
            const order = (Array.isArray(ctx.body.classOrder) ? (ctx.body.classOrder as unknown[]).map(str) : []).filter((x, i, a) => a.indexOf(x) === i);
            if (order.some((c) => !classes.some((x) => x.code === c))) throw new HttpError(400, 'A vendor class in the order does not exist.');
            const current = await evaluationConfig(ctx.orgId);
            if (Number(ctx.body.expectedVersion) !== current.version) throw new HttpError(409, 'Someone else changed the evaluation metrics. Reload and apply your changes again.');
            if (JSON.stringify({ c: criteria, o: order }) === JSON.stringify({ c: current.criteria, o: current.classOrder }) && current.version > 0) throw new HttpError(400, 'Nothing has changed.');
            const version = current.version + 1;
            const data = { criteria: criteria.map((c) => ({ code: c.code, enabled: c.enabled, weight: c.weight, whenMissing: c.whenMissing })), classOrder: order, version, updatedAt: nowIso(), updatedBy: ctx.uid };
            await writeDoc(`${evalPath(ctx.orgId)}/versions/${version}`, { ...data, reason }, { exists: false });
            await writeDoc(evalPath(ctx.orgId), data);
            await record(ctx, 'org.procurement.evaluation.save', 'Evaluation metrics', `Version ${version}: ${on.map((c) => `${c.label} ${c.weight}`).join(', ')}. Reason: ${reason}`.slice(0, 400));
            return { ok: true, version };
        }),
    ],

    // The last supplier relationship score of a vendor, used by the evaluation. A vendor with no score is not scored on it.
    'POST /api/org/procurement/vendors/srm': [
        orgRoute('org.procurement.vendors.srm', 'PRC.vendors.manage', async (ctx) => {
            requireProcurement(ctx);
            const id = str(ctx.body.id);
            if (!/^VND\d{6}$/.test(id)) throw new HttpError(404, 'Vendor not found.');
            const score = num(ctx.body.score);
            if (score !== null && (Number.isNaN(score) || score < 0 || score > 100)) throw new HttpError(400, 'Enter a score from 0 to 100, or leave it empty to clear it.');
            const note = oneLine(ctx.body.note, 200);
            if (score !== null && note.length < 5) throw new HttpError(400, 'Say where the score comes from, for example the review period.');
            const path = `organizations/${ctx.orgId}/procurement_vendor_locks/${id}`;
            if (!(await writeDoc(path, { by: ctx.uid, at: nowIso() }, { exists: false }))) throw new HttpError(409, 'This vendor is being updated by someone else. Try again in a moment.');
            try {
                const v = await getDoc(`${vendorsPath(ctx.orgId)}/${id}`);
                if (!v) throw new HttpError(404, 'Vendor not found.');
                const at = nowIso();
                const entry = { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'srm score', note: score === null ? 'Cleared' : `${score} (${note})`, from: str(v.data.status), to: str(v.data.status) };
                await writeDoc(`${vendorsPath(ctx.orgId)}/${id}`, { ...v.data, srmScore: score === null ? null : round(score, 1), srmAt: score === null ? '' : at, srmNote: score === null ? '' : note, history: [...objs(v.data.history), entry].slice(-200) });
                await record(ctx, 'org.procurement.vendor.srm', id, entry.note);
            } finally {
                await deleteDoc(path);
            }
            return { ok: true };
        }),
    ],
};

void KIND_LABEL;
void LINE_KINDS;
export type { LineKind };
