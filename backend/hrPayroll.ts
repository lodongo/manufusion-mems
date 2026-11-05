/**
 * Payroll workspace (HR → Payroll).
 *
 * Lists every employee of a legal entity with the job role they hold, the grade that role has in the legal entity and the
 * grade's pay package, so a payslip can be previewed for each of them. Each employee has a slot for the DRAFT basic monthly
 * salary; a salary below the grade minimum is flagged on the screen.
 *
 * What this is, and is not:
 *  - A preview and a data-entry step. No payroll run exists yet: nothing is paid, posted or filed from here.
 *  - The payslip is computed on the screen by the shared engine (src/shared/hrPayslip.ts) from the APPROVED job grades and
 *    Benefits policy when they exist; before approval it falls back to the drafts and says so.
 *  - Draft salaries live in their own document (hr_payroll_inputs/{legalEntity}); they are never added to the employee
 *    record, so no other HR screen can show them.
 *
 * Security:
 *  - Viewing needs HRM.payroll.view; entering salaries needs HRM.payroll.manage. Both are sensitive and kept apart from
 *    HRM.employees.manage (the person who adds employees must not set what they are paid).
 *  - Nobody can set their own salary. Only employees of the chosen legal entity can receive a salary.
 *  - Saving is versioned and locked per legal entity; every save keeps an immutable history record and is audited, and so
 *    is every read of the list. Audit text carries counts, never amounts.
 */
import { HttpError, fieldEq, getDoc, isObj, listDocs, nowIso, runQuery, str, writeDoc } from './core';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { withLock } from './finCore';
import { hrAudit } from './hrAudit';
import { readPayConfig, type PayConfig } from './hrCompensationConfig';
import { gradeActivePath, readGrades, type JobGradeDef } from './hrJobGradeStore';
import { catalogueOf, draftOrSeed, entityContext } from './hrJobGrades';
import { PROBLEM_TEXT, belowMinimum, buildPayrollRows } from './hrPayrollRows';

export const PAYROLL_VIEW = 'HRM.payroll.view';
export const PAYROLL_MANAGE = 'HRM.payroll.manage';
const ENTITY = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_SALARY = 1e9;
const MAX_CHANGES = 500;
const MAX_ENTRIES = 5000;

const isSuper = (ctx: OrgContext) => ctx.role === 'org_super_admin';
const canManage = (ctx: OrgContext) => isSuper(ctx) || hasPerm(ctx.permissions, PAYROLL_MANAGE);

export const inputPath = (org: string, entity: string) => `organizations/${org}/hr_payroll_inputs/${entity}`;
export const inputHistoryPath = (org: string, entity: string, version: number) => `${inputPath(org, entity)}/history/v${String(version).padStart(6, '0')}`;
const policyActivePath = (org: string, entity: string) => `organizations/${org}/hr_compensation_active/${entity}`;

/** The pay policy a payslip is computed from: the approved one, else the draft (or shipped defaults), and which it was. */
async function policyFor(org: string, entity: string, country: string, currency: string) {
    const active = await getDoc(policyActivePath(org, entity));
    if (active) return { config: active.data as unknown as PayConfig, source: 'approved' as const };
    return { config: await readPayConfig(org, entity, country, currency), source: 'draft' as const };
}

/** The job grades payroll uses: approved when there are any, else the draft list. */
async function gradesFor(org: string, entity: string, config: PayConfig) {
    const active = await getDoc(gradeActivePath(org, entity));
    const approved = active ? readGrades(active.data.grades) : [];
    if (approved.length) return { grades: approved, source: 'approved' as const, version: Number(active!.data.version || 0) };
    const draft = await draftOrSeed(org, entity, catalogueOf(config));
    return { grades: draft.grades as JobGradeDef[], source: 'draft' as const, version: draft.version };
}

async function loadPeople(org: string, entity: string, salaries: Record<string, unknown>, grades: JobGradeDef[]) {
    const [users, structure, positions] = await Promise.all([
        runQuery({ from: [{ collectionId: 'users' }], where: fieldEq('orgId', org) }),
        listDocs(`organizations/${org}/structure`),
        listDocs(`organizations/${org}/positions`),
    ]);
    return buildPayrollRows({
        entityId: entity,
        users,
        nodes: new Map(structure.map((d) => [d.id, d.data])),
        positions: new Map(positions.map((d) => [d.id, d.data])),
        grades: grades.map((g) => ({ code: g.code, title: g.title, enabled: g.enabled, minSalary: g.minSalary })),
        salaries,
    });
}

const savedSalaries = (doc: { data: Record<string, unknown> } | null) => (doc && isObj(doc.data.salaries) ? (doc.data.salaries as Record<string, unknown>) : {});

export const hrPayrollRoutes = {
    'POST /api/org/hr/payroll/get': [
        orgRoute('org.hr.payroll.get', 'HRM.payroll.view', async (ctx) => {
            const requested = str(ctx.body.legalEntityId).trim().slice(0, 128);
            const { all, current, country, currency } = await entityContext(ctx, requested);
            const entities = all.map((e) => ({ id: e.id, name: e.name }));
            if (!current) return { entities, entity: null, canManage: canManage(ctx) };
            const [policy, input] = await Promise.all([policyFor(ctx.orgId, current.id, country, currency), getDoc(inputPath(ctx.orgId, current.id))]);
            const gradeSet = await gradesFor(ctx.orgId, current.id, policy.config);
            const { rows, unplaced } = await loadPeople(ctx.orgId, current.id, savedSalaries(input), gradeSet.grades);
            await hrAudit(ctx, 'read.payroll', { type: 'legal_entity', id: current.id }, `employees=${rows.length} unplaced=${unplaced.length}`);
            return {
                entities,
                entity: { id: current.id, name: current.name, countryCode: country, currency },
                canManage: canManage(ctx),
                selfUid: ctx.uid,
                version: Number(input?.data.version || 0),
                updatedAt: str(input?.data.updatedAt),
                source: {
                    grades: gradeSet.source,
                    gradesVersion: gradeSet.version,
                    policy: policy.source,
                    policyVersion: Number(policy.config.version || 0),
                },
                items: Array.isArray(policy.config.items) ? policy.config.items : [],
                grades: gradeSet.grades.map((g) => ({
                    code: g.code,
                    rank: g.rank,
                    title: g.title,
                    enabled: g.enabled,
                    minSalary: g.minSalary,
                    taxCodes: g.taxCodes,
                    deductionCodes: g.deductionCodes,
                    payModelCode: g.payModelCode,
                    benefitCodes: g.benefitCodes,
                    benefitValues: g.benefitValues,
                })),
                employees: rows.map((r) => ({ ...r, problemText: r.problem ? PROBLEM_TEXT[r.problem] : '' })),
                unplaced: unplaced.slice(0, 100),
                unplacedCount: unplaced.length,
            };
        }),
    ],

    'POST /api/org/hr/payroll/save': [
        orgRoute('org.hr.payroll.save', 'HRM.payroll.manage', async (ctx) => {
            const entityId = str(ctx.body.legalEntityId).trim().slice(0, 128);
            if (!ENTITY.test(entityId)) throw new HttpError(400, 'Select a legal entity.');
            const { current, country, currency } = await entityContext(ctx, entityId);
            if (!current) throw new HttpError(404, 'Select an active legal entity.');
            if (!isObj(ctx.body.salaries)) throw new HttpError(400, 'Send the salaries to save.');
            const sent = Object.entries(ctx.body.salaries as Record<string, unknown>);
            if (!sent.length) throw new HttpError(400, 'Change at least one salary before saving.');
            if (sent.length > MAX_CHANGES) throw new HttpError(400, `Save at most ${MAX_CHANGES} salary changes at a time.`);

            return withLock(ctx.orgId, 'hr_payroll_' + entityId, async () => {
                const prev = await getDoc(inputPath(ctx.orgId, entityId));
                const prevVersion = Number(prev?.data.version || 0);
                if (ctx.body.expectedVersion !== undefined && Number(ctx.body.expectedVersion) !== prevVersion)
                    throw new HttpError(409, 'Salaries changed since you opened payroll. Reload before saving.');
                const policy = await policyFor(ctx.orgId, entityId, country, currency);
                const gradeSet = await gradesFor(ctx.orgId, entityId, policy.config);
                const existing = savedSalaries(prev);
                const { rows } = await loadPeople(ctx.orgId, entityId, existing, gradeSet.grades);
                const people = new Map(rows.map((r) => [r.uid, r]));

                const changes: Record<string, number | null> = {};
                const next: Record<string, number> = {};
                for (const [uid, v] of Object.entries(existing)) if (typeof v === 'number' && Number.isFinite(v)) next[uid] = v;
                for (const [uid, v] of sent) {
                    if (!ENTITY.test(uid) || !people.has(uid)) throw new HttpError(400, 'A salary was sent for someone who is not on this legal entity’s payroll.');
                    if (uid === ctx.uid) throw new HttpError(403, 'You cannot set your own salary. Ask another payroll officer.');
                    if (v === null) {
                        delete next[uid];
                        changes[uid] = null;
                        continue;
                    }
                    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_SALARY || Math.abs(v * 100 - Math.round(v * 100)) > 1e-6)
                        throw new HttpError(400, 'Enter each basic salary as an amount above 0 and up to 1,000,000,000 with at most 2 decimals, or clear it.');
                    next[uid] = v;
                    changes[uid] = v;
                }
                if (Object.keys(next).length > MAX_ENTRIES) throw new HttpError(400, 'Too many salaries for one legal entity.');

                const version = prevVersion + 1;
                const at = nowIso();
                // History first (overwritten only if an earlier attempt at this version never committed), then the live document.
                await writeDoc(inputHistoryPath(ctx.orgId, entityId, version), { version, changes, changedBy: ctx.uid, changedAt: at, previousVersion: prevVersion, currency });
                const written = await writeDoc(inputPath(ctx.orgId, entityId), { version, salaries: next, currency, updatedAt: at, updatedBy: ctx.uid }, prev ? { updateTime: prev.updateTime } : { exists: false });
                if (!written) throw new HttpError(409, 'Salaries changed while saving. Reload and try again.');

                const changed = Object.values(changes).filter((x) => x !== null).length;
                const cleared = Object.values(changes).filter((x) => x === null).length;
                const below = Object.entries(changes).filter(([uid, x]) => x !== null && belowMinimum(x, people.get(uid)?.minSalary || 0)).length;
                await hrAudit(ctx, 'payroll.salary.save', { type: 'legal_entity', id: entityId }, `version=${version} changed=${changed} cleared=${cleared} belowMinimum=${below}`);
                return { ok: true, version, updatedAt: at, belowMinimum: below };
            });
        }),
    ],
};
