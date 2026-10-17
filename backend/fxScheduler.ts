import { OAuth2Client } from 'google-auth-library';
import { json, error } from './platform/sdk';
import { PROJECT_ID, getDoc, nowIso, num, randomId, str, writeDoc, type Plain } from './core';
import { audit } from './audit';
import { getLive, settingsOf, type FxSettings } from './fxManagement';

// This endpoint is public at the Cloud Run IAM layer, but requires a valid Google
// OIDC identity token whose issuer, audience AND service-account email are verified.
// The scheduler identity holds no database permissions; all writes occur in MEMS backend.
const PROJECT = 'manufusion-mems-development';
const SCHEDULER_EMAIL = `mems-fx-scheduler@${PROJECT}.iam.gserviceaccount.com`;
const verifier = new OAuth2Client();

function authHeader(ctx: { event?: unknown }): string {
    const event = ctx.event && typeof ctx.event === 'object' ? ctx.event as { headers?: Record<string, unknown> } : {};
    const entries = Object.entries(event.headers || {});
    const value = entries.find(([key]) => key.toLowerCase() === 'authorization')?.[1];
    return typeof value === 'string' ? value : '';
}

async function verifyScheduler(ctx: { event?: unknown }) {
    if (PROJECT_ID !== PROJECT) throw new Error('Development scheduler only.');
    const url = str(process.env.MEMS_PUBLIC_URL);
    if (!url.startsWith('https://mems-dev-') || !url.includes('.a.run.app')) throw new Error('Cloud Run audience not configured.');
    const authorization = authHeader(ctx);
    if (!authorization.startsWith('Bearer ')) throw new Error('Missing verified Scheduler OIDC token.');
    const token = authorization.slice(7);
    if (token.length > 10000 || !token) throw new Error('Invalid OIDC token.');
    const ticket = await verifier.verifyIdToken({ idToken: token, audience: url });
    const payload = ticket.getPayload();
    if (!payload || payload.email !== SCHEDULER_EMAIL || payload.email_verified !== true ||
        !['https://accounts.google.com', 'accounts.google.com'].includes(payload.iss)) {
        throw new Error('Scheduler identity not authorized.');
    }
}

function due(config: FxSettings, last: string, now: Date): boolean {
    const previous = Date.parse(last) || 0;
    const current = now.getTime();
    if (config.frequency === 'hourly') return current - previous >= 3600000;
    if (config.frequency === 'three_hourly') return current - previous >= 3 * 3600000;
    if (config.frequency === 'six_hourly') return current - previous >= 6 * 3600000;
    const [hour, minute] = config.timeUtc.split(':').map(Number);
    const target = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute);
    if (config.frequency === 'daily') return current >= target && previous < target;
    const offsetDays = (now.getUTCDay() + 7 - config.weekday) % 7;
    const weekly = target - offsetDays * 86400000;
    return current >= weekly && previous < weekly;
}

export const fxSchedulerRoutes = {
    'POST /api/internal/fx/scheduled-refresh': [async (ctx: { event?: unknown; body: unknown }) => {
        try {
            await verifyScheduler(ctx);
        } catch {
            return error('Unauthorized scheduled operation.', 401);
        }
        try {
            const cfg = settingsOf(await getDoc('system/fx_config'));
            const state = await getDoc('system/fx_schedule_state');
            const now = new Date();
            await writeDoc('system/fx_schedule_state', { ...(state?.data ?? {}), lastReceivedAt: now.toISOString() });
            if (!cfg.enabled) return json({ ok: true, skipped: 'Scheduler disabled in MEMS settings.' });
            if (!due(cfg, str(state?.data.lastCompletedAt), now)) return json({ ok: true, skipped: 'Not due yet.' });
            const snapshot = await getLive(cfg.provider);
            const doc = await getDoc('reference/currencies');
            if (!doc) throw new Error('Currency reference defaults not yet loaded.');
            const items = (Array.isArray(doc.data.items) ? doc.data.items as Plain[] : []);
            if (!items.some((x) => !!x && typeof x === 'object' && !Array.isArray(x) && x.code === 'KES')) {
                throw new Error('KES currency missing.');
            }
            const result = items.map((x) => {
                if (!x || typeof x !== 'object' || Array.isArray(x) || x.code !== 'KES') return x;
                return { ...x, unitsPerUsd: snapshot.usdKes, usdPerUnit: 1 / snapshot.usdKes };
            });
            await writeDoc('reference/currencies', {
                ...doc.data, items: result,
                ratesUpdatedAt: snapshot.at, ratesLastCheckedAt: nowIso(), ratesSource: cfg.provider,
            });
            const timestamp = nowIso();
            await writeDoc(`fx_snapshots/${timestamp.replace(/[^0-9]/g, '')}_${randomId(4)}`, {
                capturedAt: timestamp, observedAt: snapshot.at, provider: cfg.provider,
                usdKes: snapshot.usdKes, kesUsd: 1 / snapshot.usdKes,
                mode: 'scheduled', nextUpdate: snapshot.nextUpdate,
                updatedBy: SCHEDULER_EMAIL,
            }, { exists: false });
            await writeDoc('system/fx_schedule_state', {
                lastCompletedAt: timestamp, lastReceivedAt: timestamp, lastProvider: cfg.provider,
                lastUsdKes: snapshot.usdKes, lastError: '', lastErrorAt: '',
            });
            await audit([{ category: 'automation', action: 'fx.rates.scheduled', details: `Provider ${cfg.provider} published USD/KES ${snapshot.usdKes} at ${snapshot.at}` }]);
            return json({ ok: true, observedAt: snapshot.at, usdKes: snapshot.usdKes });
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Unknown FX refresh failure';
            await writeDoc('system/fx_schedule_state', { lastReceivedAt: nowIso(), lastError: message.slice(0,250), lastErrorAt: nowIso() });
            await audit([{ category: 'automation', action: 'fx.rates.scheduled', outcome: 'failure', details: message }]);
            return error('Scheduled exchange-rate refresh failed. See administration logs.', 503);
        }
    }],
};
