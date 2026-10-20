/** Metadata-only DRKMS registry. No publishing, file upload or AI output execution. */
import { HttpError, getDoc, listDocs, nowIso, randomId, str, writeDoc } from './core';
import { orgRoute } from './guards';
import { record } from './org';

const base = (orgId: string) => `organizations/${orgId}/drkms_documents`;
const validId = (v: string) => /^[a-f0-9]{20}$/.test(v);
const classes = new Set(['EXT','GOV','POL','STR','OBJ','FRW','MAN','PRG','PLN','PRO','PRC','STD','SOP','WIN','SPC','GDL','CHK','FRM','TMP','REG','REC','RPT']);

export const drkmsRoutes = {
    'POST /api/org/drkms/documents/list': [
        orgRoute('drkms.documents.list', 'ADM.roles', async ctx => {
            const items = await listDocs(base(ctx.orgId));
            return { documents: items.map(x => ({ id: x.id, ...x.data })) };
        }),
    ],
    'POST /api/org/drkms/documents/get': [
        orgRoute('drkms.documents.get', 'ADM.roles', async ctx => {
            const id = str(ctx.body.documentId);
            if (!validId(id)) throw new HttpError(400, 'Invalid document identifier.');
            const doc = await getDoc(`${base(ctx.orgId)}/${id}`);
            if (!doc) throw new HttpError(404, 'Document not found.');
            return { document: { id: doc.id, ...doc.data } };
        }),
    ],
    'POST /api/org/drkms/documents/create-draft': [
        orgRoute('drkms.documents.create_draft', 'ADM.roles', async ctx => {
            const title = str(ctx.body.title).trim();
            const classCode = str(ctx.body.classCode).toUpperCase();
            if (title.length < 3 || title.length > 200) throw new HttpError(400, 'Title must contain 3–200 characters.');
            if (!classes.has(classCode)) throw new HttpError(400, 'Choose a valid document classification.');
            const id = randomId(10);
            const now = nowIso();
            const document = {
                tenantId: ctx.orgId, documentId: id, classCode, title,
                status: 'draft', representation: 'native', digitalMaturity: 'D0',
                revision: '00', ownerUid: ctx.uid, createdBy: ctx.uid,
                createdAt: now, updatedAt: now, securityClass: 'internal',
                effectiveRevisionId: '', verified: false,
            };
            const created = await writeDoc(`${base(ctx.orgId)}/${id}`, document, { exists: false });
            if (!created) throw new HttpError(409, 'Identifier conflict, please try again.');
            await record(ctx, 'drkms.document.create_draft', id, classCode);
            return { document };
        }),
    ],
};
