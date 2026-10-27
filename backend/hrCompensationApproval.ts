/**
 * Compensation, benefits and leave-entitlement policy activation.
 *
 * Saving a compensation configuration only ever changes a DRAFT. Nothing reads the draft for live
 * decisions. The draft becomes the ACTIVE policy (used for leave entitlement and, later, payroll) only
 * through a cost-bearing request in the shared Finance request engine:
 *  - maker-checker: the submitter can never approve, and nobody may approve two levels;
 *  - Chart of Authority: approval levels come from the legal entity's authority bands for the stated
 *    annual cost impact, each level resolved to a job role (ROL_ code) held by someone other than the maker;
 *  - the approver needs HRM.compensation.approve for that legal entity (security role
 *    "HR – Compensation Approver");
 *  - the approved draft is fingerprinted: if it changed after submission, approval is refused;
 *  - every step is written to the request history and the audit trail.
 */
import { createHash } from 'node:crypto';
import { HttpError, fieldEq, getDoc, isObj, nowIso, runQuery, str, writeDoc, type Fields } from './core';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { cannotDecide, createRequest, nameOf, objs, P, reasonOf, registerHandler, scopeOf, unitsOf, withLock, type Obj, type Step } from './finCore';
import { decideRequest } from './finRoutes';
import { hrAudit } from './hrAudit';
import type { PayConfig } from './hrCompensationConfig';

export const COMPENSATION_REQUEST = 'hr.compensation.activate';
export const COMPENSATION_APPROVE = 'HRM.compensation.approve';
const draftPath = (org: string, entity: string) => `organizations/${org}/hr_compensation_config/${entity}`;
export const activePath = (org: string, entity: string) => `organizations/${org}/hr_compensation_active/${entity}`;
const historyPath = (org: string, entity: string, version: number) => `${activePath(org, entity)}/history/v${String(version).padStart(6, '0')}`;
const scopeKey = (entity: string) => 'hr.compensation.' + entity;
const ENTITY = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_COST = 1e13;

/** Stable fingerprint of the policy content (excludes audit/version metadata). */
export function policyDigest(config: Record<string, unknown>): string {
    const content = { countryCode: str(config.countryCode), currency: str(config.currency), items: Array.isArray(config.items) ? config.items : [] };
    return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
const isSettingsAdmin = (ctx: OrgContext) => ctx.role === 'org_super_admin' || hasPerm(ctx.directPermissions, 'ADM.settings');
const mayApproveSomewhere = (ctx: OrgContext) => ctx.role === 'org_super_admin' || hasPerm(ctx.permissions, COMPENSATION_APPROVE);

function summary(config: PayConfig) {
    const items = Array.isArray(config.items) ? config.items : [];
    const enabled = items.filter((x) => x.enabled);
    return {
        itemCount: items.length,
        enabledCount: enabled.length,
        leaveTypes: enabled.filter((x) => x.category === 'leave').map((x) => x.code).slice(0, 40),
        mandatoryCount: enabled.filter((x) => x.mandatory).length,
    };
}

registerHandler(COMPENSATION_REQUEST, {
    label: 'HR compensation, benefits & leave policy activation',
    approvePerm: COMPENSATION_APPROVE,
    valued: true,
    apply: async (ctx, req, id) => {
        const entity = str(req.leId);
        const payload = isObj(req.payload) ? req.payload : {};
        if (!ENTITY.test(entity)) throw new HttpError(409, 'Request legal entity is invalid.');
        return withLock(ctx.orgId, 'hr_compensation_' + entity, async () => {
            const draft = await getDoc(draftPath(ctx.orgId, entity));
            if (!draft) throw new HttpError(409, 'The compensation draft no longer exists. Reject this request.');
            if (Number(draft.data.version || 0) !== Number(payload.draftVersion) || policyDigest(draft.data) !== str(payload.digest))
                throw new HttpError(409, 'The compensation draft changed after this request was submitted. Reject it and submit the current draft.');
            const prior = await getDoc(activePath(ctx.orgId, entity));
            const activeVersion = Number(prior?.data.activeVersion || 0) + 1;
            const at = nowIso();
            const active = {
                ...draft.data,
                status: 'active',
                activeVersion,
                version: activeVersion,
                sourceDraftVersion: Number(payload.draftVersion),
                digest: str(payload.digest),
                approvalRef: id,
                annualCostImpact: Number(req.amount ?? 0),
                activatedAt: at,
                activatedBy: ctx.uid,
                submittedBy: str(req.makerUid),
            };
            if (!(await writeDoc(historyPath(ctx.orgId, entity, activeVersion), active as unknown as Fields, { exists: false })))
                throw new HttpError(409, 'This policy version was activated concurrently. Refresh and check the active version.');
            if (!(await writeDoc(activePath(ctx.orgId, entity), active as unknown as Fields, prior ? { updateTime: prior.updateTime } : { exists: false })))
                throw new HttpError(409, 'The active policy changed concurrently. Refresh and retry.');
            await hrAudit(ctx, 'compensation.activated', { type: 'legal_entity', id: entity }, `version=${activeVersion} draft=${Number(payload.draftVersion)} request=${id}`);
            return { legalEntityId: entity, activeVersion, draftVersion: Number(payload.draftVersion) };
        });
    },
});

/** Activation status shown beside the draft. */
export async function compensationStatus(org: string, entity: string) {
    const [active, open] = await Promise.all([
        getDoc(activePath(org, entity)),
        runQuery({ from: [{ collectionId: 'fin_requests' }], where: fieldEq('scopeKey', scopeKey(entity)) }, `organizations/${org}`),
    ]);
    const pending = open.find((x) => str(x.data.status) === 'pending');
    return {
        active: active
            ? { version: Number(active.data.activeVersion || 0), sourceDraftVersion: Number(active.data.sourceDraftVersion || 0), approvalRef: str(active.data.approvalRef), activatedAt: str(active.data.activatedAt), digest: str(active.data.digest) }
            : null,
        pendingRequestId: pending?.id || '',
    };
}

function requestRow(ctx: OrgContext, d: { id: string; data: Obj }, units: Awaited<ReturnType<typeof unitsOf>>, scope: Awaited<ReturnType<typeof scopeOf>>) {
    const steps = objs(d.data.steps) as unknown as Step[];
    const payload = isObj(d.data.payload) ? d.data.payload : {};
    const why = cannotDecide(ctx, d.data, units, scope);
    return {
        id: d.id,
        legalEntityId: str(d.data.leId),
        legalEntityName: units.get(str(d.data.leId))?.name || str(d.data.leId),
        title: str(d.data.title),
        status: str(d.data.status),
        amount: d.data.amount ?? null,
        currency: str(payload.currency),
        draftVersion: Number(payload.draftVersion || 0),
        enabledCount: Number(payload.enabledCount || 0),
        leaveTypes: Array.isArray(payload.leaveTypes) ? payload.leaveTypes.map(str) : [],
        reason: str(d.data.reason),
        makerName: str(d.data.makerName),
        mine: str(d.data.makerUid) === ctx.uid,
        createdAt: str(d.data.createdAt),
        decidedAt: str(d.data.decidedAt),
        canDecide: !why,
        whyNot: why,
        steps: steps.map((s) => ({ level: s.level, title: s.title, positionTitle: s.positionTitle, status: s.status, byName: s.byName, at: s.at })),
        history: objs(d.data.history).map((h) => ({ at: str(h.at), byName: str(h.byName), action: str(h.action), note: str(h.note) })).slice(-20),
    };
}

async function loadRequest(ctx: OrgContext, id: string) {
    if (!/^FCR\d{8}$/.test(id)) throw new HttpError(404, 'Request not found.');
    const d = await getDoc(P(ctx.orgId).request(id));
    if (!d || str(d.data.type) !== COMPENSATION_REQUEST) throw new HttpError(404, 'Request not found.');
    return d;
}

export const hrCompensationApprovalRoutes = {
    'POST /api/org/hr/compensation/submit': [
        orgRoute('org.hr.compensation.submit', 'ADM.settings', async (ctx) => {
            if (!isSettingsAdmin(ctx)) throw new HttpError(403, 'Organization settings administrator required.');
            const entity = str(ctx.body.legalEntityId);
            if (!ENTITY.test(entity)) throw new HttpError(400, 'Select a legal entity.');
            const reason = reasonOf(ctx.body);
            const cost = Number(ctx.body.annualCostImpact);
            if (!Number.isFinite(cost) || cost < 0 || cost > MAX_COST) throw new HttpError(400, 'Enter the estimated annual cost impact (0 or more) in the legal entity currency.');
            if (ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that the draft has been reviewed against the law and the cost estimate.');
            const draft = await getDoc(draftPath(ctx.orgId, entity));
            if (!draft) throw new HttpError(409, 'Save the compensation draft before submitting it for activation.');
            const config = draft.data as unknown as PayConfig;
            if (Number(ctx.body.expectedVersion) !== Number(config.version || 0)) throw new HttpError(409, 'The draft changed since you opened it. Reload before submitting.');
            const digest = policyDigest(draft.data);
            const status = await compensationStatus(ctx.orgId, entity);
            if (status.active && status.active.digest === digest) throw new HttpError(409, 'This draft is already the active policy.');
            const s = summary(config);
            const out = await createRequest(ctx, {
                leId: entity,
                type: COMPENSATION_REQUEST,
                scopeKey: scopeKey(entity),
                title: `Activate compensation policy draft v${config.version}`,
                summary: `${s.enabledCount} enabled pay, benefit and leave items (${s.leaveTypes.length} leave types). Estimated annual cost impact ${config.currency} ${cost.toLocaleString('en')}.`,
                payload: { draftVersion: Number(config.version || 0), digest, currency: str(config.currency), countryCode: str(config.countryCode), ...s, annualCostImpact: cost } as Obj,
                amount: cost,
                reason,
            });
            await hrAudit(ctx, 'compensation.activation.submit', { type: 'legal_entity', id: entity }, `draft=${config.version} request=${out.id} cost=${cost}`);
            return { ok: true, id: out.id };
        }),
    ],
    'POST /api/org/hr/compensation/requests': [
        orgRoute('org.hr.compensation.requests', 'HRM.shell.view', async (ctx) => {
            const admin = isSettingsAdmin(ctx);
            const approver = mayApproveSomewhere(ctx);
            const [docs, units, scope] = await Promise.all([
                runQuery({ from: [{ collectionId: 'fin_requests' }], where: fieldEq('type', COMPENSATION_REQUEST) }, `organizations/${ctx.orgId}`),
                unitsOf(ctx.orgId),
                scopeOf(ctx),
            ]);
            const rows = docs
                .filter((d) => admin || approver || str(d.data.makerUid) === ctx.uid)
                .map((d) => requestRow(ctx, d, units, scope))
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, 500);
            return { requests: rows, canSubmit: admin, canApprove: approver };
        }),
    ],
    'POST /api/org/hr/compensation/decide': [
        orgRoute('org.hr.compensation.decide', 'HRM.shell.view', async (ctx) => {
            const id = str(ctx.body.id);
            const decision = str(ctx.body.decision);
            if (decision !== 'approve' && decision !== 'reject') throw new HttpError(400, 'Approve or reject.');
            const note = decision === 'reject' ? reasonOf(ctx.body) : str(ctx.body.reason).replace(/\s+/g, ' ').trim().slice(0, 300);
            if (decision === 'approve' && ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that you have reviewed the policy and its cost before approving.');
            await loadRequest(ctx, id);
            const result = await decideRequest(ctx, id, decision, note, (d) => {
                if (str(d.data.type) !== COMPENSATION_REQUEST) throw new HttpError(404, 'Request not found.');
            });
            await hrAudit(ctx, 'compensation.activation.' + decision, { type: 'request', id }, 'status=' + str((result as Obj).status));
            return result;
        }),
    ],
    'POST /api/org/hr/compensation/withdraw': [
        orgRoute('org.hr.compensation.withdraw', 'HRM.shell.view', async (ctx) => {
            const id = str(ctx.body.id);
            const reason = reasonOf(ctx.body);
            return withLock(ctx.orgId, `req_${id}`, async () => {
                const d = await loadRequest(ctx, id);
                if (str(d.data.makerUid) !== ctx.uid) throw new HttpError(404, 'Request not found.');
                if (str(d.data.status) !== 'pending') throw new HttpError(409, 'Only a pending request can be withdrawn.');
                const at = nowIso();
                const ok = await writeDoc(P(ctx.orgId).request(id), { ...d.data, status: 'withdrawn', decidedAt: at, history: [...objs(d.data.history), { at, by: ctx.uid, byName: nameOf(ctx.me), action: 'withdrawn', note: reason }] } as unknown as Fields, { updateTime: d.updateTime });
                if (!ok) throw new HttpError(409, 'The request changed at the same time. Refresh and retry.');
                await hrAudit(ctx, 'compensation.activation.withdraw', { type: 'request', id }, '');
                return { ok: true };
            });
        }),
    ],
};
