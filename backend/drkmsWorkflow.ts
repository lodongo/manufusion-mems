/**
 * One controlled document as the person sees it: where it is in its lifecycle, what has been done, what comes next
 * and who may do it. Read-only, except for linking the publication approval request to the document.
 *
 * Lifecycle (every step enforced by its own route):
 *   1 Draft          author registers it (from a template), uploads the source file(s), assigns sign-off
 *   2 Review         author submits; an independent reviewer at the location verifies, returns or rejects
 *   3 Sign-off       each assigned signatory signs the exact verified content
 *   4 Approval       author requests publication approval (chart of authority, Transaction governance)
 *   5 Effective      author publishes with the approved request; the revision becomes immutable
 */
import { HttpError, getDoc, isObj, listDocs, str, writeDoc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { canAt, nodePath, scopeOf } from './access';
import { record } from './org';
import { fileReleased, scanPolicy } from './drkmsScanPolicy';
import { publicationFingerprint } from './drkmsPublish';
import { transactionPayloadHash } from './unifiedApprovalProof';
import { templateByCode } from './docTemplates';
import { lifecycleSteps } from './docLifecycle';

export { lifecycleSteps, type WorkflowStep } from './docLifecycle';

const ID = /^[a-f0-9]{20}$/;
const APPROVAL_ID = /^[a-zA-Z0-9_-]{8,128}$/;
const docPath = (org: string, id: string) => `organizations/${org}/drkms_documents/${id}`;
const nodeOf = (d: Record<string, unknown>) => (isObj(d.scope) ? str(d.scope.nodeId) : '');

/** The fingerprint the publication approval must cover (same inputs as the approval packet and the publish route). */
export function documentFingerprint(id: string, d: Record<string, unknown>, files: Array<{ id: string; data: Record<string, unknown> }>): string {
    return publicationFingerprint(
        id,
        str(d.revision),
        files.map((f) => ({ fileId: f.id, sha256: str(f.data.sha256), mime: str(f.data.mime), bytes: Number(f.data.bytes) })),
        { title: str(d.title), classCode: str(d.classCode), subtypeCode: str(d.subtypeCode), scopeNodeId: nodeOf(d), verifiedBy: str(d.verifiedBy), verifiedAt: str(d.verifiedAt), updatedAt: str(d.updatedAt) },
    );
}

async function names(uids: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const uid of [...new Set(uids.filter((u) => /^[A-Za-z0-9_-]{6,128}$/.test(u)))].slice(0, 60)) {
        const u = await getDoc('users/' + uid);
        out[uid] = [str(u?.data.firstName), str(u?.data.lastName)].filter(Boolean).join(' ') || str(u?.data.email) || uid;
    }
    return out;
}

/** The document, if the person may see it: at a location where they hold the registry right, and (unpublished) as author, reviewer or signatory. */
async function visibleDocument(ctx: OrgContext, id: string) {
    if (!ID.test(id)) throw new HttpError(400, 'Invalid document identifier.');
    const doc = await getDoc(docPath(ctx.orgId, id));
    if (!doc) throw new HttpError(404, 'Document not found.');
    const node = nodeOf(doc.data);
    const path = node ? await nodePath(ctx.orgId, node) : [];
    const scope = await scopeOf(ctx);
    if (!node || !canAt(ctx, 'ADM.document_registry', path, scope)) throw new HttpError(403, 'This document is outside your organizational permissions.');
    const slots = await listDocs(`${docPath(ctx.orgId, id)}/signature_slots`);
    const status = str(doc.data.status);
    const isAuthor = str(doc.data.createdBy) === ctx.uid;
    const reviewer = !isAuthor && canAt(ctx, 'ADM.document_review', path, scope);
    const isSigner = slots.some((s) => str(s.data.signerUid) === ctx.uid);
    const open = status === 'effective' || isAuthor || isSigner || ctx.role === 'org_super_admin' || (reviewer && ['in_review', 'technical_verified'].includes(status));
    if (!open) throw new HttpError(403, 'An unpublished document is restricted to its author, reviewers and signatories.');
    return { doc, slots, path, scope, isAuthor, reviewer, isSigner };
}

export const drkmsWorkflowRoutes = {
    'POST /api/org/drkms/documents/workflow': [
        orgRoute('drkms.documents.workflow', 'ADM.document_registry', async (ctx) => {
            const id = str(ctx.body.documentId);
            const { doc, slots, path, scope, isAuthor, reviewer, isSigner } = await visibleDocument(ctx, id);
            const d = doc.data;
            const status = str(d.status);
            const files = await listDocs(`${docPath(ctx.orgId, id)}/files`);
            const policy = await scanPolicy();
            const request = isObj(d.publicationRequest) ? d.publicationRequest : null;
            const approval = request && APPROVAL_ID.test(str(request.approvalId)) ? await getDoc(`organizations/${ctx.orgId}/governance_approvals/${str(request.approvalId)}`) : null;
            const approvalStatus = approval ? str(approval.data.status) : '';
            const who = await names([str(d.createdBy), str(d.reviewedBy), str(d.verifiedBy), ...slots.map((s) => str(s.data.signerUid))]);
            const fileOut = files.map((f) => {
                const s = str(f.data.scanStatus);
                return {
                    id: f.id, name: str(f.data.name), mime: str(f.data.mime), bytes: Number(f.data.bytes) || 0, uploadedAt: str(f.data.uploadedAt),
                    state: fileReleased(f.data) ? 'released' : s === 'pending' ? 'waiting' : s === 'infected' ? 'infected' : 'failed',
                    scanned: s === 'clean', bypassed: s === 'not_required', sha256: str(f.data.sha256),
                };
            });
            const signed = slots.filter((s) => str(s.data.status) === 'signed').length;
            const template = templateByCode(str(d.templateCode));
            const fingerprint = documentFingerprint(id, d, files);
            const publishable = isAuthor && status === 'technical_verified' && canAt(ctx, 'ADM.document_publish', path, scope);
            return {
                document: {
                    id, title: str(d.title), classCode: str(d.classCode), subtypeCode: str(d.subtypeCode), status, revision: str(d.revision),
                    representation: str(d.representation), location: isObj(d.scope) ? { name: str(d.scope.name), level: str(d.scope.level) } : null,
                    author: who[str(d.createdBy)] || '', createdAt: str(d.createdAt), updatedAt: str(d.updatedAt), submittedAt: str(d.submittedAt),
                    reviewer: who[str(d.reviewedBy)] || '', reviewedAt: str(d.reviewedAt), reviewDecision: str(d.reviewDecision), reviewReason: str(d.reviewReason),
                    verifier: who[str(d.verifiedBy)] || '', verifiedAt: str(d.verifiedAt), publishedAt: str(d.publishedAt),
                    revisionReason: str(d.revisionReason), supersedesDocumentId: str(d.supersedesDocumentId), supersededByDocumentId: str(d.supersededByDocumentId),
                    templateCode: str(d.templateCode), templateName: str(d.templateName),
                    outline: template ? template.sections : (Array.isArray(d.outline) ? d.outline.map((h) => ({ heading: str(h), guidance: '' })) : []),
                    plannedSignOff: Array.isArray(d.plannedSignOff) ? d.plannedSignOff.map(str) : [],
                },
                files: fileOut,
                signatures: slots.map((s) => ({ slotId: s.id, label: str(s.data.label), signerUid: str(s.data.signerUid), signer: who[str(s.data.signerUid)] || str(s.data.signerUid), status: str(s.data.status), signedAt: str(s.data.signedAt), position: s.data.position })),
                publication: request ? { approvalId: str(request.approvalId), status: approvalStatus || 'missing', requestedAt: str(request.requestedAt), current: str(request.contentFingerprint) === fingerprint } : null,
                can: {
                    edit: isAuthor && status === 'draft',
                    submit: isAuthor && status === 'draft',
                    review: reviewer && status === 'in_review',
                    sign: isSigner && status === 'technical_verified' && slots.some((s) => str(s.data.signerUid) === ctx.uid && str(s.data.status) === 'pending'),
                    requestApproval: publishable && slots.length > 0 && signed === slots.length,
                    publish: publishable && approvalStatus === 'approved' && str(request?.contentFingerprint) === fingerprint,
                    revise: status === 'effective' && !str(d.supersededByDocumentId),
                    releaseUnscanned: isAuthor && status === 'draft' && !policy.enabled,
                },
                scanning: { enabled: policy.enabled },
                steps: lifecycleSteps({ status, files: files.length, filesWaiting: fileOut.filter((f) => f.state !== 'released').length, slots: slots.length, slotsSigned: signed, approvalStatus, digital: str(d.representation) === 'digital_structured' }),
            };
        }),
    ],
    // Links the publication approval the author requested (Transaction governance) to the document, after checking it
    // covers exactly this verified revision. The document content and its fingerprint are not changed.
    'POST /api/org/drkms/documents/publication-request': [
        orgRoute('drkms.documents.publication_request', 'ADM.document_publish', async (ctx) => {
            const id = str(ctx.body.documentId), approvalId = str(ctx.body.approvalId);
            if (!ID.test(id) || !APPROVAL_ID.test(approvalId)) throw new HttpError(400, 'Document and approval request are required.');
            const { doc, path, scope, isAuthor } = await visibleDocument(ctx, id);
            if (!isAuthor) throw new HttpError(403, 'Only the document author requests its publication.');
            if (str(doc.data.status) !== 'technical_verified') throw new HttpError(409, 'Only an independently verified document can be sent for publication approval.');
            if (!canAt(ctx, 'ADM.document_publish', path, scope)) throw new HttpError(403, 'No publication authority at this location.');
            const approval = await getDoc(`organizations/${ctx.orgId}/governance_approvals/${approvalId}`);
            if (!approval || str(approval.data.requestedBy) !== ctx.uid || str(approval.data.handlerName) !== 'drkms.documents.publish' || !['pending', 'approved'].includes(str(approval.data.status)))
                throw new HttpError(409, 'That approval request is not your pending publication request.');
            const files = await listDocs(`${docPath(ctx.orgId, id)}/files`);
            const contentFingerprint = documentFingerprint(id, doc.data, files);
            if (str(approval.data.payloadHash) !== transactionPayloadHash({ documentId: id, revision: str(doc.data.revision), contentFingerprint }))
                throw new HttpError(409, 'The approval request does not cover this exact revision. Request approval again.');
            const ok = await writeDoc(docPath(ctx.orgId, id), { ...doc.data, publicationRequest: { approvalId, contentFingerprint, requestedAt: str(approval.data.createdAt) } }, { updateTime: doc.updateTime });
            if (!ok) throw new HttpError(409, 'The document changed at the same time. Refresh and try again.');
            await record(ctx, 'drkms.document.publication_requested', id, approvalId);
            return { ok: true };
        }),
    ],
};
