import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildPipeline, maintenanceNeeds, shortageOf, verdictFor } from '../../backend/supplyPipeline.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const L = (qty, extra = {}) => ({ no: 10, materialId: 'M', warehouseId: 'W', quantity: qty, dateRequired: '2026-12-01', ...extra });
const base = () => ({ requirements: [], quotations: [], requisitions: [], orders: [], signals: [], materialsByNumber: new Map([['M0001', 'M']]) });

test('one purchase need is counted once, at the furthest stage it reached', () => {
    const d = base();
    d.requirements.push({ id: 'R1', data: { status: 'acknowledged', lines: [L(10)] } });
    d.quotations.push({ id: 'Q1', data: { status: 'recommended', requirementId: 'R1', lines: [{ no: 10, quantity: 10 }] } });
    d.requisitions.push({ id: 'PRQ1', data: { status: 'converted', requirementId: 'R1', lines: [{ requirementLineNo: 10, quantity: 10 }] } });
    d.orders.push({ id: 'PO1-V1', data: { status: 'partial', lines: [{ type: 'material', requirementId: 'R1', requirementLineNo: 10, quantity: 10, receivedQty: 4 }] } });
    const p = buildPipeline(d).get('M__W');
    assert.equal(p.qty, 6, 'ordered 10, 4 delivered: 6 outstanding, nothing counted again');
    assert.deepEqual(p.entries.map((e) => e.stage), ['order']);
});

test('fully delivered orders close the need; unlinked order lines match by material number', () => {
    const d = base();
    d.requirements.push({ id: 'R1', data: { status: 'acknowledged', lines: [L(10)] } });
    d.orders.push({ id: 'PO1', data: { status: 'full', lines: [{ requirementId: 'R1', requirementLineNo: 10, quantity: 10, receivedQty: 10 }] } });
    d.orders.push({ id: 'PO2', data: { status: 'sent', lines: [{ itemCode: 'M0001', costCenterId: 'W', quantity: 3, receivedQty: 0 }] } });
    assert.equal(buildPipeline(d).get('M__W').qty, 3);
});

test('requests not yet approved and quotations not yet decided count; cancelled and rejected do not', () => {
    const d = base();
    d.requirements.push({ id: 'R1', data: { status: 'pending_approval', lines: [L(5)] } });
    d.requirements.push({ id: 'R2', data: { status: 'acknowledged', lines: [L(7)] } });
    d.requirements.push({ id: 'R3', data: { status: 'rejected', lines: [L(9)] } });
    d.requirements.push({ id: 'R4', data: { status: 'unverified', lines: [L(2)] } });
    d.quotations.push({ id: 'Q1', data: { status: 'sourcing', requirementId: 'R2', lines: [{ no: 10, quantity: 7 }] } });
    const p = buildPipeline(d).get('M__W');
    assert.equal(p.qty, 14);
    assert.deepEqual(p.entries.map((e) => `${e.stage}:${e.id}`).sort(), ['quotation:Q1', 'requirement:R1', 'requirement:R4']);
    assert.equal(buildPipeline(d, new Set(['R1', 'R4'])).get('M__W').qty, 7, 'the requirement under review is left out');
});

test('only the latest version of an order in force counts', () => {
    const d = base();
    d.requirements.push({ id: 'R1', data: { status: 'acknowledged', lines: [L(10)] } });
    d.orders.push({ id: 'PO1-V1', data: { status: 'open', lines: [{ requirementId: 'R1', requirementLineNo: 10, quantity: 10 }] } });
    d.orders.push({ id: 'PO1-V2', data: { status: 'pending_approval', lines: [{ requirementId: 'R1', requirementLineNo: 10, quantity: 12 }] } });
    assert.equal(buildPipeline(d).get('M__W').qty, 12);
});

test('maintenance reservations: shortages with planned dates; done work orders are ignored', () => {
    const n = maintenanceNeeds([
        { id: 'WO1', data: { status: 'scheduled', scheduledStart: '2026-11-20', assessmentTasks: [{ id: 'T1', executionDate: '2026-11-18' }], taskPlanning: { T1: { S1: { materialId: 'M', warehouseId: 'W', required: 4, reserved: 1 } } } } },
        { id: 'WO2', data: { status: 'closed', taskPlanning: { T1: { S1: { materialId: 'M', warehouseId: 'W', required: 9, reserved: 0 } } } } },
    ]).get('M__W');
    assert.equal(n.length, 1);
    assert.equal(n[0].plannedDate, '2026-11-18');
    assert.equal(shortageOf(n), 3);
    assert.equal(shortageOf(n, '2026-11-10'), 0);
});

test('verdict: release, reduce to MOQ and multiple, cancel, review', () => {
    assert.equal(verdictFor({ requested: 10, need: 12, moq: null, multiple: null }).action, 'release');
    const r = verdictFor({ requested: 20, need: 7, moq: 5, multiple: 5 });
    assert.deepEqual([r.action, r.suggested], ['reduce', 10]);
    assert.equal(verdictFor({ requested: 5, need: 0, moq: null, multiple: null }).action, 'cancel');
    assert.equal(verdictFor({ requested: 5, need: null, moq: null, multiple: null }).action, 'review');
});

test('procurement cannot acknowledge warehouse stock without a current stores release; routes and roles are guarded', () => {
    const pr = read('backend/purchaseRequirements.ts');
    assert.match(pr, /const gate = storesGate\(d\);/);
    assert.match(pr, /acknowledge: status === 'approved' && desk && !storesGate\(d\)/);
    const sr = read('backend/storesRelease.ts');
    for (const [route, perm] of [['list', 'INV.req.view'], ['position', 'INV.req.view'], ['release', 'INV.req.release'], ['cancel', 'INV.req.release'], ['return', 'INV.req.release']]) assert.match(sr, new RegExp(`orgRoute\\('org\\.inventory\\.requirements\\.${route}', '${perm.replace(/\./g, '\\.')}'`));
    assert.match(read('backend/permissionPolicy.ts'), /a: 'INV\.req\.release', b: 'PRC\.req\.acknowledge'/);
    assert.match(read('backend/replenishment.ts'), /available: r3\(stock\.available - shortage\)/);
    assert.match(read('src/org/OrgHomePage.tsx'), /label: 'Requirements', path: 'inventory_requirements', permission: 'INV\.req\.view'/);
});

test('end to end: strict pipeline, reservations, verdict, regeneration warning, cancel, gate and release', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', './tests/helpers/maintenance-register.mjs', './tests/helpers/stores-release-scenario.mjs'], { cwd: process.cwd(), encoding: 'utf8', timeout: 90000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /scenario passed/);
});
