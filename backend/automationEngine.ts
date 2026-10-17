import { OAuth2Client } from 'google-auth-library';
import { PROJECT_ID, HttpError, getDoc, googleRequest, listDocs, nowIso, orderDesc, randomId, runQuery, str, writeDoc } from './core';
import { json, error, type RouterContext } from './platform/sdk';
import { audit } from './audit';
import { staff } from './guards';
import { refreshCurrencyCatalogue } from './fxRates';
import { settingsOf, type FxSettings } from './fxSettings';

const PROJECT = 'manufusion-mems-development';
const REGION = 'africa-south1';
const SCHEDULER = 'mems-automation-heartbeat';
const SCHEDULER_SA = `mems-fx-scheduler@${PROJECT}.iam.gserviceaccount.com`;
const SCHEDULER_PATH = `projects/${PROJECT}/locations/${REGION}/jobs/${SCHEDULER}`;
const SCHEDULER_API = `https://cloudscheduler.googleapis.com/v1/${SCHEDULER_PATH}`;
const JOB_ID = 'fx.world-rates';
const RUNS_COL = 'automation_runs';
const STATE = 'system/fx_schedule_state';
const client = new OAuth2Client();

export function automationDue(c: FxSettings, last: string, at: Date): boolean {
    const previous = Date.parse(last) || 0;
    const now = at.getTime();
    if (!c.enabled) return false;
    if (c.frequency === 'hourly') return now - previous >= 3600000;
    if (c.frequency === 'three_hourly') return now - previous >= 3 * 3600000;
    if (c.frequency === 'six_hourly') return now - previous >= 6 * 3600000;
    const [h, m] = c.timeUtc.split(':').map(Number);
    const today = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), h, m);
    if (c.frequency === 'daily') return now >= today && previous < today;
    const weekdayDelta = (at.getUTCDay() + 7 - c.weekday) % 7;
    const thisWeek = today - weekdayDelta * 86400000;
    return now >= thisWeek && previous < thisWeek;
}

function developmentOnly() {
    if (PROJECT_ID !== PROJECT) throw new HttpError(403, 'Automation management is available only in the isolated development project.');
}

function configuredAudience() {
    const url = str(process.env.MEMS_PUBLIC_URL);
    if (!/^https:\/\/mems-dev-[a-z0-9-]+\.a\.run\.app\/$/.test(url)) throw new Error('Canonical MEMS_PUBLIC_URL is not configured.');
    return url;
}

async function verifyHeartbeat(ctx: RouterContext) {
    developmentOnly();
    const headers = ctx.event.headers ?? {};
    const auth = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
    const bearer = typeof auth === 'string' ? auth : '';
    if (!bearer.startsWith('Bearer ') || bearer.length > 10000) throw new Error('No Google identity token.');
    const ticket = await client.verifyIdToken({ idToken: bearer.slice(7), audience: configuredAudience() });
    const claims = ticket.getPayload();
    if (!claims || claims.email !== SCHEDULER_SA || claims.email_verified !== true ||
        !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)) {
        throw new Error('Caller is not the MEMS automation scheduler.');
    }
}

async function cloudSchedulerStatus() {
    const response = await googleRequest(SCHEDULER_API, 'GET');
    if (response.status === 404) return { provisioned: false, reason: 'One shared scheduler trigger has not been created yet.', job: SCHEDULER };
    if (response.status === 403) return { provisioned: false, reason: 'Runtime service account lacks Cloud Scheduler Viewer.', job: SCHEDULER };
    if (!response.ok) return { provisioned: false, reason: `Cloud Scheduler HTTP ${response.status}`, job: SCHEDULER };
    const data = await response.json() as Record<string, unknown>;
    return { provisioned: true, job: SCHEDULER, state: str(data.state), schedule: str(data.schedule),
        lastAttemptTime: str(data.lastAttemptTime), timeZone: str(data.timeZone), audience: configuredAudience() };
}

async function status() {
    const [cfg, state, runs, scheduler] = await Promise.all([
        getDoc('system/fx_config'), getDoc(STATE),
        runQuery({ from: [{ collectionId: RUNS_COL }], orderBy: orderDesc('startedAt'), limit: 60 }),
        cloudSchedulerStatus().catch(() => ({ provisioned: false, reason: 'Cloud Scheduler could not be reached.', job: SCHEDULER })),
    ]);
    const settings = settingsOf(cfg);
    // Only an OIDC-authenticated shared heartbeat counts as scheduler connectivity.
    // Older versions stored manual-refresh timestamps in lastReceivedAt too.
    const lastSeen = str(state?.data.lastVerifiedHeartbeatAt);
    const connected = !!lastSeen && Date.now() - Date.parse(lastSeen) < 20 * 60 * 1000;
    return {
        engine: { name: 'MEMS shared automation engine', version: '1.0', registered: [JOB_ID],
            tickMinutes: 5, lastHeartbeat: lastSeen, connected, sharedTrigger: scheduler },
        jobs: [{ id: JOB_ID, label: 'World currency rates (USD base)', category: 'Finance',
            enabled: settings.enabled, schedule: settings,
            lastStartedAt: str(state?.data.lastStartedAt), lastCompletedAt: str(state?.data.lastCompletedAt),
            lastError: str(state?.data.lastError), lastErrorAt: str(state?.data.lastErrorAt),
            lastResult: state?.data.lastResult || null }],
        history: runs.map((r) => ({ id: r.id, ...r.data })),
    };
}

async function executeFx(mode: 'scheduled' | 'manual') {
    const c = settingsOf(await getDoc('system/fx_config'));
    const startedAt = nowIso();
    const eventId = `${startedAt.replace(/[^0-9]/g, '')}_${randomId(4)}`;
    const snapshot = await getDoc(STATE);
    await writeDoc(STATE, { ...(snapshot?.data || {}), lastStartedAt: startedAt });
    try {
        const result = await refreshCurrencyCatalogue(c.provider, mode);
        const completedAt = nowIso();
        await writeDoc(STATE, {
            ...(snapshot?.data || {}), lastStartedAt: startedAt, lastCompletedAt: completedAt,
            lastResult: { matched: result.matched, changed: result.changed, total: result.total, unavailable: result.unavailable.length,
                publishedAt: result.providerPublishedAt, historyRecorded: result.historyRecorded },
            lastProvider: c.provider, lastError: '', lastErrorAt: '',
        });
        await writeDoc(`${RUNS_COL}/${eventId}`, {
            jobId: JOB_ID, mode, status: 'success', startedAt, completedAt, provider: c.provider,
            matched: result.matched, changed: result.changed, total: result.total, missing: result.unavailable.length,
            publishedAt: result.providerPublishedAt,
        }, { exists: false });
        await audit([{ category: 'automation', action: 'fx.world_rates.success', details: `${mode}: ${result.matched}/${result.total} currencies, ${result.changed} changed` }]);
        return result;
    } catch (e) {
        const completedAt = nowIso();
        const message = e instanceof Error ? e.message : 'Unknown provider error';
        await writeDoc(STATE, {
            ...(snapshot?.data || {}), lastStartedAt: startedAt, lastErrorAt: completedAt,
            lastError: message.slice(0, 250), lastFailedAt: completedAt,
        });
        await writeDoc(`${RUNS_COL}/${eventId}`, {
            jobId: JOB_ID, mode, status: 'failed', startedAt, completedAt, provider: c.provider,
            error: message.slice(0, 250),
        }, { exists: false });
        await audit([{ category: 'automation', action: 'fx.world_rates.failure', outcome: 'failure', details: message.slice(0, 400) }]);
        throw e;
    }
}

export async function runFxNow() {
    developmentOnly();
    return executeFx('manual');
}

export const automationRoutes = {
    'POST /api/admin/automations/status': [staff('automations.status', 'super', async () => {
        developmentOnly(); return status();
    })],
    'POST /api/admin/automations/activate': [staff('automations.activate', 'super', async (ctx) => {
        developmentOnly();
        if (str(ctx.body.confirm) !== 'ACTIVATE AUTOMATIONS') throw new HttpError(400, 'Confirm ACTIVATE AUTOMATIONS.');
        const audience = configuredAudience();
        const destination = audience + 'api/internal/automations/heartbeat';
        const body = {
            name: SCHEDULER_PATH, description: 'Shared MEMS automation heartbeat (jobs configured inside MEMS)',
            schedule: '*/5 * * * *', timeZone: 'Etc/UTC', attemptDeadline: '120s',
            httpTarget: {
                uri: destination, httpMethod: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: Buffer.from('{}').toString('base64'),
                oidcToken: { serviceAccountEmail: SCHEDULER_SA, audience },
            },
            retryConfig: { retryCount: 1, minBackoffDuration: '10s', maxBackoffDuration: '30s' },
        };
        let response = await googleRequest(SCHEDULER_API, 'GET');
        if (response.status === 404) {
            response = await googleRequest(`https://cloudscheduler.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/jobs`, 'POST', body);
        } else if (response.ok) {
            // A single named job is managed here; never overwrite another job's destination implicitly.
            const prior = await response.json() as { httpTarget?: { uri?: string } };
            if (prior.httpTarget?.uri !== destination) throw new HttpError(409, 'Existing automation heartbeat points elsewhere. Review it in Cloud Scheduler before changing it.');
            response = await googleRequest(SCHEDULER_API + '?updateMask=schedule,timeZone,httpTarget,attemptDeadline,retryConfig', 'PATCH', body);
        }
        if (!response.ok) {
            if ([401, 403].includes(response.status)) {
                // The application must not elevate IAM itself. Return specific instructions
                // while keeping Google API details and credentials out of the browser.
                throw new HttpError(403,
                    'Cloud Scheduler provisioning is not authorized. A Google Cloud project administrator must enable the Cloud Scheduler API, grant Cloud Scheduler Admin to the MEMS development runtime account, and grant Service Account User on the dedicated scheduler identity. These are one-time permissions; retry Activate after they are approved.');
            }
            if (response.status === 404) throw new HttpError(503, 'The Cloud Scheduler API or target job is unavailable in development. Enable Cloud Scheduler API and retry.');
            throw new HttpError(502, `Could not create the shared automation trigger (HTTP ${response.status}).`);
        }
        await audit([{ category: 'admin', action: 'automations.engine.activate', actor: ctx.actor, meta: ctx.meta, details: `Shared ${SCHEDULER} provisioned` }]);
        return { ok: true, message: 'Shared automation heartbeat provisioned. Schedule and execution history are available from the Automation Center.' };
    })],
    'POST /api/internal/automations/heartbeat': [async (ctx: RouterContext) => {
        try { await verifyHeartbeat(ctx); } catch { return error('Unauthorized automation caller.', 401); }
        const at = new Date();
        const previous = await getDoc(STATE);
        await writeDoc(STATE, { ...(previous?.data || {}), lastReceivedAt: at.toISOString(), lastVerifiedHeartbeatAt: at.toISOString() });
        const cfg = settingsOf(await getDoc('system/fx_config'));
        if (!automationDue(cfg, str(previous?.data.lastCompletedAt), at)) return json({ ok: true, skipped: 'No registered task is due.' });
        const bucket = at.toISOString().slice(0, 16).replace(/[^0-9]/g, '');
        const lock = await writeDoc(`automation_locks/${JOB_ID.replace(/[^A-Za-z0-9_-]/g,'_')}_${bucket}`,
            { startedAt: at.toISOString(), expiresAt: new Date(at.getTime() + 5 * 60000).toISOString(), jobId: JOB_ID }, { exists: false });
        if (!lock) return json({ ok: true, skipped: 'Another scheduler attempt already acquired this tick.' });
        try {
            const result = await executeFx('scheduled');
            return json({ ok: true, result: { currencies: result.matched, changed: result.changed } });
        } catch {
            return error('Automation failed; see MEMS Automation Center history.', 503);
        }
    }],
};
