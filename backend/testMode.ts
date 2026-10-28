import { audit } from './audit';
import { HttpError, getDoc, nowIso, str, writeDoc } from './core';
import { orgRoute, staff } from './guards';
import {
    TEST_MODE_DOC, TEST_MODE_MAX_HOURS, TEST_MODE_PHRASE,
    clearTestModeCache, overrideActiveFor, readTestMode, testModeEnvironmentAllowed,
} from './testModeCore';

const ORG_ID = /^[A-Za-z0-9_-]{4,128}$/;

async function view() {
    const state = await readTestMode();
    const allowed = testModeEnvironmentAllowed();
    const now = Date.now();
    const expired = state.enabled && !(Date.parse(state.expiresAt) > now);
    const tenants = await Promise.all(state.orgIds.map(async (id) => {
        const org = await getDoc(`organizations/${id}`);
        return { orgId: id, name: str(org?.data.name) || id, active: overrideActiveFor(state, id, now) };
    }));
    return {
        environmentAllowed: allowed,
        environment: allowed ? 'development' : 'protected',
        phrase: TEST_MODE_PHRASE,
        maxHours: TEST_MODE_MAX_HOURS,
        override: { ...state, expired, tenants },
    };
}

export const testModeRoutes = {
    'POST /api/admin/security/testing-override': [
        staff('admin.security.testing_override.view', 'read', async () => view()),
    ],
    'POST /api/admin/security/testing-override/save': [
        staff('admin.security.testing_override.save', 'super', async (ctx) => {
            const body = ctx.body;
            const enable = body.enabled === true;
            const reason = str(body.reason).trim().slice(0, 500);
            const expectedVersion = Number(body.expectedVersion);
            const current = await getDoc(TEST_MODE_DOC);
            const version = Number(current?.data.version) || 0;
            if (!Number.isInteger(expectedVersion) || expectedVersion !== version) {
                throw new HttpError(409, 'The testing override was changed by someone else. Reload and try again.');
            }
            const previous = Array.isArray(current?.data.orgIds) ? (current!.data.orgIds as unknown[]).map((x) => str(x)) : [];
            const now = nowIso();
            if (!enable) {
                if (reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for switching test mode off.');
                await writeDoc(TEST_MODE_DOC, {
                    enabled: false, orgIds: [], expiresAt: '', reason: '', enabledBy: '', enabledByEmail: '', enabledAt: '',
                    disabledBy: ctx.uid, disabledByEmail: ctx.actor.email, disabledAt: now, disableReason: reason,
                    version: version + 1, updatedAt: now,
                });
                clearTestModeCache();
                await audit([
                    { category: 'security', action: 'testmode.disabled', actor: ctx.actor, meta: ctx.meta, target: { type: 'platform_setting', id: 'testing_override' }, details: reason },
                    ...previous.map((orgId) => ({ category: 'security', action: 'testmode.disabled', actor: ctx.actor, meta: ctx.meta, orgId, target: { type: 'organization', id: orgId }, details: `Platform testing override switched off: ${reason}` })),
                ]);
                return view();
            }
            if (!testModeEnvironmentAllowed()) {
                await audit([{ category: 'security', action: 'testmode.enable_refused', outcome: 'blocked', actor: ctx.actor, meta: ctx.meta, target: { type: 'platform_setting', id: 'testing_override' }, details: 'Refused outside the development environment' }]);
                throw new HttpError(403, 'Test mode can only be switched on in the development environment.');
            }
            if (str(body.confirmation).trim() !== TEST_MODE_PHRASE) throw new HttpError(400, `Type ${TEST_MODE_PHRASE} to confirm.`);
            if (reason.length < 20) throw new HttpError(400, 'Give a reason of at least 20 characters.');
            const hours = Number(body.hours);
            if (!Number.isInteger(hours) || hours < 1 || hours > TEST_MODE_MAX_HOURS) throw new HttpError(400, `Choose between 1 and ${TEST_MODE_MAX_HOURS} hours.`);
            const raw = Array.isArray(body.orgIds) ? body.orgIds.map((x) => str(x).trim()) : [];
            const orgIds = [...new Set(raw)];
            if (!orgIds.length || orgIds.length > 20 || orgIds.some((id) => !ORG_ID.test(id))) throw new HttpError(400, 'Choose between 1 and 20 tenants.');
            const orgs = await Promise.all(orgIds.map((id) => getDoc(`organizations/${id}`)));
            const missing = orgIds.filter((_, i) => !orgs[i]);
            if (missing.length) throw new HttpError(404, `Tenant not found: ${missing.join(', ')}`);
            const inactive = orgIds.filter((_, i) => str(orgs[i]!.data.status) !== 'active');
            if (inactive.length) throw new HttpError(409, `Only active tenants can be tested: ${inactive.join(', ')}`);
            const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();
            await writeDoc(TEST_MODE_DOC, {
                enabled: true, orgIds, expiresAt, reason, hours,
                enabledBy: ctx.uid, enabledByEmail: ctx.actor.email, enabledAt: now,
                version: version + 1, updatedAt: now,
            });
            clearTestModeCache();
            const label = (i: number) => str(orgs[i]!.data.name) || orgIds[i];
            await audit([
                { category: 'security', action: 'testmode.enabled', actor: ctx.actor, meta: ctx.meta, target: { type: 'platform_setting', id: 'testing_override' }, details: `${orgIds.length} tenant(s) until ${expiresAt}: ${reason}` },
                ...orgIds.map((orgId, i) => ({ category: 'security', action: 'testmode.enabled', actor: ctx.actor, meta: ctx.meta, orgId, target: { type: 'organization', id: orgId, label: label(i) }, details: `Maker-checker relaxed for the organization super admin until ${expiresAt}: ${reason}` })),
                ...previous.filter((id) => !orgIds.includes(id)).map((orgId) => ({ category: 'security', action: 'testmode.disabled', actor: ctx.actor, meta: ctx.meta, orgId, target: { type: 'organization', id: orgId }, details: 'Removed from the platform testing override' })),
            ]);
            return view();
        }),
    ],
    'POST /api/org/testing-mode/status': [
        orgRoute('org.testmode.status', null, async (ctx) => {
            const state = await readTestMode();
            const active = overrideActiveFor(state, ctx.orgId);
            return {
                active,
                appliesToYou: active && ctx.role === 'org_super_admin',
                expiresAt: active ? state.expiresAt : '',
                reason: active ? state.reason : '',
            };
        }),
    ],
};
