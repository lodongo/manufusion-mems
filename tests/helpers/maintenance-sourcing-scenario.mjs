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

const org = 'sourcing_fixture',
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
    'MNT.WINDOW.ENGINEERING': 'ENG',
    'MNT.WINDOW.SAFETY': 'SAFETY',
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

// ===================== Maintenance addendum: sourcing hierarchy, services, procurement sync =====================
// Equipment make (OEM filter), extra materials, vendors and an open replenishment request.
seed(r + '/assets/AST000001', { ...snapshot(r + '/assets/AST000001').data, manufacturer: 'Krones', model: 'Modulfill' });
for (const [id, number, name, qty] of [
    ['BELT', 'MAT000010', 'Conveyor drive belt', 0],
    ['SEAL', 'MAT000011', 'Gearbox shaft seal', 0],
]) {
    seed(r + '/materials/' + id, {
        materialNumber: number, name, shortText: name, status: 'active', categoryCode: 'MAT', subcategoryCode: 'SPARES', familyCode: 'COMP',
        warehouseIds: ['WAREHOUSE'], uom: unit.code, baseUom: unit.symbol, materialCode: '',
    });
    if (qty) seed(r + '/material_journal/OPEN_' + id, { materialId: id, warehouseId: 'WAREHOUSE', status: 'posted', reconciled: true, balancesDelta: { physicalStock: qty }, postedAt: now });
}
// SENSOR has 2 in stock (shared setup); the task needs 3, so 1 is short after other use. Reduce to 1 usable.
seed(r + '/material_journal/USE_SENSOR', { materialId: 'SENSOR', warehouseId: 'WAREHOUSE', status: 'posted', reconciled: true, balancesDelta: { physicalStock: -1 }, postedAt: now });
const vendor = (id, name, classCode, brands, status = 'approved') =>
    seed(r + '/vendors/' + id, { status, legalName: name, classCode, brands, scopes: [{ kind: 'service', categoryCode: 'MAT', subcategoryCode: 'SPARES' }] });
vendor('VND000001', 'Krones Service', 'VCL-001', ['Krones']);
vendor('VND000002', 'KHS Service', 'VCL-001', ['KHS']);
vendor('VND000003', 'General Gear Works', 'VCL-007', []);
vendor('VND000004', 'Pending OEM', 'VCL-001', ['Krones'], 'pending_approval');
seed(r + '/procurement_requirements/REQ000000900', {
    number: 'REQ000000900', status: 'unverified', source: 'replenishment', replenishmentKey: 'SEAL_WAREHOUSE',
    lines: [{ no: 10, type: 'material', materialId: 'SEAL', warehouseId: 'WAREHOUSE', quantity: 10, uomCode: unit.code }],
    createdAt: now, updatedAt: now, version: 1,
});
const requirements = async () => (await listDocs(r + '/procurement_requirements')).filter((d) => d.id !== 'REQ000000900');
// A catalogue entry with technical attributes (one mandatory) and a registered material with that specification.
{
    const base = 'module_workspaces/PRC/catalogs/materials';
    const items = JSON.parse(snapshot(base + '/parts/items_0').data.json);
    items.push({ code: 'BRKT-CAT', name: 'Bearing bracket', categoryCode: 'MAT', subcategoryCode: 'SPARES', familyCode: 'COMP', attributes: ['MATL', 'HOLES'], requiredAttributes: ['MATL'] });
    seed(base + '/parts/items_0', { json: JSON.stringify(items) });
    seed(base + '/parts/attributes_0', { json: JSON.stringify([{ code: 'MATL', name: 'Material', dataType: 'text' }, { code: 'HOLES', name: 'Holes', dataType: 'integer' }]) });
    seed(base, { ...snapshot(base).data, sha256: 'materials-attributes', sections: { ...snapshot(base).data.sections, attributes: 1 } });
    seed(r + '/materials/BRKT', {
        materialNumber: 'MAT000020', name: 'Bearing bracket steel 4 holes', shortText: 'Bearing bracket', status: 'active', categoryCode: 'MAT', subcategoryCode: 'SPARES', familyCode: 'COMP',
        materialCode: 'BRKT-CAT', attributes: { MATL: 'Steel', HOLES: '4' }, warehouseIds: ['WAREHOUSE'], uom: unit.code,
    });
}
const search = (who, code, q) => route(maintenanceSourcingRoutes, '/api/org/mnt/sourcing/materials', who, { code, q });

// The location picker opens at the legal entity of the person raising the request.
assert.equal((await route(maintenanceRoutes, '/api/org/mnt/locations', 'assessor', { purpose: 'wr' })).homeId, 'LE');
// Raising a request: no criticality or failure mode from the requester; 1 to 5 impacts.
const { criticalityCode: _crit, ...raised } = finding;
const sixImpacts = l.impacts.flatMap((g) => g.items.map((i) => i.code)).slice(0, 6);
assert.equal(sixImpacts.length, 6);
await assert.rejects(() => route(maintenanceRoutes, '/api/org/mnt/wr/create', 'requester', { ...raised, impactCodes: sixImpacts }), /between 1 and 5 impacts/);
const wr = await route(maintenanceRoutes, '/api/org/mnt/wr/create', 'requester', { ...raised, impactCodes: sixImpacts.slice(0, 5) });
assert.equal(snapshot(r + '/work_requests/' + wr.code).data.criticalityCode, undefined, 'Criticality is left to the assessor');
await route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: wr.code, action: 'start_review' });
const header = { maintenanceTypeCode: l.maintenanceTypes[0].code, workTypeCode: l.workTypes[0].code, priorityCode: l.priorities[0].code, disciplineCode: l.disciplines[0].code };
await assert.rejects(() => route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: wr.code, action: 'assess', ...header }), /criticality/i);
await route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: wr.code, action: 'assess', ...header, criticalityCode: l.criticality.at(-1).code });
assert.equal(snapshot(r + '/work_requests/' + wr.code).data.criticalityOriginalLabel, undefined);

// 1. Warehouse first: stocked materials show usable quantity; registered-without-stock and catalogue come next.
const bearingHits = await search('assessor', wr.code, 'drive bearing');
assert.equal(bearingHits.warehouse[0].materialId, 'BEARING');
assert.equal(bearingHits.warehouse[0].available, 10);
assert.ok(!bearingHits.catalogue.some((c) => c.code === 'BEARING-CAT'), 'A catalogue entry already registered as a material is not offered again');
const beltHits = await search('assessor', wr.code, 'drive belt');
assert.equal(beltHits.warehouse.length, 0);
assert.equal(beltHits.registered[0].materialId, 'BELT');
const couplingHits = await search('assessor', wr.code, 'special coupling');
assert.equal(couplingHits.catalogue[0].code, 'SPECIAL-CAT');
const nothing = await search('assessor', wr.code, 'mounting bracket');
assert.deepEqual(nothing.counts, { warehouse: 0, registered: 0, catalogue: 0 });

const risk = [{ hazard: 'Stored energy', impact: 'Personnel injury', controls: 'Isolate supply, lock and prove zero energy before starting.', beforeRatings: { P: 2, S: 2, E: 2, A: 1 }, afterRatings: { P: 1, S: 2, E: 1, A: 1 }, permit: 'LOTO', responsiblePerson: 'Task technician' }];
const task = (id, title, assemblyId, spares = [], services = []) => ({
    id, title, description: title, instructions: 'Follow OEM instructions.', skills: 'Qualified technician', completionCriteria: 'Tested to OEM limits.',
    equipmentId: 'CONVEYOR', assemblyId, persons: 1, hours: 1, rate: 100, tools: 'Toolkit', spares, services, risk, dependencies: [], templateStatus: 'pending_validation',
});
const fromStock = (id, materialId, qty) => ({ id, source: 'warehouse', description: materialId, materialId, warehouseId: 'WAREHOUSE', qty, uom: unit.code, unitCost: null });
const registeredMaterial = (id, materialId, qty) => ({ id, source: 'material', description: materialId, materialId, warehouseId: 'WAREHOUSE', qty, uom: unit.code });
const freeText = (extra = {}) => ({
    id: 'bracket', source: 'description', description: 'Drive bearing mounting bracket', function: 'Holds the drive bearing housing',
    specifications: 'Steel bracket, 4 x M12 holes, fits the drive bearing housing', qty: 1, uom: unit.code, requiredDate: date,
    searchReceiptId: nothing.receiptId, noMatchConfirmed: true, ...extra,
});
const oemService = (extra = {}) => ({
    id: 'overhaul', description: 'OEM gearbox overhaul', categoryCode: 'MAT', subcategoryCode: 'SPARES', classCode: 'COMP', catalogCode: 'GEARBOX-SVC', attributes: {},
    proposedVendorIds: ['VND000001'], supplierCategory: 'VCL-001', executionDate: date, scope: 'Strip, inspect and rebuild the gearbox.',
    instructions: 'OEM overhaul manual rev C', deliverables: 'Overhaul report and test certificate', qualifications: 'OEM certified technician',
    certifications: 'OEM gearbox certification', personnel: 2, durationHours: 16, acceptanceCriteria: 'Vibration and temperature within OEM limits', quantity: 1, ...extra,
});
const calibration = { ...oemService(), id: 'calibration', description: 'Torque tool calibration', catalogCode: '', proposedVendorIds: [], supplierCategory: 'VCL-008', scope: 'Calibrate the torque tools used.' };
const tasks = (spares, services) => [
    task('drive', 'Replace drive components', 'BEARINGS', spares),
    task('gearbox', 'Overhaul gearbox', 'GEARBOX', [], services),
];
const goodSpares = () => [fromStock('bearing', 'BEARING', 2), fromStock('sensor', 'SENSOR', 3), registeredMaterial('belt', 'BELT', 2), registeredMaterial('seal', 'SEAL', 4), freeText()];
const save = (spares, services = [oemService(), calibration], who = 'assessor') =>
    route(maintenanceRoutes, '/api/org/mnt/wr/action', who, { code: wr.code, action: 'save_task_assessment', tasks: tasks(spares, services) });

// 2. Free text is gated by a recorded search and an explicit "nothing suitable" confirmation.
await assert.rejects(() => save([freeText({ searchReceiptId: '' })]), /search the warehouse and the material catalogue first/);
await assert.rejects(() => save([freeText({ noMatchConfirmed: false })]), /confirm that no suitable/);
await assert.rejects(() => save([freeText({ searchReceiptId: bearingHits.receiptId })]), /found \d+ item\(s\)\. Explain why/);
await assert.rejects(() => save([freeText({ specifications: 'short' })]), /detailed specifications/);
const othersReceipt = await search('reviewer', wr.code, 'mounting bracket');
await assert.rejects(() => save([freeText({ searchReceiptId: othersReceipt.receiptId })]), /search the warehouse/);
// 3. A stocked material must be taken from the warehouse; a registered catalogue entry must use the material.
await assert.rejects(() => save([registeredMaterial('b2', 'BEARING', 1)]), /in stock at .*Select it from the warehouse/);
await assert.rejects(() => save([{ id: 'c2', source: 'catalog', catalogCode: 'BEARING-CAT', description: 'Drive bearing', qty: 1, uom: unit.code }]), /already registered/);
// 4. Services need a supplier category and qualified vendors (OEM narrowed to the equipment manufacturer).
await assert.rejects(() => save(goodSpares(), [oemService({ supplierCategory: '' })]), /supplier category/);
await assert.rejects(() => save(goodSpares(), [oemService({ proposedVendorIds: ['VND000002'] })]), /approved vendor of the selected supplier category/);
await assert.rejects(() => save(goodSpares(), [oemService({ proposedVendorIds: ['VND000004'] })]), /approved vendor/);
const vendorList = await route(maintenanceSourcingRoutes, '/api/org/mnt/sourcing/vendors', 'assessor', { code: wr.code, supplierCategory: 'VCL-001', categoryCode: 'MAT', subcategoryCode: 'SPARES' });
assert.deepEqual(vendorList.vendors.map((v) => v.id), ['VND000001'], 'OEM vendors are filtered by the equipment manufacturer');
assert.deepEqual(vendorList.others.map((v) => v.id), ['VND000002']);
assert.equal(vendorList.make.manufacturer, 'Krones');
assert.ok(vendorList.categories.some((c) => c.code === 'VCL-001' && c.kind === 'oem') && vendorList.categories.some((c) => c.code === 'VCL-002' && c.kind === 'ocm'));

// Catalogue drill-down, mandatory attributes and the check for registered materials of the same specification.
const cat = (body) => route(maintenanceSourcingRoutes, '/api/org/mnt/sourcing/catalogue', 'assessor', { code: wr.code, ...body });
assert.ok((await cat({})).categories.some((c) => c.code === 'MAT' && c.subcategories.some((x) => x.code === 'SPARES')));
const tree = await cat({ categoryCode: 'MAT', subcategoryCode: 'SPARES' });
assert.ok(tree.families.some((f) => f.code === 'COMP') && tree.items.some((i) => i.code === 'BRKT-CAT' && i.familyCode === 'COMP'));
const bracketSpec = (await cat({ itemCode: 'BRKT-CAT' })).spec;
assert.deepEqual(bracketSpec.attributes.filter((a) => a.required).map((a) => a.code), ['MATL']);
const similar = (attributes) => route(maintenanceSourcingRoutes, '/api/org/mnt/sourcing/similar', 'assessor', { code: wr.code, itemCode: 'BRKT-CAT', attributes, warehouseId: 'WAREHOUSE' });
await assert.rejects(() => similar({ HOLES: '4' }), /mandatory attributes: Material/);
const same = (await similar({ MATL: 'steel', HOLES: '4' })).items;
assert.equal(same[0].materialId, 'BRKT');
assert.equal(same[0].exact, true, 'Same family and attribute values are reported as the same specification');
assert.equal(same[0].linked, true);
const close = (await similar({ MATL: 'Steel', HOLES: '6' })).items;
assert.equal(close[0].exact, false);
assert.equal(close[0].score, 50);
const catalogSpare = (attributes) => ({ id: 'brkt', source: 'catalog', catalogCode: 'BRKT-CAT', description: 'Bearing bracket', attributes, qty: 2, uom: unit.code, warehouseId: 'WAREHOUSE' });
await assert.rejects(() => save([catalogSpare({ HOLES: '6' })]), /mandatory attributes: Material/);
await assert.rejects(() => save([catalogSpare({ MATL: 'Steel', HOLES: '4' })]), /MAT000020 is already registered/);
await assert.rejects(() => save([{ ...catalogSpare({ MATL: 'Steel', HOLES: '6' }), warehouseId: 'NOT_A_WAREHOUSE' }]), /warehouse you have access to/);
await save([catalogSpare({ MATL: 'Steel', HOLES: '6' })]);
assert.equal(snapshot(r + '/work_requests/' + wr.code).data.assessmentTasks[0].spares[0].familyCode, 'COMP');

await save(goodSpares());
const savedTasks = snapshot(r + '/work_requests/' + wr.code).data.assessmentTasks;
assert.deepEqual(savedTasks.map((t) => t.code), ['ASSMTASK_1', 'ASSMTASK_2'], 'Tasks are referenced ASSMTASK_1, ASSMTASK_2 …');
await route(maintenanceRoutes, '/api/org/mnt/wr/action', 'reviewer', { code: wr.code, action: 'review_assessment', note: 'Independent review of spares, services and risks.' });
const wo = (await route(maintenanceRoutes, '/api/org/mnt/wr/action', 'assessor', { code: wr.code, action: 'convert', confirm: wr.code })).woCode;
assert.equal((await requirements()).length, 0, 'Conversion from assessment creates no procurement requirement');

// 5. Warehouse reservation: full, and partial with a shortage requirement (never over-reserving).
const full = await op('planner', 'secure_spare', { code: wo, taskId: 'drive', resourceId: 'bearing' });
assert.equal(full.shortage, 0);
assert.equal((await physicalOf(org, 'WAREHOUSE', 'BEARING')).available, 8);
await assert.rejects(() => op('planner', 'secure_spare', { code: wo, taskId: 'drive', resourceId: 'sensor' }), /GL account/);
assert.equal((await physicalOf(org, 'WAREHOUSE', 'SENSOR')).available, 0, 'The usable sensor is reserved even when the shortage still needs a GL account');
const partial = await op('planner', 'secure_spare', { code: wo, taskId: 'drive', resourceId: 'sensor', glCode: '610000', dateRequired: date });
assert.equal(partial.kind, 'maintenance');
assert.equal(partial.shortage, 2);
const sensorReq = snapshot(r + '/procurement_requirements/' + partial.requirementId).data;
assert.equal(sensorReq.status, 'pending_approval');
assert.equal(sensorReq.lines[0].quantity, 2);
assert.equal(sensorReq.maintenanceSource.woCode, wo);
assert.equal(sensorReq.maintenanceSource.taskId, 'drive');
assert.ok(sensorReq.maintenanceSource.planningGroup.label);
// Repeating it does not raise a second requirement.
const again = await op('planner', 'secure_spare', { code: wo, taskId: 'drive', resourceId: 'sensor', glCode: '610000', dateRequired: date });
assert.equal(again.requirementId, partial.requirementId);
assert.equal((await requirements()).length, 1);
// 6. Registered material without stock: requirement for the full quantity.
const belt = await op('planner', 'procure', { code: wo, taskId: 'drive', resourceId: 'belt', glCode: '610000', dateRequired: date });
assert.equal(snapshot(r + '/procurement_requirements/' + belt.requirementId).data.lines[0].quantity, 2);
// 7. An existing open replenishment covering the shortage is linked, not duplicated.
const seal = await op('planner', 'secure_spare', { code: wo, taskId: 'drive', resourceId: 'seal', glCode: '610000', dateRequired: date });
assert.equal(seal.kind, 'replenishment');
assert.equal(seal.requirementId, 'REQ000000900');
assert.equal((await requirements()).length, 2);

// 8. Free-text spare → material creation → approval → requirement pushed automatically and verified by the planner.
await assert.rejects(() => op('planner', 'secure_spare', { code: wo, taskId: 'drive', resourceId: 'bracket', glCode: '610000' }), /approval must complete/);
const queued = await op('planner', 'candidate', { code: wo, taskId: 'drive', resourceId: 'bracket', catalogCode: 'SPECIAL-CAT', attributes: {}, note: 'Free-text bracket sent for Materials Master creation.' });
const draft = await route(maintenanceMaterialCandidateRoutes, '/api/org/mnt/material-candidates/adopt', 'planner', { candidateId: queued.candidateId, catalogCode: 'SPECIAL-CAT', attributes: {} });
await route(procurementRoutes, '/api/org/procurement/materials/update', 'planner', {
    id: draft.materialDraftId,
    data: { warehouseId: 'WAREHOUSE', uom: unit.code, materialClassification: 'SPARE', warehouseRestriction: 'RS15', supplyType: 'GENERAL', generalPartNumber: 'BRACKET-001', partyEntryMode: 'manual', partyName: 'Approved supplier' },
});
await route(procurementRoutes, '/api/org/procurement/materials/submit', 'planner', { id: draft.materialDraftId });
await route(procurementRoutes, '/api/org/procurement/materials/approve', 'manager', { id: draft.materialDraftId, decision: 'approve' });
const linked = snapshot(r + '/material_creation_candidates/' + queued.candidateId).data;
assert.equal(linked.status, 'material_registered');
assert.ok(linked.requirementId, 'The approved material is pushed to Procurement Requirements');
const pushed = snapshot(r + '/procurement_requirements/' + linked.requirementId).data;
assert.equal(pushed.status, 'unverified');
assert.equal(pushed.source, 'maintenance');
assert.equal(pushed.lines[0].materialId, draft.materialDraftId);
assert.equal(snapshot(r + '/work_orders/' + wo).data.taskPlanning.drive.bracket.materialId, draft.materialDraftId, 'Task spare linked to the approved code');
await route(procurementRoutes, '/api/org/procurement/materials/lifecycle', 'manager', { id: draft.materialDraftId, action: 'allocate' });
await route(procurementRoutes, '/api/org/procurement/materials/lifecycle', 'manager', { id: draft.materialDraftId, action: 'push' });
const verified = await op('planner', 'secure_spare', { code: wo, taskId: 'drive', resourceId: 'bracket', glCode: '610000', dateRequired: date });
assert.equal(verified.requirementId, linked.requirementId, 'Planner verifies the pushed requirement instead of raising another');
assert.equal(snapshot(r + '/procurement_requirements/' + linked.requirementId).data.status, 'pending_approval');
assert.equal(snapshot(r + '/procurement_requirements/' + linked.requirementId).data.requesterUid, people.planner[0]);
assert.equal((await requirements()).length, 3);

// 9. Services: sourcing confirmed with a qualified vendor before the requirement; onboarding when none is suitable.
await assert.rejects(() => op('planner', 'procure', { code: wo, taskId: 'gearbox', resourceId: 'overhaul', glCode: '610000' }), /supplier category/);
await assert.rejects(() => op('planner', 'service_sourcing', { code: wo, taskId: 'gearbox', resourceId: 'overhaul', supplierCategory: 'VCL-001', preferredVendorId: 'VND000002' }), /approved vendor/);
await op('planner', 'service_sourcing', { code: wo, taskId: 'gearbox', resourceId: 'overhaul', supplierCategory: 'VCL-001', preferredVendorId: 'VND000001' });
const svc = await op('planner', 'procure', { code: wo, taskId: 'gearbox', resourceId: 'overhaul', glCode: '610000' });
const svcReq = snapshot(r + '/procurement_requirements/' + svc.requirementId).data;
assert.equal(svcReq.maintenanceSource.supplierCategory, 'VCL-001');
assert.deepEqual(svcReq.maintenanceSource.preferredVendor, { id: 'VND000001', name: 'Krones Service' });
assert.equal(svcReq.maintenanceSource.executionDate, date);
assert.match(svcReq.lines[0].technical, /Acceptance: Vibration/);
assert.equal(svcReq.lines[0].dateRequired, date);
assert.equal((await op('planner', 'procure', { code: wo, taskId: 'gearbox', resourceId: 'overhaul', glCode: '610000' })).requirementId, svc.requirementId);
await assert.rejects(() => op('planner', 'service_sourcing', { code: wo, taskId: 'gearbox', resourceId: 'overhaul', supplierCategory: 'VCL-001', preferredVendorId: 'VND000001' }), /fixed once/);
await assert.rejects(() => op('planner', 'service_sourcing', { code: wo, taskId: 'gearbox', resourceId: 'calibration', supplierCategory: 'VCL-008' }), /Suggested supplier name|Reason/);
await op('planner', 'service_sourcing', { code: wo, taskId: 'gearbox', resourceId: 'calibration', supplierCategory: 'VCL-008', suggestedVendor: 'Metrology Lab Ltd', onboardingReason: 'No approved calibration laboratory exists.' });
const onboarding = await route(maintenanceSourcingRoutes, '/api/org/procurement/vendors/onboarding-requests', 'manager', {});
assert.equal(onboarding.items.length, 1);
assert.equal(onboarding.items[0].suggestedName, 'Metrology Lab Ltd');
await assert.rejects(
    () => route(maintenanceSourcingRoutes, '/api/org/procurement/vendors/onboarding-requests/resolve', 'manager', { id: onboarding.items[0].id, outcome: 'registered', vendorId: 'VND000003', note: 'Registered and approved the laboratory.' }),
    /vendor class/,
);
const cal = await op('planner', 'procure', { code: wo, taskId: 'gearbox', resourceId: 'calibration', glCode: '610000' });
assert.equal(snapshot(r + '/procurement_requirements/' + cal.requirementId).data.maintenanceSource.supplierOnboardingRequestId, onboarding.items[0].id);

// 10. Procurement progress is reflected on the task, and readiness completes only when everything is satisfied.
let read = await op('planner', 'read', { code: wo });
const item = (id) => read.readiness.items.find((x) => x.spareId === id || x.serviceId === id);
assert.equal(item('sensor').procurement.stage, 'approval');
assert.equal(item('seal').status, 'linked_replenishment');
assert.equal(item('seal').procurement.stage, 'verification');
assert.equal(item('overhaul').status, 'awaiting_procurement');
assert.equal(read.readiness.ready, false);
seed(r + '/procurement_orders/PO00000101-V1', { number: 'PO00000101-V1', status: 'partial', vendorId: 'VND000099', lines: [{ no: 10, type: 'material', requirementId: partial.requirementId, quantity: 2, receivedQty: 2 }] });
seed(r + '/procurement_orders/PO00000102-V1', { number: 'PO00000102-V1', status: 'open', vendorId: 'VND000001', vendorName: 'Krones Service', lines: [{ no: 10, type: 'service', requirementId: svc.requirementId, quantity: 1, total: 5000 }] });
seed(r + '/procurement_orders/PO00000103-V1', { number: 'PO00000103-V1', status: 'open', vendorId: 'VND000005', lines: [{ no: 10, type: 'service', requirementId: cal.requirementId, quantity: 1, total: 800 }] });
for (const [id, qty] of [['SENSOR', 2], ['BELT', 2], ['SEAL', 4], [draft.materialDraftId, 1]])
    seed(r + '/material_journal/RECEIPT_' + id, { materialId: id, warehouseId: 'WAREHOUSE', status: 'posted', reconciled: true, balancesDelta: { physicalStock: qty }, postedAt: now });
read = await op('planner', 'read', { code: wo });
assert.equal(item('sensor').procurement.stage, 'received');
assert.equal(item('sensor').status, 'received_reserve');
assert.equal(item('overhaul').status, 'order_placed');
assert.equal(item('overhaul').orderReady.id, 'PO00000102-V1');
for (const id of ['sensor', 'belt', 'seal', 'bracket']) await op('planner', 'reserve', { code: wo, taskId: 'drive', resourceId: id });
for (const [id, po] of [['overhaul', 'PO00000102-V1'], ['calibration', 'PO00000103-V1']])
    await op('planner', 'secure_service', { code: wo, taskId: 'gearbox', resourceId: id, poId: po, lineNo: 10, readyAt: date, note: 'Service order confirmed against the assessed scope.' });
read = await op('planner', 'read', { code: wo });
assert.equal(read.readiness.ready, false, 'People and tools are still outstanding');
for (const t of ['drive', 'gearbox'])
    await op('planner', 'allocate', { code: wo, taskId: t, personnel: [people.tech[0]], toolsReady: true, competenciesConfirmed: true, note: 'Qualified technician and tools confirmed.' });
read = await op('planner', 'read', { code: wo });
assert.deepEqual(read.readiness.problems, []);
assert.equal(read.readiness.ready, true);
// A cancelled supply order makes the service not ready again.
seed(r + '/procurement_orders/PO00000103-V1', { ...snapshot(r + '/procurement_orders/PO00000103-V1').data, status: 'cancelled' });
read = await op('planner', 'read', { code: wo });
assert.equal(item('calibration').status, 'order_inactive');
assert.equal(read.readiness.ready, false);

// 11. Controlled reassessment does not duplicate requirements.
await op('planner', 'reassess', { code: wo, note: 'Scope check after supplier feedback on the gearbox.' });
await route(maintenanceRoutes, '/api/org/mnt/wo/action', 'reviewer', { code: wo, action: 'review_assessment', note: 'Re-approved the unchanged assessment after reopening.' });
const after = await op('planner', 'secure_spare', { code: wo, taskId: 'drive', resourceId: 'belt', glCode: '610000', dateRequired: date });
assert.equal(after.shortage, 0, 'Received stock is reserved again');
await op('planner', 'service_sourcing', { code: wo, taskId: 'gearbox', resourceId: 'overhaul', supplierCategory: 'VCL-001', preferredVendorId: 'VND000001' });
assert.equal((await op('planner', 'procure', { code: wo, taskId: 'gearbox', resourceId: 'overhaul', glCode: '610000' })).requirementId, svc.requirementId);
assert.equal((await requirements()).length, 5, 'Reassessment re-links the open requirements');
console.log('maintenance sourcing scenario passed: warehouse reserve, partial shortage, registered material, replenishment link, gated free text, material approval push, OEM/OCM vendors, onboarding, no duplicates, procurement progress and readiness');
