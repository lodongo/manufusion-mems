import { HttpError, getDoc, isObj, nowIso, str, writeDoc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { seedModuleMetadata } from './moduleDefaults';
import { PERMS, audited, diffByKey, requireAt } from './scopeGuard';

// ---------------------------------------------------------------------------
// Stored (hazardous) energy of an equipment unit with hazards, impacts, controls and risk ratings.
//   organizations/{org}/equipment_stored_energy/{workCenterId}
// Reading needs SAF.risk.view (or assess / SAF.view / AST.utilities.view) at the unit; saving needs
// SAF.risk.assess (or SAF.edit) at the unit. Every save is audited with the energy sources that changed.
// ---------------------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const riskPath = (o: string) => `organizations/${o}/saf/risk_matrix`;
const base = (o: string, id: string) => `organizations/${o}/equipment_stored_energy/${id}`;
const utilitiesPath = (o: string, id: string) => `organizations/${o}/equipment_utilities/${id}`;

async function master(key: string) {
    const doc = await getDoc(`module_workspaces/SAF/metadata/${key}`);
    return (Array.isArray(doc?.data.items) ? doc.data.items : [])
        .filter(isObj)
        .filter((x) => x.active !== false)
        .map((x) => ({ code: str(x.code), label: str(x.label), category: str(x.category), subcategory: str(x.subcategory), description: str(x.description) }));
}

async function equipmentUnit(ctx: OrgContext) {
    const id = str(ctx.body.workCenterId);
    if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid equipment unit');
    const node = await getDoc(`organizations/${ctx.orgId}/structure/${id}`);
    if (!node || str(node.data.level) !== 'work_center') throw new HttpError(404, 'Equipment unit not found');
    return { id, node };
}

export const storedEnergyRoutes = {
    'POST /api/org/ast/stored-energy/read': [
        orgRoute('org.ast.stored_energy.read', null, async (ctx) => {
            const { id } = await equipmentUnit(ctx);
            await requireAt(ctx, [...PERMS.riskView, 'AST.utilities.view'], id, 'read', 'You do not have permission to view the stored energy of this equipment unit.');
            await seedModuleMetadata('SAF');
            const [energy, hazards, impacts, controls, utilities, doc, riskDoc] = await Promise.all([
                master('hazardousEnergy'),
                master('hazards'),
                master('impacts'),
                master('controlMeasures'),
                getDoc(utilitiesPath(ctx.orgId, id)),
                getDoc(base(ctx.orgId, id)),
                getDoc(riskPath(ctx.orgId)),
            ]);
            const utilityRows = (Array.isArray(utilities?.data.items) ? utilities.data.items : []).filter(isObj);
            const existing = (Array.isArray(doc?.data.items) ? doc.data.items : []).filter(isObj);
            const initializedUtilities = Array.isArray(doc?.data.initializedUtilities) ? doc.data.initializedUtilities.map(str) : [];
            const mapped = new Set(existing.map((x) => str(x.utilityCode)));
            const pending = utilityRows.filter((u) => !mapped.has(str(u.code)) && !initializedUtilities.includes(str(u.code)));
            return {
                riskConfiguration: riskDoc?.data?.configuration || null,
                catalogue: { energy, hazards, impacts, controls },
                utilities: utilityRows,
                items: existing,
                initializedUtilities,
                pendingUtilities: pending,
                initialized: doc?.data.initialized === true,
                updatedAt: doc?.data.updatedAt || '',
                updatedBy: doc?.data.updatedBy || '',
            };
        }),
    ],

    'POST /api/org/ast/stored-energy/save': [
        orgRoute('org.ast.stored_energy.save', null, async (ctx) => {
            const { id, node } = await equipmentUnit(ctx);
            await requireAt(ctx, PERMS.riskAssess, id, 'write', 'You do not have permission to assess the stored energy of this equipment unit.');
            const raw = ctx.body.items;
            if (!Array.isArray(raw) || raw.length > 100) throw new HttpError(400, 'Invalid stored energy list');
            const [energy, hazards, impacts, controls, utilityDoc, riskDoc] = await Promise.all([
                master('hazardousEnergy'),
                master('hazards'),
                master('impacts'),
                master('controlMeasures'),
                getDoc(utilitiesPath(ctx.orgId, id)),
                getDoc(riskPath(ctx.orgId)),
            ]);
            const valid = (list: Array<{ code: string }>, code: string) => list.some((x) => x.code === code);
            const utilityCodes = new Set((Array.isArray(utilityDoc?.data.items) ? utilityDoc.data.items : []).filter(isObj).map((x) => str(x.code)));
            const config: any = riskDoc?.data?.configuration;
            const now = nowIso();

            const assess = (value: unknown) => {
                if (value == null) return null;
                if (!config || !isObj(value)) throw new HttpError(400, 'Risk matrix configuration required');
                const factors = Array.isArray(config.factors) ? config.factors : [];
                const given = isObj(value.ratings) ? value.ratings : {};
                const ratings: Record<string, number> = {};
                for (const f of factors) {
                    const n = given[f.code];
                    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > f.max) throw new HttpError(400, 'Risk rating out of range');
                    ratings[f.code] = n as number;
                }
                const enabled = factors.filter((f: any) => f.enabled);
                const score = enabled.reduce((n: number, f: any) => (config.formula === 'add' ? n + ratings[f.code] : n * ratings[f.code]), config.formula === 'add' ? 0 : 1);
                const band = (Array.isArray(config.bands) ? config.bands : []).find((b: any) => score >= b.min && score <= b.max);
                return { ratings, score, band: band?.label || 'Unclassified', color: band?.color || '#64748b', matrixVersion: config.version, assessedAt: now, assessedBy: ctx.uid };
            };

            const seen = new Set<string>();
            const items = raw.map((x: unknown) => {
                if (!isObj(x)) throw new HttpError(400, 'Invalid energy record');
                const uid = str(x.id);
                const energyCode = str(x.energyCode);
                if (!/^[\w-]{1,80}$/.test(uid) || seen.has(uid) || !valid(energy, energyCode)) throw new HttpError(400, 'Invalid or duplicate energy source');
                seen.add(uid);
                const utilityCode = str(x.utilityCode);
                if (utilityCode && !utilityCodes.has(utilityCode)) throw new HttpError(400, 'Utility not linked to equipment');
                const hazardRows = Array.isArray(x.hazards) ? x.hazards : [];
                if (hazardRows.length > 80) throw new HttpError(400, 'Too many hazards');
                const normalized = hazardRows.map((h: unknown) => {
                    if (!isObj(h) || !valid(hazards, str(h.code))) throw new HttpError(400, 'Invalid hazard');
                    const impactRows = Array.isArray(h.impacts) ? h.impacts : [];
                    if (impactRows.length > 80) throw new HttpError(400, 'Too many impacts');
                    return {
                        code: str(h.code),
                        impacts: impactRows.map((im: unknown) => {
                            if (!isObj(im) || !valid(impacts, str(im.code))) throw new HttpError(400, 'Invalid impact');
                            const measures = Array.isArray(im.controls) ? im.controls.map(str) : [];
                            if (measures.length > 80 || measures.some((c) => !valid(controls, c))) throw new HttpError(400, 'Invalid mitigation');
                            return { code: str(im.code), controls: Array.from(new Set(measures)), initialRisk: assess(im.initialRisk), residualRisk: assess(im.residualRisk) };
                        }),
                    };
                });
                return { id: uid, energyCode, utilityCode, hazards: normalized, notes: str(x.notes).slice(0, 500), updatedAt: now };
            });

            const previous = await getDoc(base(ctx.orgId, id));
            const utilityList = Array.isArray(ctx.body.initializedUtilities)
                ? ctx.body.initializedUtilities.map(str)
                : Array.isArray(previous?.data.initializedUtilities)
                  ? previous.data.initializedUtilities.map(str)
                  : [];
            if (utilityList.some((c: string) => !utilityCodes.has(c))) throw new HttpError(400, 'Unknown utility initialization');
            await writeDoc(base(ctx.orgId, id), {
                items,
                initialized: ctx.body.initialized === true || previous?.data.initialized === true,
                initializedUtilities: Array.from(new Set(utilityList)),
                updatedAt: now,
                updatedBy: ctx.uid,
            });
            // Timestamps change on every save, so compare only the substance of each energy source.
            const hazardSummary = (list: unknown) =>
                (Array.isArray(list) ? list : []).filter(isObj).map((h) => ({
                    code: str(h.code),
                    impacts: (Array.isArray(h.impacts) ? h.impacts : []).filter(isObj).map((im) => ({
                        code: str(im.code),
                        controls: Array.isArray(im.controls) ? im.controls.map(str) : [],
                        initial: isObj(im.initialRisk) ? im.initialRisk.score : null,
                        residual: isObj(im.residualRisk) ? im.residualRisk.score : null,
                    })),
                }));
            const comparable = (list: unknown) =>
                (Array.isArray(list) ? list : [])
                    .filter(isObj)
                    .map((x) => ({ id: str(x.id), energyCode: str(x.energyCode), utilityCode: str(x.utilityCode), hazards: hazardSummary(x.hazards), notes: str(x.notes) }));
            const diff = diffByKey(comparable(previous?.data.items), comparable(items), (x) => x.id);
            await audited(ctx, 'saf.stored_energy.save', `Stored energy of ${str(node.data.code) || id}`, diff);
            return { saved: items.length };
        }),
    ],
};
