import { HttpError, getDoc, listDocs, nowIso, rateLimit, str, writeDoc } from './core';
import type { OrgContext } from './guards';
import { ROOM_PATH, TYPING_ROOT, checkedRoom, membersOf, ID_RE } from './chatCommon';
import { inboxSignal, readSignal, roomSignal, waitLocal } from './chatSignals';

// ---------------------------------------------------------------------------
// Live chat transport: one authenticated long-poll per open chat screen.
//   POST /api/org/quick/chat/subscribe  { roomId?, roomRev?, roomDataRev?, inboxRev?, init? }
// Returns as soon as the person's inbox or the open room changes (or after ~25 s with no change),
// with typing, presence, read and delivery state for the open room. Membership is checked on
// every call; nothing is pushed that the person could not fetch themselves.
// Each call also records that the person's device is online and has received their messages
// (delivery marks drive the double grey ticks; read marks the blue ones).
// ---------------------------------------------------------------------------

export const DELIVERY_PATH = (orgId: string, uid: string) => `organizations/${orgId}/chat_delivery/${uid}`;
export const CHAT_SETTINGS_PATH = (uid: string) => 'users/' + uid + '/chat_prefs/settings';
const WAIT_MS = 25_000;
const CHECK_MS = 1_200;
const ONLINE_MS = 45_000;
const lastDelivery = new Map<string, number>();

/** Global chat settings of a person, with WhatsApp-like defaults. */
export interface ChatSettings {
    muteAll: boolean;
    /** Chat colours: follow the organization theme (system), or always light / dark. */
    appearance: 'system' | 'light' | 'dark';
    wallpaper: string;
    fontSize: 'small' | 'medium' | 'large';
    enterToSend: boolean;
    readReceipts: boolean;
    lastSeen: boolean;
    showPreviews: boolean;
    sound: boolean;
}
export const WALLPAPERS = ['default', 'ocean', 'forest', 'rose', 'amber', 'slate', 'violet'] as const;
export function chatSettingsOf(data: Record<string, unknown> | undefined): ChatSettings {
    const d = data ?? {};
    const wallpaper = str(d.wallpaper) || str(d.defaultTheme);
    const size = str(d.fontSize);
    const appearance = str(d.appearance);
    return {
        muteAll: d.muteAll === true,
        appearance: appearance === 'light' || appearance === 'dark' ? appearance : 'system',
        wallpaper: (WALLPAPERS as readonly string[]).includes(wallpaper) ? wallpaper : 'default',
        fontSize: size === 'small' || size === 'large' ? size : 'medium',
        enterToSend: d.enterToSend === true,
        readReceipts: d.readReceipts !== false,
        lastSeen: d.lastSeen !== false,
        showPreviews: d.showPreviews !== false,
        sound: d.sound !== false,
    };
}

async function markDelivered(ctx: OrgContext) {
    const key = ctx.orgId + '/' + ctx.uid;
    const now = Date.now();
    if (now - (lastDelivery.get(key) ?? 0) < 15_000) return;
    lastDelivery.set(key, now);
    if (lastDelivery.size > 20_000) lastDelivery.clear();
    await writeDoc(DELIVERY_PATH(ctx.orgId, ctx.uid), { at: nowIso(), uid: ctx.uid });
}

/** Typing, presence, read, delivery and online state of a room, filtered by everyone's privacy settings. */
export async function roomLiveState(ctx: OrgContext, roomId: string, members: string[], direct: boolean) {
    const [typing, presence, reads, delivery, settings] = await Promise.all([
        listDocs(TYPING_ROOT(ctx.orgId, roomId)),
        listDocs(ROOM_PATH(ctx.orgId, roomId) + '/presence'),
        listDocs(ROOM_PATH(ctx.orgId, roomId) + '/read_marks'),
        Promise.all(members.map((uid) => getDoc(DELIVERY_PATH(ctx.orgId, uid)))),
        Promise.all(members.map((uid) => getDoc(CHAT_SETTINGS_PATH(uid)))),
    ]);
    const now = Date.now();
    const prefs = new Map(members.map((uid, i) => [uid, chatSettingsOf(settings[i]?.data)]));
    const mine = prefs.get(ctx.uid) ?? chatSettingsOf(undefined);
    // Read receipts work both ways in individual chats (as in WhatsApp); group receipts are always kept.
    const showRead = (uid: string) => uid === ctx.uid || !direct || (mine.readReceipts && prefs.get(uid)?.readReceipts !== false);
    const showSeen = (uid: string) => uid === ctx.uid || (mine.lastSeen && prefs.get(uid)?.lastSeen !== false);
    return {
        typing: typing.filter((d) => Date.parse(str(d.data.until)) > now && d.id !== ctx.uid && members.includes(d.id)).map((d) => ({ uid: d.id, until: str(d.data.until) })),
        presence: presence.filter((d) => Date.parse(str(d.data.until)) > now && members.includes(d.id)).map((d) => ({ uid: d.id, until: str(d.data.until) })),
        readMarks: reads.filter((d) => members.includes(d.id) && showRead(d.id)).map((d) => ({ uid: d.id, readAt: str(d.data.readAt) })),
        deliveryMarks: members.map((uid, i) => ({ uid, at: str(delivery[i]?.data.at) })).filter((x) => x.at),
        online: members.map((uid, i) => {
            const at = str(delivery[i]?.data.at);
            const online = !!at && now - Date.parse(at) < ONLINE_MS;
            return { uid, online: showSeen(uid) && online, lastSeen: showSeen(uid) ? at : '' };
        }),
    };
}

/**
 * Long-poll for live chat. Served by POST /api/org/quick/chat/subscribe (the endpoint that used to register
 * AppDeploy WebSocket connections, which cannot run on Cloud Run).
 */
export async function waitForChanges(ctx: OrgContext) {
    await rateLimit('chat-wait', ctx.uid, 240, 60);
    const roomId = str(ctx.body.roomId);
    if (roomId && !ID_RE.test(roomId)) throw new HttpError(400, 'Choose a conversation.');
    const room = roomId ? await checkedRoom(ctx, roomId) : null;
    const seen = { roomRev: str(ctx.body.roomRev), roomDataRev: str(ctx.body.roomDataRev), inboxRev: str(ctx.body.inboxRev) };
    await markDelivered(ctx);
    const keys = [inboxSignal(ctx.uid), ...(room ? [roomSignal(room.id)] : [])];
    const first = ctx.body.init === true;
    const deadline = Date.now() + (first ? 0 : WAIT_MS);
    let inbox = await readSignal(ctx.orgId, keys[0]);
    let roomRev = room ? await readSignal(ctx.orgId, keys[1]) : { rev: '', dataRev: '' };
    while (!first && Date.now() < deadline && inbox.rev === seen.inboxRev && roomRev.rev === seen.roomRev) {
        await waitLocal(ctx.orgId, keys, Math.min(CHECK_MS, Math.max(0, deadline - Date.now())));
        [inbox, roomRev] = await Promise.all([readSignal(ctx.orgId, keys[0]), room ? readSignal(ctx.orgId, keys[1]) : Promise.resolve(roomRev)]);
    }
    const roomLive = !!room && (first || roomRev.rev !== seen.roomRev);
    let live = null;
    if (room && roomLive) {
        // Membership may have changed while waiting: re-check before returning room state.
        const current = await getDoc(ROOM_PATH(ctx.orgId, room.id));
        if (!current || !membersOf(current).includes(ctx.uid)) throw new HttpError(404, 'Conversation not found.');
        live = await roomLiveState(ctx, room.id, membersOf(current), str(current.data.kind) !== 'group');
    }
    return {
        live: true,
        inboxRev: inbox.rev,
        roomRev: roomRev.rev,
        roomDataRev: roomRev.dataRev,
        changed: {
            inbox: !first && inbox.rev !== seen.inboxRev,
            roomData: !first && !!room && roomRev.dataRev !== seen.roomDataRev,
            roomLive,
        },
        state: live,
        serverTime: nowIso(),
    };
}

/** Ticks for my last message in the chat list: read / delivered by every other member, with privacy applied. */
export async function lastMessageStatus(ctx: OrgContext, roomId: string, members: string[], direct: boolean, at: string): Promise<'sent' | 'delivered' | 'read'> {
    const others = members.filter((u) => u !== ctx.uid);
    if (!others.length || !at) return 'sent';
    // Delivery marks are read for individual chats only; group ticks use read marks (bounded reads per chat list).
    const [reads, delivery, mine, theirs] = await Promise.all([
        listDocs(ROOM_PATH(ctx.orgId, roomId) + '/read_marks'),
        direct ? Promise.all(others.map((u) => getDoc(DELIVERY_PATH(ctx.orgId, u)))) : Promise.resolve([] as Array<Awaited<ReturnType<typeof getDoc>>>),
        direct ? getDoc(CHAT_SETTINGS_PATH(ctx.uid)) : Promise.resolve(null),
        direct ? getDoc(CHAT_SETTINGS_PATH(others[0])) : Promise.resolve(null),
    ]);
    const receipts = !direct || (chatSettingsOf(mine?.data).readReceipts && chatSettingsOf(theirs?.data).readReceipts);
    const readAt = new Map(reads.map((d) => [d.id, str(d.data.readAt)]));
    if (receipts && others.every((u) => (readAt.get(u) ?? '') >= at)) return 'read';
    if (direct && others.every((u, i) => (str(delivery[i]?.data.at) || '') >= at || (readAt.get(u) ?? '') >= at)) return 'delivered';
    return 'sent';
}
