import { HttpError, clearSettingsCache, emailVerificationRequired, getDoc, nowIso, writeDoc } from './core';
import { audit } from './audit';
import { publicRoute, staff } from './guards';

export const settingsRoutes = {
    'GET /api/registration/settings': [publicRoute(async () => ({ requireEmailVerification: await emailVerificationRequired() }))],

    'POST /api/admin/settings/registration': [
        staff('admin.settings.registration', 'super', async (ctx) => {
            const value = ctx.body.requireEmailVerification;
            if (typeof value !== 'boolean') throw new HttpError(400, 'Invalid setting.');
            const existing = await getDoc('system/settings');
            await writeDoc('system/settings', { ...(existing?.data ?? {}), requireEmailVerification: value, updatedAt: nowIso(), updatedBy: ctx.actor.email });
            clearSettingsCache();
            await audit([
                {
                    category: 'admin',
                    action: 'settings.registration',
                    actor: ctx.actor,
                    meta: ctx.meta,
                    target: { label: 'Registration settings' },
                    details: `Email verification ${value ? 'required' : 'not required (testing mode)'}`,
                },
            ]);
            return { requireEmailVerification: value };
        }),
    ],
};
