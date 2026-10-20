import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyOverrides, defaultHandlers, removedCodes, validateOverrides } from '../../backend/glTransactionMap.ts';
import { plannedTransactionBlueprints } from '../../backend/transactionBlueprints.ts';
import { BUILT_PERMISSIONS, ROLE_TEMPLATES, SOD_RULES } from '../../backend/permissionPolicy.ts';

const master = JSON.parse(fs.readFileSync(new URL('../fixtures/gl-master-v2-accounts.json', import.meta.url), 'utf8'));
const codes = new Set(plannedTransactionBlueprints().map((b) => b.code));
const automaticOnly = (a) => !/^manual/i.test(a.postingMode);

test('every account of the MEMS GL master v2 has a handling transaction from the catalogue', () => {
  assert.equal(master.accounts.length, 1799);
  for (const a of master.accounts) {
    const hs = defaultHandlers(a);
    assert.ok(hs.length > 0, `${a.code} ${a.name} has no transaction`);
    assert.equal(new Set(hs.map((h) => h.code)).size, hs.length, `${a.code} lists a transaction twice`);
    for (const h of hs) {
      assert.ok(codes.has(h.code), `${a.code} refers to unknown transaction ${h.code}`);
      assert.ok(['Dr', 'Cr', 'Dr/Cr'].includes(h.side));
    }
  }
});

test('automatic-only accounts belong to their run or subledger; manual accounts also take a journal', () => {
  for (const a of master.accounts) {
    const hs = defaultHandlers(a).map((h) => h.code);
    if (automaticOnly(a)) {
      assert.ok(!hs.includes('FIN-JRN-PS'), `${a.code} (${a.postingMode}) must not be open to manual journals`);
      assert.ok(hs.length > 0);
    } else {
      assert.ok(hs.includes('FIN-JRN-PS'), `${a.code} is open to manual posting`);
    }
  }
});

test('handlers follow the account: subledger, inventory, maintenance, purchased services, memorandum, closing', () => {
  const pick = (pred) => master.accounts.find(pred);
  const codesOf = (a) => defaultHandlers(a).map((h) => h.code);
  const vendor = pick((a) => a.properties?.['Reconciled to'] === 'Vendor' && a.categoryCode === '201');
  if (vendor) assert.ok(codesOf(vendor).includes('FIN-APY-PS'));
  const stock = pick((a) => a.categoryCode === '103' && /inventory movements/i.test(a.postingMode));
  for (const c of ['PRC-GRN-GR', 'INV-GIS-PS', 'INV-CNT-PS', 'FIN-OPN-PS']) assert.ok(codesOf(stock).includes(c), c);
  assert.ok(codesOf(pick((a) => a.categoryCode === '612')).includes('MNT-WOR-PS'));
  assert.ok(codesOf(pick((a) => a.categoryCode === '619')).includes('PRC-SVC-AC'));
  assert.deepEqual(codesOf(pick((a) => /^memorandum/i.test(a.postingMode))), ['FIN-MEM-PS']);
  assert.ok(codesOf(pick((a) => /closing programme/i.test(a.postingMode))).includes('FIN-CLS-LK'));
  const payroll = pick((a) => a.properties?.['Reconciled to'] === 'Payroll' && automaticOnly(a));
  if (payroll) assert.ok(codesOf(payroll).includes('PAY-RUN-PS'));
});

test('MEMS and legal entity changes layer in order; explicit removals are what posting enforces', () => {
  const base = [{ code: 'FIN-JRN-PS', side: 'Dr/Cr' }, { code: 'PRC-SVC-AC', side: 'Dr' }];
  const mems = { '6100': { add: [{ code: 'FIN-EXP-AP', side: 'Dr' }], remove: ['FIN-JRN-PS'] } };
  const le = { '6100': { add: [{ code: 'FIN-JRN-PS', side: 'Dr' }], remove: ['PRC-SVC-AC'] } };
  assert.deepEqual(applyOverrides(base, mems['6100'], le['6100']).map((h) => `${h.code} ${h.side}`), ['FIN-EXP-AP Dr', 'FIN-JRN-PS Dr']);
  assert.deepEqual([...removedCodes('6100', mems, le)].sort(), ['PRC-SVC-AC']);
  assert.deepEqual([...removedCodes('6100', mems)], ['FIN-JRN-PS']);
  assert.equal(removedCodes('9999', mems, le).size, 0);
});

test('proposed changes are validated: known accounts, catalogue codes, a side for every addition', () => {
  const known = new Set(['FIN-JRN-PS', 'PRC-SVC-AC']);
  const accounts = new Set(['6100']);
  assert.deepEqual(validateOverrides({ 6100: { add: [{ code: 'PRC-SVC-AC', side: 'Dr' }], remove: ['FIN-JRN-PS'] } }, known, accounts), { 6100: { add: [{ code: 'PRC-SVC-AC', side: 'Dr' }], remove: ['FIN-JRN-PS'] } });
  assert.throws(() => validateOverrides({ 7777: { add: [], remove: ['FIN-JRN-PS'] } }, known, accounts), /not in the chart/);
  assert.throws(() => validateOverrides({ 6100: { add: [{ code: 'XYZ-ABC-PS', side: 'Dr' }] } }, known, accounts), /not a MEMS transaction/);
  assert.throws(() => validateOverrides({ 6100: { add: [{ code: 'PRC-SVC-AC', side: 'up' }] } }, known, accounts), /debit, credit or both/);
  assert.deepEqual(validateOverrides({ 6100: { add: [], remove: [] } }, known, accounts), {});
});

test('GL account transactions have their own maker-checker rights, segregation and role templates', () => {
  const fin = BUILT_PERMISSIONS.FIN.map((p) => p.key);
  assert.ok(fin.includes('FIN.gltxn.manage') && fin.includes('FIN.gltxn.approve'));
  assert.ok(SOD_RULES.some((r) => r.a === 'FIN.gltxn.manage' && r.b === 'FIN.gltxn.approve'));
  assert.ok(ROLE_TEMPLATES.find((t) => t.id === 'fin_mapping_officer').permissions.includes('FIN.gltxn.manage'));
  assert.ok(ROLE_TEMPLATES.find((t) => t.id === 'fin_mapping_approver').permissions.includes('FIN.gltxn.approve'));
  assert.ok(!ROLE_TEMPLATES.find((t) => t.id === 'fin_mapping_officer').permissions.includes('FIN.gltxn.approve'));
});

test('the posting engine enforces approved removals and cost center switch-offs; MEMS changes need a super admin', () => {
  const core = fs.readFileSync(new URL('../../backend/finCore.ts', import.meta.url), 'utf8');
  assert.match(core, /glTxnRemovals\(orgId, input\.leId\)/);
  assert.match(core, /txnCodes\.every\(\(c\) => removed\.has\(c\)\)/);
  assert.match(core, /txnCodes\.every\(\(c\) => f\.txnOff\.includes\(c\)\)/);
  const routes = fs.readFileSync(new URL('../../backend/glTransactionRoutes.ts', import.meta.url), 'utf8');
  assert.match(routes, /staff\('admin\.fin\.gltxn\.save', 'super'/);
  assert.match(routes, /approvePerm: 'FIN\.gltxn\.approve'/);
  assert.match(routes, /e\.may\('FIN\.gltxn\.manage'\)/);
  assert.match(routes, /orgRoute\('org\.transactions\.access\.save', 'ADM\.roles'/);
  assert.match(routes, /await audit\(/);
  assert.match(routes, /await record\(ctx, 'org\.transactions\.access\.preassign'/);
});

import { linkRouteToBlueprint } from '../../backend/transactionCatalogue.ts';

test('GL account transaction and transaction access routes sit in the right module and submodule', () => {
  for (const [path, code] of [
    ['/api/org/fin/gltxn/get', 'FIN-GTX-VW'], ['/api/org/fin/gltxn/propose', 'FIN-GTX-SB'],
    ['/api/org/transactions/access/list', 'ADM-SEC-VW'], ['/api/org/transactions/access/save', 'ADM-SEC-ED'],
    ['/api/admin/fin/gltxn/list', 'PLT-FNM-VW'], ['/api/admin/fin/gltxn/save', 'PLT-FNM-ED'],
  ]) {
    const l = linkRouteToBlueprint({ path });
    assert.equal(l && `${l.module}-${l.area}-${l.action}`, code, path);
  }
});
