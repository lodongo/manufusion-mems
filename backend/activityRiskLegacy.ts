import { HttpError, getDoc, isObj, listDocs, nowIso, str, writeDoc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { seedModuleMetadata } from './moduleDefaults';
import { PERMS, audited, requireAt, stableJson } from './scopeGuard';

// ---------------------------------------------------------------------------
// Activity-based risk assessment of an equipment unit (the live assessment screen).
// One document per assembly activity: organizations/{org}/activity_risk_assessments/{assemblyId}_{activityId}
//   hazards[] -> impacts[] -> controls[], initial and residual risk scored with the organization's risk matrix.
// Reading needs SAF.risk.view (or assess / SAF.view) at the unit; saving needs SAF.risk.assess (or SAF.edit)
// at the unit. Every save is audited with the activities that changed.
// ---------------------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const path = (org: string, assembly: string, activity: string) => `organizations/${org}/activity_risk_assessments/${assembly}_${activity}`;
const matrixPath = (org: string) => `organizations/${org}/saf/risk_matrix`;

async function master(key: string) {
    const doc = await getDoc(`module_workspaces/SAF/metadata/${key}`);
    return (Array.isArray(doc?.data.items) ? doc.data.items : [])
        .filter(isObj)
        .filter((x) => x.active !== false)
        .map((x) => ({ code: str(x.code), label: str(x.label), category: str(x.category), subcategory: str(x.subcategory), description: str(x.description) }));
}

/** Activities of every assembly below the equipment unit. */
async function activityList(org: string, unitId: string) {
    const nodes = await listDocs(`organizations/${org}/structure`);
    const isBelowUnit = (node: (typeof nodes)[number]) => {
        let parent = str(node.data.parentId);
        const seen = new Set<string>();
        while (parent && !seen.has(parent)) {
            if (parent === unitId) return true;
            seen.add(parent);
            parent = str(nodes.find((x) => x.id === parent)?.data.parentId);
        }
        return false;
    };
    const assemblies = nodes.filter((n) => str(n.data.level) === 'assembly' && isBelowUnit(n));
    const nested = await Promise.all(
        assemblies.map(async (assembly) => {
            const doc = await getDoc(`organizations/${org}/assembly_activities/${assembly.id}`);
            return (Array.isArray(doc?.data.items) ? doc.data.items : []).filter(isObj).map((activity) => ({
                id: `${assembly.id}_${str(activity.id)}`,
                assemblyId: assembly.id,
                activityId: str(activity.id),
                name: str(activity.name),
                assemblyName: str(assembly.data.name),
                activityType: str(activity.type),
                maintenanceType: str(activity.maintenanceType),
                safetyScreening: isObj(activity.safetyScreening) ? activity.safetyScreening : {},
            }));
        })
    );
    return nested.flat();
}

function assess(value: unknown, config: any, uid: string) {
    if (value == null) return null;
    if (!config || !isObj(value)) throw new HttpError(400, 'Configure the SAF risk matrix first');
    const given = isObj(value.ratings) ? value.ratings : {};
    const ratings: Record<string, number> = {};
    for (const f of Array.isArray(config.factors) ? config.factors : []) {
        const n = Number(given[f.code]);
        if (!Number.isInteger(n) || n < 1 || n > f.max) throw new HttpError(400, 'Invalid risk rating');
        ratings[f.code] = n;
    }
    const active = config.factors.filter((f: any) => f.enabled);
    const score = active.reduce((n: number, f: any) => (config.formula === 'add' ? n + ratings[f.code] : n * ratings[f.code]), config.formula === 'add' ? 0 : 1);
    const band = (Array.isArray(config.bands) ? config.bands : []).find((b: any) => score >= b.min && score <= b.max);
    return { ratings, score, band: band?.label || 'Unclassified', color: band?.color || '#64748b', matrixVersion: config.version, assessedAt: nowIso(), assessedBy: uid };
}

async function equipmentUnit(ctx: OrgContext) {
    const unitId = str(ctx.body.workCenterId);
    if (!ID_RE.test(unitId)) throw new HttpError(400, 'Invalid equipment unit');
    const unit = await getDoc(`organizations/${ctx.orgId}/structure/${unitId}`);
    if (!unit || str(unit.data.level) !== 'work_center') throw new HttpError(404, 'Equipment unit not found');
    return { unitId, unit };
}

export const activityLegacyRoutes = {
    'POST /api/org/activity-risk/legacy-read': [
        orgRoute('org.activity_risk.read', null, async (ctx) => {
            const { unitId } = await equipmentUnit(ctx);
            await requireAt(ctx, PERMS.riskView, unitId, 'read', 'You do not have permission to view risk assessments for this equipment unit.');
            await seedModuleMetadata('SAF');
            const [activities, hazards, impacts, controls, risk] = await Promise.all([
                activityList(ctx.orgId, unitId),
                master('hazards'),
                master('impacts'),
                master('controlMeasures'),
                getDoc(matrixPath(ctx.orgId)),
            ]);
            const records = await Promise.all(
                activities.map(async (activity) => {
                    const doc = await getDoc(path(ctx.orgId, activity.assemblyId, activity.activityId));
                    const stored = Array.isArray(doc?.data.hazards) ? doc.data.hazards : [];
                    const older = Array.isArray(doc?.data.rows) ? doc.data.rows.filter(isObj) : [];
                    return {
                        id: activity.id,
                        energyCode: activity.id,
                        utilityCode: '',
                        assemblyName: activity.assemblyName,
                        activityType: activity.activityType,
                        maintenanceType: activity.maintenanceType,
                        safetyScreening: activity.safetyScreening,
                        hazards: stored.length
                            ? stored
                            : older.map((r) => ({
                                  code: str(r.hazard),
                                  impacts: [{ code: str(r.impact), controls: Array.isArray(r.controls) ? r.controls : [], initialRisk: r.before || null, residualRisk: r.after || null }],
                              })),
                        notes: '',
                    };
                })
            );
            return {
                catalogue: {
                    energy: activities.map((a) => ({ code: a.id, label: a.name, category: a.assemblyName, subcategory: a.activityType, description: a.maintenanceType })),
                    hazards,
                    impacts,
                    controls,
                },
                utilities: [],
                items: records,
                initialized: true,
                initializedUtilities: [],
                pendingUtilities: [],
                riskConfiguration: risk?.data?.configuration || null,
                updatedAt: nowIso(),
            };
        }),
    ],

    'POST /api/org/activity-risk/legacy-save': [
        orgRoute('org.activity_risk.save', null, async (ctx) => {
            const { unitId, unit } = await equipmentUnit(ctx);
            await requireAt(ctx, PERMS.riskAssess, unitId, 'write', 'You do not have permission to assess risks for this equipment unit.');
            const activities = await activityList(ctx.orgId, unitId);
            const raw = ctx.body.items;
            if (!Array.isArray(raw) || raw.length > 300) throw new HttpError(400, 'Invalid activity assessments');
            const [hazards, impacts, controls, risk] = await Promise.all([master('hazards'), master('impacts'), master('controlMeasures'), getDoc(matrixPath(ctx.orgId))]);
            const config = risk?.data?.configuration;
            const valid = (list: Array<{ code: string }>, code: string) => list.some((v) => v.code === code);
            const seen = new Set<string>();

            const writes = raw.map((r: unknown) => {
                if (!isObj(r)) throw new HttpError(400, 'Invalid activity assessment');
                const activity = activities.find((a) => a.id === str(r.id));
                if (!activity) throw new HttpError(400, 'Unknown assembly activity');
                if (seen.has(activity.id)) throw new HttpError(400, 'Duplicate assembly activity');
                seen.add(activity.id);
                const hs = Array.isArray(r.hazards) ? r.hazards : [];
                if (hs.length > 80) throw new HttpError(400, 'Too many hazards');
                const normalized = hs.map((h: unknown) => {
                    if (!isObj(h) || !valid(hazards, str(h.code))) throw new HttpError(400, 'Invalid hazard');
                    const ims = Array.isArray(h.impacts) ? h.impacts : [];
                    if (ims.length > 80) throw new HttpError(400, 'Too many impacts');
                    return {
                        code: str(h.code),
                        impacts: ims.map((im: unknown) => {
                            if (!isObj(im) || !valid(impacts, str(im.code))) throw new HttpError(400, 'Invalid impact');
                            const selected = Array.isArray(im.controls) ? Array.from(new Set(im.controls.map(str))) : [];
                            if (selected.length > 80 || selected.some((code) => !valid(controls, code))) throw new HttpError(400, 'Invalid mitigation');
                            return {
                                code: str(im.code),
                                controls: selected,
                                initialRisk: assess(im.initialRisk, config, ctx.uid),
                                residualRisk: assess(im.residualRisk, config, ctx.uid),
                            };
                        }),
                    };
                });
                return { activity, hazards: normalized };
            });

            // Compare with what is stored, so the audit names the activities that changed.
            const before = await Promise.all(writes.map((w) => getDoc(path(ctx.orgId, w.activity.assemblyId, w.activity.activityId))));
            const plain = (list: unknown) =>
                stableJson(
                    (Array.isArray(list) ? list : []).filter(isObj).map((h) => ({
                        code: str(h.code),
                        impacts: (Array.isArray(h.impacts) ? h.impacts : []).filter(isObj).map((im) => ({
                            code: str(im.code),
                            controls: Array.isArray(im.controls) ? im.controls.map(str) : [],
                            initial: isObj(im.initialRisk) ? im.initialRisk.score : null,
                            residual: isObj(im.residualRisk) ? im.residualRisk.score : null,
                        })),
                    }))
                );
            const now = nowIso();
            const changed: string[] = [];
            await Promise.all(
                writes.map(async (w, i) => {
                    const old = before[i];
                    if (plain(old?.data.hazards) !== plain(w.hazards)) {
                        const oldCount = Array.isArray(old?.data.hazards) ? old.data.hazards.length : 0;
                        changed.push(`${w.activity.name || w.activity.activityId}: hazards ${oldCount}→${w.hazards.length}`);
                    }
                    await writeDoc(path(ctx.orgId, w.activity.assemblyId, w.activity.activityId), { ...(old?.data ?? {}), hazards: w.hazards, updatedAt: now, updatedBy: ctx.uid });
                })
            );
            await audited(ctx, 'saf.activity_risk.save', `Activity risk assessment · ${str(unit.data.code) || unitId}`, changed.length ? changed.join('; ') : 'no changes');
            return { saved: writes.length };
        }),
    ],
};
