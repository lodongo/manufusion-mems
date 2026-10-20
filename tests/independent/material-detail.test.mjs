import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { suppliersFor } from '../../backend/materialMedia.ts';
import { AUTOMATED_METHODS, METHODS, methodOf } from '../../backend/replenishmentPlan.ts';
import { linkRouteToBlueprint } from '../../backend/transactionCatalogue.ts';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('preferred supplier list: approved vendors covering the material category and subcategory, exact subcategory first', () => {
    const v = (id, status, scopes, name = id) => ({ id, data: { number: id, legalName: name, status, scopes } });
    const vendors = [
        v('VND000001', 'approved', [{ kind: 'material', categoryCode: 'MAT', subcategoryCode: '' }], 'Zeta whole category'),
        v('VND000002', 'approved', [{ kind: 'material', categoryCode: 'MAT', subcategoryCode: 'SPARES' }], 'Alpha spares'),
        v('VND000003', 'approved', [{ kind: 'material', categoryCode: 'MAT', subcategoryCode: 'CHEM' }]),
        v('VND000004', 'suspended', [{ kind: 'material', categoryCode: 'MAT', subcategoryCode: 'SPARES' }]),
        v('VND000005', 'approved', [{ kind: 'service', categoryCode: 'MAT', subcategoryCode: 'SPARES' }]),
        v('VND000006', 'approved', [{ kind: 'material', categoryCode: 'OTHER', subcategoryCode: '' }]),
    ];
    assert.deepEqual(suppliersFor(vendors, { categoryCode: 'MAT', subcategoryCode: 'SPARES' }).map((x) => [x.id, x.match]), [['VND000002', 'subcategory'], ['VND000001', 'category']]);
    assert.deepEqual(suppliersFor(vendors, { categoryCode: '', subcategoryCode: 'SPARES' }), [], 'no category, no list');
    assert.deepEqual(suppliersFor(vendors, { categoryCode: 'MAT', subcategoryCode: '' }).map((x) => x.id), ['VND000001'], 'without subcategory only whole-category suppliers');
});

test('automatic replenishment is triggered only by RP01-RP04 and RP06, from the Stock Control strategy', () => {
    assert.deepEqual(AUTOMATED_METHODS, ['RP01', 'RP02', 'RP03', 'RP04', 'RP06']);
    assert.deepEqual(Object.values(METHODS).filter((m) => m.automated).map((m) => m.name), ['Min-Max', 'Reorder Point', 'Economic Order Quantity', 'Just-in-Time', 'MRP-controlled']);
    assert.equal(methodOf('', 'MINMAX'), '', 'an older stocking policy alone does not plan');
    const eng = read('backend/replenishment.ts');
    assert.match(eng, /where: fieldIn\('replenishmentStrategy', AUTOMATED_METHODS\)/, 'the sweep selects by the Stock Control strategy');
    assert.doesNotMatch(eng, /fieldIn\('stockingPolicy'/, 'the older stocking policy is no longer a selector');
});

test('material photo routes are permission-guarded, location-bound, audited and linked to the inventory transactions', () => {
    const media = read('backend/materialMedia.ts');
    for (const name of ['add', 'remove', 'cover']) {
        assert.match(media, new RegExp(`orgRoute\\('org\\.inventory\\.material\\.photo\\.${name}', 'INV\\.edit'`), name + ' needs INV.edit');
        assert.match(media, new RegExp(`audited\\(ctx, 'inventory\\.material\\.photo\\.${name}'`), name + ' is audited');
        assert.ok(linkRouteToBlueprint({ path: `/api/org/inventory/material/photo/${name}` }), name + ' linked to a transaction placeholder');
    }
    assert.match(media, /requireAt\(ctx, \['INV\.edit'\], warehouseId, 'write'/);
    assert.match(media, /detectImage\(binary\)/, 'file header checked on the server');
    assert.match(read('backend/index.ts'), /\.\.\.materialMediaRoutes,/);
});

test('material screen: diff-only saves, supplier picker, overview with phone photos, replenishment follows Stock Control', () => {
    const ui = read('src/org/InventoryMaterialDetail.tsx');
    assert.match(ui, /Object\.entries\(full\)\.filter\(\(\[k, v\]\) => String\(record\?\.\[k\] \?\? ''\) !== String\(v \?\? ''\)\)/, 'only changed values are sent');
    assert.doesNotMatch(ui, /existing configuration/, 'no hidden legacy strategy is shown or saved');
    assert.match(ui, /stockControlErrors\(values\)/);
    assert.match(ui, /field === 'preferredVendor'/);
    assert.match(ui, /noticeRef\.current\?\.scrollIntoView/, 'save errors are brought into view');
    const overview = read('src/org/MaterialOverview.tsx');
    assert.match(overview, /capture='environment'/, 'camera capture on phones');
    assert.match(overview, /line-clamp-2/, 'long descriptions are clamped');
    assert.match(overview, /break-all font-mono/, 'long bin codes wrap');
    const proc = read('backend/procurement.ts');
    assert.match(proc, /Choose an approved supplier that supplies this material category/);
    assert.match(proc, /str\(clean\[field\]\)===str\(before\[field\]\)\)continue;/, 'unchanged stock codes are not re-validated');
});

test('integration: Stock Control saves, restriction of older bin links, preferred supplier and photos through the route handlers', async () => {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', './tests/helpers/maintenance-register.mjs', './tests/helpers/material-detail-scenario.mjs'], { cwd: process.cwd(), encoding: 'utf8', timeout: 90000 });
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr.split('\n').filter((l) => !/SECURITY_RATE_LIMIT_UNAVAILABLE|^\s+at |status: 404|^\}/.test(l)).join('\n'));
    for (const stage of ['stock control ok', 'restriction ok', 'suppliers ok', 'photos ok', 'material detail scenario passed']) assert.match(result.stdout, new RegExp(stage));
});
