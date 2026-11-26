import { createHash } from 'node:crypto';
import { secrets, storage } from './platform/sdk';
import { HttpError, deleteDoc, getDoc, isObj, listDocs, nowIso, randomId, rateLimit, str, writeDoc, type Doc } from './core';
import { audit } from './audit';
import { orgRoute, type OrgContext } from './guards';
import { bypass } from './testModeCore';
import { orgUsers, record } from './org';
import { allowedNodeIds, nextOrgCounter } from './positions';
import { can, requireProcurement } from './procurementSetup';
import { getAuthority } from './procurementPolicy';
import { vendorsPath } from './vendors';
import { suppliersFor } from './materialMedia';
import { PLACED, approvalRoute, lock, myPositions, nameOfUser, ordersPath, ratesOf, type Step } from './purchaseOrders';
import {
    EDITABLE_ITEMS, FINAL, HOLDING, MAX_ATTACHMENTS, MAX_ITEMS, MAX_PDF_BYTES, PA_ID, PA_STATUS, QUOTING,
    agreementValue, applyToInfo, checkQuote, converter, dashboardOf, inDate, itemKey, overlaps, periodProblems,
    purchaseUnitOf, restoreInfo, settleAction, submitProblems, type OrderLine,
} from './purchaseAgreementModel';

// ---------------------------------------------------------------------------
// Purchase agreements (PA + 8 digits) for spares bought from one supplier for a period.
//
//   organizations/{org}/purchase_agreements/{PA00000001}            the agreement, items, quotes, approval, history
//   organizations/{org}/procurement_material_info/{mat}_{wh}         while active: agreement parameters, with the
//                                                                    material's own values kept in agreementBaseline
//   (storage) organizations/{org}/purchase_agreements/{PA}/{file}.pdf  attachments, immutable, private
//
// Flow: draft (supplier, period, materials and expected quantities) -> RFQ sent to the supplier (email or print)
// -> each item's quote recorded and checked against the material's procurement setup -> submitted -> approved level by
// level under the chart of authority on its value (expected quantity x agreed price, organization currency)
// -> activated (scheduled until the start date) -> active: its parameters are the material's procurement parameters
// -> expired on the end date or terminated (the material's own values come back). An item can be overridden (it goes
// back to the material's own values) with a reason. Everything is checked here, locked, versioned and audited.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const o = (v: unknown): Obj => (isObj(v) ? v : {});
const today = () => new Date().toISOString().slice(0, 10);
const clean = (v: unknown) => str(v).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
const line = (v: unknown, max: number) => clean(v).replace(/\s+/g, ' ').slice(0, max);
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const FILE_ID = /^[a-f0-9]{20}$/;

export const agreementsPath = (orgId: string) => `organizations/${orgId}/purchase_agreements`;
const infoPath = (orgId: string, materialId: string, warehouseId: string) => `organizations/${orgId}/procurement_material_info/${materialId}_${warehouseId}`;
const reasonOf = (b: Obj, min = 20) => {
    const r = clean(b.reason);
    if (r.length < min || r.length > 500) throw new HttpError(400, `Give a reason of ${min} to 500 characters.`);
    return r;
};

// ----- Who may do what -----

const ownerOf = (d: Obj) => str(d.ownerUid) || str(d.createdBy);
const isOwner = (ctx: OrgContext, d: Obj) => ownerOf(d) === ctx.uid;
const steps = (d: Obj): Step[] => objs(o(d.approval).steps) as unknown as Step[];
const currentStep = (d: Obj) => steps(d).find((s) => s.status === 'pending');
const quoters = (d: Obj) => [...new Set(objs(d.items).map((i) => str(o(i.quote).quotedBy)).filter(Boolean))];

/** Only the agreement's owner changes it (the organization super admin in test mode, recorded as a bypass). */
function needOwner(ctx: OrgContext, d: Obj) {
    if (!can(ctx, 'PRC.agreements.manage')) throw new HttpError(403, 'You need the purchase agreement officer right.');
    if (isOwner(ctx, d)) return;
    if (bypass(ctx, 'prc.agreement.owner')) return;
    throw new HttpError(403, 'Only the officer who owns this agreement can change it.');
}

/** May this person approve the current level now, and if not, why not. */
export function approverCheck(ctx: OrgContext, d: Obj): { ok: boolean; why: string; testMode?: boolean } {
    if (str(d.status) !== 'pending_approval') return { ok: false, why: '' };
    const step = currentStep(d);
    if (!step || !can(ctx, 'PRC.agreements.approve')) return { ok: false, why: '' };
    let why = '';
    if (!myPositions(ctx.me).includes(step.positionCode)) why = `Level ${step.level} is approved by ${step.positionTitle}.`;
    else if ([str(d.createdBy), ownerOf(d), str(d.submittedBy)].includes(ctx.uid)) why = 'You prepared or submitted this agreement, so someone else must approve it.';
    else if (quoters(d).includes(ctx.uid)) why = 'You recorded quotes on this agreement, so someone else must approve it.';
    else if (steps(d).some((s) => s.status === 'approved' && s.by === ctx.uid)) why = 'You approved an earlier level, so a different person must approve this one.';
    if (!why) return { ok: true, why: '' };
    if (ctx.testMode === true) return { ok: true, why: '', testMode: true };
    return { ok: false, why };
}

function flags(ctx: OrgContext, d: Obj) {
    const s = str(d.status);
    const manage = can(ctx, 'PRC.agreements.manage') && (isOwner(ctx, d) || ctx.testMode === true);
    const chk = approverCheck(ctx, d);
    return {
        edit: manage && EDITABLE_ITEMS.includes(s),
        items: manage && EDITABLE_ITEMS.includes(s),
        rfq: manage && ['draft', 'rfq_sent', 'returned'].includes(s),
        quote: manage && QUOTING.includes(s),
        attach: manage && ['draft', 'rfq_sent', 'returned'].includes(s),
        submit: manage && QUOTING.includes(s),
        approve: chk.ok,
        approveWhy: s === 'pending_approval' && can(ctx, 'PRC.agreements.approve') && !chk.ok ? chk.why : '',
        activate: manage && s === 'approved',
        override: manage && ['scheduled', 'active'].includes(s),
        terminate: manage && ['approved', 'scheduled', 'active'].includes(s),
        cancel: manage && ['draft', 'rfq_sent', 'returned'].includes(s),
    };
}

// ----- Loading, locking and changing -----

async function load(ctx: OrgContext, id: string): Promise<Doc> {
    requireProcurement(ctx);
    if (!PA_ID.test(id)) throw new HttpError(404, 'Purchase agreement not found.');
    const doc = await getDoc(`${agreementsPath(ctx.orgId)}/${id}`);
    if (!doc) throw new HttpError(404, 'Purchase agreement not found.');
    return doc;
}

interface Change {
    patch: Obj;
    label: string;
    event: string;
    note?: string;
    result?: Obj;
}
/** One change under a lock: re-read, checked, versioned, added to the history and audited. */
async function mutate(ctx: OrgContext, id: string, action: string, run: (d: Obj) => Promise<Change>) {
    return lock(ctx, id, async () => {
        const path = `${agreementsPath(ctx.orgId)}/${id}`;
        const fresh = await getDoc(path);
        if (!fresh) throw new HttpError(404, 'Purchase agreement not found.');
        const d = fresh.data;
        const c = await run(d);
        const at = nowIso();
        const next: Obj = { ...d, ...c.patch, updatedAt: at, updatedBy: ctx.uid, version: (Number(d.version) || 1) + 1 };
        next.history = [...objs(d.history), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: c.event, note: (c.note ?? '').slice(0, 400), from: str(d.status), to: str(next.status) }].slice(-300);
        if (!(await writeDoc(path, next, { updateTime: fresh.updateTime }))) throw new HttpError(409, 'The agreement changed at the same time. Open it again and retry.');
        await record(ctx, `org.procurement.agreement.${action}`, id, `${c.label}${c.note ? `. ${c.note}` : ''}`.slice(0, 400));
        return { ok: true, id, status: str(next.status), ...(c.result ?? {}) };
    });
}

// ----- Reference data -----

async function enabledCurrencies(): Promise<Set<string>> {
    const doc = await getDoc('reference/currencies');
    return new Set(objs(doc?.data.items).filter((c) => c.enabled !== false && /^[A-Z]{3}$/.test(str(c.code))).map((c) => str(c.code)));
}
const vendorName = (v: Doc) => str(v.data.tradeName) || str(v.data.legalName) || v.id;
async function approvedVendor(ctx: OrgContext, id: string): Promise<Doc> {
    if (!/^VND\d{6}$/.test(id)) throw new HttpError(400, 'Choose an approved supplier.');
    const v = await getDoc(`${vendorsPath(ctx.orgId)}/${id}`);
    if (!v || str(v.data.status) !== 'approved') throw new HttpError(409, 'The supplier must be approved in Procurement › Vendors.');
    return v;
}
const published = (m: Doc | null) => !!m && !!str(m.data.materialNumber) && ['approved', 'active'].includes(str(m.data.status).toLowerCase());
function mappedTo(m: Doc, warehouseId: string, exts: Doc[]) {
    const ids = Array.isArray(m.data.warehouseIds) ? (m.data.warehouseIds as unknown[]).map(str) : [];
    if (ids.includes(warehouseId)) return true;
    if (str(m.data.pushedAt) && str(m.data.warehouseId) === warehouseId) return true;
    return exts.some((e) => str(e.data.sourceId) === m.id && str(e.data.warehouseId) === warehouseId && str(e.data.status) === 'approved');
}
async function reach(ctx: OrgContext): Promise<'all' | Set<string>> {
    if (ctx.role === 'org_super_admin') return 'all';
    return allowedNodeIds(ctx.orgId, ctx.me, true);
}

/** Another agreement (in approval, approved, scheduled or active) that already covers the material in the warehouse for overlapping dates. */
async function clashes(ctx: OrgContext, selfId: string, start: string, end: string, keys: Set<string>) {
    const all = await listDocs(agreementsPath(ctx.orgId));
    const out: string[] = [];
    for (const a of all) {
        if (a.id === selfId || !HOLDING.includes(str(a.data.status))) continue;
        if (!overlaps(start, end, str(a.data.startDate), str(a.data.endDate))) continue;
        for (const i of objs(a.data.items)) if (keys.has(itemKey(i)) && o(i.override).on !== true) out.push(`${str(i.materialNumber)} is already under ${str(a.data.number) || a.id} (${str(a.data.startDate)} to ${str(a.data.endDate)}).`);
    }
    return [...new Set(out)];
}

// ----- Applying to and taking off the materials -----

async function applyItems(ctx: OrgContext | null, orgId: string, paId: string, pa: Obj, only?: Set<number>): Promise<{ applied: number[]; blocked: string[] }> {
    const at = nowIso();
    const by = ctx?.uid ?? 'system';
    const applied: number[] = [];
    const blocked: string[] = [];
    for (const i of objs(pa.items)) {
        if (only && !only.has(Number(i.no))) continue;
        if (o(i.override).on === true) continue;
        const path = infoPath(orgId, str(i.materialId), str(i.warehouseId));
        const cur = await getDoc(path);
        const next = applyToInfo(cur?.data ?? {}, pa, paId, i, at, by);
        if (!next) {
            blocked.push(`${str(i.materialNumber)}: held by ${str(o(cur?.data.agreement).number)}`);
            continue;
        }
        const ok = await writeDoc(path, next, cur ? { updateTime: cur.updateTime } : { exists: false });
        if (!ok) blocked.push(`${str(i.materialNumber)}: changed at the same time`);
        else applied.push(Number(i.no));
    }
    return { applied, blocked };
}
async function restoreItems(orgId: string, paId: string, pa: Obj, only?: Set<number>): Promise<number[]> {
    const done: number[] = [];
    for (const i of objs(pa.items)) {
        if (only && !only.has(Number(i.no))) continue;
        const path = infoPath(orgId, str(i.materialId), str(i.warehouseId));
        const cur = await getDoc(path);
        if (!cur) continue;
        const next = restoreInfo(cur.data, paId);
        if (!next) continue;
        if (await writeDoc(path, next, { updateTime: cur.updateTime })) done.push(Number(i.no));
    }
    return done;
}
const markItems = (items: Obj[], nos: number[], applied: boolean) => items.map((i) => (nos.includes(Number(i.no)) ? { ...i, applied } : i));

/**
 * Starts agreements whose start date has come and ends those past their end date, restoring the materials' own values.
 * Run on every list and by the daily automation job. Returns what changed.
 */
export async function settleAgreements(orgId: string, ctx: OrgContext | null = null): Promise<{ started: string[]; expired: string[] }> {
    const started: string[] = [];
    const expired: string[] = [];
    const day = today();
    for (const a of await listDocs(agreementsPath(orgId))) {
        const action = settleAction(a.data, day);
        if (!action) continue;
        const lockPath = `organizations/${orgId}/procurement_order_locks/${a.id}`;
        if (!(await writeDoc(lockPath, { by: ctx?.uid ?? 'system', at: nowIso() }, { exists: false }))) continue;
        try {
            const fresh = await getDoc(`${agreementsPath(orgId)}/${a.id}`);
            if (!fresh || settleAction(fresh.data, day) !== action) continue;
            const d = fresh.data;
            const at = nowIso();
            let patch: Obj;
            let note: string;
            if (action === 'start') {
                const r = await applyItems(ctx, orgId, a.id, d);
                patch = { status: 'active', activatedAt: str(d.activatedAt) || at, startedAt: at, items: markItems(objs(d.items), r.applied, true), applyProblems: r.blocked };
                note = `Started on ${day}: ${r.applied.length} material(s) now use the agreement${r.blocked.length ? `; not applied: ${r.blocked.join('; ')}` : ''}`;
                started.push(a.id);
            } else {
                const r = await restoreItems(orgId, a.id, d);
                patch = { status: 'expired', expiredAt: at, items: markItems(objs(d.items), r, false) };
                note = `Ended on ${str(d.endDate)}: ${r.length} material(s) back on their own procurement parameters`;
                expired.push(a.id);
            }
            const next = { ...d, ...patch, updatedAt: at, version: (Number(d.version) || 1) + 1, history: [...objs(d.history), { at, by: 'system', byName: 'Automatic (agreement dates)', action: action === 'start' ? 'started' : 'expired', note, from: str(d.status), to: str(patch.status) }].slice(-300) };
            if (await writeDoc(`${agreementsPath(orgId)}/${a.id}`, next, { updateTime: fresh.updateTime })) {
                await audit([{ category: 'data', action: `org.procurement.agreement.${action === 'start' ? 'start' : 'expire'}`, actor: ctx?.actor ?? null, meta: ctx?.meta ?? null, target: { label: a.id }, details: note.slice(0, 400), orgId }]);
            }
        } finally {
            await deleteDoc(lockPath);
        }
    }
    return { started, expired };
}

// ----- Dashboard -----

async function orderLines(orgId: string, vendorId: string): Promise<OrderLine[]> {
    const out: OrderLine[] = [];
    for (const p of await listDocs(ordersPath(orgId))) {
        const d = p.data;
        if (str(d.vendorId) !== vendorId || !PLACED.includes(str(d.status))) continue;
        const date = (str(d.approvedAt) || str(d.orderDate) || str(d.createdAt)).slice(0, 10);
        for (const l of objs(d.lines)) {
            if (!str(l.materialId)) continue;
            out.push({ orderId: p.id, orderNumber: str(d.number) || p.id, vendorId, status: str(d.status), date, currency: str(d.currency), materialId: str(l.materialId), warehouseId: str(l.warehouseId), quantity: Number(l.quantity) || 0, receivedQty: Number(l.receivedQty) || 0, netUnitPrice: Number(l.netUnitPrice) || Number(l.unitPrice) || 0 });
        }
    }
    return out;
}
async function dashboard(ctx: OrgContext, d: Obj) {
    const orgCurrency = str(ctx.org.data.currencyCode);
    const { rate } = await ratesOf(orgCurrency);
    const lines = await orderLines(ctx.orgId, str(d.vendorId));
    return dashboardOf(d, objs(d.items), lines, converter(rate));
}

// ----- Shapes for the screen -----

function row(id: string, d: Obj) {
    const items = objs(d.items);
    const day = today();
    return {
        id,
        number: str(d.number) || id,
        title: str(d.title),
        vendorId: str(d.vendorId),
        vendorNumber: str(d.vendorNumber),
        vendorName: str(d.vendorName),
        status: str(d.status),
        statusLabel: PA_STATUS[str(d.status)] ?? str(d.status),
        startDate: str(d.startDate),
        endDate: str(d.endDate),
        currency: str(d.currency),
        items: items.length,
        quoted: items.filter((i) => Number(o(i.quote).unitPrice) > 0).length,
        applied: items.filter((i) => i.applied === true).length,
        value: Number(o(d.approval).amount) || Number(d.estimatedValue) || 0,
        orgCurrency: str(d.orgCurrency),
        daysRemaining: ['active', 'scheduled', 'approved'].includes(str(d.status)) && str(d.endDate) >= day ? Math.max(0, Math.round((Date.parse(`${str(d.endDate)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000)) : null,
        inDate: inDate(d, day),
        ownerName: str(d.ownerName),
        updatedAt: str(d.updatedAt) || str(d.createdAt),
    };
}
const attachmentsOut = (d: Obj) => objs(d.attachments).map((a) => ({ id: str(a.id), name: str(a.name), mime: str(a.mime), bytes: Number(a.bytes) || 0, sha256: str(a.sha256), uploadedAt: str(a.uploadedAt), uploadedByName: str(a.uploadedByName) }));

// ----- Routes -----

export const purchaseAgreementRoutes = {
    'POST /api/org/procurement/agreements/list': [
        orgRoute('org.procurement.agreements.list', 'PRC.agreements.view', async (ctx) => {
            requireProcurement(ctx);
            await settleAgreements(ctx.orgId, ctx);
            const docs = await listDocs(agreementsPath(ctx.orgId));
            return {
                agreements: docs.map((a) => row(a.id, a.data)).sort((a, b) => b.number.localeCompare(a.number)),
                can: { manage: can(ctx, 'PRC.agreements.manage'), approve: can(ctx, 'PRC.agreements.approve') },
                orgCurrency: str(ctx.org.data.currencyCode),
            };
        }),
    ],

    'POST /api/org/procurement/agreements/get': [
        orgRoute('org.procurement.agreements.get', 'PRC.agreements.view', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const d = doc.data;
            const live = !['draft', 'rfq_sent', 'returned', 'pending_approval', 'rejected', 'cancelled'].includes(str(d.status));
            return {
                agreement: {
                    ...row(doc.id, d),
                    notes: str(d.notes),
                    quoteReference: str(d.quoteReference),
                    quoteDate: str(d.quoteDate),
                    vendorEmail: str(d.vendorEmail),
                    rfq: o(d.rfq),
                    items: objs(d.items),
                    attachments: attachmentsOut(d),
                    approval: o(d.approval),
                    history: objs(d.history).slice().reverse(),
                    applyProblems: Array.isArray(d.applyProblems) ? d.applyProblems : [],
                    returnReason: str(d.returnReason),
                    rejectReason: str(d.rejectReason),
                    terminateReason: str(d.terminateReason),
                    createdAt: str(d.createdAt),
                    version: Number(d.version) || 1,
                },
                can: flags(ctx, d),
                currencies: [...(await enabledCurrencies())].sort(),
                dashboard: live || objs(d.items).some((i) => isObj(i.quote)) ? await dashboard(ctx, d) : null,
            };
        }),
    ],

    // Approved suppliers and enabled currencies for a new agreement.
    'POST /api/org/procurement/agreements/options': [
        orgRoute('org.procurement.agreements.options', 'PRC.agreements.manage', async (ctx) => {
            requireProcurement(ctx);
            const [vendors, currencies] = await Promise.all([listDocs(vendorsPath(ctx.orgId)), enabledCurrencies()]);
            return {
                vendors: vendors.filter((v) => str(v.data.status) === 'approved').map((v) => ({ id: v.id, number: str(v.data.number) || v.id, name: vendorName(v), currency: str(v.data.currencyCode), paymentTerms: str(v.data.paymentTermsLabel), email: !!str(o(v.data.contact).email), materialScopes: objs(v.data.scopes).filter((s) => str(s.kind) === 'material').length })).sort((a, b) => a.name.localeCompare(b.name)),
                currencies: [...currencies].sort(),
                orgCurrency: str(ctx.org.data.currencyCode),
            };
        }),
    ],

    // Spares the supplier can supply (its approved material scope), in warehouses the officer works in, with their
    // current procurement setup. Materials already on this agreement are marked.
    'POST /api/org/procurement/agreements/candidates': [
        orgRoute('org.procurement.agreements.candidates', 'PRC.agreements.manage', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const vendor = await approvedVendor(ctx, str(doc.data.vendorId));
            const root = `organizations/${ctx.orgId}`;
            const [materials, exts, infos, warehouses, allowed] = await Promise.all([listDocs(`${root}/materials`), listDocs(`${root}/material_extensions`), listDocs(`${root}/procurement_material_info`), listDocs(`${root}/warehouses`), reach(ctx)]);
            const infoMap = new Map(infos.map((i) => [i.id, i.data]));
            const taken = new Set(objs(doc.data.items).map(itemKey));
            const out: Obj[] = [];
            for (const w of warehouses) {
                if (allowed !== 'all' && !allowed.has(w.id)) continue;
                for (const m of materials) {
                    if (!published(m) || !mappedTo(m, w.id, exts)) continue;
                    if (!suppliersFor([vendor], m.data).length) continue;
                    const info = infoMap.get(`${m.id}_${w.id}`) ?? {};
                    const held = o(info.agreement);
                    out.push({
                        materialId: m.id, materialNumber: str(m.data.materialNumber), name: str(m.data.name) || str(m.data.shortText),
                        warehouseId: w.id, warehouseCode: str(w.data.code), warehouseName: str(w.data.name),
                        categoryCode: str(m.data.categoryCode), subcategoryCode: str(m.data.subcategoryCode),
                        purchaseUom: purchaseUnitOf(info, m.data), standardPrice: info.unitPrice === '' || info.unitPrice === undefined ? null : Number(info.unitPrice), standardCurrency: str(info.priceCurrency),
                        leadTimeDays: info.leadTimeDays ?? null, preferred: str(info.preferredVendor) === vendor.id,
                        heldBy: str(held.number), onThis: taken.has(`${m.id}|${w.id}`),
                    });
                }
            }
            return { candidates: out.sort((a, b) => Number(b.preferred) - Number(a.preferred) || str(a.materialNumber).localeCompare(str(b.materialNumber))).slice(0, 2000) };
        }),
    ],

    'POST /api/org/procurement/agreements/create': [
        orgRoute('org.procurement.agreements.create', 'PRC.agreements.manage', async (ctx) => {
            requireProcurement(ctx);
            await rateLimit('prc-agreement-create', ctx.uid, 30, 3600);
            if (ctx.body.confirm !== true) throw new HttpError(400, 'Confirm the supplier and the agreement period.');
            const vendor = await approvedVendor(ctx, str(ctx.body.vendorId));
            const title = line(ctx.body.title, 120);
            if (title.length < 3) throw new HttpError(400, 'Give the agreement a title of at least 3 characters.');
            const startDate = str(ctx.body.startDate), endDate = str(ctx.body.endDate);
            const period = periodProblems(startDate, endDate);
            if (period.length) throw new HttpError(400, period.join(' '));
            const currency = str(ctx.body.currency).toUpperCase() || str(vendor.data.currencyCode) || str(ctx.org.data.currencyCode);
            if (!(await enabledCurrencies()).has(currency)) throw new HttpError(400, 'Choose an enabled agreement currency.');
            const n = await nextOrgCounter(ctx.orgId, 'agreementSeq');
            if (n > 99_999_999) throw new HttpError(500, 'The agreement number range is exhausted.');
            const id = `PA${String(n).padStart(8, '0')}`;
            const at = nowIso();
            const d: Obj = {
                number: id, title, notes: clean(ctx.body.notes).slice(0, 2000),
                vendorId: vendor.id, vendorNumber: str(vendor.data.number) || vendor.id, vendorName: vendorName(vendor), vendorEmail: str(o(vendor.data.contact).email),
                startDate, endDate, currency, orgCurrency: str(ctx.org.data.currencyCode),
                status: 'draft', items: [], itemSeq: 0, attachments: [],
                createdAt: at, createdBy: ctx.uid, ownerUid: ctx.uid, ownerName: nameOfUser(ctx.me), version: 1,
                history: [{ at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'created', note: `${vendorName(vendor)} · ${startDate} to ${endDate}`, from: '', to: 'draft' }],
            };
            if (!(await writeDoc(`${agreementsPath(ctx.orgId)}/${id}`, d, { exists: false }))) throw new HttpError(409, 'That agreement number is taken. Try again.');
            await record(ctx, 'org.procurement.agreement.create', id, `${title} · ${vendorName(vendor)} · ${startDate} to ${endDate}`);
            return { ok: true, id };
        }),
    ],

    // Header changes while the agreement is a draft or returned.
    'POST /api/org/procurement/agreements/save': [
        orgRoute('org.procurement.agreements.save', 'PRC.agreements.manage', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            return mutate(ctx, doc.id, 'save', async (d) => {
                needOwner(ctx, d);
                if (Number(ctx.body.version) !== (Number(d.version) || 1)) throw new HttpError(409, 'Someone changed this agreement since you opened it. Open it again.');
                const s = str(d.status);
                if (!['draft', 'rfq_sent', 'returned'].includes(s)) throw new HttpError(409, 'The agreement can no longer be changed.');
                const title = line(ctx.body.title, 120);
                if (title.length < 3) throw new HttpError(400, 'Give the agreement a title of at least 3 characters.');
                const startDate = str(ctx.body.startDate), endDate = str(ctx.body.endDate);
                const period = periodProblems(startDate, endDate);
                if (period.length) throw new HttpError(400, period.join(' '));
                const currency = str(ctx.body.currency).toUpperCase();
                if (!(await enabledCurrencies()).has(currency)) throw new HttpError(400, 'Choose an enabled agreement currency.');
                const quoteDate = str(ctx.body.quoteDate);
                if (quoteDate && (!/^\d{4}-\d{2}-\d{2}$/.test(quoteDate) || quoteDate > today())) throw new HttpError(400, 'The quote date cannot be in the future.');
                const patch: Obj = { title, startDate, endDate, currency, notes: clean(ctx.body.notes).slice(0, 2000), quoteReference: line(ctx.body.quoteReference, 80), quoteDate };
                const changed = Object.keys(patch).filter((k) => str(patch[k]) !== str(d[k]));
                return { patch, event: 'edited', note: changed.length ? `Changed: ${changed.join(', ')}` : 'No change', label: 'Agreement details saved' };
            });
        }),
    ],

    'POST /api/org/procurement/agreements/items/add': [
        orgRoute('org.procurement.agreements.items.add', 'PRC.agreements.manage', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const wanted = objs(ctx.body.items).slice(0, MAX_ITEMS);
            if (!wanted.length) throw new HttpError(400, 'Choose at least one material.');
            const root = `organizations/${ctx.orgId}`;
            const vendor = await approvedVendor(ctx, str(doc.data.vendorId));
            const [exts, allowed] = await Promise.all([listDocs(`${root}/material_extensions`), reach(ctx)]);
            return mutate(ctx, doc.id, 'items.add', async (d) => {
                needOwner(ctx, d);
                if (!EDITABLE_ITEMS.includes(str(d.status))) throw new HttpError(409, 'Materials are added while the agreement is a draft or returned.');
                const items = objs(d.items);
                if (items.length + wanted.length > MAX_ITEMS) throw new HttpError(400, `An agreement can hold at most ${MAX_ITEMS} materials.`);
                const have = new Set(items.map(itemKey));
                let seq = Number(d.itemSeq) || items.reduce((m, i) => Math.max(m, Number(i.no) || 0), 0);
                const added: Obj[] = [];
                for (const w of wanted) {
                    const materialId = str(w.materialId), warehouseId = str(w.warehouseId);
                    if (!SAFE_ID.test(materialId) || !SAFE_ID.test(warehouseId)) throw new HttpError(400, 'Choose the material and warehouse.');
                    const qty = Number(w.expectedQty);
                    if (!Number.isFinite(qty) || qty <= 0 || qty > 1e12) throw new HttpError(400, 'Enter an expected quantity above zero for every material.');
                    if (have.has(`${materialId}|${warehouseId}`)) throw new HttpError(409, 'A material is already on this agreement for that warehouse.');
                    if (allowed !== 'all' && !allowed.has(warehouseId)) throw new HttpError(403, 'You can add materials only for warehouses you work in.');
                    const [m, wh, info] = await Promise.all([getDoc(`${root}/materials/${materialId}`), getDoc(`${root}/warehouses/${warehouseId}`), getDoc(infoPath(ctx.orgId, materialId, warehouseId))]);
                    if (!published(m) || !wh || !mappedTo(m!, warehouseId, exts)) throw new HttpError(409, 'The material must be approved and mapped to the warehouse.');
                    if (!suppliersFor([vendor], m!.data).length) throw new HttpError(409, `${str(m!.data.materialNumber)}: ${vendorName(vendor)} is not approved for this material's category.`);
                    const i = info?.data ?? {};
                    seq += 10;
                    have.add(`${materialId}|${warehouseId}`);
                    added.push({
                        no: seq, materialId, materialNumber: str(m!.data.materialNumber), name: (str(m!.data.name) || str(m!.data.shortText)).slice(0, 160),
                        warehouseId, warehouseCode: str(wh.data.code), warehouseName: str(wh.data.name),
                        categoryCode: str(m!.data.categoryCode), subcategoryCode: str(m!.data.subcategoryCode),
                        purchaseUom: purchaseUnitOf(i, m!.data), expectedQty: qty,
                        // The material's procurement setup when it was added: kept as the previous figures.
                        standard: { unitPrice: i.unitPrice ?? '', currency: str(i.priceCurrency), leadTimeDays: i.leadTimeDays ?? '', minimumOrderQuantity: i.minimumOrderQuantity ?? '', orderMultiple: i.orderMultiple ?? '', vendorPartNumber: str(i.vendorPartNumber), paymentTerms: str(i.paymentTerms), incoterms: str(i.incoterms), preferredVendorName: str(i.preferredVendorName) },
                        applied: false,
                    });
                }
                const clash = await clashes(ctx, doc.id, str(d.startDate), str(d.endDate), new Set(added.map(itemKey)));
                if (clash.length) throw new HttpError(409, clash.join(' '));
                return { patch: { items: [...items, ...added], itemSeq: seq }, event: 'materials added', note: added.map((a) => `${a.no} ${a.materialNumber}`).join(', ').slice(0, 380), label: `${added.length} material(s) added` };
            });
        }),
    ],

    'POST /api/org/procurement/agreements/items/update': [
        orgRoute('org.procurement.agreements.items.update', 'PRC.agreements.manage', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const no = Number(ctx.body.no);
            const qty = Number(ctx.body.expectedQty);
            if (!Number.isFinite(qty) || qty <= 0 || qty > 1e12) throw new HttpError(400, 'Enter an expected quantity above zero.');
            return mutate(ctx, doc.id, 'items.update', async (d) => {
                needOwner(ctx, d);
                if (!EDITABLE_ITEMS.includes(str(d.status)) && !QUOTING.includes(str(d.status))) throw new HttpError(409, 'Quantities change only before the agreement is submitted.');
                const items = objs(d.items);
                const it = items.find((i) => Number(i.no) === no);
                if (!it) throw new HttpError(404, 'Item not found.');
                return { patch: { items: items.map((i) => (i === it ? { ...i, expectedQty: qty } : i)) }, event: 'quantity changed', note: `Item ${no}: ${Number(it.expectedQty)} to ${qty}`, label: 'Expected quantity changed' };
            });
        }),
    ],

    'POST /api/org/procurement/agreements/items/remove': [
        orgRoute('org.procurement.agreements.items.remove', 'PRC.agreements.manage', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const no = Number(ctx.body.no);
            return mutate(ctx, doc.id, 'items.remove', async (d) => {
                needOwner(ctx, d);
                if (!EDITABLE_ITEMS.includes(str(d.status))) throw new HttpError(409, 'Materials are removed while the agreement is a draft or returned.');
                const items = objs(d.items);
                const it = items.find((i) => Number(i.no) === no);
                if (!it) throw new HttpError(404, 'Item not found.');
                return { patch: { items: items.filter((i) => i !== it) }, event: 'material removed', note: `${no} ${str(it.materialNumber)}`, label: 'Material removed' };
            });
        }),
    ],

    // The supplier's quote for one item, checked against the material's procurement setup.
    'POST /api/org/procurement/agreements/items/quote': [
        orgRoute('org.procurement.agreements.items.quote', 'PRC.agreements.manage', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const no = Number(ctx.body.no);
            const currencies = await enabledCurrencies();
            return mutate(ctx, doc.id, 'items.quote', async (d) => {
                needOwner(ctx, d);
                if (!QUOTING.includes(str(d.status))) throw new HttpError(409, 'Send the RFQ to the supplier first. Quotes are recorded until the agreement is submitted.');
                const items = objs(d.items);
                const it = items.find((i) => Number(i.no) === no);
                if (!it) throw new HttpError(404, 'Item not found.');
                const [m, info] = await Promise.all([getDoc(`organizations/${ctx.orgId}/materials/${str(it.materialId)}`), getDoc(infoPath(ctx.orgId, str(it.materialId), str(it.warehouseId)))]);
                if (!published(m)) throw new HttpError(409, `${str(it.materialNumber)} is no longer an approved material.`);
                const { quote, problems } = checkQuote(o(ctx.body.quote), { info: info?.data ?? {}, material: m!.data, enabledCurrencies: currencies, label: `Item ${no} ${str(it.materialNumber)}` });
                if (problems.length) throw new HttpError(400, problems.join(' '));
                const at = nowIso();
                const prev = o(it.quote);
                const next = { ...it, quote: { ...quote, quotedAt: at, quotedBy: ctx.uid, quotedByName: nameOfUser(ctx.me) }, previousQuote: Object.keys(prev).length ? prev : it.previousQuote ?? null };
                return { patch: { items: items.map((i) => (i === it ? next : i)) }, event: 'quote recorded', note: `Item ${no} ${str(it.materialNumber)}: ${quote.currency} ${quote.unitPrice} per ${quote.uom}, ${quote.leadTimeDays} days`, label: 'Quote recorded' };
            });
        }),
    ],

    // Request for quotation to the supplier: by email (when the email service is set up) or printed and sent.
    'POST /api/org/procurement/agreements/rfq/send': [
        orgRoute('org.procurement.agreements.rfq.send', 'PRC.agreements.manage', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const method = str(ctx.body.method) === 'email' ? 'email' : 'print';
            const dueDate = str(ctx.body.dueDate);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < today()) throw new HttpError(400, 'Enter the date the quote is due (today or later).');
            if (ctx.body.confirm !== true) throw new HttpError(400, 'Confirm the materials and quantities going to the supplier.');
            return mutate(ctx, doc.id, 'rfq.send', async (d) => {
                needOwner(ctx, d);
                if (!['draft', 'rfq_sent', 'returned'].includes(str(d.status))) throw new HttpError(409, 'The RFQ can no longer be sent.');
                if (!objs(d.items).length) throw new HttpError(409, 'Add the materials before sending the RFQ.');
                await approvedVendor(ctx, str(d.vendorId));
                if (method === 'email') await emailRfq(ctx, d, dueDate, line(ctx.body.note, 600));
                const at = nowIso();
                const rfq = { sentAt: at, sentBy: ctx.uid, sentByName: nameOfUser(ctx.me), method, dueDate, note: line(ctx.body.note, 600), count: (Number(o(d.rfq).count) || 0) + 1 };
                return { patch: { rfq, status: str(d.status) === 'draft' ? 'rfq_sent' : str(d.status) }, event: method === 'email' ? 'RFQ emailed' : 'RFQ printed and sent', note: `Quote due ${dueDate}`, label: 'RFQ sent to the supplier' };
            });
        }),
    ],

    'POST /api/org/procurement/agreements/submit': [
        orgRoute('org.procurement.agreements.submit', 'PRC.agreements.manage', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            if (ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that the quotes match the supplier\'s quote and the attached document.');
            const currencies = await enabledCurrencies();
            return mutate(ctx, doc.id, 'submit', async (d) => {
                needOwner(ctx, d);
                if (!QUOTING.includes(str(d.status))) throw new HttpError(409, 'Only an agreement with the RFQ sent (or returned) can be submitted.');
                const items = objs(d.items);
                const problems = submitProblems(d, items, objs(d.attachments));
                // Every quote is checked again against the material's procurement setup of today.
                for (const i of items) {
                    const [m, info] = await Promise.all([getDoc(`organizations/${ctx.orgId}/materials/${str(i.materialId)}`), getDoc(infoPath(ctx.orgId, str(i.materialId), str(i.warehouseId)))]);
                    if (!published(m)) { problems.push(`${str(i.materialNumber)} is no longer an approved material.`); continue; }
                    if (isObj(i.quote)) problems.push(...checkQuote(o(i.quote), { info: info?.data ?? {}, material: m!.data, enabledCurrencies: currencies, label: `Item ${Number(i.no)} ${str(i.materialNumber)}` }).problems);
                }
                const vendor = await approvedVendor(ctx, str(d.vendorId));
                for (const i of items) if (!suppliersFor([vendor], { categoryCode: i.categoryCode, subcategoryCode: i.subcategoryCode }).length) problems.push(`${str(i.materialNumber)}: the supplier is no longer approved for its category.`);
                problems.push(...(await clashes(ctx, doc.id, str(d.startDate), str(d.endDate), new Set(items.map(itemKey)))));
                if (problems.length) throw new HttpError(409, [...new Set(problems)].join(' '));
                const orgCurrency = str(ctx.org.data.currencyCode);
                const { rate } = await ratesOf(orgCurrency);
                const value = agreementValue(items, rate);
                if (value.missing.length) throw new HttpError(409, `No exchange rate to ${orgCurrency} for ${value.missing.join(', ')}. The chart of authority needs the value in ${orgCurrency}.`);
                const authority = await getAuthority(ctx.orgId);
                const users = await orgUsers(ctx.orgId);
                const owner = users.find((u) => u.id === ownerOf(d)) ?? null;
                const route = await approvalRoute(ctx.orgId, owner, value.value, authority, ctx.testMode === true);
                if (route.problems.length && !bypass(ctx, 'prc.agreement.authority_route')) throw new HttpError(409, route.problems.join(' '));
                if (!route.steps.length) throw new HttpError(409, 'The chart of authority gives no approval level for this value. Ask the chart of authority administrator to set the bands.');
                const at = nowIso();
                return {
                    patch: { status: 'pending_approval', submittedAt: at, submittedBy: ctx.uid, submittedByName: nameOfUser(ctx.me), estimatedValue: value.value, orgCurrency, approval: { amount: value.value, steps: route.steps, authorityVersion: route.authorityVersion, startedAt: at }, returnReason: '' },
                    event: 'submitted for approval',
                    note: `${route.steps.map((s) => `${s.level} ${s.positionTitle}`).join(' then ')} to approve ${orgCurrency} ${value.value.toLocaleString('en-US')}`,
                    label: 'Submitted for approval',
                };
            });
        }),
    ],

    'POST /api/org/procurement/agreements/approve': [
        orgRoute('org.procurement.agreements.approve', 'PRC.agreements.approve', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            if (ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that you have reviewed the agreement, its quotes, attachment and value.');
            const note = line(ctx.body.note, 300);
            return mutate(ctx, doc.id, 'approve', async (d) => {
                const chk = approverCheck(ctx, d);
                if (!chk.ok) throw new HttpError(403, chk.why || 'You cannot approve this agreement now.');
                if (chk.testMode) bypass(ctx, 'prc.agreement.approver_authority');
                const cur = currentStep(d)!;
                const at = nowIso();
                const list = steps(d).map((s) => (s.level === cur.level ? { ...s, status: 'approved' as const, by: ctx.uid, byName: nameOfUser(ctx.me), at, note } : s));
                const done = list.every((s) => s.status === 'approved');
                return { patch: { approval: { ...o(d.approval), steps: list }, ...(done ? { status: 'approved', approvedAt: at } : {}) }, event: `approved ${cur.level} (${cur.positionTitle})`, note, label: done ? 'Fully approved' : `Approved level ${cur.level}`, result: { done } };
            });
        }),
    ],

    'POST /api/org/procurement/agreements/return': [
        orgRoute('org.procurement.agreements.return', 'PRC.agreements.approve', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body);
            return mutate(ctx, doc.id, 'return', async (d) => {
                const chk = approverCheck(ctx, d);
                if (!chk.ok) throw new HttpError(403, chk.why || 'You cannot return this agreement now.');
                if (chk.testMode) bypass(ctx, 'prc.agreement.approver_authority');
                return { patch: { status: 'returned', returnReason: reason, returnedBy: ctx.uid, returnedByName: nameOfUser(ctx.me), approval: { ...o(d.approval), returnedAt: nowIso() } }, event: 'returned for correction', note: reason, label: 'Returned to the officer' };
            });
        }),
    ],

    'POST /api/org/procurement/agreements/reject': [
        orgRoute('org.procurement.agreements.reject', 'PRC.agreements.approve', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body);
            return mutate(ctx, doc.id, 'reject', async (d) => {
                const chk = approverCheck(ctx, d);
                if (!chk.ok) throw new HttpError(403, chk.why || 'You cannot reject this agreement now.');
                if (chk.testMode) bypass(ctx, 'prc.agreement.approver_authority');
                return { patch: { status: 'rejected', rejectReason: reason, rejectedBy: ctx.uid, rejectedByName: nameOfUser(ctx.me) }, event: 'rejected', note: reason, label: 'Rejected' };
            });
        }),
    ],

    // Activation: from the start date (today or later) the agreement's parameters become the materials' procurement parameters.
    'POST /api/org/procurement/agreements/activate': [
        orgRoute('org.procurement.agreements.activate', 'PRC.agreements.manage', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            if (ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that the agreement parameters replace the materials\' procurement parameters while it is active.');
            let applyNow = false;
            const out = await mutate(ctx, doc.id, 'activate', async (d) => {
                needOwner(ctx, d);
                if (str(d.status) !== 'approved') throw new HttpError(409, 'Only a fully approved agreement can be activated.');
                if (str(d.endDate) < today()) throw new HttpError(409, 'The agreement period has already ended.');
                const clash = await clashes(ctx, doc.id, str(d.startDate), str(d.endDate), new Set(objs(d.items).map(itemKey)));
                if (clash.length) throw new HttpError(409, clash.join(' '));
                applyNow = inDate(d);
                const at = nowIso();
                return { patch: { status: 'scheduled', activatedAt: at, activatedBy: ctx.uid, activatedByName: nameOfUser(ctx.me) }, event: 'activated', note: applyNow ? 'Starts now' : `Starts on ${str(d.startDate)}`, label: applyNow ? 'Activated' : `Activated, starts on ${str(d.startDate)}` };
            });
            if (applyNow) await settleAgreements(ctx.orgId, ctx);
            const fresh = await getDoc(`${agreementsPath(ctx.orgId)}/${doc.id}`);
            return { ...out, status: str(fresh?.data.status) || out.status, applyProblems: fresh?.data.applyProblems ?? [] };
        }),
    ],

    // Override one item: it goes back to the material's own procurement parameters (on), or uses the agreement again (off).
    'POST /api/org/procurement/agreements/items/override': [
        orgRoute('org.procurement.agreements.items.override', 'PRC.agreements.manage', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const no = Number(ctx.body.no);
            const on = ctx.body.on === true;
            const reason = reasonOf(ctx.body);
            return mutate(ctx, doc.id, 'items.override', async (d) => {
                needOwner(ctx, d);
                if (!['scheduled', 'active'].includes(str(d.status))) throw new HttpError(409, 'Items are overridden while the agreement is activated.');
                const items = objs(d.items);
                const it = items.find((i) => Number(i.no) === no);
                if (!it) throw new HttpError(404, 'Item not found.');
                if ((o(it.override).on === true) === on) throw new HttpError(409, on ? 'This item is already overridden.' : 'This item already uses the agreement.');
                const at = nowIso();
                let applied = it.applied === true;
                let problem = '';
                if (on && applied) {
                    applied = !(await restoreItems(ctx.orgId, doc.id, d, new Set([no]))).includes(no);
                } else if (!on && str(d.status) === 'active') {
                    const clash = await clashes(ctx, doc.id, str(d.startDate), str(d.endDate), new Set([itemKey(it)]));
                    if (clash.length) throw new HttpError(409, clash.join(' '));
                    const r = await applyItems(ctx, ctx.orgId, doc.id, { ...d, items: [{ ...it, override: { on: false } }] });
                    applied = r.applied.includes(no);
                    problem = r.blocked.join('; ');
                    if (problem) throw new HttpError(409, `Not applied: ${problem}`);
                }
                const override = { on, reason, by: ctx.uid, byName: nameOfUser(ctx.me), at };
                return { patch: { items: items.map((i) => (i === it ? { ...i, applied, override, overrides: [...objs(i.overrides), override].slice(-20) } : i)) }, event: on ? 'item overridden' : 'override removed', note: `Item ${no} ${str(it.materialNumber)}: ${reason}`, label: on ? 'Item uses the material\'s own parameters' : 'Item uses the agreement again' };
            });
        }),
    ],

    'POST /api/org/procurement/agreements/terminate': [
        orgRoute('org.procurement.agreements.terminate', 'PRC.agreements.manage', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body);
            if (ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that the materials go back to their own procurement parameters.');
            return mutate(ctx, doc.id, 'terminate', async (d) => {
                needOwner(ctx, d);
                if (!['approved', 'scheduled', 'active'].includes(str(d.status))) throw new HttpError(409, 'Only an approved or activated agreement can be terminated.');
                const restored = await restoreItems(ctx.orgId, doc.id, d);
                return { patch: { status: 'terminated', terminatedAt: nowIso(), terminatedBy: ctx.uid, terminatedByName: nameOfUser(ctx.me), terminateReason: reason, items: markItems(objs(d.items), restored, false) }, event: 'terminated', note: `${reason} (${restored.length} material(s) restored)`, label: 'Terminated' };
            });
        }),
    ],

    'POST /api/org/procurement/agreements/cancel': [
        orgRoute('org.procurement.agreements.cancel', 'PRC.agreements.manage', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body, 10);
            return mutate(ctx, doc.id, 'cancel', async (d) => {
                needOwner(ctx, d);
                if (!['draft', 'rfq_sent', 'returned'].includes(str(d.status))) throw new HttpError(409, 'Only an agreement that is not yet submitted can be cancelled.');
                return { patch: { status: 'cancelled', cancelReason: reason, cancelledAt: nowIso(), cancelledBy: ctx.uid }, event: 'cancelled', note: reason, label: 'Cancelled' };
            });
        }),
    ],

    // PDF attachments (the agreement, the supplier's signed quote): header-checked, hashed, stored privately and immutably.
    'POST /api/org/procurement/agreements/attachment/upload': [
        orgRoute('org.procurement.agreements.attachment.upload', 'PRC.agreements.manage', async (ctx) => {
            await rateLimit('prc-agreement-upload', ctx.uid, 30, 3600);
            const doc = await load(ctx, str(ctx.body.id));
            const mime = str(ctx.body.mime);
            const name = line(ctx.body.name, 160).replace(/[<>\\]/g, '');
            if (mime !== 'application/pdf' || !name) throw new HttpError(400, 'Attach a PDF file.');
            const raw = str(ctx.body.data).replace(/^data:application\/pdf;base64,/, '');
            if (!raw || raw.length > Math.ceil((MAX_PDF_BYTES * 4) / 3) + 8 || !/^[A-Za-z0-9+/=]+$/.test(raw)) throw new HttpError(413, `The PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
            const bytes = Buffer.from(raw, 'base64');
            if (!bytes.length || bytes.length > MAX_PDF_BYTES) throw new HttpError(413, `The PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
            if (bytes.toString('latin1', 0, 5) !== '%PDF-') throw new HttpError(400, 'The file is not a PDF.');
            const sha256 = createHash('sha256').update(bytes).digest('hex');
            return mutate(ctx, doc.id, 'attachment.upload', async (d) => {
                needOwner(ctx, d);
                if (!['draft', 'rfq_sent', 'returned'].includes(str(d.status))) throw new HttpError(409, 'Attachments are added before the agreement is submitted.');
                const list = objs(d.attachments);
                if (list.length >= MAX_ATTACHMENTS) throw new HttpError(409, `An agreement holds at most ${MAX_ATTACHMENTS} attachments.`);
                if (list.some((a) => str(a.sha256) === sha256)) throw new HttpError(409, 'This file is already attached.');
                const id = randomId(10);
                const storagePath = `organizations/${ctx.orgId}/purchase_agreements/${doc.id}/${id}.pdf`;
                const [ok] = await storage.writeImmutable([{ path: storagePath, content: raw, contentType: mime }]);
                if (!ok) throw new HttpError(502, 'The file could not be stored. Try again.');
                const meta = { id, name, mime, bytes: bytes.length, sha256, storagePath, uploadedAt: nowIso(), uploadedBy: ctx.uid, uploadedByName: nameOfUser(ctx.me) };
                return { patch: { attachments: [...list, meta] }, event: 'attachment added', note: `${name} (${Math.round(bytes.length / 1024)} KB, sha256 ${sha256.slice(0, 16)})`, label: 'Attachment added', result: { fileId: id } };
            });
        }),
    ],

    'POST /api/org/procurement/agreements/attachment/file': [
        orgRoute('org.procurement.agreements.attachment.file', 'PRC.agreements.view', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const fileId = str(ctx.body.fileId);
            if (!FILE_ID.test(fileId)) throw new HttpError(400, 'Choose an attachment.');
            const a = objs(doc.data.attachments).find((x) => str(x.id) === fileId);
            const expected = `organizations/${ctx.orgId}/purchase_agreements/${doc.id}/${fileId}.pdf`;
            if (!a || str(a.storagePath) !== expected) throw new HttpError(404, 'Attachment not found.');
            const [signed] = await storage.url([expected]);
            if (!signed?.url) throw new HttpError(502, 'The file could not be opened. Try again.');
            await record(ctx, 'org.procurement.agreement.attachment.open', doc.id, str(a.name));
            return { url: signed.url, name: str(a.name), expiresWithinSeconds: 900 };
        }),
    ],

    // A wrong file comes off before submission; the stored original stays and the removal is kept with its reason.
    'POST /api/org/procurement/agreements/attachment/remove': [
        orgRoute('org.procurement.agreements.attachment.remove', 'PRC.agreements.manage', async (ctx) => {
            const doc = await load(ctx, str(ctx.body.id));
            const fileId = str(ctx.body.fileId);
            const reason = reasonOf(ctx.body, 5);
            return mutate(ctx, doc.id, 'attachment.remove', async (d) => {
                needOwner(ctx, d);
                if (!['draft', 'rfq_sent', 'returned'].includes(str(d.status))) throw new HttpError(409, 'Attachments cannot be removed after submission.');
                const list = objs(d.attachments);
                const a = list.find((x) => str(x.id) === fileId);
                if (!a) throw new HttpError(404, 'Attachment not found.');
                return { patch: { attachments: list.filter((x) => x !== a), removedAttachments: [...objs(d.removedAttachments), { ...a, removedAt: nowIso(), removedBy: ctx.uid, reason }] }, event: 'attachment removed', note: `${str(a.name)}: ${reason}`, label: 'Attachment removed' };
            });
        }),
    ],
};

// ----- RFQ email -----

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] as string);
async function secret(name: string): Promise<string> {
    try {
        return String((await secrets.readSecret(name)) ?? '').trim();
    } catch {
        return '';
    }
}
async function emailRfq(ctx: OrgContext, d: Obj, dueDate: string, note: string) {
    const [key, from] = await Promise.all([secret('RESEND_API_KEY'), secret('PO_FROM_EMAIL')]);
    if (!key || !from) throw new HttpError(409, 'Automatic email is not set up. Print the RFQ and send it, then record it as printed and sent.');
    const vendor = await getDoc(`${vendorsPath(ctx.orgId)}/${str(d.vendorId)}`);
    const to = str(o(vendor?.data.contact).email);
    if (!to) throw new HttpError(409, 'The supplier has no contact email on record. Print the RFQ instead.');
    const orgName = str(ctx.org.data.name) || str(ctx.org.data.legalName) || 'Our organization';
    const rows = objs(d.items).map((i) => `<tr><td>${esc(i.no)}</td><td>${esc(i.materialNumber)}</td><td>${esc(i.name)}</td><td style="text-align:right">${esc(i.expectedQty)}</td><td>${esc(i.purchaseUom)}</td></tr>`).join('');
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><p>Dear ${esc(str(d.vendorName))},</p><p>${esc(orgName)} invites you to quote for a purchase agreement <strong>${esc(d.number)}</strong> (${esc(d.title)}) from ${esc(d.startDate)} to ${esc(d.endDate)}.</p><table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#ccc"><thead><tr><th>Item</th><th>Material</th><th>Description</th><th>Expected quantity</th><th>Unit</th></tr></thead><tbody>${rows}</tbody></table><p>For each item please quote: unit price and currency per the unit shown, lead time in days, minimum order quantity, order multiple, your part number, payment terms and incoterms.</p><p><strong>Quote due by ${esc(dueDate)}</strong>, quoting ${esc(d.number)}.</p>${note ? `<p>${esc(note)}</p>` : ''}</div>`;
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject: `Request for quotation ${str(d.number)} from ${orgName}`, html, reply_to: str(ctx.me.data.email) || undefined }),
    });
    if (!res.ok) throw new HttpError(502, `The email service refused the message (${res.status}). Print the RFQ or try again.`);
}

// ----- Daily automation -----

/** Every organization: start agreements whose start date has come and end expired ones. */
export async function settleAllOrganizations(deadline: number): Promise<{ organizations: number; started: number; expired: number }> {
    const orgs = (await listDocs('organizations')).filter((x) => !['suspended', 'pending_approval', 'rejected'].includes(str(x.data.status))).map((x) => x.id).sort();
    let started = 0, expired = 0, n = 0;
    for (const orgId of orgs) {
        if (Date.now() > deadline) break;
        const r = await settleAgreements(orgId, null);
        started += r.started.length;
        expired += r.expired.length;
        n++;
    }
    return { organizations: n, started, expired };
}

export const _test = { flags, approverCheck, row, FINAL };
