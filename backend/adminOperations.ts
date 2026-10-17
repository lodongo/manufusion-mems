import { createSign } from 'node:crypto';
import { PROJECT_ID, HttpError, googleRequest, nowIso, str } from './core';
import { staff } from './guards';
import { audit } from './audit';

// Deliberately scoped to the independent DEVELOPMENT environment.
// No arbitrary project IDs, repositories, file paths or cloud write parameters are accepted.
const DEV_PROJECT = 'manufusion-mems-development';
const REGION = 'africa-south1';
const SERVICE = 'mems-dev';
const REPO = 'lodongo/manufusion-mems';
const WORKFLOW = 'deploy-development.yml';

function enforceDevelopment() {
    if (PROJECT_ID !== DEV_PROJECT) throw new HttpError(403, 'Development operations are disabled outside the isolated development project.');
}
function apiError(status: number, description: string) {
    if (status === 401 || status === 403) return `${description} requires the appropriate cloud permission (or GitHub App permission).`;
    return `${description} could not be retrieved (HTTP ${status}).`;
}
async function cloud<T>(url: string, method = 'GET', data?: unknown): Promise<T> {
    const response = await googleRequest(url, method, data);
    if (!response.ok) throw new Error(apiError(response.status, 'Google Cloud'));
    return (await response.json()) as T;
}
const runRoot = `https://run.googleapis.com/v2/projects/${DEV_PROJECT}/locations/${REGION}`;
const servicePath = `${runRoot}/services/${SERVICE}`;

type Token = { value: string; expires: number };
let cached: Token | null = null;

function appJwt(): string {
    const appId = str(process.env.MEMS_GITHUB_APP_ID);
    const key = str(process.env.MEMS_GITHUB_PRIVATE_KEY).replace(/\\n/g, '\n');
    if (!/^\d+$/.test(appId) || !key.includes('BEGIN') || !key.includes('PRIVATE KEY')) throw new Error('GitHub App credentials have not been configured in Cloud Run Secret Manager.');
    const now = Math.floor(Date.now() / 1000);
    const enc = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({ iat: now - 60, exp: now + 540, iss: appId });
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key, 'base64url');
    return unsigned + '.' + signature;
}

async function installationToken(): Promise<string> {
    if (cached && cached.expires > Date.now() + 120000) return cached.value;
    const installation = str(process.env.MEMS_GITHUB_INSTALLATION_ID);
    if (!/^\d+$/.test(installation)) throw new Error('GitHub App installation ID has not been configured.');
    const response = await fetch(`https://api.github.com/app/installations/${installation}/access_tokens`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + appJwt(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repositories: ['manufusion-mems'] }),
    });
    if (!response.ok) throw new Error(apiError(response.status, 'GitHub App authentication'));
    const data = (await response.json()) as { token?: string; expires_at?: string };
    if (!data.token) throw new Error('GitHub App returned no installation token.');
    cached = { value: data.token, expires: Date.parse(data.expires_at ?? '') || Date.now() + 3000000 };
    return data.token;
}

async function github<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const token = await installationToken();
    const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
        method,
        headers: {
            Authorization: 'Bearer ' + token,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(apiError(res.status, 'GitHub'));
    return res.status === 204 ? ({} as T) : (await res.json()) as T;
}

function view<T>(fn: () => Promise<T>) {
    return fn().then((data) => ({ ok: true as const, data })).catch((err: unknown) => ({
        ok: false as const, message: err instanceof Error ? err.message : 'Unavailable',
    }));
}

export const adminOperationsRoutes = {
    'POST /api/admin/ops/overview': [staff('admin.ops.overview', 'super', async () => {
        enforceDevelopment();
        const [service, revisions, logs, runs, commits] = await Promise.all([
            view(() => cloud<Record<string, unknown>>(servicePath)),
            view(() => cloud<{ revisions?: Array<Record<string, unknown>> }>(`${servicePath}/revisions?pageSize=30`)),
            view(() => cloud<{ entries?: Array<Record<string, unknown>> }>('https://logging.googleapis.com/v2/entries:list', 'POST', {
                resourceNames: [`projects/${DEV_PROJECT}`],
                filter: `resource.type="cloud_run_revision" AND resource.labels.service_name="${SERVICE}"`,
                orderBy: 'timestamp desc', pageSize: 60,
            })),
            view(() => github<{ workflow_runs?: Array<Record<string, unknown>> }>(`/actions/workflows/${WORKFLOW}/runs?per_page=30`)),
            view(() => github<Array<Record<string, unknown>>>(`/commits?sha=develop&per_page=12`)),
        ]);
        return {
            project: DEV_PROJECT, serviceName: SERVICE, region: REGION, repository: REPO, branch: 'develop',
            generatedAt: nowIso(), service, revisions, logs, runs, commits,
            githubConfigured: !!(process.env.MEMS_GITHUB_APP_ID && process.env.MEMS_GITHUB_INSTALLATION_ID && process.env.MEMS_GITHUB_PRIVATE_KEY),
        };
    })],

    'POST /api/admin/ops/github/dispatch': [staff('admin.ops.github.dispatch', 'super', async (ctx) => {
        enforceDevelopment();
        if (str(ctx.body.confirm) !== 'DEPLOY DEVELOPMENT') throw new HttpError(400, 'Type DEPLOY DEVELOPMENT to confirm the deployment.');
        await github<unknown>(`/actions/workflows/${WORKFLOW}/dispatches`, 'POST', { ref: 'develop' });
        await audit([{ category: 'admin', action: 'ops.github.development_deploy', actor: ctx.actor, meta: ctx.meta, details: `Manual development workflow dispatch requested by ${ctx.actor.email}` }]);
        return { ok: true, message: 'Development workflow dispatch requested. Check the GitHub Actions status for the result.' };
    })],

    'POST /api/admin/ops/github/retry': [staff('admin.ops.github.retry', 'super', async (ctx) => {
        enforceDevelopment();
        const runId = Number(ctx.body.runId);
        if (!Number.isSafeInteger(runId) || runId <= 0) throw new HttpError(400, 'Invalid workflow run ID.');
        if (str(ctx.body.confirm) !== `RETRY ${runId}`) throw new HttpError(400, 'Confirmation does not match.');
        // Ensure the run belongs to this workflow and the develop branch before acting.
        const run = await github<{ head_branch?: string; path?: string; event?: string }>(`/actions/runs/${runId}`);
        if (run.head_branch !== 'develop' || !(run.path ?? '').endsWith('/' + WORKFLOW)) throw new HttpError(403, 'Only MEMS development deploys may be retried.');
        await github<unknown>(`/actions/runs/${runId}/rerun-failed-jobs`, 'POST');
        await audit([{ category: 'admin', action: 'ops.github.retry_failed', actor: ctx.actor, meta: ctx.meta, details: `Development run #${runId}` }]);
        return { ok: true };
    })],
};
