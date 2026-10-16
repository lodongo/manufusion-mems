import { createHash } from 'node:crypto';
import { ws } from './platform/sdk';
import { HttpError, getDoc, listDocs, nowIso, randomId, str, updateFields, writeDoc, type Doc } from './core';
import { orgUsers } from './org';
import { signedUrl } from './structure';
import type { OrgContext } from './guards';

export const CHAT_ROOT = (orgId: string) => 'organizations/' + orgId + '/chat_rooms';
export const ROOM_PATH = (orgId: string, id: string) => CHAT_ROOT(orgId) + '/' + id;
export const MESSAGE_ROOT = (orgId: string, id: string) => ROOM_PATH(orgId, id) + '/messages';
export const TYPING_ROOT = (orgId: string, id: string) => ROOM_PATH(orgId, id) + '/typing';
export const FILE_ROOT = (orgId: string, id: string) => ROOM_PATH(orgId, id) + '/attachments';
export const ROOM_SUBS = (orgId: string, id: string) => ROOM_PATH(orgId, id) + '/connections';
export const INBOX_SUBS = (orgId: string, uid: string) => 'organizations/' + orgId + '/chat_inbox/' + uid + '/connections';
export const CONNECTION_RE = /^[A-Za-z0-9_-]{8,160}$/;
export const ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;
export const MAX_GROUP = 50;

export const membersOf = (room: Doc): string[] =>
    (Array.isArray(room.data.members) ? room.data.members : []).map(str).filter(Boolean);
export const isCurrentMember = (room: Doc, uid: string) => membersOf(room).includes(uid);

export async function checkedRoom(ctx: OrgContext, id: string): Promise<Doc> {
    if (!ID_RE.test(id)) throw new HttpError(400, 'Choose a conversation.');
    const room = await getDoc(ROOM_PATH(ctx.orgId, id));
    if (!room || !isCurrentMember(room, ctx.uid)) throw new HttpError(404, 'Conversation not found.');
    return room;
}

export async function people(ctx: OrgContext) {
    const users = await orgUsers(ctx.orgId);
    return users.filter((doc) => str(doc.data.orgId) === ctx.orgId && str(doc.data.status) !== 'disabled'
        && str(doc.data.status) !== 'suspended' && str(doc.data.role) !== 'applicant');
}
export async function verifiedPeople(ctx: OrgContext, ids: string[]) {
    const candidates = await people(ctx);
    const byUid = new Map(candidates.map((u) => [u.id, u]));
    if (ids.some((id) => !byUid.has(id))) throw new HttpError(403, 'Participants must be active users in your organization.');
    return ids.map((id) => byUid.get(id)!);
}
export function displayName(doc: Doc): string {
    return [str(doc.data.firstName), str(doc.data.lastName)].filter(Boolean).join(' ') || str(doc.data.email) || 'User';
}
export async function photoUrl(doc: Doc): Promise<string> {
    const path = str(doc.data.photoPath);
    const safe = (path.startsWith('users/' + doc.id + '/photo_')
        || path.startsWith('applications/' + doc.id + '/photo_'))
        && /^photo_[A-Za-z0-9_-]+\.(?:png|jpe?g)$/i.test(path.split('/').pop() || '');
    return safe ? signedUrl(path) : '';
}

export function directId(a: string, b: string): string {
    return 'd_' + createHash('sha256').update([a, b].sort().join(':')).digest('hex').slice(0, 35);
}
export function tokenId() { return randomId(12); }

export async function notify(ctx: OrgContext, entityType: 'chat.room' | 'chat.inbox', entityId: string,
    extra: Record<string, unknown> = {}) {
    const path = entityType === 'chat.room'
        ? ROOM_SUBS(ctx.orgId, entityId) : INBOX_SUBS(ctx.orgId, entityId);
    const subscriptions = await listDocs(path);
    const validUntil = Date.now();
    const eligible = subscriptions.filter((s) => Date.parse(str(s.data.expiresAt)) > validUntil);
    // Include no message text or files in WebSocket payloads. The recipient must
    // refetch through a separately authenticated, membership-checked API route.
    const ids = eligible.map((s) => s.id).filter((id) => CONNECTION_RE.test(id));
    const payload = { type: 'entity.update', entity_type: entityType, entity_id: entityId,
        at: nowIso(), ...extra };
    for (let i = 0; i < ids.length; i += 100) {
        try { await ws.send(ids.slice(i, i + 100), payload); }
        catch (error) { console.error('Chat websocket delivery failed', error); }
    }
}
export async function notifyRoom(ctx: OrgContext, room: Doc, extra: Record<string, unknown> = {}) {
    const people = membersOf(room);
    await Promise.all([
        notify(ctx, 'chat.room', room.id, extra),
        ...people.map((uid) => notify(ctx, 'chat.inbox', uid)),
    ]);
}
export function subscriptionExpiry() { return new Date(Date.now() + 90 * 60_000).toISOString(); }
export function chatFileUrl(ctx: OrgContext, roomId: string, path: string): Promise<string> {
    return path.startsWith('organizations/' + ctx.orgId + '/chat_files/' + roomId + '/')
        ? signedUrl(path) : Promise.resolve('');
}
