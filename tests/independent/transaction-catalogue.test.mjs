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
  assert.equal(linkRouteToBlueprint({ path: '/api/unknown-family/thing' }), null);
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

import { POSTING_EVENTS, postingRoles, suggestRoleAccounts } from '../../backend/finPostingCatalogue.ts';

test('every route family links, including platform administration, workspace and self-service', () => {
  const cases = [
    ['/api/admin/tenants/list', 'PLT-TEN-VW'], ['/api/admin/tenants/status', 'PLT-TEN-ED'],
    ['/api/admin/assets/catalog/chunk', 'PLT-ASM-IM'], ['/api/admin/fx/refresh', 'PLT-FXR-RN'],
    ['/api/org/quick/chat/send', 'WSP-CHT-SN'], ['/api/org/quick/gemba/resolve', 'WSP-GEM-CL'],
    ['/api/org/mail/send', 'WSP-MAI-SN'], ['/api/org/actions/respond', 'WSP-ACT-AN'],
    ['/api/org/mnt/tasks/validate', 'MNT-TSK-AP'], ['/api/org/assets/dictionary/class', 'AST-DIC-VW'],
    ['/api/session', 'SYS-SES-VW'], ['/api/payments/intasend/webhook', 'SYS-PAY-PY'],
    ['/api/org/fin/calendar/period/status', 'FIN-PER-ED'],
  ];
  for (const [path, code] of cases) {
    const link = linkRouteToBlueprint({ path });
    assert.ok(link, path);
    assert.equal(`${link.module}-${link.area}-${link.action}`, code, path);
  }
});

test('every financial movement uses real transaction codes and known accounting roles', () => {
  const codes = new Set(plannedTransactionBlueprints().map((b) => b.code));
  const roles = new Set(postingRoles().map((r) => r.code));
  for (const e of POSTING_EVENTS) {
    assert.ok(e.codes.length > 0, e.event);
    for (const c of e.codes) assert.ok(codes.has(c), `${e.event} refers to unknown code ${c}`);
    for (const r of [...e.debit, ...e.credit]) assert.ok(roles.has(r), `${e.event} uses unknown role ${r}`);
    if (e.state === 'live') assert.ok(e.via && e.via.length, `${e.event} must name the route that posts it`);
  }
  for (const live of ['GR_STOCK', 'GR_DIRECT', 'GR_ASSET', 'SVC_ACCEPT', 'GI_CC', 'GI_WO', 'ST_ADJ', 'STK_OPEN', 'INV_RECON', 'REALLOC', 'YE_CLOSE']) {
    assert.equal(POSTING_EVENTS.find((e) => e.event === live)?.state, 'live', live);
  }
});

test('default GL accounts: role tag first, then name, always on the right statement', () => {
  const chart = [
    { code: '1100', name: 'Raw materials inventory', statement: 'BS' },
    { code: '1190', name: 'Stock count differences', statement: 'PL' },
    { code: '2100', name: 'Trade payables', statement: 'BS' },
    { code: '2150', name: 'Goods received not invoiced', statement: 'BS' },
    { code: '2300', name: 'Clearing (tagged)', statement: 'BS', accountRole: 'GR/IR' },
    { code: '5100', name: 'Material consumption', statement: 'PL' },
    { code: '5150', name: 'Inventory variance', statement: 'PL' },
    { code: '1000', name: 'Cash at bank', statement: 'BS' },
    { code: '6100', name: 'Bank charges', statement: 'PL' },
    { code: '9999', name: 'Inventory header', statement: 'BS', postable: false },
  ];
  const s = suggestRoleAccounts(chart);
  assert.equal(s.INVENTORY.code, '1100');
  assert.equal(s.GRIR.code, '2300');
  assert.equal(s.GRIR.basis, 'gl_master_role');
  assert.equal(s.SUPPLIER_PAYABLE.code, '2100');
  assert.equal(s.CONSUMPTION.code, '5100');
  assert.equal(s.STOCK_DIFF.code, '1190');
  assert.equal(s.BANK.code, '1000');
  assert.equal(s.BANK_CHARGES.code, '6100');
  assert.equal(s.RETAINED_EARNINGS, null);
});

test('financial codes carry their postings in the catalogue; shared-route postings are live', () => {
  const route = (path) => ({ method: 'POST', path, name: path, permission: null, module: 'INV', area: 'GEN', code: 'INV-GEN-' + path.length, handlerWired: true, guard: 'organization', bindingStatus: 'system_bound', enforcement: 'authenticated_handler', activationCertified: false });
  const rows = transactionCatalogue([], [route('/api/org/inventory/stocktake/action'), route('/api/org/inv/issue/post')]);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  assert.equal(byCode.get('INV-CNT-PS').state, 'live');
  assert.ok(byCode.get('INV-CNT-PS').routes.includes('POST /api/org/inventory/stocktake/action'));
  assert.deepEqual(byCode.get('INV-GIS-PS').postings.map((p) => p.event).sort(), ['GI_CC', 'GI_WO']);
  assert.equal(byCode.get('FIN-APY-PS').postings[0].state, 'planned');
  assert.equal(byCode.get('FIN-APY-PS').state, 'reserved');
});
