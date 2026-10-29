/**
 * Maintenance planning money: period maintenance budgets per cost center, and the work order cost estimate approved
 * under the Chart of Authority before the planner may confirm readiness.
 *
 *  - Budgets are proposed by a holder of MNT.budget.manage and approved through the shared Finance request engine
 *    (FIN.cc.approve, level by level under the legal entity's authority bands). Approving writes the period budget.
 *  - A work order's estimate (labour + spares at live average cost + services + an allowance for items with no cost
 *    yet) is approved the same way with MNT.WO.costApprove. The planner can never approve their own estimate (maker
 *    is the planner; the engine refuses makers and repeat approvers). An approval lapses when the assessed tasks or
 *    the estimate change.
 *  - Committed spend in a period is the sum of approved estimates of open work orders of the cost center scheduled to
 *    start in that period.
 * Every proposal, decision and lapse is in the request history and the audit trail.
 */
import { HttpError, fieldEq, getDoc, isObj, listDocs, nowIso, runQuery, str, type Doc, type Obj } from './core';
import { canAnywhere, canAt } from './access';
import { orgRoute, type OrgContext } from './guards';
import { audit } from './audit';
import { cannotDecide, commit, createRequest, leOf, reasonOf, registerHandler, scopeOf as finScope, unitsOf } from './finCore';
import { decideRequest } from './finRoutes';
import { scopeOf } from './access';

export const BUDGET_REQUEST = 'mnt.budget.set';
export const COST_REQUEST = 'mnt.wo.cost';
export const COST_APPROVE = 'MNT.WO.costApprove';
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_AMOUNT = 1e13;
const root = (orgId: string) => `organizations/${orgId}`;
export const budgetPath = (orgId: string, ccId: string, period: string) => `${root(orgId)}/mnt_budgets/${ccId}_${period}`;
export const periodOf = (date: string) => (/^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : '');
const rows = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter(isObj) as Obj[]) : []);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const nameOf = (ctx: OrgContext) => [str(ctx.me.data.firstName), str(ctx.me.data.lastName)].filter(Boolean).join(' ') || ctx.actor.email;
const rec = (ctx: OrgContext, action: string, target: string, details: string) =>
    audit([{ category: 'maintenance', action, actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { label: target }, details: details.slice(0, 1800) }]);

// ----- Estimate -----

export interface Estimate {
    labour: number;
    spares: number;
    services: number;
    allowance: number;
    total: number;
    uncosted: Array<{ task: string; item: string; kind: 'spare' | 'service' }>;
}
/**
 * The work order estimate from its assessed tasks. Spares use the live average cost of the planned warehouse stock
 * when known (readiness items), else the cost recorded at assessment; services use their expected cost. Items with no
 * cost are listed so the planner covers them with an allowance.
 */
export function estimateOf(wo: Doc, readinessItems: Obj[], allowance = Number(obj(wo.data.costPlan).allowance) || 0): Estimate {
    let labour = 0,
        spares = 0,
        services = 0;
    const uncosted: Estimate['uncosted'] = [];
    for (const t of rows(wo.data.assessmentTasks)) {
        const task = str(t.title) || str(t.description);
        labour += (Number(t.persons) || 0) * (Number(t.hours) || 0) * (Number(t.rate) || 0);
        for (const s of rows(t.spares)) {
            const live = readinessItems.find((i) => i.taskId === t.id && i.spareId === s.id);
            const unit = live && typeof live.unitCost === 'number' && live.unitCost > 0 ? Number(live.unitCost) : Number(s.unitCost) > 0 ? Number(s.unitCost) : null;
            if (unit === null) uncosted.push({ task, item: str(s.description), kind: 'spare' });
            else spares += unit * (Number(s.qty) || 0);
        }
        for (const s of rows(t.services)) {
            const cost = s.expectedCost === null || s.expectedCost === undefined || s.expectedCost === '' ? null : Number(s.expectedCost);
            if (cost === null || !Number.isFinite(cost)) uncosted.push({ task, item: str(s.description), kind: 'service' });
            else services += cost;
        }
    }
    const a = Math.max(0, Number(allowance) || 0);
    return { labour: r2(labour), spares: r2(spares), services: r2(services), allowance: r2(a), total: r2(labour + spares + services + a), uncosted };
}

/** State of the work order's cost approval against the current estimate. */
export async function costApprovalOf(orgId: string, wo: Doc, est: Estimate) {
    const ca = obj(wo.data.costApproval);
    const version = Number(wo.data.assessmentTasksVersion) || 0;
    let status = str(ca.status) || 'none';
    if (status === 'pending' && str(ca.requestId)) {
        const req = await getDoc(`${root(orgId)}/fin_requests/${str(ca.requestId)}`);
        const rs = str(req?.data.status);
        if (rs === 'rejected' || rs === 'withdrawn') status = rs;
    }
    // An approval lapses when the assessed scope changes (reassessment); live stock cost movements do not void it.
    const stale = status === 'approved' && Number(ca.version) !== version;
    return {
        status: stale ? 'stale' : status,
        requestId: str(ca.requestId),
        amount: Number(ca.amount) || 0,
        approvedAt: str(ca.approvedAt),
        approvedBy: str(ca.approvedByName),
        submittedBy: str(ca.submittedBy),
        overBudget: ca.overBudget === true,
        justification: str(ca.justification),
        current: (status === 'approved' && !stale) || est.total === 0,
    };
}

// ----- Budgets -----

export async function budgetStatus(orgId: string, ccId: string, period: string, excludeWo = '') {
    const doc = ccId && PERIOD_RE.test(period) ? await getDoc(budgetPath(orgId, ccId, period)) : null;
    const wos = await runQuery({ from: [{ collectionId: 'work_orders' }], where: fieldEq('costCenterId', ccId) }, root(orgId));
    const committed = wos
        .filter((w) => w.id !== excludeWo && !['cancelled'].includes(str(w.data.status)) && periodOf(str(w.data.scheduledStart)) === period)
        .reduce((n, w) => {
            const ca = obj(w.data.costApproval);
            return n + (str(ca.status) === 'approved' ? Number(ca.amount) || 0 : 0);
        }, 0);
    const budget = doc ? Number(doc.data.amount) || 0 : null;
    return { period, budget, committed: r2(committed), available: budget === null ? null : r2(budget - committed), version: Number(doc?.data.version) || 0 };
}

registerHandler(BUDGET_REQUEST, {
    label: 'Maintenance period budget',
    approvePerm: 'FIN.cc.approve',
    valued: true,
    apply: async (ctx, req) => {
        const p = obj(req.payload);
        const ccId = str(p.ccId),
            period = str(p.period);
        if (!ID_RE.test(ccId) || !PERIOD_RE.test(period)) throw new HttpError(409, 'The budget request is invalid.');
        const units = await unitsOf(ctx.orgId);
        if (units.get(ccId)?.level !== 'cost_center' || leOf(units, ccId)?.id !== str(req.leId)) throw new HttpError(409, 'The cost center is no longer in this legal entity.');
        const path = budgetPath(ctx.orgId, ccId, period);
        const cur = await getDoc(path);
        if ((Number(cur?.data.version) || 0) !== Number(p.baseVersion)) throw new HttpError(409, 'The budget changed after this request was made. Reject it and propose again.');
        const version = (Number(cur?.data.version) || 0) + 1;
        await commit([{
            path,
            fields: {
                ccId, period, leId: str(req.leId), amount: Number(p.amount), currency: str(p.currency), version,
                requestId: str(req.id), proposedBy: str(req.makerUid), approvedBy: ctx.uid, approvedAt: nowIso(), reason: str(req.reason),
                history: [...rows(cur?.data.history), { version, amount: Number(p.amount), requestId: str(req.id), approvedBy: ctx.uid, at: nowIso() }].slice(-50),
            },
            ...(cur ? { updateTime: cur.updateTime } : { exists: false }),
        }]);
        await rec(ctx, 'mnt.budget.approved', `${ccId} ${period}`, `${p.currency} ${p.amount} (version ${version}, ${req.id})`);
        return { version };
    },
});

registerHandler(COST_REQUEST, {
    label: 'Maintenance work order cost',
    approvePerm: COST_APPROVE,
    valued: true,
    apply: async (ctx, req) => {
        const p = obj(req.payload);
        const code = str(p.woCode);
        if (!/^WO\d{8}$/.test(code)) throw new HttpError(409, 'The cost request is invalid.');
        const wo = await getDoc(`${root(ctx.orgId)}/work_orders/${code}`);
        if (!wo) throw new HttpError(409, 'The work order no longer exists.');
        if (!['planning', 'plan_ready'].includes(str(wo.data.status))) throw new HttpError(409, 'The work order has left planning; its cost can no longer be approved here.');
        const ca = obj(wo.data.costApproval);
        if (str(ca.requestId) !== str(req.id) || Number(ca.version) !== (Number(wo.data.assessmentTasksVersion) || 0))
            throw new HttpError(409, 'The work order was reassessed after this request. Reject it; the planner submits the new estimate.');
        if (str(wo.data.plannedBy) === ctx.uid || str(ca.submittedBy) === ctx.uid) throw new HttpError(403, 'You planned this work order, so someone else must approve its cost.');
        await commit([{
            path: `${root(ctx.orgId)}/work_orders/${code}`,
            fields: {
                ...wo.data,
                costApproval: { ...ca, status: 'approved', approvedBy: ctx.uid, approvedByName: nameOf(ctx), approvedAt: nowIso() },
                updatedAt: nowIso(),
                history: [...rows(wo.data.history), { at: nowIso(), uid: ctx.uid, name: nameOf(ctx), action: 'Cost approved', note: `${str(p.currency)} ${p.amount} · ${req.id}` }],
            },
            updateTime: wo.updateTime,
        }]);
        await rec(ctx, 'mnt.wo.cost_approved', code, `${str(p.currency)} ${p.amount} · ${req.id}`);
        return { ok: true };
    },
});

/** Submit the work order estimate for Chart of Authority approval (called by the planning action). */
export async function submitCost(ctx: OrgContext, wo: Doc, est: Estimate, body: Record<string, unknown>) {
    const ccId = str(wo.data.costCenterId);
    const units = await unitsOf(ctx.orgId);
    const le = leOf(units, ccId);
    if (!le) throw new HttpError(409, 'The work order cost center is not under a legal entity, so its cost cannot be approved.');
    if (est.total <= 0) throw new HttpError(400, 'The estimate is zero: nothing needs approval.');
    if (est.uncosted.length && est.allowance <= 0)
        throw new HttpError(400, `${est.uncosted.length} item(s) have no cost yet. Enter an allowance that covers them.`);
    const period = periodOf(str(wo.data.scheduledStart));
    const budget = await budgetStatus(ctx.orgId, ccId, period, wo.id);
    const overBudget = budget.available === null || est.total > budget.available;
    const justification = str(body.justification).trim().slice(0, 600);
    if (overBudget && justification.length < 20)
        throw new HttpError(400, budget.budget === null ? `No maintenance budget is set for ${str(wo.data.costCenterCode)} in ${period}. Explain why this work must go ahead (at least 20 characters).` : `The estimate exceeds the budget available for ${period}. Explain why (at least 20 characters).`);
    const reason = reasonOf(body);
    const currency = str(ctx.org.data.currencyCode);
    const out = await createRequest(ctx, {
        leId: le.id,
        type: COST_REQUEST,
        scopeKey: `mnt_wo_cost_${wo.id}`,
        title: `${wo.id} ${str(wo.data.title)}: estimated cost`.slice(0, 160),
        summary: `Labour ${est.labour}, spares ${est.spares}, services ${est.services}, allowance ${est.allowance}: total ${currency} ${est.total}. ${str(wo.data.costCenterCode)} ${period}: budget ${budget.budget ?? 'not set'}, committed ${budget.committed}, available ${budget.available ?? 'n/a'}.${overBudget ? ` Over budget: ${justification}` : ''}`,
        payload: { woCode: wo.id, amount: est.total, currency, version: Number(wo.data.assessmentTasksVersion) || 0, period, ccId, estimate: est as unknown as Obj, budget: budget as unknown as Obj },
        amount: est.total,
        reason,
    });
    return {
        requestId: out.id,
        costApproval: { status: 'pending', requestId: out.id, amount: est.total, version: Number(wo.data.assessmentTasksVersion) || 0, period, ccId, overBudget, justification, submittedBy: ctx.uid, submittedAt: nowIso() },
        costPlan: { allowance: est.allowance, uncosted: est.uncosted.length },
    };
}

// ----- Routes -----

const mayReadBudgets = (ctx: OrgContext) => ['MNT.budget.manage', 'MNT.WO.plan', COST_APPROVE, 'FIN.cc.approve'].some((p) => canAnywhere(ctx, p));

export const maintenancePlanningRoutes = {
    'POST /api/org/mnt/budget/list': [
        orgRoute('org.mnt.budget.list', 'MNT.view', async (ctx) => {
            if (!mayReadBudgets(ctx)) throw new HttpError(403, 'Maintenance budgets need MNT.budget.manage, MNT.WO.plan or a cost approval right.');
            const period = str(ctx.body.period) || nowIso().slice(0, 7);
            if (!PERIOD_RE.test(period)) throw new HttpError(400, 'Choose a month (YYYY-MM).');
            const [units, scope, nodes, requests] = await Promise.all([
                unitsOf(ctx.orgId), scopeOf(ctx), listDocs(`${root(ctx.orgId)}/structure`),
                runQuery({ from: [{ collectionId: 'fin_requests' }], where: fieldEq('type', BUDGET_REQUEST) }, root(ctx.orgId)),
            ]);
            const parent = new Map(nodes.map((n) => [n.id, str(n.data.parentId)]));
            const pathTo = (id: string) => { const out: string[] = []; for (let cur = id, i = 0; cur && i < 16; cur = parent.get(cur) ?? '', i++) out.unshift(cur); return out; };
            const ccs = nodes.filter((n) => str(n.data.level) === 'cost_center' && str(n.data.status) !== 'inactive' && canAt(ctx, 'MNT.view', pathTo(n.id), scope));
            const out: Obj[] = [];
            for (const cc of ccs) {
                const s = await budgetStatus(ctx.orgId, cc.id, period);
                const pending = requests.find((r) => str(r.data.status) === 'pending' && str(obj(r.data.payload).ccId) === cc.id && str(obj(r.data.payload).period) === period);
                out.push({
                    ccId: cc.id, ccCode: str(cc.data.code), ccName: str(cc.data.name), leCode: leOf(units, cc.id)?.code ?? '',
                    ...s, pendingRequestId: pending?.id ?? '', pendingAmount: pending ? Number(obj(pending.data.payload).amount) || 0 : null,
                    canPropose: canAt(ctx, 'MNT.budget.manage', pathTo(cc.id), scope) && !!leOf(units, cc.id),
                });
            }
            return { period, currency: str(ctx.org.data.currencyCode), rows: out.sort((a, b) => str(a.ccCode).localeCompare(str(b.ccCode))) };
        }),
    ],
    'POST /api/org/mnt/budget/propose': [
        orgRoute('org.mnt.budget.propose', 'MNT.budget.manage', async (ctx) => {
            const ccId = str(ctx.body.ccId),
                period = str(ctx.body.period);
            if (!ID_RE.test(ccId)) throw new HttpError(400, 'Choose a cost center.');
            if (!PERIOD_RE.test(period)) throw new HttpError(400, 'Choose the month (YYYY-MM).');
            if (period < nowIso().slice(0, 7)) throw new HttpError(400, 'A budget can only be set for this month or later.');
            const amount = Number(ctx.body.amount);
            if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) throw new HttpError(400, 'Enter the budget amount (0 or more).');
            const [units, scope, nodes] = await Promise.all([unitsOf(ctx.orgId), scopeOf(ctx), listDocs(`${root(ctx.orgId)}/structure`)]);
            const cc = units.get(ccId);
            if (cc?.level !== 'cost_center') throw new HttpError(404, 'Cost center not found.');
            const parent = new Map(nodes.map((n) => [n.id, str(n.data.parentId)]));
            const path: string[] = [];
            for (let cur = ccId, i = 0; cur && i < 16; cur = parent.get(cur) ?? '', i++) path.unshift(cur);
            if (!canAt(ctx, 'MNT.budget.manage', path, scope)) throw new HttpError(403, 'You cannot propose budgets for this cost center.');
            const le = leOf(units, ccId);
            if (!le) throw new HttpError(409, 'The cost center is not under a legal entity.');
            const reason = reasonOf(ctx.body);
            const current = await budgetStatus(ctx.orgId, ccId, period);
            if (current.budget !== null && current.budget === Math.round(amount * 100) / 100) throw new HttpError(400, 'That is already the approved budget.');
            if (current.committed > amount) throw new HttpError(409, `Approved work orders already commit ${current.committed} in ${period}; the budget cannot be lower.`);
            const currency = str(ctx.org.data.currencyCode);
            const out = await createRequest(ctx, {
                leId: le.id,
                type: BUDGET_REQUEST,
                scopeKey: `mnt_budget_${ccId}_${period}`,
                title: `${cc.code} ${cc.name}: maintenance budget ${period}`,
                summary: `${currency} ${amount.toLocaleString('en')} for ${period}${current.budget !== null ? ` (was ${current.budget})` : ' (new)'}; committed ${current.committed}.`,
                payload: { ccId, period, amount: Math.round(amount * 100) / 100, currency, baseVersion: current.version, previous: current.budget },
                amount,
                reason,
            });
            await rec(ctx, 'mnt.budget.proposed', `${cc.code} ${period}`, `${currency} ${amount} · ${out.id} · ${reason}`);
            return { ok: true, id: out.id };
        }),
    ],
    'POST /api/org/mnt/cost/requests': [
        orgRoute('org.mnt.cost.requests', 'MNT.view', async (ctx) => {
            const [docs, units, scope] = await Promise.all([
                runQuery({ from: [{ collectionId: 'fin_requests' }], where: fieldEq('type', COST_REQUEST) }, root(ctx.orgId)),
                unitsOf(ctx.orgId), finScope(ctx),
            ]);
            const approver = canAnywhere(ctx, COST_APPROVE);
            const out = docs
                .filter((d) => approver || str(d.data.makerUid) === ctx.uid)
                .map((d) => {
                    const p = obj(d.data.payload);
                    const step = rows(d.data.steps).find((s) => s.status === 'pending');
                    return {
                        id: d.id, status: str(d.data.status), title: str(d.data.title), summary: str(d.data.summary), reason: str(d.data.reason),
                        woCode: str(p.woCode), amount: Number(p.amount) || 0, currency: str(p.currency), period: str(p.period),
                        estimate: obj(p.estimate), budget: obj(p.budget), maker: str(d.data.makerName), createdAt: str(d.data.createdAt),
                        level: step ? `${str(step.level)} · ${str(step.positionTitle)}` : '',
                        whyNot: cannotDecide(ctx, d.data, units, scope), mine: str(d.data.makerUid) === ctx.uid,
                    };
                })
                .map((r) => ({ ...r, canDecide: !r.whyNot }))
                .sort((a, b) => Number(b.canDecide) - Number(a.canDecide) || b.createdAt.localeCompare(a.createdAt))
                .slice(0, 500);
            return { requests: out, canApprove: approver };
        }),
    ],
    'POST /api/org/mnt/cost/decide': [
        orgRoute('org.mnt.cost.decide', 'MNT.WO.costApprove', async (ctx) => {
            const id = str(ctx.body.id);
            if (!/^FCR\d{8}$/.test(id)) throw new HttpError(404, 'Request not found.');
            const decision = str(ctx.body.decision);
            if (decision !== 'approve' && decision !== 'reject') throw new HttpError(400, 'Approve or reject.');
            const note = decision === 'reject' ? reasonOf(ctx.body) : str(ctx.body.reason).replace(/\s+/g, ' ').trim().slice(0, 300);
            if (decision === 'approve' && ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that you have checked the estimate and the budget before approving.');
            const result = await decideRequest(ctx, id, decision, note, (d) => {
                if (str(d.data.type) !== COST_REQUEST) throw new HttpError(404, 'Request not found.');
            });
            await rec(ctx, `mnt.wo.cost_${decision}`, id, note);
            return result;
        }),
    ],
};
