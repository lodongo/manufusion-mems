import { normalizeRates } from './rates.mjs';
import { persistRates } from './firestore.mjs';

export async function refreshDailyFx({
  providerUrl = process.env.FX_PROVIDER_URL,
  providerName = process.env.FX_PROVIDER_NAME || 'reference-provider',
} = {}) {
  if (!providerUrl) throw new Error('FX_PROVIDER_URL not configured');
  const parsed = new URL(providerUrl);
  if (parsed.protocol !== 'https:') throw new Error('FX source must use HTTPS');
  const response = await fetch(parsed, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('FX provider returned HTTP ' + response.status);
  const payload = await response.json();
  const rates = normalizeRates(payload, { source: providerName });
  return await persistRates(rates);
}
