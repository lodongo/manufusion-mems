import { HttpError, getDoc, isObj, listDocs, nowIso, str, writeDoc } from './core';
import { orgRoute } from './guards';
import { PERMS, audited, requireAt } from './scopeGuard';

// ---------------------------------------------------------------------------
// Activity risk register for an equipment unit, and assessment rows per assembly activity.
//   organizations/{org}/activity_risk_assessments/{assemblyId}_{activityId}
// The live assessment screen saves `hazards` through activityRiskLegacy.ts; this route only
// writes `rows` and keeps everything else in the document.
// Reading needs SAF.risk.view (or assess / SAF.view) at the unit; saving needs SAF.risk.assess
// (or SAF.edit) at the assembly. Every save is audited.
// ---------------------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const base = (org: string, id: string) => `organizations/${org}/activity_risk_assessments/${id}`;
const matrixPath = (org: string) => `organizations/${org}/saf/risk_matrix`;

async function master(key: string) {
    const doc = await getDoc(`module_workspaces/SAF/metadata/${key}`);
    return (Array.isArray(doc?.data.items) ? doc.data.items : []).filter(isObj);
}

export const activityRiskRoutes = {
    'POST /api/org/activity-risk/register': [
        orgRoute('org.activity_risk.register', null, async (ctx) => {
            const id = str(ctx.body.workCenterId);
            if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid equipment unit');
            const unit = await getDoc(`organizations/${ctx.orgId}/structure/${id}`);
            if (!unit || str(unit.data.level) !== 'work_center') throw new HttpError(404, 'Equipment unit not found');
            await requireAt(ctx, PERMS.riskView, id, 'read', 'You do not have permission to view risk assessments for this equipment unit.');

            const nodes = await listDocs(`organizations/${ctx.orgId}/structure`);
            const isBelowUnit = (node: (typeof nodes)[number]) => {
                let parent = str(node.data.parentId);
                const visited = new Set<string>();
                while (parent && !visited.has(parent)) {
                    if (parent === id) return true;
                    visited.add(parent);
                    parent = str(nodes.find((x) => x.id === parent)?.data.parentId);
                }
                return false;
            };
            const assemblies = nodes.filter((n) => str(n.data.level) === 'assembly' && isBelowUnit(n));
            const items = await Promise.all(
                assemblies.map(async (assembly) => {
                    const saved = await getDoc(`organizations/${ctx.orgId}/assembly_activities/${assembly.id}`);
                    const activities = Array.isArray(saved?.data.items) ? saved.data.items.filter(isObj) : [];
                    return Promise.all(
                        activities.map(async (activity) => {
                            const activityId = str(activity.id);
                            const risk = await getDoc(base(ctx.orgId, `${assembly.id}_${activityId}`));
                            return {
                                assemblyId: assembly.id,
                                assemblyCode: str(assembly.data.code),
                                assemblyName: str(assembly.data.name),
                                activityId,
                                activityName: str(activity.name),
                                activityType: str(activity.type),
                                maintenanceType: str(activity.maintenanceType),
                                screening: activity.safetyScreening || null,
                                assessment: Array.isArray(risk?.data?.rows) ? risk.data.rows : [],
                                updatedAt: risk?.data?.updatedAt || '',
                            };
                        })
                    );
                })
            );
            const [matrix, hazards, impacts, controls] = await Promise.all([getDoc(matrixPath(ctx.orgId)), master('hazards'), master('impacts'), master('controlMeasures')]);
            return {
                items: items.flat(),
                catalogue: { hazards, impacts, controls },
                matrix: matrix?.data?.configuration || null,
            };
        }),
    ],

    'POST /api/org/activity-risk/save': [
        orgRoute('org.activity_risk.save', null, async (ctx) => {
            const assemblyId = str(ctx.body.assemblyId);
            const activityId = str(ctx.body.activityId);
            if (!ID_RE.test(assemblyId) || !ID_RE.test(activityId)) throw new HttpError(400, 'Invalid activity');
            const assembly = await getDoc(`organizations/${ctx.orgId}/structure/${assemblyId}`);
            if (!assembly || str(assembly.data.level) !== 'assembly') throw new HttpError(404, 'Assembly not found');
            await requireAt(ctx, PERMS.riskAssess, assemblyId, 'write', 'You do not have permission to assess risks for this assembly.');
            const activities = await getDoc(`organizations/${ctx.orgId}/assembly_activities/${assemblyId}`);
            const activity = (Array.isArray(activities?.data.items) ? activities.data.items.filter(isObj) : []).find((a) => str(a.id) === activityId);
            if (!activity) throw new HttpError(404, 'Activity not found');

            const rows = ctx.body.rows;
            if (!Array.isArray(rows) || rows.length > 150) throw new HttpError(400, 'Invalid assessment rows');
            const [hazards, impacts, controls, matrixDoc] = await Promise.all([master('hazards'), master('impacts'), master('controlMeasures'), getDoc(matrixPath(ctx.orgId))]);
            const known = (list: Array<Record<string, unknown>>, code: string) => list.some((x) => str(x.code) === code && x.active !== false);
            const matrix = isObj(matrixDoc?.data?.configuration) ? (matrixDoc?.data?.configuration as Record<string, any>) : null;

            const score = (value: unknown) => {
                if (value == null) return null;
                if (!matrix || !isObj(value)) throw new HttpError(400, 'Configure the SAF risk matrix first');
                const ratings: Record<string, number> = {};
                const given = isObj(value.ratings) ? value.ratings : {};
                for (const f of Array.isArray(matrix.factors) ? matrix.factors : []) {
                    const n = Number(given[f.code]);
                    if (!Number.isInteger(n) || n < 1 || n > f.max) throw new HttpError(400, 'Invalid risk rating');
                    ratings[f.code] = n;
                }
                const active = matrix.factors.filter((f: any) => f.enabled);
                const total = active.reduce((n: number, f: any) => (matrix.formula === 'add' ? n + ratings[f.code] : n * ratings[f.code]), matrix.formula === 'add' ? 0 : 1);
                const band = (Array.isArray(matrix.bands) ? matrix.bands : []).find((b: any) => total >= b.min && total <= b.max);
                return {
                    ratings,
                    score: total,
                    band: band?.label || '',
                    color: band?.color || '#64748b',
                    tolerability: total > matrix.tolerableMax ? 'Intolerable' : 'Tolerable',
                    matrixVersion: matrix.version,
                };
            };

            const normalized = rows.map((r: unknown) => {
                if (!isObj(r)) throw new HttpError(400, 'Invalid assessment row');
                const hazard = str(r.hazard);
                const impact = str(r.impact);
                if (!known(hazards, hazard) || !known(impacts, impact)) throw new HttpError(400, 'Select a valid hazard and impact for each row');
                const selected = Array.isArray(r.controls) ? Array.from(new Set(r.controls.map(str))) : [];
                if (selected.length > 80 || selected.some((c) => !known(controls, c))) throw new HttpError(400, 'Invalid control measure');
                return {
                    id: str(r.id).slice(0, 80),
                    hazard,
                    impact,
                    controls: selected,
                    permit: str(r.permit).slice(0, 150),
                    before: score(r.before),
                    after: score(r.after),
                };
            });

            const path = base(ctx.orgId, `${assemblyId}_${activityId}`);
            const existing = await getDoc(path);
            const previous = Array.isArray(existing?.data.rows) ? existing.data.rows : [];
            await writeDoc(path, { ...(existing?.data ?? {}), rows: normalized, updatedAt: nowIso(), updatedBy: ctx.uid });
            await audited(ctx, 'saf.activity_risk.save', `Risk assessment ${str(assembly.data.code) || assemblyId} · ${str(activity.name) || activityId}`, {
                rowsBefore: previous.length,
                rowsAfter: normalized.length,
                intolerableAfter: normalized.filter((r) => r.after?.tolerability === 'Intolerable').length,
            });
            return { saved: normalized.length };
        }),
    ],
};
