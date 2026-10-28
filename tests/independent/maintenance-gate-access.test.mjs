import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_LINKS, linkRouteToBlueprint, transactionCatalogue } from '../../backend/transactionCatalogue.ts';
import { areaDefinitions } from '../../backend/transactionBlueprints.ts';
import { MAINTENANCE_GATES } from '../../backend/maintenanceWorkflowConfig.ts';
import { GATE_KEYWORDS, gateFromMessage, suggestGateRoles } from '../../src/org/mntGateSuggest.ts';

const route = (path, permission = 'MNT.view') => ({ method: 'POST', path, name: path, permission, module: 'MNT', area: 'GEN', code: 'X', handlerWired: true, guard: 'organization', bindingStatus: 'system_bound', enforcement: 'authenticated_handler', activationCertified: false });

test('maintenance steps run through shared action routes are live with the permission each step enforces', () => {
  const rows = transactionCatalogue([], [route('/api/org/mnt/wr/action'), route('/api/org/mnt/wo/action'), route('/api/org/mnt/operations'), route('/api/org/mnt/siv/issue', 'INV.issue')]);
  const by = new Map(rows.map((r) => [r.code, r]));
  for (const [code, perm] of [['MNT-WRQ-AP', 'MNT.WR.convert'], ['MNT-WRQ-RJ', 'MNT.WR.decline'], ['MNT-WRQ-RT', 'MNT.WR.return'], ['MNT-ASS-AP', 'MNT.assessment.review'], ['MNT-WOR-CL', 'MNT.WO.close'], ['MNT-WOR-CN', 'MNT.WO.cancel'], ['MNT-WOR-RV', 'MNT.WO.reopen'], ['MNT-WOR-PS', 'INV.issue']]) {
    assert.equal(by.get(code).state, 'live', code);
    assert.ok(by.get(code).permissions.includes(perm), `${code} carries ${perm}`);
    assert.ok(!by.get(code).permissions.includes('MNT.view'), `${code}: opening the shared route is not the step's right`);
  }
  // A step whose route is not installed stays reserved.
  assert.equal(by.get('MNT-WRQ-CR').state, 'reserved');
  for (const links of Object.values(ACTION_LINKS)) for (const l of links) assert.match(l.route, /^POST \/api\/org\//);
});

test('stores issue vouchers, HR and corporate routes link to their transactions', () => {
  const cases = [
    ['/api/org/mnt/siv/issue', 'MNT-WOR-PS'], ['/api/org/mnt/siv/create', 'MNT-WOR-ED'], ['/api/org/mnt/siv/stores/cancel', 'MNT-WOR-ED'], ['/api/org/mnt/siv/list', 'MNT-WOR-VW'],
    ['/api/org/hr/employees/create', 'HRM-EMP-CR'], ['/api/org/hr/employees/access-check', 'HRM-EMP-VW'], ['/api/org/hr/leave/review', 'HRM-LEA-AP'],
    ['/api/org/hr/compensation/decide', 'HRM-CMP-AP'], ['/api/org/hr/access-rules/review', 'HRM-RUL-AP'], ['/api/org/hr/skills/decide', 'HRM-SKL-AP'],
    ['/api/org/corporate/budget/get', 'FIN-BUD-VW'], ['/api/org/corporate/ic/agreements/accept', 'FIN-ICO-AP'],
  ];
  for (const [path, code] of cases) {
    const link = linkRouteToBlueprint({ path });
    assert.ok(link, path);
    assert.equal(`${link.module}-${link.area}-${link.action}`, code, path);
  }
  const hr = areaDefinitions().filter((d) => d.module === 'HRM').map((d) => d.area);
  assert.ok(hr.includes('CMP') && hr.includes('RUL'));
});

test('gate suggestions fill only unconfigured, role-required gates, from job role titles', () => {
  const gates = MAINTENANCE_GATES.map((g) => ({ code: g.code, roleRequired: !!GATE_KEYWORDS[g.code] }));
  const jobRoles = [{ id: 'P1', label: 'Maintenance Planner' }, { id: 'P2', label: 'Maintenance Supervisor' }, { id: 'P3', label: 'SHEQ Officer' }, { id: 'P4', label: 'Technical Manager' }, { id: 'P5', label: 'Receptionist' }];
  const picks = suggestGateRoles(gates, jobRoles, { 'MNT.WO.PLAN': 'P2' });
  assert.equal(picks['MNT.WR.CONVERT'], 'P1');
  assert.equal(picks['MNT.WO.PLAN'], undefined, 'configured gates are left alone');
  assert.equal(picks['MNT.SAFETY.SIGNOFF'], 'P3');
  assert.equal(picks['MNT.WO.TECHNICAL_CLOSE'], 'P4');
  assert.ok(!Object.values(picks).includes('P5'));
  assert.equal(picks['MNT.WR.CREATE'], undefined);
  for (const code of Object.keys(GATE_KEYWORDS)) assert.ok(MAINTENANCE_GATES.some((g) => g.code === code), code);
});

test('gate errors are recognised so the screen can point to Maintenance Workflows', () => {
  assert.deepEqual(gateFromMessage('Configure MNT.WR.CONVERT in Maintenance Workflows before proceeding.'), { gate: 'MNT.WR.CONVERT', kind: 'unconfigured' });
  assert.deepEqual(gateFromMessage('The configured MNT.WO.TECHNICAL_CLOSE organizational job role is required at this location.'), { gate: 'MNT.WO.TECHNICAL_CLOSE', kind: 'not_held' });
  assert.equal(gateFromMessage('Something else failed.'), null);
});
