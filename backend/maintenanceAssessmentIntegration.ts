import { getDoc, HttpError, str, type Doc, type Plain } from './core';
import type { OrgContext } from './guards';
import { nodePath } from './access';
import { catalogItemSpec } from './procurement';
import { materialIn, stockValOf } from './finCore';
import type { AssessedTask } from './maintenanceTaskAssessment';
import { enforceSourcingRules } from './maintenanceSourcing';

/** Persist canonical equipment links and catalogue specifications at assessment time. */
export async function prepareMaintenanceAssessment(ctx: OrgContext, record: Doc, tasks: AssessedTask[]) {
    const skillMaster = await getDoc('module_workspaces/HRM/metadata/skillsMaster');
    const activeSkills = new Set(
        (Array.isArray(skillMaster?.data.items) ? skillMaster.data.items : [])
            .filter((x) => x && typeof x === 'object' && !Array.isArray(x) && x.active !== false)
            .map((x: any) => str(x.code)),
    );
    for (const t of tasks) {
        if ((t.skillCodes || []).some((code) => !activeSkills.has(code)))
            throw new HttpError(400, 'Choose task competencies from the active HRM Skills Master.');
        // The four-step assessor UI captures task scope and the people needed.
        // Preserve the richer legacy fields without making them additional
        // mandatory form steps: derive transparent planning placeholders.
        t.instructions = t.instructions || t.description;
        t.skills = t.skills || (t.internalRoles?.length
            ? t.internalRoles.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(', ')
            : t.externalResource?.type || 'Competence to be verified by Maintenance Planning');
        t.completionCriteria = t.completionCriteria ||
            'Record completed task feedback, verify performance and confirm safe equipment handover.';
        t.equipmentId = t.equipmentId || str(record.data.unitId);
        t.assemblyId = t.assemblyId || str(record.data.assemblyId);
        const node = await getDoc(`organizations/${ctx.orgId}/structure/${t.assemblyId || t.equipmentId}`);
        const path = await nodePath(ctx.orgId, t.assemblyId || t.equipmentId);
        if (!node || !path.includes(str(record.data.unitId)) || t.equipmentId !== record.data.unitId)
            throw new HttpError(400, 'Choose this equipment or an assembly belonging to it.');
        for (const s of t.spares) {
            if (s.source === 'warehouse') {
                const m = await materialIn(ctx.orgId, s.materialId, s.warehouseId);
                if (!m || !['active', 'approved'].includes(str(m.data.status)))
                    throw new HttpError(400, 'Select an approved material linked to the warehouse.');
                s.unitCost = (await stockValOf(ctx.orgId, s.warehouseId, s.materialId)).avg || null;
            } else if (s.source === 'material') {
                const m = await getDoc(`organizations/${ctx.orgId}/materials/${s.materialId}`);
                if (!m || !['active', 'approved'].includes(str(m.data.status))) throw new HttpError(400, 'Select an approved registered material.');
            } else if (s.source === 'catalog') {
                const spec = await catalogItemSpec('materials', s.catalogCode);
                if (!spec) throw new HttpError(400, 'Select a valid technical material catalogue entry.');
                (s as unknown as Record<string, unknown>).catalogueSpecification = spec;
            }
        }
        for (const s of t.services) {
            if (!s.scope || !s.deliverables || !s.qualifications || !s.acceptanceCriteria)
                throw new HttpError(400, 'Every service needs scope, deliverables, qualifications and acceptance criteria.');
            if (s.catalogCode) {
                const spec = await catalogItemSpec('services', s.catalogCode);
                if (!spec) throw new HttpError(400, 'Select a valid service catalogue entry.');
                (s as unknown as Record<string, unknown>).catalogueSpecification = spec;
            }
        }
    }
    // Selection hierarchy (warehouse → registered material / catalogue → free text) and supplier qualification.
    await enforceSourcingRules(ctx, record, tasks as unknown as Parameters<typeof enforceSourcingRules>[2]);
    if (Buffer.byteLength(JSON.stringify(tasks), 'utf8') > 450000)
        throw new HttpError(
            400,
            'The assessment is too large for a single work order. Split the maintenance scope into additional work orders.',
        );
    return tasks;
}
