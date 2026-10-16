import { HttpError, deleteDoc, getDoc, listDocs, nowIso, randomId, str, writeDoc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { audit } from './audit';
import { actionPhotoUrl, validateActionPhoto } from './actionPhotos';
import { allowedNoteAttachments, publicNoteAttachmentUrls, sanitizedNoteHtml } from './noteFiles';

const todos = (uid: string) => 'users/' + uid + '/quick_todos';
const notes = (uid: string) => 'users/' + uid + '/quick_notes';
const validId = (id: string) => new RegExp('^[A-Za-z0-9_-]{8,40}$').test(id);
const rec = (ctx: OrgContext, action: string, name: string) => audit([{
    category: 'interaction', action, actor: ctx.actor, orgId: ctx.orgId, meta: ctx.meta,
    target: { type: 'quick_workspace', label: name },
}]);
const short = (value: unknown, limit: number) => str(value).trim().slice(0, limit);
type TodoState = 'open' | 'closed' | 'canceled';
const normalizeTodoStatus = (value: unknown): TodoState => {
    const status = str(value);
    if (status === 'closed' || status === 'done') return 'closed';
    if (status === 'canceled') return 'canceled';
    return 'open';
};
const progressOut = (value: unknown): Array<{ note: string; at: string; by: string; photoPath?: string }> =>
    (Array.isArray(value) ? value : []).filter((x): x is { note: string; at: string; by: string } =>
        !!x && typeof x === 'object' && typeof x.note === 'string' && typeof x.at === 'string'
    ).slice(-100);

export const quickPersonalRoutes = {
    'POST /api/org/quick/todo/list': [orgRoute('quick.todo.list', null, async (ctx) => ({
        items: await Promise.all((await listDocs(todos(ctx.uid))).filter(d=>str(d.data.orgId)===ctx.orgId).sort((a, b) => str(b.data.createdAt).localeCompare(str(a.data.createdAt)))
            .map(async (doc) => ({
                id: doc.id,
                ...doc.data,
                header:str(doc.data.header)||str(doc.data.action),
                body:str(doc.data.body)||str(doc.data.description),
                description:str(doc.data.description)||str(doc.data.body),
                source:'todo',sourceId:doc.id,
                status: normalizeTodoStatus(doc.data.status),
                photoUrl:await actionPhotoUrl(ctx,doc.data.photoPath),
                progressNotes:await Promise.all(progressOut(doc.data.progressNotes).map(async n=>({...n,photoUrl:await actionPhotoUrl(ctx,n.photoPath)}))),
                cancellationReason: str(doc.data.cancellationReason),
                closedAt: str(doc.data.closedAt) || (str(doc.data.status) === 'done' ? str(doc.data.updatedAt) : ''),
                canceledAt: str(doc.data.canceledAt),
            }))),
    }))],
    'POST /api/org/quick/todo/save': [orgRoute('quick.todo.save', null, async (ctx) => {
        const id = str(ctx.body.id) || randomId(12);
        if (!validId(id)) throw new HttpError(400, 'Invalid task identifier.');
        const action = short(ctx.body.action, 240);
        if (action.length < 3) throw new HttpError(400, 'Enter an action of at least 3 characters.');
        const deadline = str(ctx.body.deadline);
        if (deadline && (!new RegExp('^[0-9]{4}-[0-9]{2}-[0-9]{2}$').test(deadline) || Number.isNaN(Date.parse(deadline)))) {
            throw new HttpError(400, 'Choose a valid deadline.');
        }
        const requested = str(ctx.body.status);
        if (!['open', 'closed', 'canceled'].includes(requested)) {
            throw new HttpError(400, 'Choose Open, Closed or Canceled.');
        }
        const status = normalizeTodoStatus(requested);
        const path = todos(ctx.uid) + '/' + id;
        const old = await getDoc(path);
        if(old&&str(old.data.orgId)&&str(old.data.orgId)!==ctx.orgId)throw new HttpError(403,'This action belongs to a different organization.');
        const description=short(ctx.body.description??old?.data.description??old?.data.body,2400);
        if(!old&&description.length<3)throw new HttpError(400,'Describe the action in at least 3 characters.');
        const previous = normalizeTodoStatus(old?.data.status);
        const cancellationReason = status === 'canceled'
            ? short(ctx.body.cancellationReason || old?.data.cancellationReason, 1400) : '';
        if (status === 'canceled' && cancellationReason.length < 5) {
            throw new HttpError(400, 'A cancellation reason of at least 5 characters is required.');
        }
        const progressNote = short(ctx.body.progressNote, 1400);
        const now = nowIso();
        const notes = progressOut(old?.data.progressNotes);
        const photoPath=ctx.body.photoPath===undefined?str(old?.data.photoPath):validateActionPhoto(ctx,ctx.body.photoPath);
        if (progressNote || (ctx.body.photoPath!==undefined&&photoPath!==str(old?.data.photoPath))) notes.push({note:progressNote,at:now,by:ctx.uid,photoPath});
        await writeDoc(path, {
            action,header:action,description,body:description,source:'todo',sourceId:id,
            deadline, status, cancellationReason,photoPath,
            canceledAt: status === 'canceled' ? (previous === 'canceled' ? str(old?.data.canceledAt) || now : now) : '',
            closedAt: status === 'closed' ? (previous === 'closed' ? str(old?.data.closedAt) || now : now) : '',
            progressNotes: notes.slice(-100),
            orgId: ctx.orgId, createdAt: str(old?.data.createdAt) || now, updatedAt: now,
        });
        await rec(ctx, previous !== status ? 'quick.todo.status_changed' : 'quick.todo.save', action);
        return { id, status };
    })],
    'POST /api/org/quick/todo/delete': [orgRoute('quick.todo.delete', null, async (ctx) => {
        const id = str(ctx.body.id);
        if (!validId(id) || !await getDoc(todos(ctx.uid) + '/' + id)) throw new HttpError(404, 'Task not found.');
        await deleteDoc(todos(ctx.uid) + '/' + id);
        await rec(ctx, 'quick.todo.delete', id);
        return { ok: true };
    })],
    'POST /api/org/quick/note/list': [orgRoute('quick.note.list', null, async (ctx) => ({
        items: await Promise.all((await listDocs(notes(ctx.uid)))
            .filter(doc=>str(doc.data.orgId)===ctx.orgId)
            .sort((a, b) => str(b.data.updatedAt).localeCompare(str(a.data.updatedAt)))
            .map(async (doc) => ({ id:doc.id, ...doc.data,archivedAt:str(doc.data.archivedAt),
                attachments:await publicNoteAttachmentUrls(ctx,doc.data.attachments) }))),
    }))],
    'POST /api/org/quick/note/save': [orgRoute('quick.note.save', null, async (ctx) => {
        const id = str(ctx.body.id) || randomId(12);
        if (!validId(id)) throw new HttpError(400, 'Invalid note identifier.');
        const topic = short(ctx.body.topic, 140);
        const format=str(ctx.body.format)==='html'?'html':'markdown';
        const body=format==='html'?sanitizedNoteHtml(ctx.body.body):short(ctx.body.body,25000);
        if (!topic) throw new HttpError(400, 'Enter a topic.');
        const path = notes(ctx.uid) + '/' + id;
        const old = await getDoc(path);
        if(old&&str(old.data.orgId)!==ctx.orgId)throw new HttpError(403,'This note is outside your organization.');
        const now = nowIso();
        const attachments=allowedNoteAttachments(ctx,ctx.body.attachments===undefined?old?.data.attachments:ctx.body.attachments);
        await writeDoc(path, {topic,body,format,attachments,
            archivedAt:str(old?.data.archivedAt),orgId:ctx.orgId,
            createdAt:str(old?.data.createdAt)||now,updatedAt:now});
        await rec(ctx, 'quick.note.save', topic);
        return { id };
    })],
    'POST /api/org/quick/note/archive': [orgRoute('quick.note.archive', null, async (ctx) => {
        const id=str(ctx.body.id);
        if(!validId(id))throw new HttpError(400,'Invalid note.');
        const path=notes(ctx.uid)+'/'+id,old=await getDoc(path);
        if(!old||str(old.data.orgId)!==ctx.orgId)throw new HttpError(404,'Note not found.');
        const archive=ctx.body.archive===true;
        const updatedAt=nowIso();
        await writeDoc(path,{...old.data,archivedAt:archive?(str(old.data.archivedAt)||updatedAt):'',updatedAt});
        await rec(ctx,archive?'quick.note.archived':'quick.note.restored',id);
        return {ok:true,archived:archive};
    })],
    'POST /api/org/quick/note/delete': [orgRoute('quick.note.delete', null, async (ctx) => {
        const id = str(ctx.body.id);
        const doc=validId(id)?await getDoc(notes(ctx.uid)+'/'+id):null;
        if(!doc||str(doc.data.orgId)!==ctx.orgId)throw new HttpError(404,'Note not found.');
        await deleteDoc(notes(ctx.uid) + '/' + id);
        await rec(ctx, 'quick.note.delete', id);
        return { ok: true };
    })],
};
