/** Pure, vendor-neutral reference rate normalization and validation. */
export function parseProviderDate(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('FX rate date missing');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid FX rate date');
  return date.toISOString().slice(0, 10);
}

export function normalizeRates(payload, { source, fetchedAt = new Date().toISOString(),
  maxAgeDays = 5, requireCurrencies = ['USD', 'KES', 'EUR'] } = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid provider response');
  if (payload.result && payload.result !== 'success') throw new Error('FX provider reported failure');
  const base = String(payload.base_code || payload.base || payload.base_currency || '');
  if (base !== 'USD') throw new Error('Reference rate source must use USD base');
  const raw = payload.rates || payload.conversion_rates || payload.data;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('FX rates missing');
  const date = parseProviderDate(payload.date || payload.time_last_update_utc || payload.updated_at);
  const asOf = new Date(date + 'T00:00:00.000Z');
  const now = new Date(fetchedAt);
  if (Number.isNaN(now.getTime()) || asOf.getTime() > now.getTime() + 86400000)
    throw new Error('Invalid FX fetch timestamp or future rate date');
  if (now.getTime() - asOf.getTime() > maxAgeDays * 86400000)
    throw new Error('FX source rates are stale');
  const rates = {};
  for (const [currency, value] of Object.entries(raw)) {
    if (!/^[A-Z]{3}$/.test(currency)) continue;
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Invalid ${currency} rate`);
    rates[currency] = rate;
  }
  // USD is exactly one; source values sometimes omit USD itself.
  rates.USD = 1;
  for (const code of requireCurrencies)
    if (!Number.isFinite(rates[code])) throw new Error(`Required ${code} rate missing`);
  if (Object.keys(rates).length < 10) throw new Error('Suspiciously small FX rate set');
  return {
    base: 'USD', effectiveDate: date, rates, source: source || 'configured-provider',
    fetchedAt, validation: 'accepted', rateCount: Object.keys(rates).length,
  };
}

/** USD-based cross rate; amount in fromCurrency -> toCurrency. */
export function crossRate(rates, fromCurrency, toCurrency) {
  const from = rates[fromCurrency], to = rates[toCurrency];
  if (!(from > 0) || !(to > 0)) throw new Error('Currency not configured');
  return to / from;
}
