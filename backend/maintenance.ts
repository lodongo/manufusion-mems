import { storage } from './platform/sdk';
import { commit, withLock } from './finCore';
import { enforceMaintenanceTransition, executeMaintenanceAction } from './maintenanceOperations';
import { requireMaintenanceRole } from './maintenanceAccess';
import { prepareMaintenanceAssessment } from './maintenanceAssessmentIntegration';
import { resolveMaintenanceEquipmentAsset } from './maintenanceAssetLink';
import { assessmentReviewCurrent, approvedAssessmentSnapshot, reviewAssessmentPrerequisites } from './maintenanceAssessmentReview';
import { HttpError, getDoc, isObj, listDocs, nowIso, randomId, rateLimit, runQuery, fieldEq, str, updateFields, writeDoc, type Doc, type Obj, type Plain } from './core';
import { audit } from './audit';
import { orgRoute, type OrgContext } from './guards';
import { nextOrgCounter } from './positions';
import { detectImage } from './branding';
import { DEFAULT_MODULE_METADATA } from './moduleDefaults';
import { SAF_DEFAULT_LISTS } from './safDefaults';
import { ID_RE, col, signedUrl } from './structure';
import { canAnywhere, canAt, scopeOf,nodePath, type Scope } from './access';
import { searchCatalog,serviceCatalogHierarchy } from './procurement';
import {MAINTENANCE_GATES,maintenanceGateReadiness} from './maintenanceWorkflowConfig';
import {validateAssessmentTasks,summarizeAssessmentTasks,assessmentTaskSummaries,type AssessedTask} from './maintenanceTaskAssessment';
import {defaultMaintenanceRiskMatrix,finalizeAssessedTaskRisks,type RiskMatrix} from './maintenanceTaskRisk';

// ---------------------------------------------------------------------------
// Maintenance Management (MNT)
//
// Work request  organizations/{orgId}/work_requests/{WR00000001}   (counter organizations/{orgId}.wrSeq)
//   submitted -> under_review -> assessment approved -> converted (locked, linked to the work order)
//                             -> returned (requester adds information, resubmits) -> submitted
//                             -> declined (with reason)
//   submitted | returned -> cancelled (requester, with reason)
//
// Work order    organizations/{orgId}/work_orders/{WO00000001}     (counter organizations/{orgId}.woSeq)
//   planning -> plan_ready -> released -> scheduled -> in_progress -> completed -> verified -> closed
//   planning..scheduled -> cancelled ; verified | closed -> in_progress (reopen, restricted)
//
// Every activity is a permission (MNT.WR.review, MNT.WO.plan, ...) checked at the record's location, so a
// person only acts where their job role (or direct security role) applies. Segregation of duties:
//   the requester never reviews, returns, declines or converts their own request;
//   high-risk work is safety-assessed by someone other than the planner;
//   the planner never releases their own plan;
//   nobody verifies work they completed or booked time on.
// Every step is audited and appended to the record's history.
// ---------------------------------------------------------------------------

import {MNT_ACTIVITIES} from './maintenanceActivities';
export {MNT_ACTIVITIES} from './maintenanceActivities';

const P = Object.fromEntries(MNT_ACTIVITIES.map((a) => [a.key.replace(/^MNT\./, '').replace('.', '_'), a.key])) as Record<string, string>;

const WR_RE = /^WR\d{8}$/;
const WO_RE = /^WO\d{8}$/;
const PHOTO_RE = /^organizations\/[A-Za-z0-9_-]{1,120}\/mnt\/wr_photos\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9]{12}\.(jpg|png)$/;
const MAX_PHOTOS = 4;
const ASSESSMENT_PHOTO_RE=/^organizations\/[A-Za-z0-9_-]{1,120}\/mnt\/assessment_photos\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9]{12}\.(jpg|png|pdf)$/;
/** A reused library task is unchanged when it equals the approved template, ignoring its ASSMTASK reference. */
const sameTemplate=(template:unknown,task:unknown)=>{
    const strip=(x:unknown)=>{const {code:_c,templateStatus:_s,...rest}=(isObj(x)?x:{}) as Record<string,unknown>;return JSON.stringify(rest);};
    return strip(template)===strip(task);
};
/** Every photo or document path referenced by an assessment (spares and services). */
const assessmentFiles=(tasks:unknown)=>objs(tasks).flatMap(t=>[...objs(t.spares).flatMap(sp=>[str(sp.photoPath),...strs(sp.attachments)]),...objs(t.services).flatMap(sv=>strs(sv.attachments))]).filter(Boolean);
const wrCol = (orgId: string) => `organizations/${orgId}/work_requests`;
const woCol = (orgId: string) => `organizations/${orgId}/work_orders`;

/** True once the legal entity above this unit is live in finance: spares must then come through a goods issue. */
async function financeLiveFor(orgId: string, nodeId: string): Promise<boolean> {
    let cur = nodeId;
    for (let i = 0; i < 12 && cur; i++) {
        const n = await getDoc(`organizations/${orgId}/structure/${cur}`);
        if (!n) return false;
        if (str(n.data.level) === 'legal_entity') {
            const f = await getDoc(`organizations/${orgId}/fin_entities/${n.id}`);
            return !!f && !!str(f.data.status) && str(f.data.status) !== 'not_live';
        }
        cur = str(n.data.parentId);
    }
    return false;
}
const LOCATION_LEVELS = ['group', 'legal_entity', 'site', 'department', 'cost_center', 'work_center', 'equipment', 'assembly'];

const HAZARDS = ['Working at height', 'Confined space', 'Hot work', 'Electrical work and isolation', 'Lifting operations', 'Excavation', 'Hazardous substances', 'Pressure systems', 'Rotating machinery', 'Hot surfaces or steam', 'Noise', 'Manual handling'];
const PERMITS = ['Permit to work', 'Lock-out / tag-out (LOTO)', 'Hot work permit', 'Confined space entry permit', 'Work at height permit', 'Electrical isolation permit', 'Excavation permit', 'Lifting plan'];
const PPE = ['Safety helmet', 'Safety footwear', 'High-visibility clothing', 'Gloves', 'Eye protection', 'Face shield', 'Hearing protection', 'Respiratory protection', 'Fall arrest harness', 'Arc flash suit', 'Chemical suit'];

interface ListItem {
    code: string;
    label: string;
    color: string;
}
interface ListGroup extends ListItem {
    items: ListItem[];
}

// ----- Helpers -----

function requireMnt(ctx: OrgContext) {
    const map = isObj(ctx.org.data.modules) ? ctx.org.data.modules : {};
    if (map.MNT !== true) throw new HttpError(403, 'Maintenance Management (MNT) is not enabled for your organization. Adopt and enable it under Modules.');
}

function need(ctx: OrgContext, perm: string, path: string[], scope: Scope) {
    if (!canAt(ctx, perm, path, scope)) throw new HttpError(403, 'You do not have permission to do this here. Ask for the job role or security role that includes it.');
}

function rec(ctx: OrgContext, action: string, target: string, details = '') {
    return audit([{ category: 'maintenance', action, actor: ctx.actor, meta: ctx.meta, target: { label: target }, details, orgId: ctx.orgId }]);
}

const requireConfiguredMaintenanceRole = requireMaintenanceRole;

function displayName(ctx: OrgContext) {
    return `${str(ctx.me.data.firstName)} ${str(ctx.me.data.lastName)}`.trim() || ctx.actor.email;
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Plain[]).filter(isObj) : []);
const numIn = (v: unknown, min: number, max: number, label: string): number => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} must be between ${min} and ${max}.`);
    return Math.round(n * 100) / 100;
};
const clean = (v: unknown, max: number) => str(v).trim().replace(/\s+/g, ' ').slice(0, max);

function history(doc: Doc | null, ctx: OrgContext, action: string, note = ''): Plain[] {
    const prev = doc && Array.isArray(doc.data.history) ? (doc.data.history as Plain[]) : [];
    return [...prev, { at: nowIso(), uid: ctx.uid, name: displayName(ctx), action, note: note.slice(0, 500) }];
}

function confirmCode(ctx: OrgContext, doc: Doc) {
    if (str(ctx.body.confirm) !== doc.id) throw new HttpError(400, `Type ${doc.id} to confirm.`);
}

// ----- Lists (MEMS module lists, falling back to the shipped defaults) -----

async function rawList(key: string): Promise<Obj[]> {
    const doc = await getDoc(`module_workspaces/MNT/metadata/${key}`);
    const fromDb = Array.isArray(doc?.data.items) ? (doc?.data.items as Plain[]).filter(isObj) : [];
    if (fromDb.length) return fromDb;
    const def = (DEFAULT_MODULE_METADATA.MNT ?? []).find((l) => l.key === key);
    return (def?.items ?? []) as unknown as Obj[];
}

function flat(items: Obj[]): ListItem[] {
    return items.filter((i) => i.active !== false && i.selectable !== false).map((i) => ({ code: str(i.code), label: str(i.label), color: str(i.color) }));
}

function grouped(items: Obj[]): ListGroup[] {
    const active = items.filter((i) => i.active !== false);
    const heads = active.filter((i) => i.selectable === false || !str(i.category));
    const groups: ListGroup[] = heads.map((h) => ({ code: str(h.code), label: str(h.label), color: str(h.color), items: [] }));
    const byCode = new Map(groups.map((g) => [g.code, g]));
    const loose: ListItem[] = [];
    for (const i of active) {
        if (i.selectable === false) continue;
        const g = byCode.get(str(i.category));
        const item = { code: str(i.code), label: str(i.label), color: str(i.color) };
        if (g) g.items.push(item);
        else if (!byCode.has(str(i.code))) loose.push(item);
    }
    for (const g of groups) if (!g.items.length) g.items.push({ code: g.code, label: g.label, color: g.color });
    if (loose.length) groups.push({ code: 'OTHER', label: 'Other', color: '', items: loose });
    return groups;
}

async function lists() {
    const keys = ['workRequestSources', 'riskLevels', 'impacts', 'failureModes', 'maintenanceTypes', 'workTypes', 'workPriorities', 'disciplines', 'rootCauses', 'solutionTypes', 'workOutcomes', 'verificationTypes', 'downtimeClasses', 'resourceTypes', 'executionLocations'];
    const [sources, risk, impacts, failure, mtypes, wtypes, prio, disc, causes, solutions, outcomes, verif, downtime, resources, locations] = await Promise.all(keys.map(rawList));
    return {
        sources: grouped(sources),
        criticality: flat(risk),
        impacts: grouped(impacts),
        failureModes: grouped(failure),
        maintenanceTypes: flat(mtypes),
        workTypes: flat(wtypes),
        priorities: flat(prio),
        disciplines: flat(disc),
        rootCauses: grouped(causes),
        solutions: grouped(solutions),
        outcomes: flat(outcomes),
        verificationTypes: flat(verif),
        downtimeClasses: flat(downtime),
        resourceTypes: flat(resources),
        executionLocations: flat(locations),
        hazards: HAZARDS,
        permits: PERMITS,
        ppe: PPE,
    };
}
type Lists = Awaited<ReturnType<typeof lists>>;

function findIn(groups: ListGroup[], code: string): (ListItem & { group: string }) | null {
    for (const g of groups) for (const i of g.items) if (i.code === code) return { ...i, group: g.label };
    return null;
}
function pick(list: ListItem[], code: string, label: string, required = true): ListItem | null {
    if (!code) {
        if (required) throw new HttpError(400, `Choose the ${label}.`);
        return null;
    }
    const item = list.find((i) => i.code === code);
    if (!item) throw new HttpError(400, `Choose the ${label} from the list.`);
    return item;
}
function pickGrouped(groups: ListGroup[], code: string, label: string, required = true) {
    if (!code) {
        if (required) throw new HttpError(400, `Choose the ${label}.`);
        return null;
    }
    const item = findIn(groups, code);
    if (!item) throw new HttpError(400, `Choose the ${label} from the list.`);
    return item;
}

// ----- Locations -----

async function lineage(orgId: string, id: string): Promise<Doc[]> {
    const out: Doc[] = [];
    let current = id;
    for (let i = 0; i < 14 && current && current !== 'root'; i++) {
        const doc = await getDoc(`${col(orgId)}/${current}`);
        if (!doc) break;
        out.unshift(doc);
        current = str(doc.data.parentId);
    }
    return out;
}

async function assemblyContext(ctx: OrgContext, assemblyId: string, perm: string) {
    if (!ID_RE.test(assemblyId)) throw new HttpError(400, 'Choose an assembly.');
    const scope = await scopeOf(ctx);
    const docs = await lineage(ctx.orgId, assemblyId);
    const assembly = docs[docs.length - 1];
    if (!assembly || assembly.id !== assemblyId || str(assembly.data.level) !== 'assembly') throw new HttpError(400, 'Choose an assembly.');
    if (str(assembly.data.status) === 'inactive') throw new HttpError(400, 'This assembly is inactive.');
    const pathIds = docs.map((d) => d.id);
    need(ctx, perm, pathIds, scope);
    const unit = docs.find((d) => ['work_center', 'equipment'].includes(str(d.data.level))) ?? null;
    const costCenter = docs.find((d) => str(d.data.level) === 'cost_center') ?? null;
    const site = docs.find((d) => str(d.data.level) === 'site') ?? null;
    const unitAttrs: Obj = unit && isObj(unit.data.attributes) ? unit.data.attributes : {};
    const linkedTag = str(unitAttrs.assetTag);
    // Equipment/Asset Management owns this one-to-one relationship.
    // Never offer other site/cost-centre assets on a maintenance request.
    const assetDocs=await listDocs(`organizations/${ctx.orgId}/assets`);
    let resolvedTag='';
    try {
        resolvedTag=resolveMaintenanceEquipmentAsset(unit?.id??'',linkedTag,
            assetDocs.map(d=>({id:d.id,status:str(d.data.status),workCenterId:str(d.data.workCenterId)})));
    } catch (e) { throw new HttpError(409,e instanceof Error?e.message:'The equipment asset mapping is invalid.'); }
    const linkedAsset=assetDocs.find(d=>d.id===resolvedTag);
    if(!linkedAsset)throw new HttpError(409,'The mapped asset is missing. Verify the asset in Asset Management.');
    const mappedSiteId=str(linkedAsset.data.siteId);
    if(mappedSiteId&&site&&mappedSiteId!==site.id)
        throw new HttpError(409,'The linked asset belongs to a different site. Repair the equipment-to-asset link.');
    const asset=(d:Doc)=>({tag:d.id,name:str(d.data.name),className:str(d.data.className),
        classCode:str(d.data.classCode),status:str(d.data.status),linked:true});
    return {
        assembly: { id: assembly.id, code: str(assembly.data.code), name: str(assembly.data.name) },
        unit: unit ? { id: unit.id, code: str(unit.data.code), name: str(unit.data.name), equipmentClass: str(unitAttrs.equipmentClass), equipmentClassName: str(unitAttrs.equipmentClassName) } : null,
        costCenter: costCenter ? { id: costCenter.id, code: str(costCenter.data.code), name: str(costCenter.data.name) } : null,
        site: site ? { id: site.id, code: str(site.data.code), name: str(site.data.name) } : null,
        path: docs.map((d) => ({ id: d.id, level: str(d.data.level), code: str(d.data.code), name: str(d.data.name) })),
        assets: [asset(linkedAsset)],
        linkedTag: resolvedTag,
        defaultAssetTag: resolvedTag,
    };
}
type Place = Awaited<ReturnType<typeof assemblyContext>>;

function placeFields(place: Place, assetTag: string) {
    const mappedTag=place.defaultAssetTag;
    if(assetTag&&assetTag!==mappedTag)
        throw new HttpError(409,'The selected asset differs from the equipment link. Refresh the request or fix the mapping in Asset Management.');
    const asset=place.assets.find(a=>a.tag===mappedTag&&a.linked);
    if(!asset)throw new HttpError(409,'The equipment has no valid linked asset. Fix the mapping in Asset Management.');
    return {
        assemblyId: place.assembly.id,
        assemblyCode: place.assembly.code,
        assemblyName: place.assembly.name,
        unitId: place.unit?.id ?? '',
        unitCode: place.unit?.code ?? '',
        unitName: place.unit?.name ?? '',
        costCenterId: place.costCenter?.id ?? '',
        costCenterCode: place.costCenter?.code ?? '',
        costCenterName: place.costCenter?.name ?? '',
        siteId: place.site?.id ?? '',
        siteCode: place.site?.code ?? '',
        siteName: place.site?.name ?? '',
        path: place.path.map((p) => p.id),
        assetTag: asset.tag,
        assetName: asset.name,
        assetClass: asset.className,
    };
}

const pathOf = (doc: Doc) => strs(doc.data.path);

// ----- Work request -----

const WR_STATUS: Record<string, string> = {
    submitted: 'Submitted',
    under_review: 'Under review',
    returned: 'Returned for information',
    declined: 'Declined',
    cancelled: 'Cancelled',
    converted: 'Converted to work order',
};
const wrStatus = (doc: Doc) => {
    const s = str(doc.data.status);
    return s === 'approved' ? 'submitted' : s === 'rejected' ? 'declined' : s;
};

function locationOut(d: Obj) {
    return {
        assemblyId: str(d.assemblyId),
        assemblyCode: str(d.assemblyCode),
        assemblyName: str(d.assemblyName),
        unitCode: str(d.unitCode),
        unitName: str(d.unitName),
        costCenterCode: str(d.costCenterCode),
        costCenterName: str(d.costCenterName),
        siteCode: str(d.siteCode),
        siteName: str(d.siteName),
        assetTag: str(d.assetTag),
        assetName: str(d.assetName),
        assetClass: str(d.assetClass),
    };
}

function wrOut(doc: Doc) {
    const d = doc.data;
    const status = wrStatus(doc);
    return {
        code: doc.id,
        title: str(d.title),
        status,
        statusLabel: WR_STATUS[status] ?? status,
        ...locationOut(d),
        sourceLabel: str(d.sourceLabel),
        sourceGroup: str(d.sourceGroup),
        criticalityCode: str(d.criticalityCode),
        criticalityLabel: str(d.criticalityLabel),
        criticalityColor: str(d.criticalityColor),
        impactLabels: objs(d.impacts).map((i) => str(i.label)),
        photoCount: objs(d.photos).length,
        priorityLabel: str(d.priorityLabel),
        maintenanceTypeLabel: str(d.maintenanceTypeLabel),
        requestedBy: str(d.requestedBy),
        requestedByName: str(d.requestedByName),
        requestedAt: str(d.requestedAt),
        reviewerName: str(d.reviewerName),
        assessmentReviewStatus: str((isObj(d.assessmentReview)?d.assessmentReview:{}).status) || 'pending',
        woCode: str(d.woCode),
        updatedAt: str(d.updatedAt),
    };
}

/**
 * What the requester reports. Criticality is set by the assessor during assessment, and the failure mode is optional;
 * either is kept only when supplied, so a requester edit never clears what is already recorded.
 */
const MAX_IMPACTS = 5;
async function readFinding(l: Lists, b: Record<string, unknown>) {
    const title = clean(b.title, 120);
    const description = str(b.description).trim().slice(0, 2000);
    if (title.length < 5) throw new HttpError(400, 'Give the request a short title (5 to 120 characters).');
    if (description.length < 10) throw new HttpError(400, 'Describe what you found (10 to 2000 characters).');
    const source = pickGrouped(l.sources, str(b.sourceCode), 'source of the finding')!;
    const crit = str(b.criticalityCode) ? pick(l.criticality, str(b.criticalityCode), 'criticality') : null;
    const impactCodes = [...new Set(strs(b.impactCodes))];
    if (!impactCodes.length || impactCodes.length > MAX_IMPACTS) throw new HttpError(400, `Choose between 1 and ${MAX_IMPACTS} impacts.`);
    const impacts = impactCodes.map((c) => findIn(l.impacts, c));
    if (impacts.some((i) => !i)) throw new HttpError(400, 'Choose impacts from the list.');
    const failure = str(b.failureModeCode) ? pickGrouped(l.failureModes, str(b.failureModeCode), 'failure mode', false) : null;
    return {
        title,
        description,
        sourceCode: source.code,
        sourceLabel: source.label,
        sourceGroup: source.group,
        ...(crit ? { criticalityCode: crit.code, criticalityLabel: crit.label, criticalityColor: crit.color } : {}),
        impacts: impacts.map((i) => ({ code: i!.code, label: i!.label, group: i!.group })),
        ...(failure ? { failureModeCode: failure.code, failureModeLabel: `${failure.group} · ${failure.label}` } : {}),
    };
}

function readPhotos(ctx: OrgContext, raw: unknown, existing: string[] = []) {
    const photos = [...new Set(strs(raw))];
    if (photos.length > MAX_PHOTOS) throw new HttpError(400, `Attach up to ${MAX_PHOTOS} photos.`);
    const prefix = `organizations/${ctx.orgId}/mnt/wr_photos/`;
    for (const p of photos) {
        if (existing.includes(p)) continue;
        if (!PHOTO_RE.test(p) || !p.startsWith(`${prefix}${ctx.uid}/`)) throw new HttpError(400, 'One of the photos is not valid. Take it again.');
    }
    return photos;
}

async function getWr(ctx: OrgContext, code: string): Promise<Doc> {
    if (!WR_RE.test(code)) throw new HttpError(400, 'Invalid work request number.');
    const doc = await getDoc(`${wrCol(ctx.orgId)}/${code}`);
    if (!doc) throw new HttpError(404, 'Work request not found.');
    return doc;
}

function wrCan(ctx: OrgContext, doc: Doc, scope: Scope) {
    const status = wrStatus(doc);
    const path = pathOf(doc);
    const mine = str(doc.data.requestedBy) === ctx.uid;
    const at = (perm: string) => canAt(ctx, perm, path, scope);
    return {
        view: mine || at(P.view),
        edit: mine && ['submitted', 'returned'].includes(status) && at(P.WR_edit),
        resubmit: mine && status === 'returned' && at(P.WR_edit),
        cancel: mine && ['submitted', 'returned'].includes(status) && at(P.WR_cancel),
        startReview: !mine && status === 'submitted' && at(P.WR_review),
        assess: ['submitted','under_review'].includes(status) && at(P.assessment_edit) && !assessmentReviewCurrent(doc.data),
        return: !mine && status === 'under_review' && at(P.WR_return),
        decline: !mine && status === 'under_review' && at(P.WR_decline),
        reviewAssessment: !mine && status === 'under_review' && at(P.assessment_review) && ![doc.data.assessedBy,doc.data.assessmentTasksBy].includes(ctx.uid),
        convert: !mine && status === 'under_review' && at(P.WR_convert) && assessmentReviewCurrent(doc.data),
        ownRequest: mine,
    };
}

// ----- Work order -----

const WO_STATUS: Record<string, string> = {
    planning: 'In planning',
    plan_ready: 'Plan ready for release',
    released: 'Released',
    scheduled: 'Scheduled',
    in_progress: 'In progress',
    completed: 'Completed - to verify',
    verified: 'Verified - to close',
    closed: 'Closed',
    cancelled: 'Cancelled',
};

interface Task {
    id: string;
    description: string;
    disciplineCode: string;
    disciplineLabel: string;
    resourceTypeCode: string;
    resourceTypeLabel: string;
    persons: number;
    hours: number;
    rate: number;
}
interface Spare {
    id: string;
    source: string;
    catalogCode: string;
    description: string;
    qty: number;
    uom: string;
    unitCost: number;
}
interface Service {
    id: string;
    catalogCode: string;
    description: string;
    cost: number;
}

function estimate(d: Obj) {
    const tasks = objs(d.assessmentTasks).length?objs(d.assessmentTasks):objs(d.tasks);
    const spares = objs(d.spares);
    const services = objs(d.services);
    const labourHours = tasks.reduce((s, t) => s + (Number(t.persons) || 0) * (Number(t.hours) || 0), 0);
    const labour = tasks.reduce((s, t) => s + (Number(t.persons) || 0) * (Number(t.hours) || 0) * (Number(t.rate) || 0), 0);
    // New work assessments own resources within each task. Old work orders still
    // use flat spares/services, so preserve both representations without double counting.
    const taskSpares = tasks.flatMap(t => objs(t.spares));
    const taskServices = tasks.flatMap(t => objs(t.services));
    const sparesCost = (taskSpares.length ? taskSpares : spares).reduce((n, x) => n + (Number(x.qty) || 0) * (Number(x.unitCost) || 0), 0);
    const servicesCost = (taskServices.length ? taskServices : services).reduce((n, x) => n + (Number(x.expectedCost??x.cost) || 0), 0);
    const r = (n: number) => Math.round(n * 100) / 100;
    return { labourHours: r(labourHours), labour: r(labour), spares: r(sparesCost), services: r(servicesCost), total: r(labour + sparesCost + servicesCost) };
}

function actuals(d: Obj) {
    if(objs(d.assessmentTasks).length){const tasks=objs(d.assessmentTasks),execution=isObj(d.taskExecution)?d.taskExecution:{},planning=isObj(d.taskPlanning)?d.taskPlanning:{};let labourHours=0,labour=0,spares=0,services=0;for(const t of tasks){const e=isObj(execution[str(t.id)])?execution[str(t.id)] as Obj:{},feedback=isObj(e.feedback)?e.feedback:{};const h=Number(feedback.actualHours)||0;labourHours+=h;labour+=h*(Number(t.rate)||0);spares+=objs(e.consumption).reduce((n,c)=>n+(Number(c.consumed)||0)*(Number(c.unitCost)||0),0);const p=isObj(planning[str(t.id)])?planning[str(t.id)] as Obj:{};services+=objs(t.services).reduce((n,s)=>n+(Number(isObj(p[str(s.id)])?(p[str(s.id)] as Obj).cost:0)||0),0);}return {labourHours,labour,spares,services,total:labour+spares+services};}
    const logs = objs(d.timeLogs);
    const used = objs(d.sparesUsed);
    const est = estimate(d);
    const hours = logs.reduce((s, l) => s + (Number(l.hours) || 0), 0);
    const rate = est.labourHours ? est.labour / est.labourHours : 0;
    const spares = used.reduce((s, u) => s + (Number(u.qty) || 0) * (Number(u.unitCost) || 0), 0);
    const r = (n: number) => Math.round(n * 100) / 100;
    return { labourHours: r(hours), labour: r(hours * rate), spares: r(spares), services: est.services, total: r(hours * rate + spares + est.services) };
}

const isHighRisk = (d: Obj, l: Lists) => {
    const safety = isObj(d.safety) ? d.safety : {};
    const top = l.criticality.slice(0, 2).map((c) => c.code);
    return strs(safety.permits).length > 0 || top.includes(str(safety.riskCode));
};

function woOut(doc: Doc) {
    const d = doc.data;
    const status = str(d.status);
    return {
        code: doc.id,
        title: str(d.title),
        status,
        statusLabel: WO_STATUS[status] ?? status,
        origin: str(d.wrCode) ? 'request' : 'direct',
        wrCode: str(d.wrCode),
        ...locationOut(d),
        criticalityCode: str(d.criticalityCode),
        criticalityLabel: str(d.criticalityLabel),
        criticalityColor: str(d.criticalityColor),
        priorityLabel: str(d.priorityLabel),
        maintenanceTypeLabel: str(d.maintenanceTypeLabel),
        workTypeLabel: str(d.workTypeLabel),
        disciplineLabel: str(d.disciplineLabel),
        plannerName: str(d.plannedByName),
        scheduledStart: str(d.scheduledStart),
        scheduledEnd: str(d.scheduledEnd),
        assigneeNames: objs(d.assignees).map((a) => str(a.name)),
        estimate: estimate(d),
        createdByName: str(d.createdByName),
        createdAt: str(d.createdAt),
        updatedAt: str(d.updatedAt),
    };
}

async function getWo(ctx: OrgContext, code: string): Promise<Doc> {
    if (!WO_RE.test(code)) throw new HttpError(400, 'Invalid work order number.');
    const doc = await getDoc(`${woCol(ctx.orgId)}/${code}`);
    if (!doc) throw new HttpError(404, 'Work order not found.');
    return doc;
}

function woCan(ctx: OrgContext, doc: Doc, scope: Scope, l: Lists) {
    const d = doc.data;
    const s = str(d.status);
    const path = pathOf(doc);
    const at = (perm: string) => canAt(ctx, perm, path, scope);
    const planner = str(d.plannedBy);
    const workers = new Set([...objs(d.timeLogs).map((t) => str(t.uid)), str(d.completedBy)]);
    const high = isHighRisk(d, l);
    return {
        view: at(P.view),
        plan: ['planning', 'plan_ready'].includes(s) && at(P.WO_plan),
        safety: ['planning', 'plan_ready'].includes(s) && at(P.WO_safety) && !(high && planner === ctx.uid),
        submitPlan: s === 'planning' && at(P.WO_plan),
        release: s === 'plan_ready' && at(P.WO_release) && planner !== ctx.uid,
        schedule: ['released', 'scheduled'].includes(s) && at(P.WO_schedule),
        start: ['released', 'scheduled'].includes(s) && at(P.WO_execute),
        execute: s === 'in_progress' && at(P.WO_execute),
        verify: s === 'completed' && at(P.WO_verify) && !workers.has(ctx.uid),
        close: s === 'verified' && at(P.WO_close),
        cancel: ['planning', 'plan_ready', 'released', 'scheduled'].includes(s) && at(P.WO_cancel),
        reopen: ['verified', 'closed'].includes(s) && at(P.WO_reopen),
        highRisk: high,
        isPlanner: planner === ctx.uid,
        didWork: workers.has(ctx.uid),
    };
}

async function createWo(ctx: OrgContext, base: Obj, wrCode: string): Promise<string> {
    const now = nowIso();
    for (let attempt = 0; attempt < 3; attempt++) {
        const n = await nextOrgCounter(ctx.orgId, 'woSeq');
        if (n > 99_999_999) throw new HttpError(400, 'Work order numbering is exhausted.');
        const code = `WO${String(n).padStart(8, '0')}`;
        const data:Obj = {
                ...(base as Record<string, Plain>),
                code,
                wrCode,
                status: 'planning',
                tasks: assessmentTaskSummaries(objs(base.assessmentTasks) as any),
                schemaVersion: 2,
                taskPlanning: {},
                taskExecution: {},
                spares: [],
                services: [],
                tools: '',
                timeLogs: [],
                sparesUsed: [],
                createdBy: ctx.uid,
                createdByName: displayName(ctx),
                createdAt: now,
                updatedAt: now,
                history: history(null, ctx, wrCode ? `Created from ${wrCode}` : 'Created directly'),
        };
        if(wrCode){const request=await getWr(ctx,wrCode);if(!assessmentReviewCurrent(request.data))throw new HttpError(409,'Approved assessment required before conversion.');if(str(request.data.status)!=='under_review')throw new HttpError(409,'The request has already progressed.');await commit([{path:`${woCol(ctx.orgId)}/${code}`,fields:data,exists:false},{path:`${wrCol(ctx.orgId)}/${wrCode}`,fields:{...request.data,status:'converted',woCode:code,convertedBy:ctx.uid,convertedByName:displayName(ctx),convertedAt:now,closedAt:now,updatedAt:now,history:history(request,ctx,`Converted to ${code}`,code)},updateTime:request.updateTime}]);return code;}
        const created=await writeDoc(`${woCol(ctx.orgId)}/${code}`,data,{exists:false});
        if (created) return code;
    }
    throw new HttpError(409, 'Could not number the work order. Please try again.');
}

function readTasks(raw: unknown, l: Lists): Task[] {
    const rows = objs(raw);
    if (rows.length > 40) throw new HttpError(400, 'Up to 40 tasks per work order.');
    return rows.map((t, i) => {
        const description = clean(t.description, 300);
        if (description.length < 3) throw new HttpError(400, `Task ${i + 1}: describe the task.`);
        const disc = pick(l.disciplines, str(t.disciplineCode), `discipline for task ${i + 1}`)!;
        const res = pick(l.resourceTypes, str(t.resourceTypeCode), `resource type for task ${i + 1}`)!;
        return {
            id: /^[a-z0-9]{6,16}$/.test(str(t.id)) ? str(t.id) : randomId(4),
            description,
            disciplineCode: disc.code,
            disciplineLabel: disc.label,
            resourceTypeCode: res.code,
            resourceTypeLabel: res.label,
            persons: numIn(t.persons, 1, 50, `People for task ${i + 1}`),
            hours: numIn(t.hours, 0.25, 2000, `Hours for task ${i + 1}`),
            rate: numIn(t.rate ?? 0, 0, 1_000_000, `Hourly rate for task ${i + 1}`),
        };
    });
}

function readSpares(raw: unknown): Spare[] {
    const rows = objs(raw);
    if (rows.length > 60) throw new HttpError(400, 'Up to 60 spare lines per work order.');
    return rows.map((s, i) => {
        const description = clean(s.description, 200);
        if (description.length < 2) throw new HttpError(400, `Spare ${i + 1}: describe the item.`);
        return {
            id: /^[a-z0-9]{6,16}$/.test(str(s.id)) ? str(s.id) : randomId(4),
            source: str(s.source) === 'catalog' ? 'catalog' : 'manual',
            catalogCode: clean(s.catalogCode, 40),
            description,
            qty: numIn(s.qty, 0.001, 1_000_000, `Quantity for spare ${i + 1}`),
            uom: clean(s.uom, 12) || 'EA',
            unitCost: numIn(s.unitCost ?? 0, 0, 1_000_000_000, `Unit cost for spare ${i + 1}`),
        };
    });
}

function readServices(raw: unknown): Service[] {
    const rows = objs(raw);
    if (rows.length > 20) throw new HttpError(400, 'Up to 20 service lines per work order.');
    return rows.map((s, i) => {
        const description = clean(s.description, 200);
        if (description.length < 3) throw new HttpError(400, `Service ${i + 1}: describe the service.`);
        return {
            id: /^[a-z0-9]{6,16}$/.test(str(s.id)) ? str(s.id) : randomId(4),
            catalogCode: clean(s.catalogCode, 40),
            description,
            cost: numIn(s.cost ?? 0, 0, 1_000_000_000, `Cost for service ${i + 1}`),
        };
    });
}

function readDate(v: unknown, label: string, required = true): string {
    const s = str(v);
    if (!s) {
        if (required) throw new HttpError(400, `Choose the ${label}.`);
        return '';
    }
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, `Enter a valid ${label}.`);
    return s;
}

async function orgUserMap(orgId: string) {
    const users = await runQuery({ from: [{ collectionId: 'users' }], where: fieldEq('orgId', orgId) });
    return new Map(users.filter((u) => str(u.data.status) !== 'disabled').map((u) => [u.id, `${str(u.data.firstName)} ${str(u.data.lastName)}`.trim() || str(u.data.email)]));
}

async function verifyAssessedTaskChoices(ctx:OrgContext,record:Doc,tasks:AssessedTask[]){
    const [energyDoc,permitDoc]=await Promise.all([
        getDoc('module_workspaces/SAF/metadata/hazardousEnergy'),
        getDoc('module_workspaces/SAF/metadata/permitTypes')
    ]);
    const master=(doc:Doc|null,key:string)=>{
        const defaults=SAF_DEFAULT_LISTS.find(x=>x.key===key);
        return objs(Array.isArray(doc?.data.items)?doc?.data.items:defaults?.items)
            .filter(x=>x.active!==false&&x.selectable!==false);
    };
    const energies=master(energyDoc,'hazardousEnergy'),permits=master(permitDoc,'permitTypes');
    const energyIds=new Set(energies.map(e=>str(e.code))),permitIds=new Set(permits.map(e=>str(e.code)));
    const oldPaths=new Set(assessmentFiles(record.data.assessmentTasks));
    for(const task of tasks){
        if(task.energySourceCodes?.some(code=>!energyIds.has(code)))
            throw new HttpError(400,'Choose hazardous energy sources from the active SAF list.');
        if(task.permitCodes?.some(code=>!permitIds.has(code)))
            throw new HttpError(400,'Choose permits from the active SAF permit list.');
        if(task.lotoRequired){
            if(!task.energySourceCodes?.every(code=>task.risk.some(r=>r.energyCode===code)))
                throw new HttpError(400,'Complete risk assessment for every selected LOTO hazardous energy source.');
            const lotoPermit=permits.find(x=>/loto|lock.?out|isolation/i.test(str(x.label)));
            if(lotoPermit&&!task.permitCodes?.includes(str(lotoPermit.code)))
                throw new HttpError(400,'Add the SAF LOTO isolation permit for this task.');
        }
        if(task.liveEquipment){
            if(!task.risk.some(r=>r.energyCode==='LIVE_EQUIPMENT'))
                throw new HttpError(400,'Assess live-equipment hazards and mitigation for this task.');
            const livePermit=permits.find(x=>/live/i.test(str(x.label)));
            if(livePermit&&!task.permitCodes?.includes(str(livePermit.code)))
                throw new HttpError(400,'Add the SAF live work permit for this task.');
        }
        for(const file of assessmentFiles([task])){
            if(!ASSESSMENT_PHOTO_RE.test(file)||
                !file.startsWith(`organizations/${ctx.orgId}/mnt/assessment_photos/`)||
                !(file.startsWith(`organizations/${ctx.orgId}/mnt/assessment_photos/${ctx.uid}/`)||oldPaths.has(file)))
                throw new HttpError(400,'Invalid or unauthorized assessment photo or document.');
        }
    }
}
async function ensureCurrentAssessmentApproval(ctx:OrgContext,data:Obj) {
    const settings=await getDoc(`organizations/${ctx.orgId}/maintenance_workflow_settings/default`);
    const reviewerRole=str(isObj(settings?.data.approverRoles)?settings.data.approverRoles['MNT.ASSESS.REVIEW']:'');
    if(!reviewerRole||!assessmentReviewCurrent(data,reviewerRole))
        throw new HttpError(409,'Assessment approval is missing or outdated. Assign a reviewer and approve the latest assessment before planning.');
}

// ----- Routes -----

export const maintenanceRoutes = {
    'POST /api/org/mnt/workflow/configuration': [
        orgRoute('org.mnt.workflow.configuration', null, async (ctx) => {
            requireMnt(ctx);
            if (!canAnywhere(ctx, 'MNT.view') && !canAnywhere(ctx, 'ADM.workflows'))
                throw new HttpError(403, 'Maintenance or workflow administration access is required.');
            const [saved,positions]=await Promise.all([
                getDoc(`organizations/${ctx.orgId}/maintenance_workflow_settings/default`),
                listDocs(`organizations/${ctx.orgId}/positions`)
            ]);
            const selected=isObj(saved?.data.approverRoles)?saved.data.approverRoles:{};
            const roles=Object.fromEntries(Object.entries(selected).map(([k,v])=>[k,str(v)]));
            return {
                gates:maintenanceGateReadiness(roles),
                jobRoles:positions.map(p=>({id:p.id,label:str(p.data.title)||str(p.data.name)||p.id})),
                revision:Number(saved?.data.version)||0,
                configuredAt:str(saved?.data.updatedAt),
                note:'Operational handlers enforce these role mappings and their prerequisites; changed approval responsibilities require window revalidation.'
            };
        })
    ],
    'POST /api/org/mnt/workflow/configuration/save': [
        orgRoute('org.mnt.workflow.configuration.save','ADM.workflows',async(ctx)=>{
            requireMnt(ctx);
            const raw=ctx.body.approverRoles;
            if(!isObj(raw))throw new HttpError(400,'Approver role mappings are required.');
            const eligible=new Set(MAINTENANCE_GATES.map(g=>g.code));
            if(Object.keys(raw).some(k=>!eligible.has(k)))throw new HttpError(400,'Unknown maintenance workflow gate.');
            const positions=await listDocs(`organizations/${ctx.orgId}/positions`);
            const ids=new Set(positions.map(p=>p.id));
            const roles:Record<string,string>={};
            for(const [key,val] of Object.entries(raw)){
                const id=str(val);
                if(id&&!ids.has(id))throw new HttpError(400,`Unknown organizational job role for ${key}.`);
                if(id)roles[key]=id;
            }
            const path=`organizations/${ctx.orgId}/maintenance_workflow_settings/default`;
            const prior=await getDoc(path);
            const expected=Number(ctx.body.expectedVersion);
            const version=Number(prior?.data.version)||0;
            if(!Number.isInteger(expected)||expected!==version)
                throw new HttpError(409,'Workflow configuration changed. Reload before saving.');
            const reason=clean(ctx.body.reason,500);
            if(reason.length<10)throw new HttpError(400,'Explain the configuration change (10 characters minimum).');
            await writeDoc(path,{
                version:version+1,approverRoles:roles,
                updatedAt:nowIso(),updatedBy:ctx.uid,reason,
            });
            await rec(ctx,'mnt.workflow.configuration.updated','Maintenance approval configuration',reason);
            return {ok:true,version:version+1,configured:roles};
        })
    ],

    'POST /api/org/mnt/tasks/library': [
        orgRoute('org.mnt.tasks.library',null,async(ctx)=>{
            requireMnt(ctx);
            const code=str(ctx.body.code),isOrder=WO_RE.test(code);
            const doc=isOrder?await getWo(ctx,code):await getWr(ctx,code);
            const scope=await scopeOf(ctx);
            const visible=isOrder?woCan(ctx,doc,scope,await lists()).view:wrCan(ctx,doc,scope).view;
            if(!visible)throw new HttpError(403,'Work request/order access is required.');
            const docs=await listDocs(`organizations/${ctx.orgId}/asset_task_templates`);
            const assemblyId=str(doc.data.assemblyId);
            return {items:docs.filter(d=>str(d.data.assemblyId)===assemblyId&&str(d.data.status)==='approved')
                .map(d=>({id:str(d.data.taskId),version:Number(d.data.version)||1,task:d.data.task,validatedBy:str(d.data.approvedByName)}))};
        })
    ],
    'POST /api/org/mnt/tasks/proposals': [
        orgRoute('org.mnt.tasks.proposals',null,async(ctx)=>{
            requireMnt(ctx);
            const scope=await scopeOf(ctx);
            const wr=await getWr(ctx,str(ctx.body.code));
            if(!wrCan(ctx,wr,scope).view)throw new HttpError(403,'Work request access is required.');
            const proposals=await listDocs(`organizations/${ctx.orgId}/asset_task_proposals`);
            return {items:proposals.filter(p=>str(p.data.wrCode)===wr.id).map(p=>({
                id:p.id,taskId:str(p.data.taskId),name:str(p.data.description),status:str(p.data.status),
                revision:Number(p.data.assessmentVersion)||1,approvedBy:str(p.data.approvedByName)
            }))};
        })
    ],
    'POST /api/org/mnt/tasks/pending': [
        orgRoute('org.mnt.tasks.pending',null,async(ctx)=>{
            requireMnt(ctx);
            const conf=await getDoc(`organizations/${ctx.orgId}/maintenance_workflow_settings/default`);
            const roles=isObj(conf?.data.approverRoles)?conf.data.approverRoles:{};
            const positionCode=str(roles['MNT.TASK.VALIDATE']);
            if(!positionCode)return {items:[],configurationNeeded:true};
            const today=new Date().toISOString().slice(0,10);
            const authorized=objs(ctx.me.data.assignments).some(a=>
                str(a.positionCode)===positionCode&&(!str(a.startsOn)||str(a.startsOn)<=today)&&(!str(a.endsOn)||str(a.endsOn)>=today));
            if(!authorized)throw new HttpError(403,'Only the assigned asset-task validation role can view the pending task queue.');
            const scope=await scopeOf(ctx);
            const docs=await listDocs(`organizations/${ctx.orgId}/asset_task_proposals`);
            const pending=[];
            for(const d of docs.filter(x=>str(x.data.status)==='pending_validation')){
                if(canAt(ctx,'MNT.activities.edit',await nodePath(ctx.orgId,str(d.data.assemblyId)),scope))
                    pending.push({id:d.id,wrCode:str(d.data.wrCode),taskId:str(d.data.taskId),
                        description:str(d.data.description),assemblyId:str(d.data.assemblyId),
                        assetTag:str(d.data.assetTag),createdBy:str(d.data.createdBy),task:d.data.task});
            }
            return {items:pending,configurationNeeded:false};
        })
    ],
    'POST /api/org/mnt/tasks/validate': [
        orgRoute('org.mnt.tasks.validate',null,async(ctx)=>{
            requireMnt(ctx);
            const id=str(ctx.body.id);
            if(!/^[A-Za-z0-9_-]{6,120}$/.test(id))throw new HttpError(400,'Choose a valid task proposal.');
            const path=`organizations/${ctx.orgId}/asset_task_proposals/${id}`;
            const proposal=await getDoc(path);
            if(!proposal||str(proposal.data.status)!=='pending_validation')throw new HttpError(409,'Task proposal not awaiting validation.');
            if(str(proposal.data.createdBy)===ctx.uid)throw new HttpError(403,'A task creator cannot validate their own task.');
            const srcWo=str(proposal.data.woCode);
            const request=srcWo?await getWo(ctx,srcWo):await getWr(ctx,str(proposal.data.wrCode));
            if(Number(request.data.assessmentTasksVersion)!==Number(proposal.data.assessmentVersion))
                throw new HttpError(409,'This task belongs to an outdated assessment revision. Validate the latest proposal.');
            const matching=objs(request.data.assessmentTasks).find(t=>str(t.id)===str(proposal.data.taskId));
            if(!matching||JSON.stringify(matching)!==JSON.stringify(proposal.data.task))
                throw new HttpError(409,'The assessed task has been revised. Reload the latest proposal.');

            const conf=await getDoc(`organizations/${ctx.orgId}/maintenance_workflow_settings/default`);
            const roles=isObj(conf?.data.approverRoles)?conf.data.approverRoles:{};
            const requiredRole=str(roles['MNT.TASK.VALIDATE']);
            if(!requiredRole)throw new HttpError(409,'Configure an asset task validator in Maintenance Workflows first.');
            const assignments=objs(ctx.me.data.assignments);
            const today=new Date().toISOString().slice(0,10);
            if(!assignments.some(a=>str(a.positionCode)===requiredRole&&(!str(a.startsOn)||str(a.startsOn)<=today)&&(!str(a.endsOn)||str(a.endsOn)>=today)))
                throw new HttpError(403,'Only the configured asset-task validator may approve.');
            const scope=await scopeOf(ctx);
            const assemblyId=str(proposal.data.assemblyId);
            const pathIds=await nodePath(ctx.orgId,assemblyId);
            await requireMaintenanceRole(ctx,'MNT.TASK.VALIDATE',pathIds);
            if(!canAt(ctx,'MNT.activities.edit',pathIds,scope))
                throw new HttpError(403,'Asset activity maintenance permission is also required.');
            const taskId=str(proposal.data.taskId);
            const dest=`organizations/${ctx.orgId}/asset_task_templates/${assemblyId}_${taskId}`;
            const existing=await getDoc(dest);
            const version=(Number(existing?.data.version)||0)+1;
            const writes:any[]=[{path:dest,fields:{assemblyId,taskId,task:proposal.data.task,status:'approved',version,validatedFrom:proposal.id,approvedBy:ctx.uid,approvedByName:displayName(ctx),approvedAt:nowIso()},...(existing?{updateTime:existing.updateTime}:{exists:false})},
                {path,fields:{...proposal.data,status:'approved',approvedBy:ctx.uid,approvedByName:displayName(ctx),approvedAt:nowIso(),templateVersion:version},updateTime:proposal.updateTime},
                {path:`organizations/${ctx.orgId}/asset_task_template_revisions/${assemblyId}_${taskId}_v${version}`,fields:{task:proposal.data.task,version,validatedFrom:proposal.id,approvedBy:ctx.uid,approvedAt:nowIso()},exists:false}];
            await commit(writes);
            await rec(ctx,'mnt.task.validated',taskId,`Asset ${assemblyId}, revision ${version}`);
            return {ok:true,version};
        })
    ],
    'POST /api/org/mnt/warehouse-spares/search': [
        orgRoute('org.mnt.warehouse_spares.search',null,async(ctx)=>{
            requireMnt(ctx);
            const q=clean(ctx.body.q,80).toLowerCase();
            const root=`organizations/${ctx.orgId}`;
            const [warehouses,materials,extensions,journal]=await Promise.all([
                listDocs(root+'/warehouses'),listDocs(root+'/materials'),listDocs(root+'/material_extensions'),
                listDocs(root+'/material_journal')
            ]);
            const scope=await scopeOf(ctx);
            const activeWarehouse=new Map(warehouses.filter(w=>(scope==='all'||scope.has(w.id))&&str(w.data.status)!=='inactive').map(w=>[w.id,w]));
            if(str(ctx.body.mode)==='warehouses')return {warehouses:[...activeWarehouse.values()].map(w=>({id:w.id,name:str(w.data.name)||w.id})).sort((a,b)=>a.name.localeCompare(b.name)),items:[]};
            const selectedWarehouse=str(ctx.body.warehouseId);
            if(!selectedWarehouse||!activeWarehouse.has(selectedWarehouse))return {items:[]};
            if(q.length<2)return {items:[]};
            const balances=new Map<string,{physical:number;reserved:number;valid:boolean}>();
            for(const entry of journal){
                const d=entry.data,k=str(d.materialId)+'|'+str(d.warehouseId);
                if(!activeWarehouse.has(str(d.warehouseId)))continue;
                const b=balances.get(k)||{physical:0,reserved:0,valid:true};
                if(str(d.status)!=='posted'||d.reconciled!==true)b.valid=false;
                else {
                    const deltas=isObj(d.balancesDelta)?d.balancesDelta:{};
                    b.physical+=Number(deltas.physicalStock)||0;
                    b.reserved+=Number(deltas.reservedStock)||0;
                }
                balances.set(k,b);
            }
            const items=[];
            for(const m of materials){
                if(!['approved','active'].includes(str(m.data.status)))continue;
                const number=str(m.data.materialNumber),name=str(m.data.shortText)||str(m.data.name);
                if(!(number+' '+name).toLowerCase().includes(q))continue;
                const linked=new Set(strs(m.data.warehouseIds));
                if(str(m.data.warehouseId)&&str(m.data.pushedAt))linked.add(str(m.data.warehouseId));
                for(const x of extensions)if(str(x.data.sourceId)===m.id&&str(x.data.status)==='approved')linked.add(str(x.data.warehouseId));
                for(const warehouseId of linked){
                    if(warehouseId!==selectedWarehouse)continue;
                    const warehouse=activeWarehouse.get(warehouseId);if(!warehouse)continue;
                    const balance=balances.get(m.id+'|'+warehouseId);
                    items.push({materialId:m.id,materialNumber:number,name,warehouseId,
                        warehouseName:str(warehouse.data.name)||warehouseId,uom:str(m.data.uom)||'EA',
                        available:balance?.valid?Math.max(0,(balance.physical-balance.reserved)):null,
                        stockVerified:!!balance?.valid&&!!balance,unitCost:null});
                }
            }
            return {items:items.slice(0,40)};
        })
    ],
    'POST /api/org/mnt/assessment/photo': [
        orgRoute('org.mnt.assessment.photo','MNT.assessment.edit',async(ctx)=>{
            requireMnt(ctx);
            const code=str(ctx.body.code);
            const record=WR_RE.test(code)?await getWr(ctx,code):WO_RE.test(code)?await getWo(ctx,code):null;
            if(!record)throw new HttpError(400,'Choose a valid work assessment.');
            need(ctx,P.assessment_edit,pathOf(record),await scopeOf(ctx));
            if((WR_RE.test(code)&&!['submitted','under_review'].includes(wrStatus(record)))||
               (WO_RE.test(code)&&str(record.data.status)!=='planning'))
                throw new HttpError(409,'This assessment is locked.');
            await rateLimit('mnt-assessment-photo',ctx.uid,30,3600);
            const data=str(ctx.body.data);
            if(!data||data.length>2_000_000||!/^[A-Za-z0-9+/=]+$/.test(data))
                throw new HttpError(400,'Upload a JPEG or PNG photo, or a PDF drawing, smaller than 1.5 MB.');
            const buffer=Buffer.from(data,'base64');
            if(!buffer.length||buffer.length>1_500_000)throw new HttpError(400,'File too large (1.5 MB maximum).');
            // Content is identified by its signature, never by the name or declared type.
            const pdf=buffer.subarray(0,5).toString('latin1')==='%PDF-'&&!/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/.test(buffer.toString('latin1'));
            const detected=pdf?{ext:'pdf',contentType:'application/pdf'}:detectImage(buffer);
            if(!detected)throw new HttpError(400,'Only JPEG or PNG photos and PDF drawings without active content are allowed.');
            const path=`organizations/${ctx.orgId}/mnt/assessment_photos/${ctx.uid}/${randomId(6)}.${detected.ext}`;
            const [ok]=await storage.write([{path,content:data,contentType:detected.contentType}]);
            if(!ok)throw new HttpError(502,'Photo could not be stored.');
            return {token:path,url:await signedUrl(path)};
        })
    ],
    'POST /api/org/mnt/assessment/options': [
        orgRoute('org.mnt.assessment.options',null,async(ctx)=>{
            requireMnt(ctx);
            const vendors=await listDocs(`organizations/${ctx.orgId}/vendors`);
            const serviceVendors=vendors.filter(d=>str(d.data.status)==='approved'&&objs(d.data.scopes).some(x=>str(x.kind)==='service'));
            const [riskDoc,serviceHierarchy,energyDoc,permitsDoc]=await Promise.all([
                getDoc(`organizations/${ctx.orgId}/saf/risk_matrix`),serviceCatalogHierarchy(),
                getDoc('module_workspaces/SAF/metadata/hazardousEnergy'),
                getDoc('module_workspaces/SAF/metadata/permitTypes')]);
            const safetyOptions=(doc:Doc|null,key:string)=> {
                const defaults=SAF_DEFAULT_LISTS.find(l=>l.key===key);
                const records=Array.isArray(doc?.data.items)?objs(doc?.data.items):objs(defaults?.items);
                return records.filter(v=>v.active!==false&&v.selectable!==false)
                    .map(v=>({code:str(v.code),label:str(v.label),category:str(v.category),subcategory:str(v.subcategory)}))
                    .filter(v=>v.code&&v.label);
            };
            const code=str(ctx.body.code);
            const record=WO_RE.test(code)?await getWo(ctx,code):WR_RE.test(code)?await getWr(ctx,code):null;
            const equipmentOptions=[];
            if(record){need(ctx,'MNT.view',pathOf(record),await scopeOf(ctx));const nodes=await listDocs(col(ctx.orgId));for(const n of nodes){if(n.id===str(record.data.unitId)||(str(n.data.level)==='assembly'&&(await nodePath(ctx.orgId,n.id)).includes(str(record.data.unitId))))equipmentOptions.push({id:n.id,name:str(n.data.name),code:str(n.data.code)});}}
            const skillMaster=await getDoc('module_workspaces/HRM/metadata/skillsMaster');const skills=objs(skillMaster?.data.items).filter(s=>s.active!==false).map(s=>({code:str(s.code),label:str(s.label)||str(s.name),category:str(s.category)}));
            const photos:Record<string,string>={};
            if(record)for(const path of assessmentFiles(record.data.assessmentTasks).slice(0,200)){
                if(ASSESSMENT_PHOTO_RE.test(path)&&path.startsWith(`organizations/${ctx.orgId}/mnt/assessment_photos/`))
                    photos[path]=await signedUrl(path);
            }
            return {skills,equipmentOptions,equipmentId:str(record?.data.unitId),photos,serviceHierarchy,vendors:serviceVendors.map(d=>({id:d.id,name:str(d.data.tradeName)||str(d.data.legalName)||d.id})).sort((a,b)=>a.name.localeCompare(b.name)),
                hazardousEnergy:safetyOptions(energyDoc,'hazardousEnergy'),
                safetyPermits:safetyOptions(permitsDoc,'permitTypes'),
                riskMatrix:riskDoc?.data?.configuration||defaultMaintenanceRiskMatrix};
        })
    ],
    'POST /api/org/mnt/setup': [
        orgRoute('org.mnt.setup', null, async (ctx) => {
            const map = isObj(ctx.org.data.modules) ? ctx.org.data.modules : {};
            const enabled = map.MNT === true;
            const can = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, canAnywhere(ctx, v)]));
            return { enabled, can, lists: enabled ? await lists() : null, currency: str(ctx.org.data.currencyCode) };
        }),
    ],

    'POST /api/org/mnt/locations': [
        orgRoute('org.mnt.locations', null, async (ctx) => {
            requireMnt(ctx);
            const perm = str(ctx.body.purpose) === 'wo' ? P.WO_create : P.WR_create;
            const scope = await scopeOf(ctx);
            const docs = (await listDocs(col(ctx.orgId))).filter((d) => LOCATION_LEVELS.includes(str(d.data.level)) && str(d.data.status) !== 'inactive');
            const byId = new Map(docs.map((d) => [d.id, d]));
            const pathCache = new Map<string, string[]>();
            const pathTo = (id: string): string[] => {
                const hit = pathCache.get(id);
                if (hit) return hit;
                const d = byId.get(id);
                const parent = d ? str(d.data.parentId) : '';
                const p = d ? [...(parent && byId.has(parent) ? pathTo(parent) : []), id] : [];
                pathCache.set(id, p);
                return p;
            };
            const nodes = docs.map((d) => ({
                id: d.id,
                parentId: str(d.data.parentId),
                level: str(d.data.level),
                code: str(d.data.code),
                name: str(d.data.name),
                assetTag: isObj(d.data.attributes) ? str(d.data.attributes.assetTag) : '',
                inScope: str(d.data.level) === 'assembly' && canAt(ctx, perm, pathTo(d.id), scope),
            }));
            const keep = new Set<string>();
            for (const n of nodes) if (n.inScope) for (const id of pathTo(n.id)) keep.add(id);
            // Start the picker at the legal entity of the person raising the request (current primary assignment
            // first), when it holds assemblies the person may use.
            const today = nowIso().slice(0, 10);
            const assignments = objs(ctx.me.data.assignments)
                .filter((a) => (!str(a.startsOn) || str(a.startsOn) <= today) && (!str(a.endsOn) || str(a.endsOn) >= today))
                .sort((a, b) => Number(str(b.type) === 'primary') - Number(str(a.type) === 'primary'));
            let homeId = '';
            for (const a of assignments) {
                const entity = pathTo(str(a.nodeId)).find((id) => str(byId.get(id)?.data.level) === 'legal_entity');
                if (entity && keep.has(entity)) {
                    homeId = entity;
                    break;
                }
            }
            return { nodes: nodes.filter((n) => keep.has(n.id)), homeId };
        }),
    ],

    'POST /api/org/mnt/assembly': [
        orgRoute('org.mnt.assembly', null, async (ctx) => {
            requireMnt(ctx);
            return assemblyContext(ctx, str(ctx.body.assemblyId), str(ctx.body.purpose) === 'wo' ? P.WO_create : P.WR_create);
        }),
    ],

    'POST /api/org/mnt/wr/photo': [
        orgRoute('org.mnt.wr.photo', null, async (ctx) => {
            requireMnt(ctx);
            if (!canAnywhere(ctx, P.WR_create) && !canAnywhere(ctx, P.WR_edit)) throw new HttpError(403, 'You do not have permission to do this.');
            await rateLimit('wr-photo', ctx.uid, 60, 3600);
            const data = str(ctx.body.data);
            if (!data || data.length > 2_000_000 || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new HttpError(400, 'The photo must be a JPEG or PNG image under 1.5 MB.');
            const buf = Buffer.from(data, 'base64');
            if (!buf.length || buf.length > 1_500_000) throw new HttpError(400, 'The photo must be under 1.5 MB.');
            const detected = detectImage(buf);
            if (!detected) throw new HttpError(400, 'The photo must be a JPEG or PNG image.');
            const path = `organizations/${ctx.orgId}/mnt/wr_photos/${ctx.uid}/${randomId(6)}.${detected.ext}`;
            const [ok] = await storage.write([{ path, content: data, contentType: detected.contentType }]);
            if (!ok) throw new HttpError(502, 'The photo could not be stored. Please try again.');
            return { token: path, url: await signedUrl(path) };
        }),
    ],

    // ----- Work requests -----

    'POST /api/org/mnt/wr/create': [
        orgRoute('org.mnt.wr.create', null, async (ctx) => {
            requireMnt(ctx);
            const b = ctx.body;
            if (b.confirm !== true) throw new HttpError(400, 'Review the request and confirm that the details are correct.');
            const place = await assemblyContext(ctx, str(b.assemblyId), P.WR_create);
            const loc = placeFields(place, str(b.assetTag));
            const finding = await readFinding(await lists(), b);
            const gembaId = str(b.gembaId), observationId = str(b.gembaObservationId);
            let gembaTypeCode = '', gembaTypeName = '', inheritedPhoto = '';
            if (gembaId || observationId) {
                if (!/^[A-Za-z0-9_-]{8,40}$/.test(gembaId) || !/^[A-Za-z0-9_-]{8,40}$/.test(observationId)) throw new HttpError(400, 'Invalid Gemba reference.');
                const origin = await getDoc('organizations/' + ctx.orgId + '/gembas/' + gembaId);
                const observation = await getDoc('organizations/' + ctx.orgId + '/gembas/' + gembaId + '/observations/' + observationId);
                if (!origin || !observation || str(origin.data.ownerUid) !== ctx.uid || str(origin.data.status) !== 'closed'
                    || str(observation.data.reviewStatus) !== 'pending' || str(observation.data.assetTag) !== str(b.assetTag)) {
                    throw new HttpError(403, 'This Gemba observation cannot be transferred to this work request.');
                }
                gembaTypeCode = str(origin.data.typeCode); gembaTypeName = str(origin.data.typeName);
                const sourcePath = str(observation.data.photoPath);
                const prefix = 'organizations/' + ctx.orgId + '/gemba_photos/' + ctx.uid + '/' + gembaId + '/';
                inheritedPhoto = sourcePath.startsWith(prefix) ? sourcePath : '';
            }
            const provided = strs(b.photos);
            const fresh = provided.filter(p => p !== inheritedPhoto);
            const photos = [...readPhotos(ctx, fresh), ...(inheritedPhoto && provided.includes(inheritedPhoto) ? [inheritedPhoto] : [])];
            if (photos.length > MAX_PHOTOS) throw new HttpError(400, 'Attach up to four photos.');
            const now = nowIso();
            for (let attempt = 0; attempt < 3; attempt++) {
                const n = await nextOrgCounter(ctx.orgId, 'wrSeq');
                if (n > 99_999_999) throw new HttpError(400, 'Work request numbering is exhausted.');
                const code = `WR${String(n).padStart(8, '0')}`;
                const created = await writeDoc(
                    `${wrCol(ctx.orgId)}/${code}`,
                    {
                        code,
                        ...loc,
                        ...finding,
                        status: 'submitted',
                        photos: photos.map((p) => ({ path: p, addedAt: now })),
                        gembaId, gembaObservationId: observationId, gembaTypeCode, gembaTypeName,
                        requestedBy: ctx.uid,
                        requestedByName: displayName(ctx),
                        requestedAt: now,
                        history: history(null, ctx, 'Submitted'),
                        createdAt: now,
                        updatedAt: now,
                    },
                    { exists: false }
                );
                if (created) {
                    await rec(ctx, 'mnt.wr.submitted', code, `${finding.title} · ${loc.assemblyCode} · ${loc.assetTag}`);
                    return { code };
                }
            }
            throw new HttpError(409, 'Could not number the work request. Please try again.');
        }),
    ],

    'POST /api/org/mnt/wr/list': [
        orgRoute('org.mnt.wr.list', null, async (ctx) => {
            requireMnt(ctx);
            const view = str(ctx.body.view);
            const scope = await scopeOf(ctx);
            const rows = (await listDocs(wrCol(ctx.orgId)))
                .filter((d) => str(d.data.requestedBy) === ctx.uid || canAt(ctx, P.view, pathOf(d), scope))
                .filter((d) => {
                    const s = wrStatus(d);
                    const mine = str(d.data.requestedBy) === ctx.uid;
                    if (view === 'mine') return mine;
                    if (view === 'review') return !mine && (['submitted', 'under_review'].includes(s) && canAt(ctx, P.WR_review, pathOf(d), scope) || s==='under_review' && !assessmentReviewCurrent(d.data) && canAt(ctx, P.assessment_review, pathOf(d), scope));
                    if (view === 'open') return ['submitted', 'under_review', 'returned'].includes(s);
                    return true;
                })
                .sort((a, b) => b.id.localeCompare(a.id))
                .map(wrOut);
            return { rows };
        }),
    ],

    'POST /api/org/mnt/wr/get': [
        orgRoute('org.mnt.wr.get', null, async (ctx) => {
            requireMnt(ctx);
            const scope = await scopeOf(ctx);
            const doc = await getWr(ctx, str(ctx.body.code));
            const can = wrCan(ctx, doc, scope);
            const workflowConfig=await getDoc(`organizations/${ctx.orgId}/maintenance_workflow_settings/default`);
            const assignedReviewerRole=str(isObj(workflowConfig?.data.approverRoles)?workflowConfig.data.approverRoles['MNT.ASSESS.REVIEW']:'');
            // The configured assessment approver reviews only; technical assessors edit.
            // Never offer editing to the same assigned Maintenance Lead.
            if (assignedReviewerRole) {
                try {
                    await requireConfiguredMaintenanceRole(ctx,'MNT.ASSESS.REVIEW',pathOf(doc));
                    can.assess = false;
                } catch { /* Not assigned to this location: normal assessor permissions apply. */ }
            }
            const currentReview=!!assignedReviewerRole&&assessmentReviewCurrent(doc.data,assignedReviewerRole);
            can.convert = can.convert && currentReview;
            // Return precise, actionable review readiness instead of silently hiding approval.
            const reviewBlockers: string[] = [];
            if (str(doc.data.status) !== 'under_review') reviewBlockers.push('Start work request review first.');
            if (!assignedReviewerRole) reviewBlockers.push('MEMS Admin > Maintenance Workflows: assign MNT.ASSESS.REVIEW to the Maintenance Lead job role.');
            if (!canAt(ctx, P.assessment_review, pathOf(doc), scope)) reviewBlockers.push('Grant MNT.assessment.review security permission at this asset/location.');
            if (assignedReviewerRole) {
                try { await requireConfiguredMaintenanceRole(ctx,'MNT.ASSESS.REVIEW',pathOf(doc)); }
                catch { reviewBlockers.push('Assign your employee to the configured Maintenance Lead organizational position at this asset/location.'); }
            }
            if ([doc.data.requestedBy,doc.data.createdBy,doc.data.assessedBy,doc.data.assessmentTasksBy].includes(ctx.uid))
                reviewBlockers.push('A requester or technical assessor cannot approve their own assessment.');
            if (!str(doc.data.maintenanceTypeCode)||!str(doc.data.workTypeCode)||!str(doc.data.priorityCode)||!str(doc.data.disciplineCode))
                reviewBlockers.push('The technical assessor must complete maintenance type, work type, priority and discipline.');
            if (!Array.isArray(doc.data.assessmentTasks)||doc.data.assessmentTasks.length===0)
                reviewBlockers.push('The technical assessor must save at least one fully assessed task.');
            else if (!Number(doc.data.assessmentTasksVersion)||!str(doc.data.assessmentTasksAt))
                reviewBlockers.push('The technical assessor must save the latest task assessment revision.');
            can.reviewAssessment = reviewBlockers.length===0 && !currentReview;
            if (currentReview) can.reviewAssessment = false;
            if (!can.view) throw new HttpError(403, 'This work request is outside your access.');
            const d = doc.data;
            const photoPaths = objs(d.photos).map((p) => str(p.path));
            const urls = await Promise.all(photoPaths.map((p) => signedUrl(p)));
            return {
                ...wrOut(doc),
                description: str(d.description),
                sourceCode: str(d.sourceCode),
                criticalityOriginalLabel: str(d.criticalityOriginalLabel),
                failureModeCode: str(d.failureModeCode),
                failureModeLabel: str(d.failureModeLabel),
                impacts: objs(d.impacts).map((i) => ({ code: str(i.code), label: str(i.label), group: str(i.group) })),
                photos: photoPaths.map((p, i) => ({ token: p, url: urls[i] })).filter((p) => p.url),
                gembaTypeCode: str(d.gembaTypeCode), gembaTypeName: str(d.gembaTypeName),
                gembaId: str(d.gembaId), gembaObservationId: str(d.gembaObservationId),
                assessment: {
                    maintenanceTypeCode: str(d.maintenanceTypeCode),
                    maintenanceTypeLabel: str(d.maintenanceTypeLabel),
                    workTypeCode: str(d.workTypeCode),
                    workTypeLabel: str(d.workTypeLabel),
                    priorityCode: str(d.priorityCode),
                    priorityLabel: str(d.priorityLabel),
                    disciplineCode: str(d.disciplineCode),
                    disciplineLabel: str(d.disciplineLabel),
                    duplicateOf: str(d.duplicateOf),
                    note: str(d.assessmentNote),
                },
                assessmentTasks: objs(d.assessmentTasks),
                assessmentReview: isObj(d.assessmentReview)?d.assessmentReview:{status:'pending'},
                assessmentReviewCurrent: currentReview,
                returnNote: str(d.returnNote),
                declineReason: str(d.declineReason),
                history: objs(d.history).map((h) => ({ at: str(h.at), name: str(h.name), action: str(h.action), note: str(h.note) })),
                can,
                assessmentReviewBlockers: reviewBlockers,
            };
        }),
    ],

    'POST /api/org/mnt/wr/action': [
        orgRoute('org.mnt.wr.action', null, async (ctx) => withLock(ctx.orgId,'maintenance_operations',async()=>{
            requireMnt(ctx);
            const action = str(ctx.body.action);
            const note = str(ctx.body.note).trim().slice(0, 500);
            const scope = await scopeOf(ctx);
            const doc = await getWr(ctx, str(ctx.body.code));
            const can = wrCan(ctx, doc, scope);
            // Enforce assessor/approver separation on the server as well as in the UI.
            const workflowSettings = await getDoc(`organizations/${ctx.orgId}/maintenance_workflow_settings/default`);
            const assessmentLeadRole = str(isObj(workflowSettings?.data.approverRoles) ? workflowSettings.data.approverRoles['MNT.ASSESS.REVIEW'] : '');
            if (assessmentLeadRole) {
                try {
                    await requireConfiguredMaintenanceRole(ctx,'MNT.ASSESS.REVIEW',pathOf(doc));
                    can.assess = false;
                } catch { /* The employee is not assigned as Maintenance Lead at this location. */ }
            }
            const ref = `${wrCol(ctx.orgId)}/${doc.id}`;
            const now = nowIso();
            const done = async (fields: Record<string, Plain>, label: string, auditAction: string, details = note) => {
                await updateFields(ref, { ...fields, history: history(doc, ctx, label, details), updatedAt: now });
                await rec(ctx, auditAction, doc.id, details);
            };
            const deny = (allowed: boolean, why: string) => {
                if (!allowed) throw new HttpError(403, why);
            };
            const l = await lists();
            switch (action) {
                case 'edit': {
                    deny(can.edit, 'Only the requester can edit, and only before review starts.');
                    const finding = await readFinding(l, ctx.body);
                    const existing = objs(doc.data.photos).map((p) => str(p.path));
                    const photos = readPhotos(ctx, ctx.body.photos, existing);
                    // A work request can be edited and submitted without any photo.
                    await done({ ...finding, photos: photos.map((p) => ({ path: p, addedAt: now })) }, 'Edited by requester', 'mnt.wr.edited', finding.title);
                    return { ok: true };
                }
                case 'resubmit':
                    deny(can.resubmit, 'Only the requester can resubmit a returned request.');
                    await done({ status: 'submitted', returnNote: '', assessmentReview: null }, 'Resubmitted', 'mnt.wr.resubmitted');
                    return { ok: true };
                case 'cancel':
                    deny(can.cancel, 'Only the requester can cancel, and only before review starts.');
                    if (note.length < 5) throw new HttpError(400, 'Give the reason for cancelling (at least 5 characters).');
                    confirmCode(ctx, doc);
                    await done({ status: 'cancelled', cancelReason: note, closedAt: now }, 'Cancelled', 'mnt.wr.cancelled');
                    return { ok: true };
                case 'start_review':
                    deny(can.startReview, can.ownRequest ? 'You cannot review your own request.' : 'You cannot review this request.');
                    await done({ status: 'under_review', reviewer: ctx.uid, reviewerName: displayName(ctx), reviewStartedAt: now }, 'Review started', 'mnt.wr.review_started', '');
                    return { ok: true };
                case 'assess': {
                    deny(can.assess, 'You cannot assess this request.');
                    const b = ctx.body;
                    const mtype = pick(l.maintenanceTypes, str(b.maintenanceTypeCode), 'maintenance type')!;
                    const wtype = pick(l.workTypes, str(b.workTypeCode), 'work type')!;
                    const prio = pick(l.priorities, str(b.priorityCode), 'priority')!;
                    const disc = pick(l.disciplines, str(b.disciplineCode), 'discipline')!;
                    const crit = pick(l.criticality, str(b.criticalityCode) || str(doc.data.criticalityCode), 'criticality')!;
                    const duplicateOf = str(b.duplicateOf);
                    if (duplicateOf && (!WR_RE.test(duplicateOf) || duplicateOf === doc.id)) throw new HttpError(400, 'Enter a valid related work request number.');
                    const changedCrit = crit.code !== str(doc.data.criticalityCode);
                    await done(
                        {
                            maintenanceTypeCode: mtype.code,
                            maintenanceTypeLabel: mtype.label,
                            workTypeCode: wtype.code,
                            workTypeLabel: wtype.label,
                            priorityCode: prio.code,
                            priorityLabel: prio.label,
                            disciplineCode: disc.code,
                            disciplineLabel: disc.label,
                            criticalityCode: crit.code,
                            criticalityLabel: crit.label,
                            criticalityColor: crit.color,
                            ...(changedCrit && str(doc.data.criticalityCode) && !str(doc.data.criticalityOriginalLabel) ? { criticalityOriginalLabel: str(doc.data.criticalityLabel) } : {}),
                            duplicateOf,
                            assessmentNote: note,
                            assessedBy: ctx.uid,
                            assessedByName: displayName(ctx),
                            assessedAt: now,
                            assessmentReview: null,
                        },
                        'Assessed',
                        'mnt.wr.assessed',
                        `${mtype.label} · ${wtype.label} · ${prio.label} · ${disc.label}${changedCrit ? ` · criticality ${str(doc.data.criticalityLabel) || 'not set'} → ${crit.label}` : ''}${note ? ` · ${note}` : ''}`
                    );
                    return { ok: true };
                }
                case 'save_task_assessment': {
                    deny(can.assess, 'You cannot assess this request.');
                    let tasks;
                    try{
                        const matrixDoc=await getDoc(`organizations/${ctx.orgId}/saf/risk_matrix`);
                        const matrix=(matrixDoc?.data?.configuration||defaultMaintenanceRiskMatrix) as RiskMatrix;
                        tasks=finalizeAssessedTaskRisks(validateAssessmentTasks(ctx.body.tasks),matrix);
                    } catch(e){throw new HttpError(400,e instanceof Error?e.message:'Invalid assessment tasks.');}
                    // Every task owns its parts/services/tools/risk. Legacy header-level
                    // spares/services are deliberately not written by this action.
                    const hierarchy=await serviceCatalogHierarchy();
                    if(hierarchy.categories.length){
                        for(const task of tasks)for(const service of task.services){
                            const sub=hierarchy.subcategories.find(c=>c.code===service.subcategoryCode&&c.categoryCode===service.categoryCode);
                            const family=hierarchy.families.find(c=>c.code===service.classCode&&c.subcategoryCode===service.subcategoryCode);
                            if(!sub||!family)throw new HttpError(400,'Choose a valid service category, subcategory and family/class from the approved hierarchy.');
                        }
                    }
                    await verifyAssessedTaskChoices(ctx,doc,tasks);
                    tasks=await prepareMaintenanceAssessment(ctx,doc,tasks);
                    const allProposed=tasks.flatMap(t=>t.services.flatMap(x=>x.proposedVendorIds));
                    if(allProposed.length){
                        const vendors=await listDocs(`organizations/${ctx.orgId}/vendors`);
                        const approved=new Set(vendors.filter(v=>str(v.data.status)==='approved'&&objs(v.data.scopes).some(x=>str(x.kind)==='service')).map(v=>v.id));
                        if(allProposed.some(id=>!approved.has(id)))throw new HttpError(400,'Choose proposed service vendors from the approved service vendor list.');
                    }
                    const version=(Number(doc.data.assessmentTasksVersion)||0)+1;
                    const assemblyId=str(doc.data.assemblyId);
                    for(const task of tasks){
                        const dest=`organizations/${ctx.orgId}/asset_task_templates/${task.assemblyId||assemblyId}_${task.id}`;
                        const adopted=await getDoc(dest);
                        if(task.templateStatus==='existing'&&(!adopted||str(adopted.data.status)!=='approved'))
                            throw new HttpError(400,'Selected reusable task has not been validated for this assembly.');
                        if(task.templateStatus==='existing'&&!sameTemplate(adopted.data.task,task))task.templateStatus='pending_validation';
                    }
                    // Snapshot each newly created task as a separate validation candidate.
                    // These entries are not active equipment/assembly templates yet.
                    for(const task of tasks.filter(t=>t.templateStatus!=='existing')){
                        const id=`${doc.id}_${task.id}_v${version}`;
                        await writeDoc(`organizations/${ctx.orgId}/asset_task_proposals/${id}`,{
                            wrCode:doc.id,assemblyId:task.assemblyId||assemblyId,assetTag:str(doc.data.assetTag),taskId:task.id,
                            description:task.description,task:task as unknown as Plain,assessmentVersion:version,
                            status:'pending_validation',createdBy:ctx.uid,createdAt:now
                        },{exists:false});
                    }
                    const summary=summarizeAssessmentTasks(tasks);
                    await done({assessmentTasks:tasks as unknown as Plain,assessmentTasksBy:ctx.uid,
                        assessmentTasksAt:now,assessmentTasksVersion:version,assessmentReview:null},
                        'Task assessments saved','mnt.wr.task_assessments',JSON.stringify(summary));
                    return {ok:true,summary};
                }
                case 'review_assessment':
                case 'return_assessment': {
                    if(str(doc.data.status)!=='under_review')throw new HttpError(409,'Start the work request review before assessment approval.');
                    need(ctx,P.assessment_review,pathOf(doc),scope);
                    const role=await requireConfiguredMaintenanceRole(ctx,'MNT.ASSESS.REVIEW',pathOf(doc));
                    const issue=reviewAssessmentPrerequisites(doc.data,ctx.uid);
                    if(issue)throw new HttpError(409,issue);
                    if(!str(doc.data.maintenanceTypeCode)||!str(doc.data.workTypeCode)||!str(doc.data.priorityCode)||!str(doc.data.disciplineCode))
                        throw new HttpError(409,'Complete maintenance type, work type, priority and discipline before approval.');
                    if(note.length<10)throw new HttpError(400,'Provide technical review notes (at least 10 characters).');
                    if(action==='return_assessment'){
                        await done({assessmentReview:{status:'changes_requested',version:Number(doc.data.assessmentTasksVersion)||0,
                            by:ctx.uid,name:displayName(ctx),at:now,note,jobRole:role.role}},
                            'Assessment returned for correction','mnt.assessment.returned',note);
                        return {ok:true};
                    }
                    const snapshot=approvedAssessmentSnapshot(doc.data,ctx.uid,displayName(ctx),role.role,now,note);
                    await done({assessmentReview:snapshot},'Work assessment approved','mnt.assessment.approved',note);
                    return {ok:true};
                }
                case 'return':
                    deny(can.return, 'You cannot return this request.');
                    if (note.length < 5) throw new HttpError(400, 'Say what information is needed (at least 5 characters).');
                    await done({ status: 'returned', returnNote: note }, 'Returned for information', 'mnt.wr.returned');
                    return { ok: true };
                case 'decline':
                    deny(can.decline, 'You cannot decline this request.');
                    if (note.length < 5) throw new HttpError(400, 'Give the reason for declining (at least 5 characters).');
                    confirmCode(ctx, doc);
                    await done({ status: 'declined', declineReason: note, closedAt: now }, 'Declined', 'mnt.wr.declined');
                    return { ok: true };
                case 'convert': {
                    deny(can.convert, can.ownRequest ? 'You cannot convert your own request.' : 'You cannot convert this request.');
                    const d = doc.data;
                    if (!str(d.maintenanceTypeCode) || !str(d.workTypeCode) || !str(d.priorityCode) || !str(d.disciplineCode)) throw new HttpError(400, 'Complete the assessment (maintenance type, work type, priority and discipline) before converting.');
                    if(!objs(d.assessmentTasks).length) throw new HttpError(409,'Complete the task-by-task work assessment, including spares, services and each task risk assessment, before conversion.');
                    await ensureCurrentAssessmentApproval(ctx,d);
                    await requireConfiguredMaintenanceRole(ctx,'MNT.WR.CONVERT',pathOf(doc));
                    confirmCode(ctx, doc);
                    const keys = ['assemblyId', 'assemblyCode', 'assemblyName', 'unitId', 'unitCode', 'unitName', 'costCenterId', 'costCenterCode', 'costCenterName', 'siteId', 'siteCode', 'siteName', 'assetTag', 'assetName', 'assetClass', 'title', 'description', 'criticalityCode', 'criticalityLabel', 'criticalityColor', 'maintenanceTypeCode', 'maintenanceTypeLabel', 'workTypeCode', 'workTypeLabel', 'priorityCode', 'priorityLabel', 'disciplineCode', 'disciplineLabel', 'failureModeCode', 'failureModeLabel'];
                    const base: Record<string, Plain> = Object.fromEntries(keys.map((k) => [k, str(d[k])]));
                    base.path = strs(d.path);
                    base.assessmentTasks = objs(d.assessmentTasks) as unknown as Plain;
                    base.assessmentTasksVersion = Number(d.assessmentTasksVersion)||1;
                    base.assessmentTasksAt = str(d.assessmentTasksAt);
                    base.assessedAt = str(d.assessedAt);
                    base.requestedBy = str(d.requestedBy);
                    base.assessedBy = str(d.assessedBy);
                    base.assessmentTasksBy = str(d.assessmentTasksBy);
                    base.assessmentReview = d.assessmentReview as Plain;
                    const woCode = await createWo(ctx, base, doc.id);
                    await done({ status: 'converted', woCode, convertedBy: ctx.uid, convertedByName: displayName(ctx), convertedAt: now, closedAt: now }, `Converted to ${woCode}`, 'mnt.wr.converted', woCode);
                    await rec(ctx, 'mnt.wo.created', woCode, `From ${doc.id}`);
                    return { ok: true, woCode };
                }
                default:
                    throw new HttpError(400, 'Unknown action.');
            }
        })),
    ],

    // ----- Work orders -----

    // Legacy endpoint fails closed: work orders originate from approved Work Requests only.
    'POST /api/org/mnt/wo/create': [
        orgRoute('org.mnt.wo.create',null,async()=>{
            throw new HttpError(409,'Direct work order creation is disabled. Complete and approve a Work Request assessment first.');
        })
    ],

    'POST /api/org/mnt/wo/list': [
        orgRoute('org.mnt.wo.list', null, async (ctx) => {
            requireMnt(ctx);
            const view = str(ctx.body.view);
            const scope = await scopeOf(ctx);
            const groups: Record<string, string[]> = {
                planning: ['planning', 'plan_ready'],
                execution: ['released', 'scheduled', 'in_progress'],
                verification: ['completed', 'verified'],
                closed: ['closed', 'cancelled'],
            };
            const rows = (await listDocs(woCol(ctx.orgId)))
                .filter((d) => canAt(ctx, P.view, pathOf(d), scope))
                .filter((d) => (groups[view] ? groups[view].includes(str(d.data.status)) : view === 'mine' ? objs(d.data.assignees).some((a) => str(a.uid) === ctx.uid) || str(d.data.plannedBy) === ctx.uid : true))
                .sort((a, b) => b.id.localeCompare(a.id))
                .map(woOut);
            return { rows };
        }),
    ],

    'POST /api/org/mnt/wo/get': [
        orgRoute('org.mnt.wo.get', null, async (ctx) => {
            requireMnt(ctx);
            const scope = await scopeOf(ctx);
            const doc = await getWo(ctx, str(ctx.body.code));
            const l = await lists();
            const can = woCan(ctx, doc, scope, l);
            if (!can.view) throw new HttpError(403, 'This work order is outside your access.');
            const d = doc.data;
            const safety = isObj(d.safety) ? d.safety : {};
            const completion = isObj(d.completion) ? d.completion : {};
            return {
                ...woOut(doc),
                description: str(d.description),
                failureModeLabel: str(d.failureModeLabel),
                maintenanceTypeCode: str(d.maintenanceTypeCode),
                workTypeCode: str(d.workTypeCode),
                priorityCode: str(d.priorityCode),
                disciplineCode: str(d.disciplineCode),
                tasks: objs(d.tasks),
                assessmentTasks: objs(d.assessmentTasks),
                spares: objs(d.spares),
                services: objs(d.services),
                tools: str(d.tools),
                executionLocationCode: str(d.executionLocationCode),
                executionLocationLabel: str(d.executionLocationLabel),
                downtimeHours: Number(d.downtimeHours) || 0,
                targetDate: str(d.targetDate),
                plannedByName: str(d.plannedByName),
                plannedAt: str(d.plannedAt),
                safety: {
                    riskCode: str(safety.riskCode),
                    riskLabel: str(safety.riskLabel),
                    hazards: strs(safety.hazards),
                    permits: strs(safety.permits),
                    ppe: strs(safety.ppe),
                    isolation: safety.isolation === true,
                    controls: str(safety.controls),
                    assessedByName: str(safety.assessedByName),
                    assessedAt: str(safety.assessedAt),
                },
                releasedByName: str(d.releasedByName),
                releasedAt: str(d.releasedAt),
                assignees: objs(d.assignees).map((a) => ({ uid: str(a.uid), name: str(a.name) })),
                supervisorName: str(d.supervisorName),
                startedAt: str(d.startedAt),
                timeLogs: objs(d.timeLogs).map((t) => ({ id: str(t.id), name: str(t.name), date: str(t.date), hours: Number(t.hours) || 0, note: str(t.note) })),
                sparesUsed: objs(d.sparesUsed).map((s) => ({ id: str(s.id), description: str(s.description), qty: Number(s.qty) || 0, uom: str(s.uom), unitCost: Number(s.unitCost) || 0, name: str(s.name) })),
                completion: {
                    findings: str(completion.findings),
                    rootCauseLabel: str(completion.rootCauseLabel),
                    solutionLabel: str(completion.solutionLabel),
                    outcomeLabel: str(completion.outcomeLabel),
                    downtimeClassLabel: str(completion.downtimeClassLabel),
                    actualDowntimeHours: Number(completion.actualDowntimeHours) || 0,
                    completedByName: str(d.completedByName),
                    completedAt: str(d.completedAt),
                },
                verification: { typeLabel: str(d.verificationTypeLabel), note: str(d.verificationNote), byName: str(d.verifiedByName), at: str(d.verifiedAt) },
                actuals: actuals(d),
                closeNote: str(d.closeNote),
                cancelReason: str(d.cancelReason),
                history: objs(d.history).map((h) => ({ at: str(h.at), name: str(h.name), action: str(h.action), note: str(h.note) })),
                currency: str(ctx.org.data.currencyCode),
                can,
            };
        }),
    ],

    'POST /api/org/mnt/wo/people': [
        orgRoute('org.mnt.wo.people', null, async (ctx) => {
            requireMnt(ctx);
            if (!canAnywhere(ctx, P.WO_schedule)) throw new HttpError(403, 'You do not have permission to do this.');
            const users = await orgUserMap(ctx.orgId);
            return { people: Array.from(users.entries()).map(([uid, name]) => ({ uid, name })).sort((a, b) => a.name.localeCompare(b.name)) };
        }),
    ],

    'POST /api/org/mnt/catalog-search': [
        orgRoute('org.mnt.catalog_search', null, async (ctx) => {
            requireMnt(ctx);
            // Technical catalogue lookups are needed during open work assessment,
            // before the maintenance planner is involved. Read-only and tenant-authenticated.
            const kind = str(ctx.body.kind) === 'services' ? 'services' : 'materials';
            const q = clean(ctx.body.q, 60);
            if (q.length < 2) return { items: [] };
            return { items: await searchCatalog(kind, q, 25) };
        }),
    ],

    'POST /api/org/mnt/wo/action': [
        orgRoute('org.mnt.wo.action', null, async (ctx) => withLock(ctx.orgId,'maintenance_operations',async()=>{
            requireMnt(ctx);
            const action = str(ctx.body.action);
            const note = str(ctx.body.note).trim().slice(0, 1000);
            const scope = await scopeOf(ctx);
            const doc = await getWo(ctx, str(ctx.body.code));
            const l = await lists();
            const can = woCan(ctx, doc, scope, l);
            const d = doc.data;
            const b = ctx.body;
            const ref = `${woCol(ctx.orgId)}/${doc.id}`;
            const now = nowIso();
            const done = async (fields: Record<string, Plain>, label: string, auditAction: string, details = note) => {
                await updateFields(ref, { ...fields, history: history(doc, ctx, label, details), updatedAt: now });
                await rec(ctx, auditAction, doc.id, details);
            };
            const deny = (allowed: boolean, why: string) => {
                if (!allowed) throw new HttpError(403, why);
            };
            await enforceMaintenanceTransition(ctx,doc,action);
            switch (action) {
                case 'save_task_assessment': {
                    if(!canAt(ctx,P.assessment_edit,pathOf(doc),scope)||str(d.status)!=='planning')
                        throw new HttpError(403,'The work order must be in assessment/planning and within your scope.');
                    if(isObj(d.taskPlanning)&&Object.keys(d.taskPlanning).length)throw new HttpError(409,'Open controlled reassessment before editing a task whose resources have already been planned.');
                    let tasks;
                    try{
                        const m=await getDoc(`organizations/${ctx.orgId}/saf/risk_matrix`);
                        tasks=finalizeAssessedTaskRisks(validateAssessmentTasks(b.tasks),
                            (m?.data?.configuration||defaultMaintenanceRiskMatrix) as RiskMatrix);
                    }catch(e){throw new HttpError(400,e instanceof Error?e.message:'Invalid task work assessment.');}
                    await verifyAssessedTaskChoices(ctx,doc,tasks);
                    tasks=await prepareMaintenanceAssessment(ctx,doc,tasks);
                    const allProposed=tasks.flatMap(t=>t.services.flatMap(v=>v.proposedVendorIds));
                    if(allProposed.length){
                        const vendors=await listDocs(`organizations/${ctx.orgId}/vendors`);
                        const valid=new Set(vendors.filter(v=>str(v.data.status)==='approved'&&objs(v.data.scopes).some(x=>str(x.kind)==='service')).map(v=>v.id));
                        if(allProposed.some(id=>!valid.has(id)))throw new HttpError(400,'Choose approved service vendors only.');
                    }
                    const assemblyId=str(d.assemblyId);
                    const hierarchy=await serviceCatalogHierarchy();
                    if(hierarchy.categories.length)for(const t of tasks)for(const svc of t.services){
                        if(!hierarchy.subcategories.some(x=>x.code===svc.subcategoryCode&&x.categoryCode===svc.categoryCode)
                            ||!hierarchy.families.some(x=>x.code===svc.classCode&&x.subcategoryCode===svc.subcategoryCode))
                            throw new HttpError(400,'Select a valid service category, subcategory and class.');
                    }
                    const version=(Number(d.assessmentTasksVersion)||0)+1;
                    for(const t of tasks){
                        const approved=await getDoc(`organizations/${ctx.orgId}/asset_task_templates/${t.assemblyId||assemblyId}_${t.id}`);
                        if(t.templateStatus==='existing'&&(!approved||str(approved.data.status)!=='approved'))
                            throw new HttpError(400,'Selected task template must be validated for the assembly.');
                        if(t.templateStatus==='existing'&&!sameTemplate(approved.data.task,t))t.templateStatus='pending_validation';
                    }
                    for(const t of tasks.filter(x=>x.templateStatus!=='existing')){
                        const id=`${doc.id}_${t.id}_v${version}`;
                        await writeDoc(`organizations/${ctx.orgId}/asset_task_proposals/${id}`,{
                            woCode:doc.id,assemblyId:t.assemblyId||assemblyId,assetTag:str(d.assetTag),taskId:t.id,description:t.description,
                            task:t as unknown as Plain,assessmentVersion:version,status:'pending_validation',
                            createdBy:ctx.uid,createdAt:now
                        },{exists:false});
                    }
                    await done({assessmentTasks:tasks as unknown as Plain,tasks:assessmentTaskSummaries(tasks) as unknown as Plain,
                        spares:[],services:[],tools:'',assessmentTasksBy:ctx.uid,assessmentTasksAt:now,
                        assessmentTasksVersion:version,assessmentReview:null,safety:null},
                        'Task assessments completed','mnt.wo.task_assessments',
                        JSON.stringify(summarizeAssessmentTasks(tasks)));
                    return {ok:true};
                }
                case 'review_assessment':
                case 'return_assessment': {
                    if(str(d.status)!=='planning')throw new HttpError(409,'Assessment review must occur before planning submission.');
                    need(ctx,P.assessment_review,pathOf(doc),scope);
                    const role=await requireConfiguredMaintenanceRole(ctx,'MNT.ASSESS.REVIEW',pathOf(doc));
                    const issue=reviewAssessmentPrerequisites(d,ctx.uid);
                    if(issue)throw new HttpError(409,issue);
                    if(note.length<10)throw new HttpError(400,'Write technical review notes (at least 10 characters).');
                    const approval=action==='return_assessment'
                        ?{status:'changes_requested',version:Number(d.assessmentTasksVersion)||0,by:ctx.uid,name:displayName(ctx),at:now,note,jobRole:role.role}
                        :approvedAssessmentSnapshot(d,ctx.uid,displayName(ctx),role.role,now,note);
                    await done({assessmentReview:approval},action==='return_assessment'?'Assessment returned for correction':'Work assessment approved',
                        action==='return_assessment'?'mnt.assessment.returned':'mnt.assessment.approved',note);
                    return {ok:true};
                }
                case 'save_plan': {
                    deny(can.plan, 'You cannot plan this work order.');
                    const assessedTasks=objs(d.assessmentTasks);
                    // A converted request already has assessed task scope/resources/risk;
                    // planning cannot silently replace them through the legacy flat form.
                    if (!assessedTasks.length) throw new HttpError(409, 'Complete the task-by-task work assessment first.');
                    await ensureCurrentAssessmentApproval(ctx,d);
                    if(objs(b.tasks).length||objs(b.spares).length||objs(b.services).length||str(b.tools))throw new HttpError(409,'Technical requirements can only change through controlled task reassessment.');
                    await requireMaintenanceRole(ctx,'MNT.WO.PLAN',pathOf(doc));
                    const tasks = assessedTasks;
                    const spares: Obj[] = [];
                    const services: Obj[] = [];
                    const exec = pick(l.executionLocations, str(b.executionLocationCode), 'execution location', false);
                    const fields: Record<string, Plain> = {
                        tasks: assessmentTaskSummaries(tasks as any) as unknown as Plain,
                        spares: spares as unknown as Plain,
                        services: services as unknown as Plain,
                        tools: '',
                        executionLocationCode: exec?.code ?? '',
                        executionLocationLabel: exec?.label ?? '',
                        downtimeHours: numIn(b.downtimeHours ?? 0, 0, 10000, 'Downtime hours'),
                        targetDate: readDate(b.targetDate, 'target date', false),
                        plannedBy: ctx.uid,
                        plannedByName: displayName(ctx),
                        plannedAt: now,
                    };
                    // A changed plan must be safety-assessed again and is back in planning.
                    if (str(d.status) === 'plan_ready' || isObj(d.safety)) {
                        fields.status = 'planning';
                        fields.safety = null;
                    }
                    const est = estimate({...d,...fields} as Obj);
                    await done(fields, 'Plan saved', 'mnt.wo.planned', `${tasks.length} tasks, ${spares.length} spares, ${services.length} services · estimate ${est.total}`);
                    return { ok: true };
                }
                case 'save_safety': {
                    deny(can.safety, can.highRisk && can.isPlanner ? 'High-risk work must be safety-assessed by someone other than the planner.' : 'You cannot do the safety assessment here.');
                    const risk = pick(l.criticality, str(b.riskCode), 'risk level')!;
                    const hazards = strs(b.hazards).filter((h) => HAZARDS.includes(h));
                    const permits = strs(b.permits).filter((p) => PERMITS.includes(p));
                    const ppe = strs(b.ppe).filter((p) => PPE.includes(p));
                    const controls = str(b.controls).trim().slice(0, 1500);
                    if (controls.length < 10) throw new HttpError(400, 'Describe the control measures (at least 10 characters).');
                    if (!ppe.length) throw new HttpError(400, 'Choose the PPE required.');
                    const top = l.criticality.slice(0, 2).map((c) => c.code);
                    if ((permits.length || top.includes(risk.code)) && str(d.plannedBy) === ctx.uid) throw new HttpError(403, 'High-risk work must be safety-assessed by someone other than the planner.');
                    await done(
                        { safety: { riskCode: risk.code, riskLabel: risk.label, hazards, permits, ppe, isolation: b.isolation === true, controls, assessedBy: ctx.uid, assessedByName: displayName(ctx), assessedAt: now } },
                        'Safety assessed',
                        'mnt.wo.safety',
                        `${risk.label} · ${permits.length ? permits.join(', ') : 'no permits'}`
                    );
                    return { ok: true };
                }
                case 'submit_plan':
                    deny(can.submitPlan, 'You cannot submit this plan.');
                    if (!objs(d.assessmentTasks).length) throw new HttpError(409, 'Complete the task-by-task assessment first.');
                    await ensureCurrentAssessmentApproval(ctx,d);
                    await requireMaintenanceRole(ctx,'MNT.WO.PLAN',pathOf(doc));
                    await done({ status: 'plan_ready' }, 'Plan ready for release', 'mnt.wo.plan_ready', `Estimate ${estimate(d).total}`);
                    return { ok: true };
                case 'release':
                    deny(can.release, can.isPlanner ? 'You planned this work order, so another person must release it.' : 'You cannot release this work order.');
                    confirmCode(ctx, doc);
                    await done({ status: 'released', releasedBy: ctx.uid, releasedByName: displayName(ctx), releasedAt: now, releaseEstimate: estimate(d).total }, 'Released', 'mnt.wo.released', `Estimate ${estimate(d).total}${note ? ` · ${note}` : ''}`);
                    return { ok: true };
                case 'schedule': {
                    deny(can.schedule, 'You cannot schedule this work order.');
                    const start = readDate(b.scheduledStart, 'start');
                    const end = readDate(b.scheduledEnd, 'finish');
                    if (Date.parse(end) < Date.parse(start)) throw new HttpError(400, 'The finish must be after the start.');
                    const users = await orgUserMap(ctx.orgId);
                    const ids = [...new Set(strs(b.assignees))];
                    if (!ids.length || ids.length > 20) throw new HttpError(400, 'Assign between 1 and 20 people.');
                    if (ids.some((id) => !users.has(id))) throw new HttpError(400, 'Choose people from your organization.');
                    const sup = str(b.supervisor);
                    if (sup && !users.has(sup)) throw new HttpError(400, 'Choose the supervisor from your organization.');
                    await done(
                        { status: 'scheduled', scheduledStart: start, scheduledEnd: end, assignees: ids.map((id) => ({ uid: id, name: users.get(id) ?? '' })), supervisor: sup, supervisorName: sup ? users.get(sup) ?? '' : '', scheduledBy: ctx.uid, scheduledByName: displayName(ctx), scheduledAt: now },
                        'Scheduled',
                        'mnt.wo.scheduled',
                        `${start} to ${end} · ${ids.map((id) => users.get(id)).join(', ')}`
                    );
                    return { ok: true };
                }
                case 'start':
                    deny(can.start, 'You cannot start this work order.');
                    await done({ status: 'in_progress', startedAt: now, startedBy: ctx.uid, startedByName: displayName(ctx) }, 'Work started', 'mnt.wo.started', '');
                    return { ok: true };
                case 'log_time': {
                    deny(can.execute, 'You cannot book time on this work order.');
                    const date = readDate(b.date, 'date');
                    const hours = numIn(b.hours, 0.25, 24, 'Hours');
                    const logs = [...objs(d.timeLogs), { id: randomId(4), uid: ctx.uid, name: displayName(ctx), date, hours, note: clean(note, 300), at: now }];
                    if (logs.length > 300) throw new HttpError(400, 'Too many time entries.');
                    await done({ timeLogs: logs as unknown as Plain }, `Booked ${hours} h`, 'mnt.wo.time', `${hours} h on ${date}`);
                    return { ok: true };
                }
                case 'use_spare': {
                    deny(can.execute, 'You cannot book spares on this work order.');
                    if (await financeLiveFor(ctx.orgId, str(d.costCenterId))) throw new HttpError(409, 'Finance is live for this legal entity, so spares are drawn from the warehouse with a goods issue against this work order (Inventory > Goods issue). Their cost then reaches the ledger.');
                    const planned = objs(d.spares).find((s) => str(s.id) === str(b.spareId));
                    const description = planned ? str(planned.description) : clean(b.description, 200);
                    if (description.length < 2) throw new HttpError(400, 'Describe the spare used.');
                    const qty = numIn(b.qty, 0.001, 1_000_000, 'Quantity');
                    const used = [...objs(d.sparesUsed), { id: planned ? str(planned.id) : randomId(4), description, qty, uom: planned ? str(planned.uom) : clean(b.uom, 12) || 'EA', unitCost: planned ? Number(planned.unitCost) || 0 : numIn(b.unitCost ?? 0, 0, 1_000_000_000, 'Unit cost'), uid: ctx.uid, name: displayName(ctx), at: now }];
                    if (used.length > 200) throw new HttpError(400, 'Too many spare entries.');
                    await done({ sparesUsed: used as unknown as Plain }, `Spare used: ${qty} × ${description}`, 'mnt.wo.spare', `${qty} × ${description}`);
                    return { ok: true };
                }
                case 'complete': {
                    deny(can.execute, 'You cannot complete this work order.');
                    if (!objs(d.timeLogs).length) throw new HttpError(400, 'Book the time worked before completing.');
                    const findings = str(b.findings).trim().slice(0, 2000);
                    if (findings.length < 10) throw new HttpError(400, 'Describe what was found and done (at least 10 characters).');
                    const cause = pickGrouped(l.rootCauses, str(b.rootCauseCode), 'cause')!;
                    const solution = pickGrouped(l.solutions, str(b.solutionCode), 'action taken')!;
                    const outcome = pick(l.outcomes, str(b.outcomeCode), 'outcome')!;
                    const downtime = pick(l.downtimeClasses, str(b.downtimeClassCode), 'downtime class')!;
                    await done(
                        {
                            status: 'completed',
                            completion: { findings, rootCauseCode: cause.code, rootCauseLabel: `${cause.group} · ${cause.label}`, solutionCode: solution.code, solutionLabel: `${solution.group} · ${solution.label}`, outcomeCode: outcome.code, outcomeLabel: outcome.label, downtimeClassCode: downtime.code, downtimeClassLabel: downtime.label, actualDowntimeHours: numIn(b.actualDowntimeHours ?? 0, 0, 10000, 'Downtime hours') },
                            completedBy: ctx.uid,
                            completedByName: displayName(ctx),
                            completedAt: now,
                        },
                        'Completed',
                        'mnt.wo.completed',
                        `${outcome.label} · ${solution.label}`
                    );
                    return { ok: true };
                }
                case 'verify': {
                    deny(can.verify, can.didWork ? 'You worked on this order, so someone else must verify it.' : 'You cannot verify this work order.');
                    const vtype = pick(l.verificationTypes, str(b.verificationTypeCode), 'verification type')!;
                    const result = str(b.result);
                    if (result === 'rework') {
                        if (note.length < 5) throw new HttpError(400, 'Say what must be redone (at least 5 characters).');
                        await done({ status: 'in_progress', verificationTypeLabel: vtype.label, verificationNote: note }, 'Sent back for rework', 'mnt.wo.rework');
                        return { ok: true };
                    }
                    if (result !== 'accepted') throw new HttpError(400, 'Choose whether the work is accepted.');
                    await done({ status: 'verified', verificationTypeCode: vtype.code, verificationTypeLabel: vtype.label, verificationNote: note, verifiedBy: ctx.uid, verifiedByName: displayName(ctx), verifiedAt: now }, 'Verified', 'mnt.wo.verified', `${vtype.label}${note ? ` · ${note}` : ''}`);
                    return { ok: true };
                }
                case 'close': {
                    deny(can.close, 'You cannot close this work order.');
                    confirmCode(ctx, doc);
                    return executeMaintenanceAction(ctx,doc,'technical_close');
                }
                case 'cancel':
                    deny(can.cancel, 'You cannot cancel this work order.');
                    if (note.length < 5) throw new HttpError(400, 'Give the reason for cancelling (at least 5 characters).');
                    confirmCode(ctx, doc);
                    await done({ status: 'cancelled', cancelReason: note, cancelledBy: ctx.uid, cancelledByName: displayName(ctx), cancelledAt: now }, 'Cancelled', 'mnt.wo.cancelled');
                    return { ok: true };
                case 'reopen':
                    deny(can.reopen, 'You cannot reopen this work order.');
                    if (note.length < 5) throw new HttpError(400, 'Give the reason for reopening (at least 5 characters).');
                    confirmCode(ctx, doc);
                    await done({ status: 'in_progress', reopenReason: note }, 'Reopened', 'mnt.wo.reopened');
                    return { ok: true };
                default:
                    throw new HttpError(400, 'Unknown action.');
            }
        })),
    ],
};

