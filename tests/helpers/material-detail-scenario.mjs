import assert from 'node:assert/strict';
import { seed, snapshot, listDocs } from './maintenance-fixture.ts';
import { storage } from '../../backend/platform/sdk.ts';
import { procurementRoutes } from '../../backend/procurement.ts';
import { materialMediaRoutes } from '../../backend/materialMedia.ts';

// Integration scenario for the material detail screen: Stock Control saves, the replenishment gate (RP01-RP04, RP06),
// bins linked before restrictions existed, the preferred supplier list and material photos.
const org = 'md_fixture', r = 'organizations/' + org, now = new Date().toISOString();
seed(r, { status: 'active', modules: { INV: true, PRC: true }, currencyCode: 'KES', domain: 'example.test' });
for (const [id, level, parentId] of [['LE', 'legal_entity', 'root'], ['SITE', 'site', 'LE'], ['WH', 'cost_center', 'SITE']])
    seed(r + '/structure/' + id, { code: id, name: id, level, parentId, status: 'active', attributes: {} });
seed(r + '/positions/MGR', { code: 'MGR', title: 'Stores manager', parentCode: '' });
seed('users/UME00001', { orgId: org, status: 'active', role: 'org_user', firstName: 'Ann', lastName: 'Planner', email: 'ann@example.test', assignments: [{ positionCode: 'MGR', nodeId: 'SITE', startsOn: '2020-01-01', endsOn: '' }] });
const ctx = (body = {}, role = 'org_super_admin', permissions = ['INV.*', 'PRC.*']) => ({
    uid: 'UME00001', orgId: org, role, org: snapshot(r), me: snapshot('users/UME00001'), permissions, directPermissions: permissions, grants: [],
    actor: { uid: 'UME00001', email: 'ann@example.test', role, orgId: org }, meta: { ip: 'test', userAgent: 'fixture' }, body, query: {}, claims: { email: 'ann@example.test' },
});
const call = (routes, path, body, role, permissions) => {
    const h = routes['POST ' + path]?.[0];
    assert.ok(h, 'missing route ' + path);
    return h(ctx(body, role, permissions));
};
const rejects = async (p, re, label) => { await assert.rejects(p, (e) => (re.test(e.message) ? true : assert.fail(label + ': ' + e.message))); };
const update = (section, values) => call(procurementRoutes, '/api/org/inventory/material/update', { id: 'MAT1', warehouseId: 'WH', section, values });

// Private object storage is replaced for the fixture: writes succeed, links are signed per path.
const stored = new Map();
storage.write = async (items) => items.map((i) => (stored.set(i.path, i.content), true));
storage.url = async (paths) => paths.map((path) => ({ path, url: stored.has(path) ? 'https://signed.example/' + path : '' }));

const layout = { floors: [{ name: 'Ground floor', racking: true, rows: 2, racks: 2, columns: 2, positions: 5 }] };
seed(r + '/warehouses/WH', { costCenterId: 'WH', name: 'Main warehouse', materialCategoryCodes: ['MAT'], storageLocations: [{ code: 'SL-01', name: 'Main store', typeCode: 'SLT-001', active: true, createdAt: now }], layout });
seed(r + '/warehouses/WH/clusters/CL-0001', { kind: 'run', startOrd: 0, count: 10, floorFrom: 1, locationCode: 'SL-01', name: 'Bearings', subcategories: [{ code: 'SPARES', name: 'Spares' }] });
seed(r + '/materials/MAT1', { materialNumber: '100001', name: 'Bearing', shortText: 'Bearing; 6205; steel', status: 'approved', categoryCode: 'MAT', subcategoryCode: 'SPARES', warehouseIds: ['WH'] });
// A material linked to a bin before warehouse restrictions existed: the occupancy carries no restriction.
const BIN = 'CL-0001__AA_01_A_01';
seed(r + '/warehouse_bin_occupancy/WH_' + BIN, { materialId: 'MAT1', materialNumber: '100001', warehouseId: 'WH', binId: BIN, occupiedAt: now });
seed(r + '/inventory_material_info/MAT1_WH', { materialId: 'MAT1', warehouseId: 'WH', binLocation: BIN, stockingPolicy: 'MINMAX', minimumLevel: 2, maximumLevel: 5, stockCondition: 'XX99' });

// 1. Stock Control: only changed fields are checked; an older value that is no longer listed never blocks a save.
assert.equal((await update('inventory', { stockPurpose: 'US05' })).changed, 1, 'unrelated older code does not block');
await rejects(update('inventory', { stockCondition: 'XX98' }), /enabled code/, 'a changed value must be enabled');
await rejects(update('inventory', { replenishmentStrategy: 'RP99' }), /enabled code|strategy from the list/, 'unknown strategy');
// RP01 is automated: ownership and supply arrangement decide who acts, so both are required with it.
await rejects(update('inventory', { replenishmentStrategy: 'RP01' }), /stock ownership and the supply arrangement/, 'automated strategy needs ownership');
assert.equal((await update('inventory', { replenishmentStrategy: 'RP01', stockOwnership: 'OW01', supplyArrangement: 'SA01' })).changed, 3);
assert.equal(snapshot(r + '/inventory_material_info/MAT1_WH').data.stockingPolicy, 'MINMAX', 'the engine index follows the strategy');
// RP05 is recorded only (not automated), so it saves without further checks.
assert.equal((await update('inventory', { replenishmentStrategy: 'RP05' })).changed, 2);
await update('inventory', { replenishmentStrategy: 'RP01' });
console.log('stock control ok');

// 2. Restriction of a material binned before restrictions existed: the bin's storage location decides.
await rejects(update('inventory', { warehouseRestriction: 'RS15' }), /storage location has no warehouse restriction yet/, 'unaligned location');
const w = snapshot(r + '/warehouses/WH').data;
seed(r + '/warehouses/WH', { ...w, storageLocations: [{ ...w.storageLocations[0], restrictionCode: 'RS15' }] });
await rejects(update('inventory', { warehouseRestriction: 'RS02' }), /under restriction RS15\. Delink the bin/, 'other restriction than the bin');
assert.equal((await update('inventory', { warehouseRestriction: 'RS15' })).changed, 1);
assert.equal(snapshot(r + '/warehouse_bin_occupancy/WH_' + BIN).data.restrictionCode, 'RS15', 'the older bin link now records its restriction');
console.log('restriction ok');

// 3. Preferred supplier: approved vendors whose material scope covers the category and subcategory.
const vendor = (id, name, status, scopes) => seed(r + '/vendors/' + id, { number: id, legalName: name, tradeName: name, status, scopes });
vendor('VND000001', 'Bearings Ltd', 'approved', [{ kind: 'material', categoryCode: 'MAT', subcategoryCode: 'SPARES' }]);
vendor('VND000002', 'All Engineering', 'approved', [{ kind: 'material', categoryCode: 'MAT', subcategoryCode: '' }]);
vendor('VND000003', 'Chemicals Only', 'approved', [{ kind: 'material', categoryCode: 'MAT', subcategoryCode: 'CHEM' }]);
vendor('VND000004', 'Pending Spares', 'pending_approval', [{ kind: 'material', categoryCode: 'MAT', subcategoryCode: 'SPARES' }]);
vendor('VND000005', 'Spares Services', 'approved', [{ kind: 'service', categoryCode: 'MAT', subcategoryCode: 'SPARES' }]);
const detail = await call(procurementRoutes, '/api/org/inventory/material/detail', { id: 'MAT1', warehouseId: 'WH' });
assert.deepEqual(detail.supplierOptions.map((v) => [v.id, v.match]), [['VND000001', 'subcategory'], ['VND000002', 'category']]);
assert.equal(detail.inventory.replenishmentStrategy, 'RP01');
for (const bad of ['VND000003', 'VND000004', 'VND000005', 'Krones EA'])
    await rejects(update('procurement', { preferredVendor: bad }), /approved supplier that supplies this material category and subcategory/, 'not a matching supplier: ' + bad);
await update('procurement', { preferredVendor: 'VND000002' });
assert.equal(snapshot(r + '/procurement_material_info/MAT1_WH').data.preferredVendorName, 'VND000002 · All Engineering');
assert.equal((await update('procurement', { preferredVendor: '' })).changed, 2, 'clearing is allowed');
console.log('suppliers ok');

// 4. Photos from the phone: JPEG/PNG by file header, signed links only, cover photo, removal with a reason, all audited.
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]).toString('base64');
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]).toString('base64');
await rejects(call(materialMediaRoutes, '/api/org/inventory/material/photo/add', { id: 'MAT1', warehouseId: 'WH', data: Buffer.from('GIF89a....').toString('base64') }), /JPEG or PNG/, 'not an image');
await rejects(call(materialMediaRoutes, '/api/org/inventory/material/photo/add', { id: 'MAT1', warehouseId: 'WH', data: jpeg }, 'org_user', ['INV.view']), /permission denied/i, 'needs INV.edit');
let res = await call(materialMediaRoutes, '/api/org/inventory/material/photo/add', { id: 'MAT1', warehouseId: 'WH', data: 'data:image/jpeg;base64,' + jpeg });
assert.equal(res.photos.length, 1);
assert.ok(res.photos[0].cover && res.photos[0].url.startsWith('https://signed.example/organizations/' + org + '/material_photos/MAT1/'));
res = await call(materialMediaRoutes, '/api/org/inventory/material/photo/add', { id: 'MAT1', warehouseId: 'WH', data: png });
const second = res.photos.find((p) => !p.cover).id;
res = await call(materialMediaRoutes, '/api/org/inventory/material/photo/cover', { id: 'MAT1', warehouseId: 'WH', photoId: second });
assert.equal(res.photos[0].id, second, 'cover photo is listed first');
await rejects(call(materialMediaRoutes, '/api/org/inventory/material/photo/remove', { id: 'MAT1', warehouseId: 'WH', photoId: second, reason: 'x' }), /reason of 5 to 300/, 'reason required');
res = await call(materialMediaRoutes, '/api/org/inventory/material/photo/remove', { id: 'MAT1', warehouseId: 'WH', photoId: second, reason: 'Blurred photo' });
assert.equal(res.photos.length, 1);
assert.ok(res.photos[0].cover, 'the remaining photo becomes the cover');
const media = snapshot(r + '/material_media/MAT1').data;
assert.equal(media.removed.length, 1, 'the removed photo is kept as evidence');
// A stored path outside the material's own folder is never signed.
seed(r + '/material_media/MAT1', { ...media, photos: [...media.photos, { id: 'a'.repeat(24), path: 'organizations/other/material_photos/MAT1/' + 'a'.repeat(24) + '.jpg' }] });
assert.equal((await call(procurementRoutes, '/api/org/inventory/material/detail', { id: 'MAT1', warehouseId: 'WH' })).photos.length, 1);
const audits = (await listDocs(r + '/audit_events')).concat(await listDocs('audit_events')).map((a) => String(a.data.action));
for (const action of ['inventory.material.photo.add', 'inventory.material.photo.cover', 'inventory.material.photo.remove', 'inventory.material.procurement_settings', 'inventory.material.inventory_settings'])
    assert.ok(audits.includes(action), 'audited: ' + action);
console.log('photos ok');
console.log('material detail scenario passed');
