import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRates, crossRate } from '../src/rates.mjs';

const valid = (overrides = {}) => ({
  base: 'USD', date: '2026-10-16',
  rates: { USD: 1, KES: 130, EUR: .86, GBP: .74, ZAR: 17, TZS: 2400,
    UGX: 3700, RWF: 1430, CAD: 1.37, AUD: 1.5, CHF: .79 }, ...overrides,
});

test('accepts complete dated USD source and cross converts KES to EUR', () => {
  const result = normalizeRates(valid(), { fetchedAt: '2026-10-16T17:00:00Z' });
  assert.equal(result.rates.KES, 130);
  assert.equal(result.base, 'USD');
  assert.equal(result.effectiveDate, '2026-10-16');
  assert.ok(Math.abs(crossRate(result.rates, 'KES', 'EUR') - .86/130) < 1e-10);
});
test('rejects stale source', () => {
  assert.throws(() => normalizeRates(valid({ date: '2026-09-01' }),
    { fetchedAt: '2026-10-16T17:00:00Z' }), /stale/);
});
test('rejects invalid FX values', () => {
  assert.throws(() => normalizeRates(valid({ rates: { ...valid().rates, KES: -1 } }),
    { fetchedAt: '2026-10-16T17:00:00Z' }), /Invalid KES/);
});
test('rejects wrong base or missing required currency', () => {
  assert.throws(() => normalizeRates(valid({ base: 'EUR' }),
    { fetchedAt: '2026-10-16T17:00:00Z' }), /USD/);
  const rates = { ...valid().rates }; delete rates.KES;
  assert.throws(() => normalizeRates(valid({ rates }),
    { fetchedAt: '2026-10-16T17:00:00Z' }), /KES/);
});
