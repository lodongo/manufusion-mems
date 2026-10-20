/** Metadata-only DRKMS registry. No publishing, file upload or AI output execution. */
import { HttpError, getDoc, listDocs, nowIso, randomId, str, writeDoc } from './core';
import { orgRoute } from './guards';
import { record } from './org';
import { validateDocumentLocation } from './drkmsHierarchy';
import { assessPublicationGate } from './drkmsPublicationGate';
import {canAt,scopeOf,nodePath} from './access';

const base = (orgId: string) => `organizations/${orgId}/drkms_documents`;
const validId = (v: string) => /^[a-f0-9]{20}$/.test(v);
const classes = new Set(['EXT','GOV','POL','STR','OBJ','FRW','MAN','PRG','PLN','PRO','PRC','STD','SOP','WIN','SPC','GDL','CHK','FRM','TMP','REG','REC','RPT']);

const organizationLevels = new Set(['legal_entity', 'site', 'department', 'cost_center']);
async function resolveScope(orgId: string, requestedId: string) {
    const nodes = await listDocs(`organizations/${orgId}/structure`);
    const allowed = nodes.filter(n => organizationLevels.has(str(n.data.level)) && str(n.data.status) !== 'inactive');
    if (!requestedId) return { nodes: allowed.map(n => ({ id:n.id, name:str(n.data.name), level:str(n.data.level), parentId:str(n.data.parentId) })), scope: null };
    const byId = new Map(nodes.map(n => [n.id, n]));
    const selected = byId.get(requestedId);
    if (!selected || !organizationLevels.has(str(selected.data.level)) || str(selected.data.status) === 'inactive') throw new HttpError(400, 'Choose a valid active organizational location.');
    const verifiedAncestors = validateDocumentLocation(requestedId, nodes.map(n => ({ id:n.id, level:str(n.data.level), parentId:str(n.data.parentId), status:str(n.data.status) })));
    const ancestors: string[] = [];
    const visited = new Set<string>();
    let node = selected;
    while (node) {
        if (visited.has(node.id)) throw new HttpError(400, 'Invalid cyclic organization hierarchy.');
        visited.add(node.id);
        if (str(node.data.status) === 'inactive') throw new HttpError(400, 'Inactive parent location.');
        ancestors.unshift(node.id);
        const parentId: string = str(node.data.parentId);
        if (!parentId || parentId === 'root') break;
        const parent = byId.get(parentId);
        if (!parent) throw new HttpError(400, 'Incomplete organization hierarchy.');
        node = parent;
    }
    return { nodes: allowed.map(n => ({ id:n.id, name:str(n.data.name), level:str(n.data.level), parentId:str(n.data.parentId) })),
        scope: { nodeId: selected.id, level: str(selected.data.level), name: str(selected.data.name), ancestorIds: verifiedAncestors } };
}
const configPath = (orgId: string) => `organizations/${orgId}/drkms_config/default`;
const defaults = { enabledClassCodes: Array.from(classes), defaultReviewMonths: 24, updatedAt: '' };

export const drkmsRoutes = {
    'POST /api/org/drkms/setup': [
        orgRoute('drkms.setup', 'ADM.document_registry', async ctx => {
            const [settings, locations] = await Promise.all([getDoc(configPath(ctx.orgId)), resolveScope(ctx.orgId, '')]);
            return { config: settings?.data ?? defaults, locations: locations.nodes };
        }),
    ],
    'POST /api/org/drkms/configure': [
        orgRoute('drkms.configure', 'ADM.document_config', async ctx => {
            const incoming = ctx.body.enabledClassCodes;
            if (!Array.isArray(incoming) || !incoming.length || incoming.length > classes.size ||
                incoming.some(x => typeof x !== 'string' || !classes.has(x)) ||
                new Set(incoming).size !== incoming.length) throw new HttpError(400, 'Invalid enabled document classes.');
            const months = Number(ctx.body.defaultReviewMonths);
            if (!Number.isInteger(months) || months < 1 || months > 120) throw new HttpError(400, 'Review interval must be 1–120 months.');
            const config = { enabledClassCodes: incoming, defaultReviewMonths: months, updatedAt: nowIso(), updatedBy: ctx.uid };
            await writeDoc(configPath(ctx.orgId), config);
            await record(ctx, 'drkms.configure', 'Document controls');
            return { config };
        }),
    ],
    'POST /api/org/drkms/documents/list': [
        orgRoute('drkms.documents.list', 'ADM.document_registry', async ctx => {
            const items = await listDocs(base(ctx.orgId));
            const scope = await scopeOf(ctx);
            const visible = [];
            for (const item of items) {
                const location = item.data.scope && typeof item.data.scope === 'object' && !Array.isArray(item.data.scope) ? item.data.scope as Record<string,unknown> : {};
                const nodeId = str(location.nodeId);
                if (!nodeId) continue;
                if (!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,nodeId),scope)) continue;
                if (str(item.data.status)!=='effective' && str(item.data.createdBy)!==ctx.uid && ctx.role!=='org_super_admin') continue;
                visible.push({ id: item.id, ...item.data });
            }
            return { documents: visible };
        }),
    ],
    'POST /api/org/drkms/documents/get': [
        orgRoute('drkms.documents.get', 'ADM.document_registry', async ctx => {
            const id = str(ctx.body.documentId);
            if (!validId(id)) throw new HttpError(400, 'Invalid document identifier.');
            const doc = await getDoc(`${base(ctx.orgId)}/${id}`);
            if (!doc) throw new HttpError(404, 'Document not found.');
            const location = doc.data.scope && typeof doc.data.scope === 'object' && !Array.isArray(doc.data.scope) ? doc.data.scope as Record<string,unknown> : {};
            if (!str(location.nodeId) || !canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,str(location.nodeId)),await scopeOf(ctx))) throw new HttpError(403,'Document is outside authorized scope.');
            if (str(doc.data.status)!=='effective' && str(doc.data.createdBy)!==ctx.uid && ctx.role!=='org_super_admin') throw new HttpError(403,'Unpublished document is restricted to its author.');
            return { document: { id: doc.id, ...doc.data } };
        }),
    ],
    'POST /api/org/drkms/documents/readiness': [
        orgRoute('drkms.documents.readiness', 'ADM.document_registry', async ctx => {
            const id = str(ctx.body.documentId);
            if (!validId(id)) throw new HttpError(400, 'Invalid document identifier.');
            const doc = await getDoc(`${base(ctx.orgId)}/${id}`);
            if (!doc) throw new HttpError(404, 'Document not found.');
            // This is a non-mutating diagnostic, NOT governance approval evidence.
            const d = doc.data;
            const outcome = assessPublicationGate({
                state: str(d.status), creatorUid: str(d.createdBy),
                reviewerUid: str(d.verifiedBy), hasSourceEvidence: d.hasSourceEvidence === true,
                verificationRequired: d.representation === 'ai_candidate',
                verified: d.verified === true, hasApprovalProof: false,
                validScope: !!d.scope, revisionId: str(d.effectiveRevisionId),
            });
            return { documentId: id, ...outcome, publicationEnabled: false };
        }),
    ],
    'POST /api/org/drkms/documents/submit-review': [
        orgRoute('drkms.documents.submit_review', 'ADM.document_registry', async ctx => {
            const id = str(ctx.body.documentId);
            if (!validId(id)) throw new HttpError(400, 'Invalid document identifier.');
            const path = `${base(ctx.orgId)}/${id}`;
            const document = await getDoc(path);
            if (!document) throw new HttpError(404, 'Document not found.');
            if (str(document.data.createdBy) !== ctx.uid && ctx.role !== 'org_super_admin')
                throw new HttpError(403, 'Only the document author can submit a draft.');
            if (str(document.data.status) !== 'draft')
                throw new HttpError(409, 'Only drafts can be submitted for review.');
            const scope = document.data.scope;
            if (!scope || typeof scope !== 'object' || Array.isArray(scope))
                throw new HttpError(409, 'Document has no approved organizational location.');
            const validated = await resolveScope(ctx.orgId, str((scope as Record<string, unknown>).nodeId));
            if (!validated.scope) throw new HttpError(409, 'Document location is no longer valid.');
            const submitted = await writeDoc(path, { ...document.data, status: 'in_review', submittedBy: ctx.uid, submittedAt: nowIso() }, { updateTime: document.updateTime });
            if (!submitted) throw new HttpError(409, 'Document changed while submitting. Refresh and try again.');
            await record(ctx, 'drkms.document.submit_review', id, 'Submitted for review; no approval implied');
            return { documentId: id, status: 'in_review', approvalStatus: 'awaiting_governance_configuration' };
        }),
    ],
    'POST /api/org/drkms/documents/review-decision': [
        orgRoute('drkms.documents.review_decision', 'ADM.document_review', async ctx => {
            const id = str(ctx.body.documentId), decision = str(ctx.body.decision);
            const reason = str(ctx.body.reason).trim();
            if (!validId(id) || !['return','reject'].includes(decision))
                throw new HttpError(400, 'Only return or rejection decisions are currently enabled.');
            if (reason.length < 10 || reason.length > 2000)
                throw new HttpError(400, 'Provide a meaningful review reason (10–2000 characters).');
            const path = `${base(ctx.orgId)}/${id}`;
            const doc = await getDoc(path);
            if (!doc) throw new HttpError(404, 'Document not found.');
            if (str(doc.data.status) !== 'in_review') throw new HttpError(409, 'Document is not awaiting review.');
            if (str(doc.data.createdBy) === ctx.uid || str(doc.data.submittedBy) === ctx.uid)
                throw new HttpError(403, 'The document author cannot review their own submission.');
            const scope = doc.data.scope;
            if (!scope || typeof scope !== 'object' || Array.isArray(scope))
                throw new HttpError(409, 'Document applicability is missing.');
            const nodeId = str((scope as Record<string,unknown>).nodeId);
            const {canAt,scopeOf,nodePath} = await import('./access');
            if (!canAt(ctx, 'ADM.document_review', await nodePath(ctx.orgId,nodeId), await scopeOf(ctx)))
                throw new HttpError(403, 'Reviewer has no authority at this location.');
            const revision = {
                ...doc.data, status: decision === 'return' ? 'draft' : 'rejected',
                reviewedBy: ctx.uid, reviewedAt: nowIso(), reviewDecision: decision,
                reviewReason: reason, updatedAt: nowIso(),
            };
            const updated = await writeDoc(path, revision, { updateTime: doc.updateTime });
            if (!updated) throw new HttpError(409, 'Document changed while reviewing. Refresh first.');
            await record(ctx, 'drkms.document.review_'+decision,id,reason);
            return { documentId:id, status:revision.status, publicationEnabled:false };
        }),
    ],
    'POST /api/org/drkms/documents/create-draft': [
        orgRoute('drkms.documents.create_draft', 'ADM.document_registry', async ctx => {
            const title = str(ctx.body.title).trim();
            const classCode = str(ctx.body.classCode).toUpperCase();
            if (title.length < 3 || title.length > 200) throw new HttpError(400, 'Title must contain 3–200 characters.');
            if (!classes.has(classCode)) throw new HttpError(400, 'Choose a valid document classification.');
            const requestedScopeId = str(ctx.body.scopeNodeId);
            const [settings, location] = await Promise.all([getDoc(configPath(ctx.orgId)), resolveScope(ctx.orgId, requestedScopeId)]);
            if (!location.scope) throw new HttpError(400, 'Select a legal entity, site, department or cost center.');
            const enabled = settings?.data.enabledClassCodes;
            if (Array.isArray(enabled) && !enabled.includes(classCode)) throw new HttpError(400, 'Document class disabled by organization.');
            const id = randomId(10);
            const now = nowIso();
            const document = {
                tenantId: ctx.orgId, documentId: id, classCode, title, scope: location.scope,
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
