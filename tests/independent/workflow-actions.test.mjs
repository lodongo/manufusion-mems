import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { actionIdOf, chooseRecipients, mailHtml, mailIdOf, outcomeOf, planFor, roomIdOf, taskIdOf, chatOpenText } from '../../backend/workflowActionsCore.ts';
import { ADAPTERS } from '../../backend/workflowAdapters.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('ids are deterministic, so an action is never created or delivered twice', () => {
    assert.equal(taskIdOf('prc.order', 'PO1', 'level|L1|t'), taskIdOf('prc.order', 'PO1', 'level|L1|t'));
    assert.notEqual(taskIdOf('prc.order', 'PO1', 'level|L1|t'), taskIdOf('prc.order', 'PO1', 'level|L2|t'));
    const id = taskIdOf('a', 'b', 'c');
    assert.match(id, /^wf_[0-9a-f]{32}$/);
    assert.match(mailIdOf(id, 'user1'), /^[a-zA-Z0-9_-]{6,100}$/, 'valid mailbox id');
    assert.match(roomIdOf('user1'), /^[a-zA-Z0-9_-]{8,80}$/, 'valid chat room id');
    assert.equal(actionIdOf(id), `wfa_${id.slice(3)}`);
});

test('recipients: people who can act; a super admin only when nobody else can; test mode sends everything to the super admin', () => {
    const eligible = [{ uid: 'b', superAdmin: false }, { uid: 'sa', superAdmin: true }, { uid: 'a', superAdmin: false }, { uid: 'a', superAdmin: false }];
    assert.deepEqual(chooseRecipients(eligible, false, ['sa']).recipients, ['a', 'b']);
    assert.deepEqual(chooseRecipients([{ uid: 'sa', superAdmin: true }], false, ['sa']).recipients, ['sa'], 'never orphaned');
    const t = chooseRecipients(eligible, true, ['sa']);
    assert.deepEqual(t.recipients, ['sa']);
    assert.deepEqual(t.intended, ['a', 'b'], 'the people who would normally act are recorded');
    assert.equal(t.testMode, true);
    assert.deepEqual(chooseRecipients([], false, ['sa']).recipients, []);
});

test('closing: only when the record leaves the step; same step keeps the action; people changes follow outside test mode', () => {
    const open = [{ id: 't1', stageKey: 'level|L1', recipients: ['a'], testMode: false }];
    assert.deepEqual(planFor({ key: 'level|L1', label: '', recipients: ['a'] }, open, true), { close: [], create: false, keep: 't1', add: [], remove: [] }, 'opening or reading changes nothing');
    const moved = planFor({ key: 'level|L2', label: '', recipients: ['c'] }, open, true);
    assert.deepEqual(moved.close, [{ id: 't1', reason: 'completed' }]);
    assert.equal(moved.create, true);
    assert.deepEqual(planFor(null, open, true).close, [{ id: 't1', reason: 'completed' }], 'approved or finished: closed');
    assert.deepEqual(planFor(null, open, false).close, [{ id: 't1', reason: 'withdrawn' }], 'record gone: withdrawn');
    const reassign = planFor({ key: 'level|L1', label: '', recipients: ['b'] }, open, true);
    assert.deepEqual([reassign.add, reassign.remove], [['b'], ['a']]);
    const frozen = planFor({ key: 'level|L1', label: '', recipients: ['b'] }, [{ ...open[0], testMode: true }], true);
    assert.deepEqual([frozen.add, frozen.remove], [[], []], 'test-mode recipients are fixed at creation');
    assert.equal(planFor({ key: 'x', label: '', recipients: [] }, [], true).create, false, 'nobody to act: nothing sent');
    assert.match(outcomeOf('pending_approval', 'approved', true, 'Jane'), /pending approval to approved by Jane/);
});

test('messages tell the person what to do and that reading does not complete it', () => {
    const v = { module: 'Procurement', label: 'Purchase order', ref: 'PO1', title: 'Purchase order PO1 <x>', stageLabel: 'Approve level L1', link: 'procurement_orders', linkLabel: 'Procurement › Purchase orders', createdAt: '', testMode: true, intendedNames: ['Ann'], details: [{ label: 'Value', value: 'KES 10' }] };
    const html = mailHtml(v);
    assert.ok(html.includes('&lt;x&gt;'), 'escaped');
    assert.ok(/Reading them does not complete the action/.test(html));
    assert.ok(/Test mode/.test(html) && /Ann/.test(html));
    assert.ok(/closes automatically/.test(chatOpenText(v)));
});

test('adapters cover every workflow module, each with a link and route trigger', () => {
    const keys = ADAPTERS.map((a) => a.key);
    for (const k of ['prc.requirement', 'prc.order', 'prc.requisition', 'prc.vendor', 'fin.ap_invoice', 'fin.ap_payment', 'fin.receipt_adjustment', 'fin.request', 'inv.material_creation', 'inv.material_extension', 'inv.stock_adjustment', 'wf.request', 'inv.stock_take', 'inv.forecast_levels', 'inv.criticality', 'pln.demand', 'mfg.boms', 'mfg.routings', 'pln.plan', 'mnt.wr', 'mnt.wo', 'ast.asset', 'doc.document', 'gov.approval', 'hr.access_rules']) assert.ok(keys.includes(k), k);
    assert.equal(new Set(keys).size, keys.length);
    for (const a of ADAPTERS) {
        assert.ok(a.link && a.linkLabel, `${a.key} link`);
        assert.ok(a.statuses?.length || a.live, `${a.key} live records`);
    }
    const match = (route) => ADAPTERS.filter((a) => a.routes.test(route)).map((a) => a.key);
    assert.ok(match('org.procurement.orders.approve').includes('prc.order'));
    assert.ok(match('org.procurement.req.approve').includes('prc.requirement'));
    assert.ok(match('org.mnt.wr.review').includes('mnt.wr'));
    assert.ok(match('org.inventory.stocktake.action').includes('inv.stock_take'));
    assert.ok(match('org.pln.planning.plan.sop.decide').includes('pln.plan'));
    assert.ok(match('org.fin.ap.invoices.decide').includes('fin.ap_invoice'));
    assert.ok(!match('org.fin.ap.invoices.decide').includes('fin.request'));
});

// A small fake environment: people with positions and rights at places.
function env(people, rights) {
    const byUid = new Map(people.map((p) => [p.uid, p]));
    return {
        orgId: 'o', people, byUid, memo: new Map(), superAdmins: people.filter((p) => p.superAdmin).map((p) => p.uid), base: {},
        async who(rule) { const out = []; for (const p of people) if (await rule(p)) out.push({ uid: p.uid, superAdmin: p.superAdmin }); return out; },
        holds: (p, perm) => p.superAdmin || (rights[p.uid] ?? []).some((r) => r.startsWith(`${perm}@`)),
        at: async (p, perm, node) => p.superAdmin || (rights[p.uid] ?? []).includes(`${perm}@${node}`),
        positionHolders: () => [],
        uids: (...ids) => ids.filter((u) => byUid.has(u)).map((u) => ({ uid: u, superAdmin: byUid.get(u).superAdmin })),
    };
}
const person = (uid, positions = [], superAdmin = false) => ({ uid, superAdmin, user: { id: uid, data: { assignments: positions.map((p) => ({ positionCode: p, status: 'active' })) } }, ctx: { uid, role: superAdmin ? 'org_super_admin' : 'user', permissions: [] } });
const adapter = (k) => ADAPTERS.find((a) => a.key === k);

test('S&OP plan: each status goes to the right independent people', async () => {
    const people = [person('planner'), person('manager'), person('supply'), person('exec', ['ROL_EXEC']), person('other', ['ROL_X']), person('releaser'), person('sa', [], true)];
    const e = env(people, { manager: ['PLN.demand.approve@S1'], planner: ['PLN.demand.approve@S1'], supply: ['PLN.supply.plan@S1'], exec: ['PLN.sop.approve@S1'], other: ['PLN.sop.approve@S1'], releaser: ['PLN.mrp.release@S1'] });
    const a = adapter('pln.plan');
    const base = { siteId: 'S1', createdBy: 'planner', demandSubmittedBy: 'planner', demandSubmittedAt: 't1' };
    const review = await a.stage(e, 'SOP1', { ...base, status: 'demand_review' });
    assert.deepEqual((await review.eligible()).filter((c) => !c.superAdmin).map((c) => c.uid), ['manager'], 'the planner is excluded although holding the right');
    const sop = await a.stage(e, 'SOP1', { ...base, status: 'sop_review', demandApprovedBy: 'manager', supplySubmittedBy: 'supply', supplySubmittedAt: 't3', coa: { steps: [{ level: 'L1', positionCode: 'ROL_EXEC', positionTitle: 'Executive', status: 'pending' }] } });
    assert.equal(sop.key, 'level|L1|t3');
    assert.deepEqual((await sop.eligible()).filter((c) => !c.superAdmin).map((c) => c.uid), ['exec'], 'job role of the level');
    const returned = await a.stage(e, 'SOP1', { ...base, status: 'draft', demandReturnReason: 'Too high for Q3' });
    assert.deepEqual(await returned.eligible(), [{ uid: 'planner', superAdmin: false }]);
    assert.equal(await a.stage(e, 'SOP1', { ...base, status: 'draft' }), null, 'a draft being prepared is not a handover');
});

test('stock take: counters never verify or approve their own count', async () => {
    const e = env([person('counter'), person('verifier'), person('requester')], { counter: ['INV_ST_020@W1', 'INV_ST_027@W1'], verifier: ['INV_ST_020@W1', 'INV_ST_027@W1'], requester: ['INV_ST_027@W1'] });
    const a = adapter('inv.stock_take');
    const v = await a.stage(e, 'PI_1', { status: 'verification', warehouseId: 'W1', countedBy: 'counter', countedByAll: ['counter'], countedAt: 't' });
    assert.deepEqual((await v.eligible()).map((c) => c.uid), ['verifier']);
    const p = await a.stage(e, 'PI_1', { status: 'pending_post_approval', warehouseId: 'W1', countedBy: 'counter', postingRequestedBy: 'requester', postingRequestedAt: 't2' });
    assert.deepEqual((await p.eligible()).map((c) => c.uid), ['verifier']);
});

test('governance approvals go to the eligible people who have not voted', async () => {
    const e = env([person('r'), person('v1'), person('v2'), person('v3')], {});
    const s = await adapter('gov.approval').stage(e, 'g1', { requestedBy: 'r', createdAt: 't', steps: [{ eligibleUserIds: ['v1', 'v2', 'r'] }, { eligibleUserIds: ['v3'] }], votes: [{ uid: 'v1' }] });
    assert.deepEqual((await s.eligible()).map((c) => c.uid).sort(), ['v2', 'v3']);
});

test('wiring: hook after every change, sweep job, routes, no manual closing, mail stays unread and undeletable while open', () => {
    const guards = read('backend/guards.ts');
    assert.ok(guards.includes("const { syncWorkflowActions } = await import('./workflowActions'); await syncWorkflowActions(fullCtx, name);"));
    const engine = read('backend/workflowActions.ts');
    assert.ok(engine.includes("'POST /api/org/workflow/actions/mine'") && engine.includes("'POST /api/org/workflow/actions/reconcile': [\n        orgRoute('org.workflow.actions.reconcile', 'ADM.workflows'"));
    assert.ok(engine.includes('testModeActiveFor(env.orgId)'), 'test mode decides recipients at creation');
    assert.ok(engine.includes("await auditTask(env, 'created'") && engine.includes("await auditTask(env, 'closed'"), 'audited');
    const auto = read('backend/automationEngine.ts');
    assert.ok(auto.includes("const WF_JOB_ID = 'wf.actions-sweep';") && auto.includes('executeWorkflowSweep(mode, deadline)'));
    const hub = read('backend/actionHub.ts');
    assert.equal(hub.split('refuseManualWorkflowChange(doc.data);').length - 1, 3, 'respond, progress and acknowledge refuse workflow actions');
    const mail = read('backend/mail.ts');
    assert.ok(mail.includes("const mark=ctx.body.markRead!==false&&str(doc.data.workflowStatus)!=='open';"));
    assert.ok(mail.includes("if(kind==='read'&&openWorkflow)continue;"));
    assert.ok(mail.includes('This workflow action stays in your mailbox until its step is completed in MEMS.'));
    const index = read('backend/index.ts');
    assert.ok(index.includes('...workflowActionRoutes,'));
    const ui = read('src/org/WorkflowActionsPanel.tsx');
    assert.ok(ui.includes("id={`wf.actions.${scope}`}"), 'rich table');
    assert.ok(read('src/org/WorkflowInbox.tsx').includes('<WorkflowActionsPanel />'));
    assert.ok(read('src/org/UnifiedActions.tsx').includes("a.source==='workflow'"));
    assert.ok(read('src/org/QuickActions.tsx').includes("picked.monitored.source==='workflow'"));
    assert.ok(read('src/org/OrgMail.tsx').includes('detail.workflow&&'));
});
