import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPlanningSetup, unitiseBom } from '../../backend/plnPlanningModel.ts';
import { explodeRequirements, firmedLinesOf, readRequirementLines, reqTransitionCheck, reviewPush, REQ_PERMISSION } from '../../backend/plnRequirementsModel.ts';

// ----- A small plant: juice bottles (final) → syrup (intermediate) → sugar and acid (materials in other units) -----
const TODAY = '2026-11-28';
const skus = new Map([
    ['JUICE', { name: 'Juice 1 L', uom: 'EA', category: 'FINISHED', processClassId: '', whole: true }],
    ['SYRUP', { name: 'Syrup', uom: 'kg', category: 'INTERMEDIATE', processClassId: '', whole: false }],
    ['SODA', { name: 'Soda', uom: 'EA', category: 'FINISHED', processClassId: '', whole: true }],
]);
const wh = (materialId, quantity, uom, extra = {}) => ({ source: 'WAREHOUSE', materialId, warehouseId: 'WH1', quantity, uom, ...extra });
const boms = {
    JUICE: {
        id: 'BOM-JUICE', name: 'Juice', parentSkuId: 'JUICE', outputQty: 10, outputUom: 'EA',
        components: [
            { line: 1, source: 'INTERMEDIATE', skuId: 'SYRUP', quantity: 1.5, uom: 'kg', splitRule: 'SPLIT' },
            wh('M-BOTTLE', 10, 'EA', { line: 2, scrapPct: 2, splitRule: 'WHOLE', packSize: 1 }),
            wh('M-CAP', 10, 'EA', { line: 3, splitRule: 'WHOLE', packSize: 1 }),
            wh('M-CARTON', 1, 'EA', { line: 4, splitRule: 'WHOLE', packSize: 1 }),
            { line: 5, source: 'PROCESS_SUPPLY', processSupplyKind: 'UTILITY', supplyUtilityCode: 'WATER', quantity: 8, uom: 'L' },
        ],
    },
    SYRUP: {
        id: 'BOM-SYRUP', name: 'Syrup', parentSkuId: 'SYRUP', outputQty: 100, outputUom: 'kg',
        components: [
            wh('M-SUGAR', 60, 'kg', { line: 1, splitRule: 'WHOLE', packSize: 25 }),
            wh('M-ACID', 500, 'g', { line: 2, splitRule: 'SPLIT' }),
        ],
    },
};
const positions = {
    'M-BOTTLE|WH1': { number: 'MAT-1', name: 'Bottle', stockUom: 'EA', purchaseUom: 'EA', available: 1000, safetyStock: 100, openSupply: 200, unitCost: 0.5, leadDays: 5, moq: 500, orderMultiple: 250 },
    'M-CAP|WH1': { number: 'MAT-2', name: 'Cap', stockUom: 'EA', purchaseUom: 'EA', available: 0, safetyStock: 0, openSupply: 0, unitCost: 0.1, leadDays: 3, moq: null, orderMultiple: null },
    'M-CARTON|WH1': { number: 'MAT-3', name: 'Carton', stockUom: 'EA', purchaseUom: 'EA', available: 400, safetyStock: 0, openSupply: 0, unitCost: 2, leadDays: 3, moq: null, orderMultiple: null },
    // Stock unit grams, bought in kilograms: 1 purchase unit = 1000 stock units.
    'M-SUGAR|WH1': { number: 'MAT-4', name: 'Sugar', stockUom: 'g', purchaseUom: 'kg', available: 10000, safetyStock: 0, openSupply: 0, unitCost: 0.002, leadDays: 14, moq: 50, orderMultiple: 25 },
    // Stock unit kilograms while the BOM uses grams.
    'M-ACID|WH1': { number: 'MAT-5', name: 'Citric acid', stockUom: 'kg', purchaseUom: 'kg', available: 0, safetyStock: 0, openSupply: 0, unitCost: 4, leadDays: 7, moq: null, orderMultiple: null },
};
const TABLE = { 'kg>g': 1000, 'g>kg': 0.001, 'L>mL': 1000, 'mL>L': 0.001 };
const convert = (a, b) => (a === b ? 1 : TABLE[`${a}>${b}`] ?? null);
const setup = defaultPlanningSetup();
const input = (lines, over = {}) => ({
    lines, skus, today: TODAY, convert,
    bomOf: (id) => boms[id] ?? null,
    unitOf: (id, bom) => unitiseBom(bom, setup, null),
    materialOf: (m, w) => positions[`${m}|${w}`] ?? null,
    ...over,
});
const lines = [
    { no: 10, skuId: 'JUICE', quantity: 2000, uom: 'EA', needDate: '2026-12-10', customer: 'ORD-1', note: '', source: 'MANUAL' },
    { no: 20, skuId: 'JUICE', quantity: 505, uom: 'EA', needDate: '2026-12-20', customer: 'ORD-2', note: '', source: 'MANUAL' },
];
const mat = (r, id) => r.materials.find((m) => m.materialId === id);

test('work back: the final SKU is produced in whole minimum batches and its intermediate is broken down further', () => {
    const r = explodeRequirements(input(lines));
    assert.equal(r.summary.blocking, 0);
    const juice = r.production.find((p) => p.skuId === 'JUICE');
    // Carton per 10 bottles = 1 whole carton → the minimum batch is 10 bottles; 2505 needs 251 batches.
    assert.equal(juice.minimalBatch, 10);
    assert.equal(juice.required, 2505);
    assert.equal(juice.lots, 251);
    assert.equal(juice.producedOutput, 2510);
    assert.equal(juice.excessOutput, 5);
    const syrup = r.production.find((p) => p.skuId === 'SYRUP');
    // 2510 bottles × 0.15 kg = 376.5 kg, rounded to whole 125 kg batches (sugar comes in whole 25 kg sacks) = 500 kg.
    assert.equal(syrup.level, 1);
    assert.equal(syrup.required, 376.5);
    assert.equal(syrup.minimalBatch, 125);
    assert.equal(syrup.lots, 4);
    assert.equal(syrup.producedOwn, 500);
    assert.equal(syrup.excessOutput, 123.5);
});

test('unit links: every BOM line is converted into the unit of the item it feeds, at every level', () => {
    const r = explodeRequirements(input(lines));
    const tree = r.trees[0].root;
    assert.equal(tree.bom.outputUom, 'EA');
    const syrupNode = tree.children.find((c) => c.itemId === 'SYRUP');
    assert.equal(syrupNode.lineUom, 'kg');
    assert.equal(syrupNode.ownUom, 'kg');
    assert.equal(syrupNode.factor, 1);
    // 2000 bottles × 0.15 kg exactly (no batch rounding in the tree).
    assert.equal(syrupNode.ownQty, 300);
    const sugarNode = syrupNode.children.find((c) => c.itemId === 'M-SUGAR');
    assert.equal(sugarNode.lineUom, 'kg');
    assert.equal(sugarNode.ownUom, 'g');
    assert.equal(sugarNode.factor, 1000);
    assert.equal(sugarNode.ownQty, 180000, '300 kg of syrup needs 60% sugar = 180 kg = 180 000 g');
    assert.match(sugarNode.perParent.rule, /packs of 25 kg/);
    const acidNode = syrupNode.children.find((c) => c.itemId === 'M-ACID');
    assert.equal(acidNode.lineUom, 'g');
    assert.equal(acidNode.ownUom, 'kg');
    assert.equal(acidNode.factor, 0.001);
});

test('total required: the consolidated gross is the sum of what each SKU needs plus the batch and pack rounding', () => {
    const r = explodeRequirements(input(lines));
    const sugar = mat(r, 'M-SUGAR');
    // Consolidated: 500 kg of syrup → 300 kg sugar = 300 000 g. Each line on its own: 2505 bottles × 0.15 kg = 375.75 kg of syrup → 225.45 kg = 225 450 g.
    assert.equal(sugar.gross, 300000);
    assert.equal(sugar.exact, 225450);
    assert.equal(sugar.rounding, 74550);
    assert.equal(sugar.gross, sugar.exact + sugar.rounding);
    assert.deepEqual(sugar.bomUnits, ['kg']);
    assert.equal(sugar.stockUom, 'g');
    const bottle = mat(r, 'M-BOTTLE');
    // 2510 bottles + 2% scrap = 2560.2, an indivisible component stays whole: 2561. On their own: 2505 × 1.02 = 2555.1.
    assert.equal(bottle.gross, 2561);
    assert.equal(bottle.exact, 2555.1);
    assert.equal(bottle.pegs.length, 2);
    assert.equal(bottle.pegs[0].lineNo, 10);
});

test('purchase requirement: net of stock and open supply, rounded to the minimum order and multiple held in the purchase unit', () => {
    const r = explodeRequirements(input(lines));
    const bottle = mat(r, 'M-BOTTLE');
    // 2561 − (1000 − 100) − 200 = 1461 → at least 500, in multiples of 250 → 1500.
    assert.equal(bottle.net, 1461);
    assert.equal(bottle.buy, 1500);
    assert.equal(bottle.excess, 39);
    assert.equal(bottle.value, 750);
    const sugar = mat(r, 'M-SUGAR');
    // 300 000 − 10 000 = 290 000 g. MOQ 50 kg and multiple 25 kg are converted to 50 000 g and 25 000 g.
    assert.equal(sugar.purchaseFactor, 1000);
    assert.equal(sugar.moq, 50000);
    assert.equal(sugar.orderMultiple, 25000);
    assert.equal(sugar.net, 290000);
    assert.equal(sugar.buy, 300000);
    assert.equal(sugar.buyPurchase, 300, 'ordered as 300 kg');
    const carton = mat(r, 'M-CARTON');
    assert.equal(carton.gross, 251);
    assert.equal(carton.net, 0);
    assert.equal(carton.buy, 0, 'covered by stock');
    const acid = mat(r, 'M-ACID');
    assert.equal(acid.gross, 2.5);
    assert.equal(acid.buy, 2.5);
    assert.equal(r.summary.toBuy, 4);
    assert.equal(r.summary.covered, 1);
});

test('dates: need by the earliest final-SKU date, order by that less the lead time, late when the lead time cannot make it', () => {
    const r = explodeRequirements(input(lines));
    const sugar = mat(r, 'M-SUGAR');
    assert.equal(sugar.needBy, '2026-12-10');
    assert.equal(sugar.orderBy, '2026-11-26');
    assert.equal(sugar.orderNow, true, 'the order date has passed');
    assert.equal(sugar.arrival, '2026-12-12');
    assert.equal(sugar.lateDays, 2);
    const cap = mat(r, 'M-CAP');
    assert.equal(cap.orderBy, '2026-12-07');
    assert.equal(cap.orderNow, false);
    assert.equal(cap.lateDays, 0);
    assert.ok(r.issues.some((i) => i.severity === 'warn' && /MAT-4/.test(i.text)));
});

test('utilities are reported as requirements only', () => {
    const r = explodeRequirements(input(lines));
    assert.equal(r.utilities.length, 1);
    assert.equal(r.utilities[0].code, 'WATER');
    assert.equal(r.utilities[0].uom, 'L');
    assert.equal(r.utilities[0].gross, 2008, '2510 bottles × 8 L per 10 bottles');
    assert.ok(!r.materials.some((m) => m.materialId === 'WATER'));
});

test('an intermediate used by two final products is added up and rounded to batches once', () => {
    const more = { ...boms, SODA: { id: 'BOM-SODA', name: 'Soda', parentSkuId: 'SODA', outputQty: 1, outputUom: 'EA', components: [{ line: 1, source: 'INTERMEDIATE', skuId: 'SYRUP', quantity: 0.2, uom: 'kg', splitRule: 'SPLIT' }, wh('M-CAP', 1, 'EA', { line: 2, splitRule: 'WHOLE', packSize: 1 })] } };
    const both = [...lines, { no: 30, skuId: 'SODA', quantity: 1000, uom: 'EA', needDate: '2026-12-15', customer: '', note: '', source: 'MANUAL' }];
    const r = explodeRequirements(input(both, { bomOf: (id) => more[id] ?? null }));
    const syrup = r.production.find((p) => p.skuId === 'SYRUP');
    // 376.5 kg for juice + 200 kg for soda = 576.5 kg → 5 batches of 125 kg = 625 kg (rounded once, not per parent).
    assert.equal(syrup.required, 576.5);
    assert.equal(syrup.lots, 5);
    assert.equal(syrup.producedOwn, 625);
    const sugar = mat(r, 'M-SUGAR');
    assert.equal(sugar.gross, 375000);
    assert.equal(sugar.pegs.length, 3, 'two juice lines and the soda line');
    assert.equal(mat(r, 'M-CAP').gross, 2510 + 1000);
});

test('blocking issues: units that cannot be converted, a missing BOM, a loop and a missing master', () => {
    const badUnit = { ...boms, SYRUP: { ...boms.SYRUP, components: [wh('M-SUGAR', 60, 'L', { line: 1, splitRule: 'SPLIT' })] } };
    let r = explodeRequirements(input(lines, { bomOf: (id) => badUnit[id] ?? null }));
    assert.ok(r.summary.blocking >= 1);
    assert.ok(r.issues.some((i) => i.severity === 'block' && /cannot be converted to the stock unit g/.test(i.text)));
    const sugarNode = r.trees[0].root.children.find((c) => c.itemId === 'SYRUP').children[0];
    assert.equal(sugarNode.factor, null);
    assert.equal(sugarNode.ownQty, null);
    assert.equal(mat(r, 'M-SUGAR'), undefined, 'a branch that cannot be converted adds nothing to the totals');

    r = explodeRequirements(input(lines, { bomOf: (id) => (id === 'SYRUP' ? null : boms[id] ?? null) }));
    assert.ok(r.issues.some((i) => i.severity === 'block' && /Syrup has no approved BOM/.test(i.text)));

    const loop = { ...boms, SYRUP: { ...boms.SYRUP, components: [{ line: 1, source: 'INTERMEDIATE', skuId: 'SYRUP', quantity: 1, uom: 'kg', splitRule: 'SPLIT' }] } };
    r = explodeRequirements(input(lines, { bomOf: (id) => loop[id] ?? null }));
    assert.ok(r.issues.some((i) => i.severity === 'block' && /cycle/.test(i.text)));

    const notFinal = [{ no: 10, skuId: 'SYRUP', quantity: 10, uom: 'kg', needDate: '2026-12-10', customer: '', note: '', source: 'MANUAL' }];
    r = explodeRequirements(input(notFinal));
    assert.ok(r.issues.some((i) => i.severity === 'block' && /not a final product/.test(i.text)));
});

test('a material with no warehouse or not set up is planned without netting and cannot be pushed', () => {
    const noWh = { ...boms, JUICE: { ...boms.JUICE, components: [...boms.JUICE.components, { line: 6, source: 'WAREHOUSE', materialId: 'M-LABEL', warehouseId: '', quantity: 10, uom: 'EA', splitRule: 'WHOLE', packSize: 1 }] } };
    const r = explodeRequirements(input(lines, { bomOf: (id) => noWh[id] ?? null }));
    const label = r.materials.find((m) => m.materialId === 'M-LABEL');
    assert.equal(label.pushable, false);
    assert.equal(label.net, label.gross, 'no stock netting');
    assert.equal(r.summary.notPushable, 1);
    assert.equal(firmedLinesOf(r.materials).some((f) => f.materialId === 'M-LABEL'), false);
    assert.ok(firmedLinesOf(r.materials).every((f) => f.firmQty > 0));
});

test('commercial lines: final products only, own unit, whole counts, future dates, no duplicate SKU on a date', () => {
    const ok = readRequirementLines([{ skuId: 'JUICE', quantity: '1,200', needDate: '2026-12-10', customer: ' ORD-9 ' }], skus, TODAY);
    assert.deepEqual(ok.map((l) => [l.no, l.skuId, l.quantity, l.uom, l.customer, l.source]), [[10, 'JUICE', 1200, 'EA', 'ORD-9', 'MANUAL']]);
    assert.throws(() => readRequirementLines([{ skuId: 'SYRUP', quantity: 5, needDate: '2026-12-10' }], skus, TODAY), /not a final product/);
    assert.throws(() => readRequirementLines([{ skuId: 'JUICE', quantity: 10.5, needDate: '2026-12-10' }], skus, TODAY), /whole number/);
    assert.throws(() => readRequirementLines([{ skuId: 'JUICE', quantity: 0, needDate: '2026-12-10' }], skus, TODAY), /greater than zero/);
    assert.throws(() => readRequirementLines([{ skuId: 'JUICE', quantity: 5, needDate: '2026-11-01' }], skus, TODAY), /past/);
    assert.throws(() => readRequirementLines([{ skuId: 'JUICE', quantity: 5, needDate: '2026-12-10' }, { skuId: 'JUICE', quantity: 6, needDate: '2026-12-10' }], skus, TODAY), /already on this set/);
    assert.throws(() => readRequirementLines([{ skuId: 'NOPE', quantity: 5, needDate: '2026-12-10' }], skus, TODAY), /choose a final product/);
    assert.deepEqual(readRequirementLines([], skus, TODAY), [], 'an empty set can be saved as a draft; submitting needs a line');
});

test('push: quantities may change with a reason but never above the approved value; pushed lines cannot be pushed twice', () => {
    const r = explodeRequirements(input(lines));
    const firmed = firmedLinesOf(r.materials);
    const total = firmed.reduce((t, f) => t + f.value, 0);
    const bottle = firmed.find((f) => f.materialId === 'M-BOTTLE');
    const cap = firmed.find((f) => f.materialId === 'M-CAP');
    // As firmed: accepted without a reason.
    let p = reviewPush(firmed, firmed.map((f) => ({ key: f.key, quantity: f.firmQty })), total);
    assert.deepEqual(p.problems, []);
    assert.equal(p.total, Math.round(total * 100) / 100);
    assert.ok(p.lines.every((l) => !l.changed));
    // Lower a quantity: a reason is needed.
    p = reviewPush(firmed, [{ key: bottle.key, quantity: 1000 }], total);
    assert.match(p.problems[0], /say why the quantity changes from 1500 to 1000/);
    p = reviewPush(firmed, [{ key: bottle.key, quantity: 1000, reason: 'Supplier has stock for 1000 now' }], total);
    assert.deepEqual(p.problems, []);
    assert.equal(p.lines[0].delta, -500);
    assert.equal(p.lines[0].changed, true);
    // Raise one above the approved value: refused. Moving quantity between lines inside the value is fine.
    p = reviewPush(firmed, firmed.map((f) => ({ key: f.key, quantity: f.firmQty * 2, reason: 'Double the order to be safe' })), total);
    assert.match(p.problems.join(' '), /above the approved value/);
    p = reviewPush(firmed, [{ key: bottle.key, quantity: 1000, reason: 'Less of this one' }, { key: cap.key, quantity: cap.firmQty + 2000, reason: 'More caps for the saving' }], total);
    assert.deepEqual(p.problems, []);
    // Bad input.
    assert.match(reviewPush(firmed, [], total).problems[0], /at least one line/);
    assert.match(reviewPush(firmed, [{ key: 'X|Y', quantity: 1 }], total).problems[0], /not a firmed line/);
    assert.match(reviewPush(firmed, [{ key: cap.key, quantity: 0 }], total).problems[0], /greater than zero/);
    assert.match(reviewPush(firmed, [{ key: cap.key, quantity: 10.5, reason: 'half cap?' }], total).problems[0], /whole EA/);
    assert.match(reviewPush(firmed, [{ key: cap.key, quantity: 5 }, { key: cap.key, quantity: 6 }], total).problems.join(' '), /listed twice/);
    const done = firmed.map((f) => (f.key === cap.key ? { ...f, pushedTo: 'REQ000000009' } : f));
    assert.match(reviewPush(done, [{ key: cap.key, quantity: cap.firmQty }], total).problems[0], /already pushed to REQ000000009/);
});

test('workflow: every action has its own permission and independent people decide', () => {
    assert.equal(REQ_PERMISSION.firm_commercial, 'PLN.commercial.firm');
    assert.equal(REQ_PERMISSION.approve_purchase, 'PLN.requirements.approve');
    assert.equal(REQ_PERMISSION.push, 'PLN.requirements.push');
    const actors = { createdBy: 'plan', commercialSubmittedBy: 'plan', firmedBy: 'firm', purchaseSubmittedBy: 'plan', approvers: ['a1'] };
    assert.match(reqTransitionCheck('commercial_review', 'firm_commercial', 'plan', actors), /independent approver/);
    assert.equal(reqTransitionCheck('commercial_review', 'firm_commercial', 'firm', actors), '');
    assert.match(reqTransitionCheck('purchase_review', 'approve_purchase', 'firm', actors), /independent approver/);
    assert.match(reqTransitionCheck('purchase_review', 'approve_purchase', 'a1', actors), /earlier level/);
    assert.equal(reqTransitionCheck('purchase_review', 'approve_purchase', 'a2', actors), '');
    assert.match(reqTransitionCheck('approved', 'push', 'a1', actors), /another person must push/);
    assert.equal(reqTransitionCheck('approved', 'push', 'rel', actors), '');
    // The state decides what is possible.
    assert.match(reqTransitionCheck('draft', 'push', 'rel', actors), /cannot be push/);
    assert.match(reqTransitionCheck('pushed', 'cancel', 'plan', actors), /cannot be cancel/);
    // Submitting the purchase needs a fresh, clean work-back with something to buy.
    assert.match(reqTransitionCheck('firmed', 'submit_purchase', 'plan', actors, {}), /Work back/);
    assert.match(reqTransitionCheck('firmed', 'submit_purchase', 'plan', actors, { explosionRun: true, explosionStale: true }), /run it again/);
    assert.match(reqTransitionCheck('firmed', 'submit_purchase', 'plan', actors, { explosionRun: true, blocking: 2 }), /Fix the 2 blocking issues/);
    assert.match(reqTransitionCheck('firmed', 'submit_purchase', 'plan', actors, { explosionRun: true, toBuy: 3, unpriced: 1 }), /1 material has no price/);
    assert.match(reqTransitionCheck('firmed', 'submit_purchase', 'plan', actors, { explosionRun: true, toBuy: 0 }), /Nothing needs buying/);
    assert.equal(reqTransitionCheck('draft', 'run_explosion', 'plan', actors), '', 'a preview can be worked back while the lines are still being prepared');
    assert.equal(reqTransitionCheck('firmed', 'submit_purchase', 'plan', actors, { explosionRun: true, toBuy: 3 }), '');
});

// ----- Wiring: roles, routes, workflow, search, procurement hand-over and the screen -----
import { readFileSync } from 'node:fs';
import { ALL_BUILT_KEYS, SOD_RULES, sodConflicts } from '../../backend/permissionPolicy.ts';
import { LEVEL_ROLES } from '../../backend/levelRoles.ts';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('roles: four new permissions, segregation of duties and level roles', () => {
    for (const k of ['PLN.commercial.plan', 'PLN.commercial.firm', 'PLN.requirements.approve', 'PLN.requirements.push']) assert.ok(ALL_BUILT_KEYS.has(k), k);
    for (const id of ['pln-commercial-maker-checker', 'pln-commercial-purchase', 'pln-firm-purchase', 'pln-purchase-push']) assert.ok(SOD_RULES.some((r) => r.id === id), id);
    for (const r of LEVEL_ROLES.filter((x) => x.module === 'PLN')) assert.deepEqual(sodConflicts(r.permissions), [], `${r.name} breaks no SoD rule`);
    const policy = read('backend/permissionPolicy.ts');
    for (const t of ['pln_requirements_planner', 'pln_commercial_firming_approver', 'pln_purchase_requirements_approver', 'pln_purchase_requirements_releaser']) assert.ok(policy.includes(`'${t}'`), t);
    // Nobody can prepare, firm, approve and push the same requirement: every pair of the four is separated.
    const pairs = [['PLN.commercial.plan', 'PLN.commercial.firm'], ['PLN.commercial.plan', 'PLN.requirements.approve'], ['PLN.commercial.firm', 'PLN.requirements.approve'], ['PLN.requirements.approve', 'PLN.requirements.push']];
    for (const [a, b] of pairs) assert.ok(sodConflicts([a, b]).length > 0, `${a} and ${b} are separated`);
});

test('routes: permissions, audit, site scope, Chart of Authority, one push at a time, no unit codes in messages', () => {
    const api = read('backend/plnRequirements.ts');
    assert.ok(read('backend/index.ts').includes('...plnRequirementRoutes'));
    for (const [route, perm] of [['create', 'PLN.commercial.plan'], ['lines/save', 'PLN.commercial.plan'], ['submit', 'PLN.commercial.plan'], ['decide', 'PLN.commercial.firm'], ['explode', 'PLN.commercial.plan'], ['purchase/submit', 'PLN.commercial.plan'], ['purchase/decide', 'PLN.requirements.approve'], ['push', 'PLN.requirements.push'], ['context', 'PLN.view'], ['list', 'PLN.view'], ['get', 'PLN.view']]) {
        assert.match(api, new RegExp(`'POST /api/org/pln/requirements/${route.replace(/\//g, '\\/')}': \\[\\s*orgRoute\\('[^']+', '${perm.replace('.', '\\.')}'`), route);
    }
    assert.ok(api.includes('approvalRoute('), 'Chart of Authority on the firmed purchase value');
    assert.ok(api.includes('audit: `pln.requirement.${action}`') || api.includes('pln.requirement.${action}'), 'every change audited');
    assert.ok(api.includes('allowedAt(ctx'), 'scoped to the site');
    assert.ok(api.includes("{ exists: false }") && api.includes('PENDING'), 'a push reserves its lines and cannot run twice');
    assert.ok(api.includes('nameUnits(result)') && api.includes('named('), 'registry unit codes never reach a message');
    const pr = read('backend/purchaseRequirements.ts');
    assert.ok(pr.includes('export async function raisePlannedRequirement') && pr.includes("source: 'planning'") && pr.includes("status: 'pending_approval'"), 'goes to the manager like any requirement');
    assert.ok(pr.includes('org.procurement.req.planning.raise'), 'raising is audited');
});

test('workflow, record search and links know the requirement set', () => {
    const wf = read('backend/workflowAdapters.ts');
    assert.ok(wf.includes("'pln.requirement'") && wf.includes('plnRequirements'));
    assert.ok(read('backend/recordSearch.ts').includes("pln_requirements"));
    assert.ok(read('backend/workflowActions.ts').includes("'pln.requirement': 'CMR'"));
});

test('screen: action bar on top, only the content scrolls, rich tables, sheets, verification, unit names', () => {
    const ui = read('src/org/PlnRequirements.tsx');
    const pf = read('src/org/ProductionFoundation.tsx');
    assert.ok(pf.includes("active==='requirements'?<PlnRequirements/>") && pf.includes("key:'requirements',label:'Commercial Requirements'"));
    assert.ok(ui.includes('sticky top-0 z-20') && ui.includes('min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain'));
    for (const id of ['pln.req.lines', 'pln.req.production', 'pln.req.materials', 'pln.req.firmed', 'pln.req.push']) assert.ok(ui.includes(`id='${id}'`), id);
    assert.ok(ui.includes("dryRun") && ui.includes('Why the quantity changes'), 'quantities are confirmed first and a change needs a reason');
    assert.ok(ui.includes('Choose the GL account'), 'the GL account is chosen for each warehouse');
    assert.ok(ui.includes('Unit link:') && ui.includes('minimum batch') && ui.includes('Total required'), 'the unit relationship, minimum batch and total required are shown at every level');
    assert.ok(!ui.includes('window.prompt') && !ui.includes('window.confirm'));
    // Units are shown by name through the dictionary, never as registry codes.
    assert.ok(ui.includes('const sym =') && ui.includes('const lab ='));
});
