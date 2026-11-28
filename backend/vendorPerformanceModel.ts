import { dashboardOf, itemKey, paWindow, type OrderLine } from './purchaseAgreementModel';

// ---------------------------------------------------------------------------
// Supplier delivery performance and purchase agreement scorecards: the pure rules, with no database access, so they
// can be tested on their own.
//
// The promise. An order line is promised when the supplier's quoted lead time has run from the day the order was sent
// (or approved). With no lead time the date the line is needed by stands in. A line is
//   on_time  fully received on or before the promised date
//   late     fully received after it
//   overdue  not fully received and the promised date has passed
//   pending  not fully received and not yet due
//   untimed  there is no promised date, so it counts neither way
// The percentage of deliveries honoured is on_time / (on_time + late + overdue): only deliveries that fell due count.
// An order takes the worst of its lines (overdue, then late, then pending).
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const o = (v: unknown): Obj => (isObj(v) ? v : {});
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
export const isoDay = (v: unknown) => str(v).slice(0, 10);
const DAY = 86_400_000;
export const addDays = (iso: string, n: number) => {
    const t = Date.parse(`${iso}T00:00:00Z`);
    return Number.isFinite(t) ? new Date(t + n * DAY).toISOString().slice(0, 10) : '';
};
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const validDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(Date.parse(`${s}T00:00:00Z`)).toISOString().slice(0, 10) === s;

/** Delivery performance bands: green from 90%, amber from 75%, red below. */
export const HONOURED_GOOD = 90;
export const HONOURED_WATCH = 75;
export type Band = 'good' | 'watch' | 'poor' | 'none';
export const bandOf = (pct: number | null): Band => (pct === null ? 'none' : pct >= HONOURED_GOOD ? 'good' : pct >= HONOURED_WATCH ? 'watch' : 'poor');

export type Verdict = 'on_time' | 'late' | 'overdue' | 'pending' | 'untimed';
export const VERDICT_LABEL: Record<Verdict, string> = { on_time: 'On time', late: 'Delivered late', overdue: 'Overdue', pending: 'Not yet due', untimed: 'No promise date' };

export interface LineDelivery {
    no: number;
    ordered: number;
    received: number;
    outstanding: number;
    sentOn: string;
    promiseOn: string;
    firstOn: string;
    completeOn: string;
    complete: boolean;
    verdict: Verdict;
    daysLate: number;
    quotedLeadDays: number;
    actualLeadDays: number | null;
}

/** What the supplier has delivered on one order line and whether the promise was kept. Reversed receipts count for nothing. */
export function lineDelivery(po: Obj, line: Obj, day: string): LineDelivery {
    const no = num(line.no);
    const ordered = Math.max(0, num(line.quantity));
    const sentOn = isoDay(po.sentAt) || isoDay(po.approvedAt);
    const lead = Math.max(0, num(line.leadTimeDays));
    const promiseOn = sentOn && lead > 0 ? addDays(sentOn, lead) : isoDay(line.dateRequired);
    const parts = objs(po.deliveries)
        .filter((dv) => str(dv.status) !== 'reversed')
        .map((dv) => ({
            date: isoDay(dv.date) || isoDay(dv.at),
            at: str(dv.at),
            qty: objs(dv.lines).filter((y) => num(y.no) === no).reduce((s, y) => s + Math.max(0, num(y.qty) - num(y.reversedQty)), 0),
        }))
        .filter((p) => p.qty > 0)
        .sort((a, b) => `${a.date}${a.at}`.localeCompare(`${b.date}${b.at}`));
    let cum = 0;
    let firstOn = '';
    let completeOn = '';
    for (const p of parts) {
        cum += p.qty;
        if (!firstOn) firstOn = p.date;
        if (!completeOn && ordered > 0 && cum >= ordered - 1e-9) completeOn = p.date;
    }
    const received = round(Math.max(cum, num(line.receivedQty)), 4);
    const complete = ordered > 0 && received >= ordered - 1e-9;
    // An order closed without receipt records (older orders): the day it was closed stands in.
    if (complete && !completeOn) completeOn = isoDay(po.deliveredAt) || isoDay(po.updatedAt);
    let verdict: Verdict;
    let daysLate = 0;
    if (!promiseOn) verdict = 'untimed';
    else if (complete) {
        const late = !!completeOn && completeOn > promiseOn;
        verdict = late ? 'late' : 'on_time';
        daysLate = late ? dayDiff(promiseOn, completeOn) : 0;
    } else if (promiseOn < day) {
        verdict = 'overdue';
        daysLate = dayDiff(promiseOn, day);
    } else verdict = 'pending';
    return {
        no,
        ordered,
        received,
        outstanding: round(Math.max(0, ordered - received), 4),
        sentOn,
        promiseOn,
        firstOn,
        completeOn: complete ? completeOn : '',
        complete,
        verdict,
        daysLate,
        quotedLeadDays: lead,
        actualLeadDays: complete && sentOn && completeOn ? Math.max(0, dayDiff(sentOn, completeOn)) : null,
    };
}

/** An order takes the worst of its lines: overdue, then late, then pending. */
export function orderVerdict(lines: LineDelivery[]): { verdict: Verdict; daysLate: number } {
    const live = lines.filter((l) => l.ordered > 0);
    if (!live.length) return { verdict: 'untimed', daysLate: 0 };
    const worst = (v: Verdict) => Math.max(0, ...live.filter((l) => l.verdict === v).map((l) => l.daysLate));
    if (live.some((l) => l.verdict === 'overdue')) return { verdict: 'overdue', daysLate: worst('overdue') };
    if (live.some((l) => l.verdict === 'late')) return { verdict: 'late', daysLate: worst('late') };
    if (live.some((l) => l.verdict === 'pending')) return { verdict: 'pending', daysLate: 0 };
    if (live.every((l) => l.verdict === 'untimed')) return { verdict: 'untimed', daysLate: 0 };
    return { verdict: 'on_time', daysLate: 0 };
}

// ----- Periods -----

export const PERIODS = [
    { key: '30d', label: 'Last month', days: 30 },
    { key: '90d', label: 'Last 3 months', days: 90 },
    { key: '180d', label: 'Last 6 months', days: 180 },
    { key: '365d', label: 'Last year', days: 365 },
    { key: 'ytd', label: 'This year so far', days: 0 },
    { key: 'all', label: 'All time', days: 0 },
    { key: 'custom', label: 'Choose dates', days: 0 },
] as const;
export interface Period { key: string; label: string; from: string; to: string; prevFrom: string; prevTo: string }

/** The dates of a period and of the stretch of equal length just before it (for comparison). */
export function periodOf(key: string, fromIn: string, toIn: string, day: string): Period | { error: string } {
    const def = PERIODS.find((p) => p.key === key);
    if (!def) return { error: 'Choose a period from the list.' };
    if (def.days > 0) {
        const from = addDays(day, -(def.days - 1));
        const prevTo = addDays(from, -1);
        return { key, label: def.label, from, to: day, prevFrom: addDays(prevTo, -(def.days - 1)), prevTo };
    }
    if (key === 'all') return { key, label: def.label, from: '', to: '', prevFrom: '', prevTo: '' };
    if (key === 'ytd') {
        const from = `${day.slice(0, 4)}-01-01`;
        const span = dayDiff(from, day);
        const prevFrom = `${Number(day.slice(0, 4)) - 1}-01-01`;
        return { key, label: def.label, from, to: day, prevFrom, prevTo: addDays(prevFrom, span) };
    }
    if (!validDay(fromIn) || !validDay(toIn)) return { error: 'Enter the first and last day of the period.' };
    if (toIn < fromIn) return { error: 'The period cannot end before it starts.' };
    if (toIn > day) return { error: 'The period cannot end in the future.' };
    const span = dayDiff(fromIn, toIn);
    if (span > 3660) return { error: 'Choose a period of ten years or less.' };
    const prevTo = addDays(fromIn, -1);
    return { key, label: `${fromIn} to ${toIn}`, from: fromIn, to: toIn, prevFrom: addDays(prevTo, -span), prevTo };
}

// ----- Purchase agreement linkage -----

export interface AgreementRef {
    id: string;
    number: string;
    vendorId: string;
    currency: string;
    start: string;
    end: string;
    status: string;
    items: Map<string, { price: number; currency: string; leadDays: number }>;
}
/** An agreement applies to orders for its materials from its supplier between its dates (to the day it was terminated, if earlier). */
export const LINKED_STATUS = ['scheduled', 'active', 'expired', 'terminated'];
export function agreementRefs(docs: Array<{ id: string; data: Obj }>): AgreementRef[] {
    return docs
        .filter((p) => LINKED_STATUS.includes(str(p.data.status)))
        .map((p) => {
            const w = paWindow(p.data);
            const items = new Map<string, { price: number; currency: string; leadDays: number }>();
            for (const i of objs(p.data.items)) {
                const q = o(i.quote);
                if (num(q.unitPrice) > 0) items.set(itemKey(i), { price: num(q.unitPrice), currency: str(q.currency) || str(p.data.currency), leadDays: num(q.leadTimeDays) });
            }
            return { id: p.id, number: str(p.data.number) || p.id, vendorId: str(p.data.vendorId), currency: str(p.data.currency), start: w.start, end: w.end, status: str(p.data.status), items };
        });
}
export function matchAgreement(refs: AgreementRef[], vendorId: string, materialId: string, warehouseId: string, date: string) {
    if (!vendorId || !materialId || !warehouseId || !date) return null;
    const key = `${materialId}|${warehouseId}`;
    return refs.find((r) => r.vendorId === vendorId && r.items.has(key) && (!r.start || date >= r.start) && (!r.end || date <= r.end)) ?? null;
}

/** The material and warehouse an order line buys, from the requirement line it came from, else its own fields, else its item number and cost center. */
export function stockOf(line: Obj, reqLines: Map<string, { materialId: string; warehouseId: string }>, byNumber: Map<string, string>): { materialId: string; warehouseId: string } | null {
    if (str(line.type) && str(line.type) !== 'material') return null;
    const via = reqLines.get(`${str(line.requirementId)}|${num(line.requirementLineNo)}`);
    if (via) return via;
    const materialId = str(line.materialId) || byNumber.get(str(line.itemCode)) || byNumber.get(str(line.materialNumber)) || '';
    const warehouseId = str(line.warehouseId) || str(line.costCenterId);
    return materialId && warehouseId ? { materialId, warehouseId } : null;
}

// ----- Supplier order performance -----

export interface LineAgreement { id: string; number: string; agreedPrice: number | null; agreedCurrency: string; aboveAgreed: boolean }
export interface PerfOptions {
    from: string;
    to: string;
    day: string;
    orgCurrency: string;
    typeLabel: (po: Obj) => string;
    agreementOf: (po: Obj, line: Obj, date: string) => LineAgreement | null;
    statusLabel: (status: string) => string;
}
export const orderDateOf = (po: Obj) => (isoDay(po.approvedAt) || isoDay(po.orderDate) || isoDay(po.createdAt));

/** Orders that count: placed with the supplier (open, sent, delivered partly or in full). */
const PLACED_STATUS = ['open', 'sent', 'partial', 'full'];

export function buildPerformance(pos: Array<{ id: string; data: Obj }>, opt: PerfOptions) {
    const orders: Obj[] = [];
    const lines: Obj[] = [];
    const months = new Map<string, { orders: number; lines: number; value: number; honoured: number; due: number }>();
    const types = new Map<string, { orders: number; lines: number; value: number; honoured: number; due: number }>();
    const items = new Map<string, { item: string; code: string; lines: number; qty: number; value: number; unit: string }>();
    const s = {
        orders: 0, open: 0, overdue: 0, partial: 0, closed: 0, lines: 0, value: 0, paid: 0, pending: 0,
        dueOrders: 0, honouredOrders: 0, lateOrders: 0, overdueOrders: 0, pendingOrders: 0,
        dueLines: 0, honouredLines: 0, lateLines: 0, overdueLines: 0, pendingLines: 0,
        orderedQty: 0, receivedQty: 0, lateDays: 0, lateCount: 0, quotedLead: 0, actualLead: 0, leadSamples: 0,
        agreementOrders: 0, agreementLines: 0, agreementValue: 0,
    };
    const count = (m: Map<string, { orders: number; lines: number; value: number; honoured: number; due: number }>, key: string, v: { lines: number; value: number; verdict: Verdict }) => {
        const e = m.get(key) ?? { orders: 0, lines: 0, value: 0, honoured: 0, due: 0 };
        e.orders += 1;
        e.lines += v.lines;
        e.value += v.value;
        if (v.verdict === 'on_time') { e.honoured += 1; e.due += 1; } else if (v.verdict === 'late' || v.verdict === 'overdue') e.due += 1;
        m.set(key, e);
    };
    for (const p of pos) {
        const d = p.data;
        const status = str(d.status);
        if (!PLACED_STATUS.includes(status)) continue;
        const date = orderDateOf(d);
        if (opt.from && (!date || date < opt.from)) continue;
        if (opt.to && (!date || date > opt.to)) continue;
        const rate = num(d.fxRate) || (num(d.total) > 0 && num(d.baseTotal) > 0 ? num(d.baseTotal) / num(d.total) : 1);
        const value = num(d.baseTotal);
        const paid = Math.min(value, num(d.paid));
        const pending = Math.max(0, value - paid);
        const dels = objs(d.lines).map((l) => ({ line: l, del: lineDelivery(d, l, opt.day) }));
        const ov = orderVerdict(dels.map((x) => x.del));
        const live = status !== 'full';
        const partial = status === 'partial';
        const agreements = new Map<string, string>();
        for (const { line, del } of dels) {
            const ag = opt.agreementOf(d, line, date);
            if (ag) agreements.set(ag.id, ag.number);
            const total = num(line.total);
            const base = round(total * rate);
            s.lines += 1;
            s.orderedQty += del.ordered;
            s.receivedQty += Math.min(del.received, del.ordered);
            if (del.verdict === 'on_time') { s.honouredLines += 1; s.dueLines += 1; }
            else if (del.verdict === 'late') { s.lateLines += 1; s.dueLines += 1; s.lateDays += del.daysLate; s.lateCount += 1; }
            else if (del.verdict === 'overdue') { s.overdueLines += 1; s.dueLines += 1; s.lateDays += del.daysLate; s.lateCount += 1; }
            else if (del.verdict === 'pending') s.pendingLines += 1;
            if (del.actualLeadDays !== null && del.quotedLeadDays > 0) { s.quotedLead += del.quotedLeadDays; s.actualLead += del.actualLeadDays; s.leadSamples += 1; }
            if (ag) { s.agreementLines += 1; s.agreementValue += base; }
            const code = str(line.itemCode);
            const name = str(line.itemName) || str(line.requirement);
            const k = code || name.toLowerCase();
            if (k) {
                const it = items.get(k) ?? { item: name || code, code, lines: 0, qty: 0, value: 0, unit: str(line.unit) };
                it.lines += 1;
                it.qty += del.ordered;
                it.value += base;
                items.set(k, it);
            }
            lines.push({
                key: `${p.id}#${del.no}`,
                orderId: p.id,
                orderNumber: str(d.number) || p.id,
                status,
                statusLabel: opt.statusLabel(status),
                orderDate: date,
                no: del.no,
                item: name,
                itemCode: code,
                type: str(line.type),
                quantity: del.ordered,
                received: del.received,
                outstanding: del.outstanding,
                unit: str(line.unit),
                currency: str(d.currency),
                netUnitPrice: num(line.netUnitPrice),
                total,
                base,
                sentOn: del.sentOn,
                promiseOn: del.promiseOn,
                firstDeliveryOn: del.firstOn,
                deliveredOn: del.completeOn,
                verdict: del.verdict,
                verdictLabel: VERDICT_LABEL[del.verdict],
                daysLate: del.daysLate,
                quotedLeadDays: del.quotedLeadDays,
                actualLeadDays: del.actualLeadDays,
                agreementId: ag?.id ?? '',
                agreementNumber: ag?.number ?? '',
                agreedPrice: ag?.agreedPrice ?? null,
                agreedCurrency: ag?.agreedCurrency ?? '',
                aboveAgreed: ag?.aboveAgreed === true,
                live,
                partial,
            });
        }
        s.orders += 1;
        s.value += value;
        s.paid += paid;
        s.pending += pending;
        if (live) s.open += 1; else s.closed += 1;
        if (partial) s.partial += 1;
        if (ov.verdict === 'overdue') s.overdue += 1;
        if (ov.verdict === 'on_time') { s.honouredOrders += 1; s.dueOrders += 1; }
        else if (ov.verdict === 'late') { s.lateOrders += 1; s.dueOrders += 1; }
        else if (ov.verdict === 'overdue') { s.overdueOrders += 1; s.dueOrders += 1; }
        else if (ov.verdict === 'pending') s.pendingOrders += 1;
        if (agreements.size) { s.agreementOrders += 1; }
        const promise = dels.map((x) => x.del.promiseOn).filter(Boolean).sort().pop() ?? '';
        const delivered = live ? '' : dels.map((x) => x.del.completeOn).filter(Boolean).sort().pop() ?? '';
        orders.push({
            id: p.id,
            number: str(d.number) || p.id,
            status,
            statusLabel: opt.statusLabel(status),
            live,
            partial,
            overdue: ov.verdict === 'overdue',
            orderDate: date,
            sentOn: isoDay(d.sentAt) || isoDay(d.approvedAt),
            promiseOn: promise,
            deliveredOn: delivered,
            verdict: ov.verdict,
            verdictLabel: VERDICT_LABEL[ov.verdict],
            daysLate: ov.daysLate,
            poType: opt.typeLabel(d),
            lines: dels.length,
            currency: str(d.currency),
            total: num(d.total),
            value,
            paid,
            pending,
            agreements: [...agreements.values()].join(', '),
            agreementIds: [...agreements.keys()],
            receivedPct: dels.reduce((a, x) => a + x.del.ordered, 0) > 0 ? round((dels.reduce((a, x) => a + Math.min(x.del.received, x.del.ordered), 0) / dels.reduce((a, x) => a + x.del.ordered, 0)) * 100, 1) : 0,
        });
        if (date) count(months, date.slice(0, 7), { lines: dels.length, value, verdict: ov.verdict });
        count(types, opt.typeLabel(d) || 'Mixed', { lines: dels.length, value, verdict: ov.verdict });
    }
    const pct = (a: number, b: number) => (b > 0 ? round((a / b) * 100, 1) : null);
    const honouredPct = pct(s.honouredOrders, s.dueOrders);
    const summary = {
        orders: s.orders,
        open: s.open,
        overdue: s.overdue,
        partial: s.partial,
        closed: s.closed,
        lines: s.lines,
        value: round(s.value),
        paid: round(s.paid),
        pending: round(s.pending),
        honouredPct,
        band: bandOf(honouredPct),
        dueOrders: s.dueOrders,
        honouredOrders: s.honouredOrders,
        lateOrders: s.lateOrders,
        overdueOrders: s.overdueOrders,
        pendingOrders: s.pendingOrders,
        lineHonouredPct: pct(s.honouredLines, s.dueLines),
        dueLines: s.dueLines,
        honouredLines: s.honouredLines,
        lateLines: s.lateLines,
        overdueLines: s.overdueLines,
        pendingLines: s.pendingLines,
        avgDaysLate: s.lateCount ? round(s.lateDays / s.lateCount, 1) : null,
        fillRatePct: pct(s.receivedQty, s.orderedQty),
        avgQuotedLead: s.leadSamples ? round(s.quotedLead / s.leadSamples, 1) : null,
        avgActualLead: s.leadSamples ? round(s.actualLead / s.leadSamples, 1) : null,
        agreementOrders: s.agreementOrders,
        agreementLines: s.agreementLines,
        agreementValue: round(s.agreementValue),
    };
    const group = (m: Map<string, { orders: number; lines: number; value: number; honoured: number; due: number }>) =>
        [...m.entries()].map(([key, e]) => ({ key, orders: e.orders, lines: e.lines, value: round(e.value), due: e.due, honoured: e.honoured, honouredPct: pct(e.honoured, e.due) }));
    return {
        summary,
        orders: orders.sort((a, b) => str(b.orderDate).localeCompare(str(a.orderDate)) || str(b.number).localeCompare(str(a.number))),
        lines: lines.sort((a, b) => str(b.orderDate).localeCompare(str(a.orderDate)) || str(b.orderNumber).localeCompare(str(a.orderNumber)) || num(a.no) - num(b.no)),
        byMonth: group(months).sort((a, b) => b.key.localeCompare(a.key)),
        byType: group(types).sort((a, b) => b.value - a.value),
        topItems: [...items.values()].map((x) => ({ ...x, qty: round(x.qty, 4), value: round(x.value) })).sort((a, b) => b.value - a.value).slice(0, 10),
    };
}

// ----- Quote waiting time -----

/** Days between two instants, to one decimal place; nothing when either is missing or the order is wrong. */
export const waitDays = (from: string, to: string): number | null => {
    const a = Date.parse(from);
    const b = Date.parse(to);
    return Number.isFinite(a) && Number.isFinite(b) && b >= a ? round((b - a) / DAY, 1) : null;
};

/**
 * How long this supplier takes to answer a request for a quote, over the year up to `day`: from the invitation on a
 * quotation case (or the RFQ of an agreement) to the quote being recorded.
 */
export function quoteWaits(cases: Array<{ id: string; data: Obj }>, agreements: Array<{ id: string; data: Obj }>, vendorId: string, day: string) {
    const since = addDays(day, -364);
    const waits: number[] = [];
    let fromCases = 0;
    let fromAgreements = 0;
    for (const c of cases) {
        for (const inv of objs(c.data.invites)) {
            if (str(inv.vendorId) !== vendorId || isoDay(inv.invitedAt) < since || isoDay(inv.invitedAt) > day) continue;
            const q = objs(c.data.quotes).find((x) => str(x.vendorId) === vendorId);
            const w = q ? waitDays(str(inv.invitedAt), str(q.createdAt)) : null;
            if (w !== null) { waits.push(w); fromCases += 1; }
        }
    }
    for (const a of agreements) {
        if (str(a.data.vendorId) !== vendorId) continue;
        const w = agreementRfqDays(a.data);
        const sent = isoDay(o(a.data.rfq).sentAt);
        if (w !== null && sent >= since && sent <= day) { waits.push(w); fromAgreements += 1; }
    }
    return { avgDays: waits.length ? round(waits.reduce((x, y) => x + y, 0) / waits.length, 1) : null, samples: waits.length, fromCases, fromAgreements, since, until: day };
}

/** From the agreement's RFQ going to the supplier to its last item quote being recorded. */
export function agreementRfqDays(pa: Obj): number | null {
    const sent = str(o(pa.rfq).sentAt);
    const quoted = objs(pa.items).map((i) => str(o(i.quote).quotedAt)).filter(Boolean).sort();
    return sent && quoted.length ? waitDays(sent, quoted[quoted.length - 1]) : null;
}

// ----- Agreement scorecard: intended against actual -----

export type Unit = 'money' | 'days' | 'pct' | 'count';
export interface ScoreRow {
    key: string;
    label: string;
    unit: Unit;
    better: 'higher' | 'lower';
    intended: number | null;
    pace: number | null;
    actual: number | null;
    achievedPct: number | null;
    band: Band;
    note: string;
}
export interface Scorecard { rows: ScoreRow[]; score: number | null; band: Band; basis: 'to date' | 'final'; purchases: number }

/** An order line bought under an agreement, with how it was delivered. */
export interface AgreementLine extends OrderLine {
    no: number;
    promiseOn: string;
    completeOn: string;
    verdict: Verdict;
    daysLate: number;
    quotedLeadDays: number;
    actualLeadDays: number | null;
}

export const scoreBand = (pct: number | null): Band => (pct === null ? 'none' : pct >= 100 ? 'good' : pct >= HONOURED_WATCH ? 'watch' : 'poor');

/**
 * Intended against actual for one agreement. While it runs, the target to compare with is the intended figure pro rata
 * for the time used (pace); once it has ended it is the intended figure. Lead time compares days, lower being better.
 */
export function scorecardOf(input: {
    pa: Obj;
    dash: ReturnType<typeof dashboardOf>;
    lines: AgreementLine[];
    quoteWait: { avgDays: number | null; samples: number };
    day: string;
}): Scorecard {
    const { pa, dash, lines, quoteWait, day } = input;
    const ended = ['expired', 'terminated'].includes(str(pa.status)) || (!!str(pa.endDate) && str(pa.endDate) < day);
    const used = ended ? 1 : Math.max(0, Math.min(1, dash.timeUsedPct / 100));
    const early = !ended && dash.timeUsedPct < 5;
    const rows: ScoreRow[] = [];
    const higher = (key: string, label: string, unit: Unit, intended: number, actual: number, note: string, prorate = true) => {
        const pace = prorate ? round(intended * used, 2) : intended;
        const ref = early && prorate ? 0 : pace;
        const achieved = ref > 0 ? round((actual / ref) * 100, 1) : null;
        rows.push({ key, label, unit, better: 'higher', intended: round(intended, 2), pace, actual: round(actual, 2), achievedPct: achieved, band: scoreBand(achieved), note });
    };
    higher('spend', 'Purchases under the agreement', 'money', dash.expectedValue, dash.orderedValue, `${dash.orders} order(s); intended is the expected quantities at the agreed prices.`);
    higher('savings', 'Savings against standard price', 'money', dash.potentialSavings, dash.savings, dash.noStandardPrice ? `${dash.noStandardPrice} material(s) have no standard price and are not counted.` : 'Quantity bought times the standard price less the agreed price.');
    higher('materials', 'Materials bought on the agreement', 'count', dash.items.length, dash.materialsPurchased, `${dash.itemsApplied} using the agreement's parameters${dash.itemsOverridden ? `, ${dash.itemsOverridden} overridden` : ''}.`);

    // Lead time: the supplier's agreed days against the days it actually took, and against the materials' own lead time.
    const bought = dash.items.filter((x) => x.orderedQty > 0);
    const basis = bought.length ? bought : dash.items;
    const agreedLead = avg(basis.map((x) => leadOf(pa, x.materialId, x.warehouseId, 'quote')));
    const standardLead = avg(basis.map((x) => leadOf(pa, x.materialId, x.warehouseId, 'standard')));
    const actualLead = avg(lines.map((l) => l.actualLeadDays));
    const leadAchieved = agreedLead !== null && actualLead !== null && actualLead > 0 ? round((agreedLead / actualLead) * 100, 1) : agreedLead !== null && actualLead === 0 ? 100 : null;
    rows.push({
        key: 'lead',
        label: 'Delivery lead time (days)',
        unit: 'days',
        better: 'lower',
        intended: agreedLead,
        pace: agreedLead,
        actual: actualLead,
        achievedPct: leadAchieved,
        band: agreedLead === null || actualLead === null ? 'none' : actualLead <= agreedLead ? 'good' : actualLead <= agreedLead * 1.25 ? 'watch' : 'poor',
        note: standardLead !== null && agreedLead !== null ? `The materials' own lead time averages ${standardLead} days; the agreement promises ${agreedLead}${agreedLead < standardLead ? `, ${round(standardLead - agreedLead, 1)} days faster` : ''}.` : 'Counts delivered lines only.',
    });

    // Deliveries honoured: of the lines that fell due, how many arrived by the promised date.
    const due = lines.filter((l) => ['on_time', 'late', 'overdue'].includes(l.verdict));
    const honoured = due.filter((l) => l.verdict === 'on_time').length;
    const honouredPct = due.length ? round((honoured / due.length) * 100, 1) : null;
    rows.push({
        key: 'delivery',
        label: 'Deliveries honoured',
        unit: 'pct',
        better: 'higher',
        intended: 100,
        pace: 100,
        actual: honouredPct,
        achievedPct: honouredPct,
        band: bandOf(honouredPct),
        note: due.length ? `${honoured} of ${due.length} order line(s) that fell due arrived by the promised date.` : 'No order line has fallen due yet.',
    });

    // Price discipline: lines bought at or below the agreed price.
    const above = dash.priceBreaches;
    const lineCount = lines.length;
    const within = lineCount ? round(((lineCount - Math.min(above, lineCount)) / lineCount) * 100, 1) : null;
    rows.push({
        key: 'price',
        label: 'Bought at or below the agreed price',
        unit: 'pct',
        better: 'higher',
        intended: 100,
        pace: 100,
        actual: within,
        achievedPct: within,
        band: bandOf(within),
        note: lineCount ? `${above} of ${lineCount} order line(s) were priced above the agreed price.` : 'No orders under the agreement yet.',
    });

    // Quote turnaround: each order bought on the agreement did not wait for a quote.
    const orderCount = new Set(lines.map((l) => l.orderId)).size;
    const avgWait = quoteWait.avgDays;
    const ownRfq = agreementRfqDays(pa);
    const saved = avgWait !== null ? round(orderCount * avgWait, 1) : null;
    rows.push({
        key: 'tat',
        label: 'Quote waiting time avoided (days)',
        unit: 'days',
        better: 'higher',
        intended: null,
        pace: null,
        actual: saved,
        achievedPct: null,
        band: 'none',
        note: avgWait === null
            ? 'No supplier quote turnaround was recorded in the last 12 months to compare with.'
            : `${orderCount} order(s) skipped a quote cycle. The supplier averaged ${avgWait} days to quote over the last 12 months (${quoteWait.samples} request(s)).${ownRfq !== null ? ` This agreement's own RFQ took ${ownRfq} days, so ${round(saved! - ownRfq, 1)} days net.` : ''}`,
    });

    const scored = rows.filter((r) => r.band !== 'none' && r.achievedPct !== null);
    const score = scored.length ? round(scored.reduce((s, r) => s + Math.min(100, r.achievedPct as number), 0) / scored.length, 1) : null;
    return { rows, score, band: bandOf(score), basis: ended ? 'final' : 'to date', purchases: orderCount };
}

const avg = (xs: Array<number | null>): number | null => {
    const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
    return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, 1) : null;
};
function leadOf(pa: Obj, materialId: string, warehouseId: string, which: 'quote' | 'standard'): number | null {
    const it = objs(pa.items).find((i) => str(i.materialId) === materialId && str(i.warehouseId) === warehouseId);
    if (!it) return null;
    const v = which === 'quote' ? o(it.quote).leadTimeDays : o(it.standard).leadTimeDays;
    return v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
}
