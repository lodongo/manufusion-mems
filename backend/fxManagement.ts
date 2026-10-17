import { HttpError, getDoc, nowIso, num, orderDesc, runQuery, str, writeDoc, type Plain } from './core';
import { staff } from './guards';
import { audit } from './audit';
import { FX_PROVIDERS, settingsOf, type Provider, type FxSettings } from './fxSettings';
import { runFxNow } from './automationEngine';

export { FX_PROVIDERS, settingsOf, type Provider, type FxSettings } from './fxSettings';

async function latest() {
    const [config, currencies, history, schedule] = await Promise.all([
        getDoc('system/fx_config'), getDoc('reference/currencies'),
        runQuery({ from: [{ collectionId: 'fx_snapshots' }], orderBy: orderDesc('capturedAt'), limit: 550 }),
        getDoc('system/fx_schedule_state'),
    ]);
    const settings = settingsOf(config);
    const rows = Array.isArray(currencies?.data.items) ? currencies.data.items as Plain[] : [];
    const catalog = rows.filter((x) => !!x && typeof x === 'object' && !Array.isArray(x)).map((value) => {
        const c = value as Record<string, Plain>;
        return { code: str(c.code), name: str(c.name), unitsPerUsd: num(c.unitsPerUsd),
            usdPerUnit: num(c.usdPerUnit), rateSource: str(c.rateSource) || str(currencies?.data.ratesSource),
            rateObservedAt: str(c.rateObservedAt) || str(currencies?.data.ratesUpdatedAt) };
    }).filter((x) => /^[A-Z]{3}$/.test(x.code)).sort((a,b) => a.code.localeCompare(b.code));
    const kes = catalog.find((c) => c.code === 'KES');
    const usdKes = kes?.unitsPerUsd ?? null;
    return {
        settings, providers: FX_PROVIDERS,
        rates: { usdKes, kesUsd: usdKes && usdKes > 0 ? 1 / usdKes : null,
            providerObservedAt: str(currencies?.data.ratesUpdatedAt), source: str(currencies?.data.ratesSource) },
        currencies: catalog,
        coverage: currencies?.data.ratesCoverage || null,
        history: history.map((r) => {
            const raw = r.data.rates;
            const quotes = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, Plain> : {};
            return {
                capturedAt: str(r.data.capturedAt), observedAt: str(r.data.observedAt),
                provider: str(r.data.provider), usdKes: num(r.data.usdKes),
                kesUsd: num(r.data.kesUsd), rates: quotes,
                matched: num(r.data.matched), changed: num(r.data.changed),
            };
        }),
        scheduler: {
            status: str(schedule?.data.lastVerifiedHeartbeatAt) ? 'heartbeat_seen' : 'configuration_saved_only',
            lastReceivedAt: str(schedule?.data.lastVerifiedHeartbeatAt),
            lastCompletedAt: str(schedule?.data.lastCompletedAt),
            lastError: str(schedule?.data.lastError),
            notes: 'One reusable Cloud Scheduler heartbeat executes every enabled MEMS automation. Its connection can be managed in Automation Center.',
        },
    };
}

export const fxManagementRoutes = {
    'POST /api/admin/fx/status': [staff('admin.fx.status', 'super', async () => latest())],
    'POST /api/admin/fx/config': [staff('admin.fx.config', 'super', async (ctx) => {
        const provider = str(ctx.body.provider) as Provider;
        const frequency = str(ctx.body.frequency);
        const timeUtc = str(ctx.body.timeUtc);
        const weekday = Number(ctx.body.weekday ?? 1);
        if (!FX_PROVIDERS.some((p) => p.id === provider)) throw new HttpError(400, 'Select a supported exchange-rate provider.');
        if (!['hourly','three_hourly','six_hourly','daily','weekly'].includes(frequency)) throw new HttpError(400, 'Select a valid frequency.');
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeUtc)) throw new HttpError(400, 'Enter a valid UTC time (HH:MM).');
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(400, 'Select a valid weekday.');
        const settings: FxSettings = { provider, frequency: frequency as FxSettings['frequency'],
            timeUtc, weekday, enabled: ctx.body.enabled === true };
        await writeDoc('system/fx_config', { ...settings, updatedAt: nowIso(), updatedBy: ctx.actor.email });
        await audit([{ category: 'admin', action: 'fx.config.saved', actor: ctx.actor, meta: ctx.meta, details: JSON.stringify(settings) }]);
        return { ...settings, schedulerConfiguredSeparately: true };
    })],
    'POST /api/admin/fx/refresh': [staff('admin.fx.refresh', 'super', async (ctx) => {
        const result = await runFxNow();
        await audit([{ category: 'admin', action: 'fx.world_rates.manual', actor: ctx.actor, meta: ctx.meta,
            details: `Updated ${result.matched}/${result.total} currency quotes using ${result.provider}` }]);
        return { ok: true, ...result };
    })],
};
