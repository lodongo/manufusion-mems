import { HttpError, listDocs, str } from './core';
import { orgRoute, type OrgContext } from './guards';
import { allowedNodeIds } from './positions';
import { can, isSuper, requireProcurement, requirementsPath } from './procurementSetup';
import { covers, deskScope } from './buyerGroups';
import {
    PO_STATUS,
    PLACED,
    RQ_STATUS,
    TYPE_LABEL,
    accessFlags,
    baseOf,
    canViewReq,
    casesPath,
    ccOf,
    chainOf,
    daysBetween,
    o,
    objs,
    ordersPath,
    ownedCostCenters,
    poScope,
    reqsPath,
    round,
    sees,
    unitsOf,
    verOf,
    visibilityOf,
    type Unit,
} from './purchaseOrders';

// ---------------------------------------------------------------------------
// Procurement dashboard: open requirements, requisitions and orders, drilled from the legal entity down to the cost
// center, and by status, month and supplier; the time each stage takes; and order age. Everyone sees only the
// records their role, buyer groups, cost center ownership or organization range allows.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const REQ_STATUS: Record<string, string> = {
    draft: 'Draft',
    pending_approval: 'With the manager',
    approved: 'Approved, waiting for procurement',
    acknowledged: 'Acknowledged by procurement',
    returned_user: 'Returned to the requester',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
};
const ageBuckets = [
    { key: '0-30', label: '0 to 30 days', min: 0, max: 30 },
    { key: '31-60', label: '31 to 60 days', min: 31, max: 60 },
    { key: '61-90', label: '61 to 90 days', min: 61, max: 90 },
    { key: '90+', label: 'Over 90 days', min: 91, max: Infinity },
];
const monthOf = (iso: string) => (iso ? iso.slice(0, 7) : '');
const days = (a: string, b: string) => (a && b && b >= a ? round((Date.parse(b) - Date.parse(a)) / 86_400_000, 1) : null);
const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? round(v.reduce((s, x) => s + x, 0) / v.length, 1) : null;
};

interface Rec {
    kind: 'requirements' | 'prs' | 'pos';
    id: string;
    number: string;
    title: string;
    status: string;
    statusLabel: string;
    createdAt: string;
    month: string;
    path: string[];
    value: number;
    valueHidden: boolean;
    vendorId: string;
    vendorName: string;
    poType: string;
    ageDays: number;
    extra: Obj;
}

async function model(ctx: OrgContext) {
    requireProcurement(ctx);
    const [units, scopeD, scopeP, vis, reqs, prs, pos, cases, allowed] = await Promise.all([
        unitsOf(ctx.orgId),
        deskScope(ctx),
        poScope(ctx),
        visibilityOf(ctx.orgId),
        listDocs(requirementsPath(ctx.orgId)),
        listDocs(reqsPath(ctx.orgId)),
        listDocs(ordersPath(ctx.orgId)),
        listDocs(casesPath(ctx.orgId)),
        isSuper(ctx) ? Promise.resolve('all' as const) : allowedNodeIds(ctx.orgId, ctx.me, true),
    ]);
    const owned = ownedCostCenters(units, ctx.me);
    const inRange = (id: string) => allowed === 'all' || allowed.has(id);
    const pathOf = (lines: Obj[]): string[] => {
        // Highest visible unit first, down to the cost center. A record with several cost centers follows its first one.
        const cc = lines.map(ccOf).find(Boolean);
        if (!cc || !units.get(cc)) return [];
        let chain = chainOf(units, cc).filter((u) => inRange(u.id) || owned.has(u.id) || u.id === cc);
        if (!chain.length) chain = [units.get(cc)!];
        return chain.map((u) => u.id).reverse();
    };
    const wideReq = can(ctx, 'PRC.req.viewall') || can(ctx, 'PRC.req.acknowledge') || can(ctx, 'PRC.req.approve');
    const recs: Rec[] = [];

    for (const r of reqs) {
        const d = r.data;
        const lines = objs(d.lines);
        const mine = str(d.requesterUid) === ctx.uid;
        const ccOwner = lines.some((l) => owned.has(ccOf(l)));
        const range = lines.some((l) => inRange(ccOf(l)));
        if (!mine && !ccOwner && !(wideReq && range)) continue;
        recs.push({ kind: 'requirements', id: r.id, number: r.id, title: str(d.title), status: str(d.status), statusLabel: REQ_STATUS[str(d.status)] ?? str(d.status), createdAt: str(d.createdAt), month: monthOf(str(d.createdAt)), path: pathOf(lines), value: 0, valueHidden: false, vendorId: '', vendorName: '', poType: str(lines[0]?.type), ageDays: daysBetween(str(d.createdAt), new Date().toISOString()), extra: { requesterName: str(d.requesterName), items: lines.length } });
    }
    for (const r of prs) {
        const d = r.data;
        const lines = objs(d.lines);
        const mine = str(d.requesterUid) === ctx.uid;
        if (!mine && !lines.some((l) => owned.has(ccOf(l))) && !(canViewReq(ctx) && covers(scopeD, lines))) continue;
        const fx = Number(d.quoteFxRate) || 0;
        recs.push({ kind: 'prs', id: r.id, number: str(d.number) || r.id, title: str(d.requirementTitle), status: str(d.status), statusLabel: RQ_STATUS[str(d.status)] ?? str(d.status), createdAt: str(d.createdAt), month: monthOf(str(d.createdAt)), path: pathOf(lines), value: round((Number(d.total) || 0) * fx), valueHidden: false, vendorId: str(d.vendorId), vendorName: str(d.vendorName), poType: str(d.poType), ageDays: daysBetween(str(d.createdAt), new Date().toISOString()), extra: { requesterName: str(d.requesterName), order: str(d.orderNumber), validUntil: str(d.validUntil) } });
    }
    const newest = new Map<string, number>();
    for (const p of pos) newest.set(baseOf(p.id), Math.max(newest.get(baseOf(p.id)) ?? 0, verOf(p.id)));
    for (const p of pos) {
        const d = p.data;
        if (['superseded', 'returned'].includes(str(d.status)) && verOf(p.id) !== newest.get(baseOf(p.id))) continue;
        if (verOf(p.id) !== newest.get(baseOf(p.id)) && !PLACED.includes(str(d.status))) continue;
        const acc = accessFlags(ctx, d, scopeP, owned);
        if (!acc.any) continue;
        const priceOk = sees(ctx, acc, vis, 'prices');
        const ack = o(d.ack);
        const sent = str(d.sentAt) || str(d.approvedAt);
        const quoted = Math.max(0, ...objs(d.lines).map((l) => Number(l.leadTimeDays) || 0));
        const due = sent && quoted ? new Date(Date.parse(sent) + quoted * 86_400_000).toISOString().slice(0, 10) : '';
        recs.push({
            kind: 'pos',
            id: p.id,
            number: str(d.number) || p.id,
            title: str(d.vendorName),
            status: str(d.status),
            statusLabel: PO_STATUS[str(d.status)] ?? str(d.status),
            createdAt: str(d.originAt) || str(d.createdAt),
            month: monthOf(str(d.originAt) || str(d.createdAt)),
            path: pathOf(objs(d.lines)),
            value: priceOk ? Number(d.baseTotal) || 0 : 0,
            valueHidden: !priceOk,
            vendorId: str(d.vendorId),
            vendorName: str(d.vendorName),
            poType: str(d.poType),
            ageDays: daysBetween(str(d.approvedAt) || str(d.originAt) || str(d.createdAt), PLACED.includes(str(d.status)) && !str(d.deliveredAt) ? new Date().toISOString() : str(d.deliveredAt) || str(d.updatedAt)),
            extra: { ver: verOf(p.id), owner: str(d.ownerName), acknowledged: !!str(ack.at), due, overdue: PLACED.includes(str(d.status)) && !str(d.deliveredAt) && !!due && due < new Date().toISOString().slice(0, 10), quoted, doc: d },
        });
    }
    return { units, recs, reqs, prs, pos, cases, newest };
}

/** Narrow records to a node of the organization (or all of them), and to optional type and supplier. */
function narrow(recs: Rec[], f: { nodeId: string; type: string; vendorId: string }) {
    return recs.filter((r) => {
        if (f.nodeId && !r.path.includes(f.nodeId)) return false;
        if (f.type && r.poType !== f.type) return false;
        if (f.vendorId && r.vendorId !== f.vendorId) return false;
        return true;
    });
}
const filtersOf = (b: Obj) => ({ nodeId: str(b.nodeId), type: str(b.type), vendorId: str(b.vendorId) });
const bucketKey = (r: Rec, nodeId: string): string => {
    if (!r.path.length) return '';
    if (!nodeId) return r.path[0];
    const i = r.path.indexOf(nodeId);
    return i >= 0 && r.path[i + 1] ? r.path[i + 1] : nodeId;
};
const statusRows = (recs: Rec[]) => {
    const m = new Map<string, { status: string; label: string; count: number; value: number }>();
    for (const r of recs) {
        const c = m.get(r.status) ?? { status: r.status, label: r.statusLabel, count: 0, value: 0 };
        c.count++;
        c.value = round(c.value + r.value);
        m.set(r.status, c);
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
};

export const procurementDashboardRoutes = {
    'POST /api/org/procurement/dashboard/summary': [
        orgRoute('org.procurement.dashboard.summary', null, async (ctx) => {
            const m = await model(ctx);
            const f = filtersOf(ctx.body);
            const recs = narrow(m.recs, f);
            const req = recs.filter((r) => r.kind === 'requirements');
            const pr = recs.filter((r) => r.kind === 'prs');
            const po = recs.filter((r) => r.kind === 'pos');
            const unitOf = (id: string): Unit | undefined => m.units.get(id);
            const node = f.nodeId ? unitOf(f.nodeId) : undefined;
            const trail = node ? chainOf(m.units, node.id).reverse().map((u) => ({ id: u.id, name: u.name, level: u.level })) : [];

            // Where the records sit, one level below the chosen node.
            const kids = new Map<string, { id: string; name: string; level: string; requirements: number; prs: number; pos: number; poValue: number }>();
            let unassigned = 0;
            for (const r of recs) {
                const k = bucketKey(r, f.nodeId);
                if (!k) {
                    unassigned++;
                    continue;
                }
                const u = unitOf(k);
                const c = kids.get(k) ?? { id: k, name: u?.name ?? k, level: u?.level ?? '', requirements: 0, prs: 0, pos: 0, poValue: 0 };
                if (r.kind === 'requirements') c.requirements++;
                else if (r.kind === 'prs') c.prs++;
                else {
                    c.pos++;
                    c.poValue = round(c.poValue + r.value);
                }
                kids.set(k, c);
            }

            // By month
            const months = new Map<string, Obj>();
            const mrow = (k: string) => {
                if (!months.has(k)) months.set(k, { month: k, requirements: 0, prs: 0, pos: 0, posApproved: 0, poValue: 0, reqToPr: [] as number[], prToPo: [] as number[], poApproval: [] as number[] });
                return months.get(k)!;
            };
            for (const r of req) if (r.month) (mrow(r.month).requirements as number)++;
            for (const r of pr) if (r.month) (mrow(r.month).prs as number)++;
            const reqById = new Map(m.reqs.map((x) => [x.id, x.data]));
            const prById = new Map(m.prs.map((x) => [x.id, x.data]));
            const caseById = new Map(m.cases.map((x) => [x.id, x.data]));
            for (const r of pr) {
                const d = prById.get(r.id)!;
                const t = days(str(reqById.get(str(d.requirementId))?.approvedAt), str(d.createdAt));
                if (t !== null && r.month) (mrow(r.month).reqToPr as number[]).push(t);
            }
            for (const r of po) {
                if (r.month) {
                    (mrow(r.month).pos as number)++;
                    mrow(r.month).poValue = round((mrow(r.month).poValue as number) + r.value);
                }
                const d = r.extra.doc as Obj;
                const am = monthOf(str(d.approvedAt));
                if (am) {
                    (mrow(am).posApproved as number)++;
                    const t = days(str(d.confirmedAt), str(d.approvedAt));
                    if (t !== null) (mrow(am).poApproval as number[]).push(t);
                }
                const firstPr = prById.get(str(objs(d.lines)[0]?.requisitionId));
                const t2 = days(str(firstPr?.confirmedAt), str(d.originAt) || str(d.createdAt));
                if (t2 !== null && r.month) (mrow(r.month).prToPo as number[]).push(t2);
            }
            const monthRows = Array.from(months.values())
                .sort((a, b) => str(a.month).localeCompare(str(b.month)))
                .slice(-24)
                .map((x) => ({ ...x, reqToPr: avg(x.reqToPr as number[]), prToPo: avg(x.prToPo as number[]), poApproval: avg(x.poApproval as number[]) }));

            // Funnel and stage times
            const reqAck = req.filter((r) => ['acknowledged'].includes(r.status) || str(reqById.get(r.id)?.acknowledgedAt));
            const reqWithPr = new Set(pr.filter((r) => r.status !== 'cancelled').map((r) => str(prById.get(r.id)?.requirementId)));
            const poDocs = po.map((r) => r.extra.doc as Obj);
            const funnel = [
                { key: 'requirements', label: 'Requirements raised', count: req.filter((r) => r.status !== 'draft').length },
                { key: 'approved', label: 'Approved by the manager', count: req.filter((r) => str(reqById.get(r.id)?.approvedAt)).length },
                { key: 'acknowledged', label: 'Acknowledged by procurement', count: reqAck.length },
                { key: 'prs', label: 'Requisitions raised', count: pr.filter((r) => r.status !== 'cancelled').length },
                { key: 'prConfirmed', label: 'Requisitions confirmed', count: pr.filter((r) => str(prById.get(r.id)?.confirmedAt)).length },
                { key: 'pos', label: 'Orders created', count: poDocs.length },
                { key: 'poSubmitted', label: 'Orders submitted for approval', count: poDocs.filter((d) => str(d.confirmedAt)).length },
                { key: 'poApproved', label: 'Orders fully approved', count: poDocs.filter((d) => str(d.approvedAt)).length },
                { key: 'poSent', label: 'Orders sent to the supplier', count: poDocs.filter((d) => str(d.sentAt)).length },
                { key: 'poAck', label: 'Acknowledged by the supplier', count: poDocs.filter((d) => str(o(d.ack).at)).length },
                { key: 'poDelivered', label: 'Delivered in full', count: poDocs.filter((d) => str(d.deliveredAt)).length },
            ];
            const stage = (key: string, label: string, xs: (number | null)[]) => ({ key, label, count: xs.filter((x) => x !== null).length, avgDays: avg(xs) });
            const reqDocs = req.map((r) => reqById.get(r.id)!);
            const prDocs = pr.map((r) => prById.get(r.id)!);
            const stages = [
                stage('s1', 'Manager approval', reqDocs.map((d) => days(str(d.submittedAt), str(d.approvedAt)))),
                stage('s2', 'Procurement acknowledgement', reqDocs.map((d) => days(str(d.approvedAt), str(d.acknowledgedAt)))),
                stage('s3', 'Sourcing to recommendation', []),
                stage('s4', 'Recommendation to requisition', prDocs.map((d) => days(str(o(caseById.get(str(d.quotationId))?.recommendation).at), str(d.createdAt)))),
                stage('s5', 'Requester confirmation', prDocs.map((d) => days(str(d.createdAt), str(d.confirmedAt)))),
                stage('s6', 'Requisition to order', poDocs.map((d) => days(str(prById.get(str(objs(d.lines)[0]?.requisitionId))?.confirmedAt), str(d.originAt) || str(d.createdAt)))),
                stage('s7', 'Preparing the order', poDocs.map((d) => days(str(d.originAt) || str(d.createdAt), str(d.confirmedAt)))),
                stage('s8', 'Approval of the order', poDocs.map((d) => days(str(d.confirmedAt), str(d.approvedAt)))),
                stage('s9', 'Sending to the supplier', poDocs.map((d) => days(str(d.approvedAt), str(d.sentAt)))),
                stage('s10', 'Supplier acknowledgement', poDocs.map((d) => days(str(d.sentAt), str(o(d.ack).at)))),
                stage('s11', 'Supplier lead time to first delivery', poDocs.map((d) => days(str(d.sentAt) || str(d.approvedAt), str(d.firstDeliveryAt)))),
                stage('s12', 'Delivery to completion', poDocs.map((d) => days(str(d.firstDeliveryAt), str(d.deliveredAt)))),
            ];
            stages[2] = stage('s3', 'Sourcing to recommendation', req.map((r) => {
                const d = reqById.get(r.id)!;
                const c = m.cases.find((x) => str(x.data.requirementId) === r.id);
                return c ? days(str(d.acknowledgedAt), str(o(c.data.recommendation).at)) : null;
            }));

            // Age and lead time of orders
            const live = po.filter((r) => PLACED.includes(r.status) && !str((r.extra.doc as Obj).deliveredAt));
            const ageing = ageBuckets.map((b) => {
                const xs = live.filter((r) => r.ageDays >= b.min && r.ageDays <= b.max);
                return { key: b.key, label: b.label, count: xs.length, value: round(xs.reduce((s, r) => s + r.value, 0)) };
            });
            const delivered = poDocs.filter((d) => str(d.deliveredAt));
            const actual = (d: Obj) => days(str(d.sentAt) || str(d.approvedAt), str(d.deliveredAt));
            const quotedOf = (d: Obj) => Math.max(0, ...objs(d.lines).map((l) => Number(l.leadTimeDays) || 0));
            const onTime = delivered.filter((d) => (actual(d) ?? 0) <= quotedOf(d));

            // Suppliers
            const vendors = new Map<string, { vendorId: string; vendorName: string; pos: number; open: number; value: number; delivered: number; onTime: number; quoted: (number | null)[]; actual: (number | null)[]; acknowledged: number; sent: number; overdue: number }>();
            for (const r of po) {
                const d = r.extra.doc as Obj;
                const v = vendors.get(r.vendorId) ?? { vendorId: r.vendorId, vendorName: r.vendorName, pos: 0, open: 0, value: 0, delivered: 0, onTime: 0, quoted: [], actual: [], acknowledged: 0, sent: 0, overdue: 0 };
                v.pos++;
                v.value = round(v.value + r.value);
                if (PLACED.includes(r.status) && !str(d.deliveredAt)) v.open++;
                if (r.extra.overdue === true) v.overdue++;
                if (str(d.sentAt)) v.sent++;
                if (str(o(d.ack).at)) v.acknowledged++;
                if (str(d.deliveredAt)) {
                    v.delivered++;
                    v.quoted.push(quotedOf(d));
                    v.actual.push(actual(d));
                    if ((actual(d) ?? 0) <= quotedOf(d)) v.onTime++;
                }
                vendors.set(r.vendorId, v);
            }
            const types = ['material', 'service', 'asset'].map((t) => ({ type: t, label: TYPE_LABEL[t], pos: po.filter((r) => r.poType === t).length, prs: pr.filter((r) => r.poType === t).length, value: round(po.filter((r) => r.poType === t).reduce((s, r) => s + r.value, 0)) }));
            const pct = (a: number, b: number) => (b ? round((a / b) * 100, 1) : null);
            return {
                currency: str(ctx.org.data.currencyCode),
                node: node ? { id: node.id, name: node.name, level: node.level } : null,
                trail,
                children: Array.from(kids.values()).sort((a, b) => b.pos + b.prs + b.requirements - (a.pos + a.prs + a.requirements)),
                unassigned,
                requirements: { total: req.length, byStatus: statusRows(req) },
                prs: { total: pr.length, value: round(pr.reduce((s, r) => s + r.value, 0)), byStatus: statusRows(pr) },
                pos: { total: po.length, value: round(po.reduce((s, r) => s + r.value, 0)), byStatus: statusRows(po), valueHidden: po.some((r) => r.valueHidden) },
                open: { requirements: req.filter((r) => ['pending_approval', 'approved', 'acknowledged', 'returned_user'].includes(r.status)).length, prs: pr.filter((r) => ['draft', 'confirmed', 'returned', 'suspended'].includes(r.status)).length, pos: po.filter((r) => ['draft', 'validated', 'pending_approval', 'open', 'sent', 'partial'].includes(r.status)).length },
                months: monthRows,
                funnel,
                conversion: {
                    requirementToPr: pct(reqWithPr.size, reqAck.length),
                    prToPo: pct(pr.filter((r) => r.status === 'converted').length, pr.filter((r) => r.status !== 'cancelled').length),
                    poToApproved: pct(poDocs.filter((d) => str(d.approvedAt)).length, poDocs.filter((d) => str(d.confirmedAt)).length),
                },
                stages,
                ageing,
                overdue: po.filter((r) => r.extra.overdue === true).length,
                unacknowledged: po.filter((r) => ['sent', 'partial'].includes(r.status) && r.extra.acknowledged !== true).length,
                leadTime: { delivered: delivered.length, avgQuotedDays: avg(delivered.map(quotedOf)), avgActualDays: avg(delivered.map(actual)), onTimePct: pct(onTime.length, delivered.length) },
                vendors: Array.from(vendors.values()).sort((a, b) => b.value - a.value).slice(0, 200).map((v) => ({ vendorId: v.vendorId, vendorName: v.vendorName, pos: v.pos, open: v.open, overdue: v.overdue, value: v.value, delivered: v.delivered, onTimePct: pct(v.onTime, v.delivered), avgQuotedDays: avg(v.quoted), avgActualDays: avg(v.actual), acknowledgedPct: pct(v.acknowledged, v.sent) })),
                types,
                scope: { wide: can(ctx, 'PRC.po.view') || can(ctx, 'PRC.req.viewall') },
            };
        }),
    ],

    // The records behind a number: by dataset, status, month, node, kind, supplier or age.
    'POST /api/org/procurement/dashboard/records': [
        orgRoute('org.procurement.dashboard.records', null, async (ctx) => {
            const dataset = str(ctx.body.dataset);
            if (!['requirements', 'prs', 'pos'].includes(dataset)) throw new HttpError(400, 'Choose requirements, requisitions or orders.');
            const m = await model(ctx);
            const f = filtersOf(ctx.body);
            const status = str(ctx.body.status);
            const month = str(ctx.body.month);
            const bucket = str(ctx.body.bucket);
            const childId = str(ctx.body.childId);
            const b = ageBuckets.find((x) => x.key === bucket);
            let recs = narrow(m.recs, f).filter((r) => r.kind === dataset);
            if (status) recs = recs.filter((r) => r.status === status);
            if (month) recs = recs.filter((r) => r.month === month);
            if (childId) recs = recs.filter((r) => bucketKey(r, f.nodeId) === childId);
            if (b) recs = recs.filter((r) => PLACED.includes(r.status) && !str((r.extra.doc as Obj | undefined)?.deliveredAt) && r.ageDays >= b.min && r.ageDays <= b.max);
            if (ctx.body.overdue === true) recs = recs.filter((r) => r.extra.overdue === true);
            if (ctx.body.unacknowledged === true) recs = recs.filter((r) => ['sent', 'partial'].includes(r.status) && r.extra.acknowledged !== true);
            const rows = recs
                .sort((a, c) => c.createdAt.localeCompare(a.createdAt))
                .slice(0, 1000)
                .map((r) => {
                    const unit = r.path.length ? m.units.get(r.path[r.path.length - 1]) : undefined;
                    return { id: r.id, number: r.number, title: r.title, status: r.status, statusLabel: r.statusLabel, createdAt: r.createdAt, month: r.month, costCenter: unit ? `${unit.code} ${unit.name}` : '', vendorName: r.vendorName, type: TYPE_LABEL[r.poType] ?? '', value: r.valueHidden ? null : r.value, ageDays: r.ageDays, owner: str(r.extra.owner), requester: str(r.extra.requesterName), acknowledged: r.extra.acknowledged === true, overdue: r.extra.overdue === true, due: str(r.extra.due), ver: Number(r.extra.ver) || 0 };
                });
            return { rows, count: recs.length, currency: str(ctx.org.data.currencyCode) };
        }),
    ],
};
