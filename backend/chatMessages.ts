import { createHash } from 'node:crypto';
import { storage } from './platform/sdk';
import {
    HttpError, encodeValue, getDoc, isObj, listDocs, nowIso, orderDesc,
    randomId, rateLimit, runQuery, str, updateFields, writeDoc,
    type Doc,
} from './core';
import { orgRoute, type OrgContext } from './guards';
import { audit } from './audit';
import {
    ROOM_PATH, MESSAGE_ROOT, TYPING_ROOT, FILE_ROOT, checkedRoom, membersOf, isCurrentMember,
    notifyRoom, notify, chatFileUrl, ID_RE, displayName, photoUrl,
} from './chatCommon';
import { roomLiveState } from './chatLive';

/** Media, files and links shared in a room (contact / group info page), newest first. */
async function roomMedia(ctx: OrgContext, roomId: string) {
    const docs = await runQuery({ from: [{ collectionId: 'messages' }], orderBy: orderDesc('createdAt'), limit: 400 }, ROOM_PATH(ctx.orgId, roomId));
    const media: Array<Record<string, unknown>> = [];
    const links: Array<Record<string, unknown>> = [];
    for (const doc of docs) {
        const d = doc.data;
        if (d.deletedForAll === true) continue;
        const raw = isObj(d.attachment) ? d.attachment : {};
        if (str(raw.path) && media.length < 120) {
            media.push({ messageId: doc.id, kind: str(raw.kind), name: str(raw.name), mime: str(raw.mime), size: Number(raw.size) || 0,
                url: await chatFileUrl(ctx, roomId, str(raw.path)), createdAt: str(d.createdAt), senderUid: str(d.senderUid) });
        }
        for (const url of str(d.text).match(/https?:\/\/[^\s<>]+/g) ?? []) if (links.length < 80) links.push({ messageId: doc.id, url, createdAt: str(d.createdAt), senderUid: str(d.senderUid) });
    }
    return { media, links };
}

const DELETE_WINDOW_MS = 3 * 60_000;
const EMOJIS = new Set(['👍','❤️','😂','🎉','🙏','👏','✅','👀','🔥','😮','😢','💯']);
const SUPPORTED: Record<string, { ext: string; max: number }> = {
    'image/jpeg': { ext: 'jpg', max: 4_000_000 },
    'image/png': { ext: 'png', max: 4_000_000 },
    'image/webp': { ext: 'webp', max: 4_000_000 },
    'application/pdf': { ext: 'pdf', max: 5_000_000 },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', max: 5_000_000 },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', max: 5_000_000 },
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: 'pptx', max: 5_000_000 },
    'text/csv': { ext: 'csv', max: 1_500_000 },
    'text/plain': { ext: 'txt', max: 1_500_000 },
};
type Attachment = { id: string; path: string; name: string; mime: string; size: number; kind: string };
const pathFor = (ctx: OrgContext, roomId: string, msgId: string) => MESSAGE_ROOT(ctx.orgId, roomId) + '/' + msgId;
const auditChat = (ctx: OrgContext, action: string, roomId: string, messageId?: string) => audit([{
    category: 'interaction', action, actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId,
    target: { type: 'chat', id: messageId || roomId },
    details: 'Chat room ' + roomId,
}]);

function sniff(file: Buffer, mime: string): boolean {
    if (mime === 'image/jpeg') return file.length > 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff;
    if (mime === 'image/png') return file.length > 8 && file.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if (mime === 'image/webp') return file.length > 12 && file.subarray(0,4).toString('latin1') === 'RIFF' && file.subarray(8,12).toString('latin1') === 'WEBP';
    if (mime === 'application/pdf') return file.length > 4 && file.subarray(0,4).toString('latin1') === '%PDF';
    if (mime.includes('openxmlformats-officedocument')) return file.length > 4 && file.subarray(0,2).toString('latin1') === 'PK';
    if (mime === 'text/csv' || mime === 'text/plain') {
        return !file.includes(0) && !file.toString('utf8').includes('\uFFFD')
            && !/^\s*<(!doctype|html|script|svg)/i.test(file.toString('utf8'));
    }
    return false;
}
async function messageOutput(ctx: OrgContext, roomId: string, msg: Doc) {
    const d = msg.data;
    const deleted = d.deletedForAll === true;
    const raw = isObj(d.attachment) ? d.attachment : {};
    const path = deleted ? '' : str(raw.path);
    const replyId = str(d.replyTo);
    const parent = replyId && ID_RE.test(replyId) ? await getDoc(pathFor(ctx, roomId, replyId)) : null;
    return {
        id: msg.id, roomId,
        senderUid: str(d.senderUid), text: deleted ? '' : str(d.text),
        createdAt: str(d.createdAt), deletedForAll: deleted,
        eventKind: str(d.eventKind), referenceId: str(d.referenceId),
        deletedAt: str(d.deletedAt), editedAt: str(d.editedAt),
        attachment: path ? {
            id: str(raw.id), name: str(raw.name), mime: str(raw.mime),
            size: typeof raw.size === 'number' ? raw.size : 0,
            kind: str(raw.kind), url: await chatFileUrl(ctx, roomId, path),
        } : null,
        replyTo: parent ? { id: parent.id, senderUid: str(parent.data.senderUid),
            text: parent.data.deletedForAll === true ? 'Message deleted' : str(parent.data.text).slice(0, 170),
            attachment: parent.data.deletedForAll === true ? '' : str((isObj(parent.data.attachment) ? parent.data.attachment : {}).name),
            imageUrl: parent.data.deletedForAll === true ? '' : (
                isObj(parent.data.attachment) && str(parent.data.attachment.kind) === 'image'
                    ? await chatFileUrl(ctx,roomId,str(parent.data.attachment.path)) : ''),
        } : null,
        reactions: deleted ? {} : isObj(d.reactions) ? d.reactions : {},
    };
}
async function roomHistory(ctx: OrgContext, roomId: string, before: string) {
    const query: Record<string, unknown> = {
        from: [{ collectionId: 'messages' }], orderBy: orderDesc('createdAt'), limit: 61,
    };
    if (before) query.where = { fieldFilter: {
        field: { fieldPath: 'createdAt' }, op: 'LESS_THAN', value: encodeValue(before),
    } };
    const docs = await runQuery(query, ROOM_PATH(ctx.orgId, roomId));
    const hasMore = docs.length > 60;
    return {
        messages: await Promise.all(docs.slice(0, 60).reverse().map((doc) => messageOutput(ctx, roomId, doc))),
        hasMore,
        before: hasMore ? str(docs[59]?.data.createdAt) : '',
    };
}
export const chatMessageRoutes = {
    'POST /api/org/quick/chat/room': [orgRoute('chat.room.read', null, async (ctx) => {
        const roomId = str(ctx.body.roomId);
        const room = await checkedRoom(ctx, roomId);
        if (ctx.body.media === true) return roomMedia(ctx, roomId);
        const before = str(ctx.body.before);
        if (before && (!Number.isFinite(Date.parse(before)) || before.length > 40)) throw new HttpError(400, 'Invalid history page.');
        const [messages, profiles, live] = await Promise.all([
            roomHistory(ctx, roomId, before),
            Promise.all(membersOf(room).map(async (uid) => {
                const doc = await getDoc('users/' + uid);
                if (!doc || str(doc.data.orgId) !== ctx.orgId) return { uid, name: 'Former member', photoUrl: '' };
                return { uid, name: displayName(doc), photoUrl: await photoUrl(doc) };
            })),
            roomLiveState(ctx, roomId, membersOf(room), str(room.data.kind) !== 'group'),
        ]);
        return {
            room: { id: room.id, ...room.data, sendPolicy: str(room.data.sendPolicy) === 'admins' ? 'admins' : 'all', infoPolicy: str(room.data.infoPolicy) === 'all' ? 'all' : 'admins' },
            people: profiles, ...messages,
            ...live,
            serverTime: nowIso(),
        };
    })],
    'POST /api/org/quick/chat/send': [orgRoute('chat.message.send', null, async (ctx) => {
        const roomId = str(ctx.body.roomId);
        const room = await checkedRoom(ctx, roomId);
        await rateLimit('chat-message', ctx.uid, 120, 60);
        if (str(room.data.kind) === 'group' && str(room.data.sendPolicy) === 'admins'
            && !(Array.isArray(room.data.admins) && room.data.admins.map(str).includes(ctx.uid))) {
            throw new HttpError(403, 'Only group administrators can send messages in this group.');
        }
        const text = str(ctx.body.text).trim();
        if (text.length > 4000) throw new HttpError(400, 'Messages can contain up to 4000 characters.');
        const attachmentId = str(ctx.body.attachmentId);
        let attachment: Attachment | null = null;
        if (attachmentId) {
            if (!ID_RE.test(attachmentId)) throw new HttpError(400, 'Invalid attachment.');
            const meta = await getDoc(FILE_ROOT(ctx.orgId, roomId) + '/' + attachmentId);
            if (!meta || str(meta.data.ownerUid) !== ctx.uid || str(meta.data.usedBy)) {
                throw new HttpError(403, 'Choose an unused attachment you uploaded to this conversation.');
            }
            attachment = { id: attachmentId, path: str(meta.data.path), name: str(meta.data.name),
                mime: str(meta.data.mime), kind: str(meta.data.kind),
                size: Number(meta.data.size) || 0 };
        }
        if (!text && !attachment) throw new HttpError(400, 'Type a message or attach a file.');
        const parentId = str(ctx.body.replyTo);
        if (parentId && (!ID_RE.test(parentId) || !(await getDoc(pathFor(ctx, roomId, parentId))))) {
            throw new HttpError(400, 'Choose a reply from this conversation.');
        }
        const clientId = str(ctx.body.clientId);
        if (!ID_RE.test(clientId)) throw new HttpError(400, 'Invalid send token.');
        const id = 'm_' + createHash('sha256').update(ctx.uid + ':' + roomId + ':' + clientId).digest('hex').slice(0, 35);
        const path = pathFor(ctx, roomId, id);
        const now = nowIso();
        const wrote = await writeDoc(path, {
            senderUid: ctx.uid, text, replyTo: parentId,
            attachment: attachment || {}, reactions: {},
            deletedForAll: false, createdAt: now, deletedAt: '',
        }, { exists: false });
        const saved = wrote ? await getDoc(path) : await getDoc(path);
        if (!saved || str(saved.data.senderUid) !== ctx.uid) throw new HttpError(409, 'Message could not be reconciled.');
        if (wrote) {
            if (attachment) {
                await updateFields(FILE_ROOT(ctx.orgId, roomId) + '/' + attachmentId, { usedBy: id });
            }
            await updateFields(ROOM_PATH(ctx.orgId, roomId), {
                lastMessage: text.slice(0, 180) || (attachment ? (attachment.kind === 'image' ? '📷 Photo' : '📄 ' + attachment.name) : ''),
                lastMessageKind: attachment ? attachment.kind : 'text',
                lastSenderUid: ctx.uid, lastMessageId: id, lastMessageAt: now, updatedAt: now,
            });
            await auditChat(ctx, 'chat.message.send', roomId, id);
            await notifyRoom(ctx, room);
        }
        return { message: await messageOutput(ctx, roomId, saved) };
    })],
    'POST /api/org/quick/chat/upload': [orgRoute('chat.attachment.upload', null, async (ctx) => {
        const roomId = str(ctx.body.roomId);
        await checkedRoom(ctx, roomId);
        await rateLimit('chat-upload', ctx.uid, 40, 3600);
        const mime = str(ctx.body.mime).toLowerCase();
        const kind = SUPPORTED[mime];
        if (!kind) throw new HttpError(400, 'Use a JPG, PNG, WebP, PDF, Excel, Word, PowerPoint, CSV or text file.');
        const name = str(ctx.body.name).split(/[\\/]/).pop()?.trim().slice(0, 125) || 'attachment.' + kind.ext;
        const data = str(ctx.body.data);
        if (!data || data.length > Math.ceil(kind.max * 4 / 3) + 8 || !/^[A-Za-z0-9+/=]+$/.test(data)) {
            throw new HttpError(413, 'The attachment exceeds the size allowed for this format.');
        }
        const decoded = Buffer.from(data, 'base64');
        if (!decoded.length || decoded.length > kind.max || !sniff(decoded, mime)) {
            throw new HttpError(400, 'The uploaded file does not match its format or size limit.');
        }
        const id = 'a_' + randomId(13);
        const path = 'organizations/' + ctx.orgId + '/chat_files/' + roomId + '/' + ctx.uid + '/' + id + '.' + kind.ext;
        const [ok] = await storage.write([{ path, content: data, contentType: mime }]);
        if (!ok) throw new HttpError(502, 'Unable to store the attachment.');
        const meta = { path, name, mime, kind: mime.startsWith('image/') ? 'image' : 'file',
            size: decoded.length, ownerUid: ctx.uid, uploadedAt: nowIso(), usedBy: '' };
        try {
            await writeDoc(FILE_ROOT(ctx.orgId, roomId) + '/' + id, meta, { exists: false });
        } catch (error) {
            await storage.delete([path]).catch(() => undefined);
            throw error;
        }
        await auditChat(ctx, 'chat.attachment.upload', roomId, id);
        return { attachment: { id, name, mime, size: decoded.length, kind: meta.kind,
            url: await chatFileUrl(ctx, roomId, path) } };
    })],
    'POST /api/org/quick/chat/delete': [orgRoute('chat.message.delete', null, async (ctx) => {
        const roomId = str(ctx.body.roomId), messageId = str(ctx.body.messageId);
        await checkedRoom(ctx, roomId);
        if (!ID_RE.test(messageId)) throw new HttpError(400, 'Invalid message.');
        const path = pathFor(ctx, roomId, messageId);
        const message = await getDoc(path);
        if (!message) throw new HttpError(404, 'Message not found.');
        if (str(message.data.senderUid) !== ctx.uid || str(message.data.eventKind) || message.data.systemUpdate===true) throw new HttpError(403, 'System action updates cannot be deleted as ordinary messages.');
        if (message.data.deletedForAll === true) return { deleted: true };
        const age = Date.now() - Date.parse(str(message.data.createdAt));
        if (!Number.isFinite(age) || age < 0 || age > DELETE_WINDOW_MS) {
            throw new HttpError(409, 'You can only delete a sent message for everyone within three minutes.');
        }
        const att = isObj(message.data.attachment) ? message.data.attachment : {};
        await updateFields(path, {
            text: '', attachment: {}, deletedForAll: true, deletedAt: nowIso(), reactions: {},
        });
        const attPath = str(att.path);
        if (attPath.startsWith('organizations/' + ctx.orgId + '/chat_files/' + roomId + '/' + ctx.uid + '/')) {
            try { await storage.delete([attPath]); }
            catch (error) { console.error('Chat attachment cleanup failed', error); }
        }
        await auditChat(ctx, 'chat.message.delete_all', roomId, messageId);
        const room = await checkedRoom(ctx, roomId);
        if (str(room.data.lastMessageId) === messageId) {
            await updateFields(ROOM_PATH(ctx.orgId, roomId), {
                lastMessage: 'Message deleted', updatedAt: nowIso(),
            });
        }
        await notifyRoom(ctx, room);
        return { deleted: true };
    })],
    'POST /api/org/quick/chat/react': [orgRoute('chat.message.react', null, async (ctx) => {
        const roomId = str(ctx.body.roomId), messageId = str(ctx.body.messageId);
        await checkedRoom(ctx, roomId);
        if (!ID_RE.test(messageId)) throw new HttpError(400, 'Invalid message.');
        const emoji = str(ctx.body.emoji);
        if (!EMOJIS.has(emoji)) throw new HttpError(400, 'Choose an available reaction.');
        const path = pathFor(ctx, roomId, messageId);
        const message = await getDoc(path);
        if (!message || message.data.deletedForAll === true) throw new HttpError(404, 'Message unavailable.');
        const existing = isObj(message.data.reactions) ? message.data.reactions : {};
        const current = Array.isArray(existing[emoji]) ? existing[emoji].map(str) : [];
        const members = await checkedRoom(ctx, roomId);
        const cleaned = current.filter((uid) => membersOf(members).includes(uid) && uid !== ctx.uid);
        const next = current.includes(ctx.uid) ? cleaned : [...cleaned, ctx.uid];
        await updateFields(path, { reactions: { ...existing, [emoji]: next } });
        await notify(ctx, 'chat.room', roomId);
        return { reactions: { ...existing, [emoji]: next } };
    })],
    'POST /api/org/quick/chat/typing': [orgRoute('chat.typing', null, async (ctx) => {
        const roomId = str(ctx.body.roomId);
        await checkedRoom(ctx, roomId);
        await rateLimit('chat-typing', ctx.uid, 75, 60);
        const active = ctx.body.active === true;
        const until = new Date(Date.now() + (active ? 7500 : -1000)).toISOString();
        await writeDoc(TYPING_ROOT(ctx.orgId, roomId) + '/' + ctx.uid, { until, updatedAt: nowIso() });
        await notify(ctx, 'chat.room', roomId, { event: 'typing', uid: ctx.uid, active, until });
        return { active };
    })],
    'POST /api/org/quick/chat/presence': [orgRoute('chat.presence', null, async (ctx) => {
        const roomId = str(ctx.body.roomId);
        await checkedRoom(ctx, roomId);
        const active = ctx.body.active === true;
        const until = new Date(Date.now() + (active ? 90_000 : -1000)).toISOString();
        await writeDoc(ROOM_PATH(ctx.orgId, roomId) + '/presence/' + ctx.uid,
            { until, updatedAt: nowIso() });
        await notify(ctx, 'chat.room', roomId, { event: 'presence', uid: ctx.uid, active, until });
        return { active };
    })],
    'POST /api/org/quick/chat/read': [orgRoute('chat.read', null, async (ctx) => {
        const roomId = str(ctx.body.roomId);
        await checkedRoom(ctx, roomId);
        await writeDoc(ROOM_PATH(ctx.orgId, roomId) + '/read_marks/' + ctx.uid,
            { readAt: nowIso(), uid: ctx.uid });
        await notify(ctx, 'chat.room', roomId, { event: 'read', uid: ctx.uid });
        return { ok: true };
    })],
};
