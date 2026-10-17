import test from 'node:test';
import assert from 'node:assert/strict';
import { observedPairRate, observedUnitsPerUsd, formatFxRate } from '../../src/admin/fxPair.ts';

test('selecting USD/KES and swapping to KES/USD uses true reciprocal quotes', () => {
    const snapshot = { rates: { USD: 1, KES: 129.7876, EUR: 0.92, JPY: 151.0 } };
    const usdKes = observedPairRate(snapshot, 'USD', 'KES');
    const kesUsd = observedPairRate(snapshot, 'KES', 'USD');
    assert.equal(usdKes, 129.7876);
    assert.ok(Math.abs((usdKes ?? 0) * (kesUsd ?? 0) - 1) < 1e-12);
    assert.ok((kesUsd ?? 0) > 0 && (kesUsd ?? 0) < 0.01);
});

test('historical trend for the same observation supports other currency pairs', () => {
    const snapshot = { rates: { USD: 1, KES: 130, EUR: 0.8 } };
    assert.equal(observedPairRate(snapshot, 'EUR', 'KES'), 162.5);
    assert.equal(observedPairRate(snapshot, 'KES', 'EUR'), 1/162.5);
});

test('never invent a missing quote from an unrelated date or currency', () => {
    assert.equal(observedPairRate({rates:{ USD:1, KES:130 }}, 'EUR','KES'), null);
    assert.equal(observedPairRate({rates:{ USD:1 }}, 'USD', 'KES'), null);
    assert.equal(observedUnitsPerUsd({rates:{ KES:0 }}, 'KES'), null);
});

test('legacy USD-KES observations are reversible even before historic global snapshots', () => {
    const snapshot = { usdKes: 127.5, kesUsd: 1/127.5 };
    assert.equal(observedPairRate(snapshot, 'USD', 'KES'),127.5);
    assert.equal(observedPairRate(snapshot, 'KES', 'USD'),1/127.5);
    assert.equal(observedPairRate(snapshot, 'USD', 'GBP'),null);
    assert.equal(formatFxRate(null),'Unavailable');
});
