import {
    DOCUMENT_NAME_ROOT,
    FIRESTORE_BASE,
    HttpError,
    encodeFields,
    fail,
    getDoc,
    googleRequest,
    isObj,
    nowIso,
    str,
    type Doc,
    type Fields,
    type Obj,
} from './core';

export interface HealthSettings {
    tracking: boolean;
    breaks: boolean;
    workMinutes: number;
    breakMinutes: number;
    weeklyDay: number;
    weeklyActive: boolean;
    timeZone: string;
}

export interface HealthLock {
    locked: true;
    kind: 'break' | 'weekly';
    until: string;
    message: string;
}

export interface HealthState {
    daySeconds: Record<string, number>;
    workSeconds: number;
    lastBeatAt: string;
    breakUntil: string;
    breakCount: number;
}

const DEFAULT_ZONE = 'Africa/Nairobi';
/**
 * Weekly Off is available again. Rest-day values saved before reactivation
 * remain inactive until that account explicitly confirms its Weekly Off toggle.
 * This avoids inadvertently locking a tenant's sole administrator on deployment.
 */
export const WEEKLY_REST_LOCKOUT_ENABLED = true;
export const DEFAULT_HEALTH_SETTINGS: HealthSettings = {
    tracking: true,
    breaks: false,
    workMinutes: 60,
    breakMinutes: 5,
    weeklyDay: -1,
    weeklyActive: false,
    timeZone: DEFAULT_ZONE,
};
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const n = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const integer = (value: unknown, min: number, max: number, label: string) => {
    const x = Number(value);
    if (!Number.isInteger(x) || x < min || x > max) throw new HttpError(400, label);
    return x;
};

export function healthSettings(raw: unknown): HealthSettings {
    const d = isObj(raw) ? raw : {};
    const workMinutes = n(d.workMinutes, 60);
    const breakMinutes = n(d.breakMinutes, 5);
    const weeklyDay = n(d.weeklyDay, -1);
    const zone = str(d.timeZone) || DEFAULT_ZONE;
    const safeZone = (() => { try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return zone; } catch { return DEFAULT_ZONE; } })();
    return {
        tracking: d.tracking !== false,
        breaks: d.breaks === true,
        workMinutes: Number.isInteger(workMinutes) && workMinutes >= 15 && workMinutes <= 240 ? workMinutes : 60,
        breakMinutes: Number.isInteger(breakMinutes) && breakMinutes >= 1 && breakMinutes <= 10 ? breakMinutes : 5,
        weeklyDay: Number.isInteger(weeklyDay) && weeklyDay >= -1 && weeklyDay <= 6 ? weeklyDay : -1,
        weeklyActive: d.weeklyActive === true && Number.isInteger(weeklyDay) && weeklyDay >= 0 && weeklyDay <= 6,
        timeZone: safeZone,
    };
}

export function validateHealthSettings(raw: unknown): HealthSettings {
    if (!isObj(raw)) throw new HttpError(400, 'Select your wellbeing settings.');
    const timeZone = str(raw.timeZone);
    if (timeZone.length < 3 || timeZone.length > 80) throw new HttpError(400, 'Choose a valid time zone.');
    try { new Intl.DateTimeFormat('en-US', { timeZone }); }
    catch { throw new HttpError(400, 'Choose a supported time zone.'); }
    if (typeof raw.tracking !== 'boolean' || typeof raw.breaks !== 'boolean') {
        throw new HttpError(400, 'Choose whether to track activity and require breaks.');
    }
    if (raw.breaks && !raw.tracking) throw new HttpError(400, 'Turn on screen-time tracking to schedule mandatory breaks.');
    const weeklyDay = integer(raw.weeklyDay, -1, 6, 'Choose a weekly rest day or Off.');
    const weeklyActive = raw.weeklyActive === true;
    if (weeklyActive && weeklyDay === -1) {
        throw new HttpError(400, 'Select a weekday before enabling Weekly Off.');
    }
    return {
        tracking: raw.tracking,
        breaks: raw.breaks,
        workMinutes: integer(raw.workMinutes, 15, 240, 'Choose a focus period from 15 to 240 minutes.'),
        breakMinutes: integer(raw.breakMinutes, 1, 10, 'Breaks can last between 1 and 10 minutes.'),
        weeklyDay,
        weeklyActive,
        timeZone,
    };
}

const dayKey = (date: Date, zone: string): string => {
    const entries = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const byType = new Map(entries.map((p) => [p.type, p.value]));
    return byType.get('year') + '-' + byType.get('month') + '-' + byType.get('day');
};

const weekday = (now: Date, zone: string) => {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(now);
    return DAYS.indexOf(day);
};

function nextLocalMidnight(now: Date, zone: string): string {
    const today = dayKey(now, zone);
    let low = now.getTime();
    let high = low + 49 * 60 * 60 * 1000;
    // Binary-search first instant in the next civil date, handling time-zone offsets and DST.
    for (let i = 0; i < 31 && high - low > 1000; i++) {
        const middle = Math.floor((high + low) / 2);
        if (dayKey(new Date(middle), zone) === today) low = middle;
        else high = middle;
    }
    return new Date(high).toISOString();
}

export function healthState(raw: unknown): HealthState {
    const value = isObj(raw) ? raw : {};
    const daySeconds: Record<string, number> = {};
    if (isObj(value.daySeconds)) {
        for (const [key, amount] of Object.entries(value.daySeconds)) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(key) && typeof amount === 'number' && Number.isFinite(amount)) {
                daySeconds[key] = Math.max(0, Math.min(86400, Math.floor(amount)));
            }
        }
    }
    return {
        daySeconds,
        workSeconds: Math.max(0, n(value.workSeconds, 0)),
        lastBeatAt: str(value.lastBeatAt),
        breakUntil: str(value.breakUntil),
        breakCount: Math.max(0, n(value.breakCount, 0)),
    };
}

export function lockFromUser(user: Doc, now = new Date()): HealthLock | null {
    if (!str(user.data.orgId)) return null;
    const settings = healthSettings(user.data.healthSettings);
    if (WEEKLY_REST_LOCKOUT_ENABLED && settings.weeklyActive && settings.weeklyDay !== -1 && weekday(now, settings.timeZone) === settings.weeklyDay) {
        return {
            locked: true,
            kind: 'weekly',
            until: nextLocalMidnight(now, settings.timeZone),
            message: 'Your weekly MEMS rest day is in progress.',
        };
    }
    const state = healthState(user.data.healthState);
    const until = Date.parse(state.breakUntil);
    if (settings.breaks && settings.tracking && Number.isFinite(until) && until > now.getTime()) {
        return {
            locked: true,
            kind: 'break',
            until: state.breakUntil,
            message: 'Your scheduled wellbeing break is in progress.',
        };
    }
    return null;
}

export function assertHealthAccess(user: Doc): void {
    const lock = lockFromUser(user);
    if (lock) throw new HttpError(423, lock.message + ' Access resumes at ' + lock.until + '.');
}

export function healthOverview(user: Doc, now = new Date()) {
    const settings = healthSettings(user.data.healthSettings);
    const state = healthState(user.data.healthState);
    const today = dayKey(now, settings.timeZone);
    const dates: Array<{ date: string; seconds: number }> = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        const key = dayKey(d, settings.timeZone);
        if (!dates.some((entry) => entry.date === key)) dates.push({ date: key, seconds: state.daySeconds[key] || 0 });
    }
    return {
        settings,
        weeklyLockoutEnabled: WEEKLY_REST_LOCKOUT_ENABLED,
        todaySeconds: state.daySeconds[today] || 0,
        weekSeconds: dates.reduce((total, d) => total + d.seconds, 0),
        workSeconds: state.workSeconds,
        breakCount: state.breakCount,
        days: dates,
        lock: lockFromUser(user, now),
        measuredFrom: str(user.data.healthStartedAt),
        note: 'Screen time is an estimate of foreground MEMS use with recent activity, not total device screen time.',
    };
}

async function casUpdateUser(uid: string, current: Doc, fields: Fields): Promise<boolean> {
    const res = await googleRequest(FIRESTORE_BASE + ':commit', 'POST', {
        writes: [{
            update: {
                name: DOCUMENT_NAME_ROOT + '/users/' + uid,
                fields: encodeFields(fields),
            },
            updateMask: { fieldPaths: Object.keys(fields) },
            currentDocument: { updateTime: current.updateTime },
        }],
    });
    if (res.ok) return true;
    if (res.status === 409 || res.status === 412) return false;
    if (res.status === 400) {
        const error = await res.text();
        if (/FAILED_PRECONDITION|ABORTED|condition/i.test(error)) return false;
        console.error('HEALTH_UPDATE_REJECTED', error.slice(0, 320));
        throw new HttpError(502, 'Could not update your wellbeing records.');
    }
    await fail(res, 'MEMS health update');
    throw new HttpError(502, 'Could not update your wellbeing records.');
}

export async function saveHealthSettings(uid: string, payload: unknown) {
    const settings = validateHealthSettings(payload);
    for (let attempt = 0; attempt < 4; attempt++) {
        const user = await getDoc('users/' + uid);
        if (!user) throw new HttpError(404, 'Account not found.');
        assertHealthAccess(user);
        const before = healthSettings(user.data.healthSettings);
        const previous = healthState(user.data.healthState);
        const policyChanged = before.breaks !== settings.breaks
            || before.workMinutes !== settings.workMinutes
            || before.breakMinutes !== settings.breakMinutes
            || before.tracking !== settings.tracking;
        const fields: Fields = {
            healthSettings: settings as unknown as Obj,
            healthState: {
                ...previous,
                workSeconds: policyChanged ? 0 : previous.workSeconds,
                breakUntil: policyChanged ? '' : previous.breakUntil,
            } as unknown as Obj,
            healthStartedAt: str(user.data.healthStartedAt) || nowIso(),
            healthUpdatedAt: nowIso(),
        };
        if (await casUpdateUser(uid, user, fields)) {
            const revised: Doc = { ...user, data: { ...user.data, ...fields } };
            return healthOverview(revised);
        }
    }
    throw new HttpError(409, 'Your wellbeing setup was updated elsewhere. Refresh and try again.');
}

export async function pulseHealth(uid: string, claimedSeconds: unknown) {
    const requested = integer(claimedSeconds, 0, 40, 'Screen-time increments must be between 0 and 40 seconds.');
    for (let attempt = 0; attempt < 4; attempt++) {
        const user = await getDoc('users/' + uid);
        if (!user) throw new HttpError(404, 'Account not found.');
        if (str(user.data.status) === 'disabled' || !str(user.data.orgId)) throw new HttpError(403, 'Your organization account is unavailable.');
        const now = new Date();
        const lock = lockFromUser(user, now);
        if (lock) return { ...healthOverview(user, now), lock, newlyLocked: false };
        const settings = healthSettings(user.data.healthSettings);
        const current = healthState(user.data.healthState);
        const lastAt = Date.parse(current.lastBeatAt);
        const elapsed = Number.isFinite(lastAt) ? Math.max(0, (now.getTime() - lastAt) / 1000) : 40;
        const elapsedValid = !Number.isFinite(lastAt) || elapsed >= 4;
        const seconds = settings.tracking && elapsedValid ? Math.max(0, Math.min(requested, Math.floor(elapsed + 1), 40)) : 0;
        const rested = Number.isFinite(lastAt) && elapsed > Math.max(60, settings.breakMinutes * 60);
        const after: HealthState = {
            ...current,
            workSeconds: rested || (current.breakUntil && Date.parse(current.breakUntil) <= now.getTime()) ? 0 : current.workSeconds,
            breakUntil: Date.parse(current.breakUntil) <= now.getTime() ? '' : current.breakUntil,
            lastBeatAt: now.toISOString(),
        };
        let newlyLocked = false;
        if (seconds) {
            const key = dayKey(now, settings.timeZone);
            after.daySeconds[key] = Math.min(86400, (after.daySeconds[key] || 0) + seconds);
            after.workSeconds += seconds;
            for (const k of Object.keys(after.daySeconds)) {
                if (k < dayKey(new Date(now.getTime() - 15 * 86400000), settings.timeZone)) delete after.daySeconds[k];
            }
        }
        if (settings.tracking && settings.breaks && after.workSeconds >= settings.workMinutes * 60) {
            after.breakUntil = new Date(now.getTime() + settings.breakMinutes * 60000).toISOString();
            after.breakCount++;
            after.workSeconds = 0;
            newlyLocked = true;
        }
        const fields: Fields = {
            healthState: after as unknown as Obj,
            healthStartedAt: str(user.data.healthStartedAt) || now.toISOString(),
        };
        if (await casUpdateUser(uid, user, fields)) {
            const revised: Doc = { ...user, data: { ...user.data, ...fields } };
            return { ...healthOverview(revised, now), newlyLocked };
        }
    }
    throw new HttpError(409, 'Screen-time updates overlapped. Try again.');
}
