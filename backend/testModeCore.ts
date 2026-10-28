import { getDoc, str } from './core';

/**
 * Platform testing override (development only).
 *
 * A MEMS super admin can switch on test mode for named tenants for a limited time. While it is on, that tenant's
 * organization super admin may perform every step of a workflow alone: maker-checker (segregation of duties),
 * job-role approval gates and chart-of-authority position checks are relaxed for that one user. Status, quantity,
 * money, document and data-integrity validations are NEVER relaxed. Every relaxed check is recorded and audited.
 *
 * Fail-closed: test mode exists only when the server runs with MEMS_ENVIRONMENT=development and is not flagged for
 * live data. Production never sets MEMS_ENVIRONMENT, so a stored override there has no effect.
 */

export const TEST_MODE_DOC = 'system/testing_override';
export const TEST_MODE_MAX_HOURS = 168;
export const TEST_MODE_PHRASE = 'ENABLE TEST MODE';

export function testModeEnvironmentAllowed(): boolean {
    if (process.env.MEMS_ENVIRONMENT !== 'development') return false;
    const live = str(process.env.MEMS_ALLOW_LIVE_DATA).toLowerCase();
    return !(live === 'true' || live === '1' || live === 'yes');
}

export interface TestModeState {
    enabled: boolean;
    orgIds: string[];
    expiresAt: string;
    reason: string;
    enabledBy: string;
    enabledByEmail: string;
    enabledAt: string;
    version: number;
}

const EMPTY: TestModeState = { enabled: false, orgIds: [], expiresAt: '', reason: '', enabledBy: '', enabledByEmail: '', enabledAt: '', version: 0 };
let cache: { at: number; state: TestModeState } | null = null;
const TTL_MS = 10_000;

export function clearTestModeCache() {
    cache = null;
}

export async function readTestMode(): Promise<TestModeState> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.state;
    let state = EMPTY;
    try {
        const doc = await getDoc(TEST_MODE_DOC);
        if (doc) {
            const d = doc.data;
            state = {
                enabled: d.enabled === true,
                orgIds: Array.isArray(d.orgIds) ? d.orgIds.map((x) => str(x)).filter(Boolean) : [],
                expiresAt: str(d.expiresAt),
                reason: str(d.reason),
                enabledBy: str(d.enabledBy),
                enabledByEmail: str(d.enabledByEmail),
                enabledAt: str(d.enabledAt),
                version: Number(d.version) || 0,
            };
        }
    } catch {
        // Fail closed: if the override cannot be read, test mode is off.
        state = EMPTY;
    }
    cache = { at: Date.now(), state };
    return state;
}

/** Whether the stored override is in force for this tenant right now. */
export function overrideActiveFor(state: TestModeState, orgId: string, now = Date.now()): boolean {
    if (!testModeEnvironmentAllowed()) return false;
    if (!state.enabled || !orgId || !state.orgIds.includes(orgId)) return false;
    const until = Date.parse(state.expiresAt);
    return Number.isFinite(until) && until > now;
}

export async function testModeActiveFor(orgId: string): Promise<boolean> {
    return overrideActiveFor(await readTestMode(), orgId);
}

export interface TestModeAware {
    testMode?: boolean;
    bypassed?: string[];
}

/**
 * Relax one control for the current request when test mode applies to this user. Call it only where the control
 * would otherwise refuse, so the audit lists exactly what was skipped:
 *   if (preparer === ctx.uid && !bypass(ctx, 'po.approve.not_preparer')) throw new HttpError(...)
 */
export function bypass(ctx: TestModeAware, rule: string): boolean {
    if (ctx.testMode !== true) return false;
    if (ctx.bypassed && !ctx.bypassed.includes(rule)) ctx.bypassed.push(rule);
    return true;
}
