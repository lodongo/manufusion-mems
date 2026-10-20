import test from 'node:test';
import assert from 'node:assert/strict';
import { plannedTransactionBlueprints, areaDefinitions, ACTION_NAMES } from '../../backend/transactionBlueprints.ts';
import { linkRouteToBlueprint, transactionCatalogue } from '../../backend/transactionCatalogue.ts';

test('every reserved transaction code is well formed, unique and never executable', () => {
  const codes = plannedTransactionBlueprints();
  assert.ok(codes.length > 1500);
  assert.equal(new Set(codes.map((c) => c.code)).size, codes.length);
  for (const c of codes) {
    assert.match(c.code, /^[A-Z]{2,4}-[A-Z0-9]{3,4}-[A-Z0-9]{2,4}$/);
    assert.equal(c.executable, false);
  }
});

test('finance, procurement, inventory and warehousing carry curated submodules with known actions', () => {
  const defs = areaDefinitions();
  for (const [module, minimum] of [['FIN', 25], ['PRC', 15], ['INV', 15], ['WHS', 12]]) {
    const areas = defs.filter((d) => d.module === module);
    assert.ok(areas.length >= minimum, `${module} has ${areas.length} submodules`);
    for (const a of areas) for (const action of a.actions) assert.ok(ACTION_NAMES[action], `${module}-${a.area} uses unknown action ${action}`);
  }
  const po = defs.find((d) => d.module === 'PRC' && d.area === 'PUR');
  for (const action of ['CR', 'SB', 'AP', 'AM', 'SN', 'CL']) assert.ok(po.actions.includes(action));
  const counts = defs.find((d) => d.module === 'INV' && d.area === 'CNT');
  for (const action of ['CT', 'VF', 'RQ', 'PS']) assert.ok(counts.actions.includes(action));
});

test('legacy permission codes are derived from the permission itself, not from list order', () => {
  const first = plannedTransactionBlueprints().filter((c) => c.area === 'LEG');
  const second = plannedTransactionBlueprints().filter((c) => c.area === 'LEG');
  assert.deepEqual(first.map((c) => [c.legacyPermissionKeys[0], c.code]), second.map((c) => [c.legacyPermissionKeys[0], c.code]));
});

test('installed routes link to their reserved placeholders', () => {
  const cases = [
    ['/api/org/procurement/orders/approve', 'PRC-PUR-AP'],
    ['/api/org/procurement/orders/send', 'PRC-PUR-SN'],
    ['/api/org/procurement/orders/receive', 'PRC-GRN-GR'],
    ['/api/org/procurement/vendors/suspend', 'PRC-VEN-SU'],
    ['/api/org/procurement/req/submit', 'PRC-REQ-SB'],
    ['/api/org/fin/chart/propose', 'FIN-COA-SB'],
    ['/api/org/fin/requests/decide', 'FIN-APR-AP'],
    ['/api/org/inv/issue/post', 'INV-GIS-PS'],
    ['/api/org/warehouse/cluster/create', 'WHS-BIN-CR'],
  ];
  for (const [path, code] of cases) {
    const link = linkRouteToBlueprint({ path });
    assert.ok(link, path);
    assert.equal(`${link.module}-${link.area}-${link.action}`, code, path);
  }
  assert.equal(linkRouteToBlueprint({ path: '/api/admin/tenants/list' }), null);
});

test('catalogue states: linked codes are live, the rest stay reserved, added codes never collide', () => {
  const route = (path) => ({ method: 'POST', path, name: path, permission: null, module: 'PRC', area: 'GEN', code: 'PRC-GEN-' + path.length, handlerWired: true, guard: 'organization', bindingStatus: 'system_bound', enforcement: 'authenticated_handler', activationCertified: false });
  const rows = transactionCatalogue(
    [{ code: 'PRC-PUR-AP', module: 'PRC', area: 'PUR', areaName: '', action: 'AP', actionName: '', name: 'duplicate', status: 'reserved', addedBy: '', addedAt: '', reason: '' },
     { code: 'PRC-XYZ-AP', module: 'PRC', area: 'XYZ', areaName: 'Test', action: 'AP', actionName: 'Approve', name: 'Added', status: 'reserved', addedBy: 'a', addedAt: '', reason: 'test reason' }],
    [route('/api/org/procurement/orders/approve'), route('/api/org/unmatched/thing')],
  );
  const byCode = new Map(rows.map((r) => [r.code, r]));
  assert.equal(byCode.get('PRC-PUR-AP').state, 'live');
  assert.equal(byCode.get('PRC-PUR-AP').source, 'built_in');
  assert.equal(byCode.get('PRC-PUR-VW').state, 'live');
  assert.equal(byCode.get('PRC-PUR-SN').state, 'reserved');
  assert.equal(byCode.get('PRC-XYZ-AP').state, 'added_reserved');
  assert.ok(rows.some((r) => r.state === 'live_unlinked' && r.routes[0].endsWith('/unmatched/thing')));
});
