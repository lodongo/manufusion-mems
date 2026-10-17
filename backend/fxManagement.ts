import { HttpError, getDoc, listDocs, nowIso, num, randomId, runQuery, orderDesc, str, writeDoc, type Doc, type Plain } from './core';
import { staff } from './guards';
import { audit } from './audit';

const CONFIG_PATH = 'system/fx_config';
const RATES_PATH = 'reference/currencies';
const HISTORY = 'fx_snapshots';

export const FX_PROVIDERS = [
    { id: 'open_er_api', label: 'ExchangeRate-API open data', apiKeyRequired: false, cadence: 'Daily', notes: 'Free published observations; more frequent polling cannot create intraday market changes.' },
    { id: 'currencyapi', label: 'CurrencyAPI', apiKeyRequired: true, cadence: 'Depends on plan', notes: 'Requires MEMS_FX_PROVIDER_API_KEY in Cloud Run Secret Manager.' },
    { id: 'exchange_rate_api', label: 'ExchangeRate-API paid', apiKeyRequired: true, cadence: 'Depends on plan', notes: 'Requires MEMS_FX_PROVIDER_API_KEY in Cloud Run Secret Manager.' },
] as const;

export type Provider = typeof FX_PROVIDERS[number]['id'];
type Frequency = 'hourly' | 'three_hourly' | 'six_hourly' | 'daily' | 'weekly';
export interface FxSettings {
    provider: Provider;
    enabled: boolean;
    frequency: Frequency;
    timeUtc: string;
    weekday: number;
}

const DEFAULT_CONFIG: FxSettings = {
    provider: 'open_er_api', enabled: false, frequency: 'daily', timeUtc: '06:00', weekday: 1,
};

export function settingsOf(d: Doc | null): FxSettings {
    const x = d?.data || {};
    return {
        provider: FX_PROVIDERS.some((p) => p.id === x.provider) ? x.provider as Provider : DEFAULT_CONFIG.provider,
        enabled: x.enabled === true,
        frequency: ['hourly', 'three_hourly', 'six_hourly', 'daily', 'weekly'].includes(str(x.frequency)) ? x.frequency as Frequency : DEFAULT_CONFIG.frequency,
        timeUtc: /^([01]\d|2[0-3]):[0-5]\d$/.test(str(x.timeUtc)) ? str(x.timeUtc) : DEFAULT_CONFIG.timeUtc,
        weekday: Number.isInteger(x.weekday) && Number(x.weekday) >= 0 && Number(x.weekday) <= 6 ? Number(x.weekday) : DEFAULT_CONFIG.weekday,
    };
}

export async function getLive(provider: Provider): Promise<{ usdKes: number; at: string; nextUpdate: string }> {
    const key = str(process.env.MEMS_FX_PROVIDER_API_KEY);
    let url = '';
    if (provider === 'open_er_api') url = 'https://open.er-api.com/v6/latest/USD';
    else if (provider === 'currencyapi') {
        if (!key) throw new HttpError(503, 'CurrencyAPI requires a server-side provider key from Secret Manager.');
        url = `https://api.currencyapi.com/v3/latest?apikey=${encodeURIComponent(key)}&base_currency=USD&currencies=KES`;
    } else {
        if (!key) throw new HttpError(503, 'ExchangeRate-API paid requires a server-side provider key from Secret Manager.');
        url = `https://v6.exchangerate-api.com/v6/${encodeURIComponent(key)}/latest/USD`;
    }
    const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!resp.ok) throw new HttpError(502, `Exchange-rate provider unavailable (HTTP ${resp.status}).`);
    const d = (await resp.json()) as Record<string, any>;
    if (provider === 'open_er_api' && d.result !== 'success') throw new HttpError(502, 'The rate provider returned an error.');
    const raw = provider === 'currencyapi' ? d.data?.KES?.value : d.rates?.KES ?? d.conversion_rates?.KES;
    const usdKes = Number(raw);
    if (!Number.isFinite(usdKes) || usdKes <= 0 || usdKes > 10000) throw new HttpError(502, 'The provider did not return a valid USD/KES rate.');
    const observed = provider === 'currencyapi' ? d.meta?.last_updated_at : d.time_last_update_utc;
    const time = Date.parse(str(observed));
    return {
        usdKes,
        at: Number.isFinite(time) ? new Date(time).toISOString() : nowIso(),
        nextUpdate: str(d.time_next_update_utc),
    };
}

async function latest() {
    const [config, currencies, history, schedule] = await Promise.all([
        getDoc(CONFIG_PATH),
        getDoc(RATES_PATH),
        runQuery({ from: [{ collectionId: HISTORY }], orderBy: orderDesc('capturedAt'), limit: 550 }),
        getDoc('system/fx_schedule_state'),
    ]);
    const settings = settingsOf(config);
    const rows = Array.isArray(currencies?.data.items) ? (currencies?.data.items as Plain[]) : [];
    const kes = rows.find((c) => typeof c === 'object' && c !== null && !Array.isArray(c) && c.code === 'KES') as Record<string, unknown> | undefined;
    const usdKes = num(kes?.unitsPerUsd);
    return {
        settings, providers: FX_PROVIDERS, rates: {
            usdKes, kesUsd: usdKes && usdKes > 0 ? 1 / usdKes : null,
            providerObservedAt: str(currencies?.data.ratesUpdatedAt), source: str(currencies?.data.ratesSource),
        },
        history: history.map((r) => ({
            capturedAt: str(r.data.capturedAt),
            observedAt: str(r.data.observedAt),
            usdKes: num(r.data.usdKes), kesUsd: num(r.data.kesUsd),
            provider: str(r.data.provider),
        })).filter((r) => r.usdKes !== null),
        scheduler: {
            status: str(schedule?.data.lastReceivedAt) ? 'oidc_schedule_connected' : 'configuration_saved_only',
            notes: str(schedule?.data.lastReceivedAt) ? 'Verified Cloud Scheduler requests have reached MEMS.' : 'Provision a Cloud Scheduler HTTP job with a verified OIDC service identity to activate unattended refresh.',
            lastReceivedAt: str(schedule?.data.lastReceivedAt),
            lastCompletedAt: str(schedule?.data.lastCompletedAt),
            lastError: str(schedule?.data.lastError),
        },
    };
}

export const fxManagementRoutes = {
    'POST /api/admin/fx/status': [staff('admin.fx.status', 'super', async () => latest())],

    'POST /api/admin/fx/config': [staff('admin.fx.config', 'super', async (ctx) => {
        const provider = str(ctx.body.provider) as Provider;
        const frequency = str(ctx.body.frequency) as Frequency;
        const timeUtc = str(ctx.body.timeUtc);
        const weekday = Number(ctx.body.weekday ?? 1);
        if (!FX_PROVIDERS.some((p) => p.id === provider)) throw new HttpError(400, 'Select a supported exchange-rate provider.');
        if (!['hourly', 'three_hourly', 'six_hourly', 'daily', 'weekly'].includes(frequency)) throw new HttpError(400, 'Select a supported update interval.');
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeUtc)) throw new HttpError(400, 'Enter a valid time in UTC (HH:MM).');
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(400, 'Select a valid weekday.');
        const settings: FxSettings = { provider, frequency, timeUtc, weekday, enabled: ctx.body.enabled === true };
        await writeDoc(CONFIG_PATH, { ...settings, updatedAt: nowIso(), updatedBy: ctx.actor.email });
        await audit([{ category: 'admin', action: 'fx.config.saved', actor: ctx.actor, meta: ctx.meta, details: JSON.stringify(settings) }]);
        return { ...settings, schedulerActivated: false };
    })],

    'POST /api/admin/fx/refresh': [staff('admin.fx.refresh', 'super', async (ctx) => {
        const config = settingsOf(await getDoc(CONFIG_PATH));
        const snapshot = await getLive(config.provider);
        const doc = await getDoc(RATES_PATH);
        if (!doc) throw new HttpError(400, 'Load the currency defaults before refreshing exchange rates.');
        const items = Array.isArray(doc.data.items) ? doc.data.items as Plain[] : [];
        const oldKes = items.find((v) => typeof v === 'object' && v !== null && !Array.isArray(v) && v.code === 'KES') as Record<string, unknown> | undefined;
        const old = num(oldKes?.unitsPerUsd);
        const updated = items.map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
            if (item.code !== 'KES') return item;
            return { ...item, unitsPerUsd: snapshot.usdKes, usdPerUnit: 1 / snapshot.usdKes };
        });
        if (!oldKes) throw new HttpError(400, 'KES is missing from the loaded world currency catalogue.');
        await writeDoc(RATES_PATH, {
            ...doc.data, items: updated, ratesUpdatedAt: snapshot.at,
            ratesLastCheckedAt: nowIso(), ratesSource: config.provider,
        });
        const capturedAt = nowIso();
        await writeDoc(`${HISTORY}/${capturedAt.replace(/[^0-9]/g, '')}_${randomId(4)}`, {
            capturedAt, observedAt: snapshot.at, provider: config.provider,
            usdKes: snapshot.usdKes, kesUsd: 1 / snapshot.usdKes, oldUsdKes: old,
            change: old ? snapshot.usdKes - old : null, nextUpdate: snapshot.nextUpdate,
            updatedBy: ctx.actor.email,
        }, { exists: false });
        await audit([{ category: 'admin', action: 'fx.rates.refresh', actor: ctx.actor, meta: ctx.meta, details: `USD/KES ${snapshot.usdKes} (${config.provider}; published ${snapshot.at})` }]);
        return { ok: true, ...snapshot, previous: old };
    })],
};
