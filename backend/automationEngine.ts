import { OAuth2Client } from 'google-auth-library';
import { PROJECT_ID, HttpError, getDoc, googleRequest, listDocs, nowIso, orderDesc, randomId, runQuery, str, writeDoc } from './core';
import { sweepOrganization } from './mrp';
import { json, error, type RouterContext } from './platform/sdk';
import { audit } from './audit';
import { staff } from './guards';
import { refreshCurrencyCatalogue } from './fxRates';
import { settingsOf, type FxSettings } from './fxSettings';

const PROJECT = 'manufusion-mems-development';
// Cloud Scheduler is not available in africa-south1 (Cloud Run remains there).
// The trigger contains only schedule metadata; it invokes MEMS in Johannesburg.
const REGION = 'me-central1';
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
    if (response.status === 403) return { provisioned: false, reason: 'Cloud Scheduler API may be disabled, or the runtime account lacks Cloud Scheduler Viewer. Check the API and IAM permissions.', job: SCHEDULER };
    if (response.status === 400) return { provisioned: false, reason: `Cloud Scheduler rejected location ${REGION} (HTTP 400). Check the supported Cloud Scheduler locations and API.`, job: SCHEDULER };
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
    const mrp = await mrpSweepConfig();
    const mrpState = await getDoc(MRP_STATE);
    return {
        engine: { name: 'MEMS shared automation engine', version: '2.0', registered: JOBS.map((j) => j.id),
            tickMinutes: 5, lastHeartbeat: lastSeen, connected, sharedTrigger: scheduler },
        jobs: [
            { id: JOB_ID, label: 'World currency rates (USD base)', category: 'Finance',
                enabled: settings.enabled, schedule: settings,
                scheduleText: settings.enabled ? `${settings.frequency.replace(/_/g, ' ')}${['daily', 'weekly'].includes(settings.frequency) ? ` at ${settings.timeUtc} UTC` : ''} · ${settings.provider}` : 'Disabled',
                configurable: 'fx_monitor',
                lastStartedAt: str(state?.data.lastStartedAt), lastCompletedAt: str(state?.data.lastCompletedAt),
                lastError: str(state?.data.lastError), lastErrorAt: str(state?.data.lastErrorAt),
                lastResult: state?.data.lastResult || null },
            { id: MRP_JOB_ID, label: 'MRP replenishment safety sweep (Min/max and Reorder point)', category: 'Inventory',
                enabled: mrp.enabled, schedule: mrp,
                scheduleText: mrp.enabled ? `Every ${mrp.intervalHours} hour${mrp.intervalHours === 1 ? '' : 's'}${str(mrpState?.data.cursor) ? ' · resuming an unfinished sweep' : ''}` : 'Disabled (MRP still runs on every material change)',
                configurable: 'inline',
                lastStartedAt: str(mrpState?.data.lastStartedAt), lastCompletedAt: str(mrpState?.data.lastCompletedAt),
                lastError: str(mrpState?.data.lastError), lastErrorAt: str(mrpState?.data.lastErrorAt),
                lastResult: mrpState?.data.lastResult || null },
        ],
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

// ===== MRP replenishment safety sweep =====
// MRP runs on every material change (see mrp.ts). The sweep is the safety net: it re-plans every Min/max and Reorder
// point material of every active organization, catching changes that did not pass through an organization request
// (for example stock posted by another automation). Long sweeps resume on the next tick from where they stopped.

const MRP_JOB_ID = 'inv.mrp-sweep';
const MRP_CONFIG = 'system/mrp_sweep_config';
const MRP_STATE = 'system/mrp_sweep_state';
const MRP_INTERVALS = [1, 3, 6, 12, 24];

async function mrpSweepConfig(): Promise<{ enabled: boolean; intervalHours: number }> {
    const d = await getDoc(MRP_CONFIG);
    const hours = Number(d?.data.intervalHours);
    return { enabled: d ? d.data.enabled !== false : true, intervalHours: MRP_INTERVALS.includes(hours) ? hours : 6 };
}

export function mrpSweepDue(c: { enabled: boolean; intervalHours: number }, state: { lastCompletedAt?: string; cursor?: string }, at: Date): boolean {
    if (!c.enabled) return false;
    if (state.cursor) return true;
    const last = Date.parse(state.lastCompletedAt || '') || 0;
    return at.getTime() - last >= c.intervalHours * 3_600_000;
}

async function executeMrpSweep(mode: 'scheduled' | 'manual', deadline: number) {
    const startedAt = nowIso();
    const t0 = Date.now();
    const eventId = `${startedAt.replace(/[^0-9]/g, '')}_${randomId(4)}`;
    const prior = (await getDoc(MRP_STATE))?.data ?? {};
    await writeDoc(MRP_STATE, { ...prior, lastStartedAt: startedAt });
    try {
        const orgs = (await listDocs('organizations')).filter((o) => !['suspended', 'pending_approval', 'rejected'].includes(str(o.data.status))).map((o) => o.id).sort();
        const cursor = str(prior.cursor);
        const todo = cursor ? orgs.filter((id) => id >= cursor) : orgs;
        const total = { organizations: 0, planned: 0, created: 0, replanned: 0, cancelled: 0, failed: 0 };
        let next = '';
        for (const orgId of todo) {
            if (Date.now() > deadline) { next = orgId; break; }
            const r = await sweepOrganization(orgId, deadline);
            total.organizations++;
            total.planned += r.planned; total.created += r.created; total.replanned += r.replanned; total.cancelled += r.cancelled; total.failed += r.failed;
            if (!r.complete) { next = orgId; break; }
        }
        const completedAt = nowIso();
        const result = { ...total, complete: !next, resumeFrom: next };
        await writeDoc(MRP_STATE, { ...prior, lastStartedAt: startedAt, cursor: next, ...(next ? {} : { lastCompletedAt: completedAt }), lastResult: result, lastError: '', lastErrorAt: '' });
        await writeDoc(`${RUNS_COL}/${eventId}`, { jobId: MRP_JOB_ID, mode, status: 'success', startedAt, completedAt, durationMs: Date.now() - t0, ...result,
            summary: `${total.planned} material(s) planned in ${total.organizations} organization(s): ${total.created} created, ${total.replanned} re-planned, ${total.cancelled} cancelled, ${total.failed} failed${next ? '; continues next tick' : ''}` }, { exists: false });
        await audit([{ category: 'automation', action: 'inv.mrp_sweep.success', details: `${mode}: ${total.planned} planned, ${total.created} created, ${total.replanned} re-planned, ${total.cancelled} cancelled, ${total.failed} failed${next ? ' (partial)' : ''}` }]);
        return result;
    } catch (e) {
        const message = e instanceof Error ? e.message : 'MRP sweep failed';
        const completedAt = nowIso();
        await writeDoc(MRP_STATE, { ...prior, lastStartedAt: startedAt, lastError: message.slice(0, 250), lastErrorAt: completedAt });
        await writeDoc(`${RUNS_COL}/${eventId}`, { jobId: MRP_JOB_ID, mode, status: 'failed', startedAt, completedAt, durationMs: Date.now() - t0, error: message.slice(0, 250) }, { exists: false });
        await audit([{ category: 'automation', action: 'inv.mrp_sweep.failure', outcome: 'failure', details: message.slice(0, 400) }]);
        throw e;
    }
}

// ===== Job registry =====
// One shared, OIDC-verified heartbeat drives every job. Each job decides whether it is due, runs under its own lock for
// the tick, keeps its own state and history, and fails on its own without stopping the others.

interface Job {
    id: string;
    due: (at: Date) => Promise<boolean>;
    run: (mode: 'scheduled' | 'manual', deadline: number) => Promise<unknown>;
}
const JOBS: Job[] = [
    {
        id: JOB_ID,
        due: async (at) => automationDue(settingsOf(await getDoc('system/fx_config')), str((await getDoc(STATE))?.data.lastCompletedAt), at),
        run: (mode) => executeFx(mode),
    },
    {
        id: MRP_JOB_ID,
        due: async (at) => {
            const s = (await getDoc(MRP_STATE))?.data ?? {};
            return mrpSweepDue(await mrpSweepConfig(), { lastCompletedAt: str(s.lastCompletedAt), cursor: str(s.cursor) }, at);
        },
        run: (mode, deadline) => executeMrpSweep(mode, deadline),
    },
];
const TICK_BUDGET_MS = 100_000;

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
            // HTTP 400 may contain an actionable field/location validation error; surface
            // only a short Google-provided diagnostic to the platform super administrator.
            if (response.status === 400) {
                const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
                const detail = str(payload?.error?.message).slice(0, 300).replace(/[\r\n]+/g, ' ');
                throw new HttpError(400, `Cloud Scheduler rejected the ${REGION} job: ${detail || 'invalid request'}.`);
            }
            throw new HttpError(502, `Could not create the shared automation trigger (HTTP ${response.status}).`);
        }
        // Fire once through Cloud Scheduler itself so the OIDC callback can be verified
        // immediately, without waiting for the next five-minute tick.
        const probe = await googleRequest(SCHEDULER_API + ':run', 'POST', {});
        const probeQueued = probe.ok;
        if (!probeQueued) console.warn('Scheduler job created but initial trigger failed', probe.status);
        await audit([{ category: 'admin', action: 'automations.engine.activate', actor: ctx.actor, meta: ctx.meta, details: `Shared ${SCHEDULER} provisioned in ${REGION}; initial callback ${probeQueued ? 'requested' : 'not started'}` }]);
        return { ok: true, region: REGION, verifiedCallbackRequested: probeQueued,
            message: probeQueued
                ? 'Shared scheduler saved in me-central1 (Doha). A signed test callback was requested; tap Check connection to verify.'
                : 'Shared scheduler saved in me-central1 (Doha). Initial test could not be started; wait for its next five-minute tick and check connection.' };
    })],
    'POST /api/admin/automations/job/config': [staff('automations.job.config', 'super', async (ctx) => {
        developmentOnly();
        if (str(ctx.body.jobId) !== MRP_JOB_ID) throw new HttpError(400, 'Only the MRP sweep is configured here; exchange rates are configured under FX automation.');
        const reason = str(ctx.body.reason).trim();
        if (reason.length < 10 || reason.length > 300) throw new HttpError(400, 'Give the reason for the change (10 to 300 characters).');
        const hours = Number(ctx.body.intervalHours);
        if (!MRP_INTERVALS.includes(hours)) throw new HttpError(400, `Choose an interval of ${MRP_INTERVALS.join(', ')} hours.`);
        const enabled = ctx.body.enabled === true;
        const before = await mrpSweepConfig();
        await writeDoc(MRP_CONFIG, { enabled, intervalHours: hours, updatedBy: ctx.uid, updatedByEmail: ctx.actor.email, updatedAt: nowIso(), reason });
        await audit([{ category: 'admin', action: 'automations.job.config', actor: ctx.actor, meta: ctx.meta, target: { type: 'automation_job', label: MRP_JOB_ID },
            details: `${before.enabled ? 'enabled' : 'disabled'} every ${before.intervalHours}h → ${enabled ? 'enabled' : 'disabled'} every ${hours}h. Reason: ${reason}` }]);
        return { ok: true, enabled, intervalHours: hours };
    })],
    'POST /api/admin/automations/job/run': [staff('automations.job.run', 'super', async (ctx) => {
        developmentOnly();
        const job = JOBS.find((j) => j.id === str(ctx.body.jobId));
        if (!job) throw new HttpError(404, 'Unknown automation job.');
        const at = new Date();
        const lock = await writeDoc(`automation_locks/${job.id.replace(/[^A-Za-z0-9_-]/g, '_')}_${at.toISOString().slice(0, 16).replace(/[^0-9]/g, '')}`,
            { startedAt: at.toISOString(), expiresAt: new Date(at.getTime() + 5 * 60000).toISOString(), jobId: job.id, manual: true }, { exists: false });
        if (!lock) throw new HttpError(409, 'This job is already running this minute. Try again shortly.');
        await audit([{ category: 'admin', action: 'automations.job.run', actor: ctx.actor, meta: ctx.meta, target: { type: 'automation_job', label: job.id }, details: 'Manual run requested' }]);
        const result = await job.run('manual', Date.now() + 50_000);
        return { ok: true, result };
    })],
    'POST /api/internal/automations/heartbeat': [async (ctx: RouterContext) => {
        try { await verifyHeartbeat(ctx); } catch { return error('Unauthorized automation caller.', 401); }
        const at = new Date();
        const deadline = at.getTime() + TICK_BUDGET_MS;
        const previous = await getDoc(STATE);
        await writeDoc(STATE, { ...(previous?.data || {}), lastReceivedAt: at.toISOString(), lastVerifiedHeartbeatAt: at.toISOString() });
        const bucket = at.toISOString().slice(0, 16).replace(/[^0-9]/g, '');
        const results: Record<string, string> = {};
        let failures = 0;
        let ran = 0;
        for (const job of JOBS) {
            if (Date.now() > deadline - 10_000) { results[job.id] = 'deferred: tick budget used'; continue; }
            let due = false;
            try { due = await job.due(at); } catch { results[job.id] = 'skipped: could not read its schedule'; continue; }
            if (!due) { results[job.id] = 'not due'; continue; }
            const lock = await writeDoc(`automation_locks/${job.id.replace(/[^A-Za-z0-9_-]/g, '_')}_${bucket}`,
                { startedAt: at.toISOString(), expiresAt: new Date(at.getTime() + 5 * 60000).toISOString(), jobId: job.id }, { exists: false });
            if (!lock) { results[job.id] = 'skipped: another scheduler attempt holds this tick'; continue; }
            ran++;
            try { await job.run('scheduled', deadline); results[job.id] = 'success'; }
            catch { failures++; results[job.id] = 'failed (see Automation Center history)'; }
        }
        // Retry the tick only when every job that ran failed; successful jobs are never repeated.
        if (ran > 0 && failures === ran) return error('Automation failed; see MEMS Automation Center history.', 503);
        return json({ ok: true, results });
    }],
};
