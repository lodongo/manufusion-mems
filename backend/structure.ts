import { storage } from './platform/sdk';
import {
    HttpError,
    DOCUMENT_NAME_ROOT,
    encodeFields,
    googleRequest,
    deleteDoc,
    fieldEq,
    getDoc,
    isObj,
    listDocs,
    num,
    nowIso,
    orderDesc,
    randomId,
    rateLimit,
    runQuery,
    str,
    text,
    updateFields,
    writeDoc,
    type Doc,
    type Fields,
    type Plain,
} from './core';
import { audit, auditOut } from './audit';
import { hasPerm, orgRoute, secure, type OrgContext } from './guards';
import { detectImage } from './branding';
import { createUnitAsset, linkWorkCenterAsset, readUnitClass, releaseUnitAsset } from './assets';

// Organization design.
// Single legal entity organizations start directly with the legal entity. Groups declare
// levels above legal entities, stored generically as Level_0 (top) ... Level_n and named by them.
// From legal entity down, a hard-coded, codified chain where each code inherits its parent's:
//   Legal entity (ABC) > Site (ABC-01) > Department (ABC-01-PRD) > Cost center (ABC-01-PRD-001)
//   > Equipment unit (...-001) > Assembly (...-01) > Bills of materials (not codified; components come from inventory)
// "Equipment unit" (ISO 14224) is any machine, line, utility system or facility. It is stored under the internal
// level key 'work_center' and is classified from the asset catalog; its attributes live on its asset record.
// The old separate 'equipment' level is kept read-only for data created before this change.

export async function signedUrl(path: string): Promise<string> {
    if (!path) return '';
    try {
        const [signed] = await storage.url([path]);
        return signed?.url ?? '';
    } catch {
        return '';
    }
}

type FieldType = 'text' | 'select' | 'date' | 'number' | 'country' | 'currency' | 'email' | 'url' | 'phone' | 'bank' | 'meta' | 'fin' | 'asset' | 'assetClass';

interface FieldDef {
    label: string;
    type: FieldType;
    required?: boolean;
    options?: string[];
    min?: number;
    max?: number;
    list?: string;
}

interface LevelDef {
    label: string;
    parents: string[];
    pattern: RegExp;
    auto: number;
    managerRequired?: boolean;
    /** Kept only to show data created before the hierarchy change; nothing new can be added. */
    legacy?: boolean;
    fields: Record<string, FieldDef>;
}

const MAX_UPPER_LEVELS = 6;

const LEVELS: Record<string, LevelDef> = {
    group: { label: 'Upper level unit', parents: ['root', 'group'], pattern: /^[A-Z]{2,6}$/, auto: 0, fields: {} },
    legal_entity: {
        label: 'Legal entity',
        parents: ['root', 'group'],
        pattern: /^[A-Z]{3}$/,
        auto: 0,
        fields: {
            tradingName: { label: 'Trading name', type: 'text' },
            registrationNumber: { label: 'Registration number', type: 'text', required: true },
            registrationDate: { label: 'Registration date', type: 'date' },
            taxNumber: { label: 'Tax PIN / TIN', type: 'text', required: true },
            vatNumber: { label: 'VAT number', type: 'text' },
            countryCode: { label: 'Country', type: 'country', required: true },
            currencyCode: { label: 'Functional currency', type: 'currency', required: true },
            fiscalYearStart: { label: 'Financial year starts', type: 'meta', list: 'fiscalYearStart' },
            address: { label: 'Physical address', type: 'text', required: true },
            city: { label: 'City or town', type: 'text', required: true },
            postalAddress: { label: 'Postal address', type: 'text' },
            postalCode: { label: 'Postal code', type: 'text' },
            phone: { label: 'Telephone', type: 'phone' },
            email: { label: 'Email', type: 'email' },
            website: { label: 'Website', type: 'url' },
            bankId: { label: 'Bank', type: 'bank' },
            bankBranch: { label: 'Bank branch', type: 'text' },
            bankAccountName: { label: 'Account name', type: 'text' },
            bankAccountNumber: { label: 'Account number', type: 'text' },
        },
    },
    site: {
        label: 'Site',
        parents: ['legal_entity'],
        pattern: /^\d{2}$/,
        auto: 2,
        fields: {
            siteType: { label: 'Site type', type: 'select', options: ['Factory', 'Warehouse', 'Office', 'Depot', 'Farm', 'Shop', 'Other'] },
            address: { label: 'Physical address', type: 'text' },
            city: { label: 'City or town', type: 'text' },
            phone: { label: 'Telephone', type: 'phone' },
        },
    },
    department: { label: 'Department', parents: ['site'], pattern: /^[A-Z]{3}$/, auto: 0, fields: {} },
    cost_center: {
        label: 'Cost center',
        parents: ['department'],
        pattern: /^\d{3}$/,
        auto: 3,
        managerRequired: true,
        fields: {
            costType: { label: 'Cost center type', type: 'fin', required: true, list: 'costCenterTypes' },
        },
    },
    work_center: {
        label: 'Equipment unit',
        parents: ['cost_center'],
        pattern: /^\d{2,3}$/,
        auto: 3,
        fields: {
            equipmentClass: { label: 'Equipment class', type: 'assetClass' },
            // Link to the unit's asset record (managed by the asset routes, preserved on edit).
            assetTag: { label: 'Asset', type: 'asset' },
        },
    },
    equipment: {
        label: 'Equipment (old level)',
        legacy: true,
        parents: ['work_center'],
        pattern: /^\d{3}$/,
        auto: 3,
        fields: {
            manufacturer: { label: 'Manufacturer', type: 'text' },
            model: { label: 'Model', type: 'text' },
            serialNumber: { label: 'Serial number', type: 'text' },
            commissionedOn: { label: 'Commissioned on', type: 'date' },
        },
    },
    assembly: { label: 'Assembly', parents: ['work_center', 'equipment'], pattern: /^\d{2}$/, auto: 2, fields: {} },
};

export const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
export const col = (orgId: string) => `organizations/${orgId}/structure`;
const bomCol = (orgId: string) => `organizations/${orgId}/boms`;

export function designOf(org: Doc): { mode: string; names: string[] } {
    const raw = isObj(org.data.designLevels) ? org.data.designLevels : {};
    const names = Array.isArray(raw.names) ? (raw.names as Plain[]).map(str).filter(Boolean).slice(0, MAX_UPPER_LEVELS) : [];
    return { mode: str(raw.mode) || (names.length ? 'multi' : ''), names };
}

export function nodeOut(doc: Doc) {
    const d = doc.data;
    return {
        id: doc.id,
        level: str(d.level),
        tier: typeof d.tier === 'number' ? d.tier : 0,
        parentId: str(d.parentId),
        code: str(d.code),
        segment: str(d.segment),
        name: str(d.name),
        description: str(d.description),
        status: str(d.status) || 'active',
        managerUid: str(d.managerUid),
        managerName: str(d.managerName),
        managerRoleCode: str(d.managerRoleCode),
        managerRoleTitle: str(d.managerRoleTitle),
        attributes: isObj(d.attributes) ? d.attributes : {},
        roleCodes: Array.isArray(d.roleCodes) ? (d.roleCodes as Plain[]).map(str) : [],
        logoPath: str(d.logoPath),
        createdAt: str(d.createdAt),
        updatedAt: str(d.updatedAt),
    };
}

function bomOut(doc: Doc) {
    const d = doc.data;
    return {
        id: doc.id,
        assemblyId: str(d.assemblyId),
        code: str(d.code),
        version: typeof d.version === 'number' ? d.version : 1,
        name: str(d.name),
        status: str(d.status) || 'draft',
        lines: (Array.isArray(d.lines) ? d.lines : []).filter(isObj).map((l) => ({
            component: str(l.component),
            description: str(l.description),
            quantity: typeof l.quantity === 'number' ? l.quantity : 0,
            unit: str(l.unit),
        })),
        updatedAt: str(d.updatedAt),
    };
}

export async function childrenOf(orgId: string, parentId: string) {
    const docs = await runQuery({ from: [{ collectionId: 'structure' }], where: fieldEq('parentId', parentId) }, `organizations/${orgId}`);
    return docs.map(nodeOut).sort((a, b) => a.code.localeCompare(b.code));
}

async function bomsOf(orgId: string, assemblyId: string) {
    const docs = await runQuery({ from: [{ collectionId: 'boms' }], where: fieldEq('assemblyId', assemblyId) }, `organizations/${orgId}`);
    return docs.map(bomOut).sort((a, b) => a.code.localeCompare(b.code));
}

async function ancestorsOf(orgId: string, parentId: string) {
    const out: ReturnType<typeof nodeOut>[] = [];
    let pid = parentId;
    for (let i = 0; i < 15 && pid && pid !== 'root'; i++) {
        const doc = await getDoc(`${col(orgId)}/${pid}`);
        if (!doc) break;
        const node = nodeOut(doc);
        out.unshift(node);
        pid = node.parentId;
    }
    return out;
}

async function refSets() {
    const [c, cur, m, b, fin] = await Promise.all([
        getDoc('reference/countries'),
        getDoc('reference/currencies'),
        getDoc('reference/metadata'),
        getDoc('reference/banks'),
        getDoc('module_workspaces/FIN/metadata/costCenterTypes'),
    ]);
    const items = (doc: Doc | null) => (Array.isArray(doc?.data.items) ? (doc?.data.items as Plain[]).filter(isObj) : []);
    const countries = items(c);
    const lists = items(m);
    return {
        countries: new Set(countries.map((x) => str(x.iso2))),
        timezones: new Set(countries.map((x) => str(x.timezone)).filter(Boolean)),
        currencies: new Set(items(cur).map((x) => str(x.code))),
        banks: new Set(items(b).map((x) => str(x.id))),
        finCostTypes: new Set(items(fin).filter((x) => x.active !== false).map((x) => str(x.code))),
        codes: (key: string) => {
            const list = lists.find((l) => str(l.key) === key);
            return new Set((Array.isArray(list?.items) ? (list?.items as Plain[]) : []).map((i) => (isObj(i) ? str(i.code) : '')).filter(Boolean));
        },
    };
}

async function readAttributes(level: string, raw: unknown): Promise<Fields> {
    const def = LEVELS[level];
    const input = (isObj(raw) ? raw : {}) as Record<string, unknown>;
    const out: Fields = {};
    let refs: Awaited<ReturnType<typeof refSets>> | null = null;
    for (const [key, field] of Object.entries(def.fields)) {
        const value = input[key];
        if (value === undefined || value === null || String(value).trim() === '') {
            if (field.required) throw new HttpError(400, `${field.label} is required.`);
            continue;
        }
        if (field.type === 'number') {
            const n = Number(value);
            if (!Number.isFinite(n) || n < (field.min ?? 0) || n > (field.max ?? 1e12)) throw new HttpError(400, `${field.label} must be between ${field.min} and ${field.max}.`);
            out[key] = n;
            continue;
        }
        const s = String(value).trim();
        if (s.length > 160) throw new HttpError(400, `${field.label} can be up to 160 characters.`);
        switch (field.type) {
            case 'select':
                if (!(field.options ?? []).includes(s)) throw new HttpError(400, `Choose a valid ${field.label.toLowerCase()}.`);
                break;
            case 'date':
                if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, `Enter a valid date for ${field.label.toLowerCase()}.`);
                break;
            case 'email':
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, `Enter a valid ${field.label.toLowerCase()}.`);
                break;
            case 'url':
                if (!/^https:\/\/[^\s]+\.[^\s]+$/.test(s)) throw new HttpError(400, `${field.label} must start with https://`);
                break;
            case 'phone':
                if (!/^\+?[0-9 ()-]{7,20}$/.test(s)) throw new HttpError(400, `Enter a valid ${field.label.toLowerCase()}.`);
                break;
            case 'text':
                break;
            case 'assetClass':
                // Checked against the organization's asset catalog by the create and update routes.
                if (!/^[A-Za-z0-9][A-Za-z0-9._ \/-]{0,59}$/.test(s)) throw new HttpError(400, 'Choose an equipment class from the asset catalog.');
                break;
            case 'asset':
                // Checked against the asset register by the create and update routes.
                if (!/^AST-\d{6}$/.test(s)) throw new HttpError(400, 'Choose an asset from the list.');
                break;
            default: {
                refs ??= await refSets();
                const ok =
                    field.type === 'country'
                        ? refs.countries.has(s)
                        : field.type === 'currency'
                          ? refs.currencies.has(s)
                          : field.type === 'bank'
                            ? refs.banks.has(s)
                            : field.type === 'fin'
                              ? refs.finCostTypes.has(s)
                              : refs.codes(field.list ?? '').has(s);
                if (!ok) throw new HttpError(400, `Choose a ${field.label.toLowerCase()} from the list.`);
            }
        }
        out[key] = s;
    }
    return out;
}

export async function readManager(ctx: OrgContext, raw: unknown, required = false): Promise<{ managerUid: string; managerName: string }> {
    const uid = str(raw);
    if (!uid) {
        if (required) throw new HttpError(400, 'Choose the manager responsible.');
        return { managerUid: '', managerName: '' };
    }
    if (!ID_RE.test(uid)) throw new HttpError(400, 'Choose a manager from your users.');
    const user = await getDoc(`users/${uid}`);
    if (!user || str(user.data.orgId) !== ctx.orgId) throw new HttpError(400, 'Choose a manager from your users.');
    return { managerUid: uid, managerName: `${str(user.data.firstName)} ${str(user.data.lastName)}`.trim() };
}

/**
 * Which job roles can manage a unit: upper levels use roles operating at that Level_n, legal entities use
 * legal-entity roles, and sites and everything below a site use site-level roles. Returns the site (if any)
 * so chosen roles can be added to it.
 */
export async function managerContext(ctx: OrgContext, level: string, parentId: string, nodeId: string): Promise<{ expected: string; site: Doc | null }> {
    if (!LEVELS[level]) throw new HttpError(400, 'Unknown level.');
    if (level === 'group') {
        let tier = 0;
        if (nodeId) tier = num((await getNode(ctx, nodeId)).data.tier) ?? 0;
        else if (parentId && parentId !== 'root') tier = (num((await getNode(ctx, parentId)).data.tier) ?? 0) + 1;
        return { expected: `upper:${tier}`, site: null };
    }
    if (level === 'legal_entity') return { expected: 'legal_entity', site: null };
    if (level === 'site') return { expected: 'site', site: nodeId ? await getNode(ctx, nodeId) : null };
    let cursor = parentId;
    for (let i = 0; i < 10 && cursor && cursor !== 'root'; i++) {
        const doc = await getNode(ctx, cursor);
        if (str(doc.data.level) === 'site') return { expected: 'site', site: doc };
        cursor = str(doc.data.parentId);
    }
    return { expected: 'site', site: null };
}

/** Levels below the cost center (equipment units, legacy equipment and assemblies) never have a manager. */
const NO_MANAGER_LEVELS = ['work_center', 'equipment', 'assembly'];

/** Managers are job roles (ROL_), never users or security roles. Required for cost centers. */
async function readManagerRole(ctx: OrgContext, raw: unknown, level: string, parentId: string, nodeId: string, required: boolean) {
    const code = str(raw);
    if (NO_MANAGER_LEVELS.includes(level)) {
        if (code) throw new HttpError(400, 'Managers are assigned to cost centers and the levels above them only.');
        return { managerRoleCode: '', managerRoleTitle: '', managerUid: '', managerName: '' };
    }
    if (!code) {
        if (required) throw new HttpError(400, 'Choose the manager job role.');
        return { managerRoleCode: '', managerRoleTitle: '', managerUid: '', managerName: '' };
    }
    if (!/^ROL_\d{3,6}$/.test(code)) throw new HttpError(400, 'Choose a job role from the list.');
    const position = await getDoc(`organizations/${ctx.orgId}/positions/${code}`);
    if (!position) throw new HttpError(400, 'Choose a job role from the list.');
    const title = str(position.data.title);
    const { expected, site } = await managerContext(ctx, level, parentId, nodeId);
    if (str(position.data.operatingLevel) !== expected) throw new HttpError(400, `${title} does not operate at this level. Check its "Operates at" under Job roles.`);
    if (site) {
        const selected = Array.isArray(site.data.roleCodes) ? (site.data.roleCodes as Plain[]).map(str) : [];
        if (!selected.includes(code)) await updateFields(`${col(ctx.orgId)}/${site.id}`, { roleCodes: [...selected, code], updatedAt: nowIso() });
    }
    return { managerRoleCode: code, managerRoleTitle: title, managerUid: '', managerName: '' };
}

export function record(ctx: OrgContext, action: string, target: string, details = '') {
    return audit([{ category: 'data', action, actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { label: target }, details }]);
}

export async function getNode(ctx: OrgContext, id: string): Promise<Doc> {
    const doc = ID_RE.test(id) ? await getDoc(`${col(ctx.orgId)}/${id}`) : null;
    if (!doc) throw new HttpError(404, 'Not found in your organization design.');
    return doc;
}

function levelName(names: string[], tier: number): string {
    return names[tier] || `Level_${tier}`;
}

export const structureRoutes = {
    'POST /api/org/structure/node': [
        orgRoute('org.structure.node', null, async (ctx) => {
            const design = designOf(ctx.org);
            const id = str(ctx.body.id) || 'root';
            if (id === 'root') {
                const [children, all] = await Promise.all([childrenOf(ctx.orgId, 'root'), listDocs(col(ctx.orgId))]);
                const withCounts = children.map((c) => ({ ...c, childCount: all.filter((n) => str(n.data.parentId) === c.id).length }));
                return { node: null, ancestors: [], children: withCounts, boms: [], design: { ...design, locked: children.length > 0 } };
            }
            const doc = await getNode(ctx, id);
            const node = nodeOut(doc);
            const [ancestors, children, boms, logoUrl] = await Promise.all([
                ancestorsOf(ctx.orgId, node.parentId),
                childrenOf(ctx.orgId, id),
                node.level === 'assembly' ? bomsOf(ctx.orgId, id) : Promise.resolve([] as ReturnType<typeof bomOut>[]),
                signedUrl(node.level === 'legal_entity' && node.logoPath.startsWith('organizations/' + ctx.orgId + '/entities/' + node.id + '/logo_') ? node.logoPath : ''),
            ]);
            // People currently holding the cost center manager role at this site.
            let managerHolders: string[] = [];
            const scopeId = ['site', 'legal_entity', 'group'].includes(node.level) ? node.id : ancestors.find((a) => a.level === 'site')?.id;
            if (node.managerRoleCode && scopeId) {
                const users = await runQuery({ from: [{ collectionId: 'users' }], where: fieldEq('orgId', ctx.orgId) });
                managerHolders = users
                    .filter((u) => (Array.isArray(u.data.assignments) ? (u.data.assignments as Plain[]) : []).some((a) => isObj(a) && str(a.positionCode) === node.managerRoleCode && str(a.nodeId) === scopeId))
                    .map((u) => `${str(u.data.firstName)} ${str(u.data.lastName)}`.trim());
            }
            const siblings = await listDocs(col(ctx.orgId));
            const withCounts = children.map((c) => ({ ...c, childCount: siblings.filter((n) => str(n.data.parentId) === c.id).length }));
            return { node: { ...node, logoUrl, managerHolders }, ancestors, children: withCounts, boms, design: { ...design, locked: true } };
        }),
    ],

    'POST /api/org/structure/design/save': [
        orgRoute('org.structure.design', 'ADM.structure', async (ctx) => {
            const mode = str(ctx.body.mode) === 'single' ? 'single' : 'multi';
            const raw = Array.isArray(ctx.body.names) ? ctx.body.names : [];
            if (mode === 'single' && raw.length) throw new HttpError(400, 'A single legal entity organization has no levels above it.');
            if (raw.length > MAX_UPPER_LEVELS) throw new HttpError(400, `You can declare up to ${MAX_UPPER_LEVELS} levels above legal entities.`);
            const names = raw.map((n, i) => {
                const name = str(n).trim();
                if (name.length < 2 || name.length > 40) throw new HttpError(400, `Give Level_${i} a name of 2 to 40 characters.`);
                return name;
            });
            if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new HttpError(400, 'Each level needs a different name.');
            const current = designOf(ctx.org);
            const changesShape = names.length !== current.names.length || mode !== (current.mode || mode);
            const rooted = await childrenOf(ctx.orgId, 'root');
            // Converting from one legal entity to many is a safe policy-only change:
            // existing legal entities and all their descendants retain their IDs and parent links.
            const allowExpansion = current.mode === 'single' && mode === 'multi' && names.length === 0;
            if (changesShape && rooted.length && !allowExpansion) {
                throw new HttpError(400, 'Existing hierarchy links must be preserved. Use Add upper level to insert a new parent safely, or rename existing levels.');
            }
            await updateFields(`organizations/${ctx.orgId}`, { designLevels: { mode, names, updatedAt: nowIso(), updatedBy: ctx.actor.email } });
            await record(ctx, 'org.structure.design', mode === 'single' ? 'Single legal entity' : 'Several legal entities', names.length ? names.map((n, i) => `Level_${i}: ${n}`).join(', ') : 'No upper levels');
            return { mode, names };
        }),
    ],

    /** Safely adopt an additional top hierarchy level, preserving all existing node identifiers.
     * Firestore atomic commit ensures we never leave half-reparented structure data.
     */
    'POST /api/org/structure/design/expand': [
        orgRoute('org.structure.design.expand', 'ADM.structure', async (ctx) => {
            const current = designOf(ctx.org);
            if (!current.mode) throw new HttpError(400, 'Configure your initial organization design first.');
            if (current.names.length >= MAX_UPPER_LEVELS) throw new HttpError(400, 'Maximum number of upper levels reached.');
            const name = text(ctx.body, 'name', 2, 40, 'Enter a name for the new top level.');
            if (current.names.some((n) => n.toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'An upper hierarchy level already has this name.');
            const segment = str(ctx.body.segment).trim().toUpperCase();
            if (!/^[A-Z]{2,6}$/.test(segment)) throw new HttpError(400, 'Enter 2 to 6 capital letters for the new top-level code.');
            const id = `G_${segment}`;
            const [nodes, positions] = await Promise.all([
                listDocs(col(ctx.orgId)),
                listDocs(`organizations/${ctx.orgId}/positions`),
            ]);
            if (nodes.some((n) => n.id === id || str(n.data.code) === segment)) throw new HttpError(409, 'That upper level code already exists.');
            // Write everything, including the new parent, in one atomic Firestore commit.
            const now = nowIso();
            const root = nodes.filter((n) => str(n.data.parentId) === 'root');
            const groups = nodes.filter((n) => str(n.data.level) === 'group');
            const upperRoles = positions.filter((p) => /^upper:\d+$/.test(str(p.data.operatingLevel)));
            if (!root.length) throw new HttpError(400, 'Create your first legal entity or upper unit before expanding.');
            if (groups.some((n) => Number(n.data.tier) + 1 >= MAX_UPPER_LEVELS)) throw new HttpError(400, 'Current upper levels exceed the supported depth.');
            const writes: Array<Record<string, unknown>> = [];
            const patch = (path: string, fields: Record<string, unknown>) => writes.push({
                update: { name: `${DOCUMENT_NAME_ROOT}/${path}`, fields: encodeFields(fields) },
                updateMask: { fieldPaths: Object.keys(fields) },
            });
            writes.push({
                update: {
                    name: `${DOCUMENT_NAME_ROOT}/${col(ctx.orgId)}/${id}`,
                    fields: encodeFields({
                        level: 'group', tier: 0, parentId: 'root', segment, code: segment,
                        name: text(ctx.body, 'unitName', 2, 120, 'Enter a name for the new top-level unit.'),
                        description: '', status: 'active', managerRoleCode: '', managerRoleTitle: '',
                        roleCodes: [], attributes: {}, createdAt: now, createdBy: ctx.uid, updatedAt: now,
                    }),
                },
                currentDocument: { exists: false },
            });
            const rootedIds = new Set(root.map((n) => n.id));
            for (const n of nodes) {
                const isRoot = rootedIds.has(n.id);
                const isGroup = str(n.data.level) === 'group';
                if (!isRoot && !isGroup) continue;
                patch(`${col(ctx.orgId)}/${n.id}`, {
                    ...(isRoot ? { parentId: id } : {}),
                    ...(isGroup ? { tier: Number(n.data.tier) + 1 } : {}),
                    updatedAt: now,
                });
            }
            for (const p of upperRoles) {
                const currentTier = Number(str(p.data.operatingLevel).slice(6));
                patch(`organizations/${ctx.orgId}/positions/${p.id}`, { operatingLevel: `upper:${currentTier + 1}`, updatedAt: now });
            }
            patch(`organizations/${ctx.orgId}`, { designLevels: { mode: 'multi', names: [name, ...current.names], updatedAt: now, updatedBy: ctx.actor.email } });
            if (writes.length > 450) throw new HttpError(400, 'This organization has too many hierarchy records for a safe single-step expansion. Ask support for a controlled migration.');
            const res = await googleRequest(`https://firestore.googleapis.com/v1/${DOCUMENT_NAME_ROOT}:commit`, 'POST', { writes });
            if (!res.ok) {
                console.error('Hierarchy migration transaction failed', res.status);
                throw new HttpError(409, 'Could not add the upper level atomically; no changes were applied. Check the unit code and try again.');
            }
            await record(ctx, 'org.structure.design.expand', name, `Added ${id} above ${root.length} top units and remapped ${upperRoles.length} job roles`);
            return { id, name, mode: 'multi', updatedNodes: root.length + groups.length };
        }),
    ],

    'POST /api/org/structure/create': [
        orgRoute('org.structure.create', 'ADM.structure', async (ctx) => {
            const { body } = ctx;
            const level = str(body.level);
            const def = LEVELS[level];
            if (!def) throw new HttpError(400, 'Unknown level.');
            if (def.legacy) throw new HttpError(400, 'Equipment is now set up as an equipment unit directly under the cost center.');
            const design = designOf(ctx.org);
            const count = design.names.length;
            const parentId = str(body.parentId) || 'root';
            let parent: Doc | null = null;
            let parentLevel = 'root';
            let parentTier = -1;
            if (parentId !== 'root') {
                parent = await getNode(ctx, parentId);
                parentLevel = str(parent.data.level);
                parentTier = typeof parent.data.tier === 'number' ? parent.data.tier : 0;
            }
            let tier = 0;
            if (level === 'group') {
                if (design.mode === 'single' || !count) throw new HttpError(400, 'Declare the levels above your legal entities first.');
                if (parentLevel !== 'root' && parentLevel !== 'group') throw new HttpError(400, 'Upper level units can only sit above legal entities.');
                tier = parentLevel === 'root' ? 0 : parentTier + 1;
                if (tier >= count) throw new HttpError(400, `Only legal entities can be added under ${levelName(design.names, count - 1)}.`);
            } else if (level === 'legal_entity') {
                if (!design.mode) throw new HttpError(400, 'First tell us whether your organization has one or several legal entities.');
                const ok = count === 0 ? parentLevel === 'root' : parentLevel === 'group' && parentTier === count - 1;
                if (!ok) throw new HttpError(400, count === 0 ? 'Legal entities sit at the top of your organization.' : `Legal entities must be added under a ${levelName(design.names, count - 1)}.`);
                if (design.mode === 'single' && (await childrenOf(ctx.orgId, 'root')).some((n) => n.level === 'legal_entity')) {
                    throw new HttpError(400, 'Your organization is set up with one legal entity. Change the design type to add more.');
                }
            } else if (!def.parents.includes(parentLevel)) {
                throw new HttpError(400, `A ${def.label.toLowerCase()} cannot be added here.`);
            }
            const name = text(body, 'name', 2, 120, 'Enter a name (2 to 120 characters).');
            const description = text(body, 'description', 0, 300, 'Description can be up to 300 characters.');
            const manager = await readManagerRole(ctx, body.managerRoleCode, level, parentId, '', level === 'cost_center');
            const attributes = await readAttributes(level, body.attributes);
            let unitClass: { code: string; name: string } | null = null;
            if (level === 'work_center') {
                delete attributes.assetTag;
                unitClass = await readUnitClass(ctx, str(attributes.equipmentClass), true);
                if (unitClass) attributes.equipmentClassName = unitClass.name;
            }
            const now = nowIso();

            let segment = str(body.segment).trim().toUpperCase();
            let next = 0;
            if (def.auto) {
                const siblings = (await childrenOf(ctx.orgId, parentId)).filter((n) => n.level === level);
                next = siblings.reduce((m, n) => Math.max(m, Number(n.segment) || 0), 0) + 1;
            } else if (!def.pattern.test(segment)) {
                throw new HttpError(400, level === 'group' ? 'The code must be 2 to 6 capital letters.' : 'The code must be exactly 3 capital letters.');
            }
            for (let attempt = 0; attempt < 4; attempt++) {
                if (def.auto) {
                    if (String(next).length > def.auto) throw new HttpError(400, `No more ${def.label.toLowerCase()} codes are available under this parent.`);
                    segment = String(next).padStart(def.auto, '0');
                }
                const code = level === 'group' || level === 'legal_entity' ? segment : `${str(parent?.data.code)}-${segment}`;
                const id = level === 'group' ? `G_${segment}` : code;
                const created = await writeDoc(
                    `${col(ctx.orgId)}/${id}`,
                    { level, tier, parentId, segment, code, name, description, status: 'active', ...manager, attributes, roleCodes: level === 'site' && manager.managerRoleCode ? [manager.managerRoleCode] : [], createdAt: now, createdBy: ctx.uid, updatedAt: now },
                    { exists: false }
                );
                if (created) {
                    if (level === 'work_center' && unitClass) {
                        const existingAssetTag = str(body.existingAssetTag);
                        try {
                            if (existingAssetTag === '__UNASSIGNED__') {
                                // The equipment exists independently until an authorized user
                                // creates or adopts its single asset.
                            } else if (existingAssetTag) {
                                if (!hasPerm(ctx.permissions, 'AST.create')) throw new HttpError(403, 'Asset Management create permission is required to assign an existing asset.');
                                if (!/^AST-\d{6}$/.test(existingAssetTag)) throw new HttpError(400, 'Choose an eligible unassigned asset from the list.');
                                await linkWorkCenterAsset(ctx, { id, code, parentId }, '', existingAssetTag);
                            } else {
                                await createUnitAsset(ctx, { id, code, name }, unitClass.code);
                            }
                        } catch (e) {
                            // Creation must not leave equipment without its intended 1:1 asset.
                            await deleteDoc(`${col(ctx.orgId)}/${id}`);
                            throw e;
                        }
                    }
                    const label = level === 'group' ? levelName(design.names, tier) : def.label;
                    await record(ctx, 'org.structure.create', `${label} ${code}`, name);
                    return { id };
                }
                if (!def.auto) throw new HttpError(409, `The code ${code} is already used.`);
                next++;
            }
            throw new HttpError(409, 'Could not assign a code. Please try again.');
        }),
    ],

    'POST /api/org/structure/update': [
        orgRoute('org.structure.update', 'ADM.structure', async (ctx) => {
            const doc = await getNode(ctx, str(ctx.body.id));
            const level = str(doc.data.level);
            const name = text(ctx.body, 'name', 2, 120, 'Enter a name (2 to 120 characters).');
            const description = text(ctx.body, 'description', 0, 300, 'Description can be up to 300 characters.');
            const status = str(ctx.body.status) === 'inactive' ? 'inactive' : 'active';
            const manager = await readManagerRole(ctx, ctx.body.managerRoleCode, level, str(doc.data.parentId), doc.id, level === 'cost_center');
            const attributes = await readAttributes(level, ctx.body.attributes);
            if (level === 'cost_center' && !['INV', 'WHS'].includes(str(attributes.costType)) && (await getDoc(`organizations/${ctx.orgId}/warehouses/${doc.id}`))) {
                throw new HttpError(400, 'This cost center has a storage setup, so its type must stay Inventory (INV) or Warehousing (WHS).');
            }
            let createClass = '';
            if (level === 'work_center') {
                // The asset link is managed from the unit's asset page; keep it exactly as stored.
                const before = isObj(doc.data.attributes) ? doc.data.attributes : {};
                const previousTag = str(before.assetTag);
                if (previousTag) {
                    attributes.assetTag = previousTag;
                    attributes.assetTagName = str(before.assetTagName);
                } else {
                    delete attributes.assetTag;
                }
                const newClass = str(attributes.equipmentClass);
                if (previousTag && newClass !== str(before.equipmentClass) && (newClass || str(before.equipmentClass))) {
                    throw new HttpError(400, 'The equipment class is fixed once the unit has its asset. Delete the draft asset (or dispose the approved one) to change it.');
                }
                const unitClass = await readUnitClass(ctx, newClass, !previousTag);
                if (unitClass) attributes.equipmentClassName = unitClass.name;
                if (unitClass && !previousTag) createClass = unitClass.code;
            }
            await updateFields(`${col(ctx.orgId)}/${doc.id}`, { name, description, status, ...manager, attributes, updatedAt: nowIso(), updatedBy: ctx.uid });
            if (createClass) await createUnitAsset(ctx, { id: doc.id, code: str(doc.data.code), name }, createClass);
            await record(ctx, 'org.structure.update', `${LEVELS[level]?.label ?? level} ${str(doc.data.code)}`, name);
            return { ok: true };
        }),
    ],

    'POST /api/org/structure/delete': [
        orgRoute('org.structure.delete', 'ADM.structure', async (ctx) => {
            const doc = await getNode(ctx, str(ctx.body.id));
            if ((await childrenOf(ctx.orgId, doc.id)).length) throw new HttpError(400, 'Remove everything under it first.');
            if (str(doc.data.level) === 'cost_center' && (await getDoc(`organizations/${ctx.orgId}/warehouses/${doc.id}`))) {
                throw new HttpError(400, 'This cost center has a storage setup and cannot be deleted. Make it inactive instead.');
            }
            if (str(doc.data.level) === 'assembly' && (await bomsOf(ctx.orgId, doc.id)).length) throw new HttpError(400, 'Delete its bills of materials first.');
            if (str(doc.data.level) === 'work_center') await releaseUnitAsset(ctx, doc);
            await deleteDoc(`${col(ctx.orgId)}/${doc.id}`);
            await record(ctx, 'org.structure.delete', `${LEVELS[str(doc.data.level)]?.label ?? ''} ${str(doc.data.code)}`, str(doc.data.name));
            return { ok: true };
        }),
    ],

    'POST /api/org/bom/save': [
        orgRoute('org.bom.save', 'ADM.structure', async (ctx) => {
            const assembly = await getNode(ctx, str(ctx.body.assemblyId));
            if (str(assembly.data.level) !== 'assembly') throw new HttpError(400, 'Bills of materials belong to an assembly.');
            const name = text(ctx.body, 'name', 2, 80, 'Enter a name (2 to 80 characters).');
            const statusRaw = str(ctx.body.status);
            const status = ['draft', 'active', 'obsolete'].includes(statusRaw) ? statusRaw : 'draft';
            const rawLines = Array.isArray(ctx.body.lines) ? ctx.body.lines : [];
            if (rawLines.length > 200) throw new HttpError(400, 'A bill of materials can have up to 200 lines.');
            const lines = rawLines.filter(isObj).map((l, i) => {
                const line = l as Record<string, unknown>;
                const component = str(line.component).trim();
                const quantity = Number(line.quantity);
                const unit = str(line.unit).trim();
                if (!component || component.length > 40) throw new HttpError(400, `Line ${i + 1}: enter a component code (up to 40 characters).`);
                if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9) throw new HttpError(400, `Line ${i + 1}: enter a quantity above zero.`);
                if (!unit || unit.length > 12) throw new HttpError(400, `Line ${i + 1}: enter a unit (up to 12 characters).`);
                return { component, description: str(line.description).trim().slice(0, 120), quantity, unit };
            });
            if (!lines.length) throw new HttpError(400, 'Add at least one component line.');
            const now = nowIso();
            const bomId = str(ctx.body.bomId);
            if (bomId) {
                const existing = ID_RE.test(bomId) ? await getDoc(`${bomCol(ctx.orgId)}/${bomId}`) : null;
                if (!existing || str(existing.data.assemblyId) !== assembly.id) throw new HttpError(404, 'Bill of materials not found.');
                await updateFields(`${bomCol(ctx.orgId)}/${bomId}`, { name, status, lines, updatedAt: now, updatedBy: ctx.uid });
                await record(ctx, 'org.bom.save', `${name} (BOM v${num(existing.data.version) ?? 1} of ${str(assembly.data.code)})`, `${lines.length} lines, ${status}`);
                return { id: bomId };
            }
            const boms = await bomsOf(ctx.orgId, assembly.id);
            const version = boms.reduce((m, b) => Math.max(m, b.version), 0) + 1;
            if (version > 99) throw new HttpError(400, 'This assembly already has 99 bills of materials.');
            // Bills of materials are not codified: they are identified by assembly and version, and their
            // component lines will come from inventory items.
            const id = `BOM_${randomId(8)}`;
            if (!(await writeDoc(`${bomCol(ctx.orgId)}/${id}`, { assemblyId: assembly.id, code: '', version, name, status, lines, createdAt: now, createdBy: ctx.uid, updatedAt: now }, { exists: false }))) {
                throw new HttpError(409, 'Please try again.');
            }
            await record(ctx, 'org.bom.save', `${name} (BOM v${version} of ${str(assembly.data.code)})`, `${lines.length} lines, ${status}`);
            return { id };
        }),
    ],

    'POST /api/org/bom/delete': [
        orgRoute('org.bom.delete', 'ADM.structure', async (ctx) => {
            const id = str(ctx.body.id);
            const doc = ID_RE.test(id) ? await getDoc(`${bomCol(ctx.orgId)}/${id}`) : null;
            if (!doc) throw new HttpError(404, 'Bill of materials not found.');
            await deleteDoc(`${bomCol(ctx.orgId)}/${id}`);
            await record(ctx, 'org.bom.delete', `${str(doc.data.name)} (BOM v${num(doc.data.version) ?? 1})`, str(doc.data.code));
            return { ok: true };
        }),
    ],

    'POST /api/org/settings/get': [
        orgRoute('org.settings.get', 'ADM.settings', async (ctx) => ({ settings: isObj(ctx.org.data.settings) ? ctx.org.data.settings : {} })),
    ],

    'POST /api/org/settings/save': [
        orgRoute('org.settings.save', 'ADM.settings', async (ctx) => {
            const refs = await refSets();
            const b = (isObj(ctx.body.settings) ? ctx.body.settings : {}) as Record<string, unknown>;
            const pick = (key: string, allowed: Set<string>, label: string) => {
                const v = str(b[key]);
                if (!allowed.has(v)) throw new HttpError(400, `Choose a ${label} from the list.`);
                return v;
            };
            const settings = {
                dateFormat: pick('dateFormat', refs.codes('dateFormats'), 'date format'),
                fiscalYearStart: pick('fiscalYearStart', refs.codes('fiscalYearStart'), 'financial year start'),
                language: pick('language', refs.codes('languages'), 'language'),
                timezone: pick('timezone', refs.timezones, 'time zone'),
                weekStart: pick('weekStart', new Set(['monday', 'sunday', 'saturday']), 'first day of the week'),
                updatedAt: nowIso(),
                updatedBy: ctx.actor.email,
            };
            await updateFields(`organizations/${ctx.orgId}`, { settings });
            await record(ctx, 'org.settings.update', 'Organization settings', `${settings.timezone} · ${settings.dateFormat}`);
            return { settings };
        }),
    ],

    'POST /api/profile/photo': [
        secure('profile.photo', async (ctx) => {
            const me = await getDoc(`users/${ctx.uid}`);
            if (!me) throw new HttpError(404, 'Profile not found.');
            await rateLimit('profile-photo', ctx.uid, 20, 3600);
            const data = str(ctx.body.data);
            if (!data || data.length > 2_200_000 || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new HttpError(400, 'The photo must be a JPEG or PNG image under 1.5 MB.');
            const buf = Buffer.from(data, 'base64');
            if (!buf.length || buf.length > 1_600_000) throw new HttpError(400, 'The photo must be under 1.5 MB.');
            const detected = detectImage(buf);
            if (!detected) throw new HttpError(400, 'The photo must be a JPEG or PNG image.');
            const path = `users/${ctx.uid}/photo_${randomId(6)}.${detected.ext}`;
            const [ok] = await storage.write([{ path, content: data, contentType: detected.contentType }]);
            if (!ok) throw new HttpError(502, 'The photo could not be stored. Please try again.');
            const previous = str(me.data.photoPath);
            if (previous.startsWith(`users/${ctx.uid}/`)) await storage.delete([previous]);
            await updateFields(`users/${ctx.uid}`, { photoPath: path, photoUpdatedAt: nowIso() });
            await audit([{ category: 'data', action: 'profile.photo', actor: ctx.actor, meta: ctx.meta, orgId: str(me.data.orgId), target: { type: 'account', label: ctx.actor.email } }]);
            return { photoUrl: await signedUrl(path) };
        }),
    ],

    'POST /api/me/activity': [
        secure('me.activity', async (ctx) => {
            const docs = await runQuery({ from: [{ collectionId: 'activity' }], orderBy: orderDesc('at'), limit: 200 }, `users/${ctx.uid}`);
            return { events: docs.map(auditOut) };
        }),
    ],
};
