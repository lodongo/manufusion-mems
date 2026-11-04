/**
 * Job Grades (HR → Job Grades).
 *
 * A job grade is an employment band for a legal entity: a grade number, a minimum monthly basic salary,
 * the taxes that apply to pay at that grade and the deductions taken from it. Taxes and deductions are
 * chosen from the legal entity's Compensation & Benefits catalogue, so rates live in one place only.
 * Items that the law makes mandatory (for example Kenya PAYE, NSSF, SHIF and the Housing Levy) are added to
 * every grade by the server and cannot be removed.
 *
 * Grades are allocated to job roles per legal entity (Organization → Job roles), where each role also
 * carries the minimum level of education for the role.
 *
 * Governance (same engine as compensation policy activation):
 *  - saving only changes the DRAFT (HRM.grades.manage); nothing reads the draft for live decisions;
 *  - the draft is activated through a cost-bearing request in the Finance request engine: maker-checker,
 *    Chart of Authority levels for the stated annual cost impact, each level resolved to a ROL_ job role
 *    held by someone other than the maker, and the approver needs HRM.grades.approve for the legal entity;
 *  - the approved draft is fingerprinted; if it changed after submission approval is refused;
 *  - the activated policy is immutable history; every step is audited.
 *
 * Until a legal entity has an active policy, readers keep using the older grade list (see hrJobGradeStore).
 */
import { createHash } from 'node:crypto';
import { HttpError, fieldEq, getDoc, listDocs, nowIso, runQuery, str, writeDoc, type Fields } from './core';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { cannotDecide, createRequest, nameOf, objs, P, reasonOf, registerHandler, scopeOf, unitsOf, withLock, type Obj, type Step } from './finCore';
import { decideRequest } from './finRoutes';
import { hrAudit } from './hrAudit';
import { countryOf, entities as payEntities, readPayConfig, type PayConfig } from './hrCompensationConfig';
import { activationProblems } from '../src/shared/hrJobGradeRules';
import { activeJobGrades, gradeActivePath, gradeDraftPath, gradeHistoryPath, legacyJobGrades, readGrades, type JobGradeDef } from './hrJobGradeStore';

export const JOB_GRADE_REQUEST = 'hr.jobgrades.activate';
export const JOB_GRADE_MANAGE = 'HRM.grades.manage';
export const JOB_GRADE_APPROVE = 'HRM.grades.approve';
const ENTITY = /^[A-Za-z0-9_-]{1,128}$/;
const CODE = /^[A-Za-z0-9_-]{2,64}$/;
const MAX_COST = 1e13;
const MAX_SALARY = 1e9;
const MAX_GRADES = 100;
/** Compensation categories a grade draws its taxes and its deductions from. */
const TAX_CATEGORIES = ['taxes', 'taxReliefs'];
const DEDUCTION_CATEGORIES = ['statutory', 'otherDeductions'];
const scopeKey = (entity: string) => 'hr.jobgrades.' + entity;
const clean = (x: unknown, n: number) => str(x).replace(/\s+/g, ' ').trim().slice(0, n);

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

const isSuper = (ctx: OrgContext) => ctx.role === 'org_super_admin';
const canManage = (ctx: OrgContext) => isSuper(ctx) || hasPerm(ctx.permissions, JOB_GRADE_MANAGE);
const canApprove = (ctx: OrgContext) => isSuper(ctx) || hasPerm(ctx.permissions, JOB_GRADE_APPROVE);
/** Pay information (minimum salary, taxes, deductions) is only shown to people who maintain or approve it. */
const seesPay = (ctx: OrgContext) => canManage(ctx) || canApprove(ctx) || hasPerm(ctx.directPermissions, 'ADM.settings');

// ---------------------------------------------------------------------------
// Compensation catalogue (taxes and deductions a grade may select)
// ---------------------------------------------------------------------------

export type CatalogueItem = { code: string; name: string; category: string; mandatory: boolean; enabled: boolean; description: string };
export type GradeCatalogue = { taxes: CatalogueItem[]; deductions: CatalogueItem[]; forcedTaxes: string[]; forcedDeductions: string[] };

export function catalogueOf(config: PayConfig): GradeCatalogue {
    const items = Array.isArray(config.items) ? config.items : [];
    const pick = (categories: string[]) =>
        items
            .filter((i) => categories.includes(i.category))
            .map((i) => ({ code: i.code, name: i.name, category: i.category, mandatory: i.mandatory === true, enabled: i.enabled !== false, description: str(i.description).slice(0, 200) }));
    const taxes = pick(TAX_CATEGORIES);
    const deductions = pick(DEDUCTION_CATEGORIES);
    const forced = (list: CatalogueItem[]) => list.filter((i) => i.mandatory && i.enabled).map((i) => i.code);
    return { taxes, deductions, forcedTaxes: forced(taxes), forcedDeductions: forced(deductions) };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Stable fingerprint of the grade content (excludes version and audit metadata). */
export function gradesDigest(grades: JobGradeDef[], currency: string, countryCode: string): string {
    const content = {
        currency,
        countryCode,
        grades: grades
            .slice()
            .sort((a, b) => a.rank - b.rank)
            .map((g) => ({ code: g.code, rank: g.rank, title: g.title, description: g.description, enabled: g.enabled, minSalary: g.minSalary, taxCodes: g.taxCodes.slice().sort(), deductionCodes: g.deductionCodes.slice().sort() })),
    };
    return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/**
 * Validate and normalise a submitted grade list. New rows (empty code) get the next JG number.
 * Mandatory taxes and deductions are always included. Grades that were ever saved or activated can be
 * disabled but never removed, because roles and employee records refer to their codes.
 */
export function normalizeGrades(raw: unknown, catalogue: GradeCatalogue, known: Set<string>): JobGradeDef[] {
    if (!Array.isArray(raw) || !raw.length || raw.length > MAX_GRADES) throw new HttpError(400, `Configure between 1 and ${MAX_GRADES} job grades.`);
    const rows = raw.map((x) => {
        if (!x || typeof x !== 'object' || Array.isArray(x)) throw new HttpError(400, 'Invalid job grade entry.');
        return x as Record<string, unknown>;
    });
    const numbers = [...known, ...rows.map((r) => clean(r.code, 64))].map((c) => /^JG(\d{1,6})$/.exec(c)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1]));
    let next = (numbers.length ? Math.max(...numbers) : 0) + 1;
    const taxSet = new Set(catalogue.taxes.map((i) => i.code));
    const dedSet = new Set(catalogue.deductions.map((i) => i.code));
    const codes = new Set<string>();
    const ranks = new Set<number>();
    const titles = new Set<string>();
    const out: JobGradeDef[] = rows.map((r) => {
        const code = clean(r.code, 64) || 'JG' + String(next++).padStart(2, '0');
        if (!CODE.test(code)) throw new HttpError(400, 'A job grade code can use letters, numbers, dash and underscore (2 to 64 characters).');
        if (codes.has(code)) throw new HttpError(400, `Job grade code ${code} is used twice.`);
        codes.add(code);
        const rank = Number(r.rank);
        if (!Number.isInteger(rank) || rank < 1 || rank > 9999) throw new HttpError(400, `Grade ${code}: the grade number must be a whole number from 1 to 9999.`);
        if (ranks.has(rank)) throw new HttpError(400, `Grade number ${rank} is used twice. Grade numbers must be unique within a legal entity.`);
        ranks.add(rank);
        const title = clean(r.title, 150);
        if (title.length < 2) throw new HttpError(400, `Grade ${code}: enter a title (2 to 150 characters).`);
        if (titles.has(title.toLowerCase())) throw new HttpError(400, `The grade title "${title}" is used twice.`);
        titles.add(title.toLowerCase());
        const salary = r.minSalary === undefined || r.minSalary === null || r.minSalary === '' ? 0 : Number(r.minSalary);
        if (!Number.isFinite(salary) || salary < 0 || salary > MAX_SALARY) throw new HttpError(400, `Grade ${code}: the minimum salary must be between 0 and ${MAX_SALARY.toLocaleString('en')}.`);
        if (Math.abs(salary * 100 - Math.round(salary * 100)) > 1e-6) throw new HttpError(400, `Grade ${code}: the minimum salary can have at most 2 decimal places.`);
        const choose = (value: unknown, allowed: Set<string>, forced: string[], what: string) => {
            const list = Array.isArray(value) ? value.map((v) => clean(v, 72)).filter(Boolean) : [];
            if (list.some((c) => !allowed.has(c))) throw new HttpError(400, `Grade ${code}: choose only ${what} from the Compensation & Benefits catalogue of this legal entity.`);
            return [...new Set([...forced, ...list])];
        };
        return {
            code,
            rank,
            title,
            description: clean(r.description, 350),
            enabled: r.enabled !== false,
            minSalary: Math.round(salary * 100) / 100,
            taxCodes: choose(r.taxCodes, taxSet, catalogue.forcedTaxes, 'taxes'),
            deductionCodes: choose(r.deductionCodes, dedSet, catalogue.forcedDeductions, 'deductions'),
        };
    });
    for (const code of known) if (!codes.has(code)) throw new HttpError(409, `Grade ${code} was saved before and cannot be removed because roles and employee records refer to it. Disable it instead.`);
    return out.sort((a, b) => a.rank - b.rank);
}

/** What must be true before a draft may go for approval (shared with the screen so both always agree). */
export { activationProblems };

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Legal entity with the country and currency its pay settings use. */
async function entityContext(ctx: OrgContext, requested: string) {
    const all = await payEntities(ctx.orgId);
    const current = all.find((e) => e.id === requested) || (!requested ? all[0] : undefined);
    const orgCountry = str(ctx.org.data.countryCode || ctx.org.data.country).trim().slice(0, 2).toUpperCase();
    const country = current ? countryOf(current, orgCountry) : '';
    const currency = current?.currency || str(ctx.org.data.currencyCode || ctx.org.data.currency).trim().slice(0, 3) || (country === 'KE' ? 'KES' : '');
    return { all, current, country, currency };
}

/** Roles per grade in a legal entity (jobGradeByLegalEntity on the job role). */
async function rolesByGrade(org: string, entity: string) {
    const docs = await listDocs(`organizations/${org}/positions`);
    const map = new Map<string, Array<{ code: string; title: string }>>();
    for (const d of docs) {
        const m = d.data.jobGradeByLegalEntity;
        const code = m && typeof m === 'object' && !Array.isArray(m) ? str((m as Record<string, unknown>)[entity]) : '';
        if (!code) continue;
        map.set(code, [...(map.get(code) || []), { code: d.id, title: str(d.data.title) }]);
    }
    return map;
}

/** The stored draft, or the older grade list (with no pay information yet) when nothing was saved. */
async function draftOrSeed(org: string, entity: string, catalogue: GradeCatalogue) {
    const doc = await getDoc(gradeDraftPath(org, entity));
    if (doc) return { saved: true, version: Number(doc.data.version || 0), grades: readGrades(doc.data.grades), updatedAt: str(doc.data.updatedAt), updatedBy: str(doc.data.updatedBy) };
    const legacy = await legacyJobGrades(org, entity);
    const grades: JobGradeDef[] = legacy.map((g) => ({ ...g, minSalary: 0, taxCodes: [...catalogue.forcedTaxes], deductionCodes: [...catalogue.forcedDeductions] }));
    return { saved: false, version: 0, grades, updatedAt: '', updatedBy: '' };
}

/** Codes that may never be removed: anything ever active, drafted or part of the older list. */
async function knownCodes(org: string, entity: string, draft: { grades: JobGradeDef[] } | null) {
    const [legacy, active] = await Promise.all([legacyJobGrades(org, entity), activeJobGrades(org, entity)]);
    return new Set<string>([...legacy.map((g) => g.code), ...(active || []).map((g) => g.code), ...(draft?.grades || []).map((g) => g.code)].filter(Boolean));
}

async function gradeStatus(org: string, entity: string) {
    const [active, open] = await Promise.all([
        getDoc(gradeActivePath(org, entity)),
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

/** Per-grade change list shown to the approver (compared with what is active, or the older list). */
async function changesOf(org: string, entity: string, draft: JobGradeDef[]) {
    const active = await activeJobGrades(org, entity);
    const base = new Map<string, JobGradeDef | null>();
    if (active) for (const g of active) base.set(g.code, g);
    else for (const g of await legacyJobGrades(org, entity)) base.set(g.code, { ...g, minSalary: 0, taxCodes: [], deductionCodes: [] });
    const out: Array<{ code: string; title: string; rank: number; kind: string; from: number | null; to: number; enabled: boolean }> = [];
    for (const g of draft) {
        const was = base.get(g.code);
        if (!was) out.push({ code: g.code, title: g.title, rank: g.rank, kind: 'new', from: null, to: g.minSalary, enabled: g.enabled });
        else {
            const same = was.title === g.title && was.rank === g.rank && was.enabled === g.enabled && was.minSalary === g.minSalary && was.taxCodes.slice().sort().join() === g.taxCodes.slice().sort().join() && was.deductionCodes.slice().sort().join() === g.deductionCodes.slice().sort().join();
            if (!same) out.push({ code: g.code, title: g.title, rank: g.rank, kind: was.enabled && !g.enabled ? 'disabled' : 'changed', from: was.minSalary, to: g.minSalary, enabled: g.enabled });
        }
    }
    return out.slice(0, 100);
}

// ---------------------------------------------------------------------------
// Activation handler (final approval applies the draft)
// ---------------------------------------------------------------------------

registerHandler(JOB_GRADE_REQUEST, {
    label: 'HR job grades activation',
    approvePerm: JOB_GRADE_APPROVE,
    valued: true,
    apply: async (ctx, req, id) => {
        const entity = str(req.leId);
        const payload = req.payload && typeof req.payload === 'object' && !Array.isArray(req.payload) ? (req.payload as Obj) : {};
        if (!ENTITY.test(entity)) throw new HttpError(409, 'Request legal entity is invalid.');
        return withLock(ctx.orgId, 'hr_job_grades_' + entity, async () => {
            const draft = await getDoc(gradeDraftPath(ctx.orgId, entity));
            if (!draft) throw new HttpError(409, 'The job grade draft no longer exists. Reject this request.');
            const grades = readGrades(draft.data.grades);
            const currency = str(draft.data.currency);
            const country = str(draft.data.countryCode);
            const digest = gradesDigest(grades, currency, country);
            if (Number(draft.data.version || 0) !== Number(payload.draftVersion) || digest !== str(payload.digest))
                throw new HttpError(409, 'The job grade draft changed after this request was submitted. Reject it and submit the current draft.');
            // Roles and the compensation catalogue may have changed while the request waited.
            const used = new Map([...(await rolesByGrade(ctx.orgId, entity))].map(([k, v]) => [k, v.length]));
            const problems = activationProblems(grades, currency, used);
            if (problems.length) throw new HttpError(409, 'The draft no longer meets the activation rules: ' + problems.slice(0, 3).join(' '));
            const prior = await getDoc(gradeActivePath(ctx.orgId, entity));
            const activeVersion = Number(prior?.data.activeVersion || 0) + 1;
            const at = nowIso();
            const active = {
                grades,
                currency,
                countryCode: country,
                status: 'active',
                activeVersion,
                version: activeVersion,
                sourceDraftVersion: Number(payload.draftVersion),
                digest,
                approvalRef: id,
                annualCostImpact: Number(req.amount ?? 0),
                activatedAt: at,
                activatedBy: ctx.uid,
                submittedBy: str(req.makerUid),
            };
            if (!(await writeDoc(gradeHistoryPath(ctx.orgId, entity, activeVersion), active as unknown as Fields, { exists: false })))
                throw new HttpError(409, 'This job grade version was activated concurrently. Refresh and check the active version.');
            if (!(await writeDoc(gradeActivePath(ctx.orgId, entity), active as unknown as Fields, prior ? { updateTime: prior.updateTime } : { exists: false })))
                throw new HttpError(409, 'The active job grades changed concurrently. Refresh and retry.');
            await hrAudit(ctx, 'jobgrades.activated', { type: 'legal_entity', id: entity }, `version=${activeVersion} draft=${Number(payload.draftVersion)} grades=${grades.length} request=${id}`);
            return { legalEntityId: entity, activeVersion, draftVersion: Number(payload.draftVersion) };
        });
    },
});

// ---------------------------------------------------------------------------
// Requests (list, decide, withdraw)
// ---------------------------------------------------------------------------

function requestRow(ctx: OrgContext, d: { id: string; data: Obj }, units: Awaited<ReturnType<typeof unitsOf>>, scope: Awaited<ReturnType<typeof scopeOf>>) {
    const steps = objs(d.data.steps) as unknown as Step[];
    const payload = d.data.payload && typeof d.data.payload === 'object' && !Array.isArray(d.data.payload) ? (d.data.payload as Obj) : {};
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
        gradeCount: Number(payload.gradeCount || 0),
        enabledCount: Number(payload.enabledCount || 0),
        lowestSalary: Number(payload.lowestSalary || 0),
        highestSalary: Number(payload.highestSalary || 0),
        changes: objs(payload.changes).slice(0, 100).map((c) => ({ code: str(c.code), title: str(c.title), rank: Number(c.rank || 0), kind: str(c.kind), from: typeof c.from === 'number' ? c.from : null, to: Number(c.to || 0), enabled: c.enabled !== false })),
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
    if (!d || str(d.data.type) !== JOB_GRADE_REQUEST) throw new HttpError(404, 'Request not found.');
    return d;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const hrJobGradeRoutes = {
    'POST /api/org/hr/job-grades/get': [
        orgRoute('org.hr.jobgrades.get', 'HRM.shell.view', async (ctx) => {
            const { all, current, country, currency } = await entityContext(ctx, clean(ctx.body.legalEntityId, 128));
            const entities = all.map((e) => ({ id: e.id, name: e.name }));
            if (!current) return { entities, entity: null, financial: seesPay(ctx), canManage: canManage(ctx), canApprove: canApprove(ctx) };
            const financial = seesPay(ctx);
            const pay = await readPayConfig(ctx.orgId, current.id, country, currency);
            const catalogue = catalogueOf(pay);
            const [draft, status, roles] = await Promise.all([draftOrSeed(ctx.orgId, current.id, catalogue), gradeStatus(ctx.orgId, current.id), rolesByGrade(ctx.orgId, current.id)]);
            const digest = gradesDigest(draft.grades, currency, country);
            const grades = draft.grades.map((g) => (financial ? g : { ...g, minSalary: null, taxCodes: [] as string[], deductionCodes: [] as string[] }));
            return {
                entities,
                entity: { id: current.id, name: current.name, countryCode: country, currency },
                financial,
                canManage: canManage(ctx),
                canApprove: canApprove(ctx),
                draft: { saved: draft.saved, version: draft.version, updatedAt: draft.updatedAt, grades, digest },
                active: status.active,
                changedSinceActive: status.active ? status.active.digest !== digest : true,
                pendingRequestId: status.pendingRequestId,
                catalogue: financial ? catalogue : null,
                // Rates are reference data for the indicative take-home preview (Kenya reference calculation).
                payConfig: financial && country === 'KE' ? pay : null,
                roles: Object.fromEntries([...roles].map(([k, v]) => [k, v.slice(0, 50)])),
            };
        }),
    ],

    'POST /api/org/hr/job-grades/save': [
        orgRoute('org.hr.jobgrades.save', 'HRM.grades.manage', async (ctx) => {
            const entityId = clean(ctx.body.legalEntityId, 128);
            if (!ENTITY.test(entityId)) throw new HttpError(400, 'Select a legal entity.');
            const { current, country, currency } = await entityContext(ctx, entityId);
            if (!current) throw new HttpError(404, 'Select an active legal entity.');
            if (!country || !currency) throw new HttpError(409, 'Configure the legal entity country and currency before job grades.');
            const catalogue = catalogueOf(await readPayConfig(ctx.orgId, entityId, country, currency));
            return withLock(ctx.orgId, 'hr_job_grades_' + entityId, async () => {
                const prev = await getDoc(gradeDraftPath(ctx.orgId, entityId));
                const prevVersion = Number(prev?.data.version || 0);
                if (ctx.body.expectedVersion !== undefined && Number(ctx.body.expectedVersion) !== prevVersion)
                    throw new HttpError(409, 'Job grades changed since you opened them. Reload before saving.');
                const known = await knownCodes(ctx.orgId, entityId, prev ? { grades: readGrades(prev.data.grades) } : null);
                const grades = normalizeGrades(ctx.body.grades, catalogue, known);
                const version = prevVersion + 1;
                if (!(await writeDoc(gradeDraftPath(ctx.orgId, entityId), { grades, currency, countryCode: country, version, status: 'draft', updatedAt: nowIso(), updatedBy: ctx.uid } as unknown as Fields, prev ? { updateTime: prev.updateTime } : { exists: false })))
                    throw new HttpError(409, 'Job grades changed while saving. Reload and try again.');
                await hrAudit(ctx, 'jobgrades.save', { type: 'legal_entity', id: entityId }, `version=${version} grades=${grades.length}`);
                return { ok: true, version, grades, digest: gradesDigest(grades, currency, country) };
            });
        }),
    ],

    'POST /api/org/hr/job-grades/submit': [
        orgRoute('org.hr.jobgrades.submit', 'HRM.grades.manage', async (ctx) => {
            const entity = clean(ctx.body.legalEntityId, 128);
            if (!ENTITY.test(entity)) throw new HttpError(400, 'Select a legal entity.');
            const reason = reasonOf(ctx.body);
            const cost = Number(ctx.body.annualCostImpact);
            if (!Number.isFinite(cost) || cost < 0 || cost > MAX_COST) throw new HttpError(400, 'Enter the estimated annual cost impact (0 or more) in the legal entity currency.');
            if (ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that the grades, minimum salaries, taxes and deductions have been reviewed and the cost estimate is reasonable.');
            const { current, country, currency } = await entityContext(ctx, entity);
            if (!current) throw new HttpError(404, 'Select an active legal entity.');
            const draft = await getDoc(gradeDraftPath(ctx.orgId, entity));
            if (!draft) throw new HttpError(409, 'Save the job grade draft before submitting it for approval.');
            if (Number(ctx.body.expectedVersion) !== Number(draft.data.version || 0)) throw new HttpError(409, 'The draft changed since you opened it. Reload before submitting.');
            const grades = readGrades(draft.data.grades);
            const used = new Map([...(await rolesByGrade(ctx.orgId, entity))].map(([k, v]) => [k, v.length]));
            const problems = activationProblems(grades, currency, used);
            if (problems.length) throw new HttpError(409, `Fix ${problems.length} thing${problems.length === 1 ? '' : 's'} before submitting: ` + problems.slice(0, 4).join(' '));
            const digest = gradesDigest(grades, currency, country);
            const status = await gradeStatus(ctx.orgId, entity);
            if (status.active && status.active.digest === digest) throw new HttpError(409, 'This draft is already the active policy.');
            const enabled = grades.filter((g) => g.enabled);
            const salaries = enabled.map((g) => g.minSalary);
            const changes = await changesOf(ctx.orgId, entity, grades);
            const version = Number(draft.data.version || 0);
            const out = await createRequest(ctx, {
                leId: entity,
                type: JOB_GRADE_REQUEST,
                scopeKey: scopeKey(entity),
                title: `Activate job grades draft v${version}`,
                summary: `${enabled.length} enabled job grades, minimum monthly salary ${currency} ${Math.min(...salaries).toLocaleString('en')} to ${Math.max(...salaries).toLocaleString('en')}; ${changes.length} changed. Estimated annual cost impact ${currency} ${cost.toLocaleString('en')}.`,
                payload: { draftVersion: version, digest, currency, countryCode: country, gradeCount: grades.length, enabledCount: enabled.length, lowestSalary: Math.min(...salaries), highestSalary: Math.max(...salaries), annualCostImpact: cost, changes } as unknown as Obj,
                amount: cost,
                reason,
            });
            await hrAudit(ctx, 'jobgrades.submit', { type: 'legal_entity', id: entity }, `draft=${version} request=${out.id} cost=${cost}`);
            return { ok: true, id: out.id };
        }),
    ],

    'POST /api/org/hr/job-grades/requests': [
        orgRoute('org.hr.jobgrades.requests', 'HRM.shell.view', async (ctx) => {
            const manage = canManage(ctx);
            const approve = canApprove(ctx);
            const [docs, units, scope] = await Promise.all([
                runQuery({ from: [{ collectionId: 'fin_requests' }], where: fieldEq('type', JOB_GRADE_REQUEST) }, `organizations/${ctx.orgId}`),
                unitsOf(ctx.orgId),
                scopeOf(ctx),
            ]);
            // Requests carry pay information, so only maintainers, approvers and the submitter see them.
            const rows = docs
                .filter((d) => manage || approve || str(d.data.makerUid) === ctx.uid)
                .map((d) => requestRow(ctx, d, units, scope))
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, 500);
            return { requests: rows, canSubmit: manage, canApprove: approve };
        }),
    ],

    'POST /api/org/hr/job-grades/decide': [
        orgRoute('org.hr.jobgrades.decide', 'HRM.shell.view', async (ctx) => {
            const id = str(ctx.body.id);
            const decision = str(ctx.body.decision);
            if (decision !== 'approve' && decision !== 'reject') throw new HttpError(400, 'Approve or reject.');
            const note = decision === 'reject' ? reasonOf(ctx.body) : str(ctx.body.reason).replace(/\s+/g, ' ').trim().slice(0, 300);
            if (decision === 'approve' && ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that you have reviewed the job grades, minimum salaries and their cost before approving.');
            await loadRequest(ctx, id);
            const result = await decideRequest(ctx, id, decision, note, (d) => {
                if (str(d.data.type) !== JOB_GRADE_REQUEST) throw new HttpError(404, 'Request not found.');
            });
            await hrAudit(ctx, 'jobgrades.' + decision, { type: 'request', id }, 'status=' + str((result as Obj).status));
            return result;
        }),
    ],

    'POST /api/org/hr/job-grades/withdraw': [
        orgRoute('org.hr.jobgrades.withdraw', 'HRM.shell.view', async (ctx) => {
            const id = str(ctx.body.id);
            const reason = reasonOf(ctx.body);
            return withLock(ctx.orgId, `req_${id}`, async () => {
                const d = await loadRequest(ctx, id);
                if (str(d.data.makerUid) !== ctx.uid) throw new HttpError(404, 'Request not found.');
                if (str(d.data.status) !== 'pending') throw new HttpError(409, 'Only a pending request can be withdrawn.');
                const at = nowIso();
                const ok = await writeDoc(P(ctx.orgId).request(id), { ...d.data, status: 'withdrawn', decidedAt: at, history: [...objs(d.data.history), { at, by: ctx.uid, byName: nameOf(ctx.me), action: 'withdrawn', note: reason }] } as unknown as Fields, { updateTime: d.updateTime });
                if (!ok) throw new HttpError(409, 'The request changed at the same time. Refresh and retry.');
                await hrAudit(ctx, 'jobgrades.withdraw', { type: 'request', id }, '');
                return { ok: true };
            });
        }),
    ],
};
