import { getDoc, nowIso, randomId, str, updateFields } from './core';

// ---------------------------------------------------------------------------
// Live chat signals. Every chat change bumps a tiny revision document:
//   organizations/{org}/chat_signals/room_{roomId}   rev (any change) · dataRev (messages, reactions, membership)
//   organizations/{org}/chat_signals/inbox_{uid}     rev (the person's conversation list changed)
// Browsers hold one authenticated long-poll (/api/org/quick/chat/wait) that returns as soon as a
// revision moves. Signals carry no message text or file: the browser refetches through the
// membership-checked routes, so a signal can never leak content.
// Waiters on the same server instance are woken at once; other instances see the revision on
// their next check (about a second).
// ---------------------------------------------------------------------------

export const SIGNAL_PATH = (orgId: string, key: string) => `organizations/${orgId}/chat_signals/${key}`;
export const roomSignal = (roomId: string) => 'room_' + roomId;
export const inboxSignal = (uid: string) => 'inbox_' + uid;
/** Events that change only who is typing, present or has read: no message refetch is needed. */
export const LIVE_ONLY_EVENTS = new Set(['typing', 'presence', 'read']);

const waiters = new Map<string, Set<() => void>>();

export function newRev(): string {
    return Date.now().toString(36) + '_' + randomId(6);
}

export async function bumpSignal(orgId: string, key: string, event = ''): Promise<void> {
    const rev = newRev();
    const data: Record<string, unknown> = { rev, at: nowIso(), event: event.slice(0, 20) };
    if (!LIVE_ONLY_EVENTS.has(event)) data.dataRev = rev;
    try {
        await updateFields(SIGNAL_PATH(orgId, key), data);
    } catch (error) {
        // A missed signal only delays the refresh until the next change or reconnect; never fail the chat action.
        console.error('CHAT_SIGNAL_WRITE_FAILED', key, error);
    }
    const local = waiters.get(orgId + '/' + key);
    if (local) for (const wake of [...local]) wake();
}

export async function readSignal(orgId: string, key: string): Promise<{ rev: string; dataRev: string }> {
    const doc = await getDoc(SIGNAL_PATH(orgId, key));
    return { rev: str(doc?.data.rev), dataRev: str(doc?.data.dataRev) };
}

/** Resolve when any of the keys is bumped on this instance, or after `ms`. */
export function waitLocal(orgId: string, keys: string[], ms: number): Promise<void> {
    return new Promise((resolve) => {
        const ids = keys.map((k) => orgId + '/' + k);
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            for (const id of ids) {
                const set = waiters.get(id);
                set?.delete(finish);
                if (set && !set.size) waiters.delete(id);
            }
            resolve();
        };
        const timer = setTimeout(finish, ms);
        for (const id of ids) {
            const set = waiters.get(id) ?? new Set<() => void>();
            set.add(finish);
            waiters.set(id, set);
        }
    });
}

/** How many long-polls this instance holds (health and tests). */
export function waiterCount(): number {
    let n = 0;
    for (const set of waiters.values()) n += set.size;
    return n;
}
