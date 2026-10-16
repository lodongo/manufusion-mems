import { HttpError, getDoc, isObj, listDocs, nowIso, str, writeDoc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { seedModuleMetadata } from './moduleDefaults';
import { PERMS, audited, diffByKey, requireAt, stableJson } from './scopeGuard';

// ---------------------------------------------------------------------------
// Preventive (PM) and autonomous (AM) maintenance activities defined for an assembly.
//   organizations/{org}/assembly_activities/{assemblyId}
// Reading needs MNT.activities.view (or edit / MNT.view) at the assembly; saving needs MNT.activities.edit
// (or MNT.admin) at the assembly. Every save is audited with the activities added, removed and changed.
// ---------------------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const ACTIVITY_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const path = (org: string, id: string) => `organizations/${org}/assembly_activities/${id}`;
const KEYS = ['pmActivities', 'amActivities', 'maintenanceTriggers', 'workPriorities', 'maintenanceFrequencies', 'maintenanceDurations', 'failureModes', 'resourceTypes', 'maintenanceTypes', 'impacts'];
const SCREENING_KEYS = ['equipmentRunning', 'bodyExposure', 'toolsOrParts', 'guardsRemoved', 'liveTesting', 'jogging', 'hotWork', 'workAtHeight', 'confinedSpace', 'electricalWork', 'storedEnergy', 'hazardousChemicals'];
const ROLE_LEVELS = ['site', 'department', 'cost_center', 'work_center', 'assembly'];

interface MetaItem {
    code: string;
    label: string;
    category: string;
    subcategory: string;
    selectable: boolean;
}

async function list(key: string): Promise<MetaItem[]> {
    const doc = await getDoc(`module_workspaces/MNT/metadata/${key}`);
    return (Array.isArray(doc?.data.items) ? doc.data.items : [])
        .filter(isObj)
        .filter((x) => x.active !== false)
        .map((x) => ({ code: str(x.code), label: str(x.label), category: str(x.category), subcategory: str(x.subcategory), selectable: x.selectable !== false }));
}

async function skillItems() {
    const doc = await getDoc('module_workspaces/HRM/metadata/skillsMaster');
    return (Array.isArray(doc?.data.items) ? doc.data.items : [])
        .filter(isObj)
        .filter((x) => x.active !== false)
        .map((x) => ({ code: str(x.code), label: str(x.label), category: str(x.category), subcategory: str(x.subcategory) }));
}

async function assemblyNode(ctx: OrgContext) {
    const id = str(ctx.body.assemblyId);
    if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid assembly');
    const node = await getDoc(`organizations/${ctx.orgId}/structure/${id}`);
    if (!node || str(node.data.level) !== 'assembly') throw new HttpError(404, 'Assembly not found');
    return { id, node };
}

const unique = (v: unknown) => (Array.isArray(v) ? Array.from(new Set(v.map(str))) : []);

export const assemblyActivityRoutes = {
    'POST /api/org/assembly/activities/read': [
        orgRoute('org.assembly.activities.read', null, async (ctx) => {
            const { id } = await assemblyNode(ctx);
            await requireAt(ctx, PERMS.activitiesView, id, 'read', 'You do not have permission to view the maintenance activities of this assembly.');
            await seedModuleMetadata('MNT');
            const [docs, skills, saved, roleDocs] = await Promise.all([Promise.all(KEYS.map(list)), skillItems(), getDoc(path(ctx.orgId, id)), listDocs(`organizations/${ctx.orgId}/positions`)]);
            const roles = roleDocs
                .filter((p) => ROLE_LEVELS.includes(str(p.data.operatingLevel)))
                .map((p) => ({ code: p.id, title: str(p.data.title), operatingLevel: str(p.data.operatingLevel), coreSkills: Array.isArray(p.data.coreSkills) ? p.data.coreSkills.map(str) : [] }));
            return {
                roles,
                items: Array.isArray(saved?.data.items) ? saved.data.items : [],
                metadata: Object.fromEntries(KEYS.map((k, i) => [k, docs[i]])),
                skills,
            };
        }),
    ],

    'POST /api/org/assembly/activities/save': [
        orgRoute('org.assembly.activities.save', null, async (ctx) => {
            const { id: assemblyId, node } = await assemblyNode(ctx);
            await requireAt(ctx, PERMS.activitiesEdit, assemblyId, 'write', 'You do not have permission to change the maintenance activities of this assembly.');
            const raw = ctx.body.items;
            if (!Array.isArray(raw) || raw.length > 300) throw new HttpError(400, 'Invalid activities');
            await seedModuleMetadata('MNT');
            const [lists, skills, roleDocs, existing] = await Promise.all([Promise.all(KEYS.map(list)), skillItems(), listDocs(`organizations/${ctx.orgId}/positions`), getDoc(path(ctx.orgId, assemblyId))]);
            const metadata: Record<string, MetaItem[]> = Object.fromEntries(KEYS.map((k, i) => [k, lists[i]]));
            const skillCodes = new Set(skills.map((s) => s.code));
            const valid = (key: string, code: string) => metadata[key].some((x) => x.code === code);
            const allowedRoles = new Set(roleDocs.filter((p) => ROLE_LEVELS.includes(str(p.data.operatingLevel))).map((p) => p.id));
            const previous = (Array.isArray(existing?.data.items) ? existing.data.items : []).filter(isObj);
            const now = nowIso();
            const seen = new Set<string>();

            const items = raw.map((x: unknown) => {
                if (!isObj(x)) throw new HttpError(400, 'Invalid activity');
                const id = str(x.id);
                const name = str(x.name).trim();
                const description = str(x.description).trim();
                const instructions = str(x.instructions).trim();
                if (!ACTIVITY_ID_RE.test(id) || seen.has(id) || name.length < 3 || name.length > 180) throw new HttpError(400, 'Invalid activity identity');
                seen.add(id);
                if (description.length > 2000 || instructions.length > 5000) throw new HttpError(400, 'Description or instructions too long');

                // Failure modes and impacts (categories, then subcategories inside the chosen categories).
                const failureCategory = str(x.failureCategory);
                const failureSubcategory = str(x.failureSubcategory);
                const failureCategories = Array.isArray(x.failureCategories) ? unique(x.failureCategories) : failureCategory ? [failureCategory] : [];
                const failureSubcategories = Array.isArray(x.failureSubcategories) ? unique(x.failureSubcategories) : failureSubcategory ? [failureSubcategory] : [];
                if (failureCategories.length > 40 || failureCategories.some((c) => !metadata.failureModes.some((v) => v.code === c && !v.category))) throw new HttpError(400, 'Invalid failure mode categories');
                if (failureSubcategories.length > 60 || failureSubcategories.some((c) => !metadata.failureModes.some((v) => v.code === c && failureCategories.includes(v.category)))) throw new HttpError(400, 'Invalid failure mode subcategories');
                if (failureCategory && !valid('failureModes', failureCategory)) throw new HttpError(400, 'Invalid failure mode or resource type');
                if (failureSubcategory && (!failureCategory || !metadata.failureModes.some((v) => v.code === failureSubcategory && v.category === failureCategory))) throw new HttpError(400, 'Invalid failure mode or resource type');
                const impactCategories = unique(x.impactCategories);
                const impactSubcategories = unique(x.impactSubcategories);
                if (
                    impactCategories.length > 60 ||
                    impactSubcategories.length > 150 ||
                    impactCategories.some((c) => !metadata.impacts.some((v) => v.code === c && !v.category)) ||
                    impactSubcategories.some((c) => !metadata.impacts.some((v) => v.code === c && impactCategories.includes(v.category)))
                ) {
                    throw new HttpError(400, 'Invalid impact categories or subcategories');
                }

                // Safety screening answers: only the known yes/no questions are kept.
                const safetyScreening = isObj(x.safetyScreening) ? Object.fromEntries(Object.entries(x.safetyScreening).filter(([k, v]) => SCREENING_KEYS.includes(k) && typeof v === 'boolean')) : {};

                const executionRoles = unique(x.executionRoles);
                if (executionRoles.length > 100 || executionRoles.some((c) => !allowedRoles.has(c))) throw new HttpError(400, 'Invalid execution roles');
                const resourceType = str(x.resourceType);
                if (resourceType && !valid('resourceTypes', resourceType)) throw new HttpError(400, 'Invalid failure mode or resource type');
                const maintenanceType = str(x.maintenanceType);
                if (maintenanceType && !valid('maintenanceTypes', maintenanceType)) throw new HttpError(400, 'Invalid maintenance type');

                // Classification, trigger and duration.
                const type = str(x.type);
                const category = str(x.category);
                const subcategory = str(x.subcategory);
                const trigger = str(x.trigger);
                const frequency = str(x.frequency);
                const priority = str(x.priority);
                const durationUnit = str(x.durationUnit);
                const duration = Number(x.duration);
                const triggerValue = Number(x.triggerValue || 0);
                const triggerParameter = str(x.triggerParameter).trim().slice(0, 120);
                const triggerUnit = str(x.triggerUnit).trim().slice(0, 40);
                const needsCalendar = trigger === 'MAI-001';
                if (needsCalendar && !valid('maintenanceFrequencies', frequency)) throw new HttpError(400, 'Select a valid calendar frequency');
                if (['MAI-002', 'MAI-003'].includes(trigger) && (!Number.isSafeInteger(triggerValue) || triggerValue < 1)) throw new HttpError(400, 'Enter a positive running-hour or cycle interval');
                if (trigger === 'MAI-004' && (!triggerParameter || !triggerUnit || !Number.isFinite(triggerValue))) throw new HttpError(400, 'Condition monitoring parameter, threshold and unit are required');
                if (trigger === 'MAI-007' && !triggerParameter) throw new HttpError(400, 'Enter regulatory interval');
                const skills = unique(x.skills);
                const key = type === 'PM' ? 'pmActivities' : type === 'AM' ? 'amActivities' : '';
                if (
                    !key ||
                    !valid(key, category) ||
                    (subcategory && !metadata[key].some((v) => v.code === subcategory && v.category === category)) ||
                    !valid('maintenanceTriggers', trigger) ||
                    !valid('workPriorities', priority) ||
                    !valid('maintenanceDurations', durationUnit) ||
                    !Number.isFinite(duration) ||
                    duration <= 0 ||
                    duration > 100000 ||
                    skills.length < 3 ||
                    skills.length > 30 ||
                    skills.some((c) => !skillCodes.has(c))
                ) {
                    throw new HttpError(400, 'Invalid activity metadata or fewer than three HR skills');
                }
                if (type === 'PM' && !subcategory) throw new HttpError(400, 'PM subcategory required');

                const item = {
                    id,
                    name,
                    description,
                    instructions,
                    failureCategory,
                    failureSubcategory,
                    failureCategories,
                    failureSubcategories,
                    impactCategories,
                    impactSubcategories,
                    safetyScreening,
                    maintenanceType,
                    executionRoles,
                    resourceType,
                    skillCategory: str(x.skillCategory).slice(0, 80),
                    skillSubcategory: str(x.skillSubcategory).slice(0, 80),
                    type,
                    category,
                    subcategory,
                    trigger,
                    frequency: needsCalendar ? frequency : '',
                    triggerValue,
                    triggerParameter,
                    triggerUnit,
                    priority,
                    duration,
                    durationUnit,
                    skills,
                };
                // Unchanged activities keep who last changed them and when.
                const before = previous.find((p) => str(p.id) === id);
                const same = before && stableJson(strip(before)) === stableJson(item);
                return { ...item, updatedAt: same ? str(before.updatedAt) || now : now, updatedBy: same ? str(before.updatedBy) || ctx.uid : ctx.uid };
            });

            await writeDoc(path(ctx.orgId, assemblyId), { ...(existing?.data ?? {}), items, updatedAt: now, updatedBy: ctx.uid });
            const diff = diffByKey(previous.map(strip), items.map(strip), (x: any) => str(x.id));
            await audited(ctx, 'mnt.assembly_activities.save', `Maintenance activities of ${str(node.data.code) || assemblyId}`, diff);
            return { saved: items.length };
        }),
    ],
};

/** Activity without its change stamp, for comparisons. */
function strip(item: Record<string, unknown>) {
    const { updatedAt: _a, updatedBy: _b, ...rest } = item;
    return rest;
}
