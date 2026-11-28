import { HttpError, getDoc, isObj, str } from './core';
import { orgRoute } from './guards';
import { record } from './org';
import { can } from './procurementSetup';
import { vendorsPath } from './vendors';
import { PO_STATUS, TYPE_LABEL, ratesOf, poTypeOf } from './purchaseOrders';
import { PA_STATUS, converter, dashboardOf } from './purchaseAgreementModel';
import { agreementLinesOf, agreementLinker, linesUnder, loadLinkData, placedOrders, quoteWaitOf } from './agreementPerformance';
import {
    HONOURED_GOOD, HONOURED_WATCH, LINKED_STATUS, VERDICT_LABEL, agreementRfqDays, bandOf, buildPerformance, dayDiff, isoDay, periodOf, round, scorecardOf,
} from './vendorPerformanceModel';

// ---------------------------------------------------------------------------
// Supplier dashboard: purchase orders and purchase agreements.
//
//   vendors/po/dashboard          a supplier's orders over a period: counts, cost, lines and the share of deliveries
//                                 honoured, with every order and line for the open, overdue, partial and closed tabs
//   vendors/agreements/dashboard  a supplier's agreements, each reviewed (age, key details, purchases made on it,
//                                 benefits) with a scorecard of what was intended against what actually happened
//
// Both only read. They need the right to view vendors; order values need the right to view purchase orders and the
// agreement review the right to view purchase agreements. Every view is recorded in the audit trail.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const o = (v: unknown): Obj => (isObj(v) ? v : {});
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const today = () => new Date().toISOString().slice(0, 10);
const VENDOR_ID = /^VND\d{6}$/;
const MAX_ORDERS = 1500;
const MAX_LINES = 4000;
const MAX_PURCHASE_ROWS = 400;

async function vendorOf(orgId: string, id: string) {
    if (!VENDOR_ID.test(id)) throw new HttpError(400, 'Choose a supplier.');
    const doc = await getDoc(`${vendorsPath(orgId)}/${id}`);
    if (!doc) throw new HttpError(404, 'Supplier not found.');
    return doc;
}

export const vendorInsightRoutes = {
    'POST /api/org/procurement/vendors/po/dashboard': [
        orgRoute('org.procurement.vendors.po.dashboard', 'PRC.vendors.view', async (ctx) => {
            const vendor = await vendorOf(ctx.orgId, str(ctx.body.id));
            const currency = str(ctx.org.data.currencyCode);
            const day = today();
            const period = periodOf(str(ctx.body.period) || '365d', str(ctx.body.from), str(ctx.body.to), day);
            if ('error' in period) throw new HttpError(400, period.error);
            const allowed = can(ctx, 'PRC.po.view') || can(ctx, 'PRC.po.manage') || can(ctx, 'PRC.po.approve');
            if (!allowed) return { allowed, currency, period };
            const [pos, link, rates] = await Promise.all([placedOrders(ctx.orgId, vendor.id), loadLinkData(ctx.orgId, vendor.id), ratesOf(currency)]);
            const opts = {
                from: period.from,
                to: period.to,
                day,
                orgCurrency: currency,
                typeLabel: (po: Obj) => TYPE_LABEL[str(po.poType) || poTypeOf(objs(po.lines))] ?? 'Mixed',
                agreementOf: agreementLinker(link, rates.rate),
                statusLabel: (s: string) => PO_STATUS[s] ?? s,
            };
            const cur = buildPerformance(pos, opts);
            const before = period.prevFrom ? buildPerformance(pos, { ...opts, from: period.prevFrom, to: period.prevTo, agreementOf: () => null }).summary : null;
            await record(ctx, 'org.procurement.vendor.po.dashboard.view', vendor.id, `${cur.summary.orders} order(s), ${period.label}`);
            return {
                allowed,
                currency,
                period,
                thresholds: { good: HONOURED_GOOD, watch: HONOURED_WATCH },
                summary: cur.summary,
                previous: before ? { orders: before.orders, value: before.value, honouredPct: before.honouredPct, avgDaysLate: before.avgDaysLate, fillRatePct: before.fillRatePct } : null,
                byMonth: cur.byMonth,
                byType: cur.byType,
                topItems: cur.topItems,
                orders: cur.orders.slice(0, MAX_ORDERS),
                lines: cur.lines.slice(0, MAX_LINES),
                truncated: cur.orders.length > MAX_ORDERS || cur.lines.length > MAX_LINES,
            };
        }),
    ],

    'POST /api/org/procurement/vendors/agreements/dashboard': [
        orgRoute('org.procurement.vendors.agreements.dashboard', 'PRC.vendors.view', async (ctx) => {
            const vendor = await vendorOf(ctx.orgId, str(ctx.body.id));
            const currency = str(ctx.org.data.currencyCode);
            const allowed = can(ctx, 'PRC.agreements.view');
            if (!allowed) return { allowed, currency };
            const day = today();
            const { rate } = await ratesOf(currency);
            const convert = converter(rate);
            const link = await loadLinkData(ctx.orgId, vendor.id);
            const pos = await placedOrders(ctx.orgId, vendor.id);
            const all = agreementLinesOf(pos, vendor.id, link, day);
            const wait = await quoteWaitOf(ctx.orgId, vendor.id, link.agreements, day);
            const live = link.agreements.filter((a) => LINKED_STATUS.includes(str(a.data.status)));
            const notStarted = link.agreements.filter((a) => ['draft', 'rfq_sent', 'returned', 'pending_approval', 'approved'].includes(str(a.data.status))).length;
            let savings = 0;
            let purchases = 0;
            let potential = 0;
            let daysSaved = 0;
            let ordersUnder = 0;
            const scores: number[] = [];
            const agreements = live
                .map((a) => {
                    const d = a.data;
                    const lines = linesUnder(d, all);
                    const dash = dashboardOf(d, objs(d.items), all, convert, day);
                    const sc = scorecardOf({ pa: d, dash, lines, quoteWait: wait, day });
                    const to = (n: number) => convert(n, dash.currency, currency) ?? 0;
                    savings += to(dash.savings);
                    purchases += to(dash.orderedValue);
                    potential += to(dash.potentialSavings);
                    const tat = sc.rows.find((r) => r.key === 'tat');
                    daysSaved += tat?.actual ?? 0;
                    ordersUnder += sc.purchases;
                    if (sc.score !== null) scores.push(sc.score);
                    const names = new Map(objs(d.items).map((i) => [`${str(i.materialId)}|${str(i.warehouseId)}`, i] as const));
                    const rows = lines
                        .sort((x, y) => y.date.localeCompare(x.date) || x.orderNumber.localeCompare(y.orderNumber) || x.no - y.no)
                        .slice(0, MAX_PURCHASE_ROWS)
                        .map((l) => {
                            const it = names.get(`${l.materialId}|${l.warehouseId}`) ?? {};
                            const q = o(it.quote);
                            const agreedInLine = convert(num(q.unitPrice), str(q.currency) || dash.currency, l.currency);
                            return {
                                key: `${l.orderId}#${l.no}`,
                                orderId: l.orderId,
                                orderNumber: l.orderNumber,
                                no: l.no,
                                item: `${str(it.materialNumber)} ${str(it.name)}`.trim(),
                                orderDate: l.date,
                                quantity: l.quantity,
                                received: l.receivedQty,
                                currency: l.currency,
                                netUnitPrice: l.netUnitPrice,
                                agreedUnitPrice: agreedInLine === null ? null : round(agreedInLine, 4),
                                aboveAgreed: agreedInLine !== null && l.netUnitPrice > agreedInLine * 1.0001,
                                promiseOn: l.promiseOn,
                                deliveredOn: l.completeOn,
                                verdict: l.verdict,
                                verdictLabel: VERDICT_LABEL[l.verdict],
                                daysLate: l.daysLate,
                                quotedLeadDays: l.quotedLeadDays,
                                actualLeadDays: l.actualLeadDays,
                                value: round(l.quantity * l.netUnitPrice),
                            };
                        });
                    const anchor = isoDay(d.activatedAt) || isoDay(d.createdAt);
                    const start = str(d.startDate);
                    const end = str(d.endDate);
                    const orderCount = sc.purchases;
                    const own = agreementRfqDays(d);
                    return {
                        id: a.id,
                        number: str(d.number) || a.id,
                        title: str(d.title),
                        status: str(d.status),
                        statusLabel: PA_STATUS[str(d.status)] ?? str(d.status),
                        startDate: start,
                        endDate: end,
                        currency: dash.currency,
                        items: objs(d.items).length,
                        ownerName: str(d.ownerName),
                        quoteReference: str(d.quoteReference),
                        createdAt: isoDay(d.createdAt),
                        activatedAt: isoDay(d.activatedAt),
                        approvedAt: isoDay(d.approvedAt),
                        approvedAmount: num(o(d.approval).amount),
                        orgCurrency: str(d.orgCurrency) || currency,
                        ageDays: anchor ? Math.max(0, dayDiff(anchor, day)) : 0,
                        runningDays: start && start <= day ? dayDiff(start, end && end < day ? end : day) + 1 : 0,
                        totalDays: dash.totalDays,
                        daysRemaining: dash.daysRemaining,
                        timeUsedPct: dash.timeUsedPct,
                        active: dash.active,
                        figures: {
                            orders: dash.orders,
                            orderedValue: dash.orderedValue,
                            expectedValue: dash.expectedValue,
                            utilisationPct: dash.utilisationPct,
                            savings: dash.savings,
                            potentialSavings: dash.potentialSavings,
                            materialsPurchased: dash.materialsPurchased,
                            priceBreaches: dash.priceBreaches,
                            itemsApplied: dash.itemsApplied,
                            itemsOverridden: dash.itemsOverridden,
                        },
                        scorecard: sc,
                        tat: {
                            avgWaitDays: wait.avgDays,
                            samples: wait.samples,
                            orders: orderCount,
                            daysSaved: tat?.actual ?? null,
                            ownRfqDays: own,
                            netDays: tat?.actual !== null && tat?.actual !== undefined && own !== null ? round(tat.actual - own, 1) : null,
                        },
                        purchases: rows,
                        purchasesTruncated: lines.length > MAX_PURCHASE_ROWS,
                    };
                })
                .sort((x, y) => y.number.localeCompare(x.number));
            const avgScore = scores.length ? round(scores.reduce((s, x) => s + x, 0) / scores.length, 1) : null;
            await record(ctx, 'org.procurement.vendor.agreements.dashboard.view', vendor.id, `${agreements.length} agreement(s)`);
            return {
                allowed,
                currency,
                summary: {
                    agreements: agreements.length,
                    active: agreements.filter((x) => x.active).length,
                    scheduled: agreements.filter((x) => x.status === 'scheduled').length,
                    ended: agreements.filter((x) => ['expired', 'terminated'].includes(x.status)).length,
                    notStarted,
                    orders: ordersUnder,
                    purchases: round(purchases),
                    savings: round(savings),
                    potentialSavings: round(potential),
                    avgScore,
                    band: bandOf(avgScore),
                    avgQuoteWaitDays: wait.avgDays,
                    quoteSamples: wait.samples,
                    daysSaved: round(daysSaved, 1),
                },
                thresholds: { good: HONOURED_GOOD, watch: HONOURED_WATCH },
                agreements,
            };
        }),
    ],
};
