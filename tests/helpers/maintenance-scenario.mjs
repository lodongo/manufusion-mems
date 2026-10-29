import assert from 'node:assert/strict';
import { seed, snapshot, listDocs, dump } from './maintenance-fixture.ts';
import { writeFileSync } from 'node:fs';
import { maintenanceOperations } from '../../backend/maintenanceOperations.ts';
import { maintenanceRoutes } from '../../backend/maintenance.ts';
import {maintenanceMaterialCandidateRoutes} from '../../backend/maintenanceMaterialCandidates.ts';
import { procurementRoutes } from '../../backend/procurement.ts';
import { finOpsRoutes } from '../../backend/finOps.ts';
import { physicalOf } from '../../backend/finCore.ts';
import { MAINTENANCE_GATES } from '../../backend/maintenanceWorkflowConfig.ts';
import { PROCUREMENT_UNITS } from '../../backend/procurementUnits.ts';
import { maintenanceSourcingRoutes } from '../../backend/maintenanceSourcing.ts';
import { storesIssueVoucherRoutes } from '../../backend/storesIssueVouchers.ts';
import { maintenancePlanningRoutes } from '../../backend/maintenancePlanning.ts';
import { decideRequest } from '../../backend/finRoutes.ts';

const org = 'maintenance_fixture',
    r = 'organizations/' + org;
const now = new Date().toISOString(),
    date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
seed(r, { status: 'active', modules: { MNT: true, INV: true, PRC: true, FIN: true }, currencyCode: 'KES' });
const nodes = [
    ['LE', 'legal_entity', 'root'],
    ['SITE', 'site', 'LE'],
    ['DEPT', 'department', 'SITE'],
    ['LINE_CC', 'cost_center', 'DEPT'],
    ['WAREHOUSE', 'cost_center', 'DEPT'],
    ['CONVEYOR', 'work_center', 'LINE_CC'],
    ['BEARINGS', 'assembly', 'CONVEYOR'],
    ['SENSORS', 'assembly', 'CONVEYOR'],
    ['GEARBOX', 'assembly', 'CONVEYOR'],
    ['OTHER_LINE', 'work_center', 'LINE_CC'],
    ['OTHER_ASSEMBLY', 'assembly', 'OTHER_LINE'],
];
for (const [id, level, parentId] of nodes)
    seed(r + '/structure/' + id, {
        code: id,
        name: id === 'CONVEYOR' ? 'Production Conveyor' : id,
        level,
        parentId,
        status: 'active',
        attributes: { ...(id === 'WAREHOUSE' ? { costType: 'INV' } : {}), ...(id === 'LE' ? { currencyCode: 'KES' } : {}) },
    });
seed(r + '/warehouses/WAREHOUSE', { name: 'Engineering Stores', materialCategoryCodes: ['MAT'] });
seed(r + '/assets/AST000001', {
    name: 'Production Conveyor',
    status: 'active',
    workCenterId: 'CONVEYOR',
    nodeId: 'CONVEYOR',
    siteId: 'SITE',
});
seed(r + '/assets/AST000002', {
    name: 'Other Line Equipment',
    status: 'active',
    workCenterId: 'OTHER_LINE',
    nodeId: 'OTHER_LINE',
    siteId: 'SITE',
});

seed(r + '/equipment_stored_energy/CONVEYOR', {
    initialized: true,
    items: [
        {
            id: 'electrical',
            energyCode: 'ELECTRIC',
            hazards: [
                {
                    code: 'SHOCK',
                    impacts: [
                        {
                            code: 'INJURY',
                            controls: ['LOTO'],
                            initialRisk: { score: 40, band: 'Moderate' },
                            residualRisk: { score: 2, band: 'Low' },
                        },
                    ],
                },
            ],
            notes: 'Isolate and prove dead',
        },
    ],
});
seed(r + '/equipment_stored_energy/OTHER_LINE', { initialized: true, items: [] });
for (const [key, code, label] of [
    ['hazardousEnergy', 'ELECTRIC', 'Electrical energy'],
    ['hazards', 'SHOCK', 'Electric shock'],
    ['impacts', 'INJURY', 'Personnel injury'],
    ['controlMeasures', 'LOTO', 'Lock, tag and prove zero energy'],
])
    seed('module_workspaces/SAF/metadata/' + key, { items: [{ code, label, active: true }] });
seed(r + '/activity_risk_assessments/UNSELECTED_HISTORY', { hazards: [{ code: 'HISTORICAL_UNSELECTED_HAZARD' }] });
const roles = {
    // Assessment entry stays open; independent approval is controlled by a configured role.
    'MNT.ASSESS.REVIEW': 'ASSESS_REVIEW',
    'MNT.WR.CONVERT': 'CONVERT',
    'MNT.TASK.VALIDATE': 'VALIDATE',
    'MNT.WO.PLAN': 'PLAN',
    'MNT.TASK.FEEDBACK': 'EXEC',
    'MNT.SPARES.RECONCILE': 'STORES',
    'MNT.SAFETY.SIGNOFF': 'SAFETY',
    'MNT.HANDOVER': 'OPS',
    'MNT.WO.TECHNICAL_CLOSE': 'TM',
};
seed(r + '/maintenance_workflow_settings/default', { version: 1, approverRoles: roles });
for (const role of new Set(Object.values(roles)))
    seed(r + '/positions/' + role, { code: role, title: role, parentCode: role === 'PLAN' ? 'TM' : '', operatingLevel: 'site' });
const people = {
    requester: ['REQUESTER_01', []],
    assessor: ['ASSESSOR_01', ['ASSESS', 'CONVERT']],
    validator: ['VALIDATOR_01', ['VALIDATE']],
    reviewer: ['REVIEWER_01', ['ASSESS_REVIEW']],
    planner: ['PLANNER_01', ['PLAN']],
    engineer: ['ENGINEER_01', ['ENG']],
    safety: ['SAFETY_01', ['SAFETY']],
    safety2: ['SAFETY_02', ['SAFETY']],
    tech: ['TECHNICIAN_01', ['EXEC']],
    stores: ['STORES_01', ['STORES']],
    ops: ['OPERATIONS_01', ['OPS']],
    manager: ['MANAGER_01', ['TM']],
};
for (const [key, [uid, rs]] of Object.entries(people))
    seed('users/' + uid, {
        orgId: org,
        status: 'active',
        firstName: key,
        lastName: 'Fixture',
        email: key + '@example.test',
        assignments: rs.map((positionCode) => ({ positionCode, nodeId: 'SITE', type: 'primary', startsOn: '2020-01-01', endsOn: '' })),
    });
const context = (who, body = {}) => {
    const uid = people[who][0];
    return {
        uid,
        orgId: org,
        role: 'org_super_admin',
        org: snapshot(r),
        me: snapshot('users/' + uid),
        permissions: ['MNT.*', 'INV.*', 'PRC.*', 'ADM.*'],
        directPermissions: ['MNT.*', 'INV.*', 'PRC.*', 'ADM.*'],
        grants: [],
        actor: { uid, email: who + '@example.test', role: 'org_super_admin', orgId: org },
        meta: { ip: 'test', userAgent: 'maintenance fixture' },
        body,
        query: {},
        claims: { email: who + '@example.test' },
    };
};
const op = (who, action, body = {}) => maintenanceOperations(context(who, { action, ...body }));
const route = (routes, path, who, body) => {
    const handler = routes['POST ' + path]?.[0];
    assert.ok(handler, 'Missing handler ' + path);
    return handler(context(who, body));
};
function catalogue(kind, items) {
    const base = 'module_workspaces/' + (kind === 'gl_accounts' ? 'FIN' : 'PRC') + '/catalogs/' + kind;
    const sections = {
        categories: [{ code: kind === 'gl_accounts' ? 'GL' : 'MAT', name: 'Engineering' }],
        subcategories: [
            {
                code: kind === 'gl_accounts' ? 'EXP' : 'SPARES',
                name: 'Maintenance',
                categoryCode: kind === 'gl_accounts' ? 'GL' : 'MAT',
                classCode: 'GL',
            },
        ],
        families: [
            {
                code: kind === 'gl_accounts' ? 'MNT' : 'COMP',
                name: 'Technical',
                subcategoryCode: kind === 'gl_accounts' ? 'EXP' : 'SPARES',
                categoryCode: 'EXP',
            },
        ],
        items,
        attributes: [],
        attributeDomains: [],
        profiles: [],
    };
    seed(base, {
        status: 'active',
        loadedAt: now,
        sha256: kind,
        version: 'fixture-1',
        sections: Object.fromEntries(Object.keys(sections).map((k) => [k, 1])),
    });
    for (const [key, rows] of Object.entries(sections)) seed(base + '/parts/' + key + '_0', { json: JSON.stringify(rows) });
}
catalogue('materials', [
    {
        code: 'BEARING-CAT',
        name: 'Drive Bearing',
        categoryCode: 'MAT',
        subcategoryCode: 'SPARES',
        familyCode: 'COMP',
        attributes: [],
        requiredAttributes: [],
    },
    {
        code: 'SPECIAL-CAT',
        name: 'Special coupling',
        categoryCode: 'MAT',
        subcategoryCode: 'SPARES',
        familyCode: 'COMP',
        attributes: [],
        requiredAttributes: [],
    },
    {
        code: 'OIL-CAT',
        name: 'Gearbox Oil',
        categoryCode: 'MAT',
        subcategoryCode: 'SPARES',
        familyCode: 'COMP',
        attributes: [],
        requiredAttributes: [],
    },
]);
catalogue('services', [
    {
        code: 'GEARBOX-SVC',
        name: 'Gearbox specialist service',
        categoryCode: 'MAT',
        subcategoryCode: 'SPARES',
        familyCode: 'COMP',
        attributes: [],
        requiredAttributes: [],
    },
]);
catalogue('gl_accounts', [
    {
        code: '610000',
        name: 'Maintenance expense',
        classCode: 'GL',
        categoryCode: 'EXP',
        groupCode: 'MNT',
        accountType: 'expense',
        accountRole: 'MAINTENANCE',
        postingMode: 'manual',
    },
]);
for (const kind of ['material', 'service'])
    seed(r + '/procurement_setup/' + kind, {
        categories: [{ code: 'MAT', name: 'Engineering', subcategories: [{ code: 'SPARES', name: 'Maintenance' }] }],
    });
seed(r + '/fin_accounts/LE__610000', {
    leId: 'LE',
    code: '610000',
    name: 'Maintenance expense',
    statement: 'PL',
    status: 'active',
    postable: true,
});
seed(r + '/fin_entities/LE', { status: 'not_live', functionalCurrency: 'KES' });
seed(r + '/procurement_policy/default', { directToCostCenters: true });
const unit =
    PROCUREMENT_UNITS.find((u) => u.selectable && u.active && ['ea', 'pc', 'pcs'].includes(u.symbol.toLowerCase())) ||
    PROCUREMENT_UNITS.find((u) => u.selectable && u.active);
seed('module_workspaces/PRC/metadata/unitsOfMeasure', { items: [{ code: unit.code, active: true }] });
seed('module_workspaces/INV/metadata/materialClassifications', { items: [{ code: 'SPARE', active: true }] });
seed(r + '/workflow_registry/PRC-001', { enabled: true, steps: [{ mode: 'role', role: 'TM' }] });
for (const [id, number, name, qty] of [
    ['BEARING', 'MAT000001', 'Drive bearing', 10],
    ['SENSOR', 'MAT000002', 'Proximity sensor', 2],
    ['OIL', 'MAT000003', 'Gearbox oil', 5],
]) {
    seed(r + '/materials/' + id, {
        materialNumber: number,
        name,
        shortText: name,
        status: 'active',
        categoryCode: 'MAT',
        subcategoryCode: 'SPARES',
        familyCode: 'COMP',
        warehouseIds: ['WAREHOUSE'],
        uom: unit.code,
        baseUom: unit.symbol,
        materialCode: id === 'BEARING' ? 'BEARING-CAT' : id === 'OIL' ? 'OIL-CAT' : '',
    });
    seed(r + '/material_journal/OPEN_' + id, {
        materialId: id,
        warehouseId: 'WAREHOUSE',
        status: 'posted',
        reconciled: true,
        balancesDelta: { physicalStock: qty },
        postedAt: now,
    });
}
seed(r + '/vendors/VND000001', {
    status: 'approved', legalName: 'Gearbox Services Ltd', classCode: 'VCL-007', classLabel: 'Service contractor', brands: [],
    scopes: [{ kind: 'service', categoryCode: 'MAT', subcategoryCode: 'SPARES' }],
});
const setup = await route(maintenanceRoutes, '/api/org/mnt/setup', 'requester', {}),
    l = setup.lists;
const first = (groups) => groups.flatMap((g) => g.items)[0].code;
const finding = {
    confirm: true,
    assemblyId: 'BEARINGS',
    assetTag: 'AST000001',
    title: 'Service production conveyor',
    description: 'Conveyor bearings, sensors and gearbox require servicing.',
    sourceCode: first(l.sources),
    criticalityCode: l.criticality.at(-1).code,
    impactCodes: [first(l.impacts)],
};
const linkedPlace=await route(maintenanceRoutes,'/api/org/mnt/assembly','requester',{assemblyId:'BEARINGS',purpose:'wr'});
assert.equal(linkedPlace.defaultAssetTag,'AST000001');
assert.deepEqual(linkedPlace.assets.map(a=>a.tag),['AST000001'],'Do not offer other nearby assets');
await assert.rejects(
    ()=>route(maintenanceRoutes,'/api/org/mnt/wr/create','requester',{...finding,assetTag:'AST000002'}),
    /differs from the equipment link/,
);
const wr = await route(maintenanceRoutes, '/api/org/mnt/wr/create', 'requester', finding);
await route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: wr.code, action: 'start_review' });
const header = {
    technicalEvaluation: 'Bearings run hot, two sensors are damaged and the gearbox leaks: all verified on site.',
    natureCode: first(l.failureModes),
    severityCode: l.criticality[0].code,
    solutionCodes: [first(l.solutions)],
    maintenanceTypeCode: l.maintenanceTypes[0].code,
};
await route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: wr.code, action: 'assess', ...header });
const risk = [
    {
        hazard: 'Stored energy',
        impact: 'Personnel injury',
        controls: 'Isolate supply, lock and prove zero energy before starting.',
        beforeRatings: { P: 2, S: 2, E: 2, A: 1 },
        afterRatings: { P: 1, S: 2, E: 1, A: 1 },
        permit: 'LOTO',
        responsiblePerson: 'Task technician',
    },
];
const task = (id, title, assemblyId, spares = [], services = []) => ({
    id,
    title,
    description: title,
    instructions: 'Follow OEM maintenance and torque instructions.',
    skills: 'Qualified mechanical / electrical technician',
    completionCriteria: 'Operational testing meets OEM acceptance requirements.',
    equipmentId: 'CONVEYOR',
    assemblyId,
    persons: 1,
    hours: 1,
    rate: 100,
    tools: 'Maintenance toolkit',
    spares,
    services,
    risk,
    dependencies: [],
    templateStatus: 'pending_validation',
});
const spare = (id, materialId, qty) => ({
    id,
    source: 'warehouse',
    description: materialId,
    materialId,
    warehouseId: 'WAREHOUSE',
    qty,
    uom: unit.code,
    unitCost: null,
});
const tasks = [
    task('bearings', 'Replace drive bearings', 'BEARINGS', [spare('bearing', 'BEARING', 2)]),
    task('sensors', 'Replace damaged sensors', 'SENSORS', [spare('sensor', 'SENSOR', 4)]),
    task(
        'gearbox',
        'Service gearbox',
        'GEARBOX',
        [spare('oil', 'OIL', 1)],
        [
            {
                id: 'rewind',
                description: 'Specialist gearbox service',
                categoryCode: 'MAT',
                subcategoryCode: 'SPARES',
                classCode: 'COMP',
                catalogCode: 'GEARBOX-SVC',
                attributes: {},
                proposedVendorIds: [],
                supplierCategory: 'VCL-007',
                executionDate: date,
                scope: 'Inspect gearbox, verify backlash and service seals.',
                deliverables: 'Inspection report and operational test results',
                qualifications: 'OEM certified gearbox technician',
                acceptanceCriteria: 'No leakage and vibration within OEM limits',
                quantity: 1,
            },
        ],
    ),
];
tasks[1].dependencies = ['bearings'];
tasks[2].dependencies = ['sensors'];
await route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: wr.code, action: 'save_task_assessment', tasks });
assert.equal((await listDocs(r + '/asset_task_templates')).length, 0, 'New tasks must not auto-approve');
await assert.rejects(
    () => route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', {code:wr.code,action:'convert',confirm:wr.code}),
    /convert|approval/,
);
await assert.rejects(
    () => route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', {code:wr.code,action:'review_assessment',note:'Attempt to self approve completed task assessment'}),
    /cannot approve|configured MNT\.ASSESS\.REVIEW organizational job role .*is required/,
);
await route(maintenanceRoutes, '/api/org/mnt/wr/action', 'reviewer', {
    code: wr.code, action: 'review_assessment', note: 'Independent check confirms all tasks, scope, risks and required resources.',
});
assert.equal(snapshot(r + '/work_requests/' + wr.code).data.assessmentReview.status, 'approved');
await assert.rejects(
    () => route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: wr.code, action: 'convert', confirm: wr.code }),
    /scheduled start date/,
    'The planner must set the scheduled dates',
);
const wo = (await route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: wr.code, action: 'convert', confirm: wr.code, scheduledStart: date, scheduledEnd: date }))
    .woCode;
assert.equal(snapshot(r + '/work_orders/' + wo).data.scheduledStart, date);
assert.ok(wo);
assert.equal(snapshot(r + '/work_orders/' + wo).data.assessmentTasks[1].spares[0].qty, 4);
await assert.rejects(() => op('planner', 'technical_close', { code: wo, note: 'Attempt premature closure' }), /configured|task|handover/i);
await assert.rejects(
    () => route(maintenanceRoutes, '/api/org/mnt/wo/action', 'manager', { code: wo, action: 'close', confirm: wo }),
    /task|Safety|handover|cannot close/i,
);
for (const t of tasks)
    await op('planner', 'allocate', {
        code: wo,
        taskId: t.id,
        personnel: [people.tech[0]],
        toolsReady: true,
        competenciesConfirmed: true,
        note: 'Qualified assigned technician; all tools checked available.',
    });
for (const t of tasks) await op('planner', 'reserve', { code: wo, taskId: t.id, resourceId: t.spares[0].id });
await op('planner', 'reserve', { code: wo, taskId: 'bearings', resourceId: 'bearing' });
assert.equal((await physicalOf(org, 'WAREHOUSE', 'BEARING')).available, 8, 'Repeated reservation must not double allocate');
assert.equal((await physicalOf(org, 'WAREHOUSE', 'SENSOR')).available, 0);
const req = await op('planner', 'procure', { code: wo, taskId: 'sensors', resourceId: 'sensor', dateRequired: date, glCode: '610000' });
assert.equal(snapshot(r + '/procurement_requirements/' + req.requirementId).data.status, 'pending_approval');
assert.equal(snapshot(r + '/procurement_requirements/' + req.requirementId).data.lines[0].quantity, 2);
// The existing procurement process supplies the shortage; posted receipt is read from the same stock journal.
seed(r + '/material_journal/RECEIPT_SENSOR', {
    materialId: 'SENSOR',
    warehouseId: 'WAREHOUSE',
    status: 'posted',
    reconciled: true,
    balancesDelta: { physicalStock: 2 },
    postedAt: now,
});
await op('planner', 'reserve', { code: wo, taskId: 'sensors', resourceId: 'sensor' });
await assert.rejects(
    () => op('planner', 'procure', { code: wo, taskId: 'gearbox', resourceId: 'rewind', dateRequired: date, glCode: '610000' }),
    /supplier category/,
    'A service requirement needs confirmed supplier sourcing',
);
await op('planner', 'service_sourcing', { code: wo, taskId: 'gearbox', resourceId: 'rewind', supplierCategory: 'VCL-007', preferredVendorId: 'VND000001' });
const svc = await op('planner', 'procure', { code: wo, taskId: 'gearbox', resourceId: 'rewind', dateRequired: date, glCode: '610000' });
seed(r + '/procurement_orders/PO00000001-V1', {
    number: 'PO00000001-V1',
    status: 'open',
    vendorId: 'VENDOR',
    lines: [{ no: 10, type: 'service', requirementId: svc.requirementId, total: 1000 }],
});
await op('planner', 'secure_service', {
    code: wo,
    taskId: 'gearbox',
    resourceId: 'rewind',
    poId: 'PO00000001-V1',
    lineNo: 10,
    readyAt: date,
    note: 'Assessed service scope secured without technical changes.',
});
await assert.rejects(
    () => route(maintenanceRoutes, '/api/org/mnt/wo/action', 'planner', { code: wo, action: 'release', confirm: wo }),
    /readiness checklist/,
    'Release by a second person is replaced by readiness confirmation and Chart of Authority cost approval',
);
await assert.rejects(() => op('planner', 'save_window', { equipmentId: 'CONVEYOR', date, startTime: '08:00', durationHours: 8, workOrderIds: [wo] }), /confirm readiness/);
await assert.rejects(() => op('planner', 'confirm_readiness', { code: wo }), /Not ready yet/);
await op('planner', 'lock_schedule', { code: wo, scheduledStart: date, scheduledEnd: date });
await assert.rejects(() => op('planner', 'review_risk', { code: wo, note: 'short' }), /Risk review notes/);
await op('planner', 'review_risk', { code: wo, note: 'Assessment hazards, LOTO and permits reviewed for every task.' });
await assert.rejects(() => op('planner', 'submit_cost', { code: wo, reason: 'Estimated cost for planned conveyor work.' }), /allowance/);
await assert.rejects(
    () => op('planner', 'submit_cost', { code: wo, allowance: 1000, reason: 'Estimated cost for planned conveyor work.' }),
    /No maintenance budget/,
);
const costReq = await op('planner', 'submit_cost', {
    code: wo, allowance: 1000, reason: 'Estimated cost for planned conveyor work.',
    justification: 'Production-critical conveyor work; the period budget is being set by finance.',
});
assert.match(costReq.requestId, /^FCR\d{8}$/);
await assert.rejects(() => op('planner', 'confirm_readiness', { code: wo }), /cost approved/i);
await assert.rejects(
    () => route(maintenancePlanningRoutes, '/api/org/mnt/cost/decide', 'planner', { id: costReq.requestId, decision: 'approve', acknowledge: true }),
    /submitted this request|planned this work order/,
    'The planner never approves their own estimate',
);
await route(maintenancePlanningRoutes, '/api/org/mnt/cost/decide', 'manager', { id: costReq.requestId, decision: 'approve', acknowledge: true, reason: 'Within the plan.' });
assert.equal(snapshot(r + '/work_orders/' + wo).data.costApproval.status, 'approved');
await op('planner', 'confirm_readiness', { code: wo });
assert.equal(snapshot(r + '/work_orders/' + wo).data.status, 'released');
await assert.rejects(() => op('planner', 'save_window', { equipmentId: 'OTHER_LINE', date, startTime: '08:00', durationHours: 8, workOrderIds: [wo] }), /other equipment/);
await assert.rejects(() => op('planner', 'save_window', { equipmentId: 'CONVEYOR', date, startTime: '08:00', durationHours: 1, workOrderIds: [wo] }), /needs 3 h/);
const windowBody = { title: 'Conveyor planned maintenance', equipmentId: 'CONVEYOR', date, startTime: '08:00', durationHours: 8, timeZone: 'UTC', workOrderIds: [wo] };
const win = await op('planner', 'save_window', windowBody),
    windowId = win.windowId;
assert.equal(snapshot(r + '/maintenance_windows/' + windowId).data.status, 'scheduled');
assert.equal(snapshot(r + '/maintenance_windows/' + windowId).data.end, date + 'T16:00:00.000Z');
assert.equal(snapshot(r + '/work_orders/' + wo).data.status, 'scheduled');
await assert.rejects(() => op('engineer', 'approve_engineering', { windowId, note: 'Old approval path.' }), /no longer need/);
await assert.rejects(() => op('planner', 'save_window', { ...windowBody, windowId, durationHours: 9 }), /reason/);
await op('planner', 'save_window', { ...windowBody, windowId, reason: 'Extend the window by one hour after production review.', durationHours: 9 });
assert.equal(snapshot(r + '/maintenance_windows/' + windowId).data.end, date + 'T17:00:00.000Z');
await assert.rejects(() => op('tech', 'start_task', { code: wo, taskId: 'bearings' }), /prerequisites/);
for (const step of snapshot(r + '/maintenance_windows/' + windowId).data.safetySteps)
    await op('safety', 'safety_prerequisite', {
        windowId,
        stepId: step.id,
        note: 'Isolation verified, locks fitted, test for zero energy complete.',
    });
await assert.rejects(() => op('tech', 'start_task', { code: wo, taskId: 'sensors' }), /predecessor/);
const report = await op('planner', 'window_report', { windowId });
if (process.env.MEMS_UI_SNAPSHOT) writeFileSync(process.env.MEMS_UI_SNAPSHOT, JSON.stringify(dump()));
assert.equal(report.workOrders[0].tasks.length, 3);
assert.ok(!JSON.stringify(report).includes('HISTORICAL_UNSELECTED_HAZARD'));
for (const [index, t] of tasks.entries()) {
    await op('tech', 'start_task', { code: wo, taskId: t.id });
    if (index === 0)
        await assert.rejects(
            () =>
                op('planner', 'map_line', {
                    equipmentId: 'CONVEYOR',
                    lineId: 'LINE_CC',
                    note: 'Attempt to change a line association during execution.',
                }),
            /Complete active maintenance/,
        );
    const s = t.spares[0];
    let issue;
    if (index === 0) {
        // Stores Issue Voucher: the planner raises it from the task reservation, stores issues against it.
        const before = await route(storesIssueVoucherRoutes, '/api/org/mnt/siv/for-wo', 'planner', { code: wo });
        assert.equal(before.canRaise, true);
        const line = before.available.find((l) => l.taskId === t.id && l.materialId === s.materialId);
        assert.ok(line, 'reserved line is offered on a stores issue voucher');
        await assert.rejects(
            () => route(storesIssueVoucherRoutes, '/api/org/mnt/siv/create', 'planner', { code: wo, requiredDate: date, receivedBy: people.tech[0], lines: [{ reservationId: line.reservationId, qty: line.qty + 1 }], confirm: true }),
            /request between/,
        );
        const made = await route(storesIssueVoucherRoutes, '/api/org/mnt/siv/create', 'planner', {
            code: wo, requiredDate: date, receivedBy: people.tech[0], note: 'Bearing task spares', confirm: true,
            lines: [{ reservationId: line.reservationId, qty: line.qty }],
        });
        assert.equal(made.ids.length, 1);
        assert.match(made.ids[0], /^SIV\d{8}$/);
        const offered = await route(storesIssueVoucherRoutes, '/api/org/mnt/siv/for-wo', 'planner', { code: wo });
        assert.ok(!offered.available.some((l) => l.reservationId === line.reservationId), 'a line on an open voucher is not offered again');
        const queue = await route(storesIssueVoucherRoutes, '/api/org/mnt/siv/list', 'stores', { view: 'open' });
        assert.ok(queue.rows.some((v) => v.id === made.ids[0] && v.canIssue));
        const voucher = await route(storesIssueVoucherRoutes, '/api/org/mnt/siv/get', 'stores', { id: made.ids[0] });
        assert.equal(voucher.can.issue, true);
        // Maker-checker: the person collecting cannot issue to themselves.
        await assert.rejects(
            () => route(storesIssueVoucherRoutes, '/api/org/mnt/siv/issue', 'tech', { id: voucher.id, expectedVersion: voucher.version, acknowledge: true, lines: [{ no: voucher.lines[0].no, qty: voucher.lines[0].qty }] }),
            /cannot be you/i,
        );
        await assert.rejects(
            () => route(storesIssueVoucherRoutes, '/api/org/mnt/siv/issue', 'stores', { id: voucher.id, expectedVersion: voucher.version, acknowledge: true, lines: [{ no: voucher.lines[0].no, qty: voucher.lines[0].qty + 1 }] }),
            /still to be issued/,
        );
        const issued = await route(storesIssueVoucherRoutes, '/api/org/mnt/siv/issue', 'stores', {
            id: voucher.id, expectedVersion: voucher.version, acknowledge: true, lines: [{ no: voucher.lines[0].no, qty: voucher.lines[0].qty }],
        });
        assert.equal(issued.status, 'issued');
        assert.match(issued.goodsIssues[0], /^GI\d{8}$/);
        await assert.rejects(
            () => route(storesIssueVoucherRoutes, '/api/org/mnt/siv/issue', 'stores', { id: voucher.id, expectedVersion: voucher.version, acknowledge: true, lines: [{ no: voucher.lines[0].no, qty: 1 }] }),
            /changed/,
        );
        issue = { id: issued.goodsIssues[0] };
        const gi = snapshot(r + '/goods_issues/' + issue.id);
        assert.equal(gi.data.ref, voucher.id + '-1');
        assert.equal(gi.data.receivedBy, people.tech[0]);
    } else {
        issue = await route(finOpsRoutes, '/api/org/inv/issue/post', 'stores', {
            warehouseId: 'WAREHOUSE',
            workOrderId: wo,
            taskId: t.id,
            receivedBy: people.tech[0],
            ref: 'TASK_ISSUE_' + t.id,
            lines: [{ materialId: s.materialId, qty: s.qty }],
            acknowledge: true,
        });
        const again = await route(finOpsRoutes, '/api/org/inv/issue/post', 'stores', {
            warehouseId: 'WAREHOUSE',
            workOrderId: wo,
            taskId: t.id,
            receivedBy: people.tech[0],
            ref: 'TASK_ISSUE_' + t.id,
            lines: [{ materialId: s.materialId, qty: s.qty }],
            acknowledge: true,
        });
        assert.equal(again.id, issue.id);
    }
    const additional =
        t.id === 'gearbox'
            ? await route(finOpsRoutes, '/api/org/inv/issue/post', 'stores', {
                  warehouseId: 'WAREHOUSE',
                  workOrderId: wo,
                  taskId: t.id,
                  receivedBy: people.tech[0],
                  ref: 'ADDITIONAL_GEARBOX_OIL',
                  lines: [{ materialId: 'OIL', qty: 0.5 }],
                  acknowledge: true,
              })
            : null;
    const feedback = {
        workPerformed: 'Completed assessed maintenance work.',
        findings: 'Components inspected and defects corrected.',
        results: 'Operational verification passed.',
        remarks: 'Ready for safety and operations review.',
        outstandingDefects: 'None',
        followUp: 'None',
        actualHours: 1,
        services: [],
    };
    if (t.services.length) {
        await assert.rejects(() => op('tech', 'complete_task', { code: wo, taskId: t.id, feedback }), /service/i);
        feedback.services = [
            {
                id: 'rewind',
                provider: 'Approved service provider',
                scopeDelivered: 'Gearbox inspection, backlash check and seal service complete.',
                results: 'All OEM measurements within specification.',
                acceptance: 'Service inspected and accepted with no leakage.',
                completedAt: date + 'T11:00',
                accepted: true,
                outstandingIssues: 'None',
            },
        ];
    }
    await op('tech', 'complete_task', { code: wo, taskId: t.id, feedback });
    const actual = t.id === 'sensors' ? 3 : s.qty,
        returned = s.qty - actual;
    await op('tech', 'confirm_consumption', {
        code: wo,
        taskId: t.id,
        consumption: [
            {
                issueLineId: issue.id + '_1',
                spareId: s.id,
                consumed: actual,
                returned,
                installed: t.id !== 'gearbox',
                remarks: 'Actual task consumption counted and confirmed.',
            },
            ...(additional
                ? [
                      {
                          issueLineId: additional.id + '_1',
                          spareId: '',
                          consumed: 0.5,
                          returned: 0,
                          installed: false,
                          remarks: 'Additional gearbox oil recorded as actual consumable use.',
                      },
                  ]
                : []),
        ],
        dispositions: [],
    });
    await op('stores', 'reconcile_task', { code: wo, taskId: t.id });
    await op('stores', 'reconcile_task', { code: wo, taskId: t.id });
}
assert.equal((await physicalOf(org, 'WAREHOUSE', 'SENSOR')).physical, 1, 'Only three sensors consumed; one returned');
const boms = await listDocs(r + '/boms');
assert.equal(boms.length, 2);
assert.ok(boms.find((b) => b.data.assemblyId === 'SENSORS').data.lines.some((l) => l.materialId === 'SENSOR' && l.quantity === 3));
assert.ok(!boms.some((b) => b.data.assemblyId === 'GEARBOX'));
await assert.rejects(
    () =>
        op('ops', 'handover', {
            code: wo,
            accepted: true,
            ready: true,
            receivingParty: people.ops[0],
            functionalChecks: 'All checks passed',
            condition: 'Good condition',
            restrictions: 'None',
        }),
    /Safety sign-off/,
);
await assert.rejects(() => op('safety', 'safety_signoff', { code: wo, note: 'Safety verification completed' }), /explicit/);
const beforeNoIncident = snapshot(r + '/work_orders/' + wo);
await op('safety', 'safety_signoff', {
    code: wo,
    declaration: 'none',
    noIncidentsConfirmed: true,
    note: 'All reconciled tasks reviewed; explicitly no incidents or near misses.',
});
assert.equal(snapshot(r + '/work_orders/' + wo).data.safetySignoff.noIncidentsConfirmed, true);
// Restore this fixture checkpoint to exercise the alternative reported-incident branch.
seed(r + '/work_orders/' + wo, beforeNoIncident.data);
const incident = await op('safety', 'report_incident', {
    code: wo,
    classification: 'Near miss',
    narrative: 'A tool was dropped inside the controlled work zone; nobody injured.',
    occurredAt: now,
    immediateControls: 'Stopped work, contained area and secured all tools.',
    followUp: 'Review tool tethering controls before release.',
});
await assert.rejects(
    () =>
        op('safety', 'clear_incident', {
            code: wo,
            incidentId: incident.incidentId,
            note: 'Containment verified and safety clearance granted.',
        }),
    /independent/,
);
await op('safety2', 'clear_incident', {
    code: wo,
    incidentId: incident.incidentId,
    note: 'Containment verified and safety clearance granted.',
});
await op('safety2', 'safety_signoff', {
    code: wo,
    declaration: 'reported',
    incidentId: incident.incidentId,
    classification: 'Near miss',
    narrative: 'Tool dropped; no injury, controlled and cleared.',
    occurredAt: now,
    immediateControls: 'Area contained and tools tethered.',
    clearanceConfirmed: true,
    note: 'All task results, returns and incident controls reviewed.',
});
await op('ops', 'handover', {
    code: wo,
    accepted: true,
    ready: true,
    receivingParty: people.ops[0],
    functionalChecks: 'Conveyor operated under load; no abnormal vibration or leakage.',
    condition: 'Equipment is operational and safe.',
    restrictions: 'None',
});
await assert.rejects(() => op('planner', 'technical_close', { code: wo, note: 'Attempt unauthorized closure.' }), /configured/);
await op('manager', 'technical_close', { code: wo, note: 'All tasks, material reconciliation, BOM, safety and handover reviewed.' });
assert.equal(snapshot(r + '/work_orders/' + wo).data.status, 'closed');
assert.equal(snapshot(r + '/work_orders/' + wo).data.technicalClosure.by, people.manager[0]);
assert.ok(snapshot(r + '/work_orders/' + wo).data.history.length > 15);
// Direct creation is forbidden; every additional work order must be converted
// from a reviewed Work Request. Exercise that API boundary explicitly.
await assert.rejects(
    () => route(maintenanceRoutes,'/api/org/mnt/wo/create','planner',{
        confirm:true,assemblyId:'BEARINGS',assetTag:'AST000001',
        title:'Unsupported direct work order',description:'Direct creation must be rejected.'
    }),
    /Direct work order creation is disabled/,
);
async function createAssessedWorkOrder(title,description,assemblyId,assessedTasks,prepare){
    const wrNew=await route(maintenanceRoutes,'/api/org/mnt/wr/create','requester',{
        ...finding,title,description,assemblyId,assetTag:assemblyId==='OTHER_ASSEMBLY'?'AST000002':'AST000001'
    });
    await route(maintenanceRoutes,'/api/org/mnt/wr/action','assessor',{code:wrNew.code,action:'start_review'});
    await route(maintenanceRoutes,'/api/org/mnt/wr/action','assessor',{code:wrNew.code,action:'assess',...header});
    if(prepare)await prepare(wrNew.code);
    await route(maintenanceRoutes,'/api/org/mnt/wr/action','assessor',{code:wrNew.code,action:'save_task_assessment',tasks:assessedTasks});
    await assert.rejects(
        () => route(maintenanceRoutes,'/api/org/mnt/wr/action','assessor',{code:wrNew.code,action:'convert',confirm:wrNew.code}),
        /approval|convert/,
    );
    await route(maintenanceRoutes,'/api/org/mnt/wr/action','reviewer',{
        code:wrNew.code,action:'review_assessment',note:'Independent technical review verified scope, controls and resources.'
    });
    const result=await route(maintenanceRoutes,'/api/org/mnt/wr/action','assessor',{code:wrNew.code,action:'convert',confirm:wrNew.code,scheduledStart:date,scheduledEnd:date});
    assert.ok(result.woCode);
    return result.woCode;
}
async function makeReady(code, approver = 'manager') {
    await op('planner', 'lock_schedule', { code, scheduledStart: date, scheduledEnd: date });
    await op('planner', 'review_risk', { code, note: 'Assessment hazards and controls reviewed for every task.' });
    const c = await op('planner', 'submit_cost', { code, allowance: 100, reason: 'Estimated cost of the planned work.', justification: 'Needed now; the period budget is being set by finance.' });
    await route(maintenancePlanningRoutes, '/api/org/mnt/cost/decide', approver, { id: c.requestId, decision: 'approve', acknowledge: true });
    await op('planner', 'confirm_readiness', { code });
}
const candidateTask = task('coupling', 'Replace coupling', 'GEARBOX', [
    {
        id: 'coupling_part',
        source: 'catalog',
        catalogCode: 'SPECIAL-CAT',
        description: 'Special coupling with approved specifications',
        qty: 1,
        uom: unit.code,
        attributes: {},
    },
    { id: 'bracket_part', source: 'description', description: 'Drive bearing to approved equipment specification', qty: 1, uom: unit.code },
]);
const hiddenTask = task('hidden_task', 'Unselected historical-style task', 'BEARINGS');
hiddenTask.risk = [{ ...risk[0], hazard: 'EXCLUDED_TASK_HAZARD' }];
const direct = await createAssessedWorkOrder(
    'Follow-up conveyor work','Assess coupling and mounting bracket for the conveyor.','BEARINGS',
    [candidateTask,hiddenTask],
    async(code)=>{
        // Free text only after searching the warehouse and catalogue and confirming nothing suitable exists.
        const search=await route(maintenanceSourcingRoutes,'/api/org/mnt/sourcing/materials','assessor',{code,q:'mounting bracket'});
        Object.assign(candidateTask.spares[1],{searchReceiptId:search.receiptId,noMatchConfirmed:true,function:'Holds the drive bearing housing',
            specifications:'Steel bracket, 4 x M12 holes, fits the conveyor drive bearing housing',requiredDate:date});
    },
);
const proposal = (await listDocs(r + '/asset_task_proposals')).find((p) => p.data.taskId === 'coupling' && (p.data.woCode === direct || p.data.wrCode));
assert.ok(proposal, 'Task registry proposal should be retained across WR assessment and conversion');
await assert.rejects(() => route(maintenanceRoutes, '/api/org/mnt/tasks/validate', 'assessor', { id: proposal.id }), /own task/);
await route(maintenanceRoutes, '/api/org/mnt/tasks/validate', 'validator', { id: proposal.id });
assert.equal((await listDocs(r + '/asset_task_template_revisions')).length, 1);
// The planner can send a candidate without Materials Master permissions.
const plannerWithoutMaterials = context('planner', {
    action:'candidate',code:direct,taskId:'coupling',resourceId:'coupling_part',attributes:{},
    note:'Planner submitted the assessed spare for Materials Master creation.',
});
plannerWithoutMaterials.permissions=['MNT.*'];
plannerWithoutMaterials.directPermissions=['MNT.*'];
const queued = await maintenanceOperations(plannerWithoutMaterials);
// duplicate candidate requests update the same controlled proposal rather than creating materials.
await op('planner', 'candidate', {
    code: direct, taskId: 'coupling', resourceId: 'coupling_part', attributes: {},
    note: 'Planner reviewed assessed coupling and submitted its technical catalogue specification.',
});
assert.equal(snapshot(r + '/material_creation_candidates/' + queued.candidateId).data.status, 'ready_for_material_creation');
const candidate = await route(maintenanceMaterialCandidateRoutes, '/api/org/mnt/material-candidates/adopt', 'planner', {
    candidateId: queued.candidateId, catalogCode: 'SPECIAL-CAT', attributes: {},
});
assert.equal(snapshot(r + '/materials/' + candidate.materialDraftId).data.status, 'draft');
assert.equal(snapshot(r + '/material_creation_candidates/' + queued.candidateId).data.status, 'awaiting_material_approval');
await assert.rejects(
    () => op('planner', 'candidate', {
        code: direct, taskId: 'coupling', resourceId: 'coupling_part',
        note: 'Do not create duplicate drafts.',
    }),
    /material draft has already been created/,
);
const descriptionQueue = await op('planner', 'candidate', {
    code: direct, taskId: 'coupling', resourceId: 'bracket_part',
    note: 'Specification is incomplete. Send to Materials Master for classification review.',
});
assert.equal(snapshot(r + '/material_creation_candidates/' + descriptionQueue.candidateId).data.status, 'needs_specification');
await assert.rejects(
    () => op('planner', 'procure', { code: direct, taskId: 'coupling', resourceId: 'coupling_part', dateRequired: date, glCode: '610000' }),
    /approval/,
);
await route(procurementRoutes, '/api/org/procurement/materials/update', 'planner', {
    id: candidate.materialDraftId,
    data: {
        warehouseId: 'WAREHOUSE',
        uom: unit.code,
        materialClassification: 'SPARE',
        warehouseRestriction: 'RS15',
        supplyType: 'GENERAL',
        generalPartNumber: 'SPECIAL-COUPLING-001',
        partyEntryMode: 'manual',
        partyName: 'Approved supplier',
    },
});
await route(procurementRoutes, '/api/org/procurement/materials/submit', 'planner', { id: candidate.materialDraftId });
await assert.rejects(
    () =>
        route(procurementRoutes, '/api/org/procurement/materials/approve', 'planner', {
            id: candidate.materialDraftId,
            decision: 'approve',
        }),
    /own material/,
);
await route(procurementRoutes, '/api/org/procurement/materials/approve', 'manager', { id: candidate.materialDraftId, decision: 'approve' });
await route(procurementRoutes, '/api/org/procurement/materials/lifecycle', 'manager', {
    id: candidate.materialDraftId,
    action: 'allocate',
});
await route(procurementRoutes, '/api/org/procurement/materials/lifecycle', 'manager', { id: candidate.materialDraftId, action: 'push' });
await op('planner', 'match_spare', {
    code: direct,
    taskId: 'coupling',
    resourceId: 'coupling_part',
    materialId: candidate.materialDraftId,
    warehouseId: 'WAREHOUSE',
    note: 'Approved catalogue specification and technical attributes match the assessed coupling.',
});
await op('planner', 'match_spare', {
    code: direct,
    taskId: 'coupling',
    resourceId: 'bracket_part',
    materialId: 'BEARING',
    warehouseId: 'WAREHOUSE',
    note: 'Existing approved bearing matches the assessed technical description.',
});
const candidateReq = await op('planner', 'procure', {
    code: direct,
    taskId: 'coupling',
    resourceId: 'coupling_part',
    dateRequired: date,
    glCode: '610000',
});
const duplicateReq = await op('planner', 'procure', {
    code: direct,
    taskId: 'coupling',
    resourceId: 'coupling_part',
    dateRequired: date,
    glCode: '610000',
});
assert.equal(candidateReq.requirementId, duplicateReq.requirementId);
seed(r + '/material_journal/SPECIAL_RECEIPT', {
    materialId: candidate.materialDraftId,
    warehouseId: 'WAREHOUSE',
    status: 'posted',
    reconciled: true,
    balancesDelta: { physicalStock: 1 },
});
await op('planner', 'reserve', { code: direct, taskId: 'coupling', resourceId: 'coupling_part' });
await op('planner', 'reserve', { code: direct, taskId: 'coupling', resourceId: 'bracket_part' });
await op('planner', 'allocate', {
    code: direct,
    taskId: 'coupling',
    personnel: [people.tech[0]],
    toolsReady: true,
    competenciesConfirmed: true,
    note: 'All qualified people and task tools checked.',
});
await op('planner', 'allocate', { code: direct, taskId: 'hidden_task', personnel: [people.tech[0]], toolsReady: true, competenciesConfirmed: true, note: 'Qualified technician and tools checked.' });
await makeReady(direct);
const subset = await op('planner', 'save_window', {
    title: 'Selected coupling task only',
    equipmentId: 'CONVEYOR', date, startTime: '08:00', durationHours: 8,
    workOrderIds: [direct],
    tasks: [{ woCode: direct, taskId: 'coupling' }],
});
const subsetReport = await op('planner', 'window_report', { windowId: subset.windowId });
assert.equal(subsetReport.workOrders[0].tasks.length, 1);
assert.ok(!JSON.stringify(subsetReport).includes('EXCLUDED_TASK_HAZARD'));
const otherTask = { ...task('other', 'Other line task', 'OTHER_ASSEMBLY'), equipmentId: 'OTHER_LINE' };
const other = await createAssessedWorkOrder(
    'Other production line work','Assess work on another production line equipment.','OTHER_ASSEMBLY',[otherTask]
);
await op('planner', 'allocate', { code: other, taskId: 'other', personnel: [people.tech[0]], toolsReady: true, competenciesConfirmed: true, note: 'Qualified technician and tools checked.' });
await makeReady(other);
await assert.rejects(
    () => op('planner', 'save_window', { title: 'Forbidden mixed equipment', equipmentId: 'CONVEYOR', date, startTime: '08:00', durationHours: 8, workOrderIds: [other] }),
    /other equipment/,
);
const otherWindow = await op('planner', 'save_window', { title: 'Other line equipment', equipmentId: 'OTHER_LINE', date, startTime: '09:00', durationHours: 2, workOrderIds: [other] });
const sameLine = await op('planner', 'save_window', {
    windowId: subset.windowId,
    reason: 'Schedule every remaining task of the follow-up work order together.',
    equipmentId: 'CONVEYOR', date, startTime: '08:00', durationHours: 8,
    workOrderIds: [direct],
});
assert.equal(snapshot(r + '/maintenance_windows/' + otherWindow.windowId).data.workOrderIds.length, 1);
assert.equal(snapshot(r + '/maintenance_windows/' + sameLine.windowId).data.tasks.length, 2);
const noPermission = context('planner', { action: 'read', code: direct });
noPermission.role = 'org_user';
noPermission.permissions = [];
noPermission.directPermissions = [];
await assert.rejects(() => maintenanceOperations(noPermission), /MNT.view/);
await route(maintenanceRoutes, '/api/org/mnt/wo/action', 'planner', {
    code: direct,
    action: 'cancel',
    confirm: direct,
    note: 'Test cancellation releases all reserved task materials.',
});
assert.equal(
    (await physicalOf(org, 'WAREHOUSE', candidate.materialDraftId)).available,
    1,
    'Cancellation releases material reservations without consuming stock',
);
// ----- Raising on the equipment only; review builds on the request; closure at review needs a second person -----
const eqWr = await route(maintenanceRoutes, '/api/org/mnt/wr/create', 'requester', { confirm: true, equipmentId: 'CONVEYOR', assetTag: 'AST000001', description: 'Loud knocking noise from the drive end.' });
let eq = snapshot(r + '/work_requests/' + eqWr.code).data;
assert.equal(eq.assemblyId, '', 'Only the equipment is required to raise a request');
assert.equal(eq.titleAuto, true);
assert.match(eq.title, /^Defect on /);
await assert.rejects(() => route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: eqWr.code, action: 'save_task_assessment', tasks: [task('x', 'Inspect', 'GEARBOX')] }), /Add the assembly/);
await assert.rejects(() => route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: eqWr.code, action: 'enrich', description: 'A different description from the reviewer.' }), /kept as written/);
await assert.rejects(() => route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: eqWr.code, action: 'enrich', assemblyId: 'OTHER_ASSEMBLY' }), /assembly of CONVEYOR/);
await assert.rejects(() => route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: eqWr.code, action: 'enrich' }), /Nothing new/);
await route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: eqWr.code, action: 'enrich', assemblyId: 'GEARBOX', title: 'Gearbox knocking', sourceCode: first(l.sources) });
eq = snapshot(r + '/work_requests/' + eqWr.code).data;
assert.equal(eq.assemblyId, 'GEARBOX');
assert.equal(eq.title, 'Gearbox knocking');
assert.equal(eq.description, 'Loud knocking noise from the drive end.', 'The requester description is kept');
assert.ok(eq.path.includes('GEARBOX'));
assert.ok(eq.history.some((h) => h.action === 'Details added' && /Assembly/.test(h.note)), 'Every change is logged');
const closeBody = { code: eqWr.code, action: 'close_review', causeCode: first(l.rootCauses), solutionCode: first(l.solutions), maintenanceTypeCode: l.maintenanceTypes[0].code, description: 'Retightened the loose gearbox mounting bolts.', confirm: eqWr.code };
await assert.rejects(() => route(maintenanceRoutes, '/api/org/mnt/wr/action', 'requester', closeBody), /own request/);
await assert.rejects(() => route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { ...closeBody, description: 'short' }), /at least 10/);
await route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', closeBody);
assert.equal(snapshot(r + '/work_requests/' + eqWr.code).data.status, 'closure_pending');
await assert.rejects(() => route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: eqWr.code, action: 'confirm_closure' }), /another person/);
await assert.rejects(() => route(maintenanceRoutes, '/api/org/mnt/wr/action', 'reviewer', { code: eqWr.code, action: 'reject_closure', note: 'short' }), /10 characters/);
await route(maintenanceRoutes, '/api/org/mnt/wr/action', 'reviewer', { code: eqWr.code, action: 'reject_closure', note: 'The knocking persists after the bolts were tightened.' });
eq = snapshot(r + '/work_requests/' + eqWr.code).data;
assert.equal(eq.status, 'under_review');
assert.equal(eq.closureRejections.length, 1);
await route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', closeBody);
await route(maintenanceRoutes, '/api/org/mnt/wr/action', 'reviewer', { code: eqWr.code, action: 'confirm_closure', note: 'Verified quiet running.' });
eq = snapshot(r + '/work_requests/' + eqWr.code).data;
assert.equal(eq.status, 'closed');
assert.equal(eq.closure.confirmedBy, people.reviewer[0]);
assert.equal(eq.maintenanceTypeCode, l.maintenanceTypes[0].code, 'The closure records the GL maintenance type');

// ----- Period maintenance budget: proposed, approved under the Chart of Authority, committed by approved estimates -----
const month = date.slice(0, 7);
await assert.rejects(() => route(maintenancePlanningRoutes, '/api/org/mnt/budget/propose', 'planner', { ccId: 'LINE_CC', period: month, amount: -1, reason: 'Monthly maintenance budget for the line.' }), /amount/);
const proposal2 = await route(maintenancePlanningRoutes, '/api/org/mnt/budget/propose', 'planner', { ccId: 'LINE_CC', period: month, amount: 50000, reason: 'Monthly maintenance budget for the line.' });
await assert.rejects(() => route(maintenancePlanningRoutes, '/api/org/mnt/budget/propose', 'planner', { ccId: 'LINE_CC', period: month, amount: 60000, reason: 'A second budget proposal at once.' }), /already waiting/);
await assert.rejects(() => decideRequest(context('planner'), proposal2.id, 'approve', 'Self approval attempt'), /submitted this request/);
await decideRequest(context('manager'), proposal2.id, 'approve', 'Budget agreed.');
const budgets = await route(maintenancePlanningRoutes, '/api/org/mnt/budget/list', 'planner', { period: month });
const lineBudget = budgets.rows.find((x) => x.ccId === 'LINE_CC');
assert.equal(lineBudget.budget, 50000);
assert.ok(lineBudget.committed > 0, 'Approved work order estimates commit the period budget');
assert.equal(lineBudget.available, 50000 - lineBudget.committed);
await assert.rejects(() => route(maintenancePlanningRoutes, '/api/org/mnt/budget/propose', 'planner', { ccId: 'LINE_CC', period: month, amount: 1, reason: 'Cut the budget below what is committed.' }), /cannot be lower/);

// The no-incident confirmation also has a separate successful, explicit path.
import { safetyDeclaration } from '../../backend/maintenanceDomain.ts';
safetyDeclaration({ declaration: 'none', noIncidentsConfirmed: true });
console.log(
    'maintenance scenario passed: request, task assessment, conversion, shortages, reservation, material creation/approval, procurement, planner readiness, Chart of Authority cost approval, equipment windows and revisions, feedback, partial consumption, returns, BOM, incident, handover, Technical Manager closure and denial paths',
);
