import { getDoc, nowIso, num, randomId, str, writeDoc, type Plain } from './core';
import { HttpError } from './core';

export type FxProvider = 'open_er_api' | 'currencyapi' | 'exchange_rate_api';
export type Quote = { provider: FxProvider; publishedAt: string; fetchedAt: string; nextUpdate: string; rates: Record<string, number> };
const PATH = 'reference/currencies';
const HISTORY = 'fx_snapshots';
const MAX_RATE = 1e12;

function normalizeRates(values: unknown): Record<string, number> {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new HttpError(502, 'Provider returned no currency-rate catalogue.');
    const clean: Record<string, number> = { USD: 1 };
    for (const [key, raw] of Object.entries(values)) {
        const code = key.toUpperCase();
        const amount = typeof raw === 'object' && raw !== null ? Number((raw as { value?: unknown }).value) : Number(raw);
        if (/^[A-Z]{3}$/.test(code) && Number.isFinite(amount) && amount > 0 && amount < MAX_RATE) clean[code] = amount;
    }
    // An unexpectedly tiny response suggests a wrong API plan or invalid upstream payload.
    if (Object.keys(clean).length < 20) throw new HttpError(502, 'Provider returned too few currencies. No existing rates were changed.');
    return clean;
}

export async function fetchAllUsdRates(provider: FxProvider): Promise<Quote> {
    const secret = str(process.env.MEMS_FX_PROVIDER_API_KEY);
    let url: string;
    if (provider === 'open_er_api') url = 'https://open.er-api.com/v6/latest/USD';
    else if (provider === 'currencyapi') {
        if (!secret) throw new HttpError(503, 'CurrencyAPI key is not configured in the server.');
        url = 'https://api.currencyapi.com/v3/latest?base_currency=USD';
    } else if (provider === 'exchange_rate_api') {
        if (!secret) throw new HttpError(503, 'ExchangeRate-API key is not configured in the server.');
        url = `https://v6.exchangerate-api.com/v6/${encodeURIComponent(secret)}/latest/USD`;
    } else throw new HttpError(400, 'Unsupported exchange-rate provider.');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (provider === 'currencyapi') headers.apikey = secret;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(18000) });
    if (!response.ok) throw new HttpError(502, `Exchange-rate provider returned HTTP ${response.status}; existing values were kept.`);
    const payload = await response.json() as Record<string, unknown>;
    if ((provider === 'open_er_api' || provider === 'exchange_rate_api') && payload.result !== 'success') {
        throw new HttpError(502, 'Rate provider rejected the request. Existing rates were preserved.');
    }
    const raw = provider === 'currencyapi' ? payload.data : provider === 'exchange_rate_api' ? payload.conversion_rates : payload.rates;
    const rates = normalizeRates(raw);
    const published = str(provider === 'currencyapi' ? (payload.meta as Record<string, unknown> | undefined)?.last_updated_at : payload.time_last_update_utc);
    const parsed = Date.parse(published);
    return {
        provider, rates, fetchedAt: nowIso(),
        publishedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : '',
        nextUpdate: str(payload.time_next_update_utc),
    };
}

export interface RefreshResult {
    success: boolean; provider: FxProvider; providerPublishedAt: string; fetchedAt: string;
    matched: number; changed: number; unavailable: string[]; total: number;
    usdKes: number | null; kesUsd: number | null; historyRecorded: boolean;
}

export async function refreshCurrencyCatalogue(provider: FxProvider, actor = 'automation'): Promise<RefreshResult> {
    // Fetch first. Never damage uploaded rates because of an upstream outage.
    const quote = await fetchAllUsdRates(provider);
    const current = await getDoc(PATH);
    if (!current) throw new HttpError(400, 'Load the currency reference catalogue before refreshing exchange rates.');
    const values = Array.isArray(current.data.items) ? current.data.items as Plain[] : [];
    if (!values.length) throw new HttpError(400, 'There are no uploaded currency records to update.');
    let matched = 0, changed = 0;
    const unavailable: string[] = [];
    const updated = values.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
        const item = value as Record<string, Plain>;
        const code = str(item.code).toUpperCase();
        const unitsPerUsd = quote.rates[code];
        if (!Number.isFinite(unitsPerUsd) || unitsPerUsd <= 0) {
            if (/^[A-Z]{3}$/.test(code)) unavailable.push(code);
            return value; // unsupported: preserve old rate and its original provenance
        }
        matched++;
        const was = num(item.unitsPerUsd);
        if (was === null || Math.abs(was - unitsPerUsd) > Math.max(1e-12, Math.abs(was) * 1e-10)) changed++;
        return {
            ...item, unitsPerUsd, usdPerUnit: 1 / unitsPerUsd,
            rateSource: provider, rateObservedAt: quote.publishedAt || quote.fetchedAt,
            rateCheckedAt: quote.fetchedAt,
        } as Plain;
    });
    if (!matched) throw new HttpError(502, 'Provider does not cover any uploaded currencies. The catalogue was not modified.');
    // Guard against a partial upstream payload wiping out a previously near-complete catalogue.
    const totalCodes = values.filter((x) => x && typeof x === 'object' && !Array.isArray(x) && /^[A-Z]{3}$/.test(str(x.code))).length;
    if (totalCodes >= 30 && matched / totalCodes < 0.6) {
        throw new HttpError(502, `Only ${matched} of ${totalCodes} currencies matched the provider. No changes were applied.`);
    }
    const rateDates = { ratesUpdatedAt: quote.publishedAt || quote.fetchedAt,
        ratesLastCheckedAt: quote.fetchedAt, ratesSource: provider,
        ratesCoverage: { matched, total: values.length, unsupported: unavailable.length } };
    await writeDoc(PATH, { ...current.data, items: updated, ...rateDates });
    const kes = quote.rates.KES ?? null;
    const signature = Object.keys(quote.rates).sort().map((code) => code + ':' + quote.rates[code]).join('|');
    // Same published data should never masquerade as new movement; deduplicate by provider and content.
    const last = await getDoc('system/fx_last_snapshot');
    const unchanged = str(last?.data.signature) === signature && str(last?.data.provider) === provider;
    if (!unchanged) {
        const capturedAt = quote.fetchedAt;
        const stored = Object.fromEntries(Object.entries(quote.rates).filter(([c]) => updated.some((x) => x && typeof x === 'object' && !Array.isArray(x) && x.code === c)));
        await writeDoc(`${HISTORY}/${capturedAt.replace(/[^0-9]/g, '')}_${randomId(4)}`, {
            capturedAt, observedAt: quote.publishedAt || capturedAt, provider, rates: stored,
            usdKes: kes, kesUsd: kes ? 1 / kes : null, mode: actor,
            matched, changed, unsupportedCount: unavailable.length,
        }, { exists: false });
        await writeDoc('system/fx_last_snapshot', { signature, provider, updatedAt: capturedAt });
    }
    return { success: true, provider, providerPublishedAt: quote.publishedAt,
        fetchedAt: quote.fetchedAt, matched, changed, unavailable,
        total: values.length, usdKes: kes, kesUsd: kes ? 1 / kes : null, historyRecorded: !unchanged };
}

export function convertAmount(amount: number, from: string, to: string, unitsPerUsd: Record<string, number>): number | null {
    const a = unitsPerUsd[from.toUpperCase()], b = unitsPerUsd[to.toUpperCase()];
    if (!Number.isFinite(amount) || !a || !b || a <= 0 || b <= 0) return null;
    return amount / a * b;
}
