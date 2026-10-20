import { createHash } from 'crypto';
import {MATERIAL_STOCK_DIMENSIONS,UNIVERSAL_STOCK_METADATA,STOCK_META_BY_KEY,stockedPolicyToMrp} from './stockPolicyConfig';
import { HttpError, deleteDoc, getDoc, isObj, listDocs, nowIso, num, str, writeDoc, type Obj, type Plain } from './core';
import { audit } from './audit';
import { allowedNodeIds } from './positions';
import { audited, requireAt } from './scopeGuard';
import { hasPerm, orgRoute, staff, type OrgContext, type SecureContext } from './guards';

// ---------------------------------------------------------------------------
// Material approval delegation: validated on save, dated, audited. Undated or malformed entries grant nothing.
// One person may decide at most one level of the same approval.
// ---------------------------------------------------------------------------
const DELEGATION_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DELEGATION_DAYS = 90;
type MaterialDelegation = { role: string; uid: string; start: string; end: string };

/** True only for a complete delegation of `role` to `uid` that is in force today. */
function activeDelegation(list: unknown, role: string, uid: string): boolean {
    if (!Array.isArray(list) || !role || !uid) return false;
    const today = nowIso().slice(0, 10);
    return list.some((x) => isObj(x) && str(x.role) === role && str(x.uid) === uid
        && DELEGATION_DATE.test(str(x.start)) && DELEGATION_DATE.test(str(x.end))
        && str(x.start) <= today && str(x.end) >= today);
}

/** True when `uid` already approved an earlier level of this record. */
function approvedEarlierLevel(history: unknown, uid: string): boolean {
    return Array.isArray(history) && history.some((h) => isObj(h) && str(h.by) === uid && str(h.decision) === 'approve');
}

/** Checks every delegation before it is stored: existing job role, active colleague, not yourself, dated, at most 90 days. */
async function validMaterialDelegations(ctx: OrgContext, raw: unknown): Promise<MaterialDelegation[]> {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new HttpError(400, 'Delegations must be a list.');
    if (raw.length > 20) throw new HttpError(400, 'Up to 20 delegations are allowed.');
    if (!raw.length) return [];
    const positions = new Set((await listDocs('organizations/' + ctx.orgId + '/positions')).map((d) => d.id));
    const today = nowIso().slice(0, 10);
    const seen = new Set<string>();
    const out: MaterialDelegation[] = [];
    for (const item of raw) {
        if (!isObj(item)) throw new HttpError(400, 'Each delegation needs a job role, an employee and start and end dates.');
        const role = str(item.role), uid = str(item.uid), start = str(item.start), end = str(item.end);
        if (!positions.has(role)) throw new HttpError(400, 'Choose the delegated job role from the list.');
        if (!/^[A-Za-z0-9]{6,128}$/.test(uid)) throw new HttpError(400, 'Choose the employee who receives the delegation.');
        if (uid === ctx.uid) throw new HttpError(403, 'You cannot delegate approval authority to yourself.');
        const person = await getDoc('users/' + uid);
        if (!person || str(person.data.orgId) !== ctx.orgId || str(person.data.status) === 'disabled')
            throw new HttpError(400, 'The delegate must be an active employee of your organization.');
        if (!DELEGATION_DATE.test(start) || !DELEGATION_DATE.test(end) || Number.isNaN(Date.parse(start + 'T00:00:00Z')) || Number.isNaN(Date.parse(end + 'T00:00:00Z')))
            throw new HttpError(400, 'Every delegation needs a valid start and end date.');
        if (end < start) throw new HttpError(400, 'A delegation cannot end before it starts.');
        if (end < today) throw new HttpError(400, 'A delegation cannot end in the past.');
        if ((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000 > MAX_DELEGATION_DAYS)
            throw new HttpError(400, 'A delegation can last at most ' + MAX_DELEGATION_DAYS + ' days.');
        const key = role + '|' + uid;
        if (seen.has(key)) throw new HttpError(400, 'Each job role can be delegated to the same person only once.');
        seen.add(key);
        out.push({ role, uid, start, end });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Module master data catalogs (module lists)
//
// MEMS-wide reference catalogs kept in the database, one per kind:
//   materials    PRC  MEMS Universal Material Master Catalog (MEMS-UMMC)
//   services     PRC  MEMS Universal Service Master Catalog  (MEMS-USMC)
//   gl_accounts  FIN  MEMS Universal General Ledger Account Master (MEMS-UGLAM)
//
//   module_workspaces/{module}/catalogs/{kind}                     catalog record (file name, checksum, stats, header)
//   module_workspaces/{module}/catalogs/{kind}/parts/{section}_{i} sections stored as JSON text (< 700 KB each)
//   module_workspaces/{module}/catalog_staging/{kind}/upload/{nnn} raw upload chunks, deleted after processing
//
// Every catalog has four levels (level 1 > level 2 > level 3 > item) plus a reusable attribute library and profiles.
// Each file uses its own section names (e.g. accountClasses / accounts); they are stored under generic names.
// MEMS admins upload a file; it is checked (structure, codes, references, SHA-256 checksum) and replaces the
// catalog straight away. Organizations with the module enabled read it. Uploads, rejections and downloads are audited.
// ---------------------------------------------------------------------------

type Kind = 'materials' | 'services' | 'gl_accounts';

interface KindDef {
    module: 'PRC' | 'FIN';
    area: 'procurement' | 'finance';
    label: string;
    item: string;
    levels: [string, string, string];
    keys: { l1: string; l2: string; l3: string; items: string };
    parent: { l2: string; l3: string; item: string };
    itemL1: string;
    itemL2: string;
    perms: string[];
    extra: string[];
}

const KINDS: Record<Kind, KindDef> = {
    materials: {
        module: 'PRC',
        area: 'procurement',
        label: 'Materials Master',
        item: 'Material',
        levels: ['Category', 'Subcategory', 'Family'],
        keys: { l1: 'categories', l2: 'subcategories', l3: 'families', items: 'materials' },
        parent: { l2: 'categoryCode', l3: 'subcategoryCode', item: 'familyCode' },
        itemL1: 'categoryCode',
        itemL2: 'subcategoryCode',
        perms: ['PRC.view', 'INV.view', 'ADM.structure'],
        extra: [],
    },
    services: {
        module: 'PRC',
        area: 'procurement',
        label: 'Service catalog',
        item: 'Service',
        levels: ['Category', 'Subcategory', 'Family'],
        keys: { l1: 'categories', l2: 'subcategories', l3: 'families', items: 'services' },
        parent: { l2: 'categoryCode', l3: 'subcategoryCode', item: 'familyCode' },
        itemL1: 'categoryCode',
        itemL2: 'subcategoryCode',
        perms: ['PRC.view', 'INV.view', 'ADM.structure'],
        extra: [],
    },
    gl_accounts: {
        module: 'FIN',
        area: 'finance',
        label: 'GL account master',
        item: 'GL account',
        levels: ['Account class', 'Account category', 'Account group'],
        keys: { l1: 'accountClasses', l2: 'accountCategories', l3: 'accountGroups', items: 'accounts' },
        parent: { l2: 'classCode', l3: 'categoryCode', item: 'groupCode' },
        itemL1: 'classCode',
        itemL2: 'categoryCode',
        perms: ['FIN.view', 'ADM.structure'],
        extra: ['normalBalance', 'accountRole', 'accountType', 'postingMode'],
    },
};

// Internal section names (kept for catalogs already stored).
const SECTIONS = ['attributeDomains', 'attributes', 'profiles', 'categories', 'subcategories', 'families', 'items'] as const;
type Section = (typeof SECTIONS)[number];
const DATA_TYPES = ['text', 'integer', 'decimal', 'boolean', 'date', 'enum', 'multi_select', 'country', 'currency', 'file'];
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._ /-]{0,59}$/;
const MAX_UPLOAD_BYTES = 12_000_000;
const MAX_CHUNKS = 60;
const PART_BYTES = 700_000;

const base = (kind: Kind) => `module_workspaces/${KINDS[kind].module}/catalogs/${kind}`;
const staging = (kind: Kind) => `module_workspaces/${KINDS[kind].module}/catalog_staging/${kind}`;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

function kindOf(v: unknown, allowed: Kind[]): Kind {
    const k = str(v) as Kind;
    if (!allowed.includes(k)) throw new HttpError(400, 'Choose a catalog.');
    return k;
}

function rec(ctx: SecureContext, action: string, target: string, details = '') {
    return audit([{ category: 'admin', action, actor: ctx.actor, meta: ctx.meta, target: { label: target }, details, orgId: '' }]);
}

// ----- Validation -----

type Catalog = Record<Section, Obj[]> & { header: Obj };

function validate(kind: Kind, raw: unknown) {
    const def = KINDS[kind];
    const errors: string[] = [];
    const warnings: string[] = [];
    const err = (m: string) => {
        if (errors.length < 60) errors.push(m);
    };
    if (!isObj(raw)) throw new HttpError(400, 'The file is not a catalog object.');
    const declared = str(raw.catalogType);
    if (declared && declared !== kind) {
        const other = KINDS[declared as Kind]?.label ?? declared;
        err(`This file is a ${other} file. Upload it to the ${other} instead.`);
    }
    const itemsKey = Array.isArray(raw[def.keys.items]) ? def.keys.items : Array.isArray(raw.items) ? 'items' : def.keys.items;
    const cat: Catalog = {
        header: {},
        attributeDomains: arr(raw.attributeDomains),
        attributes: arr(raw.attributes),
        profiles: arr(raw.profiles),
        categories: arr(raw[def.keys.l1]),
        subcategories: arr(raw[def.keys.l2]),
        families: arr(raw[def.keys.l3]),
        items: arr(raw[itemsKey]),
    };
    const skip = new Set<string>(['attributeDomains', 'attributes', 'profiles', def.keys.l1, def.keys.l2, def.keys.l3, itemsKey]);
    for (const [k, v] of Object.entries(raw)) if (!skip.has(k)) cat.header[k] = v as Plain;

    const unique = (list: Obj[], label: string) => {
        const seen = new Set<string>();
        for (const item of list) {
            const code = str(item.code);
            if (!CODE_RE.test(code)) err(`${label}: invalid code "${code.slice(0, 40)}".`);
            else if (seen.has(code)) err(`${label}: duplicate code ${code}.`);
            seen.add(code);
            if (str(item.name).trim().length < 2) err(`${label} ${code}: name is missing.`);
            if (str(item.name).length > 200) err(`${label} ${code}: name is too long.`);
            if (str(item.description).length > 4000) err(`${label} ${code}: description is too long.`);
        }
        return seen;
    };
    const domains = unique(cat.attributeDomains, 'Attribute domain');
    const attrs = unique(cat.attributes, 'Attribute');
    for (const a of cat.attributes) {
        const code = str(a.code);
        if (domains.size && !domains.has(str(a.domain))) err(`Attribute ${code}: unknown domain ${str(a.domain)}.`);
        if (!DATA_TYPES.includes(str(a.dataType))) err(`Attribute ${code}: unknown data type ${str(a.dataType)}.`);
        if (str(a.dataType) === 'enum' || str(a.dataType) === 'multi_select') {
            const opts = arr(a.options);
            if (!opts.length) err(`Attribute ${code}: options are missing.`);
            if (new Set(opts.map((o) => str(o.code))).size !== opts.length) err(`Attribute ${code}: duplicate option codes.`);
        }
        const pattern = isObj(a.validation) ? str(a.validation.pattern) : '';
        if (pattern) {
            try {
                if (pattern.length > 200) throw new Error('long');
                new RegExp(pattern);
            } catch {
                err(`Attribute ${code}: invalid validation pattern.`);
            }
        }
    }
    const profiles = unique(cat.profiles, 'Profile');
    for (const p of cat.profiles) for (const a of arr(p.attributes)) if (!attrs.has(str(a.code))) err(`Profile ${str(p.code)}: unknown attribute ${str(a.code)}.`);
    const checkProfiles = (label: string, o: Obj) => {
        for (const p of strs(o.profiles)) if (!profiles.has(p)) err(`${label} ${str(o.code)}: unknown profile ${p}.`);
    };
    const [L1, L2, L3] = def.levels;
    const l1 = unique(cat.categories, L1);
    cat.categories.forEach((c) => checkProfiles(L1, c));
    const l2 = unique(cat.subcategories, L2);
    for (const s of cat.subcategories) {
        if (!l1.has(str(s[def.parent.l2]))) err(`${L2} ${str(s.code)}: unknown ${L1.toLowerCase()} ${str(s[def.parent.l2])}.`);
        checkProfiles(L2, s);
    }
    const l3 = unique(cat.families, L3);
    for (const f of cat.families) if (!l2.has(str(f[def.parent.l3]))) err(`${L3} ${str(f.code)}: unknown ${L2.toLowerCase()} ${str(f[def.parent.l3])}.`);
    unique(cat.items, def.item);
    for (const it of cat.items) {
        const code = str(it.code);
        if (!l3.has(str(it[def.parent.item]))) err(`${def.item} ${code}: unknown ${L3.toLowerCase()} ${str(it[def.parent.item])}.`);
        checkProfiles(def.item, it);
        const list = strs(it.attributes);
        for (const a of list) if (!attrs.has(a)) err(`${def.item} ${code}: unknown attribute ${a}.`);
        const listSet = new Set(list);
        for (const a of strs(it.requiredAttributes)) if (!listSet.has(a)) err(`${def.item} ${code}: required attribute ${a} is not in its attribute list.`);
        if (!list.length && warnings.length < 30) warnings.push(`${def.item} ${code} has no attributes.`);
    }
    if (!cat.items.length) err(`No ${def.keys.items} found in the file.`);
    if (!cat.attributes.length) err('No attributes found in the file.');
    const stats = {
        categories: cat.categories.length,
        subcategories: cat.subcategories.length,
        families: cat.families.length,
        items: cat.items.length,
        attributes: cat.attributes.length,
        profiles: cat.profiles.length,
        attributeDomains: cat.attributeDomains.length,
    };
    return { cat, errors, warnings, stats };
}

function splitParts(items: Obj[]): string[] {
    const parts: string[] = [];
    let current: string[] = [];
    let bytes = 2;
    for (const item of items) {
        const s = JSON.stringify(item);
        const b = Buffer.byteLength(s, 'utf8') + 1;
        if (b > PART_BYTES) throw new HttpError(400, `Entry ${str(item.code)} is too large.`);
        if (bytes + b > PART_BYTES && current.length) {
            parts.push(`[${current.join(',')}]`);
            current = [];
            bytes = 2;
        }
        current.push(s);
        bytes += b;
    }
    parts.push(`[${current.join(',')}]`);
    return parts;
}

// ----- Loading (cached per warm instance, refreshed when a new file is loaded) -----

interface Loaded {
    kind: Kind;
    stamp: string;
    version: string;
    header: Obj;
    domains: Obj[];
    attributes: Map<string, Obj>;
    profiles: Map<string, Obj>;
    categories: Obj[];
    subcategories: Obj[];
    families: Obj[];
    items: Map<string, Obj>;
}

const cache = new Map<Kind, Loaded>();

async function load(kind: Kind): Promise<Loaded> {
    const doc = await getDoc(base(kind));
    if (!doc || str(doc.data.status) !== 'active') throw new HttpError(404, `The ${KINDS[kind].label.toLowerCase()} has not been loaded by MEMS yet.`);
    const stamp = `${str(doc.data.loadedAt)}|${str(doc.data.sha256)}`;
    const hit = cache.get(kind);
    if (hit && hit.stamp === stamp) return hit;
    const counts = isObj(doc.data.sections) ? doc.data.sections : {};
    const read = async (section: Section): Promise<Obj[]> => {
        const n = num(counts[section]) ?? 0;
        const docs = await Promise.all(Array.from({ length: n }, (_, i) => getDoc(`${base(kind)}/parts/${section}_${i}`)));
        return docs.flatMap((d) => {
            try {
                return arr(JSON.parse(str(d?.data.json) || '[]'));
            } catch {
                return [];
            }
        });
    };
    const [domains, attributes, profiles, categories, subcategories, families, items] = await Promise.all(SECTIONS.map(read));
    let header: Obj = {};
    try {
        header = JSON.parse(str(doc.data.headerJson) || '{}') as Obj;
    } catch {
        header = {};
    }
    const loaded: Loaded = {
        kind,
        stamp,
        version: str(doc.data.version),
        header,
        domains,
        attributes: new Map(attributes.map((a) => [str(a.code), a])),
        profiles: new Map(profiles.map((p) => [str(p.code), p])),
        categories,
        subcategories,
        families,
        items: new Map(items.map((c) => [str(c.code), c])),
    };
    cache.set(kind, loaded);
    return loaded;
}

// Shape used by the catalog browser (four levels mapped to group > category > subcategory > class).
function treeOut(d: Loaded) {
    const def = KINDS[d.kind];
    return {
        version: d.version,
        vid: d.kind,
        name: str(d.header.catalogName) || def.label,
        codingScheme: d.header.codingScheme ?? null,
        domains: d.domains.map((x) => ({ code: str(x.code), name: str(x.name) })),
        groups: d.categories.map((c) => ({ code: str(c.code), name: str(c.name), description: str(c.description), profiles: strs(c.profiles) })),
        categories: d.subcategories.map((s) => ({ code: str(s.code), groupCode: str(s[def.parent.l2]), name: str(s.name), description: str(s.description), profiles: strs(s.profiles), usefulLifeYears: null })),
        subcategories: d.families.map((f) => ({ code: str(f.code), categoryCode: str(f[def.parent.l3]), name: str(f.name), description: str(f.description), profiles: strs(f.profiles) })),
        classes: Array.from(d.items.values()).map((c) => ({
            code: str(c.code),
            subcategoryCode: str(c[def.parent.item]),
            categoryCode: str(c[def.itemL2]),
            groupCode: str(c[def.itemL1]),
            name: str(c.name),
            description: str(c.description),
            synonyms: strs(c.synonyms),
            attributeCount: strs(c.attributes).length,
            requiredCount: strs(c.requiredAttributes).length,
            usefulLifeYears: null,
            extra: Object.fromEntries(def.extra.map((k) => [k, str(c[k])])),
        })),
    };
}

function itemOut(d: Loaded, code: string) {
    const def = KINDS[d.kind];
    const c = d.items.get(code);
    if (!c) throw new HttpError(404, 'Not found in the catalog.');
    const required = new Set(strs(c.requiredAttributes));
    const specific = new Set(strs(c.specificAttributes));
    const domainName = new Map(d.domains.map((x) => [str(x.code), str(x.name)]));
    const props = isObj(c.properties) ? c.properties : {};
    return {
        code,
        name: str(c.name),
        description: str(c.description),
        groupCode: str(c[def.itemL1]),
        categoryCode: str(c[def.itemL2]),
        subcategoryCode: str(c[def.parent.item]),
        profiles: strs(c.profiles).map((p) => ({ code: p, name: str(d.profiles.get(p)?.name) })),
        synonyms: strs(c.synonyms),
        usefulLifeYears: null,
        legacyCodes: strs(c.legacyCodes),
        properties: Object.entries(props).map(([label, value]) => ({ label: label.slice(0, 80), value: str(value).slice(0, 400) })),
        attributes: strs(c.attributes)
            .map((a) => d.attributes.get(a))
            .filter((a): a is Obj => !!a)
            .map((a) => ({
                code: str(a.code),
                key: str(a.key),
                name: str(a.name),
                description: str(a.description),
                domain: str(a.domain),
                domainName: domainName.get(str(a.domain)) ?? str(a.domain),
                dataType: str(a.dataType),
                unit: str(a.unit),
                options: arr(a.options).map((o) => ({ code: str(o.code), label: str(o.label) })),
                validation: isObj(a.validation) ? a.validation : {},
                required: required.has(str(a.code)),
                specific: specific.has(str(a.code)),
            })),
    };
}

function exportOut(d: Loaded) {
    const def = KINDS[d.kind];
    return {
        ...d.header,
        attributeDomains: d.domains,
        attributes: Array.from(d.attributes.values()),
        profiles: Array.from(d.profiles.values()),
        [def.keys.l1]: d.categories,
        [def.keys.l2]: d.subcategories,
        [def.keys.l3]: d.families,
        [def.keys.items]: Array.from(d.items.values()),
    };
}

// ----- Organization access -----

function requireModule(ctx: OrgContext, kind: Kind) {
    const def = KINDS[kind];
    const map = isObj(ctx.org.data.modules) ? ctx.org.data.modules : {};
    const names: Record<string, string> = { PRC: 'Procurement (PRC)', FIN: 'Finance & Accounting (FIN)' };
    if (map[def.module] !== true) throw new HttpError(403, `${names[def.module]} is not enabled for your organization. Adopt and enable it under Modules.`);
    if (!def.perms.some((p) => hasPerm(ctx.permissions, p))) throw new HttpError(403, 'You do not have permission to do this.');
}

// ----- Routes -----

function catalogRoutes(area: 'procurement' | 'finance', allowed: Kind[]) {
    const first = allowed[0];
    const pick = (v: unknown) => kindOf(v ?? first, allowed);
    return {
        [`POST /api/admin/${area}/catalog/status`]: [
            staff(`admin.${area}.catalog.status`, 'read', async ({ body }) => {
                const kind = pick(body.kind);
                const doc = await getDoc(base(kind));
                const loaded = !!doc && str(doc.data.status) === 'active';
                return {
                    kind,
                    loaded,
                    version: str(doc?.data.version),
                    name: str(doc?.data.catalogName),
                    fileName: str(doc?.data.fileName),
                    loadedAt: str(doc?.data.loadedAt),
                    loadedBy: str(doc?.data.loadedBy),
                    size: num(doc?.data.size) ?? 0,
                    sha256: str(doc?.data.sha256),
                    stats: isObj(doc?.data.stats) ? doc?.data.stats : {},
                };
            }),
        ],

        [`POST /api/admin/${area}/catalog/begin`]: [
            staff(`admin.${area}.catalog.begin`, 'write', async (ctx) => {
                const kind = pick(ctx.body.kind);
                const size = Number(ctx.body.size);
                const totalChunks = Number(ctx.body.totalChunks);
                const sha256 = str(ctx.body.sha256);
                const fileName = str(ctx.body.fileName).replace(/[^\w .()-]/g, '').slice(0, 120);
                if (!Number.isInteger(size) || size < 100 || size > MAX_UPLOAD_BYTES) throw new HttpError(400, 'The file must be between 100 bytes and 12 MB.');
                if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS) throw new HttpError(400, 'Invalid number of parts.');
                if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(400, 'Invalid checksum.');
                for (const d of await listDocs(`${staging(kind)}/upload`)) await deleteDoc(`${staging(kind)}/upload/${d.id}`);
                await writeDoc(staging(kind), { status: 'uploading', size, sha256, totalChunks, fileName, uploadedBy: ctx.actor.email, createdAt: nowIso() });
                return { ok: true };
            }),
        ],

        [`POST /api/admin/${area}/catalog/chunk`]: [
            staff(`admin.${area}.catalog.chunk`, 'write', async (ctx) => {
                const kind = pick(ctx.body.kind);
                const index = Number(ctx.body.index);
                const data = str(ctx.body.data);
                const s = await getDoc(staging(kind));
                if (!s || str(s.data.status) !== 'uploading' || str(s.data.uploadedBy) !== ctx.actor.email) throw new HttpError(400, 'Start the upload again.');
                const total = num(s.data.totalChunks) ?? 0;
                if (!Number.isInteger(index) || index < 0 || index >= total) throw new HttpError(400, 'Invalid part number.');
                if (!data || Buffer.byteLength(data, 'utf8') > 900_000) throw new HttpError(400, 'Each part must be under 900 KB.');
                await writeDoc(`${staging(kind)}/upload/${String(index).padStart(3, '0')}`, { index, data });
                return { ok: true };
            }),
        ],

        [`POST /api/admin/${area}/catalog/finish`]: [
            staff(`admin.${area}.catalog.finish`, 'write', async (ctx) => {
                const kind = pick(ctx.body.kind);
                const def = KINDS[kind];
                const s = await getDoc(staging(kind));
                if (!s || str(s.data.status) !== 'uploading' || str(s.data.uploadedBy) !== ctx.actor.email) throw new HttpError(400, 'Start the upload again.');
                const total = num(s.data.totalChunks) ?? 0;
                const chunks = (await listDocs(`${staging(kind)}/upload`)).sort((a, b) => (num(a.data.index) ?? 0) - (num(b.data.index) ?? 0));
                const cleanup = async () => {
                    for (const c of chunks) await deleteDoc(`${staging(kind)}/upload/${c.id}`);
                    await deleteDoc(staging(kind));
                };
                const target = `${def.label}: ${str(s.data.fileName) || def.label}`;
                const reject = async (errors: string[], warnings: string[] = []) => {
                    await cleanup();
                    await rec(ctx, `${area}.catalog.rejected`, target, errors.slice(0, 3).join(' | '));
                    return { ok: false, errors, warnings, stats: {} };
                };
                if (chunks.length !== total || chunks.some((c, i) => num(c.data.index) !== i)) return reject(['Some parts of the file did not arrive. Upload it again.']);
                const textAll = chunks.map((c) => str(c.data.data)).join('');
                const bytes = Buffer.from(textAll, 'utf8');
                if (bytes.length !== num(s.data.size)) return reject([`The file arrived incomplete (${bytes.length} of ${num(s.data.size)} bytes). Upload it again.`]);
                if (createHash('sha256').update(bytes).digest('hex') !== str(s.data.sha256)) return reject(['The file was altered or corrupted during upload. Upload it again.']);
                let parsed: unknown;
                try {
                    parsed = JSON.parse(textAll);
                } catch {
                    return reject(['The file is not valid JSON.']);
                }
                const { cat, errors, warnings, stats } = validate(kind, parsed);
                if (errors.length) return reject(errors, warnings);
                const headerJson = JSON.stringify(cat.header);
                if (Buffer.byteLength(headerJson, 'utf8') > 300_000) return reject(['The catalog header is too large.']);
                const before = await listDocs(`${base(kind)}/parts`);
                const previous = await getDoc(base(kind));
                const written = new Set<string>();
                const sections: Record<string, number> = {};
                for (const section of SECTIONS) {
                    const parts = splitParts(cat[section]);
                    sections[section] = parts.length;
                    for (let i = 0; i < parts.length; i++) {
                        await writeDoc(`${base(kind)}/parts/${section}_${i}`, { section, index: i, json: parts[i] });
                        written.add(`${section}_${i}`);
                    }
                }
                for (const p of before) if (!written.has(p.id)) await deleteDoc(`${base(kind)}/parts/${p.id}`);
                const now = nowIso();
                await writeDoc(base(kind), {
                    kind,
                    module: def.module,
                    status: 'active',
                    version: str(cat.header.version).slice(0, 40),
                    catalogName: str(cat.header.catalogName).slice(0, 160),
                    catalogCode: str(cat.header.catalogCode).slice(0, 40),
                    fileName: str(s.data.fileName),
                    size: num(s.data.size) ?? 0,
                    sha256: str(s.data.sha256),
                    stats,
                    sections,
                    headerJson,
                    warnings,
                    loadedAt: now,
                    loadedBy: ctx.actor.email,
                    previousLoadedAt: str(previous?.data.loadedAt),
                    previousSha256: str(previous?.data.sha256),
                });
                cache.delete(kind);
                await cleanup();
                await rec(
                    ctx,
                    `${area}.catalog.loaded`,
                    target,
                    `${stats.items} ${def.keys.items}, ${stats.attributes} attributes, ${stats.profiles} profiles saved to the database${previous ? `, replacing the file loaded ${str(previous.data.loadedAt)} by ${str(previous.data.loadedBy)}` : ''}`
                );
                return { ok: true, errors: [], warnings, stats };
            }),
        ],

        [`POST /api/admin/${area}/catalog/export`]: [
            staff(`admin.${area}.catalog.export`, 'read', async (ctx) => {
                const kind = pick(ctx.body.kind);
                const d = await load(kind);
                await rec(ctx, `${area}.catalog.exported`, KINDS[kind].label, 'Downloaded');
                return exportOut(d);
            }),
        ],

        [`POST /api/admin/${area}/catalog/tree`]: [staff(`admin.${area}.catalog.tree`, 'read', async ({ body }) => treeOut(await load(pick(body.kind))))],

        [`POST /api/admin/${area}/catalog/item`]: [staff(`admin.${area}.catalog.item`, 'read', async ({ body }) => itemOut(await load(pick(body.kind)), str(body.code)))],

        [`POST /api/org/${area}/catalog/tree`]: [
            orgRoute(`org.${area}.catalog.tree`, null, async (ctx) => {
                const kind = pick(ctx.body.kind);
                requireModule(ctx, kind);
                return treeOut(await load(kind));
            }),
        ],

        [`POST /api/org/${area}/catalog/item`]: [
            orgRoute(`org.${area}.catalog.item`, null, async (ctx) => {
                const kind = pick(ctx.body.kind);
                requireModule(ctx, kind);
                const code = str(ctx.body.code);
                if (!CODE_RE.test(code)) throw new HttpError(400, 'Invalid code.');
                return itemOut(await load(kind), code);
            }),
        ],
    };
}

/** Material categories with their subcategories (storage locations for warehouses). Returns [] when not loaded. */
export async function materialCategories(): Promise<Array<{ code: string; name: string; subcategories: Array<{ code: string; name: string }> }>> {
    let d: Loaded;
    try {
        d = await load('materials');
    } catch {
        return [];
    }
    const def = KINDS.materials;
    return d.categories
        .map((c) => ({
            code: str(c.code),
            name: str(c.name),
            subcategories: d.subcategories
                .filter((s) => str(s[def.parent.l2]) === str(c.code))
                .map((s) => ({ code: str(s.code), name: str(s.name) }))
                .sort((a, b) => a.code.localeCompare(b.code)),
        }))
        .sort((a, b) => a.code.localeCompare(b.code));
}

/** Categories, subcategories and item list of a published master, for procurement setup and purchase requirements. Null when not loaded. */
export async function catalogSummary(kind: 'materials' | 'services' | 'gl_accounts'): Promise<{
    categories: Array<{ code: string; name: string; subcategories: Array<{ code: string; name: string }> }>;
    items: Array<{ code: string; name: string; categoryCode: string; subcategoryCode: string }>;
} | null> {
    let d: Loaded;
    try {
        d = await load(kind);
    } catch {
        return null;
    }
    const def = KINDS[kind];
    return {
        categories: d.categories
            .map((c) => ({
                code: str(c.code),
                name: str(c.name),
                subcategories: d.subcategories
                    .filter((s) => str(s[def.parent.l2]) === str(c.code))
                    .map((s) => ({ code: str(s.code), name: str(s.name) }))
                    .sort((a, b) => a.code.localeCompare(b.code)),
            }))
            .filter((c) => c.code)
            .sort((a, b) => a.code.localeCompare(b.code)),
        items: Array.from(d.items.values()).map((i) => ({ code: str(i.code), name: str(i.name), categoryCode: str(i[def.itemL1]), subcategoryCode: str(i[def.itemL2]) })),
    };
}

/** The GL account master for finance: every level and every active account with all of its parameters. Null when not loaded. */
export async function glMaster(): Promise<{ version: string; classes: Obj[]; categories: Obj[]; groups: Obj[]; accounts: Obj[] } | null> {
    let d: Loaded;
    try {
        d = await load('gl_accounts');
    } catch {
        return null;
    }
    const def = KINDS.gl_accounts;
    const cls = new Map(d.categories.map((c) => [str(c.code), str(c.name)]));
    const cat = new Map(d.subcategories.map((c) => [str(c.code), str(c.name)]));
    const grp = new Map(d.families.map((c) => [str(c.code), str(c.name)]));
    const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
    return {
        version: d.version,
        classes: d.categories.map((c) => ({ code: str(c.code), name: str(c.name), description: str(c.description) })),
        categories: d.subcategories.map((s) => ({ code: str(s.code), name: str(s.name), description: str(s.description), classCode: str(s[def.parent.l2]) })),
        groups: d.families.map((f) => ({ code: str(f.code), name: str(f.name), description: str(f.description), categoryCode: str(f[def.parent.l3]) })),
        accounts: Array.from(d.items.values())
            .filter((i) => i.active !== false && !/^(inactive|retired|deprecated|closed|blocked)$/i.test(str(i.status)))
            .map((i) => {
                const classCode = str(i[def.itemL1]);
                const categoryCode = str(i[def.itemL2]);
                const groupCode = str(i[def.parent.item]);
                const props = isObj(i.properties) ? i.properties : {};
                const params = [...Object.entries(i).filter(([, v]) => scalar(v)).map(([k, v]) => ({ key: k, value: String(v) })), ...Object.entries(props).filter(([, v]) => scalar(v)).map(([k, v]) => ({ key: k, value: String(v) }))].slice(0, 80);
                return { code: str(i.code), name: str(i.name), description: str(i.description), classCode, className: cls.get(classCode) ?? '', categoryCode, categoryName: cat.get(categoryCode) ?? '', groupCode, groupName: grp.get(groupCode) ?? '', normalBalance: str(i.normalBalance), accountRole: str(i.accountRole), accountType: str(i.accountType), postingMode: str(i.postingMode), params };
            }),
    };
}

/** One GL master account with all its parameters and attributes. */
export async function glMasterItem(code: string) {
    return itemOut(await load('gl_accounts'), code);
}

export interface AttrSpec {
    code: string;
    name: string;
    dataType: string;
    unit: string;
    options: Array<{ code: string; label: string }>;
    validation: Record<string, unknown>;
    required: boolean;
}
export interface ItemSpec {
    code: string;
    name: string;
    categoryCode: string;
    subcategoryCode: string;
    familyCode: string;
    attributes: AttrSpec[];
}
export interface TreeOut {
    families: Array<{ code: string; name: string }>;
    items: Array<{ code: string; name: string; familyCode: string }>;
}

/** Families and entries under one category and subcategory, for the purchase requirement dropdowns. Null when the catalog is not loaded. */
export async function catalogTree(kind: 'materials' | 'services', categoryCode: string, subcategoryCode: string): Promise<TreeOut | null> {
    let d: Loaded;
    try {
        d = await load(kind);
    } catch {
        return null;
    }
    const def = KINDS[kind];
    const families = d.families
        .filter((f) => str(f[def.parent.l3]) === subcategoryCode)
        .map((f) => ({ code: str(f.code), name: str(f.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const items: Array<{ code: string; name: string; familyCode: string }> = [];
    for (const c of d.items.values()) {
        if (str(c[def.itemL1]) === categoryCode && str(c[def.itemL2]) === subcategoryCode) items.push({ code: str(c.code), name: str(c.name), familyCode: str(c[def.parent.item]) });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return { families, items: items.slice(0, 1500) };
}

/** The technical attributes of one catalog entry (mandatory ones flagged). Null when the catalog or the entry is missing. */
export async function catalogItemSpec(kind: 'materials' | 'services', code: string): Promise<ItemSpec | null> {
    let d: Loaded;
    try {
        d = await load(kind);
    } catch {
        return null;
    }
    if (!d.items.has(code)) return null;
    const o = itemOut(d, code);
    return {
        code: o.code,
        name: o.name,
        categoryCode: o.groupCode,
        subcategoryCode: o.categoryCode,
        familyCode: o.subcategoryCode,
        attributes: o.attributes
            .filter((a) => a.dataType !== 'file')
            .map((a) => ({ code: a.code, name: a.name, dataType: a.dataType, unit: a.unit, options: a.options, validation: a.validation as Record<string, unknown>, required: a.required })),
    };
}

/** Catalog lookup used by maintenance planning (spares and services). Returns [] when the catalog is not loaded. */
/** Read-only hierarchy used by maintenance assessors; no procurement rights implied. */
export async function serviceCatalogHierarchy(){
 try {
  const loaded=await load('services');
  return {
   categories:loaded.categories.map(c=>({code:str(c.code),name:str(c.name)})),
   subcategories:loaded.subcategories.map(c=>({code:str(c.code),name:str(c.name),categoryCode:str(c.categoryCode)})),
   families:loaded.families.map(c=>({code:str(c.code),name:str(c.name),subcategoryCode:str(c.subcategoryCode)}))
  };
 }catch{return {categories:[],subcategories:[],families:[]};}
}

export async function searchCatalog(kind: 'materials' | 'services', q: string, limit = 25): Promise<Array<{ code: string; name: string; family: string }>> {
    let d: Loaded;
    try {
        d = await load(kind);
    } catch {
        return [];
    }
    const def = KINDS[kind];
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const familyName = new Map(d.families.map((f) => [str(f.code), str(f.name)]));
    const words = needle.split(/\s+/).filter(Boolean);
    const out: Array<{ code: string; name: string; family: string; score: number }> = [];
    for (const c of d.items.values()) {
        const code = str(c.code);
        const name = str(c.name);
        const hay = `${code} ${name} ${strs(c.synonyms).join(' ')}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
        const score = code.toLowerCase() === needle ? 0 : name.toLowerCase().startsWith(needle) ? 1 : code.toLowerCase().startsWith(needle) ? 2 : 3;
        out.push({ code, name, family: familyName.get(str(c[def.parent.item])) ?? '', score });
    }
    return out
        .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
        .slice(0, Math.max(1, Math.min(50, limit)))
        .map(({ code, name, family }) => ({ code, name, family }));
}

export async function createMaterialDraft(ctx: OrgContext) {
        requireModule(ctx, 'materials');
        if (!['org_super_admin'].includes(ctx.role) && !['PRC.create', 'PRC.materials.manage', 'PRC.admin'].some(p => hasPerm(ctx.permissions, p))) throw new HttpError(403, 'Material creation permission is required.');
        const d = await load('materials');
        const materialCode = str(ctx.body.materialCode);
        const cls = d.items.get(materialCode);
        if (!cls) throw new HttpError(400, 'Select a valid material from the reference catalogue.');
        const categoryCode = str(ctx.body.categoryCode), subcategoryCode = str(ctx.body.subcategoryCode), familyCode = str(ctx.body.familyCode);
        if (categoryCode !== str(cls.categoryCode) || subcategoryCode !== str(cls.subcategoryCode) || familyCode !== str(cls.familyCode)) throw new HttpError(400, 'Material classification does not match the selected catalogue entry.');
        const name = str(ctx.body.name).trim();
        if (name.length < 2 || name.length > 160) throw new HttpError(400, 'Enter a material name between 2 and 160 characters.');
        const raw = isObj(ctx.body.attributes) ? ctx.body.attributes : {};
        const allowed = new Set(strs(cls.attributes));
        const values: Record<string, string> = {};
        for (const [key, value] of Object.entries(raw)) {
            if (!allowed.has(key)) throw new HttpError(400, 'Unknown material attribute: ' + key);
            const val = str(value).trim();
            if (val.length > 500) throw new HttpError(400, 'Attribute value is too long: ' + key);
            values[key] = val;
        }
        for (const key of strs(cls.requiredAttributes)) if (!values[key]) throw new HttpError(400, 'A required material attribute is missing: ' + key);
        const specifics = strs(cls.specificAttributes).map(k => values[k]).filter(Boolean);
        const shortText = [name, ...specifics].join(' · ').slice(0, 120);
        const id = 'MAT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
        const path = 'organizations/' + ctx.orgId + '/materials/' + id;
        await writeDoc(path, { name, shortText, materialCode, categoryCode, subcategoryCode, familyCode, attributes: values, status: 'draft', approvalLevel: 0, createdAt: nowIso(), createdBy: ctx.uid }, { exists: false });
        await audit([{ category: 'data', action: 'org.material.create', actor: ctx.actor, meta: ctx.meta, target: { label: id }, details: name, orgId: ctx.orgId }]);
        return { ok: true, id, shortText };
    }

export const procurementRoutes = {
    'POST /api/org/inventory/material/metadata': [orgRoute('org.inventory.material.metadata', null, async ctx => {
        const root='organizations/'+ctx.orgId;
        const incoterms=[['EXW','Ex Works'],['FCA','Free Carrier'],['CPT','Carriage Paid To'],['CIP','Carriage and Insurance Paid To'],['DAP','Delivered at Place'],['DPU','Delivered at Place Unloaded'],['DDP','Delivered Duty Paid'],['FAS','Free Alongside Ship'],['FOB','Free on Board'],['CFR','Cost and Freight'],['CIF','Cost Insurance and Freight']].map(([code,description])=>({code,description,enabled:true}));
        const path='module_workspaces/PRC/metadata/incoterms';
        const existing=await getDoc(path);
        if(!existing&&ctx.role==='org_super_admin')await writeDoc(path,{items:incoterms,version:1,updatedAt:nowIso()},{exists:false});
        const [termDoc,uomDoc,stockDoc,paymentDoc]=await Promise.all([getDoc(path),getDoc('module_workspaces/PRC/metadata/unitsOfMeasure'),getDoc('module_workspaces/PRC/metadata/stockingPolicies'),getDoc('module_workspaces/PRC/metadata/paymentTerms')]);const defaultStock=[['STOCK','Stock held'],['NONSTOCK','Non-stock'],['ONDEMAND','Order on demand'],['CONSIGN','Consignment'],['MINMAX','Min/max replenishment'],['REORDER','Reorder point'],['JIT','Just in time']].map(([code,description])=>({code,description,enabled:true}));const defaultPayment=[['NET0','Due on receipt'],['NET7','Net 7 days'],['NET14','Net 14 days'],['NET15','Net 15 days'],['NET30','Net 30 days'],['NET45','Net 45 days'],['NET60','Net 60 days'],['NET90','Net 90 days'],['PREPAID','Payment in advance'],['COD','Cash on delivery'],['MILESTONE','Milestone payment'],['LC','Letter of credit']].map(([code,description])=>({code,description,enabled:true}));if(ctx.role==='org_super_admin')await Promise.all([stockDoc?Promise.resolve():writeDoc('module_workspaces/PRC/metadata/stockingPolicies',{items:defaultStock,version:1,updatedAt:nowIso()},{exists:false}),paymentDoc?Promise.resolve():writeDoc('module_workspaces/PRC/metadata/paymentTerms',{items:defaultPayment,version:1,updatedAt:nowIso()},{exists:false})]);
        const stockDimensions=await Promise.all(UNIVERSAL_STOCK_METADATA.map(async def=>{
            const doc=await getDoc('module_workspaces/PRC/metadata/'+def.key);
            const items=Array.isArray(doc?.data.items)?doc.data.items.filter(isObj):def.items;
            return {key:def.key,title:def.title,description:def.description,items:items.map(x=>({code:str(x.code),label:str(x.label)||str(x.name),description:str(x.description)||str(x.label),enabled:x.active!==false&&x.enabled!==false,category:str(x.category)})).filter(x=>x.code&&x.label)};
        }));
        const raw=Array.isArray(uomDoc?.data.items)?uomDoc.data.items:[];const uoms=raw.filter(isObj).map(x=>({code:str(x.code)||str(x.id),name:str(x.name)||str(x.label)||str(x.title)||str(x.unitName)||str(x.description)||str(x.code),description:str(x.description)||str(x.name)||str(x.label)||str(x.code),categoryCode:str(x.categoryCode)||str(x.categoryId)||str(x.category),categoryName:str(x.categoryName)||str(x.categoryLabel)||str(x.category),subcategoryCode:str(x.subcategoryCode)||str(x.subCategoryCode)||str(x.subcategoryId)||str(x.subcategory),subcategoryName:str(x.subcategoryName)||str(x.subCategoryName)||str(x.subcategoryLabel)||str(x.subcategory),enabled:x.active!==false&&x.enabled!==false}));return {incoterms:Array.isArray(termDoc?.data.items)?termDoc.data.items:incoterms,uoms,stockingPolicies:Array.isArray(stockDoc?.data.items)?stockDoc.data.items:defaultStock,paymentTerms:Array.isArray(paymentDoc?.data.items)?paymentDoc.data.items:defaultPayment,stockDimensions};
    })],
    'POST /api/org/inventory/material/bin/link': [orgRoute('org.inventory.material.bin.link', null, async ctx => {
        if(ctx.role!=='org_super_admin'&&!['INV.edit','INV.bin.link','WHS.bin.link','WMS.bin.link'].some(p=>hasPerm(ctx.permissions,p)))throw new HttpError(403,'Bin link permission required.');
        const root='organizations/'+ctx.orgId,id=str(ctx.body.id),warehouseId=str(ctx.body.warehouseId),binId=str(ctx.body.binId);
        const [user,warehouse,material,extensions]=await Promise.all([getDoc('users/'+ctx.uid),getDoc(root+'/warehouses/'+warehouseId),getDoc(root+'/materials/'+id),listDocs(root+'/material_extensions')]);
        const allowed=ctx.role==='org_super_admin'?'all':user?await allowedNodeIds(ctx.orgId,user,true):new Set<string>();
        if(!warehouse||(allowed!=='all'&&!allowed.has(warehouseId))||!material)throw new HttpError(403,'Warehouse or material not accessible.');
        await requireAt(ctx,['INV.edit','INV.bin.link','WHS.bin.link','WMS.bin.link'],warehouseId,'write','You can link bins only in warehouses where you hold the bin link right.');
        const linked=Array.isArray(material.data.warehouseIds)?material.data.warehouseIds.map(str):[];
        if(str(material.data.pushedAt))linked.push(str(material.data.warehouseId));
        if(extensions.some(x=>str(x.data.sourceId)===id&&str(x.data.warehouseId)===warehouseId&&str(x.data.status)==='approved'))linked.push(warehouseId);
        if(!linked.includes(warehouseId))throw new HttpError(403,'Material is not mapped to this warehouse.');
        const bins=Array.isArray(warehouse.data.bins)?warehouse.data.bins.filter(isObj):[];const storageLocations=Array.isArray(warehouse.data.storageLocations)?warehouse.data.storageLocations.filter(isObj):[];const clusterDocs=await listDocs(root+'/warehouses/'+warehouseId+'/clusters');for(const cluster of clusterDocs){const d=cluster.data;const layout=isObj(warehouse.data.layout)&&Array.isArray(warehouse.data.layout.floors)?warehouse.data.layout.floors:[];const floor=Number(d.floorFrom)||1,f=isObj(layout[floor-1])?layout[floor-1] as Record<string,unknown>:null;if(!f||str(d.kind)!=='run')continue;const racks=f.racking===true?Number(f.racks)||1:1,cols=f.racking===true?Number(f.columns)||1:1,positions=Number(f.positions)||1;const loc=storageLocations.find(x=>str(x.code)===str(d.locationCode));if(loc?.active===false)continue;const cls=str(d.classificationCode)||str(loc?.classificationCode);for(let i=0;i<Math.min(Number(d.count)||0,5000);i++){const o=(Number(d.startOrd)||0)+i,p=o%positions+1,c=Math.floor(o/positions)%cols+1,k=Math.floor(o/(positions*cols))%racks+1,r=Math.floor(o/(positions*cols*racks))+1;const code=String.fromCharCode(64+floor)+String.fromCharCode(64+r)+'_'+String(k).padStart(2,'0')+'_'+String.fromCharCode(64+c)+'_'+String(p).padStart(2,'0');bins.push({id:cluster.id+'__'+code,code,materialClassificationCodes:[cls],subcategoryCodes:Array.isArray(d.subcategories)?d.subcategories.filter(isObj).map(x=>str(x.code)):[],enabled:true});}}
        const bin=bins.find(x=>str(x.id)===binId||str(x.code)===binId);
        if(!bin)throw new HttpError(409,'Selected bin does not exist in warehouse configuration.');
        const classification=str(material.data.materialClassification)||str(material.data.categoryCode);
        const binClasses=Array.isArray(bin.materialClassificationCodes)?bin.materialClassificationCodes.map(str):[str(bin.materialClassificationCode)||str(bin.classificationCode)];
        if(!binClasses.includes(classification))throw new HttpError(409,'Bin classification is incompatible with material.');if(Array.isArray(bin.subcategoryCodes)&&!bin.subcategoryCodes.map(str).includes(str(material.data.subcategoryCode)))throw new HttpError(409,'This cluster does not permit the material subcategory.');
        if(bin.enabled===false||str(bin.status)==='disabled')throw new HttpError(409,'Bin is disabled.');
        const infoPath=root+'/inventory_material_info/'+id+'_'+warehouseId;const info=await getDoc(infoPath);const allOccupancy=await listDocs(root+'/warehouse_bin_occupancy');if(str(info?.data.binLocation)||allOccupancy.some(x=>str(x.data.materialId)===id))throw new HttpError(409,'This material is already linked to a bin. Delink it before assigning another.');const reservation=root+'/warehouse_bin_occupancy/'+warehouseId+'_'+binId;const stamp=nowIso();const snapshot={materialId:id,materialNumber:str(material.data.materialNumber),name:str(material.data.name),shortText:str(material.data.shortText),classification,subcategoryCode:str(material.data.subcategoryCode),minimum:info?.data.minimumLevel??null,maximum:info?.data.maximumLevel??null,actual:info?.data.actualStock??info?.data.onHandQuantity??null,cost:info?.data.stockValue??null};const eventId=stamp.replace(/[^0-9]/g,'')+'_'+ctx.uid;const event={event:'LINK',warehouseId,binId,materialId:id,at:stamp,by:ctx.uid,snapshot};const locked=await writeDoc(root+'/material_bin_locks/'+id,{by:ctx.uid,at:stamp},{exists:false});if(!locked)throw new HttpError(409,'Material bin allocation is being updated. Try again.');try{const current=await listDocs(root+'/warehouse_bin_occupancy');if(current.some(x=>str(x.data.materialId)===id))throw new HttpError(409,'Material already linked to a bin.');const ok=await writeDoc(reservation,{materialId:id,materialNumber:snapshot.materialNumber,warehouseId,binId,classification,occupiedAt:stamp,occupiedBy:ctx.uid,snapshot},{exists:false});if(!ok)throw new HttpError(409,'Bin is already linked to another material.');try{await writeDoc(infoPath,{...(info?.data||{}),materialId:id,warehouseId,binLocation:binId,binLinkedAt:stamp,binLinkedBy:ctx.uid});await writeDoc(root+'/material_bin_events/'+eventId,event);await writeDoc(root+'/bin_material_events/'+eventId,event);}catch(err){await deleteDoc(reservation);throw err;}await audited(ctx,'inventory.bin.link','Bin '+binId+' · '+snapshot.materialNumber,{warehouseId,binId,materialId:id,classification});return {ok:true};}finally{await deleteDoc(root+'/material_bin_locks/'+id);}
    })],
    'POST /api/org/inventory/material/bin/unlink': [orgRoute('org.inventory.material.bin.unlink',null,async ctx=>{if(ctx.role!=='org_super_admin'&&!['INV.edit','INV.bin.unlink','WHS.bin.unlink','WMS.bin.unlink'].some(p=>hasPerm(ctx.permissions,p)))throw new HttpError(403,'Bin unlink permission required.');const root='organizations/'+ctx.orgId,id=str(ctx.body.id),warehouseId=str(ctx.body.warehouseId);const [user,material,warehouse]=await Promise.all([getDoc('users/'+ctx.uid),getDoc(root+'/materials/'+id),getDoc(root+'/warehouses/'+warehouseId)]);const allowed=ctx.role==='org_super_admin'?'all':user?await allowedNodeIds(ctx.orgId,user,true):new Set<string>();if(!material||!warehouse||(allowed!=='all'&&!allowed.has(warehouseId)))throw new HttpError(403,'Material or warehouse not accessible.');await requireAt(ctx,['INV.edit','INV.bin.unlink','WHS.bin.unlink','WMS.bin.unlink'],warehouseId,'write','You can delink bins only in warehouses where you hold the bin delink right.');const unlinkReason=str(ctx.body.reason).trim();if(unlinkReason.length<5)throw new HttpError(400,'Give the reason for delinking the bin (at least 5 characters).');const lock=root+'/material_bin_locks/'+id;if(!await writeDoc(lock,{by:ctx.uid,at:nowIso()},{exists:false}))throw new HttpError(409,'Material allocation is being updated.');try{const records=await listDocs(root+'/warehouse_bin_occupancy');const linked=records.find(x=>str(x.data.materialId)===id&&str(x.data.warehouseId)===warehouseId);if(!linked)throw new HttpError(409,'No linked bin found for this material in this warehouse.');const binId=str(linked.data.binId),infoPath=root+'/inventory_material_info/'+id+'_'+warehouseId,info=await getDoc(infoPath);const stamp=nowIso();const snapshot={materialId:id,materialNumber:str(material.data.materialNumber),name:str(material.data.name),shortText:str(material.data.shortText),classification:str(material.data.materialClassification),subcategoryCode:str(material.data.subcategoryCode),minimum:info?.data.minimumLevel??null,maximum:info?.data.maximumLevel??null,actual:info?.data.actualStock??info?.data.onHandQuantity??null,cost:info?.data.stockValue??null};const eventId=stamp.replace(/[^0-9]/g,'')+'_'+ctx.uid;const event={event:'UNLINK',warehouseId,binId,materialId:id,at:stamp,by:ctx.uid,reason:unlinkReason.slice(0,300),snapshot};await writeDoc(root+'/material_bin_events/'+eventId,event);await writeDoc(root+'/bin_material_events/'+eventId,event);await writeDoc(infoPath,{...(info?.data||{}),binLocation:'',binUnlinkedAt:stamp,binUnlinkedBy:ctx.uid,binLinkedAt:'',binLinkedBy:''});await deleteDoc(root+'/warehouse_bin_occupancy/'+linked.id);await audited(ctx,'inventory.bin.unlink','Bin '+binId+' · '+snapshot.materialNumber,{warehouseId,binId,materialId:id,reason:unlinkReason.slice(0,300)});return {ok:true};}finally{await deleteDoc(lock);}})],
    'POST /api/org/inventory/material/bin/candidates': [orgRoute('org.inventory.material.bin.candidates',null,async ctx=>{if(ctx.role!=='org_super_admin'&&!['INV.edit','INV.bin.link','WHS.bin.link','WMS.bin.link'].some(p=>hasPerm(ctx.permissions,p)))throw new HttpError(403,'Bin link permission required.');const root='organizations/'+ctx.orgId,warehouseId=str(ctx.body.warehouseId),binId=str(ctx.body.binId);const [wh,materials,occupancy,extensions]=await Promise.all([getDoc(root+'/warehouses/'+warehouseId),listDocs(root+'/materials'),listDocs(root+'/warehouse_bin_occupancy'),listDocs(root+'/material_extensions')]);if(!wh)throw new HttpError(404,'Warehouse not found.');const user=await getDoc('users/'+ctx.uid);const allowed=ctx.role==='org_super_admin'?'all':user?await allowedNodeIds(ctx.orgId,user,true):new Set<string>();if(allowed!=='all'&&!allowed.has(warehouseId))throw new HttpError(403,'Warehouse not accessible.');const clusters=await listDocs(root+'/warehouses/'+warehouseId+'/clusters');const cluster=clusters.find(x=>binId.startsWith(x.id+'__'));if(!cluster)throw new HttpError(409,'Choose a configured cluster bin.');const cls=str(cluster.data.classificationCode),subs=Array.isArray(cluster.data.subcategories)?cluster.data.subcategories.filter(isObj).map(x=>str(x.code)):[];const occupied=new Set(occupancy.map(x=>str(x.data.materialId)));return {materials:materials.filter(x=>!occupied.has(x.id)&&str(x.data.materialClassification)===cls&&subs.includes(str(x.data.subcategoryCode))&&!!str(x.data.materialNumber)&&(['approved','active'].includes(str(x.data.status).toLowerCase()))&&((Array.isArray(x.data.warehouseIds)&&x.data.warehouseIds.map(str).includes(warehouseId))||(str(x.data.pushedAt)&&str(x.data.warehouseId)===warehouseId)||extensions.some(e=>str(e.data.sourceId)===x.id&&str(e.data.warehouseId)===warehouseId&&str(e.data.status)==='approved'))).map(x=>({id:x.id,materialNumber:str(x.data.materialNumber),name:str(x.data.name),shortText:str(x.data.shortText)}))};})],
    'POST /api/org/inventory/material/detail': [orgRoute('org.inventory.material.detail', null, async ctx => {
        if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.permissions,'INV.view')&&!hasPerm(ctx.permissions,'INV.')&&!hasPerm(ctx.permissions,'PRC.view'))throw new HttpError(403,'Inventory access required.');
        const root='organizations/'+ctx.orgId,id=str(ctx.body.id),warehouseId=str(ctx.body.warehouseId);
        const [user,warehouse,material,extensions,org]=await Promise.all([getDoc('users/'+ctx.uid),getDoc(root+'/warehouses/'+warehouseId),getDoc(root+'/materials/'+id),listDocs(root+'/material_extensions'),getDoc(root)]);
        const allowed=ctx.role==='org_super_admin'?'all':user?await allowedNodeIds(ctx.orgId,user,true):new Set<string>();
        if(!warehouse||(allowed!=='all'&&!allowed.has(warehouseId)))throw new HttpError(403,'Warehouse access denied.');
        if(!material||!str(material.data.materialNumber)||!['approved','active'].includes(str(material.data.status)))throw new HttpError(404,'Published material not found.');
        const links=Array.isArray(material.data.warehouseIds)?material.data.warehouseIds.map(str):[];
        if(str(material.data.pushedAt))links.push(str(material.data.warehouseId));
        if(extensions.some(x=>str(x.data.sourceId)===id&&str(x.data.warehouseId)===warehouseId&&str(x.data.status)==='approved'))links.push(warehouseId);
        if(!links.includes(warehouseId))throw new HttpError(403,'Material is not mapped to this warehouse.');
        const info=await getDoc(root+'/inventory_material_info/'+id+'_'+warehouseId);
        const procurement=await getDoc(root+'/procurement_material_info/'+id+'_'+warehouseId);
        const entityId=str(warehouse.data.legalEntityId)||str(material.data.legalEntityId);
        const entity=entityId?await getDoc(root+'/legal_entities/'+entityId):null;
        const localCurrency=str(entity?.data.localCurrency)||str(entity?.data.currencyCode)||str(org?.data.localCurrency)||str(org?.data.currencyCode);
        const currencyDoc=await getDoc('reference/currencies');const currencies=(Array.isArray(currencyDoc?.data.items)?currencyDoc.data.items:[]).filter(isObj).map(x=>({code:str(x.code),rate:Number(x.unitsPerUsd)||0,enabled:x.enabled!==false})).filter(x=>x.code&&x.enabled);
        const journal=await listDocs(root+'/material_journal');const materialJournal=journal.filter(x=>str(x.data.materialId)===id&&str(x.data.warehouseId)===warehouseId&&str(x.data.status)==='posted'&&x.data.reconciled===true);const journalAll=journal.filter(x=>str(x.data.materialId)===id&&str(x.data.warehouseId)===warehouseId);const statusKeys=['physicalStock','reservedStock','quarantinedStock','damagedStock','expiredStock','onOrder','onRequisition','inTransit','allocatedStock','other','availableStock'];const journalReady=journalAll.length>0&&journalAll.every(x=>str(x.data.status)==='posted'&&x.data.reconciled===true);const totals:Record<string,number>={};if(journalReady)for(const key of statusKeys)totals[key]=0;if(journalReady)for(const row of materialJournal){const changes=isObj(row.data.balancesDelta)?row.data.balancesDelta:{};for(const key of statusKeys){const n=Number(changes[key]);if(Number.isFinite(n))totals[key]=(totals[key]||0)+n;}}if(journalReady)totals.availableStock=(totals.physicalStock||0)-(totals.reservedStock||0)-(totals.quarantinedStock||0)-(totals.damagedStock||0)-(totals.expiredStock||0)-(totals.other||0);const materialMovements=journalAll.sort((a,b)=>str(b.data.postedAt||b.data.createdAt).localeCompare(str(a.data.postedAt||a.data.createdAt))).slice(0,100).map(x=>({id:x.id,type:str(x.data.type),status:str(x.data.status),reconciled:x.data.reconciled===true,postedAt:str(x.data.postedAt||x.data.createdAt),postedBy:str(x.data.postedBy),reference:str(x.data.reference),balancesDelta:isObj(x.data.balancesDelta)?x.data.balancesDelta:{}}));const isolationRequests=(await listDocs(root+'/material_isolation_requests')).filter(x=>str(x.data.materialId)===id&&str(x.data.warehouseId)===warehouseId).map(x=>({id:x.id,reason:str(x.data.reason),quantity:Number(x.data.quantity)||0,status:str(x.data.status),moveToBin:x.data.moveToBin===true,createdAt:str(x.data.createdAt)}));const currentStatus={isolationRequests,canInitialize:journalAll.length===0&&(ctx.role==='org_super_admin'||hasPerm(ctx.permissions,'INV.edit')),reconciled:journalReady,entryCount:materialJournal.length,balances:journalReady?totals:{},reason:journalReady?'Balances derived from posted reconciled material journal entries.':'No complete posted and reconciled material journal is available. Balances are intentionally not displayed.'};const structure=await listDocs(root+'/structure');const structureNames=new Map(structure.map(x=>[x.id,str(x.data.name)||str(x.data.code)||x.id]));const assetIds=Array.from(new Set([...(Array.isArray(material.data.assemblyIds)?material.data.assemblyIds.map(str):[]),str(material.data.assetId),str(material.data.assemblyId)].filter(Boolean)));const associatedAssets=assetIds.map(assetId=>({id:assetId,name:structureNames.get(assetId)||assetId}));const ids=Array.from(new Set(Object.entries(material.data).filter(([k,v])=>/(By|UserId|OwnerId|AssessorId|ApproverId)$/i.test(k)&&typeof v==='string').map(([,v])=>str(v)).filter(Boolean)));const identities:Record<string,string>={};for(const uid of ids){const account=await getDoc('users/'+uid);const name=[str(account?.data.firstName),str(account?.data.lastName)].filter(Boolean).join(' ');identities[uid]=[name,str(account?.data.email)].filter(Boolean).join(' · ')||uid;}const catalogNames:Record<string,string>={};try{const {classifications}=await import('./inventoryMeta');for(const c of await classifications())catalogNames[c.code]=c.label;}catch{}try{const master=await load('materials');for(const entry of [...master.categories,...master.subcategories,...master.families,...Array.from(master.items.values())]){const code=str(entry.code);if(code)catalogNames[code]=str(entry.name)||str(entry.description)||code;}}catch{}const legacyBins=Array.isArray(warehouse.data.bins)?warehouse.data.bins.filter(isObj):[];const storageLocations=Array.isArray(warehouse.data.storageLocations)?warehouse.data.storageLocations.filter(isObj):[];const clusterDocs=await listDocs(root+'/warehouses/'+warehouseId+'/clusters');const binRecords:Record<string,unknown>[]=[...legacyBins];for(const cluster of clusterDocs){const d=cluster.data;const floor=Number(d.floorFrom)||1;const layout=isObj(warehouse.data.layout)&&Array.isArray(warehouse.data.layout.floors)?warehouse.data.layout.floors:[];const f=isObj(layout[floor-1])?layout[floor-1] as Record<string,unknown>:null;if(!f)continue;const racks=f.racking===true?Number(f.racks)||1:1,cols=f.racking===true?Number(f.columns)||1:1,positions=Number(f.positions)||1;const start=Number(d.startOrd)||0,n=Math.min(Number(d.count)||0,5000);const loc=storageLocations.find(x=>str(x.code)===str(d.locationCode));const cls=str(d.classificationCode)||str(loc?.classificationCode);const subs=Array.isArray(d.subcategories)?d.subcategories.filter(isObj).map(x=>str(x.code)):[];if(str(d.kind)!=='run'||!cls||loc?.active===false)continue;for(let i=0;i<n;i++){const o=start+i,p=o%positions+1,c=Math.floor(o/positions)%cols+1,k=Math.floor(o/(positions*cols))%racks+1,r=Math.floor(o/(positions*cols*racks))+1;const code=String.fromCharCode(64+floor)+String.fromCharCode(64+r)+'_'+String(k).padStart(2,'0')+'_'+String.fromCharCode(64+c)+'_'+String(p).padStart(2,'0');binRecords.push({id:cluster.id+'__'+code,code,name:code+' · '+str(d.name||cluster.id),materialClassificationCodes:[cls],subcategoryCodes:subs,enabled:true,clusterCode:cluster.id});}}const classification=str(material.data.materialClassification)||str(material.data.categoryCode);const occupied=await listDocs(root+'/warehouse_bin_occupancy');const occupiedIds=new Set(occupied.filter(x=>str(x.data.warehouseId)===warehouseId).map(x=>str(x.data.binId)));const recommendedBins=binRecords.filter(x=>{const classes=Array.isArray(x.materialClassificationCodes)?x.materialClassificationCodes.map(str):[str(x.materialClassificationCode)||str(x.classificationCode)];return classes.includes(classification)&&(!Array.isArray(x.subcategoryCodes)||x.subcategoryCodes.map(str).includes(str(material.data.subcategoryCode)))&&x.enabled!==false&&str(x.status)!=='disabled'&&!occupiedIds.has(str(x.id)||str(x.code));}).map(x=>({id:str(x.id)||str(x.code),name:str(x.name)||str(x.code)||str(x.id),batch:str(x.batch)||str(x.batchCode)}));return {material:material.data,inventory:info?.data||{},procurement:procurement?.data||{},currentStatus,materialMovements,associatedAssets,identities,catalogNames,structureNames:Object.fromEntries(structureNames),recommendedBins,binDiagnostics:{configured:binRecords.length,matchingClassification:binRecords.filter(x=>{const classes=Array.isArray(x.materialClassificationCodes)?x.materialClassificationCodes.map(str):[str(x.materialClassificationCode)||str(x.classificationCode)];return classes.includes(classification);}).length,occupied:occupiedIds.size,classification,warehouseId,linkedBin:str(info?.data.binLocation),required:['Warehouse bin configuration','Material classification compatibility','Enabled and unoccupied bin']},warehouse:{id:warehouseId,name:str(warehouse.data.name)||warehouseId},currency:{local:localCurrency,alternatives:currencies},canEdit:ctx.role==='org_super_admin'||hasPerm(ctx.permissions,'INV.edit')||hasPerm(ctx.permissions,'PRC.edit')};
    })],
    'POST /api/org/inventory/material/isolation/request': [orgRoute('org.inventory.material.isolation.request',null,async ctx=>{if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.permissions,'INV.edit'))throw new HttpError(403,'Inventory isolation permission required.');const root='organizations/'+ctx.orgId,id=str(ctx.body.id),warehouseId=str(ctx.body.warehouseId),reason=str(ctx.body.reason),explanation=str(ctx.body.explanation).trim(),quantity=Number(ctx.body.quantity),moveToBin=ctx.body.moveToBin===true;if(!['quarantinedStock','damagedStock','expiredStock','other'].includes(reason)||!Number.isFinite(quantity)||quantity<=0||explanation.length<10)throw new HttpError(400,'Valid reason, positive quantity and explanation of at least 10 characters required.');const [warehouse,material,user,journal,requests]=await Promise.all([getDoc(root+'/warehouses/'+warehouseId),getDoc(root+'/materials/'+id),getDoc('users/'+ctx.uid),listDocs(root+'/material_journal'),listDocs(root+'/material_isolation_requests')]);const allowed=ctx.role==='org_super_admin'?'all':user?await allowedNodeIds(ctx.orgId,user,true):new Set<string>();if(!warehouse||(allowed!=='all'&&!allowed.has(warehouseId)))throw new HttpError(403,'Warehouse access denied.');await requireAt(ctx,['INV.edit'],warehouseId,'write','You can request stock isolation only in warehouses where you hold inventory edit rights.');if(!material||!str(material.data.materialNumber))throw new HttpError(404,'Material not found.');const posted=journal.filter(x=>str(x.data.materialId)===id&&str(x.data.warehouseId)===warehouseId&&str(x.data.status)==='posted'&&x.data.reconciled===true);if(!posted.length)throw new HttpError(409,'Reconciled opening stock required.');const totals:Record<string,number>={};for(const j of posted){const d=isObj(j.data.balancesDelta)?j.data.balancesDelta:{};for(const k of ['physicalStock','reservedStock','quarantinedStock','damagedStock','expiredStock','other'])totals[k]=(totals[k]||0)+(Number(d[k])||0);}const available=(totals.physicalStock||0)-(totals.reservedStock||0)-(totals.quarantinedStock||0)-(totals.damagedStock||0)-(totals.expiredStock||0)-(totals.other||0);const pending=requests.filter(x=>str(x.data.materialId)===id&&str(x.data.warehouseId)===warehouseId&&str(x.data.status)==='pending_approval').reduce((s,x)=>s+(Number(x.data.quantity)||0),0);if(quantity>available-pending)throw new HttpError(409,'Quantity exceeds available stock after pending isolation requests.');const requestId='ISO_'+Date.now()+'_'+Math.random().toString(36).slice(2,9);const record={materialId:id,warehouseId,materialNumber:str(material.data.materialNumber),reason,explanation,quantity,moveToBin,status:'pending_approval',createdBy:ctx.uid,createdAt:nowIso(),snapshot:{...totals,availableStock:available},safetyAcknowledged:ctx.body.safetyAcknowledged===true,qualityAcknowledged:ctx.body.qualityAcknowledged===true,workflowType:'INV_STOCK_ISOLATION'};if(moveToBin&&(!record.safetyAcknowledged||!record.qualityAcknowledged))throw new HttpError(400,'Safety and quality acknowledgements required for designated-bin transfer.');await writeDoc(root+'/material_isolation_requests/'+requestId,record,{exists:false});await audited(ctx,'inventory.isolation.request','Stock isolation '+requestId,{materialNumber:record.materialNumber,warehouseId,reason,quantity,moveToBin,explanation:explanation.slice(0,300)});return {ok:true,requestId,status:'pending_approval',message:'Isolation request saved for approval. No stock or bin movement has occurred.'};})],
    'POST /api/org/inventory/material/isolation/approve': [orgRoute('org.inventory.material.isolation.approve',null,async ctx=>{const root='organizations/'+ctx.orgId,id=str(ctx.body.id),path=root+'/material_isolation_requests/'+id;const req=await getDoc(path);if(!req||!['pending_approval','approved_pending_posting'].includes(str(req.data.status)))throw new HttpError(409,'No pending stock adjustment.');if(str(req.data.createdBy)===ctx.uid)throw new HttpError(403,'You cannot approve or post your own stock adjustment request.');if(str(req.data.status)==='approved_pending_posting'&&ctx.role!=='org_super_admin'&&str(req.data.approvedBy)!==ctx.uid)throw new HttpError(403,'Only the final approver or super administrator can reconcile this approved adjustment.');const flow=await getDoc(root+'/workflow_registry/INV-003');if(!flow||flow.data.enabled!==true)throw new HttpError(409,'Enable and configure Stock adjustment workflow INV-003.');if(str(req.data.status)==='approved_pending_posting'){const journalPath=root+'/material_journal/ISO_'+id;if(req.data.moveToBin===true)throw new HttpError(409,'Physical location transfer is required and must be completed through a controlled movement before journal reconciliation.');const existing=await getDoc(journalPath);if(existing)return {ok:true,status:'posted',message:'Journal entry already exists.'};const entries=(await listDocs(root+'/material_journal')).filter(x=>str(x.data.materialId)===str(req.data.materialId)&&str(x.data.warehouseId)===str(req.data.warehouseId));if(entries.some(x=>str(x.data.status)!=='posted'||x.data.reconciled!==true))throw new HttpError(409,'Unreconciled journal entries prevent posting.');const totals:Record<string,number>={};for(const row of entries){const delta=isObj(row.data.balancesDelta)?row.data.balancesDelta:{};for(const key of ['physicalStock','reservedStock','quarantinedStock','damagedStock','expiredStock','other'])totals[key]=(totals[key]||0)+(Number(delta[key])||0);}const available=(totals.physicalStock||0)-(totals.reservedStock||0)-(totals.quarantinedStock||0)-(totals.damagedStock||0)-(totals.expiredStock||0)-(totals.other||0);const quantity=Number(req.data.quantity);if(!Number.isFinite(quantity)||quantity<=0||quantity>available)throw new HttpError(409,'Insufficient available stock for reconciliation.');const reason=str(req.data.reason);if(!['quarantinedStock','damagedStock','expiredStock','other'].includes(reason))throw new HttpError(400,'Invalid adjustment classification.');const at=nowIso();const posted=await writeDoc(journalPath,{materialId:str(req.data.materialId),warehouseId:str(req.data.warehouseId),materialNumber:str(req.data.materialNumber),type:'STOCK_ISOLATION',status:'posted',reconciled:true,balancesDelta:{[reason]:quantity},reason:str(req.data.explanation),reference:id,createdAt:str(req.data.createdAt),postedAt:at,postedBy:ctx.uid,source:'approved_stock_adjustment',version:1},{exists:false});if(!posted)throw new HttpError(409,'Adjustment was already posted.');await writeDoc(path,{...req.data,status:'posted',postedAt:at,postedBy:ctx.uid,journalId:'ISO_'+id});await audited(ctx,'inventory.isolation.post','Stock isolation '+id,{materialNumber:str(req.data.materialNumber),warehouseId:str(req.data.warehouseId),reason,quantity});return {ok:true,status:'posted',message:'Approved adjustment reconciled to inventory journal.'};}const step=(Array.isArray(flow.data.steps)?flow.data.steps:[])[(Number(req.data.approvalLevel)||1)-1];const user=await getDoc('users/'+ctx.uid);const assignments=Array.isArray(user?.data.assignments)?user.data.assignments:[];const roles=[ctx.role,...assignments.filter(isObj).map(x=>str(x.positionCode))];if(!isObj(step)||!(str(step.mode)==='user'&&str(step.uid)===ctx.uid||str(step.mode)==='role'&&roles.includes(str(step.role))))throw new HttpError(403,'Not mapped to current approval step.');const steps=Array.isArray(flow.data.steps)?flow.data.steps:[];const history=Array.isArray(req.data.approvalHistory)?req.data.approvalHistory:[];const next=(Number(req.data.approvalLevel)||1)+1;if(next<=steps.length){await writeDoc(path,{...req.data,approvalLevel:next,approvalHistory:[...history,{by:ctx.uid,at:nowIso(),decision:'approved'}]});await audited(ctx,'inventory.isolation.approve','Stock isolation '+id,{level:next-1,of:steps.length});return {ok:true,status:'pending_approval',approvalLevel:next};}await writeDoc(path,{...req.data,status:'approved_pending_posting',approvalHistory:[...history,{by:ctx.uid,at:nowIso(),decision:'approved'}],approvedBy:ctx.uid,approvedAt:nowIso()});await audited(ctx,'inventory.isolation.approve','Stock isolation '+id,{level:steps.length,of:steps.length,final:true});return {ok:true,status:'approved_pending_posting',message:'Approved. Reconcile this request to post the stock journal; location transfers require separate controlled movement.'};})],
    'POST /api/org/inventory/material/opening-stock': [orgRoute('org.inventory.material.opening-stock', null, async ctx => {
        if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.permissions,'INV.edit'))throw new HttpError(403,'Inventory stock initialization permission required.');
        const id=str(ctx.body.id),warehouseId=str(ctx.body.warehouseId),root='organizations/'+ctx.orgId;
        if(!id||!warehouseId)throw new HttpError(400,'Material and warehouse required.');
        await requireAt(ctx,['INV.edit'],warehouseId,'write','You can post opening stock only in warehouses where you hold inventory edit rights.');
        const [user,warehouse,material,extensions]=await Promise.all([getDoc('users/'+ctx.uid),getDoc(root+'/warehouses/'+warehouseId),getDoc(root+'/materials/'+id),listDocs(root+'/material_extensions')]);
        const allowed=ctx.role==='org_super_admin'?'all':user?await allowedNodeIds(ctx.orgId,user,true):new Set<string>();
        if(!warehouse||(allowed!=='all'&&!allowed.has(warehouseId)))throw new HttpError(403,'Warehouse access denied.');
        if(!material||!str(material.data.materialNumber)||!['approved','active'].includes(str(material.data.status)))throw new HttpError(404,'Approved material required.');
        const mapped=Array.isArray(material.data.warehouseIds)&&material.data.warehouseIds.map(str).includes(warehouseId)||str(material.data.pushedAt)&&str(material.data.warehouseId)===warehouseId||extensions.some(x=>str(x.data.sourceId)===id&&str(x.data.warehouseId)===warehouseId&&str(x.data.status)==='approved');
        if(!mapped)throw new HttpError(403,'Material is not mapped to this warehouse.');
        const keys=['physicalStock','reservedStock','quarantinedStock','damagedStock','expiredStock','onOrder','onRequisition','inTransit','allocatedStock'];
        const delta:Record<string,number>={};
        for(const key of keys){const raw=ctx.body[key];const value=raw==null||raw===''?0:Number(raw);if(!Number.isFinite(value)||value<0||value>1000000000000)throw new HttpError(400,'Invalid opening quantity for '+key);delta[key]=value;}
        if(delta.reservedStock+delta.quarantinedStock+delta.damagedStock+delta.expiredStock>delta.physicalStock)throw new HttpError(400,'Restricted quantities cannot exceed physical stock.');
        if(delta.allocatedStock>delta.physicalStock)throw new HttpError(400,'Allocated stock cannot exceed physical stock.');
        const reason=str(ctx.body.reason).trim();if(reason.length<8)throw new HttpError(400,'Provide an opening stock reconciliation reference or explanation (at least 8 characters).');
        const journalPath=root+'/material_journal';
        const prior=(await listDocs(journalPath)).some(x=>str(x.data.materialId)===id&&str(x.data.warehouseId)===warehouseId);
        if(prior)throw new HttpError(409,'Stock journal already initialized; opening stock can only be posted once.');
        const eventId='OPEN_'+encodeURIComponent(warehouseId)+'_'+encodeURIComponent(id);
        const event={materialId:id,warehouseId,materialNumber:str(material.data.materialNumber),type:'OPENING_BALANCE',status:'posted',reconciled:true,balancesDelta:delta,reason,reference:reason,createdAt:nowIso(),postedAt:nowIso(),postedBy:ctx.uid,source:'manual_initial_stock',version:1};
        const created=await writeDoc(journalPath+'/'+eventId,event,{exists:false});
        if(!created)throw new HttpError(409,'Opening stock has already been recorded.');
        await audited(ctx,'inventory.material.opening_stock','Opening stock '+str(material.data.materialNumber)+' · '+warehouseId,{journalId:eventId,materialId:id,warehouseId,balancesDelta:delta,reason:reason.slice(0,300)});
        return {ok:true,journalId:eventId};
    })],
    'POST /api/org/inventory/material/update': [orgRoute('org.inventory.material.update', null, async ctx => {
        const section=str(ctx.body.section),id=str(ctx.body.id),warehouseId=str(ctx.body.warehouseId);
        if(!['inventory','procurement'].includes(section))throw new HttpError(400,'Invalid editable section.');
        if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.permissions,section==='inventory'?'INV.edit':'PRC.edit'))throw new HttpError(403,'Editing permission required.');
        if(!id||!warehouseId)throw new HttpError(400,'Material and warehouse required.');
        await requireAt(ctx,[section==='inventory'?'INV.edit':'PRC.edit'],warehouseId,'write','You can change these settings only in warehouses where you hold the edit right.');
        const root='organizations/'+ctx.orgId;
        const [user,warehouse,material,extensions]=await Promise.all([getDoc('users/'+ctx.uid),getDoc(root+'/warehouses/'+warehouseId),getDoc(root+'/materials/'+id),listDocs(root+'/material_extensions')]);
        const allowed=ctx.role==='org_super_admin'?'all':user?await allowedNodeIds(ctx.orgId,user,true):new Set<string>();
        if(!warehouse||(allowed!=='all'&&!allowed.has(warehouseId))||!material)throw new HttpError(403,'Warehouse or material inaccessible.');
        const links=Array.isArray(material.data.warehouseIds)?material.data.warehouseIds.map(str):[];
        if(str(material.data.pushedAt))links.push(str(material.data.warehouseId));
        if(extensions.some(x=>str(x.data.sourceId)===id&&str(x.data.warehouseId)===warehouseId&&str(x.data.status)==='approved'))links.push(warehouseId);
        if(!links.includes(warehouseId))throw new HttpError(403,'Material not mapped to warehouse.');
        // Bins are linked and delinked only through the controlled bin link flow, never edited here.
        const numberFields=section==='inventory'?['reorderPoint','minimumLevel','maximumLevel','safetyStock','reorderQuantity','leadTimeDays']:['minimumOrderQuantity','orderMultiple','leadTimeDays','unitPrice'];
        const textFields=section==='inventory'?['stockingPolicy','remarks',...MATERIAL_STOCK_DIMENSIONS.map(([field])=>field)]:['preferredVendor','vendorPartNumber','purchaseUom','priceCurrency','paymentTerms','incoterms','remarks'];
        const updates=isObj(ctx.body.values)?ctx.body.values:{};
        const has=(key:string)=>Object.prototype.hasOwnProperty.call(updates,key);
        const clean:Obj={};
        for(const key of numberFields)if(has(key)){const raw=updates[key];if(raw===''||raw===null){clean[key]='';continue;}const n=Number(raw);if(!Number.isFinite(n)||n<0||n>1e12)throw new HttpError(400,key+' must be a number of 0 or more.');if(key==='leadTimeDays'&&(!Number.isInteger(n)||n>3650))throw new HttpError(400,'Lead time must be a whole number of days up to 3650.');clean[key]=n;}
        for(const key of textFields)if(has(key)){const v=updates[key];if(v!==null&&typeof v!=='string'&&typeof v!=='number')throw new HttpError(400,'Invalid '+key+'.');const s=str(v).trim();if(s.length>(key==='remarks'?1000:120))throw new HttpError(400,key+' is too long.');clean[key]=s;}
        if(section==='inventory'){
            for(const [field,key] of MATERIAL_STOCK_DIMENSIONS){
                if(!has(field)||!str(clean[field]))continue;
                const master=STOCK_META_BY_KEY.get(key);
                const db=await getDoc('module_workspaces/PRC/metadata/'+key);
                const options=Array.isArray(db?.data.items)?db.data.items.filter(isObj):master?.items||[];
                const selected=options.find(v=>str(v.code)===str(clean[field]));
                if(!selected||selected.active===false||selected.enabled===false||selected.selectable===false)
                    throw new HttpError(400,field+' must use an enabled code from MEMS Admin → Procurement metadata.');
            }
            if(has('replenishmentStrategy')){
                // Preserve the MRP engine's existing stockingPolicy index and
                // change tracker. The strategy is the canonical code for new records.
                const newStrategy=str(clean.replenishmentStrategy);
                const effective=stockedPolicyToMrp(newStrategy);
                clean.stockingPolicy=effective||newStrategy;
            }
            if(has('stockingPolicy')&& !has('replenishmentStrategy')){
                const stockCode=str(clean.stockingPolicy).toUpperCase();
                if(!['','MINMAX','REORDER','STOCK','NONSTOCK','ONDEMAND','CONSIGN','JIT',...UNIVERSAL_STOCK_METADATA.find(x=>x.key==='replenishmentStrategies')!.items.map(x=>x.code)].includes(stockCode))
                    throw new HttpError(400,'Choose an enabled replenishment policy from Procurement metadata.');
                // Do not overwrite any separately adopted strategy if only the
                // original legacy stocking policy is being updated.
            }
        }
        const path=root+'/'+(section==='inventory'?'inventory_material_info':'procurement_material_info')+'/'+id+'_'+warehouseId;
        const old=await getDoc(path);
        const merged:Record<string,unknown>={...(old?.data||{}),...clean};
        const numOf=(k:string)=>merged[k]===''||merged[k]===null||merged[k]===undefined?null:Number(merged[k]);
        if(section==='inventory'){const min=numOf('minimumLevel'),max=numOf('maximumLevel'),safety=numOf('safetyStock'),reorder=numOf('reorderPoint');if(min!==null&&max!==null&&min>max)throw new HttpError(400,'Minimum level cannot be above maximum level.');if(safety!==null&&max!==null&&safety>max)throw new HttpError(400,'Safety stock cannot be above maximum level.');if(reorder!==null&&max!==null&&reorder>max)throw new HttpError(400,'Reorder point cannot be above maximum level.');}
        const changed=Object.keys(clean).filter(k=>JSON.stringify(old?.data?.[k]??null)!==JSON.stringify(clean[k]));
        if(!changed.length)return {ok:true,changed:0};
        await writeDoc(path,{...merged,materialId:id,warehouseId,updatedBy:ctx.uid,updatedAt:nowIso()});
        await audited(ctx,'inventory.material.'+section+'_settings',str(material.data.materialNumber||id)+' · '+warehouseId,Object.fromEntries(changed.map(k=>[k,{from:old?.data?.[k]??null,to:clean[k]}])));
        return {ok:true,changed:changed.length};
    })],
    'POST /api/org/inventory/operations': [orgRoute('org.inventory.operations',null,async ctx=>{
      if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.permissions,'INV.view')&&!hasPerm(ctx.permissions,'INV.')&&!hasPerm(ctx.permissions,'PRC.view'))throw new HttpError(403,'Inventory viewing permission required.');
      const root='organizations/'+ctx.orgId;
      const [user,warehouses,materials,entries,infos]=await Promise.all([getDoc('users/'+ctx.uid),listDocs(root+'/warehouses'),listDocs(root+'/materials'),listDocs(root+'/material_journal'),listDocs(root+'/inventory_material_info')]);
      const allowed=ctx.role==='org_super_admin'?'all':user?await allowedNodeIds(ctx.orgId,user,true):new Set<string>();
      const visible=warehouses.filter(w=>allowed==='all'||allowed.has(w.id));
      const ids=new Set(visible.map(w=>w.id));
      const warehouseNames=new Map(visible.map(w=>[w.id,str(w.data.name)||w.id]));
      const materialNames=new Map(materials.map(m=>[m.id,{number:str(m.data.materialNumber)||str(m.data.number)||m.id,name:str(m.data.shortText)||str(m.data.name)||'Material'}]));
      const settings=new Map(infos.map(x=>[x.id,x.data]));
      const movements=entries.filter(e=>ids.has(str(e.data.warehouseId))).map(e=>{
        const d=e.data,materialId=str(d.materialId),warehouseId=str(d.warehouseId),m=materialNames.get(materialId);
        return {id:e.id,materialId,warehouseId,warehouse:warehouseNames.get(warehouseId),materialNumber:m?.number||materialId,materialName:m?.name||'Material',type:str(d.type)||'Movement',status:str(d.status)||'Unknown',reconciled:d.reconciled===true,reference:str(d.reference)||str(d.referenceNumber)||'',date:str(d.postedAt)||str(d.createdAt)||'',physicalDelta:Number(isObj(d.balancesDelta)?d.balancesDelta.physicalStock:0)||0,reservedDelta:Number(isObj(d.balancesDelta)?d.balancesDelta.reservedStock:0)||0};
      }).sort((x,y)=>y.date.localeCompare(x.date));
      const balances=new Map<string,{quantity:number;reserved:number;valid:boolean;seen:boolean}>();
      for(const m of movements){const key=m.materialId+'_'+m.warehouseId,b=balances.get(key)||{quantity:0,reserved:0,valid:true,seen:false};b.seen=true;if(m.status!=='posted'||!m.reconciled)b.valid=false;else {b.quantity+=m.physicalDelta;b.reserved+=m.reservedDelta;}balances.set(key,b);}
      const alerts:any[]=[];
      for(const [key,b] of balances){const sep=key.lastIndexOf('_'),materialId=key.slice(0,sep),warehouseId=key.slice(sep+1),info=settings.get(key),m=materialNames.get(materialId);
        const base={id:key,materialId,warehouseId,warehouse:warehouseNames.get(warehouseId)||warehouseId,materialNumber:m?.number||materialId,materialName:m?.name||'Material',quantity:b.quantity,available:b.quantity-b.reserved};
        if(!b.valid){alerts.push({...base,kind:'Unreconciled',message:'Unreconciled journal entries require review'});continue;}
        const min=info?.minimumLevel,max=info?.maximumLevel;
        if(min!==undefined&&min!==null&&str(min)!==''&&Number.isFinite(Number(min))&&b.quantity<Number(min))alerts.push({...base,kind:'Below Minimum',limit:Number(min),message:'Stock below configured minimum'});
        if(max!==undefined&&max!==null&&str(max)!==''&&Number.isFinite(Number(max))&&b.quantity>Number(max))alerts.push({...base,kind:'Overstock',limit:Number(max),message:'Stock exceeds configured maximum'});
        if(b.quantity-b.reserved<0)alerts.push({...base,kind:'Negative Available',message:'Reservations exceed physical stock'});
      }
      return {warehouses:visible.map(w=>({id:w.id,name:warehouseNames.get(w.id)})),movements:movements.slice(0,1000),alerts,journalDiagnostics:{accessibleWarehouses:visible.length,visibleJournalEntries:movements.length}};
    })],
    'POST /api/org/inventory/dashboard': [orgRoute('org.inventory.dashboard',null,async ctx=>{if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.permissions,'INV.view')&&!hasPerm(ctx.permissions,'PRC.view'))throw new HttpError(403,'Inventory viewing permission required.');const root='organizations/'+ctx.orgId;const [user,warehouses,occupancies,journal,infos,procurements]=await Promise.all([getDoc('users/'+ctx.uid),listDocs(root+'/warehouses'),listDocs(root+'/warehouse_bin_occupancy'),listDocs(root+'/material_journal'),listDocs(root+'/inventory_material_info'),listDocs(root+'/procurement_material_info')]);const allowed=ctx.role==='org_super_admin'?'all':user?await allowedNodeIds(ctx.orgId,user,true):new Set<string>();const visible=new Set(warehouses.filter(w=>allowed==='all'||allowed.has(w.id)).map(w=>w.id));const infoMap=new Map(infos.map(x=>[x.id,x.data]));const priceMap=new Map(procurements.map(x=>[x.id,x.data]));const balances=new Map<string,{physical:number;valid:boolean;seen:boolean}>();for(const row of journal){const d=row.data,w=str(d.warehouseId);if(!visible.has(w))continue;const key=str(d.materialId)+'_'+w;const b=balances.get(key)||{physical:0,valid:true,seen:false};b.seen=true;if(str(d.status)!=='posted'||d.reconciled!==true)b.valid=false;else b.physical+=Number(isObj(d.balancesDelta)?d.balancesDelta.physicalStock:0)||0;balances.set(key,b);}let emptyBins=0,overstockQuantity=0,overstockCount=0,unvalued=0,unreconciled=0;const byCurrency:Record<string,{stockValue:number;overstockValue:number;stockQuantity:number;overstockQuantity:number}>={};const stockKeys=new Set<string>();for(const [key,b] of balances){if(!b.valid||!b.seen){unreconciled++;continue;}stockKeys.add(key);const info=infoMap.get(key),proc=priceMap.get(key);const price=Number(proc?.unitPrice),currency=str(proc?.priceCurrency)||'Unspecified';const q=Math.max(0,b.physical),max=Number(info?.maximumLevel);const excess=info?.maximumLevel!==undefined&&info?.maximumLevel!==null&&str(info.maximumLevel)!==''&&Number.isFinite(max)?Math.max(0,q-max):0;if(excess>0){overstockCount++;overstockQuantity+=excess;}if(!Number.isFinite(price)||price<0){if(q>0)unvalued++;continue;}const c=byCurrency[currency]||(byCurrency[currency]={stockValue:0,overstockValue:0,stockQuantity:0,overstockQuantity:0});c.stockValue+=q*price;c.stockQuantity+=q;c.overstockValue+=excess*price;c.overstockQuantity+=excess;}for(const occ of occupancies){const d=occ.data,w=str(d.warehouseId);if(!visible.has(w))continue;const key=str(d.materialId)+'_'+w,b=balances.get(key);if(b?.valid&&b.seen&&b.physical===0)emptyBins++;}return {emptyBins,overstockQuantity,overstockCount,byCurrency,unvalued,unreconciled};})],
    'POST /api/org/inventory/on-hand': [orgRoute('org.inventory.onhand', null, async ctx => {
        if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.permissions,'INV.view')&&!hasPerm(ctx.permissions,'INV.')&&!hasPerm(ctx.permissions,'PRC.view'))throw new HttpError(403,'Inventory viewing permission required.');
        const root='organizations/'+ctx.orgId;
        const [user,warehouses,materials,extensions,nodes]=await Promise.all([getDoc('users/'+ctx.uid),listDocs(root+'/warehouses'),listDocs(root+'/materials'),listDocs(root+'/material_extensions'),listDocs(root+'/structure')]);
        const allowed=ctx.role==='org_super_admin'?'all':user?await allowedNodeIds(ctx.orgId,user,true):new Set<string>();
        const nodeMap=new Map(nodes.map(x=>[x.id,x]));
        const visible=warehouses.filter(x=>allowed==='all'||allowed.has(x.id));
        const whMap=new Map(visible.map(w=>[w.id,{id:w.id,name:str(nodeMap.get(w.id)?.data.name)||str(w.data.name)||w.id,code:str(nodeMap.get(w.id)?.data.code)||str(w.data.code)||w.id}]));
        const items:Array<Record<string,unknown>>=[];
        const unique=new Set<string>();
        for(const m of materials){
            if(!['active','approved'].includes(str(m.data.status))||!str(m.data.materialNumber))continue;
            const linked=Array.isArray(m.data.warehouseIds)?m.data.warehouseIds.map(str):[];
            if(str(m.data.pushedAt)&&str(m.data.warehouseId))linked.push(str(m.data.warehouseId));
            for(const ex of extensions){if(str(ex.data.sourceId)===m.id&&str(ex.data.status)==='approved')linked.push(str(ex.data.warehouseId));}
            for(const warehouseId of new Set(linked)){const wh=whMap.get(warehouseId);if(!wh||unique.has(m.id+'|'+warehouseId))continue;unique.add(m.id+'|'+warehouseId);items.push({id:m.id,materialNumber:str(m.data.materialNumber),name:str(m.data.name),shortText:str(m.data.shortText),categoryCode:str(m.data.categoryCode),subcategoryCode:str(m.data.subcategoryCode),familyCode:str(m.data.familyCode),materialCode:str(m.data.materialCode),uom:str(m.data.uom),supplyType:str(m.data.supplyType),partNumber:str(m.data.oemPartNumber)||str(m.data.ocmPartNumber)||str(m.data.generalPartNumber),warehouseId,warehouseName:wh.name,warehouseCode:wh.code,status:str(m.data.status),quantityOnHand:0,stockLedgerAvailable:false,createdAt:str(m.data.createdAt)});}
        }
        return {warehouses:Array.from(whMap.values()),items};
    })],
    'POST /api/org/procurement/materials/options': [orgRoute('org.procurement.materials.options', null, async ctx => {requireModule(ctx,'materials');const [u,c,v,assemblies,warehouseDocs,user]=await Promise.all([getDoc('module_workspaces/PRC/metadata/unitsOfMeasure'),getDoc('module_workspaces/INV/metadata/materialClassifications'),listDocs('organizations/'+ctx.orgId+'/vendors'),listDocs('organizations/'+ctx.orgId+'/structure'),listDocs('organizations/'+ctx.orgId+'/warehouses'),getDoc('users/'+ctx.uid)]);const allowed=ctx.role==='org_super_admin'?'all':user?await allowedNodeIds(ctx.orgId,user,true):new Set<string>();const nodes=new Map(assemblies.map(x=>[x.id,x]));const costCenters=assemblies.filter(x=>str(x.data.level)==='cost_center'&&(allowed==='all'||allowed.has(x.id))&&str(x.data.status)!=='inactive').map(x=>({id:x.id,name:str(x.data.name)||x.id,code:str(x.data.code)||x.id}));const assets=assemblies.filter(x=>str(x.data.level)==='work_center'&&str(x.data.status)!=='inactive').map(x=>({id:x.id,name:str(x.data.name)||x.id,code:str(x.data.code)||x.id,parentId:str(x.data.parentId)}));const scopedAssemblies=assemblies.filter(x=>str(x.data.level)==='assembly'&&str(x.data.status)!=='inactive').map(x=>({id:x.id,name:str(x.data.name)||x.id,parentId:str(x.data.parentId)}));const warehouses=warehouseDocs.filter(x=>allowed==='all'||allowed.has(x.id)).map(x=>({id:x.id,name:str(nodes.get(x.id)?.data.name)||str(x.data.name)||x.id,code:str(nodes.get(x.id)?.data.code)||x.id,categoryCodes:Array.isArray(x.data.materialCategoryCodes)?x.data.materialCategoryCodes.map(str):str(x.data.materialCategoryCode)?[str(x.data.materialCategoryCode)]:[]}));return {warehouses,costCenters,assets,scopedAssemblies,uoms:(Array.isArray(u?.data.items)?u.data.items:[]).filter(x=>isObj(x)&&x.active!==false),classifications:(Array.isArray(c?.data.items)?c.data.items:[]).filter(x=>isObj(x)&&x.active!==false),vendors:v.filter(x=>x.data.active!==false).map(x=>({id:x.id,name:str(x.data.name)||str(x.data.legalName)||x.id})),assemblies:assemblies.filter(x=>str(x.data.level)==='assembly').map(x=>({id:x.id,name:str(x.data.name)||x.id}))};})],
    'POST /api/org/procurement/materials/similar': [orgRoute('org.procurement.materials.similar', null, async ctx => {
        requireModule(ctx,'materials');
        const q=isObj(ctx.body.material)?ctx.body.material:{};
        const docs=await listDocs('organizations/'+ctx.orgId+'/materials');
        const norm=(v:unknown)=>str(v).trim().toLowerCase().replace(/[^a-z0-9]+/g,'');
        const qa=isObj(q.attributes)?q.attributes:{};
        const keys=Object.keys(qa).filter(k=>str(qa[k]).trim());
        const weights=[['categoryCode',10],['subcategoryCode',15],['familyCode',20],['materialCode',25]] as const;
        const scored=docs.filter(d=>d.id!==str(ctx.body.excludeId)&&!(str(d.data.status).toLowerCase()==='draft'&&str(d.data.createdBy)===ctx.uid&&str(d.data.materialCode)===str(q.materialCode)&&str(d.data.name).trim().toLowerCase()===str(q.name).trim().toLowerCase())&&!['deleted','cancelled','rejected'].includes(str(d.data.status).toLowerCase())).map(d=>{
            const matched=weights.map(([k,w])=>({field:k,match:!!norm(q[k])&&norm(q[k])===norm(d.data[k]),weight:w}));
            const attrs=isObj(d.data.attributes)?d.data.attributes:{};
            const attrMatches=keys.filter(k=>norm(qa[k])===norm(attrs[k])).length;
            const attrScore=keys.length?attrMatches/keys.length*25:0;
            const nameMatch=norm(q.name)===norm(d.data.name)&&!!norm(q.name);
            const partKey=str(q.supplyType)==='OEM'?'oemPartNumber':str(q.supplyType)==='OCM'?'ocmPartNumber':'generalPartNumber';
            const partMatch=!!norm(q[partKey])&&norm(q[partKey])===norm(d.data[partKey]);
            const score=Math.round(Math.min(100,matched.reduce((s,x)=>s+(x.match?x.weight:0),0)+attrScore+(nameMatch?5:0)));
            return {id:d.id,name:str(d.data.name),shortText:str(d.data.shortText),warehouseId:str(d.data.warehouseId),status:str(d.data.status),score,matchedFields:matched.filter(x=>x.match).map(x=>x.field),attributeMatches:attrMatches,attributeTotal:keys.length,partMatch};
        }).sort((x,y)=>y.score-x.score||Number(y.partMatch)-Number(x.partMatch)||x.name.localeCompare(y.name));
        return {items:scored.slice(0,10),hardDuplicates:scored.filter(x=>x.score>90&&x.partMatch),totalCompared:scored.length};
    })],
    'POST /api/org/procurement/workflows/inbox': [orgRoute('org.procurement.workflows.inbox', null, async ctx => {const root='organizations/'+ctx.orgId;const legacy=await getDoc(root+'/material_workflows/default');const registry=await listDocs(root+'/workflow_registry');const user=await getDoc('users/'+ctx.uid);const assignments=Array.isArray(user?.data.assignments)?user.data.assignments:[];const roleCodes=new Set([ctx.role,...assignments.filter(isObj).map(x=>str(x.positionCode))]);const positions=await listDocs(root+'/positions');const parents=new Map(positions.map(x=>[x.id,str(x.data.parentCode)]));const creatorRole=async(uid:string)=>{const doc=await getDoc('users/'+uid);const a=Array.isArray(doc?.data.assignments)?doc.data.assignments:[];return str(isObj(a[0])?a[0].positionCode:'');};const eligibleLegacy=async(d:Obj,extension:boolean)=>{if(str(d.createdBy)===ctx.uid||str(d.submittedBy)===ctx.uid||approvedEarlierLevel(d.approvalHistory,ctx.uid))return false;const level=Number(d.approvalLevel)||1;const modes=Array.isArray(legacy?.data.modes)?legacy.data.modes:[];const roles=Array.isArray(legacy?.data.roles)?legacy.data.roles:[];let role=str(roles[level-1]);if(str(modes[level-1])==='above_creator'){role=await creatorRole(str(extension?d.createdBy:d.submittedBy));for(let i=0;i<level;i++)role=parents.get(role)||'';}const delegates=Array.isArray(legacy?.data.delegations)?legacy.data.delegations:[];return !!role&&(roleCodes.has(role)||activeDelegation(delegates,role,ctx.uid));};const mapped=async(code:string,d:Obj)=>{const registryCode=code==='Material creation'?'PRC-001':'PRC-002';const w=registry.find(x=>x.id===registryCode&&x.data.enabled===true);if(!w)return false;const steps=Array.isArray(w.data.steps)?w.data.steps:[];const currentStep=steps[(Number(d.approvalLevel)||1)-1];if(!isObj(currentStep))return false;return str(currentStep.mode)==='user'&&str(currentStep.uid)===ctx.uid||str(currentStep.mode)==='role'&&roleCodes.has(str(currentStep.role));};const sources=[{type:'creation',path:root+'/materials',label:'Material creation'},{type:'extension',path:root+'/material_extensions',label:'Material extension'}];const items:Obj[]=[];for(const source of sources){const docs=await listDocs(source.path);for(const d of docs){if(str(d.data.status)!=='pending_approval')continue;const owner=str(source.type==='extension'?d.data.createdBy:d.data.submittedBy);const assigned=await eligibleLegacy(d.data,source.type==='extension');const futureMapped=await mapped(source.label,d.data);const self=owner===ctx.uid;const actionable=futureMapped||(!registry.some(w=>w.id===(source.type==='creation'?'PRC-001':'PRC-002')&&w.data.enabled===true)&&assigned);if(!self&&!actionable)continue;const creator=await getDoc('users/'+owner);const creatorName=[str(creator?.data.firstName),str(creator?.data.lastName)].filter(Boolean).join(' ');items.push({id:d.id,type:source.type,label:source.label,name:str(d.data.name||d.data.materialName||d.data.shortText),status:str(d.data.status),approvalLevel:Number(d.data.approvalLevel)||1,submittedAt:str(d.data.submittedAt||d.data.createdAt),owner,creatorName:creatorName||str(creator?.data.email)||owner,creatorEmail:str(creator?.data.email),isMine:self,assigned:assigned||futureMapped,canApprove:actionable&&(!self||ctx.role==='org_super_admin'),conflict:self&&(assigned||futureMapped)&&ctx.role!=='org_super_admin',configurationOnly:false,sourceId:str(d.data.sourceId),warehouseId:str(d.data.warehouseId)});}}const stockFlow=registry.find(x=>x.id==='INV-003'&&x.data.enabled===true);const stockSteps=Array.isArray(stockFlow?.data.steps)?stockFlow.data.steps:[];for(const req of await listDocs(root+'/material_isolation_requests')){const d=req.data;if(!['pending_approval','approved_pending_posting'].includes(str(d.status)))continue;const reconcile=str(d.status)==='approved_pending_posting';const owner=str(d.createdBy),level=Number(d.approvalLevel)||1,step=stockSteps[level-1];const assigned=isObj(step)&&(str(step.mode)==='user'&&str(step.uid)===ctx.uid||str(step.mode)==='role'&&roleCodes.has(str(step.role)));const self=owner===ctx.uid;if(!self&&!assigned&&!(reconcile&&(ctx.role==='org_super_admin'||str(d.approvedBy)===ctx.uid)))continue;const creator=await getDoc('users/'+owner);items.push({id:req.id,type:'stock_adjustment',label:'Stock adjustment',name:str(d.materialNumber)+' · '+str(d.reason)+' · '+str(d.quantity),approvalLevel:level,submittedAt:str(d.createdAt),owner,creatorName:[str(creator?.data.firstName),str(creator?.data.lastName)].filter(Boolean).join(' ')||str(creator?.data.email)||owner,creatorEmail:str(creator?.data.email),isMine:self,canApprove:reconcile?(ctx.role==='org_super_admin'||str(d.approvedBy)===ctx.uid)&&d.moveToBin!==true:assigned&&(!self||ctx.role==='org_super_admin'),conflict:!reconcile&&assigned&&self&&ctx.role!=='org_super_admin',configurationOnly:!stockFlow,needsReconciliation:reconcile,sourceId:str(d.materialId),warehouseId:str(d.warehouseId)});}for(const req of await listDocs(root+'/workflow_requests')){const d=req.data;if(str(d.status)!=='pending_approval')continue;const code=str(d.workflowCode),config=registry.find(x=>x.id===code&&x.data.enabled===true);const steps=Array.isArray(config?.data.steps)?config.data.steps:[];const level=Number(d.approvalLevel)||1,step=steps[level-1],owner=str(d.createdBy||d.submittedBy);const assigned=isObj(step)&&(str(step.mode)==='user'&&str(step.uid)===ctx.uid||str(step.mode)==='role'&&roleCodes.has(str(step.role)));const self=owner===ctx.uid;if(!self&&!assigned)continue;const creator=await getDoc('users/'+owner);items.push({id:req.id,type:'generic_workflow',label:str(config?.data.name||d.transactionName||code),name:str(d.description||d.name||d.reference||code),approvalLevel:level,submittedAt:str(d.submittedAt||d.createdAt),owner,creatorName:[str(creator?.data.firstName),str(creator?.data.lastName)].filter(Boolean).join(' ')||str(creator?.data.email)||owner,creatorEmail:str(creator?.data.email),isMine:self,canApprove:false,conflict:assigned&&self&&ctx.role!=='org_super_admin',configurationOnly:true,sourceId:str(d.sourceId||d.reference),warehouseId:str(d.warehouseId)});}return {items:items.sort((x,y)=>str(y.submittedAt).localeCompare(str(x.submittedAt))),uid:ctx.uid,warning:'Requester self-approval is prohibited. Assign a different approver or a valid alternate before the request can progress.'};})],
    'POST /api/org/procurement/workflows/registry': [orgRoute('org.procurement.workflows.registry', null, async ctx => {const admin=ctx.role==='org_super_admin'||hasPerm(ctx.permissions,'ADM.workflows');if(!admin)throw new HttpError(403,'Workflow administration permission required.');const path='organizations/'+ctx.orgId+'/workflow_registry';const existing=await listDocs(path);if(!existing.length){const templates=[{"code":"ORG-001","module":"ORG","name":"Tenant registration","transactionKey":"ORG.tenant_registration","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-002","module":"ORG","name":"Organization onboarding","transactionKey":"ORG.organization_onboarding","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-003","module":"ORG","name":"User invitation","transactionKey":"ORG.user_invitation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-004","module":"ORG","name":"User activation","transactionKey":"ORG.user_activation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-005","module":"ORG","name":"Role assignment","transactionKey":"ORG.role_assignment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-006","module":"ORG","name":"Permission escalation","transactionKey":"ORG.permission_escalation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-007","module":"ORG","name":"Delegation","transactionKey":"ORG.delegation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-008","module":"ORG","name":"Organization structure change","transactionKey":"ORG.organization_structure_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-009","module":"ORG","name":"Position change","transactionKey":"ORG.position_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-010","module":"ORG","name":"Cost center change","transactionKey":"ORG.cost_center_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-011","module":"ORG","name":"Module activation","transactionKey":"ORG.module_activation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-012","module":"ORG","name":"Organization suspension","transactionKey":"ORG.organization_suspension","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-001","module":"HR","name":"Employee recruitment","transactionKey":"HR.employee_recruitment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-002","module":"HR","name":"Employment offer","transactionKey":"HR.employment_offer","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-003","module":"HR","name":"Contract renewal","transactionKey":"HR.contract_renewal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-004","module":"HR","name":"Probation confirmation","transactionKey":"HR.probation_confirmation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-005","module":"HR","name":"Employee transfer","transactionKey":"HR.employee_transfer","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-006","module":"HR","name":"Promotion","transactionKey":"HR.promotion","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-007","module":"HR","name":"Salary adjustment","transactionKey":"HR.salary_adjustment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-008","module":"HR","name":"Overtime","transactionKey":"HR.overtime","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-009","module":"HR","name":"Leave","transactionKey":"HR.leave","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-010","module":"HR","name":"Training request","transactionKey":"HR.training_request","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-011","module":"HR","name":"Travel authorization","transactionKey":"HR.travel_authorization","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-012","module":"HR","name":"Expense claim","transactionKey":"HR.expense_claim","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-013","module":"HR","name":"Disciplinary action","transactionKey":"HR.disciplinary_action","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-014","module":"HR","name":"Separation","transactionKey":"HR.separation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-001","module":"PRC","name":"Material master creation","transactionKey":"PRC.material_master_creation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-002","module":"PRC","name":"Material warehouse extension","transactionKey":"PRC.material_warehouse_extension","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-003","module":"PRC","name":"Material master change","transactionKey":"PRC.material_master_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-004","module":"PRC","name":"Service master creation","transactionKey":"PRC.service_master_creation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-005","module":"PRC","name":"Supplier registration","transactionKey":"PRC.supplier_registration","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-006","module":"PRC","name":"Supplier change","transactionKey":"PRC.supplier_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-007","module":"PRC","name":"Supplier suspension","transactionKey":"PRC.supplier_suspension","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-008","module":"PRC","name":"Purchase requisition","transactionKey":"PRC.purchase_requisition","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-009","module":"PRC","name":"Purchase order","transactionKey":"PRC.purchase_order","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-010","module":"PRC","name":"Purchase order amendment","transactionKey":"PRC.purchase_order_amendment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-011","module":"PRC","name":"Single-source procurement","transactionKey":"PRC.single_source_procurement","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-012","module":"PRC","name":"Emergency procurement","transactionKey":"PRC.emergency_procurement","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-013","module":"PRC","name":"Contract award","transactionKey":"PRC.contract_award","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-014","module":"PRC","name":"Contract variation","transactionKey":"PRC.contract_variation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-015","module":"PRC","name":"Supplier invoice exception","transactionKey":"PRC.supplier_invoice_exception","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-016","module":"PRC","name":"Goods return","transactionKey":"PRC.goods_return","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-001","module":"INV","name":"Warehouse setup change","transactionKey":"INV.warehouse_setup_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-002","module":"INV","name":"Storage category removal","transactionKey":"INV.storage_category_removal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-003","module":"INV","name":"Stock adjustment","transactionKey":"INV.stock_adjustment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-004","module":"INV","name":"Stock transfer","transactionKey":"INV.stock_transfer","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-005","module":"INV","name":"Stock issue","transactionKey":"INV.stock_issue","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-006","module":"INV","name":"Stock return","transactionKey":"INV.stock_return","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-007","module":"INV","name":"Stock write-off","transactionKey":"INV.stock_write_off","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-008","module":"INV","name":"Stock disposal","transactionKey":"INV.stock_disposal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-009","module":"INV","name":"Stock count variance","transactionKey":"INV.stock_count_variance","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-010","module":"INV","name":"Inventory revaluation","transactionKey":"INV.inventory_revaluation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-011","module":"INV","name":"Stock reservation override","transactionKey":"INV.stock_reservation_override","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-012","module":"INV","name":"Obsolete stock disposal","transactionKey":"INV.obsolete_stock_disposal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-001","module":"MNT","name":"Maintenance work request","transactionKey":"MNT.maintenance_work_request","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-002","module":"MNT","name":"Maintenance work order","transactionKey":"MNT.maintenance_work_order","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-003","module":"MNT","name":"Emergency work order","transactionKey":"MNT.emergency_work_order","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-004","module":"MNT","name":"Preventive maintenance plan","transactionKey":"MNT.preventive_maintenance_plan","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-005","module":"MNT","name":"Maintenance schedule change","transactionKey":"MNT.maintenance_schedule_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-006","module":"MNT","name":"Maintenance deferral","transactionKey":"MNT.maintenance_deferral","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-007","module":"MNT","name":"Maintenance shutdown","transactionKey":"MNT.maintenance_shutdown","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-008","module":"MNT","name":"Major overhaul","transactionKey":"MNT.major_overhaul","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-009","module":"MNT","name":"Maintenance contractor engagement","transactionKey":"MNT.maintenance_contractor_engagement","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-010","module":"MNT","name":"RCA report","transactionKey":"MNT.rca_report","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-011","module":"MNT","name":"Corrective action closure","transactionKey":"MNT.corrective_action_closure","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-012","module":"MNT","name":"Maintenance strategy change","transactionKey":"MNT.maintenance_strategy_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-013","module":"MNT","name":"Equipment modification","transactionKey":"MNT.equipment_modification","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-014","module":"MNT","name":"Technical change control","transactionKey":"MNT.technical_change_control","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-015","module":"MNT","name":"Safety-critical maintenance override","transactionKey":"MNT.safety_critical_maintenance_override","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-001","module":"AST","name":"Asset acquisition","transactionKey":"AST.asset_acquisition","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-002","module":"AST","name":"Asset capitalization","transactionKey":"AST.asset_capitalization","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-003","module":"AST","name":"Asset transfer","transactionKey":"AST.asset_transfer","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-004","module":"AST","name":"Asset relocation","transactionKey":"AST.asset_relocation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-005","module":"AST","name":"Asset impairment","transactionKey":"AST.asset_impairment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-006","module":"AST","name":"Asset disposal","transactionKey":"AST.asset_disposal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-007","module":"AST","name":"Asset write-off","transactionKey":"AST.asset_write_off","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-008","module":"AST","name":"Asset commissioning","transactionKey":"AST.asset_commissioning","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-009","module":"AST","name":"Asset decommissioning","transactionKey":"AST.asset_decommissioning","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-010","module":"AST","name":"Asset lifecycle plan","transactionKey":"AST.asset_lifecycle_plan","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-001","module":"FIN","name":"General ledger journal","transactionKey":"FIN.general_ledger_journal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-002","module":"FIN","name":"Journal reversal","transactionKey":"FIN.journal_reversal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-003","module":"FIN","name":"Budget creation","transactionKey":"FIN.budget_creation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-004","module":"FIN","name":"Budget revision","transactionKey":"FIN.budget_revision","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-005","module":"FIN","name":"Budget transfer","transactionKey":"FIN.budget_transfer","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-006","module":"FIN","name":"Payment request","transactionKey":"FIN.payment_request","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-007","module":"FIN","name":"Payment release","transactionKey":"FIN.payment_release","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-008","module":"FIN","name":"Vendor payment","transactionKey":"FIN.vendor_payment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-009","module":"FIN","name":"Credit note","transactionKey":"FIN.credit_note","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-010","module":"FIN","name":"Debit note","transactionKey":"FIN.debit_note","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-011","module":"FIN","name":"Bank reconciliation exception","transactionKey":"FIN.bank_reconciliation_exception","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-012","module":"FIN","name":"Financial period close","transactionKey":"FIN.financial_period_close","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-013","module":"FIN","name":"Tax adjustment","transactionKey":"FIN.tax_adjustment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-014","module":"FIN","name":"Fixed asset depreciation override","transactionKey":"FIN.fixed_asset_depreciation_override","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-001","module":"OPS","name":"Production plan","transactionKey":"OPS.production_plan","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-002","module":"OPS","name":"Production schedule change","transactionKey":"OPS.production_schedule_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-003","module":"OPS","name":"Batch release","transactionKey":"OPS.batch_release","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-004","module":"OPS","name":"Quality deviation","transactionKey":"OPS.quality_deviation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-005","module":"OPS","name":"Product hold","transactionKey":"OPS.product_hold","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-006","module":"OPS","name":"Product release","transactionKey":"OPS.product_release","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-007","module":"OPS","name":"Nonconformance disposition","transactionKey":"OPS.nonconformance_disposition","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-008","module":"OPS","name":"Rework","transactionKey":"OPS.rework","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-009","module":"OPS","name":"Scrap","transactionKey":"OPS.scrap","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-010","module":"OPS","name":"Process parameter change","transactionKey":"OPS.process_parameter_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-011","module":"OPS","name":"Engineering change","transactionKey":"OPS.engineering_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-012","module":"OPS","name":"Operational deviation","transactionKey":"OPS.operational_deviation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-001","module":"SHEQ","name":"Incident report","transactionKey":"SHEQ.incident_report","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-002","module":"SHEQ","name":"Incident investigation","transactionKey":"SHEQ.incident_investigation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-003","module":"SHEQ","name":"Risk assessment","transactionKey":"SHEQ.risk_assessment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-004","module":"SHEQ","name":"Permit to work","transactionKey":"SHEQ.permit_to_work","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-005","module":"SHEQ","name":"Safety deviation","transactionKey":"SHEQ.safety_deviation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-006","module":"SHEQ","name":"Environmental incident","transactionKey":"SHEQ.environmental_incident","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-007","module":"SHEQ","name":"Waste disposal","transactionKey":"SHEQ.waste_disposal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-008","module":"SHEQ","name":"Regulatory submission","transactionKey":"SHEQ.regulatory_submission","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-009","module":"SHEQ","name":"Audit finding closure","transactionKey":"SHEQ.audit_finding_closure","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-010","module":"SHEQ","name":"CAPA closure","transactionKey":"SHEQ.capa_closure","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-011","module":"SHEQ","name":"Policy exception","transactionKey":"SHEQ.policy_exception","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-001","module":"IT","name":"System access request","transactionKey":"IT.system_access_request","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-002","module":"IT","name":"Privileged access","transactionKey":"IT.privileged_access","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-003","module":"IT","name":"Integration activation","transactionKey":"IT.integration_activation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-004","module":"IT","name":"Data import","transactionKey":"IT.data_import","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-005","module":"IT","name":"Bulk data deletion","transactionKey":"IT.bulk_data_deletion","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-006","module":"IT","name":"Data correction","transactionKey":"IT.data_correction","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-007","module":"IT","name":"System configuration change","transactionKey":"IT.system_configuration_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-008","module":"IT","name":"Security exception","transactionKey":"IT.security_exception","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-009","module":"IT","name":"Backup restore","transactionKey":"IT.backup_restore","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-010","module":"IT","name":"Data export","transactionKey":"IT.data_export","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1}];for(const t of templates)await writeDoc(path+'/'+t.code,{...t,createdAt:nowIso(),updatedAt:nowIso(),updatedBy:ctx.uid});return {items:templates};}const templates=[{"code":"ORG-001","module":"ORG","name":"Tenant registration","transactionKey":"ORG.tenant_registration","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-002","module":"ORG","name":"Organization onboarding","transactionKey":"ORG.organization_onboarding","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-003","module":"ORG","name":"User invitation","transactionKey":"ORG.user_invitation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-004","module":"ORG","name":"User activation","transactionKey":"ORG.user_activation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-005","module":"ORG","name":"Role assignment","transactionKey":"ORG.role_assignment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-006","module":"ORG","name":"Permission escalation","transactionKey":"ORG.permission_escalation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-007","module":"ORG","name":"Delegation","transactionKey":"ORG.delegation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-008","module":"ORG","name":"Organization structure change","transactionKey":"ORG.organization_structure_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-009","module":"ORG","name":"Position change","transactionKey":"ORG.position_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-010","module":"ORG","name":"Cost center change","transactionKey":"ORG.cost_center_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-011","module":"ORG","name":"Module activation","transactionKey":"ORG.module_activation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"ORG-012","module":"ORG","name":"Organization suspension","transactionKey":"ORG.organization_suspension","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-001","module":"HR","name":"Employee recruitment","transactionKey":"HR.employee_recruitment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-002","module":"HR","name":"Employment offer","transactionKey":"HR.employment_offer","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-003","module":"HR","name":"Contract renewal","transactionKey":"HR.contract_renewal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-004","module":"HR","name":"Probation confirmation","transactionKey":"HR.probation_confirmation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-005","module":"HR","name":"Employee transfer","transactionKey":"HR.employee_transfer","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-006","module":"HR","name":"Promotion","transactionKey":"HR.promotion","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-007","module":"HR","name":"Salary adjustment","transactionKey":"HR.salary_adjustment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-008","module":"HR","name":"Overtime","transactionKey":"HR.overtime","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-009","module":"HR","name":"Leave","transactionKey":"HR.leave","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-010","module":"HR","name":"Training request","transactionKey":"HR.training_request","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-011","module":"HR","name":"Travel authorization","transactionKey":"HR.travel_authorization","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-012","module":"HR","name":"Expense claim","transactionKey":"HR.expense_claim","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-013","module":"HR","name":"Disciplinary action","transactionKey":"HR.disciplinary_action","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"HR-014","module":"HR","name":"Separation","transactionKey":"HR.separation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-001","module":"PRC","name":"Material master creation","transactionKey":"PRC.material_master_creation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-002","module":"PRC","name":"Material warehouse extension","transactionKey":"PRC.material_warehouse_extension","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-003","module":"PRC","name":"Material master change","transactionKey":"PRC.material_master_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-004","module":"PRC","name":"Service master creation","transactionKey":"PRC.service_master_creation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-005","module":"PRC","name":"Supplier registration","transactionKey":"PRC.supplier_registration","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-006","module":"PRC","name":"Supplier change","transactionKey":"PRC.supplier_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-007","module":"PRC","name":"Supplier suspension","transactionKey":"PRC.supplier_suspension","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-008","module":"PRC","name":"Purchase requisition","transactionKey":"PRC.purchase_requisition","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-009","module":"PRC","name":"Purchase order","transactionKey":"PRC.purchase_order","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-010","module":"PRC","name":"Purchase order amendment","transactionKey":"PRC.purchase_order_amendment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-011","module":"PRC","name":"Single-source procurement","transactionKey":"PRC.single_source_procurement","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-012","module":"PRC","name":"Emergency procurement","transactionKey":"PRC.emergency_procurement","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-013","module":"PRC","name":"Contract award","transactionKey":"PRC.contract_award","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-014","module":"PRC","name":"Contract variation","transactionKey":"PRC.contract_variation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-015","module":"PRC","name":"Supplier invoice exception","transactionKey":"PRC.supplier_invoice_exception","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"PRC-016","module":"PRC","name":"Goods return","transactionKey":"PRC.goods_return","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-001","module":"INV","name":"Warehouse setup change","transactionKey":"INV.warehouse_setup_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-002","module":"INV","name":"Storage category removal","transactionKey":"INV.storage_category_removal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-003","module":"INV","name":"Stock adjustment","transactionKey":"INV.stock_adjustment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-004","module":"INV","name":"Stock transfer","transactionKey":"INV.stock_transfer","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-005","module":"INV","name":"Stock issue","transactionKey":"INV.stock_issue","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-006","module":"INV","name":"Stock return","transactionKey":"INV.stock_return","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-007","module":"INV","name":"Stock write-off","transactionKey":"INV.stock_write_off","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-008","module":"INV","name":"Stock disposal","transactionKey":"INV.stock_disposal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-009","module":"INV","name":"Stock count variance","transactionKey":"INV.stock_count_variance","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-010","module":"INV","name":"Inventory revaluation","transactionKey":"INV.inventory_revaluation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-011","module":"INV","name":"Stock reservation override","transactionKey":"INV.stock_reservation_override","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"INV-012","module":"INV","name":"Obsolete stock disposal","transactionKey":"INV.obsolete_stock_disposal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-001","module":"MNT","name":"Maintenance work request","transactionKey":"MNT.maintenance_work_request","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-002","module":"MNT","name":"Maintenance work order","transactionKey":"MNT.maintenance_work_order","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-003","module":"MNT","name":"Emergency work order","transactionKey":"MNT.emergency_work_order","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-004","module":"MNT","name":"Preventive maintenance plan","transactionKey":"MNT.preventive_maintenance_plan","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-005","module":"MNT","name":"Maintenance schedule change","transactionKey":"MNT.maintenance_schedule_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-006","module":"MNT","name":"Maintenance deferral","transactionKey":"MNT.maintenance_deferral","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-007","module":"MNT","name":"Maintenance shutdown","transactionKey":"MNT.maintenance_shutdown","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-008","module":"MNT","name":"Major overhaul","transactionKey":"MNT.major_overhaul","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-009","module":"MNT","name":"Maintenance contractor engagement","transactionKey":"MNT.maintenance_contractor_engagement","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-010","module":"MNT","name":"RCA report","transactionKey":"MNT.rca_report","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-011","module":"MNT","name":"Corrective action closure","transactionKey":"MNT.corrective_action_closure","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-012","module":"MNT","name":"Maintenance strategy change","transactionKey":"MNT.maintenance_strategy_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-013","module":"MNT","name":"Equipment modification","transactionKey":"MNT.equipment_modification","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-014","module":"MNT","name":"Technical change control","transactionKey":"MNT.technical_change_control","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"MNT-015","module":"MNT","name":"Safety-critical maintenance override","transactionKey":"MNT.safety_critical_maintenance_override","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-001","module":"AST","name":"Asset acquisition","transactionKey":"AST.asset_acquisition","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-002","module":"AST","name":"Asset capitalization","transactionKey":"AST.asset_capitalization","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-003","module":"AST","name":"Asset transfer","transactionKey":"AST.asset_transfer","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-004","module":"AST","name":"Asset relocation","transactionKey":"AST.asset_relocation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-005","module":"AST","name":"Asset impairment","transactionKey":"AST.asset_impairment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-006","module":"AST","name":"Asset disposal","transactionKey":"AST.asset_disposal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-007","module":"AST","name":"Asset write-off","transactionKey":"AST.asset_write_off","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-008","module":"AST","name":"Asset commissioning","transactionKey":"AST.asset_commissioning","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-009","module":"AST","name":"Asset decommissioning","transactionKey":"AST.asset_decommissioning","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"AST-010","module":"AST","name":"Asset lifecycle plan","transactionKey":"AST.asset_lifecycle_plan","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-001","module":"FIN","name":"General ledger journal","transactionKey":"FIN.general_ledger_journal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-002","module":"FIN","name":"Journal reversal","transactionKey":"FIN.journal_reversal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-003","module":"FIN","name":"Budget creation","transactionKey":"FIN.budget_creation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-004","module":"FIN","name":"Budget revision","transactionKey":"FIN.budget_revision","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-005","module":"FIN","name":"Budget transfer","transactionKey":"FIN.budget_transfer","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-006","module":"FIN","name":"Payment request","transactionKey":"FIN.payment_request","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-007","module":"FIN","name":"Payment release","transactionKey":"FIN.payment_release","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-008","module":"FIN","name":"Vendor payment","transactionKey":"FIN.vendor_payment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-009","module":"FIN","name":"Credit note","transactionKey":"FIN.credit_note","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-010","module":"FIN","name":"Debit note","transactionKey":"FIN.debit_note","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-011","module":"FIN","name":"Bank reconciliation exception","transactionKey":"FIN.bank_reconciliation_exception","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-012","module":"FIN","name":"Financial period close","transactionKey":"FIN.financial_period_close","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-013","module":"FIN","name":"Tax adjustment","transactionKey":"FIN.tax_adjustment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"FIN-014","module":"FIN","name":"Fixed asset depreciation override","transactionKey":"FIN.fixed_asset_depreciation_override","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-001","module":"OPS","name":"Production plan","transactionKey":"OPS.production_plan","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-002","module":"OPS","name":"Production schedule change","transactionKey":"OPS.production_schedule_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-003","module":"OPS","name":"Batch release","transactionKey":"OPS.batch_release","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-004","module":"OPS","name":"Quality deviation","transactionKey":"OPS.quality_deviation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-005","module":"OPS","name":"Product hold","transactionKey":"OPS.product_hold","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-006","module":"OPS","name":"Product release","transactionKey":"OPS.product_release","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-007","module":"OPS","name":"Nonconformance disposition","transactionKey":"OPS.nonconformance_disposition","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-008","module":"OPS","name":"Rework","transactionKey":"OPS.rework","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-009","module":"OPS","name":"Scrap","transactionKey":"OPS.scrap","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-010","module":"OPS","name":"Process parameter change","transactionKey":"OPS.process_parameter_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-011","module":"OPS","name":"Engineering change","transactionKey":"OPS.engineering_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"OPS-012","module":"OPS","name":"Operational deviation","transactionKey":"OPS.operational_deviation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-001","module":"SHEQ","name":"Incident report","transactionKey":"SHEQ.incident_report","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-002","module":"SHEQ","name":"Incident investigation","transactionKey":"SHEQ.incident_investigation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-003","module":"SHEQ","name":"Risk assessment","transactionKey":"SHEQ.risk_assessment","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-004","module":"SHEQ","name":"Permit to work","transactionKey":"SHEQ.permit_to_work","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-005","module":"SHEQ","name":"Safety deviation","transactionKey":"SHEQ.safety_deviation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-006","module":"SHEQ","name":"Environmental incident","transactionKey":"SHEQ.environmental_incident","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-007","module":"SHEQ","name":"Waste disposal","transactionKey":"SHEQ.waste_disposal","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-008","module":"SHEQ","name":"Regulatory submission","transactionKey":"SHEQ.regulatory_submission","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-009","module":"SHEQ","name":"Audit finding closure","transactionKey":"SHEQ.audit_finding_closure","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-010","module":"SHEQ","name":"CAPA closure","transactionKey":"SHEQ.capa_closure","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"SHEQ-011","module":"SHEQ","name":"Policy exception","transactionKey":"SHEQ.policy_exception","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-001","module":"IT","name":"System access request","transactionKey":"IT.system_access_request","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-002","module":"IT","name":"Privileged access","transactionKey":"IT.privileged_access","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-003","module":"IT","name":"Integration activation","transactionKey":"IT.integration_activation","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-004","module":"IT","name":"Data import","transactionKey":"IT.data_import","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-005","module":"IT","name":"Bulk data deletion","transactionKey":"IT.bulk_data_deletion","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-006","module":"IT","name":"Data correction","transactionKey":"IT.data_correction","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-007","module":"IT","name":"System configuration change","transactionKey":"IT.system_configuration_change","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-008","module":"IT","name":"Security exception","transactionKey":"IT.security_exception","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-009","module":"IT","name":"Backup restore","transactionKey":"IT.backup_restore","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1},{"code":"IT-010","module":"IT","name":"Data export","transactionKey":"IT.data_export","enabled":false,"approvalMode":"sequential","approvalRule":"all","steps":[{"mode":"role","role":"","managerLevel":1}],"version":1}];const found=new Set(existing.map(x=>x.id));const missing=templates.filter(x=>!found.has(x.code));for(const t of missing)await writeDoc(path+'/'+t.code,{...t,createdAt:nowIso(),updatedAt:nowIso(),updatedBy:ctx.uid});return {items:[...existing.map(x=>({id:x.id,...x.data})),...missing]};})],
    'POST /api/org/procurement/workflows/save': [orgRoute('org.procurement.workflows.save', null, async ctx => {if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.permissions,'ADM.workflows'))throw new HttpError(403,'Workflow administration permission required.');const code=str(ctx.body.code);if(!/^[A-Z]{2,5}-[0-9]{3}$/.test(code))throw new HttpError(400,'Invalid workflow code.');const path='organizations/'+ctx.orgId+'/workflow_registry/'+code;const current=await getDoc(path);if(!current)throw new HttpError(404,'Workflow not found.');const steps=Array.isArray(ctx.body.steps)?ctx.body.steps:[];if(steps.length<1||steps.length>20||steps.some(x=>!isObj(x)||!['role','manager','user'].includes(str(x.mode))||(str(x.mode)==='role'&&!str(x.role))||(str(x.mode)==='user'&&!str(x.uid))||(str(x.mode)==='manager'&&(!Number.isInteger(Number(x.managerLevel))||Number(x.managerLevel)<1||Number(x.managerLevel)>20))))throw new HttpError(400,'Configure between 1 and 20 valid approval steps.');const approvalMode=str(ctx.body.approvalMode),approvalRule=str(ctx.body.approvalRule);if(!['sequential','parallel'].includes(approvalMode)||!['all','any'].includes(approvalRule))throw new HttpError(400,'Invalid execution or decision rule.');const enabled=ctx.body.enabled===true;const terminate=ctx.body.terminateActive===true;const reason=str(ctx.body.terminationReason).trim();const confirmation=str(ctx.body.terminationConfirmation).trim().replace(/\s+/g,' ').toUpperCase();const currentVersion=Number(current.data.version||1);if(Number(ctx.body.expectedVersion)!==currentVersion)throw new HttpError(409,'Workflow has changed. Reload before saving.');const root='organizations/'+ctx.orgId;const affectedCollections=str(current.data.name)==='Material master creation'?[root+'/materials']:str(current.data.name)==='Material warehouse extension'?[root+'/material_extensions']:[];const active=[] as Array<{path:string;data:Obj;id:string}>;for(const col of affectedCollections){for(const item of await listDocs(col)){if(str(item.data.status)==='pending_approval')active.push({path:col+'/'+item.id,data:item.data,id:item.id});}}if(terminate){if(confirmation!=='TERMINATE ACTIVE WORKFLOWS'||reason.length<20)throw new HttpError(400,'HIGH RISK: Type TERMINATE ACTIVE WORKFLOWS and provide a reason of at least 20 characters.');if(active.length>200)throw new HttpError(409,'More than 200 active requests; use a controlled migration.');}if(terminate&&active.length){await audit([{category:'security',action:'HIGH_RISK_WORKFLOW_TERMINATION_INITIATED',actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:code},details:JSON.stringify({severity:'HIGH',reason,oldVersion:currentVersion,newVersion:currentVersion+1,affected:active.map(x=>x.id)})}]);for(const item of active){const history=Array.isArray(item.data.approvalHistory)?item.data.approvalHistory:[];await writeDoc(item.path,{...item.data,status:'workflow_terminated',workflowTermination:{reason,by:ctx.uid,at:nowIso(),workflowCode:code,oldVersion:currentVersion,newVersion:currentVersion+1},approvalHistory:[...history,{action:'terminated',reason,by:ctx.uid,at:nowIso(),risk:'HIGH'}]});}}await writeDoc(path,{...current.data,steps:steps.map(x=>({mode:str(x.mode),role:str(x.role),uid:str(x.uid),managerLevel:Number(x.managerLevel)||1})),approvalMode,approvalRule,enabled,version:Number(current.data.version||0)+1,updatedAt:nowIso(),updatedBy:ctx.uid});await audit([{category:terminate?'security':'data',action:terminate?'HIGH_RISK_WORKFLOW_REPLACED':'workflow.configure',actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:code},details:'Enabled: '+enabled+'; stages: '+steps.length+'; terminated: '+(terminate?active.length:0)+'; reason: '+(terminate?reason:'none')}]);return {ok:true,terminated:terminate?active.length:0};})],
    'POST /api/org/procurement/materials/autosave': [orgRoute('org.procurement.materials.autosave', null, async ctx => {
        requireModule(ctx,'materials');
        if(ctx.role!=='org_super_admin'&&!['PRC.create','PRC.materials.manage','PRC.admin'].some(p=>hasPerm(ctx.permissions,p)))throw new HttpError(403,'Material creation permission required.');
        const data=isObj(ctx.body.data)?ctx.body.data:{};
        const id=str(ctx.body.id)||'MAT-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,7).toUpperCase();
        const path='organizations/'+ctx.orgId+'/materials/'+id;
        const existing=await getDoc(path);
        if(existing&&(!['draft','rejected'].includes(str(existing.data.status))||(ctx.role!=='org_super_admin'&&str(existing.data.createdBy)!==ctx.uid)))throw new HttpError(403,'Draft is not editable.');
        const allowed=['name','shortText','categoryCode','subcategoryCode','familyCode','materialCode','attributes','supplyType','vendorId','partyEntryMode','partyName','oemPartNumber','ocmPartNumber','generalPartNumber','model','versionNumber','materialClassification','warehouseId','costCenterId','assetId','assemblyId','uom','assemblyIds'];
        const patch:Record<string,unknown>={};
        for(const key of allowed)if(key in data)patch[key]=data[key];
        if('attributes' in patch&&!isObj(patch.attributes))throw new HttpError(400,'Invalid attributes.');
        if('assemblyIds' in patch&&(!Array.isArray(patch.assemblyIds)||patch.assemblyIds.length>100))throw new HttpError(400,'Invalid assemblies.');
        if(str(patch.shortText).length>120||str(patch.name).length>160)throw new HttpError(400,'Text too long.');
        await writeDoc(path,{...(existing?.data??{}),...patch,status:existing?.data.status??'draft',createdBy:existing?.data.createdBy??ctx.uid,createdAt:existing?.data.createdAt??nowIso(),updatedBy:ctx.uid,updatedAt:nowIso()});
        return {ok:true,id};
    })],
    'POST /api/org/procurement/materials/extension': [orgRoute('org.procurement.materials.extension', null, async ctx => {
        requireModule(ctx,'materials');
        const sourceId=str(ctx.body.sourceId),warehouseId=str(ctx.body.warehouseId);
        const source=await getDoc('organizations/'+ctx.orgId+'/materials/'+sourceId);
        if(!source||['rejected','deleted','cancelled'].includes(str(source.data.status)))throw new HttpError(400,'Source material is unavailable for extension.');
        if(!['approved','active'].includes(str(source.data.status)))throw new HttpError(409,'Only approved or active materials can be extended. Pending materials must first be approved.');
        const warehouse=await getDoc('organizations/'+ctx.orgId+'/warehouses/'+warehouseId);
        const user=await getDoc('users/'+ctx.uid);
        const allowed=ctx.role==='org_super_admin'?'all':user?await allowedNodeIds(ctx.orgId,user,true):new Set<string>();
        if(!warehouse||(allowed!=='all'&&!allowed.has(warehouseId)))throw new HttpError(403,'Target warehouse is not accessible.');const configured=Array.isArray(warehouse.data.materialCategoryCodes)?warehouse.data.materialCategoryCodes.map(str):[str(warehouse.data.materialCategoryCode)];if(!configured.includes(str(source.data.categoryCode)))throw new HttpError(400,'Warehouse is not configured for this material category.');
        if(warehouseId===str(source.data.warehouseId))throw new HttpError(409,'This material is already assigned to the selected warehouse.');
        const materials=await listDocs('organizations/'+ctx.orgId+'/materials');
        const extensions=await listDocs('organizations/'+ctx.orgId+'/material_extensions');
        if(materials.some(x=>x.id===sourceId&&str(x.data.warehouseId)===warehouseId)||extensions.some(x=>str(x.data.sourceId)===sourceId&&str(x.data.warehouseId)===warehouseId&&!['rejected','cancelled'].includes(str(x.data.status))))throw new HttpError(409,'An extension already exists or is awaiting approval for this warehouse.');
        const flow=await getDoc('organizations/'+ctx.orgId+'/material_workflows/default');
        if(!flow||!Array.isArray(flow.data.roles)||flow.data.roles.length!==3)throw new HttpError(409,'Configure the three-level material approval workflow first.');
        const id='EXT-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,7).toUpperCase();
        await writeDoc('organizations/'+ctx.orgId+'/material_extensions/'+id,{sourceId,warehouseId,materialName:str(source.data.name),shortText:str(source.data.shortText),status:'pending_approval',approvalLevel:1,approvalHistory:[],createdBy:ctx.uid,createdAt:nowIso(),verifiedBy:ctx.uid,verifiedAt:nowIso()},{exists:false});
        await audit([{category:'data',action:'org.material.extension.request',actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:id},details:sourceId+' → '+warehouseId}]);
        return {ok:true,id};
    })],
    'POST /api/org/procurement/materials/extensions': [orgRoute('org.procurement.materials.extensions', null, async ctx => {requireModule(ctx,'materials');const docs=await listDocs('organizations/'+ctx.orgId+'/material_extensions');return {items:docs.map(x=>({id:x.id,...x.data}))};})],
    'POST /api/org/procurement/materials/list': [orgRoute('org.procurement.materials.list', null, async ctx => {
        requireModule(ctx, 'materials');
        const docs = await listDocs('organizations/' + ctx.orgId + '/materials');
        const flow=await getDoc('organizations/'+ctx.orgId+'/material_workflows/default');const currentUser=await getDoc('users/'+ctx.uid);const assignments=Array.isArray(currentUser?.data.assignments)?currentUser.data.assignments:[];const positions=await listDocs('organizations/'+ctx.orgId+'/positions');const parents=new Map(positions.map(x=>[x.id,str(x.data.parentCode)]));const delegated=Array.isArray(flow?.data.delegations)?flow.data.delegations:[];const now=nowIso();const eligible=async(d:Record<string,unknown>)=>{if(str(d.status)!=='pending_approval'||str(d.submittedBy)===ctx.uid||str(d.createdBy)===ctx.uid||approvedEarlierLevel(d.approvalHistory,ctx.uid))return false;const level=Number(d.approvalLevel)||1;const roles=Array.isArray(flow?.data.roles)?flow.data.roles:[];const modes=Array.isArray(flow?.data.modes)?flow.data.modes:[];let role=str(roles[level-1]);if(str(modes[level-1])==='above_creator'){const creator=await getDoc('users/'+str(d.submittedBy));const a=Array.isArray(creator?.data.assignments)?creator.data.assignments:[];let current=str(isObj(a[0])?a[0].positionCode:'');for(let i=0;i<level;i++)current=parents.get(current)||'';role=current;}return !!role&&(ctx.role===role||assignments.some(x=>isObj(x)&&str(x.positionCode)===role)||activeDelegation(delegated,role,ctx.uid));};const items=await Promise.all(docs.map(async d=>({id:d.id,...d.data,canApprove:await eligible(d.data)})));return {items:items.sort((a,b)=>str((b as Record<string,unknown>).createdAt).localeCompare(str((a as Record<string,unknown>).createdAt))),isApprover:(Array.isArray(flow?.data.roles)?flow.data.roles:[]).some(role=>ctx.role===str(role)||assignments.some(x=>isObj(x)&&str(x.positionCode)===str(role))||activeDelegation(delegated,str(role),ctx.uid))||items.some(x=>x.canApprove),currentUserId:ctx.uid};
    })],
    'POST /api/org/procurement/materials/create': [orgRoute('org.procurement.materials.create', null, async ctx => {
        return createMaterialDraft(ctx);
    })],
    'POST /api/org/procurement/materials/update': [orgRoute('org.procurement.materials.update', null, async ctx => { requireModule(ctx, 'materials'); const id=str(ctx.body.id); const path='organizations/'+ctx.orgId+'/materials/'+id; const doc=await getDoc(path); if(!doc) throw new HttpError(404,'Material not found.'); if(!['draft','rejected'].includes(str(doc.data.status))) throw new HttpError(409,'Only drafts and rejected materials may be edited.'); if(ctx.role!=='org_super_admin' && str(doc.data.createdBy)!==ctx.uid) throw new HttpError(403,'Only the creator may edit this draft.'); const data=isObj(ctx.body.data)?ctx.body.data:{}; const allowed=['name','attributes','shortText','supplyType','vendorId','partyEntryMode','partyName','oemPartNumber','ocmPartNumber','generalPartNumber','model','versionNumber','materialClassification','warehouseId','costCenterId','assetId','assemblyId','uom','assemblyIds']; const patch:Record<string,unknown>={}; for(const k of allowed) if(k in data) patch[k]=data[k]; if('shortText' in patch){if(typeof patch.shortText!=='string'||patch.shortText.length>120)throw new HttpError(400,'Short text must be at most 120 characters.');}await writeDoc(path,{...doc.data,...patch,updatedAt:nowIso(),updatedBy:ctx.uid}); await audited(ctx,'procurement.material.draft_update','Material draft '+id,{fields:Object.keys(patch)}); return {ok:true}; })],
    'POST /api/org/procurement/materials/lifecycle': [orgRoute('org.procurement.materials.lifecycle', null, async ctx => {
        requireModule(ctx,'materials');
        if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.permissions,'PRC.materials.manage')&&!hasPerm(ctx.permissions,'PRC.admin'))throw new HttpError(403,'Material lifecycle management permission required.');
        const id=str(ctx.body.id),action=str(ctx.body.action);
        const root='organizations/'+ctx.orgId, path=root+'/materials/'+id;
        const doc=await getDoc(path);if(!doc)throw new HttpError(404,'Material not found.');
        const d=doc.data;const status=str(d.status);
        if(!['approved','active','disabled'].includes(status))throw new HttpError(409,'Only approved materials can be managed here.');
        if(action==='allocate'){
            if(str(d.materialNumber))return {ok:true,materialNumber:str(d.materialNumber)};
            if(status!=='approved')throw new HttpError(409,'Material must be approved and enabled before number allocation.');
            const prefix=str(d.categoryCode).trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
            if(!prefix)throw new HttpError(409,'Material category code is missing.');
            const existing=await listDocs(root+'/material_number_reservations');
            let sequence=existing.filter(x=>x.id.startsWith(prefix+'-')).reduce((n,x)=>Math.max(n,Number(x.id.slice(prefix.length+1))||0),0);
            let number='';for(let attempt=0;attempt<100;attempt++){sequence++;if(sequence>999999)throw new HttpError(409,'Category material number range exhausted.');const candidate=prefix+String(sequence).padStart(6,'0');try{await writeDoc(root+'/material_number_reservations/'+prefix+'-'+String(sequence).padStart(6,'0'),{materialId:id,materialNumber:candidate,categoryCode:prefix,createdAt:nowIso(),createdBy:ctx.uid},{exists:false});number=candidate;break;}catch(e){if(attempt===99)throw e;}}
            if(!number)throw new HttpError(409,'Unable to reserve material number.');
            await writeDoc(path,{...d,materialNumber:number,numberAllocatedAt:nowIso(),numberAllocatedBy:ctx.uid});
            await audit([{category:'data',action:'org.material.number.allocate',actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:id},details:number}]);
            return {ok:true,materialNumber:number};
        }
        if(action==='push'){
            if(!str(d.materialNumber))throw new HttpError(409,'Allocate the material number before pushing to warehouse.');
            if(status!=='approved'&&status!=='active')throw new HttpError(409,'Disabled material cannot be pushed.');
            const warehouseId=str(d.warehouseId);
            const warehouse=await getDoc(root+'/warehouses/'+warehouseId);if(!warehouse)throw new HttpError(409,'Requesting warehouse no longer exists.');
            const whCats=Array.isArray(warehouse.data.materialCategoryCodes)?warehouse.data.materialCategoryCodes.map(str):[str(warehouse.data.materialCategoryCode)];
            if(!whCats.includes(str(d.categoryCode)))throw new HttpError(409,'Warehouse does not support this material category.');
            const ids=Array.isArray(d.warehouseIds)?d.warehouseIds.map(str):[];
            await writeDoc(path,{...d,status:'active',warehouseIds:Array.from(new Set([...ids,warehouseId])),pushedAt:nowIso(),pushedBy:ctx.uid});
            await audit([{category:'data',action:'org.material.warehouse.push',actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:id},details:warehouseId}]);
            return {ok:true};
        }
        if(action==='disable'){await writeDoc(path,{...d,status:'disabled',disabledAt:nowIso(),disabledBy:ctx.uid});await audit([{category:'data',action:'org.material.disable',actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:id},details:'Disabled material'}]);return {ok:true};}
        if(action==='delete'){
            if(status==='active'||str(d.pushedAt))throw new HttpError(409,'Material already pushed to a warehouse cannot be deleted. Disable it instead.');
            await writeDoc(path,{...d,status:'deleted',deletedAt:nowIso(),deletedBy:ctx.uid});
            await audit([{category:'data',action:'org.material.delete.approved',actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:id},details:'Soft deleted approved material'}]);
            return {ok:true};
        }
        throw new HttpError(400,'Unknown lifecycle action.');
    })],
    'POST /api/org/procurement/materials/delete': [orgRoute('org.procurement.materials.delete', null, async ctx => {requireModule(ctx,'materials');const id=str(ctx.body.id);const path='organizations/'+ctx.orgId+'/materials/'+id;const doc=await getDoc(path);if(!doc)throw new HttpError(404,'Material not found.');if(ctx.role!=='org_super_admin'){if(!['draft','rejected'].includes(str(doc.data.status)))throw new HttpError(409,'Only unapproved drafts can be deleted.');if(str(doc.data.createdBy)!==ctx.uid)throw new HttpError(403,'Not your draft.');}await audit([{category:'data',action:'org.material.delete',actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:id},details:JSON.stringify({name:str(doc.data.name),status:str(doc.data.status),deletedBy:ctx.uid})}]);await deleteDoc(path);return {ok:true};})],
    'POST /api/org/procurement/materials/submit': [orgRoute('org.procurement.materials.submit', null, async ctx => {requireModule(ctx,'materials');const id=str(ctx.body.id);const path='organizations/'+ctx.orgId+'/materials/'+id;const doc=await getDoc(path);if(!doc)throw new HttpError(404,'Material not found.');if(!['draft','rejected'].includes(str(doc.data.status)))throw new HttpError(409,'Material cannot be submitted.');if(ctx.role!=='org_super_admin'&&str(doc.data.createdBy)!==ctx.uid)throw new HttpError(403,'Not your draft.');const d=doc.data;const warehouse=await getDoc('organizations/'+ctx.orgId+'/warehouses/'+str(d.warehouseId));const user=await getDoc('users/'+ctx.uid);const allowed=ctx.role==='org_super_admin'?'all':user?await allowedNodeIds(ctx.orgId,user,true):new Set<string>();if(!warehouse||(allowed!=='all'&&!allowed.has(str(d.warehouseId))))throw new HttpError(400,'Choose a warehouse you have access to.');const whCats=Array.isArray(warehouse.data.materialCategoryCodes)?warehouse.data.materialCategoryCodes.map(str):[str(warehouse.data.materialCategoryCode)];if(!whCats.includes(str(d.categoryCode)))throw new HttpError(400,'Warehouse is not configured for this material category.');if(!str(d.materialClassification)||!str(d.uom)||!str(d.supplyType))throw new HttpError(400,'Complete stage 2 mandatory fields.');if(!['OEM','OCM','GENERAL'].includes(str(d.supplyType)))throw new HttpError(400,'Select a valid supply relationship.');const partField=str(d.supplyType)==='OEM'?'oemPartNumber':str(d.supplyType)==='OCM'?'ocmPartNumber':'generalPartNumber';if(!str(d[partField]))throw new HttpError(400,'Enter the applicable part number.');if(str(d.partyEntryMode)==='manual'){if(str(d.partyName).trim().length<2||str(d.partyName).length>160)throw new HttpError(400,'Enter a valid OEM, OCM or supplier name (2–160 characters).');}else if(['OEM','OCM'].includes(str(d.supplyType))){if(!str(d.vendorId)||!(await getDoc('organizations/'+ctx.orgId+'/vendors/'+str(d.vendorId))))throw new HttpError(400,'Select an existing registered vendor or enter the name manually.');}const uomDoc=await getDoc('module_workspaces/PRC/metadata/unitsOfMeasure');if(!Array.isArray(uomDoc?.data.items)||!uomDoc.data.items.some(x=>isObj(x)&&str(x.code)===str(d.uom)&&x.active!==false))throw new HttpError(400,'Choose an enabled UOM from MEMS metadata.');const classificationDoc=await getDoc('module_workspaces/INV/metadata/materialClassifications');if(!Array.isArray(classificationDoc?.data.items)||!classificationDoc.data.items.some(x=>isObj(x)&&str(x.code)===str(d.materialClassification)&&x.active!==false))throw new HttpError(400,'Choose an enabled material classification.');if(str(d.supplyType)==='OEM'){if(!str(d.oemPartNumber)||!str(d.costCenterId)||!str(d.assetId))throw new HttpError(400,'OEM part number, cost center and asset are required.');const nodes=await listDocs('organizations/'+ctx.orgId+'/structure');const byId=new Map(nodes.map(x=>[x.id,x.data]));const cc=byId.get(str(d.costCenterId));const asset=byId.get(str(d.assetId));if(!cc||str(cc.level)!=='cost_center'||(allowed!=='all'&&!allowed.has(str(d.costCenterId)))||!asset||str(asset.level)!=='work_center'||str(asset.parentId)!==str(d.costCenterId))throw new HttpError(400,'Select a valid asset in an accessible cost center.');const selected=Array.isArray(d.assemblyIds)?d.assemblyIds.map(x=>str(x)).filter(Boolean):(str(d.assemblyId)?[str(d.assemblyId)]:[]);if(new Set(selected).size!==selected.length)throw new HttpError(400,'Duplicate assembly selection.');for(const assemblyId of selected){const assembly=byId.get(assemblyId);if(!assembly||str(assembly.level)!=='assembly'||str(assembly.parentId)!==str(d.assetId))throw new HttpError(400,'Every selected assembly must belong to the selected asset.');}}const peers=await listDocs('organizations/'+ctx.orgId+'/materials');const normalize=(v:unknown)=>str(v).trim().toLowerCase().replace(/[^a-z0-9]+/g,'');const a=isObj(d.attributes)?d.attributes:{};const keys=Object.keys(a).filter(k=>str(a[k]).trim());for(const peer of peers){if(peer.id===id||['rejected','cancelled','deleted'].includes(str(peer.data.status).toLowerCase()))continue;const p=peer.data;const pk=str(p.supplyType)==='OEM'?'oemPartNumber':str(p.supplyType)==='OCM'?'ocmPartNumber':'generalPartNumber';if(str(p.supplyType)!==str(d.supplyType)||!normalize(d[partField])||normalize(d[partField])!==normalize(p[pk]))continue;const pa=isObj(p.attributes)?p.attributes:{};const attributeScore=keys.length?keys.filter(k=>normalize(a[k])===normalize(pa[k])).length/keys.length*25:0;const score=Math.round((normalize(d.categoryCode)===normalize(p.categoryCode)?10:0)+(normalize(d.subcategoryCode)===normalize(p.subcategoryCode)?15:0)+(normalize(d.familyCode)===normalize(p.familyCode)?20:0)+(normalize(d.materialCode)===normalize(p.materialCode)?25:0)+attributeScore+(normalize(d.name)===normalize(p.name)?5:0));if(score>90)throw new HttpError(409,'REPEAT MATERIAL: '+peer.id+' matches the same part number at '+score+'% similarity. Extend the existing material instead.');}const configured=await getDoc('organizations/'+ctx.orgId+'/workflow_registry/PRC-001');const steps=Array.isArray(configured?.data.steps)?configured.data.steps:[];const modernEnabled=configured?.data.enabled===true;const validModern=modernEnabled&&steps.length>=1&&steps.length<=20&&steps.every(x=>isObj(x)&&(['role','user','manager'].includes(str(x.mode)))&&(str(x.mode)==='role'?!!str(x.role):str(x.mode)==='user'?!!str(x.uid):Number.isInteger(Number(x.managerLevel))&&Number(x.managerLevel)>=1&&Number(x.managerLevel)<=20));if(modernEnabled&&!validModern)throw new HttpError(409,'The Material master creation workflow (PRC-001) is enabled but has incomplete approval steps. Open Administration → Workflow configuration and assign an approver for each step.');if(!modernEnabled){const flow=await getDoc('organizations/'+ctx.orgId+'/material_workflows/default');if(!flow||!Array.isArray(flow.data.roles)||flow.data.roles.length!==3||flow.data.roles.some((x,i)=>str((Array.isArray(flow.data.modes)?flow.data.modes:[])[i])!=='above_creator'&&!str(x)))throw new HttpError(409,'Set up Material master creation (PRC-001) in Administration → Workflow configuration: choose an approver or position, enable the workflow and save. The older three-role configuration also remains supported.');}await writeDoc(path,{...d,status:'pending_approval',approvalLevel:1,approvalHistory:[],submittedBy:ctx.uid,submittedAt:nowIso()});await audited(ctx,'procurement.material.submit','Material '+id,{warehouseId:str(d.warehouseId),categoryCode:str(d.categoryCode)});return {ok:true};})],
    'POST /api/org/procurement/materials/workflow': [orgRoute('org.procurement.materials.workflow', null, async ctx => {requireModule(ctx,'materials');const path='organizations/'+ctx.orgId+'/material_workflows/default';if(ctx.body.roles){if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.permissions,'ADM.workflows'))throw new HttpError(403,'Workflow administrator required.');const modes=Array.isArray(ctx.body.modes)?ctx.body.modes.map(str):['role','role','role'];const roles=Array.isArray(ctx.body.roles)?ctx.body.roles.map(str):[];if(roles.length!==3||modes.length!==3||modes.some(x=>!['role','above_creator'].includes(x))||roles.some((x,i)=>modes[i]==='role'&&!x))throw new HttpError(400,'Configure three valid approval levels.');const positionDocs=await listDocs('organizations/'+ctx.orgId+'/positions');const known=new Set(positionDocs.map(x=>str(x.data.code)));if(known.size&&roles.some((x,i)=>modes[i]==='role'&&!known.has(x)))throw new HttpError(400,'Choose existing organization positions.');const delegations=await validMaterialDelegations(ctx,ctx.body.delegations);const before=await getDoc(path);await writeDoc(path,{roles,modes,delegations,updatedAt:nowIso(),updatedBy:ctx.uid});await audited(ctx,'procurement.material.workflow.save','Material approval workflow',{roles,modes,delegations,previous:{roles:before?.data.roles??[],modes:before?.data.modes??[],delegations:before?.data.delegations??[]}});}const doc=await getDoc(path);return {roles:doc?.data.roles??[],modes:doc?.data.modes??['role','role','role'],delegations:doc?.data.delegations??[]};})],
    'POST /api/org/procurement/materials/approve': [orgRoute('org.procurement.materials.approve', null, async ctx => {requireModule(ctx,'materials');const id=str(ctx.body.id);const path='organizations/'+ctx.orgId+'/materials/'+id;const doc=await getDoc(path);if(!doc||str(doc.data.status)!=='pending_approval')throw new HttpError(409,'No pending approval.');if(str(doc.data.submittedBy)===ctx.uid||str(doc.data.createdBy)===ctx.uid)throw new HttpError(403,'Requester cannot approve own material.');if(approvedEarlierLevel(doc.data.approvalHistory,ctx.uid))throw new HttpError(403,'You already approved an earlier level of this material. Another person must decide this level.');const flow=await getDoc('organizations/'+ctx.orgId+'/material_workflows/default');const level=Number(doc.data.approvalLevel)||1;let role=str(Array.isArray(flow?.data.roles)?flow?.data.roles[level-1]:'');const mode=str(Array.isArray(flow?.data.modes)?flow?.data.modes[level-1]:'role');if(mode==='above_creator'&&!(await getDoc('organizations/'+ctx.orgId+'/workflow_registry/'+(path.includes('material_extensions')?'PRC-002':'PRC-001')))?.data.enabled){const creator=await getDoc('users/'+str(doc.data.submittedBy));const original=Array.isArray(creator?.data.assignments)?creator.data.assignments:[];let current=str(isObj(original[0])?original[0].positionCode:'');const positions=await listDocs('organizations/'+ctx.orgId+'/positions');const parents=new Map(positions.map(x=>[x.id,str(x.data.parentCode)]));for(let i=0;i<level;i++){current=parents.get(current)||'';}if(!current)throw new HttpError(409,'The creator has no position at the required reporting level.');role=current;}const approverUser=await getDoc('users/'+ctx.uid);const assignments=Array.isArray(approverUser?.data.assignments)?approverUser.data.assignments:[];const delegated=Array.isArray(flow?.data.delegations)?flow?.data.delegations:[];const authorized=ctx.role===role||assignments.some(x=>isObj(x)&&str(x.positionCode)===role)||activeDelegation(delegated,role,ctx.uid);const configured=await getDoc('organizations/'+ctx.orgId+'/workflow_registry/'+(path.includes('material_extensions')?'PRC-002':'PRC-001'));const steps=Array.isArray(configured?.data.steps)?configured.data.steps:[];const configuredStep:Obj|null=isObj(steps[level-1])?steps[level-1] as Obj:null;let mappedAuthorized=false;if(configured?.data.enabled===true){if(!configuredStep)throw new HttpError(409,'No approver configured for this workflow stage.');if(str(configuredStep.mode)==='user')mappedAuthorized=str(configuredStep.uid)===ctx.uid;else if(str(configuredStep.mode)==='role')mappedAuthorized=ctx.role===str(configuredStep.role)||assignments.some(x=>isObj(x)&&str(x.positionCode)===str(configuredStep.role));else if(str(configuredStep.mode)==='manager'){const requester=await getDoc('users/'+str(path.includes('material_extensions')?doc.data.createdBy:doc.data.submittedBy));const ra=Array.isArray(requester?.data.assignments)?requester.data.assignments:[];let position=str(isObj(ra[0])?ra[0].positionCode:'');const positions=await listDocs('organizations/'+ctx.orgId+'/positions');const parents=new Map(positions.map(x=>[x.id,str(x.data.parentCode)]));for(let k=0;k<Number(configuredStep.managerLevel||1);k++)position=parents.get(position)||'';mappedAuthorized=!!position&&assignments.some(x=>isObj(x)&&str(x.positionCode)===position);} }if(!(configured?.data.enabled===true?mappedAuthorized:authorized))throw new HttpError(403,'This approval level is assigned to another employee or position.');const decision=str(ctx.body.decision);if(!['approve','reject'].includes(decision))throw new HttpError(400,'Choose approve or reject.');if(decision==='reject'&&str(ctx.body.comment).trim().length<10)throw new HttpError(400,'Give the reason for rejecting (at least 10 characters).');const history=Array.isArray(doc.data.approvalHistory)?doc.data.approvalHistory:[];const next=decision==='reject'?'rejected':level===(configured?.data.enabled===true?steps.length:3)?'approved':'pending_approval';await writeDoc(path,{...doc.data,status:next,approvalLevel:next==='pending_approval'?level+1:level,approvalHistory:[...history,{level,role:configured?.data.enabled===true?str(isObj(configuredStep)&&str(configuredStep.mode)==='user'?configuredStep.uid:isObj(configuredStep)?configuredStep.role:''):role,decision,by:ctx.uid,at:nowIso(),comment:str(ctx.body.comment)}],approvedAt:next==='approved'?nowIso():null});await audited(ctx,'procurement.material.'+decision,'Material '+(str(doc.data.materialNumber)||id),{level,status:next,comment:str(ctx.body.comment).slice(0,300)});return {ok:true,status:next};})],
        'POST /api/org/procurement/materials/extension/approve': [orgRoute('org.procurement.materials.extension.approve', null, async ctx => {requireModule(ctx,'materials');const id=str(ctx.body.id);const path='organizations/'+ctx.orgId+'/material_extensions/'+id;const doc=await getDoc(path);if(!doc||str(doc.data.status)!=='pending_approval')throw new HttpError(409,'No pending approval.');if(str(doc.data.createdBy)===ctx.uid)throw new HttpError(403,'Requester cannot approve own extension.');if(approvedEarlierLevel(doc.data.approvalHistory,ctx.uid))throw new HttpError(403,'You already approved an earlier level of this extension. Another person must decide this level.');const flow=await getDoc('organizations/'+ctx.orgId+'/material_workflows/default');const level=Number(doc.data.approvalLevel)||1;let role=str(Array.isArray(flow?.data.roles)?flow?.data.roles[level-1]:'');const mode=str(Array.isArray(flow?.data.modes)?flow?.data.modes[level-1]:'role');if(mode==='above_creator'&&!(await getDoc('organizations/'+ctx.orgId+'/workflow_registry/'+(path.includes('material_extensions')?'PRC-002':'PRC-001')))?.data.enabled){const creator=await getDoc('users/'+str(doc.data.createdBy));const original=Array.isArray(creator?.data.assignments)?creator.data.assignments:[];let current=str(isObj(original[0])?original[0].positionCode:'');const positions=await listDocs('organizations/'+ctx.orgId+'/positions');const parents=new Map(positions.map(x=>[x.id,str(x.data.parentCode)]));for(let i=0;i<level;i++){current=parents.get(current)||'';}if(!current)throw new HttpError(409,'The creator has no position at the required reporting level.');role=current;}const approverUser=await getDoc('users/'+ctx.uid);const assignments=Array.isArray(approverUser?.data.assignments)?approverUser.data.assignments:[];const delegated=Array.isArray(flow?.data.delegations)?flow?.data.delegations:[];const authorized=ctx.role===role||assignments.some(x=>isObj(x)&&str(x.positionCode)===role)||activeDelegation(delegated,role,ctx.uid);const configured=await getDoc('organizations/'+ctx.orgId+'/workflow_registry/'+(path.includes('material_extensions')?'PRC-002':'PRC-001'));const steps=Array.isArray(configured?.data.steps)?configured.data.steps:[];const configuredStep:Obj|null=isObj(steps[level-1])?steps[level-1] as Obj:null;let mappedAuthorized=false;if(configured?.data.enabled===true){if(!configuredStep)throw new HttpError(409,'No approver configured for this workflow stage.');if(str(configuredStep.mode)==='user')mappedAuthorized=str(configuredStep.uid)===ctx.uid;else if(str(configuredStep.mode)==='role')mappedAuthorized=ctx.role===str(configuredStep.role)||assignments.some(x=>isObj(x)&&str(x.positionCode)===str(configuredStep.role));else if(str(configuredStep.mode)==='manager'){const requester=await getDoc('users/'+str(path.includes('material_extensions')?doc.data.createdBy:doc.data.submittedBy));const ra=Array.isArray(requester?.data.assignments)?requester.data.assignments:[];let position=str(isObj(ra[0])?ra[0].positionCode:'');const positions=await listDocs('organizations/'+ctx.orgId+'/positions');const parents=new Map(positions.map(x=>[x.id,str(x.data.parentCode)]));for(let k=0;k<Number(configuredStep.managerLevel||1);k++)position=parents.get(position)||'';mappedAuthorized=!!position&&assignments.some(x=>isObj(x)&&str(x.positionCode)===position);} }if(!(configured?.data.enabled===true?mappedAuthorized:authorized))throw new HttpError(403,'This approval level is assigned to another employee or position.');const decision=str(ctx.body.decision);if(!['approve','reject'].includes(decision))throw new HttpError(400,'Choose approve or reject.');if(decision==='reject'&&str(ctx.body.comment).trim().length<10)throw new HttpError(400,'Give the reason for rejecting (at least 10 characters).');const history=Array.isArray(doc.data.approvalHistory)?doc.data.approvalHistory:[];const next=decision==='reject'?'rejected':level===(configured?.data.enabled===true?steps.length:3)?'approved':'pending_approval';await writeDoc(path,{...doc.data,status:next,approvalLevel:next==='pending_approval'?level+1:level,approvalHistory:[...history,{level,role:configured?.data.enabled===true?str(isObj(configuredStep)&&str(configuredStep.mode)==='user'?configuredStep.uid:isObj(configuredStep)?configuredStep.role:''):role,decision,by:ctx.uid,at:nowIso(),comment:str(ctx.body.comment)}],approvedAt:next==='approved'?nowIso():null});if(next==='approved'){const sourcePath='organizations/'+ctx.orgId+'/materials/'+str(doc.data.sourceId);const source=await getDoc(sourcePath);if(!source)throw new HttpError(404,'Original material no longer exists.');const warehouses=Array.isArray(source.data.warehouseIds)?source.data.warehouseIds.map(x=>str(x)):[str(source.data.warehouseId)];const target=str(doc.data.warehouseId);await writeDoc(sourcePath,{...source.data,warehouseIds:Array.from(new Set([...warehouses,target])),updatedAt:nowIso()});}await audited(ctx,'procurement.material_extension.'+decision,'Extension '+id,{level,status:next,warehouseId:str(doc.data.warehouseId),comment:str(ctx.body.comment).slice(0,300)});return {ok:true,status:next};})],
    ...catalogRoutes('procurement', ['materials', 'services']),
    ...catalogRoutes('finance', ['gl_accounts']),
};

