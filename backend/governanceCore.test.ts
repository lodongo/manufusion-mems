import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateAuthority, quorumCount, type GovernanceRule } from './governanceCore';

const band = (id: string, level: number, maxAmount?: number, minAmount?: number): GovernanceRule => ({
  id, enabled: true, mandatory: true, type: 'minimum_level', stream: 'FINANCIAL', level,
  currency: 'KES', minAmount, maxAmount,
});

test('KES 50,000 requires level 1 only', () => {
  const result = evaluateAuthority([band('L1', 1, 100000), band('L2', 2, 500000, 100001)], { amount: 50000, currency: 'KES' });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.requirements.map(x => x.level), [1]);
});

test('higher matched minimum activates all lower levels', () => {
  const result = evaluateAuthority([band('L3', 3, 2000000, 500001)], { amount: 750000, currency: 'KES' });
  assert.deepEqual(result.requirements.map(x => x.level), [1, 2, 3]);
});

test('specialist stream combines with financial approvals', () => {
  const result = evaluateAuthority([
    band('L1', 1, 100000),
    { id: 'safety', enabled: true, mandatory: true, stream: 'SAFETY', type: 'specialist', level: 1, specialistKey: 'safety_manager', conditions: { highRisk: true } },
  ], { amount: 50000, currency: 'KES', facts: { highRisk: true } });
  assert.equal(result.allowed, true);
  assert.equal(result.requirements.length, 2);
});

test('missing applicable rule blocks', () => {
  assert.equal(evaluateAuthority([], { amount: 1, currency: 'KES' }).allowed, false);
});

test('missing FX normalization blocks rather than treating amount as local', () => {
  const result = evaluateAuthority([band('L1', 1, 100000)], { amount: 50000, currency: 'USD' });
  assert.equal(result.allowed, false);
});

test('quorum fixed number and percentage', () => {
  assert.equal(quorumCount({ mode: 'count', value: 2 }, 5), 2);
  assert.equal(quorumCount({ mode: 'percent', value: 60 }, 5), 3);
  assert.equal(quorumCount({ mode: 'any' }, 5), 1);
  assert.equal(quorumCount({ mode: 'all' }, 5), 5);
  assert.throws(() => quorumCount({ mode: 'count', value: 0 }, 5));
});

test('vacant approver groups and impossible quorums block approval', () => {
  assert.throws(() => quorumCount({ mode: 'all' }, 0));
  assert.throws(() => quorumCount({ mode: 'any' }, 0));
  assert.throws(() => quorumCount({ mode: 'count', value: 3 }, 2));
});
