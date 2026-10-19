import { storage } from './platform/sdk';
import { HttpError, getDoc, isObj, listDocs, nowIso, randomId, rateLimit, runQuery, fieldEq, str, updateFields, writeDoc, type Doc, type Obj, type Plain } from './core';
import { audit } from './audit';
import { orgRoute, type OrgContext } from './guards';
import { nextOrgCounter } from './positions';
import { detectImage } from './branding';
import { DEFAULT_MODULE_METADATA } from './moduleDefaults';
import { ID_RE, col, signedUrl } from './structure';
import { canAnywhere, canAt, scopeOf,nodePath, type Scope } from './access';
import { searchCatalog } from './procurement';
import {MAINTENANCE_GATES,maintenanceGateReadiness} from './maintenanceWorkflowConfig';
import {validateAssessmentTasks,summarizeAssessmentTasks} from './maintenanceTaskAssessment';

// ---------------------------------------------------------------------------
// Maintenance Management (MNT)
//
// Work request  organizations/{orgId}/work_requests/{WR00000001}   (counter organizations/{orgId}.wrSeq)
//   submitted -> under_review -> converted (locked, linked to the work order)
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

export const MNT_ACTIVITIES: Array<{ key: string; label: string }> = [
    { key: 'MNT.view', label: 'View work requests and work orders' },
    { key: 'MNT.WR.create', label: 'Work request: raise' },
    { key: 'MNT.WR.edit', label: 'Work request: edit own (before review) and resubmit' },
    { key: 'MNT.WR.cancel', label: 'Work request: cancel own (before review)' },
    { key: 'MNT.WR.review', label: 'Work request: review and assess' },
    { key: 'MNT.WR.return', label: 'Work request: return to requester for information' },
    { key: 'MNT.WR.decline', label: 'Work request: decline' },
    { key: 'MNT.WR.convert', label: 'Work request: convert to work order' },
    { key: 'MNT.WO.create', label: 'Work order: create directly (breakdown, preventive)' },
    { key: 'MNT.WO.plan', label: 'Work order: plan tasks, people, spares and services' },
    { key: 'MNT.WO.safety', label: 'Work order: safety assessment' },
    { key: 'MNT.WO.release', label: 'Work order: release for execution' },
    { key: 'MNT.WO.schedule', label: 'Work order: schedule and assign' },
    { key: 'MNT.WO.execute', label: 'Work order: execute (start, book time and spares, complete)' },
    { key: 'MNT.WO.verify', label: 'Work order: verify completed work' },
    { key: 'MNT.WO.close', label: 'Work order: close' },
    { key: 'MNT.WO.cancel', label: 'Work order: cancel' },
    { key: 'MNT.WO.reopen', label: 'Work order: reopen' },
    { key: 'MNT.activities.view', label: 'Assembly activities: view PM/AM activities' },
    { key: 'MNT.activities.edit', label: 'Assembly activities: define PM/AM activities' },
    { key: 'MNT.admin', label: 'Administer maintenance settings' },
];
const P = Object.fromEntries(MNT_ACTIVITIES.map((a) => [a.key.replace(/^MNT\./, '').replace('.', '_'), a.key])) as Record<string, string>;

const WR_RE = /^WR\d{8}$/;
const WO_RE = /^WO\d{8}$/;
const PHOTO_RE = /^organizations\/[A-Za-z0-9_-]{1,120}\/mnt\/wr_photos\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9]{12}\.(jpg|png)$/;
const MAX_PHOTOS = 4;
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
    return [...prev, { at: nowIso(), uid: ctx.uid, name: displayName(ctx), action, note: note.slice(0, 500) }].slice(-150);
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
    const assetDocs = (await listDocs(`organizations/${ctx.orgId}/assets`)).filter((d) => ['active', 'change_pending', 'pending_approval'].includes(str(d.data.status)));
    // Explicit equipment-unit asset takes priority. Where that reference was not
    // configured, only infer a default if exactly one asset is directly mapped
    // to the unit; never guess between multiple valid mappings.
    const directAssets=unit?assetDocs.filter(d=>str(d.data.workCenterId)===unit.id||str(d.data.nodeId)===unit.id):[];
    const defaultAssetTag=assetDocs.some(d=>d.id===linkedTag)?linkedTag:directAssets.length===1?directAssets[0].id:'';
    const near = assetDocs.filter((d) => d.id === linkedTag || (unit && (str(d.data.workCenterId) === unit.id || str(d.data.nodeId) === unit.id)) || (costCenter && str(d.data.nodeId) === costCenter.id));
    const others = assetDocs.filter((d) => !near.includes(d) && (scope === 'all' || scope.has(str(d.data.nodeId))) && (!site || !str(d.data.siteId) || str(d.data.siteId) === site.id));
    const asset = (d: Doc, linked: boolean) => ({ tag: d.id, name: str(d.data.name), className: str(d.data.className), classCode: str(d.data.classCode), status: str(d.data.status), linked });
    return {
        assembly: { id: assembly.id, code: str(assembly.data.code), name: str(assembly.data.name) },
        unit: unit ? { id: unit.id, code: str(unit.data.code), name: str(unit.data.name), equipmentClass: str(unitAttrs.equipmentClass), equipmentClassName: str(unitAttrs.equipmentClassName) } : null,
        costCenter: costCenter ? { id: costCenter.id, code: str(costCenter.data.code), name: str(costCenter.data.name) } : null,
        site: site ? { id: site.id, code: str(site.data.code), name: str(site.data.name) } : null,
        path: docs.map((d) => ({ id: d.id, level: str(d.data.level), code: str(d.data.code), name: str(d.data.name) })),
        assets: [
            ...near.sort((a, b) => (a.id === defaultAssetTag ? -1 : b.id === defaultAssetTag ? 1 : a.id.localeCompare(b.id))).map((d) => asset(d, d.id === defaultAssetTag)), 
            ...others.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 200).map((d) => asset(d, false)),
        ],
        linkedTag,
        defaultAssetTag,
    };
}
type Place = Awaited<ReturnType<typeof assemblyContext>>;

function placeFields(place: Place, assetTag: string) {
    const asset = place.assets.find((a) => a.tag === assetTag);
    if (!asset) throw new HttpError(400, 'Choose the asset.');
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
        woCode: str(d.woCode),
        updatedAt: str(d.updatedAt),
    };
}

async function readFinding(l: Lists, b: Record<string, unknown>) {
    const title = clean(b.title, 120);
    const description = str(b.description).trim().slice(0, 2000);
    if (title.length < 5) throw new HttpError(400, 'Give the request a short title (5 to 120 characters).');
    if (description.length < 10) throw new HttpError(400, 'Describe what you found (10 to 2000 characters).');
    const source = pickGrouped(l.sources, str(b.sourceCode), 'source of the finding')!;
    const crit = pick(l.criticality, str(b.criticalityCode), 'criticality')!;
    const impactCodes = [...new Set(strs(b.impactCodes))];
    if (!impactCodes.length || impactCodes.length > 6) throw new HttpError(400, 'Choose between 1 and 6 impacts.');
    const impacts = impactCodes.map((c) => findIn(l.impacts, c));
    if (impacts.some((i) => !i)) throw new HttpError(400, 'Choose impacts from the list.');
    const failure = pickGrouped(l.failureModes, str(b.failureModeCode), 'failure mode', false);
    return {
        title,
        description,
        sourceCode: source.code,
        sourceLabel: source.label,
        sourceGroup: source.group,
        criticalityCode: crit.code,
        criticalityLabel: crit.label,
        criticalityColor: crit.color,
        impacts: impacts.map((i) => ({ code: i!.code, label: i!.label, group: i!.group })),
        failureModeCode: failure?.code ?? '',
        failureModeLabel: failure ? `${failure.group} · ${failure.label}` : '',
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
        assess: ['submitted','under_review'].includes(status) && (mine || at(P.view)),
        return: !mine && status === 'under_review' && at(P.WR_return),
        decline: !mine && status === 'under_review' && at(P.WR_decline),
        convert: !mine && status === 'under_review' && at(P.WR_convert),
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
    const tasks = objs(d.tasks);
    const spares = objs(d.spares);
    const services = objs(d.services);
    const labourHours = tasks.reduce((s, t) => s + (Number(t.persons) || 0) * (Number(t.hours) || 0), 0);
    const labour = tasks.reduce((s, t) => s + (Number(t.persons) || 0) * (Number(t.hours) || 0) * (Number(t.rate) || 0), 0);
    // New work assessments own resources within each task. Old work orders still
    // use flat spares/services, so preserve both representations without double counting.
    const taskSpares = tasks.flatMap(t => objs(t.spares));
    const taskServices = tasks.flatMap(t => objs(t.services));
    const sparesCost = (taskSpares.length ? taskSpares : spares).reduce((n, x) => n + (Number(x.qty) || 0) * (Number(x.unitCost) || 0), 0);
    const servicesCost = (taskServices.length ? taskServices : services).reduce((n, x) => n + (Number(x.cost) || 0), 0);
    const r = (n: number) => Math.round(n * 100) / 100;
    return { labourHours: r(labourHours), labour: r(labour), spares: r(sparesCost), services: r(servicesCost), total: r(labour + sparesCost + servicesCost) };
}

function actuals(d: Obj) {
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
        const created = await writeDoc(
            `${woCol(ctx.orgId)}/${code}`,
            {
                ...(base as Record<string, Plain>),
                code,
                wrCode,
                status: 'planning',
                tasks: [],
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
            },
            { exists: false }
        );
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
                note:'Pending-implementation gates are configuration only and do not enable missing transitions.'
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
            const wr=await getWr(ctx,str(ctx.body.code));
            const scope=await scopeOf(ctx);
            if(!wrCan(ctx,wr,scope).view)throw new HttpError(403,'Work request access is required.');
            const docs=await listDocs(`organizations/${ctx.orgId}/asset_task_templates`);
            const assemblyId=str(wr.data.assemblyId);
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
    'POST /api/org/mnt/tasks/validate': [
        orgRoute('org.mnt.tasks.validate',null,async(ctx)=>{
            requireMnt(ctx);
            const id=str(ctx.body.id);
            if(!/^[A-Za-z0-9_-]{6,120}$/.test(id))throw new HttpError(400,'Choose a valid task proposal.');
            const path=`organizations/${ctx.orgId}/asset_task_proposals/${id}`;
            const proposal=await getDoc(path);
            if(!proposal||str(proposal.data.status)!=='pending_validation')throw new HttpError(409,'Task proposal not awaiting validation.');
            if(str(proposal.data.createdBy)===ctx.uid)throw new HttpError(403,'A task creator cannot validate their own task.');
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
            if(!canAt(ctx,'MNT.activities.edit',pathIds,scope))
                throw new HttpError(403,'Asset activity maintenance permission is also required.');
            const taskId=str(proposal.data.taskId);
            const dest=`organizations/${ctx.orgId}/asset_task_templates/${assemblyId}_${taskId}`;
            const existing=await getDoc(dest);
            const version=(Number(existing?.data.version)||0)+1;
            await writeDoc(dest,{assemblyId,taskId,task:proposal.data.task,status:'approved',version,
                validatedFrom:proposal.id,approvedBy:ctx.uid,approvedByName:displayName(ctx),approvedAt:nowIso()});
            await updateFields(path,{status:'approved',approvedBy:ctx.uid,approvedByName:displayName(ctx),approvedAt:nowIso(),templateVersion:version});
            await rec(ctx,'mnt.task.validated',taskId,`Asset ${assemblyId}, revision ${version}`);
            return {ok:true,version};
        })
    ],
    'POST /api/org/mnt/assessment/options': [
        orgRoute('org.mnt.assessment.options',null,async(ctx)=>{
            requireMnt(ctx);
            const vendors=await listDocs(`organizations/${ctx.orgId}/vendors`);
            const serviceVendors=vendors.filter(d=>str(d.data.status)==='approved'&&objs(d.data.scopes).some(x=>str(x.kind)==='service'));
            return {vendors:serviceVendors.map(d=>({id:d.id,name:str(d.data.tradeName)||str(d.data.legalName)||d.id})).sort((a,b)=>a.name.localeCompare(b.name))};
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
            return { nodes: nodes.filter((n) => keep.has(n.id)) };
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
                    await rec(ctx, 'mnt.wr.submitted', code, `${finding.title} · ${loc.assemblyCode} · ${loc.assetTag} · ${finding.criticalityLabel}`);
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
                    if (view === 'review') return !mine && ['submitted', 'under_review'].includes(s) && canAt(ctx, P.WR_review, pathOf(d), scope);
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
                returnNote: str(d.returnNote),
                declineReason: str(d.declineReason),
                history: objs(d.history).map((h) => ({ at: str(h.at), name: str(h.name), action: str(h.action), note: str(h.note) })),
                can,
            };
        }),
    ],

    'POST /api/org/mnt/wr/action': [
        orgRoute('org.mnt.wr.action', null, async (ctx) => {
            requireMnt(ctx);
            const action = str(ctx.body.action);
            const note = str(ctx.body.note).trim().slice(0, 500);
            const scope = await scopeOf(ctx);
            const doc = await getWr(ctx, str(ctx.body.code));
            const can = wrCan(ctx, doc, scope);
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
                    await done({ status: 'submitted', returnNote: '' }, 'Resubmitted', 'mnt.wr.resubmitted');
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
                            ...(changedCrit && !str(doc.data.criticalityOriginalLabel) ? { criticalityOriginalLabel: str(doc.data.criticalityLabel) } : {}),
                            duplicateOf,
                            assessmentNote: note,
                            assessedBy: ctx.uid,
                            assessedByName: displayName(ctx),
                            assessedAt: now,
                        },
                        'Assessed',
                        'mnt.wr.assessed',
                        `${mtype.label} · ${wtype.label} · ${prio.label} · ${disc.label}${changedCrit ? ` · criticality ${str(doc.data.criticalityLabel)} → ${crit.label}` : ''}${note ? ` · ${note}` : ''}`
                    );
                    return { ok: true };
                }
                case 'save_task_assessment': {
                    deny(can.assess, 'You cannot assess this request.');
                    let tasks;
                    try {tasks=validateAssessmentTasks(ctx.body.tasks);} catch(e){throw new HttpError(400,e instanceof Error?e.message:'Invalid assessment tasks.');}
                    // Every task owns its parts/services/tools/risk. Legacy header-level
                    // spares/services are deliberately not written by this action.
                    const allProposed=tasks.flatMap(t=>t.services.flatMap(x=>x.proposedVendorIds));
                    if(allProposed.length){
                        const vendors=await listDocs(`organizations/${ctx.orgId}/vendors`);
                        const approved=new Set(vendors.filter(v=>str(v.data.status)==='approved'&&objs(v.data.scopes).some(x=>str(x.kind)==='service')).map(v=>v.id));
                        if(allProposed.some(id=>!approved.has(id)))throw new HttpError(400,'Choose proposed service vendors from the approved service vendor list.');
                    }
                    const version=(Number(doc.data.assessmentTasksVersion)||0)+1;
                    const assemblyId=str(doc.data.assemblyId);
                    for(const task of tasks){
                        const dest=`organizations/${ctx.orgId}/asset_task_templates/${assemblyId}_${task.id}`;
                        const adopted=await getDoc(dest);
                        if(task.templateStatus==='existing'&&(!adopted||str(adopted.data.status)!=='approved'))
                            throw new HttpError(400,'Selected reusable task has not been validated for this assembly.');
                    }
                    // Snapshot each newly created task as a separate validation candidate.
                    // These entries are not active equipment/assembly templates yet.
                    for(const task of tasks.filter(t=>t.templateStatus!=='existing')){
                        const id=`${doc.id}_${task.id}_v${version}`;
                        await writeDoc(`organizations/${ctx.orgId}/asset_task_proposals/${id}`,{
                            wrCode:doc.id,assemblyId,assetTag:str(doc.data.assetTag),taskId:task.id,
                            description:task.description,task:task as unknown as Plain,assessmentVersion:version,
                            status:'pending_validation',createdBy:ctx.uid,createdAt:now
                        },{exists:false});
                    }
                    const summary=summarizeAssessmentTasks(tasks);
                    await done({assessmentTasks:tasks as unknown as Plain,assessmentTasksBy:ctx.uid,
                        assessmentTasksAt:now,assessmentTasksVersion:version},
                        'Task assessments saved','mnt.wr.task_assessments',JSON.stringify(summary));
                    return {ok:true,summary};
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
                    confirmCode(ctx, doc);
                    const keys = ['assemblyId', 'assemblyCode', 'assemblyName', 'unitId', 'unitCode', 'unitName', 'costCenterId', 'costCenterCode', 'costCenterName', 'siteId', 'siteCode', 'siteName', 'assetTag', 'assetName', 'assetClass', 'title', 'description', 'criticalityCode', 'criticalityLabel', 'criticalityColor', 'maintenanceTypeCode', 'maintenanceTypeLabel', 'workTypeCode', 'workTypeLabel', 'priorityCode', 'priorityLabel', 'disciplineCode', 'disciplineLabel', 'failureModeCode', 'failureModeLabel'];
                    const base: Record<string, Plain> = Object.fromEntries(keys.map((k) => [k, str(d[k])]));
                    base.path = strs(d.path);
                    base.assessmentTasks = objs(d.assessmentTasks) as unknown as Plain;
                    const woCode = await createWo(ctx, base, doc.id);
                    await done({ status: 'converted', woCode, convertedBy: ctx.uid, convertedByName: displayName(ctx), convertedAt: now, closedAt: now }, `Converted to ${woCode}`, 'mnt.wr.converted', woCode);
                    await rec(ctx, 'mnt.wo.created', woCode, `From ${doc.id}`);
                    return { ok: true, woCode };
                }
                default:
                    throw new HttpError(400, 'Unknown action.');
            }
        }),
    ],

    // ----- Work orders -----

    'POST /api/org/mnt/wo/create': [
        orgRoute('org.mnt.wo.create', null, async (ctx) => {
            requireMnt(ctx);
            const b = ctx.body;
            if (b.confirm !== true) throw new HttpError(400, 'Confirm the details first.');
            const place = await assemblyContext(ctx, str(b.assemblyId), P.WO_create);
            const loc = placeFields(place, str(b.assetTag));
            const l = await lists();
            const title = clean(b.title, 120);
            const description = str(b.description).trim().slice(0, 2000);
            if (title.length < 5) throw new HttpError(400, 'Give the work order a short title (5 to 120 characters).');
            if (description.length < 10) throw new HttpError(400, 'Describe the work (10 to 2000 characters).');
            const mtype = pick(l.maintenanceTypes, str(b.maintenanceTypeCode), 'maintenance type')!;
            const wtype = pick(l.workTypes, str(b.workTypeCode), 'work type')!;
            const prio = pick(l.priorities, str(b.priorityCode), 'priority')!;
            const disc = pick(l.disciplines, str(b.disciplineCode), 'discipline')!;
            const crit = pick(l.criticality, str(b.criticalityCode), 'criticality')!;
            const failure = pickGrouped(l.failureModes, str(b.failureModeCode), 'failure mode', false);
            const code = await createWo(
                ctx,
                {
                    ...loc,
                    title,
                    description,
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
                    failureModeCode: failure?.code ?? '',
                    failureModeLabel: failure ? `${failure.group} · ${failure.label}` : '',
                },
                ''
            );
            await rec(ctx, 'mnt.wo.created', code, `Direct · ${title} · ${loc.assemblyCode} · ${loc.assetTag}`);
            return { code };
        }),
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
        orgRoute('org.mnt.wo.action', null, async (ctx) => {
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
            switch (action) {
                case 'save_plan': {
                    deny(can.plan, 'You cannot plan this work order.');
                    const assessedTasks=objs(d.assessmentTasks);
                    // A converted request already has assessed task scope/resources/risk;
                    // planning cannot silently replace them through the legacy flat form.
                    const tasks = assessedTasks.length ? assessedTasks : readTasks(b.tasks, l);
                    const spares = assessedTasks.length ? [] : readSpares(b.spares);
                    const services = assessedTasks.length ? [] : readServices(b.services);
                    const exec = pick(l.executionLocations, str(b.executionLocationCode), 'execution location', false);
                    const fields: Record<string, Plain> = {
                        tasks: tasks as unknown as Plain,
                        spares: spares as unknown as Plain,
                        services: services as unknown as Plain,
                        tools: str(b.tools).trim().slice(0, 1000),
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
                    const est = estimate(fields as Obj);
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
                    if (!objs(d.tasks).length) throw new HttpError(400, 'Add at least one task to the plan.');
                    if (!isObj(d.safety)) throw new HttpError(400, 'The safety assessment must be done before the plan is ready.');
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
                    const act = actuals(d);
                    await done({ status: 'closed', closeNote: note, closedBy: ctx.uid, closedByName: displayName(ctx), closedAt: now, finalCost: act as unknown as Plain }, 'Closed', 'mnt.wo.closed', `Actual ${act.total} to cost center ${str(d.costCenterCode)}`);
                    return { ok: true };
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
        }),
    ],
};
