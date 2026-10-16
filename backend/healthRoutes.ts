import { HttpError, getDoc, str } from './core';
import { audit } from './audit';
import { secure } from './guards';
import { healthOverview, lockFromUser, pulseHealth, saveHealthSettings } from './healthPolicy';

async function getOrgMember(uid: string) {
    const user = await getDoc('users/' + uid);
    if (!user || !str(user.data.orgId) || str(user.data.status) === 'disabled') {
        throw new HttpError(403, 'Organization user account is unavailable.');
    }
    return user;
}

export const healthRoutes = {
    'POST /api/profile/health/status': [
        secure('profile.health.status', async (ctx) => healthOverview(await getOrgMember(ctx.uid))),
    ],
    'POST /api/profile/health/settings': [
        secure('profile.health.settings', async (ctx) => {
            await getOrgMember(ctx.uid);
            const result = await saveHealthSettings(ctx.uid, ctx.body.settings);
            await audit([{
                category: 'data',
                action: 'profile.health.settings',
                actor: ctx.actor,
                meta: ctx.meta,
                orgId: str((await getOrgMember(ctx.uid)).data.orgId),
                target: { type: 'user', label: ctx.actor.email },
                details: 'Wellbeing preference update, breaks ' + (result.settings.breaks ? 'on' : 'off')
                    + ', weekly off ' + (result.settings.weeklyActive ? 'on' : 'off')
                    + ', weekly day ' + result.settings.weeklyDay,
            }]);
            return result;
        }),
    ],
    'POST /api/profile/health/pulse': [
        secure('profile.health.pulse', async (ctx) => {
            await getOrgMember(ctx.uid);
            const result = await pulseHealth(ctx.uid, ctx.body.seconds);
            if (result.newlyLocked) await audit([{
                category: 'security',
                action: 'profile.health.break_start',
                actor: ctx.actor,
                meta: ctx.meta,
                orgId: str((await getOrgMember(ctx.uid)).data.orgId),
                target: { type: 'user', label: ctx.actor.email },
                details: 'Mandatory break until ' + result.lock?.until,
            }]);
            return result;
        }),
    ],
};
