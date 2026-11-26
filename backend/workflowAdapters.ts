// ---------------------------------------------------------------------------
// One adapter per workflow that waits on an employee. Each says which records are live, what the current step is (its
// key changes whenever the step changes or comes round again) and who must act, using the module's OWN rule for that
// step (exported from the module, evaluated for each employee's real access), so the action reaches exactly the people
// the module would let act. Modules are imported when used, so this file adds no load-order cycle.
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto';
import { getDoc, isObj, listDocs, str } from './core';
import type { Adapter, Env, Person, Stage } from './workflowActions';
import type { Candidate } from './workflowActionsCore';

type Obj = Record<string, unknown>;
const root = (o: string) => `organizations/${o}`;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const o = (v: unknown): Obj => (isObj(v) ? v : {});
const short = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 10);
const money = (d: Obj, k = 'amount') => (Number(o(d.approval)[k] ?? d[k]) ? `${str(d.currency) || ''} ${Number(o(d.approval)[k] ?? d[k]).toLocaleString('en-US', { maximumFractionDigits: 2 })}`.trim() : '');
const pendingStep = (steps: unknown) => objs(steps).find((s) => str(s.status) === 'pending') ?? null;
const approvedBy = (steps: unknown) => objs(steps).filter((s) => str(s.status) === 'approved').map((s) => str(s.by));
const lastBy = (d: Obj) => {
    const h = objs(d.history);
    const pick = h.length ? (str(h[0].at) > str(h[h.length - 1].at) ? h[0] : h[h.length - 1]) : {};
    return str(pick.byName) || str(d.updatedByName) || str(d.decidedByName) || '';
};
const only = (env: Env, ...uids: string[]) => async () => env.uids(...uids.filter(Boolean));
const rule = (env: Env, fn: (p: Person) => boolean | Promise<boolean>) => () => env.who(fn);
const stage = (key: string, label: string, eligible: () => Promise<Candidate[]>, extra: Partial<Stage> = {}): Stage => ({ key, label, eligible, ...extra });

// ----- Procurement -----

const requirements: Adapter = {
    key: 'prc.requirement', module: 'Procurement', label: 'Purchase requirement',
    collection: (org) => `${root(org)}/procurement_requirements`, statuses: ['pending_approval', 'returned_user', 'approved'],
    routes: /^org\.(procurement\.req|procurement\.requirements|inventory\.requirements|mnt\.)/,
    link: 'purchase_requirements', linkLabel: 'Procurement › Purchase requirements',
    ref: (id) => id, title: (id, d) => `Purchase requirement ${id}${str(d.title) ? ` · ${str(d.title)}` : ''}`,
    by: lastBy,
    async stage(env, id, d) {
        const { flags, storesGate } = await import('./purchaseRequirements');
        const { can } = await import('./procurementSetup');
        const s = str(d.status);
        const lines = objs(d.lines).length;
        const details = [{ label: 'Requester', value: str(d.requesterName) }, { label: 'Items', value: String(lines) }];
        if (s === 'pending_approval') return stage(`approve|${str(d.submittedAt)}`, `Approve as ${str(d.approverTitle) || 'immediate manager'}`, rule(env, (p) => flags(p.ctx, d).approve), { details });
        if (s === 'returned_user') return stage(`returned|${short(str(d.returnReason))}|${str(d.updatedAt).slice(0, 10)}`, 'Revise the returned requirement and submit it again', only(env, str(d.requesterUid)), { details: [...details, { label: 'Reason', value: str(d.returnReason) }] });
        if (s === 'approved' && storesGate(d)) return stage(`stores|${str(d.approvedAt) || str(d.submittedAt)}`, 'Stores release: check stock and pipeline', rule(env, (p) => can(p.ctx, 'INV.req.release') && p.uid !== str(d.requesterUid)), { details, link: 'inventory_requirements', linkLabel: 'Inventory › Requirements' });
        if (s === 'approved') return stage(`acknowledge|${str(d.approvedAt) || str(d.submittedAt)}`, 'Acknowledge for sourcing (procurement desk)', rule(env, (p) => flags(p.ctx, d).acknowledge), { details });
        return null;
    },
};

const orders: Adapter = {
    key: 'prc.order', module: 'Procurement', label: 'Purchase order',
    collection: (org) => `${root(org)}/procurement_orders`, statuses: ['pending_approval', 'returned'],
    routes: /^org\.procurement\.(orders|requisitions|quotations)/,
    link: 'procurement_orders', linkLabel: 'Procurement › Purchase orders',
    ref: (id, d) => str(d.number) || id, title: (id, d) => `Purchase order ${str(d.number) || id}${str(d.vendorName) ? ` · ${str(d.vendorName)}` : ''}`,
    by: lastBy,
    async stage(env, id, d) {
        const { approverCheck, ownerOf } = await import('./purchaseOrders');
        const { can } = await import('./procurementSetup');
        const details = [{ label: 'Supplier', value: str(d.vendorName) }, { label: 'Value', value: money(d) || (Number(d.baseTotal) ? String(d.baseTotal) : '') }];
        if (str(d.status) === 'pending_approval') {
            const step = pendingStep(o(d.approval).steps);
            if (!step) return null;
            return stage(`level|${str(step.level)}|${str(o(d.approval).startedAt)}`, `Approve level ${str(step.level)} (${str(step.positionTitle)})`, rule(env, (p) => can(p.ctx, 'PRC.po.approve') && approverCheck(p.ctx, d).ok), { details });
        }
        if (str(d.status) === 'returned' && !str(d.nextVersion)) return stage(`returned|${short(str(d.returnReason))}`, 'Correct the returned order', only(env, ownerOf(d)), { details: [...details, { label: 'Reason', value: str(d.returnReason) }] });
        return null;
    },
};

const requisitions: Adapter = {
    key: 'prc.requisition', module: 'Procurement', label: 'Purchase requisition',
    collection: (org) => `${root(org)}/procurement_requisitions`, statuses: ['draft'],
    routes: /^org\.procurement\.(requisitions|quotations|orders)/,
    link: 'procurement_requisitions', linkLabel: 'Procurement › Purchase requisitions',
    ref: (id, d) => str(d.number) || id, title: (id, d) => `Purchase requisition ${str(d.number) || id}`,
    async stage(env, id, d) {
        if (!str(d.requesterUid)) return null;
        return stage(`confirm|${str(d.createdAt)}`, 'Confirm the requisition raised from your requirement', only(env, str(d.requesterUid)));
    },
};

const vendors: Adapter = {
    key: 'prc.vendor', module: 'Procurement', label: 'Vendor registration',
    collection: (org) => `${root(org)}/vendors`, statuses: ['pending_approval', 'returned'],
    routes: /^org\.procurement\.vendors/,
    link: 'procurement_vendors', linkLabel: 'Procurement › Vendors',
    ref: (id) => id, title: (id, d) => `Vendor ${id} · ${str(d.name) || str(d.legalName)}`,
    by: lastBy,
    async stage(env, id, d) {
        const { flags } = await import('./vendors');
        if (str(d.status) === 'pending_approval') return stage(`approve|${str(d.submittedAt) || str(d.updatedAt)}`, 'Approve, return or reject the vendor', rule(env, (p) => flags(p.ctx, d).decide));
        return stage(`returned|${short(str(d.returnReason) || str(d.updatedAt))}`, 'Correct the returned vendor and submit it again', only(env, str(d.createdBy)));
    },
};

const agreements: Adapter = {
    key: 'prc.agreement', module: 'Procurement', label: 'Purchase agreement',
    collection: (org) => `${root(org)}/purchase_agreements`, statuses: ['pending_approval', 'returned'],
    routes: /^org\.procurement\.agreements/,
    link: 'procurement_agreements', linkLabel: 'Procurement › Purchase agreements',
    ref: (id, d) => str(d.number) || id, title: (id, d) => `Purchase agreement ${str(d.number) || id}${str(d.vendorName) ? ` · ${str(d.vendorName)}` : ''}`,
    by: lastBy,
    async stage(env, id, d) {
        const { approverCheck } = await import('./purchaseAgreements');
        const { can } = await import('./procurementSetup');
        const details = [{ label: 'Supplier', value: str(d.vendorName) }, { label: 'Period', value: `${str(d.startDate)} to ${str(d.endDate)}` }, { label: 'Value', value: Number(o(d.approval).amount) ? `${str(d.orgCurrency)} ${Number(o(d.approval).amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '' }];
        if (str(d.status) === 'pending_approval') {
            const step = pendingStep(o(d.approval).steps);
            if (!step) return null;
            return stage(`level|${str(step.level)}|${str(o(d.approval).startedAt)}`, `Approve level ${str(step.level)} (${str(step.positionTitle)})`, rule(env, (p) => can(p.ctx, 'PRC.agreements.approve') && approverCheck(p.ctx, d).ok), { details });
        }
        if (str(d.status) === 'returned') return stage(`returned|${short(str(d.returnReason))}|${str(o(d.approval).returnedAt)}`, 'Correct the returned purchase agreement and submit it again', only(env, str(d.ownerUid) || str(d.createdBy)), { details: [...details, { label: 'Reason', value: str(d.returnReason) }] });
        return null;
    },
};

// ----- Finance -----

const apDoc = (key: string, coll: string, label: string, perm: string): Adapter => ({
    key, module: 'Finance', label,
    collection: (org) => `${root(org)}/${coll}`, statuses: ['pending_approval'],
    routes: /^org\.fin\.ap\./,
    link: 'fin_ap', linkLabel: 'Finance › Accounts payable',
    ref: (id) => id, title: (id, d) => `${label} ${id}${str(d.vendorName) ? ` · ${str(d.vendorName)}` : ''}`,
    by: lastBy,
    async stage(env, id, d) {
        const { decider } = await import('./accountsPayable');
        const step = pendingStep(o(d.approval).steps);
        if (!step) return null;
        return stage(`level|${str(step.level)}|${str(d.submittedAt) || str(d.createdAt)}`, `Approve level ${str(step.level)} (${str(step.positionTitle)})`, rule(env, (p) => decider(p.ctx, d, perm).ok), { details: [{ label: 'Value', value: money(d) }] });
    },
});

const finRequests: Adapter = {
    key: 'fin.request', module: 'Finance', label: 'Finance change request',
    collection: (org) => `${root(org)}/fin_requests`, statuses: ['pending'],
    routes: /^org\.fin\.(?!ap\.)/,
    link: 'fin_approvals', linkLabel: 'Finance › Finance approvals',
    ref: (id) => id, title: (id, d) => `${str(d.typeLabel) || 'Finance request'} · ${str(d.title) || id}`,
    async stage(env, id, d) {
        const step = pendingStep(d.steps);
        if (!step) return null;
        const { nextApprovers, unitsOf } = await import('./finCore');
        const memoKey = 'fin.units';
        if (!env.memo.has(memoKey)) env.memo.set(memoKey, unitsOf(env.orgId));
        const next = await nextApprovers(env.base, [{ ...d, id }], (await env.memo.get(memoKey)) as Awaited<ReturnType<typeof unitsOf>>);
        const people = next.get(id)?.people ?? [];
        return stage(`step|${str(step.level)}|${str(d.createdAt)}`, `Approve ${str(step.level) === 'A' ? '' : `level ${str(step.level)} `}${str(step.title) || ''}`.trim(), async () => env.uids(...people.map((x) => x.uid)), { details: [{ label: 'Prepared by', value: str(d.makerName) }] });
    },
};

// ----- Inventory -----

const materialFlow = (key: string, coll: string, label: string): Adapter => ({
    key, module: 'Inventory', label,
    collection: (org) => `${root(org)}/${coll}`, statuses: ['pending_approval'],
    routes: /^org\.(procurement|inventory)\./,
    link: 'material_catalog', linkLabel: 'Materials Master',
    ref: (id, d) => str(d.requestNumber) || str(d.extensionNumber) || str(d.materialNumber) || id,
    title: (id, d) => `${label}: ${str(d.name) || str(d.shortText) || str(d.materialName) || id}`,
    by: lastBy,
    async stage(env, id, d) {
        const { materialWorkflowSnapshot, materialApproverCanAct } = await import('./procurement');
        const wf = materialWorkflowSnapshot(d as never);
        if (!wf) return null;
        const level = Number(d.approvalLevel) || 1;
        return stage(`level|${level}|${str(d.submittedAt) || str(d.createdAt)}`, `Approve level ${level}${wf.name ? ` · ${wf.name}` : ''}`, rule(env, (p) => materialApproverCanAct(p.ctx, d as never, wf)));
    },
});

/** Registry workflows (workflow_registry steps: mode user or role). */
function registryHolders(env: Env, step: Obj | undefined, exclude: string[]): Candidate[] {
    if (!step) return [];
    if (str(step.mode) === 'user') return env.uids(str(step.uid)).filter((c) => !exclude.includes(c.uid));
    if (str(step.mode) === 'role') {
        const role = str(step.role);
        return env.people.filter((p) => !exclude.includes(p.uid) && (p.ctx.role === role || objs(p.user.data.assignments).some((a) => str(a.positionCode) === role || str(a.roleCode) === role))).map((p) => ({ uid: p.uid, superAdmin: p.superAdmin }));
    }
    return [];
}
async function registry(env: Env) {
    if (!env.memo.has('registry')) env.memo.set('registry', listDocs(`${root(env.orgId)}/workflow_registry`));
    return (await env.memo.get('registry')) as Awaited<ReturnType<typeof listDocs>>;
}

const stockAdjustments: Adapter = {
    key: 'inv.stock_adjustment', module: 'Inventory', label: 'Stock adjustment',
    collection: (org) => `${root(org)}/material_isolation_requests`, statuses: ['pending_approval', 'approved_pending_posting'],
    routes: /^org\.(inventory|procurement)\./,
    link: 'inventory_on_hand', linkLabel: 'Inventory › On hand',
    ref: (id) => id, title: (id, d) => `Stock adjustment ${str(d.materialNumber)} · ${str(d.reason)}`,
    by: lastBy,
    async stage(env, id, d) {
        const owner = str(d.createdBy);
        if (str(d.status) === 'approved_pending_posting') return stage(`post|${str(d.approvedAt)}`, 'Post the approved adjustment', async () => [...env.uids(str(d.approvedBy)), ...env.superAdmins.map((u) => ({ uid: u, superAdmin: true }))]);
        const flow = (await registry(env)).find((x) => x.id === 'INV-003' && x.data.enabled === true);
        const level = Number(d.approvalLevel) || 1;
        const step = objs(flow?.data.steps)[level - 1];
        return stage(`level|${level}|${str(d.createdAt)}`, `Approve level ${level}`, async () => registryHolders(env, step, [owner]), { details: [{ label: 'Quantity', value: str(d.quantity) }, { label: 'Warehouse', value: str(d.warehouseId) }] });
    },
};

const genericRequests: Adapter = {
    key: 'wf.request', module: 'Workflow', label: 'Workflow request',
    collection: (org) => `${root(org)}/workflow_requests`, statuses: ['pending_approval'],
    routes: /^org\.(procurement\.workflows|workflow)/,
    link: 'my_workflow', linkLabel: 'My Workflow',
    ref: (id, d) => str(d.reference) || id, title: (id, d) => str(d.description) || str(d.name) || str(d.transactionName) || id,
    async stage(env, id, d) {
        const flow = (await registry(env)).find((x) => x.id === str(d.workflowCode) && x.data.enabled === true);
        const level = Number(d.approvalLevel) || 1;
        const step = objs(flow?.data.steps)[level - 1];
        return stage(`level|${level}|${str(d.submittedAt) || str(d.createdAt)}`, `Approve level ${level}${str(flow?.data.name) ? ` · ${str(flow?.data.name)}` : ''}`, async () => registryHolders(env, step, [str(d.createdBy || d.submittedBy)]));
    },
};

const countersOf = (d: Obj) => [...new Set([...ids(d.countedByAll), str(d.countedBy)].filter(Boolean))];
const stockTake: Adapter = {
    key: 'inv.stock_take', module: 'Inventory', label: 'Stock take (PI)',
    collection: (org) => `${root(org)}/stock_take_sessions`, statuses: ['verification', 'pending_post_approval'],
    routes: /^org\.inventory\.stocktake/,
    link: 'module/INV/feature/3', linkLabel: 'Inventory › Stock take',
    ref: (id) => id, title: (id, d) => `Stock take ${id}${str(d.warehouseName) ? ` · ${str(d.warehouseName)}` : ''}`,
    by: lastBy,
    async stage(env, id, d) {
        const wh = str(d.warehouseId);
        const counters = countersOf(d);
        const independent = (p: Person) => !counters.includes(p.uid) && p.uid !== str(d.countEditedBy);
        if (str(d.status) === 'verification') return stage(`verify|${str(d.countedAt)}`, 'Verify and accept the counts', rule(env, async (p) => independent(p) && (await env.at(p, 'INV_ST_020', wh))));
        const { myPositions } = await import('./purchaseOrders');
        const step = pendingStep(o(d.approval).steps);
        const requester = str(d.postingRequestedBy);
        const done = approvedBy(o(d.approval).steps);
        if (step) {
            const code = str(step.positionCode);
            return stage(`level|${str(step.level)}|${str(d.postingRequestedAt)}`, `Approve the variance, level ${str(step.level)} (${str(step.positionTitle)})`, rule(env, async (p) => independent(p) && p.uid !== requester && !done.includes(p.uid) && (code === 'TEST_MODE' ? p.superAdmin : myPositions(p.user).includes(code)) && (await env.at(p, 'INV_ST_027', wh))), { details: [{ label: 'Variance value', value: String(d.varianceValue ?? '') }] });
        }
        return stage(`approve|${str(d.postingRequestedAt)}`, 'Approve posting (independent approval)', rule(env, async (p) => independent(p) && p.uid !== requester && (await env.at(p, 'INV_ST_027', wh))));
    },
};

const forecastProposals: Adapter = {
    key: 'inv.forecast_levels', module: 'Inventory', label: 'Forecast levels proposal',
    collection: (org) => `${root(org)}/material_forecasts`, statuses: ['pending'], statusField: 'proposal.status',
    routes: /^org\.inventory\.(forecast|material)/,
    link: 'material_catalog', linkLabel: 'Inventory › Material forecasting',
    ref: (id) => id, title: (id, d) => `New stock levels for ${str(d.materialNumber) || id.split('_')[0]}`,
    async stage(env, id, d) {
        const { coaCheck } = await import('./forecasting');
        const p0 = o(d.proposal);
        const wh = str(d.warehouseId) || id.split('_').slice(1).join('_');
        const step = pendingStep(p0.steps);
        return stage(`level|${str(step?.level) || 'A'}|${str(p0.requestedAt)}`, step ? `Approve level ${str(step.level)} (${str(step.positionTitle)})` : 'Approve the proposed levels', rule(env, async (p) => p.uid !== str(p0.requestedBy) && (await env.at(p, 'INV.forecast.approve', wh)) && (await coaCheck(p.ctx, p0)).ok));
    },
};

const criticality: Adapter = {
    key: 'inv.criticality', module: 'Inventory', label: 'Criticality assessment',
    collection: (org) => `${root(org)}/criticality_assessments`, statuses: ['submitted', 'returned'],
    routes: /^org\.inventory\.criticality/,
    link: 'material_catalog', linkLabel: 'Inventory › Criticality analysis',
    ref: (id) => id, title: (id, d) => `Criticality of ${str(d.materialNumber) || id.split('_')[0]}`,
    by: lastBy,
    async stage(env, id, d) {
        const wh = str(d.warehouseId);
        const assessor = str(d.submittedBy) || str(d.createdBy);
        if (str(d.status) === 'returned') return stage(`returned|${str(d.updatedAt).slice(0, 16)}`, 'Revise the returned assessment', only(env, assessor));
        return stage(`approve|${str(d.submittedAt)}`, 'Approve or return the assessment', rule(env, async (p) => p.uid !== assessor && (await env.at(p, 'INV.criticality.approve', wh))));
    },
};

// ----- Production planning and manufacturing -----

const plnDemand: Adapter = {
    key: 'pln.demand', module: 'Production Planning', label: 'Demand line',
    collection: (org) => `${root(org)}/pln_demand`, statuses: ['pending_approval'],
    routes: /^org\.pln\.demand/,
    link: 'pln_foundation', linkLabel: 'Production Planning › Demand register',
    ref: (id) => id, title: (id, d) => `Demand ${str(d.skuId)} ${str(d.needDate)} · ${str(d.quantity)}`,
    async stage(env, id, d) {
        return stage(`approve|${str(d.submittedAt)}`, 'Approve or reject the demand line', rule(env, async (p) => p.uid !== str(d.createdBy) && p.uid !== str(d.submittedBy) && (await env.at(p, 'PLN.configure', str(d.siteId)))));
    },
};

const mfgMaster = (kind: 'boms' | 'routings'): Adapter => ({
    key: `mfg.${kind}`, module: 'Manufacturing', label: kind === 'boms' ? 'BOM release' : 'Routing release',
    collection: (org) => `${root(org)}/mfg_${kind}`, statuses: ['pending_approval'],
    routes: /^org\.mfg\./,
    link: 'mfg_foundation', linkLabel: 'Materials, BOMs & routings',
    ref: (id) => id, title: (id, d) => `${kind === 'boms' ? 'BOM' : 'Routing'} ${id}${str(d.name) ? ` · ${str(d.name)}` : ''}`,
    async stage(env, id, d) {
        const perm = kind === 'boms' ? 'MFG.bom.approve' : 'MFG.routing.approve';
        return stage(`approve|${str(d.submittedAt)}`, 'Approve or reject the release', rule(env, async (p) => env.holds(p, perm) && p.uid !== str(d.createdBy) && p.uid !== str(d.submittedBy) && (await env.at(p, perm, str(d.siteId)))));
    },
});

const plnPlans: Adapter = {
    key: 'pln.plan', module: 'Production Planning', label: 'S&OP plan',
    collection: (org) => `${root(org)}/pln_plans`, statuses: ['draft', 'demand_review', 'supply_planning', 'sop_review', 'approved'],
    routes: /^org\.pln\.planning\./,
    link: 'pln_foundation', linkLabel: 'Production Planning › S&OP planning cycle',
    ref: (id) => id, title: (id, d) => `S&OP plan ${id} · ${str(d.siteName)} · ${str(d.fyLabel)}`,
    by: lastBy,
    async stage(env, id, d) {
        const { transitionCheck } = await import('./plnPlanningModel');
        const { myPositions } = await import('./purchaseOrders');
        const site = str(d.siteId);
        const status = str(d.status) as 'draft';
        const coa = o(d.coa);
        const actors = { createdBy: str(d.createdBy), demandSubmittedBy: str(d.demandSubmittedBy), demandApprovedBy: str(d.demandApprovedBy), supplySubmittedBy: str(d.supplySubmittedBy), sopApprovers: approvedBy(coa.steps) };
        const may = (action: Parameters<typeof transitionCheck>[1], perm: string, extra: (p: Person) => boolean = () => true) =>
            rule(env, async (p) => extra(p) && !transitionCheck(status, action, p.uid, actors, { forecastRun: true, supplyRun: true }) && (await env.at(p, perm, site)));
        if (status === 'draft') return str(d.demandReturnReason) ? stage(`returned|${short(str(d.demandReturnReason))}`, 'Revise the returned demand plan', only(env, str(d.createdBy))) : null;
        if (status === 'demand_review') return stage(`demand|${str(d.demandSubmittedAt)}`, 'Review the demand plan (Demand Manager)', may('approve_demand', 'PLN.demand.approve'));
        if (status === 'supply_planning') return stage(`supply|${str(d.demandApprovedAt)}|${short(str(coa.returnReason))}`, 'Run supply planning and submit to S&OP', may('run_supply', 'PLN.supply.plan'));
        if (status === 'sop_review') {
            const step = pendingStep(coa.steps);
            if (!step) return null;
            const code = str(step.positionCode);
            return stage(`level|${str(step.level)}|${str(d.supplySubmittedAt)}`, `Approve S&OP level ${str(step.level)} (${str(step.positionTitle)})`, may('approve_sop', 'PLN.sop.approve', (p) => !code || myPositions(p.user).includes(code)), { details: [{ label: 'Planned purchases', value: String(coa.amount ?? '') }] });
        }
        if (status === 'approved') return stage(`release|${str(d.approvedAt)}`, 'Release the approved plan', may('release', 'PLN.mrp.release'));
        return null;
    },
};

// ----- Maintenance -----

async function routing(env: Env) {
    if (!env.memo.has('mnt.routing')) env.memo.set('mnt.routing', import('./maintenanceResponsibility').then((m) => m.responsibilityData(env.base)));
    return env.memo.get('mnt.routing') as Promise<Awaited<ReturnType<typeof import('./maintenanceResponsibility').responsibilityData>>>;
}
const maintenance = (kind: 'wr' | 'wo'): Adapter => ({
    key: `mnt.${kind}`, module: 'Maintenance', label: kind === 'wr' ? 'Work request' : 'Work order',
    collection: (org) => `${root(org)}/${kind === 'wr' ? 'work_requests' : 'work_orders'}`,
    live: (d) => !(kind === 'wr' ? ['closed', 'cancelled', 'confirmed', 'rejected', 'declined'] : ['closed', 'cancelled']).includes(str(d.status)),
    routes: /^(org\.mnt\.|quick\.gemba)/,
    link: kind === 'wr' ? 'work_requests' : 'work_orders', linkLabel: kind === 'wr' ? 'Maintenance › Work requests' : 'Maintenance › Work orders',
    ref: (id, d) => str(d.code) || id, title: (id, d) => `${kind === 'wr' ? 'Work request' : 'Work order'} ${str(d.code) || id}${str(d.title) || str(d.description) ? ` · ${(str(d.title) || str(d.description)).slice(0, 80)}` : ''}`,
    by: lastBy,
    async stage(env, id, d) {
        const { responsibilityFor } = await import('./maintenanceResponsibility');
        const r = responsibilityFor(await routing(env), { ...d, code: str(d.code) || id }, kind).responsibility;
        if (!r.stage || r.stage === 'Completed' || !r.people.length) return null;
        const label = kind === 'wo' && str(d.workflowLabel) ? `${r.stage} · ${str(d.workflowLabel)}` : r.stage;
        return stage(`${str(d.status)}|${str(d.workflowCode)}|${r.stage}`, label, async () => env.uids(...r.people.map((x: { uid: string }) => x.uid)));
    },
});

// ----- Assets, documents, governance, HR -----

const assets: Adapter = {
    key: 'ast.asset', module: 'Assets', label: 'Asset register change',
    collection: (org) => `${root(org)}/assets`, statuses: ['pending_approval', 'change_pending', 'disposal_pending'],
    routes: /^org\.assets\./,
    link: 'asset_approvals', linkLabel: 'Assets › Awaiting approval',
    ref: (id) => id, title: (id, d) => `${str(d.status) === 'disposal_pending' ? 'Disposal' : str(d.status) === 'change_pending' ? 'Change' : 'New asset'} ${id} · ${str(d.name)}`,
    by: lastBy,
    async stage(env, id, d) {
        const s = str(d.status);
        return stage(`${s}|${str(d.submittedAt)}`, 'Approve or reject', rule(env, async (p) => p.uid !== str(d.submittedBy) && !(s === 'pending_approval' && p.uid === str(d.createdBy)) && (await env.at(p, 'AST.approve', str(d.nodeId)))));
    },
};

const documents: Adapter = {
    key: 'doc.document', module: 'Documents', label: 'Controlled document',
    collection: (org) => `${root(org)}/drkms_documents`, statuses: ['in_review', 'technical_verified'],
    routes: /^drkms\./,
    link: 'doc_review', linkLabel: 'Documents › Review & approvals',
    ref: (id, d) => str(d.documentNumber) || str(d.code) || id, title: (id, d) => `Document ${str(d.documentNumber) || id} · ${str(d.title)}`,
    async stage(env, id, d) {
        const node = str(o(d.scope).nodeId);
        if (str(d.status) === 'in_review') return stage(`review|${str(d.submittedAt)}`, 'Review: verify, return or reject', rule(env, async (p) => p.uid !== str(d.createdBy) && p.uid !== str(d.submittedBy) && (await env.at(p, 'ADM.document_review', node))));
        const slots = await listDocs(`${root(env.orgId)}/drkms_documents/${id}/signature_slots`).catch(() => []);
        const waiting = slots.filter((s) => str(s.data.status) !== 'signed').map((s) => str(s.data.signerUid));
        if (!waiting.length) return null;
        return stage(`sign|${str(d.verifiedAt) || str(d.updatedAt).slice(0, 10)}`, 'Sign off the verified document', only(env, ...waiting), { link: 'doc_my_signatures', linkLabel: 'Documents › My signatures' });
    },
};

const governance: Adapter = {
    key: 'gov.approval', module: 'Governance', label: 'Transaction approval',
    collection: (org) => `${root(org)}/governance_approvals`, statuses: ['pending'],
    routes: /^org\.governance\./,
    link: 'my_workflow', linkLabel: 'My Workflow',
    ref: (id, d) => str(d.code) || id, title: (id, d) => `Approval for ${str(d.handlerName) || str(d.code)}`,
    async stage(env, id, d) {
        const voted = objs(d.votes).map((v) => str(v.uid));
        const eligible = [...new Set(objs(d.steps).flatMap((s) => ids(s.eligibleUserIds)))].filter((u) => !voted.includes(u) && u !== str(d.requestedBy));
        return stage(`pending|${str(d.createdAt)}`, 'Approve or reject the transaction', only(env, ...eligible), { details: [{ label: 'Reason', value: str(d.reason) }] });
    },
};

const hrRules: Adapter = {
    key: 'hr.access_rules', module: 'Human Resources', label: 'HR access rules change',
    collection: (org) => `${root(org)}/hr_access_rules`, live: (d) => !!str(d.proposedBy) && (str(d.status) || 'pending') === 'pending',
    routes: /^org\.hr\.access_rules/,
    link: 'my_workflow', linkLabel: 'Human Resources › Access rules',
    ref: () => 'HR access rules', title: () => 'Proposed HR access rules',
    async stage(env, id, d) {
        if (id !== 'pending') return null;
        return stage(`review|${str(d.proposedAt)}`, 'Review the proposed access rules', rule(env, (p) => p.uid !== str(d.proposedBy) && env.holds(p, 'HRM.rules.approve')));
    },
};

export const ADAPTERS: Adapter[] = [
    requirements, orders, requisitions, vendors, agreements,
    apDoc('fin.ap_invoice', 'ap_invoices', 'Supplier invoice', 'FIN.ap.approve'),
    apDoc('fin.ap_payment', 'ap_payments', 'Supplier payment', 'FIN.ap.payapprove'),
    apDoc('fin.receipt_adjustment', 'receipt_adjustments', 'Receipt adjustment', 'FIN.receipt.approve'),
    finRequests,
    materialFlow('inv.material_creation', 'materials', 'Material creation'),
    materialFlow('inv.material_extension', 'material_extensions', 'Material extension'),
    stockAdjustments, genericRequests, stockTake, forecastProposals, criticality,
    plnDemand, mfgMaster('boms'), mfgMaster('routings'), plnPlans,
    maintenance('wr'), maintenance('wo'),
    assets, documents, governance, hrRules,
];
/** Organization-level lookups used by adapters, exposed for tests. */
export const _internals = { pendingStep, approvedBy, countersOf, getDoc };
