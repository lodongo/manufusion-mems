import { createHash } from 'crypto';
import {
    HttpError,
    DOCUMENT_NAME_ROOT,
    encodeFields,
    googleRequest,
    deleteDoc,
    getDoc,
    isObj,
    listDocs,
    nowIso,
    num,
    str,
    text,
    updateFields,
    writeDoc,
    type Doc,
    type Fields,
    type Obj,
    type Plain,
} from './core';
import { audit } from './audit';
import { hasPerm, orgRoute, staff, type OrgContext, type SecureContext } from './guards';
import { allowedNodeIds, nextOrgCounter } from './positions';
import { identicalAssetEquipmentClass, assetIsAssignable, unitIsAssignable } from './assetEquipmentRules';

// ---------------------------------------------------------------------------
// Asset Management (AST)
//
// 1. Asset master dictionary (MEMS-wide reference, versioned):
//    module_workspaces/AST/settings/dictionary                { activeVid, ... } pointer
//    module_workspaces/AST/dictionary_versions/{vid}          version record and status
//    module_workspaces/AST/dictionary_versions/{vid}/upload/* raw upload chunks (deleted after processing)
//    module_workspaces/AST/dictionary_versions/{vid}/parts/*  validated sections stored as JSON text
//    Upload and validation by MEMS admins; activation by a super admin only, after typing the version.
//
// 2. Organization asset register:
//    organizations/{orgId}/assets/{AST-000001}
//    Maker-checker workflow: draft -> pending_approval -> active; changes and disposals of active assets
//    also need approval. The approver can never be the person who submitted (segregation of duties).
//    Users only see and use assets inside their assigned organization scope.
// ---------------------------------------------------------------------------

const AST_ROOT = 'module_workspaces/AST';
// Must be a document path (even number of segments). The earlier path module_workspaces/AST/dictionary named a
// collection, so Firestore rejected the write with 400 INVALID_ARGUMENT and the catalog never showed as loaded.
const POINTER = `${AST_ROOT}/settings/dictionary`;
const VERSIONS = `${AST_ROOT}/dictionary_versions`;
const MAX_UPLOAD_BYTES = 12_000_000;
const MAX_CHUNKS = 60;
const PART_BYTES = 700_000;
const SECTIONS = ['attributeDomains', 'attributes', 'profiles', 'groups', 'categories', 'subcategories', 'assetClasses'] as const;
type Section = (typeof SECTIONS)[number];
const DATA_TYPES = ['text', 'integer', 'decimal', 'boolean', 'date', 'enum', 'multi_select', 'country', 'currency', 'file'];
const VID_RE = /^v\d{1,3}_\d{1,3}_\d{1,3}$/;
const TAG_RE = /^AST-\d{6}$/;
const NODE_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const LOCATION_LEVELS = ['site', 'department', 'cost_center', 'work_center'];

const vidOf = (version: string) => `v${version.replace(/\./g, '_')}`;
/** Any sensible code: letters, digits and common separators. No codification format is imposed on the catalog. */
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._ \/-]{0,59}$/;
/** The one catalog kept in the database; each upload overrides it. */
const CATALOG_VID = 'current';
const STAGING = `${VERSIONS}/staging`;

function rec(ctx: SecureContext, category: string, action: string, target: string, details = '', orgId = '') {
    return audit([{ category, action, actor: ctx.actor, meta: ctx.meta, target: { label: target }, details, orgId }]);
}

// ----- Dictionary validation -----

interface Dict {
    header: Obj;
    attributeDomains: Obj[];
    attributes: Obj[];
    profiles: Obj[];
    groups: Obj[];
    categories: Obj[];
    subcategories: Obj[];
    assetClasses: Obj[];
}

const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

function validateDictionary(raw: unknown): { dict: Dict; errors: string[]; warnings: string[]; stats: Record<string, number> } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const err = (m: string) => {
        if (errors.length < 60) errors.push(m);
    };
    if (!isObj(raw)) throw new HttpError(400, 'The file is not a dictionary object.');
    const dict: Dict = {
        header: {},
        attributeDomains: arr(raw.attributeDomains),
        attributes: arr(raw.attributes),
        profiles: arr(raw.profiles),
        groups: arr(raw.groups),
        categories: arr(raw.categories),
        subcategories: arr(raw.subcategories),
        assetClasses: arr(raw.assetClasses),
    };
    for (const [k, v] of Object.entries(raw)) if (!(SECTIONS as readonly string[]).includes(k)) dict.header[k] = v as Plain;

    const unique = (list: Obj[], label: string, re: RegExp) => {
        const seen = new Set<string>();
        for (const item of list) {
            const code = str(item.code);
            if (!re.test(code)) err(`${label}: invalid code "${code.slice(0, 40)}".`);
            else if (seen.has(code)) err(`${label}: duplicate code ${code}.`);
            seen.add(code);
            if (str(item.name).trim().length < 2) err(`${label} ${code}: name is missing.`);
            if (str(item.name).length > 160) err(`${label} ${code}: name is too long.`);
            if (str(item.description).length > 2000) err(`${label} ${code}: description is too long.`);
        }
        return seen;
    };

    const domains = unique(dict.attributeDomains, 'Attribute domain', CODE_RE);
    const attrs = unique(dict.attributes, 'Attribute', CODE_RE);
    for (const a of dict.attributes) {
        const code = str(a.code);
        if (!domains.has(str(a.domain))) err(`Attribute ${code}: unknown domain ${str(a.domain)}.`);
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
    const profiles = unique(dict.profiles, 'Profile', CODE_RE);
    for (const p of dict.profiles) for (const a of arr(p.attributes)) if (!attrs.has(str(a.code))) err(`Profile ${str(p.code)}: unknown attribute ${str(a.code)}.`);
    const groups = unique(dict.groups, 'Group', CODE_RE);
    const cats = unique(dict.categories, 'Category', CODE_RE);
    for (const c of dict.categories) if (!groups.has(str(c.groupCode))) err(`Category ${str(c.code)}: group ${str(c.groupCode)} does not match.`);
    const subs = unique(dict.subcategories, 'Subcategory', CODE_RE);
    for (const s of dict.subcategories) if (!cats.has(str(s.categoryCode))) err(`Subcategory ${str(s.code)}: category ${str(s.categoryCode)} does not match.`);
    unique(dict.assetClasses, 'Asset class', CODE_RE);
    for (const c of dict.assetClasses) {
        const code = str(c.code);
        if (!subs.has(str(c.subcategoryCode))) err(`Asset class ${code}: subcategory ${str(c.subcategoryCode)} does not match.`);
        for (const p of strs(c.profiles)) if (!profiles.has(p)) err(`Asset class ${code}: unknown profile ${p}.`);
        const list = strs(c.attributes);
        for (const a of list) if (!attrs.has(a)) err(`Asset class ${code}: unknown attribute ${a}.`);
        const listSet = new Set(list);
        for (const a of strs(c.requiredAttributes)) if (!listSet.has(a)) err(`Asset class ${code}: required attribute ${a} is not in its attribute list.`);
        if (!list.length) warnings.push(`Asset class ${code} has no attributes.`);
    }
    if (!dict.assetClasses.length) err('No asset classes found.');
    const stats = {
        groups: dict.groups.length,
        categories: dict.categories.length,
        subcategories: dict.subcategories.length,
        assetClasses: dict.assetClasses.length,
        attributes: dict.attributes.length,
        profiles: dict.profiles.length,
        attributeDomains: dict.attributeDomains.length,
    };
    return { dict, errors, warnings: warnings.slice(0, 30), stats };
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

// ----- Dictionary loading (cached per warm instance) -----

interface Loaded {
    vid: string;
    version: string;
    header: Obj;
    attributes: Map<string, Obj>;
    domains: Obj[];
    profiles: Map<string, Obj>;
    groups: Obj[];
    categories: Obj[];
    subcategories: Obj[];
    classes: Map<string, Obj>;
}

const cache = new Map<string, Loaded>();

async function loadVersion(vid: string, base: string = VERSIONS): Promise<Loaded> {
    const cacheKey = `${base}/${vid}`;
    const hit = cache.get(cacheKey);
    if (hit) return hit;
    const doc = await getDoc(`${base}/${vid}`);
    if (!doc || !['validated', 'active', 'superseded', 'imported'].includes(str(doc.data.status))) throw new HttpError(404, 'Dictionary version not available.');
    const counts = isObj(doc.data.sections) ? doc.data.sections : {};
    const read = async (section: Section): Promise<Obj[]> => {
        const n = num(counts[section]) ?? 0;
        const docs = await Promise.all(Array.from({ length: n }, (_, i) => getDoc(`${base}/${vid}/parts/${section}_${i}`)));
        return docs.flatMap((d) => {
            try {
                return arr(JSON.parse(str(d?.data.json) || '[]'));
            } catch {
                return [];
            }
        });
    };
    const [domains, attributes, profiles, groups, categories, subcategories, classes] = await Promise.all(SECTIONS.map(read));
    let header: Obj = {};
    try {
        header = JSON.parse(str(doc.data.headerJson) || '{}') as Obj;
    } catch {
        header = {};
    }
    const loaded: Loaded = {
        vid,
        version: str(doc.data.version),
        header,
        domains,
        attributes: new Map(attributes.map((a) => [str(a.code), a])),
        profiles: new Map(profiles.map((p) => [str(p.code), p])),
        groups,
        categories,
        subcategories,
        classes: new Map(classes.map((c) => [str(c.code), c])),
    };
    if (cache.size > 6) cache.clear();
    cache.set(cacheKey, loaded);
    return loaded;
}

const loadedStamp = new Map<string, string>();

async function activeDictionary(): Promise<Loaded> {
    const pointer = await getDoc(POINTER);
    const vid = str(pointer?.data.activeVid);
    if (!vid) throw new HttpError(400, 'The asset catalog has not been loaded yet. A MEMS administrator uploads it under MEMS Admin, Asset catalog.');
    // Uploads override the catalog in place, so drop a cached copy older than the last upload.
    const key = `${VERSIONS}/${vid}`;
    const stamp = str(pointer?.data.activatedAt);
    if (loadedStamp.get(key) !== stamp) {
        cache.delete(key);
        loadedStamp.set(key, stamp);
    }
    return loadVersion(vid);
}

/** Asset classes under one category and subcategory, for the purchase requirement dropdowns. Null when the catalog is not loaded. */
export async function assetClassTree(categoryCode: string, subcategoryCode: string): Promise<{ families: Array<{ code: string; name: string }>; items: Array<{ code: string; name: string; familyCode: string }> } | null> {
    let d: Loaded;
    try {
        d = await activeDictionary();
    } catch {
        return null;
    }
    const items = Array.from(d.classes.values())
        .filter((c) => str(c.categoryCode) === categoryCode && str(c.subcategoryCode) === subcategoryCode)
        .map((c) => ({ code: str(c.code), name: str(c.name), familyCode: '' }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 1500);
    return { families: [], items };
}

/** The technical attributes of one asset class (mandatory ones flagged, files left out). Null when missing. */
export async function assetClassSpec(code: string): Promise<{
    code: string;
    name: string;
    categoryCode: string;
    subcategoryCode: string;
    familyCode: string;
    attributes: Array<{ code: string; name: string; dataType: string; unit: string; options: Array<{ code: string; label: string }>; validation: Record<string, unknown>; required: boolean }>;
} | null> {
    let d: Loaded;
    try {
        d = await activeDictionary();
    } catch {
        return null;
    }
    if (!d.classes.has(code)) return null;
    const o = classOut(d, code);
    return {
        code: o.code,
        name: o.name,
        categoryCode: o.categoryCode,
        subcategoryCode: o.subcategoryCode,
        familyCode: '',
        attributes: o.attributes
            .filter((a) => a.dataType !== 'file' && a.code !== 'ATT-IDN-001')
            .map((a) => ({ code: a.code, name: a.name, dataType: a.dataType, unit: a.unit, options: a.options, validation: a.validation as Record<string, unknown>, required: a.required })),
    };
}

/** Categories, subcategories and classes of the published asset catalog, for procurement. Null when not loaded. */
export async function assetCatalogSummary(): Promise<{
    categories: Array<{ code: string; name: string; subcategories: Array<{ code: string; name: string }> }>;
    items: Array<{ code: string; name: string; categoryCode: string; subcategoryCode: string }>;
} | null> {
    let d: Loaded;
    try {
        d = await activeDictionary();
    } catch {
        return null;
    }
    return {
        categories: d.categories
            .map((c) => ({
                code: str(c.code),
                name: str(c.name),
                subcategories: d.subcategories
                    .filter((s) => str(s.categoryCode) === str(c.code))
                    .map((s) => ({ code: str(s.code), name: str(s.name) }))
                    .sort((a, b) => a.code.localeCompare(b.code)),
            }))
            .filter((c) => c.code)
            .sort((a, b) => a.code.localeCompare(b.code)),
        items: Array.from(d.classes.values()).map((i) => ({ code: str(i.code), name: str(i.name), categoryCode: str(i.categoryCode), subcategoryCode: str(i.subcategoryCode) })),
    };
}

const orgDictBase = (orgId: string) => `organizations/${orgId}/asset_dictionary`;

/** The organization's own saved copy of the asset master data (imported from the MEMS active version). */
async function orgDictionary(ctx: OrgContext): Promise<Loaded> {
    // Organizations read the asset catalog straight from the database and configure their own assets from it.
    void ctx;
    return activeDictionary();
}

/**
 * Copies the MEMS published asset catalog into organizations/{orgId}/asset_dictionary/{vid}, verifies the copy
 * and records it on the organization. confirm = null means an automatic first-use import.
 */
async function importDictionaryToOrg(ctx: OrgContext, confirm: string | null): Promise<Loaded> {
    const pointer = await getDoc(POINTER);
    const vid = str(pointer?.data.activeVid);
    if (!vid) throw new HttpError(400, 'MEMS has not published the asset catalog yet. A MEMS administrator publishes it under MEMS Admin, Asset catalog.');
    const source = await getDoc(`${VERSIONS}/${vid}`);
    if (!source || str(source.data.status) !== 'active') throw new HttpError(400, 'The MEMS asset catalog is not available right now.');
    const version = str(source.data.version);
    if (confirm !== null && confirm !== version) throw new HttpError(400, 'Type the version number exactly to confirm.');
    const meta = isObj(ctx.org.data.assetDictionary) ? ctx.org.data.assetDictionary : {};
    if (str(meta.vid) === vid) {
        if (confirm !== null) throw new HttpError(409, `Version ${version} is already saved to your organization.`);
        return loadVersion(vid, orgDictBase(ctx.orgId));
    }
    const base = orgDictBase(ctx.orgId);
    const counts = isObj(source.data.sections) ? source.data.sections : {};
    const sections: Record<string, number> = {};
    for (const section of SECTIONS) {
        const n = num(counts[section]) ?? 0;
        sections[section] = n;
        for (let i = 0; i < n; i++) {
            const part = await getDoc(`${VERSIONS}/${vid}/parts/${section}_${i}`);
            if (!part) throw new HttpError(500, 'The MEMS asset catalog is incomplete. Please contact MEMS support.');
            await writeDoc(`${base}/${vid}/parts/${section}_${i}`, { section, index: i, json: str(part.data.json) });
        }
    }
    const now = nowIso();
    const stats = isObj(source.data.stats) ? source.data.stats : {};
    await writeDoc(`${base}/${vid}`, {
        version,
        status: 'imported',
        sections,
        headerJson: str(source.data.headerJson),
        stats,
        sourceVid: vid,
        sourceSha256: str(source.data.sha256),
        importedAt: now,
        importedBy: ctx.uid,
        importedByName: displayName(ctx),
        automatic: confirm === null,
    });
    cache.delete(`${base}/${vid}`);
    const check = await loadVersion(vid, base);
    if (check.classes.size !== (num(stats.assetClasses) ?? check.classes.size)) throw new HttpError(500, 'The saved copy did not verify. Please try again.');
    const saved: Obj = { vid, version, importedAt: now, importedBy: ctx.uid, importedByName: displayName(ctx), stats, previousVid: str(meta.vid), automatic: confirm === null };
    await updateFields(`organizations/${ctx.orgId}`, { assetDictionary: saved });
    ctx.org.data.assetDictionary = saved;
    await rec(
        ctx,
        'data',
        'org.assets.dictionary.imported',
        `Asset catalog ${version}`,
        `${check.classes.size} classes, ${check.attributes.size} attributes saved to the organization${confirm === null ? ' automatically on first use' : ''}${str(meta.version) ? `, replacing ${str(meta.version)}` : ''}`,
        ctx.orgId
    );
    return check;
}

const canAdministerAssets = (ctx: OrgContext) => ctx.role === 'org_super_admin' || hasPerm(ctx.permissions, 'AST.admin');

/** The catalog is read by asset users and by organization designers (to classify equipment units). */
function needCatalogAccess(ctx: OrgContext) {
    if (!hasPerm(ctx.permissions, 'AST.view') && !hasPerm(ctx.permissions, 'ADM.structure')) throw new HttpError(403, 'You do not have permission to do this.');
}

function treeOut(d: Loaded) {
    return {
        version: d.version,
        vid: d.vid,
        name: str(d.header.dictionaryName),
        codingScheme: d.header.codingScheme ?? null,
        domains: d.domains.map((x) => ({ code: str(x.code), name: str(x.name) })),
        groups: d.groups.map((g) => ({ code: str(g.code), name: str(g.name), description: str(g.description), profiles: strs(g.profiles) })),
        categories: d.categories.map((c) => ({ code: str(c.code), groupCode: str(c.groupCode), name: str(c.name), description: str(c.description), profiles: strs(c.profiles), usefulLifeYears: c.usefulLifeYears ?? null })),
        subcategories: d.subcategories.map((s) => ({ code: str(s.code), categoryCode: str(s.categoryCode), name: str(s.name), description: str(s.description), profiles: strs(s.profiles) })),
        classes: Array.from(d.classes.values()).map((c) => ({
            code: str(c.code),
            subcategoryCode: str(c.subcategoryCode),
            categoryCode: str(c.categoryCode),
            groupCode: str(c.groupCode),
            name: str(c.name),
            description: str(c.description),
            synonyms: strs(c.synonyms),
            attributeCount: strs(c.attributes).length,
            requiredCount: strs(c.requiredAttributes).length,
            usefulLifeYears: c.usefulLifeYears ?? null,
        })),
    };
}

function classOut(d: Loaded, code: string) {
    const c = d.classes.get(code);
    if (!c) throw new HttpError(404, 'Asset class not found in the active dictionary.');
    const required = new Set(strs(c.requiredAttributes));
    const specific = new Set(strs(c.specificAttributes));
    const domainName = new Map(d.domains.map((x) => [str(x.code), str(x.name)]));
    return {
        code,
        name: str(c.name),
        description: str(c.description),
        groupCode: str(c.groupCode),
        categoryCode: str(c.categoryCode),
        subcategoryCode: str(c.subcategoryCode),
        profiles: strs(c.profiles).map((p) => ({ code: p, name: str(d.profiles.get(p)?.name) })),
        synonyms: strs(c.synonyms),
        usefulLifeYears: c.usefulLifeYears ?? null,
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

// ----- Asset attribute validation -----

type ClassInfo = ReturnType<typeof classOut>;

async function refCodes() {
    const [c, cur] = await Promise.all([getDoc('reference/countries'), getDoc('reference/currencies')]);
    const items = (doc: Doc | null) => (Array.isArray(doc?.data.items) ? (doc?.data.items as Plain[]).filter(isObj) : []);
    return { countries: new Set(items(c).map((x) => str(x.iso2))), currencies: new Set(items(cur).map((x) => str(x.code))) };
}

async function readAssetAttributes(info: ClassInfo, raw: unknown, enforceRequired: boolean): Promise<Obj> {
    const input = isObj(raw) ? raw : {};
    const out: Obj = {};
    let refs: Awaited<ReturnType<typeof refCodes>> | null = null;
    for (const a of info.attributes) {
        if (a.code === 'ATT-IDN-001' || a.dataType === 'file') continue;
        const v = input[a.code];
        const blank = v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
        if (blank) {
            if (enforceRequired && a.required) throw new HttpError(400, `${a.name} is required for this asset class.`);
            continue;
        }
        const val = a.validation as Obj;
        const min = num(val.minimum);
        const max = num(val.maximum);
        switch (a.dataType) {
            case 'integer':
            case 'decimal': {
                const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
                if (!Number.isFinite(n) || (a.dataType === 'integer' && !Number.isInteger(n))) throw new HttpError(400, `${a.name} must be a ${a.dataType === 'integer' ? 'whole number' : 'number'}.`);
                if (min !== null && n < min) throw new HttpError(400, `${a.name} must be at least ${min}.`);
                if (max !== null && n > max) throw new HttpError(400, `${a.name} must be at most ${max}.`);
                if (Math.abs(n) > 1e15) throw new HttpError(400, `${a.name} is too large.`);
                out[a.code] = n;
                break;
            }
            case 'boolean':
                if (v !== true && v !== false && v !== 'true' && v !== 'false') throw new HttpError(400, `${a.name} must be yes or no.`);
                out[a.code] = v === true || v === 'true';
                break;
            case 'date': {
                const s = str(v);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, `Enter a valid date for ${a.name}.`);
                out[a.code] = s;
                break;
            }
            case 'enum': {
                const s = str(v);
                if (!a.options.some((o) => o.code === s)) throw new HttpError(400, `Choose a valid option for ${a.name}.`);
                out[a.code] = s;
                break;
            }
            case 'multi_select': {
                const list = Array.isArray(v) ? v.map(str) : [];
                if (!list.length || new Set(list).size !== list.length || list.some((s) => !a.options.some((o) => o.code === s))) throw new HttpError(400, `Choose valid options for ${a.name}.`);
                out[a.code] = list;
                break;
            }
            case 'country':
            case 'currency': {
                refs ??= await refCodes();
                const s = str(v);
                if (!(a.dataType === 'country' ? refs.countries : refs.currencies).has(s)) throw new HttpError(400, `Choose a valid ${a.dataType} for ${a.name}.`);
                out[a.code] = s;
                break;
            }
            default: {
                const s = str(v).trim();
                const maxLength = num(val.maxLength) ?? 500;
                if (s.length > Math.min(maxLength, 2000)) throw new HttpError(400, `${a.name} can be up to ${maxLength} characters.`);
                const pattern = str(val.pattern);
                if (pattern) {
                    let re: RegExp | null = null;
                    try {
                        re = new RegExp(pattern);
                    } catch {
                        re = null;
                    }
                    if (re && !re.test(s)) throw new HttpError(400, `${a.name} is not in the expected format.`);
                }
                out[a.code] = s;
            }
        }
    }
    return out;
}

// ----- Organization helpers -----

const assetCol = (orgId: string) => `organizations/${orgId}/assets`;
const structPath = (orgId: string, id: string) => `organizations/${orgId}/structure/${id}`;

function requireAst(ctx: OrgContext) {
    const map = isObj(ctx.org.data.modules) ? ctx.org.data.modules : {};
    if (map.AST !== true) throw new HttpError(403, 'Asset Management (AST) is not enabled for your organization. Adopt and enable it under Modules.');
}

function displayName(ctx: OrgContext) {
    return `${str(ctx.me.data.firstName)} ${str(ctx.me.data.lastName)}`.trim() || ctx.actor.email;
}

async function scopeOf(ctx: OrgContext): Promise<Set<string> | 'all'> {
    if (ctx.role === 'org_super_admin') return 'all';
    return allowedNodeIds(ctx.orgId, ctx.me);
}

const inScope = (scope: Set<string> | 'all', nodeId: string) => scope === 'all' || scope.has(nodeId);

/** Walks up the organization design to find the site and legal entity of a unit. */
async function lineage(orgId: string, nodeId: string) {
    const chain: Doc[] = [];
    let id = nodeId;
    for (let i = 0; i < 15 && id && id !== 'root'; i++) {
        const doc = NODE_ID_RE.test(id) ? await getDoc(structPath(orgId, id)) : null;
        if (!doc) break;
        chain.push(doc);
        id = str(doc.data.parentId);
    }
    const site = chain.find((d) => str(d.data.level) === 'site');
    const le = chain.find((d) => str(d.data.level) === 'legal_entity');
    return { node: chain[0] ?? null, siteId: site?.id ?? '', legalEntityId: le?.id ?? '' };
}

function assetOut(doc: Doc, full = false) {
    const d = doc.data;
    const base = {
        tag: doc.id,
        name: str(d.name),
        classCode: str(d.classCode),
        className: str(d.className),
        groupCode: str(d.groupCode),
        categoryCode: str(d.categoryCode),
        subcategoryCode: str(d.subcategoryCode),
        dictionaryVersion: str(d.dictionaryVersion),
        nodeId: str(d.nodeId),
        nodeCode: str(d.nodeCode),
        nodeName: str(d.nodeName),
        nodeLevel: str(d.nodeLevel),
        siteId: str(d.siteId),
        workCenterId: str(d.workCenterId),
        workCenterCode: str(d.workCenterCode),
        status: str(d.status) || 'draft',
        createdAt: str(d.createdAt),
        createdByName: str(d.createdByName),
        updatedAt: str(d.updatedAt),
        submittedByName: str(d.submittedByName),
        approvedByName: str(d.approvedByName),
        approvedAt: str(d.approvedAt),
        completeness: num(d.completeness) ?? 0,
    };
    if (!full) return base;
    return {
        ...base,
        description: str(d.description),
        attributes: isObj(d.attributes) ? d.attributes : {},
        pending: isObj(d.pending) ? d.pending : null,
        pendingNote: str(d.pendingNote),
        submittedBy: str(d.submittedBy),
        createdBy: str(d.createdBy),
        attributesConfirmedByName: str(d.attributesConfirmedByName),
        attributesConfirmedAt: str(d.attributesConfirmedAt),
        history: (Array.isArray(d.history) ? d.history : []).filter(isObj).slice(-50),
    };
}

async function getAsset(ctx: OrgContext, tag: string, scope?: Set<string> | 'all'): Promise<Doc> {
    const doc = TAG_RE.test(tag) ? await getDoc(`${assetCol(ctx.orgId)}/${tag}`) : null;
    if (!doc) throw new HttpError(404, 'Asset not found.');
    const s = scope ?? (await scopeOf(ctx));
    if (!inScope(s, str(doc.data.nodeId))) throw new HttpError(403, 'This asset is outside your assigned scope.');
    return doc;
}

function withHistory(doc: Doc, ctx: OrgContext, action: string, note = ''): Plain[] {
    const prev = (Array.isArray(doc.data.history) ? doc.data.history : []).filter(isObj) as Plain[];
    const entry: Obj = { at: nowIso(), by: ctx.uid, byName: displayName(ctx), action, note: note.slice(0, 300) };
    return [...prev, entry].slice(-50);
}

function completeness(info: ClassInfo, attrs: Obj): number {
    const req = info.attributes.filter((a) => a.required && a.dataType !== 'file' && a.code !== 'ATT-IDN-001');
    if (!req.length) return 100;
    return Math.round((req.filter((a) => attrs[a.code] !== undefined).length / req.length) * 100);
}

function unitClassification(ctx: OrgContext, classCode: string): Promise<{ classCode: string; categoryCode: string; subcategoryCode: string }> {
    return orgDictionary(ctx).then((dict) => {
        const cls = dict.classes.get(classCode);
        if (!cls) throw new HttpError(400, 'The selected equipment class is missing from the active asset catalogue.');
        return { classCode, categoryCode: str(cls.categoryCode), subcategoryCode: str(cls.subcategoryCode) };
    });
}

async function matchingEquipmentClass(ctx: OrgContext, unit: Doc, asset: Doc): Promise<void> {
    const attrs = isObj(unit.data.attributes) ? unit.data.attributes : {};
    const code = str(attrs.equipmentClass);
    if (!code) throw new HttpError(409, 'Choose an equipment class before linking an asset.');
    const equipment = await unitClassification(ctx, code);
    if (!identicalAssetEquipmentClass(asset.data, equipment)) {
        throw new HttpError(409, 'The asset and equipment must match in category, subcategory and class. Select another compatible record.');
    }
}

/** Use a conditional atomic commit to avoid one-to-many mappings when two users click Save together. */
async function commitAssetEquipmentWrites(writes: Array<{ path: string; fields: Fields; updateTime?: string; create?: boolean }>): Promise<void> {
    const request = writes.map((w) => ({
        update: { name: `${DOCUMENT_NAME_ROOT}/${w.path}`, fields: encodeFields(w.fields) },
        ...(w.create ? { currentDocument: { exists: false } } : {
            updateMask: { fieldPaths: Object.keys(w.fields) },
            currentDocument: { updateTime: w.updateTime },
        }),
    }));
    const result = await googleRequest(`https://firestore.googleapis.com/v1/${DOCUMENT_NAME_ROOT}:commit`, 'POST', { writes: request });
    if (!result.ok) {
        if ([400, 409, 412].includes(result.status)) throw new HttpError(409, 'This asset or equipment changed while you were configuring it. Refresh to see the current mapping and try again.');
        throw new HttpError(503, `Asset/equipment mapping was not saved (HTTP ${result.status}). Please retry.`);
    }
}

/** Also inspect the reverse pointer, to catch legacy or interrupted mappings. */
async function assertNoConflictingReverseLinks(ctx: OrgContext, unitId: string, tag: string) {
    const [units, assets] = await Promise.all([
        listDocs(`organizations/${ctx.orgId}/structure`), listDocs(assetCol(ctx.orgId)),
    ]);
    const otherUnit = units.find((u) => u.id !== unitId && str(u.data.level) === 'work_center'
        && isObj(u.data.attributes) && str(u.data.attributes.assetTag) === tag);
    if (otherUnit) throw new HttpError(409, `Asset ${tag} is already referenced by equipment ${str(otherUnit.data.code)}. Resolve that mapping first.`);
    const anotherAsset = assets.find((a) => a.id !== tag && str(a.data.workCenterId) === unitId
        && !['disposed', 'deleted'].includes(str(a.data.status)));
    if (anotherAsset) throw new HttpError(409, `Equipment is already referenced by asset ${anotherAsset.id}. Resolve that mapping first.`);
}

/** Validates that an asset can be linked to a work center. Returns the asset name. */
export async function checkWorkCenterAsset(ctx: OrgContext, parentId: string, workCenterId: string, tag: string): Promise<string> {
    if (!TAG_RE.test(tag)) throw new HttpError(400, 'Choose an asset from the list.');
    const asset = await getDoc(`${assetCol(ctx.orgId)}/${tag}`);
    if (!asset) throw new HttpError(404, 'Asset not found. Refresh the list.');
    if (!assetIsAssignable(asset.data, workCenterId)) throw new HttpError(409, `${tag} is already assigned to another equipment unit or not available.`);
    const unit = await getDoc(structPath(ctx.orgId, workCenterId));
    if (!unit || str(unit.data.level) !== 'work_center') throw new HttpError(404, 'The equipment unit no longer exists.');
    const wcAttrs = isObj(unit.data.attributes) ? unit.data.attributes : {};
    if (!unitIsAssignable(wcAttrs, tag)) throw new HttpError(409, 'The equipment unit is already mapped to another asset.');
    await matchingEquipmentClass(ctx, unit, asset);
    await assertNoConflictingReverseLinks(ctx, workCenterId, tag);
    const { siteId } = await lineage(ctx.orgId, parentId);
    if (str(asset.data.siteId) && siteId && str(asset.data.siteId) !== siteId) throw new HttpError(409, 'Asset and equipment must be located at the same site.');
    return str(asset.data.name);
}

/** Updates both sides of a one-to-one mapping in the same optimistic Firestore commit.
 * Existing approved assets are never silently replaced with new draft assets.
 */
export async function linkWorkCenterAsset(ctx: OrgContext, workCenter: { id: string; code: string; parentId: string }, previousTag: string, tag: string): Promise<string> {
    const unitPath = structPath(ctx.orgId, workCenter.id);
    const unit = await getDoc(unitPath);
    if (!unit) throw new HttpError(404, 'Equipment no longer exists.');
    const attrs: Obj = isObj(unit.data.attributes) ? { ...unit.data.attributes } : {};
    const currentTag = str(attrs.assetTag);
    if (currentTag && currentTag !== previousTag) throw new HttpError(409, 'Equipment mapping changed. Refresh and try again.');
    if (tag && previousTag && previousTag !== tag) throw new HttpError(409, 'Unlink the previous asset before selecting another.');
    const now = nowIso();
    const writes: Array<{ path: string; fields: Fields; updateTime?: string }> = [];
    let name = '';
    if (tag) {
        name = await checkWorkCenterAsset(ctx, workCenter.parentId, workCenter.id, tag);
        const asset = await getDoc(`${assetCol(ctx.orgId)}/${tag}`);
        if (!asset) throw new HttpError(404, 'Asset no longer exists.');
        attrs.assetTag = tag;
        attrs.assetTagName = name;
        if (str(asset.data.workCenterId) !== workCenter.id || str(asset.data.workCenterCode) !== workCenter.code) {
            writes.push({ path: `${assetCol(ctx.orgId)}/${tag}`,
                fields: { workCenterId: workCenter.id, workCenterCode: workCenter.code,
                    history: withHistory(asset, ctx, 'linked', `Linked to equipment unit ${workCenter.code}`),
                    updatedAt: now }, updateTime: asset.updateTime });
        }
    } else {
        if (!previousTag) throw new HttpError(400, 'Nothing to unlink.');
        const asset = await getDoc(`${assetCol(ctx.orgId)}/${previousTag}`);
        if (asset && str(asset.data.workCenterId) === workCenter.id) {
            writes.push({ path: `${assetCol(ctx.orgId)}/${previousTag}`,
                fields: { workCenterId: '', workCenterCode: '',
                    history: withHistory(asset, ctx, 'unlinked', `Unlinked from equipment unit ${workCenter.code}`), updatedAt: now },
                updateTime: asset.updateTime });
        }
        delete attrs.assetTag;
        delete attrs.assetTagName;
    }
    writes.push({ path: unitPath, fields: { attributes: attrs, updatedAt: now }, updateTime: unit.updateTime });
    await commitAssetEquipmentWrites(writes);
    await rec(ctx, 'data', tag ? 'org.assets.linked' : 'org.assets.unlinked',
        tag || previousTag, `Equipment ${workCenter.code}; one asset per unit`, ctx.orgId);
    return name;
}

async function unlinkFromWorkCenter(ctx: OrgContext, asset: Doc) {
    const wcId = str(asset.data.workCenterId);
    if (!wcId || !NODE_ID_RE.test(wcId)) return;
    const wc = await getDoc(structPath(ctx.orgId, wcId));
    if (!wc || !isObj(wc.data.attributes) || str(wc.data.attributes.assetTag) !== asset.id) return;
    const attributes = { ...wc.data.attributes };
    delete attributes.assetTag;
    delete attributes.assetTagName;
    await updateFields(structPath(ctx.orgId, wcId), { attributes, updatedAt: nowIso() });
}

async function renameOnWorkCenter(ctx: OrgContext, wcId: string, tag: string, name: string) {
    if (!NODE_ID_RE.test(wcId)) return;
    const wc = await getDoc(structPath(ctx.orgId, wcId));
    if (!wc || !isObj(wc.data.attributes) || str(wc.data.attributes.assetTag) !== tag || str(wc.data.attributes.assetTagName) === name) return;
    await updateFields(structPath(ctx.orgId, wcId), { attributes: { ...wc.data.attributes, assetTagName: name }, updatedAt: nowIso() });
}

/** Equipment units are classified from the organization's asset catalog. Returns null when no class applies. */
export async function readUnitClass(ctx: OrgContext, code: string, required: boolean): Promise<{ code: string; name: string } | null> {
    const modules = isObj(ctx.org.data.modules) ? ctx.org.data.modules : {};
    if (modules.AST !== true) {
        if (code) throw new HttpError(400, 'Enable Asset Management (AST) under Modules to classify equipment units.');
        return null;
    }
    if (!code) {
        if (required) throw new HttpError(400, 'Choose the equipment class from the asset catalog.');
        return null;
    }
    if (!CODE_RE.test(code)) throw new HttpError(400, 'Choose an equipment class from the asset catalog.');
    const dict = await orgDictionary(ctx);
    const c = dict.classes.get(code);
    if (!c) throw new HttpError(400, 'Choose an equipment class from the asset catalog.');
    return { code, name: str(c.name) };
}

/** Creates the draft asset that represents a new equipment unit, so its attributes can be configured and confirmed. */
export async function createUnitAsset(ctx: OrgContext, unit: { id: string; code: string; name: string }, classCode: string): Promise<string> {
    const dict = await orgDictionary(ctx);
    const c = dict.classes.get(classCode);
    if (!c) throw new HttpError(400, 'Choose an equipment class from the asset catalog.');
    const info = classOut(dict, classCode);
    const { siteId, legalEntityId } = await lineage(ctx.orgId, unit.id);
    const seq = await nextOrgCounter(ctx.orgId, 'assetSeq');
    if (seq > 999999) throw new HttpError(400, 'Asset numbering is exhausted.');
    const tag = `AST-${String(seq).padStart(6, '0')}`;
    const now = nowIso();
    const attributes: Obj = { 'ATT-IDN-001': unit.name };
    const data: Fields = {
        name: unit.name,
        description: '',
        classCode,
        className: str(c.name),
        groupCode: str(c.groupCode),
        categoryCode: str(c.categoryCode),
        subcategoryCode: str(c.subcategoryCode),
        dictionaryVersion: dict.version,
        attributes,
        nodeId: unit.id,
        nodeCode: unit.code,
        nodeName: unit.name,
        nodeLevel: 'work_center',
        siteId,
        legalEntityId,
        workCenterId: unit.id,
        workCenterCode: unit.code,
        status: 'draft',
        completeness: completeness(info, attributes),
        createdAt: now,
        createdBy: ctx.uid,
        createdByName: displayName(ctx),
        updatedAt: now,
        history: [{ at: now, by: ctx.uid, byName: displayName(ctx), action: 'created', note: `Created with equipment unit ${unit.code}` }],
    };
    const unitDoc = await getDoc(structPath(ctx.orgId, unit.id));
    if (!unitDoc) throw new HttpError(404, 'Equipment unit not found.');
    const unitAttrs: Obj = isObj(unitDoc.data.attributes) ? { ...unitDoc.data.attributes } : {};
    if (!unitIsAssignable(unitAttrs)) throw new HttpError(409, 'The equipment is already mapped to an asset.');
    await commitAssetEquipmentWrites([
        { path: `${assetCol(ctx.orgId)}/${tag}`, fields: data, create: true },
        { path: structPath(ctx.orgId, unit.id), fields: { attributes: { ...unitAttrs, assetTag: tag, assetTagName: unit.name }, updatedAt: now }, updateTime: unitDoc.updateTime },
    ]);
    await rec(ctx, 'data', 'org.assets.create', `${tag} ${unit.name}`, `${classCode} ${str(c.name)} for equipment unit ${unit.code}`, ctx.orgId);
    return tag;
}

/** When an equipment unit is deleted: a never-approved draft asset goes with it, an approved asset is only unlinked. */
export async function releaseUnitAsset(ctx: OrgContext, unit: Doc): Promise<void> {
    const tag = isObj(unit.data.attributes) ? str(unit.data.attributes.assetTag) : '';
    if (!TAG_RE.test(tag)) return;
    const asset = await getDoc(`${assetCol(ctx.orgId)}/${tag}`);
    if (!asset) return;
    const status = str(asset.data.status);
    if (['pending_approval', 'change_pending', 'disposal_pending'].includes(status)) throw new HttpError(400, `${tag} is waiting for approval. Have it decided before deleting the equipment unit.`);
    if (['draft', 'rejected'].includes(status) && !str(asset.data.approvedAt)) {
        await deleteDoc(`${assetCol(ctx.orgId)}/${tag}`);
        await rec(ctx, 'data', 'org.assets.delete', `${tag} ${str(asset.data.name)}`, `Draft removed with equipment unit ${str(unit.data.code)}`, ctx.orgId);
        return;
    }
    await linkWorkCenterAsset(ctx, { id: unit.id, code: str(unit.data.code), parentId: str(unit.data.parentId) }, tag, '');
}

async function getWorkCenter(ctx: OrgContext, id: string, scope: Set<string> | 'all'): Promise<Doc> {
    const wc = NODE_ID_RE.test(id) ? await getDoc(structPath(ctx.orgId, id)) : null;
    if (!wc || str(wc.data.level) !== 'work_center') throw new HttpError(404, 'Equipment unit not found.');
    if (!inScope(scope, wc.id)) throw new HttpError(403, 'This equipment unit is outside your assigned scope.');
    return wc;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const assetRoutes = {
    // ----- MEMS admin: dictionary versions -----
    'POST /api/admin/assets/dictionary/status': [
        staff('admin.assets.dictionary.status', 'read', async () => {
            const [pointer, versions] = await Promise.all([getDoc(POINTER), listDocs(VERSIONS)]);
            return {
                activeVid: str(pointer?.data.activeVid),
                activeVersion: str(pointer?.data.activeVersion),
                activatedAt: str(pointer?.data.activatedAt),
                activatedBy: str(pointer?.data.activatedBy),
                versions: versions
                    .map((v) => ({
                        vid: v.id,
                        version: str(v.data.version),
                        status: str(v.data.status),
                        size: num(v.data.size) ?? 0,
                        sha256: str(v.data.sha256),
                        uploadedBy: str(v.data.uploadedBy),
                        createdAt: str(v.data.createdAt),
                        validatedAt: str(v.data.validatedAt),
                        stats: isObj(v.data.stats) ? v.data.stats : {},
                        errors: strs(v.data.errors),
                        warnings: strs(v.data.warnings),
                        received: num(v.data.received) ?? 0,
                        totalChunks: num(v.data.totalChunks) ?? 0,
                    }))
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
            };
        }),
    ],

    'POST /api/admin/assets/dictionary/upload/begin': [
        staff('admin.assets.dictionary.begin', 'write', async (ctx) => {
            if (ctx.body.legacy !== true) throw new HttpError(410, 'The asset catalog is now uploaded under MEMS Admin, Asset catalog.');
            const version = str(ctx.body.version);
            if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version)) throw new HttpError(400, 'The file must declare a version such as 2.0.0.');
            const size = Number(ctx.body.size);
            const totalChunks = Number(ctx.body.totalChunks);
            const sha256 = str(ctx.body.sha256);
            if (!Number.isInteger(size) || size < 100 || size > MAX_UPLOAD_BYTES) throw new HttpError(400, 'The file must be between 100 bytes and 12 MB.');
            if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS) throw new HttpError(400, 'Invalid chunk count.');
            if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(400, 'Invalid checksum.');
            const vid = vidOf(version);
            const existing = await getDoc(`${VERSIONS}/${vid}`);
            if (existing && ['validated', 'active', 'superseded'].includes(str(existing.data.status))) {
                throw new HttpError(409, `Version ${version} already exists. Dictionary versions are never overwritten; give the new file a higher version.`);
            }
            if (existing) for (const d of await listDocs(`${VERSIONS}/${vid}/upload`)) await deleteDoc(`${VERSIONS}/${vid}/upload/${d.id}`);
            await writeDoc(`${VERSIONS}/${vid}`, { version, status: 'uploading', size, sha256, totalChunks, received: 0, uploadedBy: ctx.actor.email, createdAt: nowIso() });
            await rec(ctx, 'admin', 'assets.dictionary.upload', `Dictionary ${version}`, `${size} bytes in ${totalChunks} parts`);
            return { vid };
        }),
    ],

    'POST /api/admin/assets/dictionary/upload/chunk': [
        staff('admin.assets.dictionary.chunk', 'write', async (ctx) => {
            if (ctx.body.legacy !== true) throw new HttpError(410, 'The asset catalog is now uploaded under MEMS Admin, Asset catalog.');
            const vid = str(ctx.body.vid);
            const index = Number(ctx.body.index);
            const data = str(ctx.body.data);
            if (!VID_RE.test(vid)) throw new HttpError(400, 'Invalid version.');
            const v = await getDoc(`${VERSIONS}/${vid}`);
            if (!v || str(v.data.status) !== 'uploading') throw new HttpError(400, 'Start the upload again.');
            const total = num(v.data.totalChunks) ?? 0;
            if (!Number.isInteger(index) || index < 0 || index >= total) throw new HttpError(400, 'Invalid part number.');
            if (!data || Buffer.byteLength(data, 'utf8') > 900_000) throw new HttpError(400, 'Each part must be under 900 KB.');
            await writeDoc(`${VERSIONS}/${vid}/upload/${String(index).padStart(3, '0')}`, { index, data });
            await updateFields(`${VERSIONS}/${vid}`, { received: index + 1 });
            return { ok: true };
        }),
    ],

    'POST /api/admin/assets/dictionary/upload/finish': [
        staff('admin.assets.dictionary.finish', 'write', async (ctx) => {
            if (ctx.body.legacy !== true) throw new HttpError(410, 'The asset catalog is now uploaded under MEMS Admin, Asset catalog.');
            const vid = str(ctx.body.vid);
            if (!VID_RE.test(vid)) throw new HttpError(400, 'Invalid version.');
            const v = await getDoc(`${VERSIONS}/${vid}`);
            if (!v || str(v.data.status) !== 'uploading') throw new HttpError(400, 'Start the upload again.');
            const total = num(v.data.totalChunks) ?? 0;
            const chunks = (await listDocs(`${VERSIONS}/${vid}/upload`)).sort((a, b) => (num(a.data.index) ?? 0) - (num(b.data.index) ?? 0));
            const cleanup = async () => {
                for (const c of chunks) await deleteDoc(`${VERSIONS}/${vid}/upload/${c.id}`);
            };
            const failWith = async (errors: string[]) => {
                await cleanup();
                await updateFields(`${VERSIONS}/${vid}`, { status: 'failed', errors, validatedAt: nowIso() });
                await rec(ctx, 'admin', 'assets.dictionary.rejected', `Dictionary ${str(v.data.version)}`, errors.slice(0, 3).join(' | '));
                return { ok: false, errors, warnings: [] as string[], stats: {} };
            };
            if (chunks.length !== total || chunks.some((c, i) => num(c.data.index) !== i)) return failWith(['Some parts of the file did not arrive. Upload it again.']);
            const textAll = chunks.map((c) => str(c.data.data)).join('');
            const bytes = Buffer.from(textAll, 'utf8');
            if (bytes.length !== num(v.data.size)) return failWith([`Size mismatch: expected ${num(v.data.size)} bytes, received ${bytes.length}.`]);
            if (createHash('sha256').update(bytes).digest('hex') !== str(v.data.sha256)) return failWith(['Checksum mismatch: the file was altered or corrupted during upload.']);
            let parsed: unknown;
            try {
                parsed = JSON.parse(textAll);
            } catch {
                return failWith(['The file is not valid JSON.']);
            }
            const { dict, errors, warnings, stats } = validateDictionary(parsed);
            if (isObj(parsed) && vidOf(str(parsed.version)) !== vid) errors.unshift('The version inside the file does not match the upload.');
            if (errors.length) return failWith(errors);
            const headerJson = JSON.stringify(dict.header);
            if (Buffer.byteLength(headerJson, 'utf8') > 200_000) return failWith(['The dictionary header is too large.']);
            const sections: Record<string, number> = {};
            for (const section of SECTIONS) {
                const parts = splitParts(dict[section]);
                sections[section] = parts.length;
                for (let i = 0; i < parts.length; i++) await writeDoc(`${VERSIONS}/${vid}/parts/${section}_${i}`, { section, index: i, json: parts[i] });
            }
            await cleanup();
            await updateFields(`${VERSIONS}/${vid}`, { status: 'validated', validatedAt: nowIso(), stats, sections, headerJson, errors: [], warnings });
            cache.delete(`${VERSIONS}/${vid}`);
            await rec(ctx, 'admin', 'assets.dictionary.validated', `Dictionary ${str(v.data.version)}`, `${stats.assetClasses} classes, ${stats.attributes} attributes, ${warnings.length} warnings`);
            return { ok: true, errors: [], warnings, stats };
        }),
    ],

    'POST /api/admin/assets/dictionary/activate': [
        staff('admin.assets.dictionary.activate', 'super', async (ctx) => {
            if (ctx.body.legacy !== true) throw new HttpError(410, 'The asset catalog is now uploaded under MEMS Admin, Asset catalog.');
            const vid = str(ctx.body.vid);
            if (!VID_RE.test(vid)) throw new HttpError(400, 'Invalid version.');
            const v = await getDoc(`${VERSIONS}/${vid}`);
            if (!v || !['validated', 'superseded'].includes(str(v.data.status))) throw new HttpError(400, 'Only a validated version can be published.');
            if (str(ctx.body.confirm) !== str(v.data.version)) throw new HttpError(400, 'Type the version number exactly to confirm.');
            const pointer = await getDoc(POINTER);
            const previous = str(pointer?.data.activeVid);
            await loadVersion(vid);
            if (previous && previous !== vid) await updateFields(`${VERSIONS}/${previous}`, { status: 'superseded', supersededAt: nowIso() });
            const now = nowIso();
            await updateFields(`${VERSIONS}/${vid}`, { status: 'active', activatedAt: now, activatedBy: ctx.actor.email });
            await writeDoc(POINTER, { activeVid: vid, activeVersion: str(v.data.version), activatedAt: now, activatedBy: ctx.actor.email, previousVid: previous, stats: isObj(v.data.stats) ? v.data.stats : {} });
            await rec(ctx, 'admin', 'assets.dictionary.activated', `Dictionary ${str(v.data.version)}`, previous ? `Replaces ${previous}` : 'First active version');
            return { ok: true };
        }),
    ],

    'POST /api/admin/assets/dictionary/discard': [
        staff('admin.assets.dictionary.discard', 'write', async (ctx) => {
            if (ctx.body.legacy !== true) throw new HttpError(410, 'The asset catalog is now uploaded under MEMS Admin, Asset catalog.');
            const vid = str(ctx.body.vid);
            if (!VID_RE.test(vid)) throw new HttpError(400, 'Invalid version.');
            const v = await getDoc(`${VERSIONS}/${vid}`);
            if (!v) throw new HttpError(404, 'Version not found.');
            if (['active', 'superseded'].includes(str(v.data.status))) throw new HttpError(400, 'Versions that were active are kept for traceability and cannot be removed.');
            if (str(ctx.body.confirm) !== str(v.data.version)) throw new HttpError(400, 'Type the version number exactly to confirm.');
            for (const sub of ['upload', 'parts']) for (const d of await listDocs(`${VERSIONS}/${vid}/${sub}`)) await deleteDoc(`${VERSIONS}/${vid}/${sub}/${d.id}`);
            await deleteDoc(`${VERSIONS}/${vid}`);
            cache.delete(`${VERSIONS}/${vid}`);
            await rec(ctx, 'admin', 'assets.dictionary.discarded', `Dictionary ${str(v.data.version)}`);
            return { ok: true };
        }),
    ],

    // ----- MEMS admin: the asset catalog (one catalog in the database; each upload overrides it) -----
    'POST /api/admin/assets/catalog/status': [
        staff('admin.assets.catalog.status', 'read', async () => {
            const pointer = await getDoc(POINTER);
            const vid = str(pointer?.data.activeVid);
            const doc = vid ? await getDoc(`${VERSIONS}/${vid}`) : null;
            return {
                loaded: !!vid,
                version: str(pointer?.data.activeVersion),
                fileName: str(doc?.data.fileName),
                loadedAt: str(pointer?.data.activatedAt),
                loadedBy: str(pointer?.data.activatedBy),
                size: num(doc?.data.size) ?? 0,
                sha256: str(doc?.data.sha256),
                stats: isObj(pointer?.data.stats) ? pointer?.data.stats : {},
            };
        }),
    ],

    'POST /api/admin/assets/catalog/begin': [
        staff('admin.assets.catalog.begin', 'write', async (ctx) => {
            const size = Number(ctx.body.size);
            const totalChunks = Number(ctx.body.totalChunks);
            const sha256 = str(ctx.body.sha256);
            const fileName = str(ctx.body.fileName).replace(/[^\w .()-]/g, '').slice(0, 120);
            if (!Number.isInteger(size) || size < 100 || size > MAX_UPLOAD_BYTES) throw new HttpError(400, 'The file must be between 100 bytes and 12 MB.');
            if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS) throw new HttpError(400, 'Invalid number of parts.');
            if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(400, 'Invalid checksum.');
            for (const d of await listDocs(`${STAGING}/upload`)) await deleteDoc(`${STAGING}/upload/${d.id}`);
            await writeDoc(STAGING, { status: 'uploading', size, sha256, totalChunks, fileName, received: 0, uploadedBy: ctx.actor.email, createdAt: nowIso() });
            return { ok: true };
        }),
    ],

    'POST /api/admin/assets/catalog/chunk': [
        staff('admin.assets.catalog.chunk', 'write', async (ctx) => {
            const index = Number(ctx.body.index);
            const data = str(ctx.body.data);
            const s = await getDoc(STAGING);
            if (!s || str(s.data.status) !== 'uploading' || str(s.data.uploadedBy) !== ctx.actor.email) throw new HttpError(400, 'Start the upload again.');
            const total = num(s.data.totalChunks) ?? 0;
            if (!Number.isInteger(index) || index < 0 || index >= total) throw new HttpError(400, 'Invalid part number.');
            if (!data || Buffer.byteLength(data, 'utf8') > 900_000) throw new HttpError(400, 'Each part must be under 900 KB.');
            await writeDoc(`${STAGING}/upload/${String(index).padStart(3, '0')}`, { index, data });
            return { ok: true };
        }),
    ],

    'POST /api/admin/assets/catalog/finish': [
        staff('admin.assets.catalog.finish', 'write', async (ctx) => {
            const s = await getDoc(STAGING);
            if (!s || str(s.data.status) !== 'uploading' || str(s.data.uploadedBy) !== ctx.actor.email) throw new HttpError(400, 'Start the upload again.');
            const total = num(s.data.totalChunks) ?? 0;
            const chunks = (await listDocs(`${STAGING}/upload`)).sort((a, b) => (num(a.data.index) ?? 0) - (num(b.data.index) ?? 0));
            const cleanup = async () => {
                for (const c of chunks) await deleteDoc(`${STAGING}/upload/${c.id}`);
                await deleteDoc(STAGING);
            };
            const reject = async (errors: string[], warnings: string[] = []) => {
                await cleanup();
                await rec(ctx, 'admin', 'assets.catalog.rejected', str(s.data.fileName) || 'Asset catalog', errors.slice(0, 3).join(' | '));
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
            const { dict, errors, warnings, stats } = validateDictionary(parsed);
            if (errors.length) return reject(errors, warnings);
            const headerJson = JSON.stringify(dict.header);
            if (Buffer.byteLength(headerJson, 'utf8') > 200_000) return reject(['The catalog header is too large.']);
            const base = `${VERSIONS}/${CATALOG_VID}`;
            const before = await listDocs(`${base}/parts`);
            const written = new Set<string>();
            const sections: Record<string, number> = {};
            for (const section of SECTIONS) {
                const parts = splitParts(dict[section]);
                sections[section] = parts.length;
                for (let i = 0; i < parts.length; i++) {
                    await writeDoc(`${base}/parts/${section}_${i}`, { section, index: i, json: parts[i] });
                    written.add(`${section}_${i}`);
                }
            }
            for (const p of before) if (!written.has(p.id)) await deleteDoc(`${base}/parts/${p.id}`);
            const now = nowIso();
            const label = isObj(parsed) ? str(parsed.version).slice(0, 40) : '';
            const pointer = await getDoc(POINTER);
            const previous = str(pointer?.data.activeVid);
            await writeDoc(base, {
                version: label,
                status: 'active',
                fileName: str(s.data.fileName),
                size: num(s.data.size) ?? 0,
                sha256: str(s.data.sha256),
                stats,
                sections,
                headerJson,
                warnings,
                loadedAt: now,
                loadedBy: ctx.actor.email,
            });
            await writeDoc(POINTER, { activeVid: CATALOG_VID, activeVersion: label, activatedAt: now, activatedBy: ctx.actor.email, stats, previousLoadedAt: str(pointer?.data.activatedAt) });
            if (previous && previous !== CATALOG_VID) await updateFields(`${VERSIONS}/${previous}`, { status: 'superseded', supersededAt: now });
            cache.delete(base);
            await cleanup();
            await rec(
                ctx,
                'admin',
                'assets.catalog.loaded',
                str(s.data.fileName) || 'Asset catalog',
                `${stats.assetClasses} classes, ${stats.attributes} attributes saved to the database${pointer ? `, replacing the catalog loaded ${str(pointer.data.activatedAt)} by ${str(pointer.data.activatedBy)}` : ''}`
            );
            return { ok: true, errors: [], warnings, stats };
        }),
    ],

    'POST /api/admin/assets/catalog/export': [
        staff('admin.assets.catalog.export', 'read', async (ctx) => {
            const d = await activeDictionary();
            await rec(ctx, 'admin', 'assets.catalog.exported', 'Asset catalog', 'Downloaded');
            return {
                ...d.header,
                attributeDomains: d.domains,
                attributes: Array.from(d.attributes.values()),
                profiles: Array.from(d.profiles.values()),
                groups: d.groups,
                categories: d.categories,
                subcategories: d.subcategories,
                assetClasses: Array.from(d.classes.values()),
            };
        }),
    ],

    'POST /api/admin/assets/dictionary/export': [
        staff('admin.assets.dictionary.export', 'read', async (ctx) => {
            const vid = str(ctx.body.vid);
            if (!VID_RE.test(vid)) throw new HttpError(400, 'Invalid version.');
            const d = await loadVersion(vid);
            await rec(ctx, 'admin', 'assets.dictionary.exported', `Asset catalog ${d.version}`, 'Downloaded');
            return {
                ...d.header,
                attributeDomains: d.domains,
                attributes: Array.from(d.attributes.values()),
                profiles: Array.from(d.profiles.values()),
                groups: d.groups,
                categories: d.categories,
                subcategories: d.subcategories,
                assetClasses: Array.from(d.classes.values()),
            };
        }),
    ],

    'POST /api/admin/assets/dictionary/tree': [
        staff('admin.assets.dictionary.tree', 'read', async ({ body }) => {
            const vid = str(body.vid);
            if (vid && !VID_RE.test(vid)) throw new HttpError(400, 'Invalid version.');
            return treeOut(vid ? await loadVersion(vid) : await activeDictionary());
        }),
    ],

    'POST /api/admin/assets/dictionary/class': [
        staff('admin.assets.dictionary.class', 'read', async ({ body }) => {
            const vid = str(body.vid);
            if (vid && !VID_RE.test(vid)) throw new HttpError(400, 'Invalid version.');
            const d = vid ? await loadVersion(vid) : await activeDictionary();
            return classOut(d, str(body.code));
        }),
    ],

    // ----- Organization: dictionary (read only) -----
    'POST /api/org/assets/dictionary/tree': [
        orgRoute('org.assets.dictionary.tree', null, async (ctx) => {
            requireAst(ctx);
            needCatalogAccess(ctx);
            return treeOut(await orgDictionary(ctx));
        }),
    ],

    'POST /api/org/assets/dictionary/class': [
        orgRoute('org.assets.dictionary.class', null, async (ctx) => {
            requireAst(ctx);
            needCatalogAccess(ctx);
            return classOut(await orgDictionary(ctx), str(ctx.body.code));
        }),
    ],

    // ----- Organization: asset register -----
    'POST /api/org/assets/list': [
        orgRoute('org.assets.list', 'AST.view', async (ctx) => {
            requireAst(ctx);
            const scope = await scopeOf(ctx);
            const docs = await listDocs(assetCol(ctx.orgId));
            const assets = docs.filter((d) => inScope(scope, str(d.data.nodeId))).map((d) => assetOut(d));
            return {
                assets,
                scope: scope === 'all' ? 'all' : 'assigned',
                can: {
                    create: hasPerm(ctx.permissions, 'AST.create'),
                    edit: hasPerm(ctx.permissions, 'AST.edit'),
                    approve: hasPerm(ctx.permissions, 'AST.approve'),
                    remove: hasPerm(ctx.permissions, 'AST.delete'),
                },
            };
        }),
    ],

    'POST /api/org/assets/get': [
        orgRoute('org.assets.get', 'AST.view', async (ctx) => {
            requireAst(ctx);
            const doc = await getAsset(ctx, str(ctx.body.tag));
            return {
                asset: assetOut(doc, true),
                myUid: ctx.uid,
                can: {
                    create: hasPerm(ctx.permissions, 'AST.create'),
                    edit: hasPerm(ctx.permissions, 'AST.edit'),
                    approve: hasPerm(ctx.permissions, 'AST.approve'),
                    remove: hasPerm(ctx.permissions, 'AST.delete'),
                },
            };
        }),
    ],

    'POST /api/org/assets/locations': [
        orgRoute('org.assets.locations', 'AST.view', async (ctx) => {
            requireAst(ctx);
            const scope = await scopeOf(ctx);
            const nodes = (await listDocs(`organizations/${ctx.orgId}/structure`))
                .filter((n) => LOCATION_LEVELS.includes(str(n.data.level)) && str(n.data.status) !== 'inactive' && inScope(scope, n.id))
                .map((n) => ({ id: n.id, code: str(n.data.code), name: str(n.data.name), level: str(n.data.level) }))
                .sort((a, b) => a.code.localeCompare(b.code));
            return { locations: nodes };
        }),
    ],

    'POST /api/org/assets/save': [
        orgRoute('org.assets.save', null, async (ctx) => {
            requireAst(ctx);
            const tag = str(ctx.body.tag);
            const isNew = !tag;
            if (!hasPerm(ctx.permissions, isNew ? 'AST.create' : 'AST.edit')) throw new HttpError(403, 'You do not have permission to do this.');
            const scope = await scopeOf(ctx);
            const name = text(ctx.body, 'name', 2, 80, 'Enter the asset name (2 to 80 characters).');
            const description = text(ctx.body, 'description', 0, 500, 'Description can be up to 500 characters.');
            const forWorkCenter = isNew ? str(ctx.body.workCenterId) : '';
            const nodeId = forWorkCenter || str(ctx.body.nodeId);
            if (!NODE_ID_RE.test(nodeId)) throw new HttpError(400, 'Choose where the asset is located.');
            if (!inScope(scope, nodeId)) throw new HttpError(403, 'You can only place assets inside your assigned scope.');
            const { node, siteId, legalEntityId } = await lineage(ctx.orgId, nodeId);
            if (!node || !LOCATION_LEVELS.includes(str(node.data.level))) throw new HttpError(400, 'Assets are located at a site, department, cost center or equipment unit.');
            if (!forWorkCenter && str(node.data.level) === 'work_center' && isNew) throw new HttpError(400, 'An asset at an equipment unit must be linked through the one-to-one equipment selector.');
            if (forWorkCenter) {
                if (str(node.data.level) !== 'work_center') throw new HttpError(400, 'Choose an equipment unit.');
                if (str(node.data.status) === 'inactive') throw new HttpError(409, 'Inactive equipment cannot accept a new asset.');
                if (!hasPerm(ctx.permissions, 'ADM.structure')) throw new HttpError(403, 'You need the organization design permission to attribute an asset to an equipment unit.');
                if (isObj(node.data.attributes) && str(node.data.attributes.assetTag)) throw new HttpError(409, 'This equipment unit already has an asset. Unlink it first.');
            }
            const dict = await orgDictionary(ctx);
            const existing = isNew ? null : await getAsset(ctx, tag, scope);
            if (existing && str(existing.data.workCenterId) && nodeId !== str(existing.data.nodeId)) throw new HttpError(400, `This asset belongs to equipment unit ${str(existing.data.workCenterCode)}. Unlink it there before moving it.`);
            const classCode = existing ? str(existing.data.classCode) : str(ctx.body.classCode);
            if (existing && str(ctx.body.classCode) && str(ctx.body.classCode) !== classCode) throw new HttpError(400, 'The asset class cannot be changed after creation. Create a new asset instead.');
            const info = classOut(dict, classCode);
            if (forWorkCenter) {
                const wcAttrs = isObj(node.data.attributes) ? node.data.attributes : {};
                if (!unitIsAssignable(wcAttrs)) throw new HttpError(409, 'This equipment already has an asset. Refresh before creating another.');
                const claimed = (await listDocs(assetCol(ctx.orgId))).find((a) => str(a.data.workCenterId) === forWorkCenter
                    && !['disposed', 'deleted'].includes(str(a.data.status)));
                if (claimed) throw new HttpError(409, `Equipment is already referenced by asset ${claimed.id}.`);
                const equipment = await unitClassification(ctx, str(wcAttrs.equipmentClass));
                const cls = dict.classes.get(classCode);
                if (!cls || !identicalAssetEquipmentClass(
                    { classCode, categoryCode: str(cls.categoryCode), subcategoryCode: str(cls.subcategoryCode) }, equipment)) {
                    throw new HttpError(409, 'Asset class must match the chosen equipment category, subcategory and class.');
                }
            }
            const attributes = await readAssetAttributes(info, ctx.body.attributes, false);
            attributes['ATT-IDN-001'] = name;
            const now = nowIso();
            const location = { nodeId, nodeCode: str(node.data.code), nodeName: str(node.data.name), nodeLevel: str(node.data.level), siteId, legalEntityId };
            if (existing) {
                const status = str(existing.data.status);
                if (status === 'pending_approval' || status === 'change_pending' || status === 'disposal_pending') throw new HttpError(400, 'This asset is waiting for approval and cannot be changed now.');
                if (status === 'disposed') throw new HttpError(400, 'Disposed assets cannot be changed.');
                if (status === 'active') {
                    // Changes to an approved asset are held for approval and applied only when approved.
                    const note = text(ctx.body, 'note', 5, 300, 'Give the reason for the change (5 to 300 characters).');
                    if (ctx.body.confirmed !== true) throw new HttpError(400, 'Confirm the changed attributes before sending them for approval.');
                    await readAssetAttributes(info, attributes, true);
                    const pending: Obj = { name, description, attributes, ...location, completeness: completeness(info, attributes) };
                    await updateFields(`${assetCol(ctx.orgId)}/${tag}`, {
                        status: 'change_pending',
                        pending,
                        pendingNote: note,
                        submittedBy: ctx.uid,
                        submittedByName: displayName(ctx),
                        submittedAt: now,
                        updatedAt: now,
                        history: withHistory(existing, ctx, 'change_requested', note),
                    });
                    await rec(ctx, 'data', 'org.assets.change_requested', `${tag} ${name}`, note, ctx.orgId);
                    return { tag, status: 'change_pending' };
                }
                await updateFields(`${assetCol(ctx.orgId)}/${tag}`, {
                    name,
                    description,
                    attributes,
                    ...location,
                    completeness: completeness(info, attributes),
                    updatedAt: now,
                    updatedBy: ctx.uid,
                    history: withHistory(existing, ctx, 'edited'),
                });
                if (str(existing.data.workCenterId)) await renameOnWorkCenter(ctx, str(existing.data.workCenterId), tag, name);
                await rec(ctx, 'data', 'org.assets.update', `${tag} ${name}`, `${Object.keys(attributes).length} attributes`, ctx.orgId);
                return { tag, status };
            }
            const seq = await nextOrgCounter(ctx.orgId, 'assetSeq');
            if (seq > 999999) throw new HttpError(400, 'Asset numbering is exhausted.');
            const newTag = `AST-${String(seq).padStart(6, '0')}`;
            const c = dict.classes.get(classCode) as Obj;
            const data: Fields = {
                name,
                description,
                classCode,
                className: str(c.name),
                groupCode: str(c.groupCode),
                categoryCode: str(c.categoryCode),
                subcategoryCode: str(c.subcategoryCode),
                dictionaryVersion: dict.version,
                attributes,
                ...location,
                workCenterId: forWorkCenter,
                workCenterCode: forWorkCenter ? str(node.data.code) : '',
                status: 'draft',
                completeness: completeness(info, attributes),
                createdAt: now,
                createdBy: ctx.uid,
                createdByName: displayName(ctx),
                updatedAt: now,
                history: [{ at: now, by: ctx.uid, byName: displayName(ctx), action: 'created', note: '' }],
            };
            if (forWorkCenter) {
                const wcAttrs: Obj = isObj(node.data.attributes) ? { ...node.data.attributes } : {};
                if (!unitIsAssignable(wcAttrs)) throw new HttpError(409, 'This equipment is already mapped. Refresh before continuing.');
                await commitAssetEquipmentWrites([
                    { path: `${assetCol(ctx.orgId)}/${newTag}`, fields: data, create: true },
                    { path: structPath(ctx.orgId, forWorkCenter),
                        fields: { attributes: { ...wcAttrs, assetTag: newTag, assetTagName: name }, updatedAt: now },
                        updateTime: node.updateTime },
                ]);
                await rec(ctx, 'data', 'org.structure.asset_linked', `Equipment unit ${str(node.data.code)}`, `${newTag} created for this equipment unit`, ctx.orgId);
            } else if (!(await writeDoc(`${assetCol(ctx.orgId)}/${newTag}`, data, { exists: false }))) throw new HttpError(409, 'Please try again.');
            await rec(ctx, 'data', 'org.assets.create', `${newTag} ${name}`, `${classCode} at ${location.nodeCode}`, ctx.orgId);
            return { tag: newTag, status: 'draft' };
        }),
    ],

    'POST /api/org/assets/action': [
        orgRoute('org.assets.action', null, async (ctx) => {
            requireAst(ctx);
            const action = str(ctx.body.action);
            const doc = await getAsset(ctx, str(ctx.body.tag));
            const tag = doc.id;
            const status = str(doc.data.status) || 'draft';
            const note = str(ctx.body.note).trim().slice(0, 300);
            const now = nowIso();
            const path = `${assetCol(ctx.orgId)}/${tag}`;
            const need = (perm: string) => {
                if (!hasPerm(ctx.permissions, perm)) throw new HttpError(403, 'You do not have permission to do this.');
            };
            const label = `${tag} ${str(doc.data.name)}`;

            if (action === 'submit') {
                if (!hasPerm(ctx.permissions, 'AST.create') && !hasPerm(ctx.permissions, 'AST.edit')) throw new HttpError(403, 'You do not have permission to do this.');
                if (status !== 'draft' && status !== 'rejected') throw new HttpError(400, 'Only drafts or rejected assets can be submitted.');
                if (ctx.body.confirmed !== true) throw new HttpError(400, 'Review the attributes and tick the confirmation before submitting.');
                const info = classOut(await orgDictionary(ctx), str(doc.data.classCode));
                await readAssetAttributes(info, isObj(doc.data.attributes) ? doc.data.attributes : {}, true);
                await updateFields(path, { status: 'pending_approval', attributesConfirmedBy: ctx.uid, attributesConfirmedByName: displayName(ctx), attributesConfirmedAt: now, submittedBy: ctx.uid, submittedByName: displayName(ctx), submittedAt: now, updatedAt: now, history: withHistory(doc, ctx, 'submitted', note) });
                await rec(ctx, 'data', 'org.assets.submitted', label, 'Sent for approval', ctx.orgId);
                return { status: 'pending_approval' };
            }

            if (action === 'request_disposal') {
                need('AST.edit');
                if (status !== 'active') throw new HttpError(400, 'Only active assets can be proposed for disposal.');
                if (note.length < 5) throw new HttpError(400, 'Give the reason for disposal (at least 5 characters).');
                await updateFields(path, { status: 'disposal_pending', pendingNote: note, submittedBy: ctx.uid, submittedByName: displayName(ctx), submittedAt: now, updatedAt: now, history: withHistory(doc, ctx, 'disposal_requested', note) });
                await rec(ctx, 'data', 'org.assets.disposal_requested', label, note, ctx.orgId);
                return { status: 'disposal_pending' };
            }

            if (action === 'withdraw') {
                if (str(doc.data.submittedBy) !== ctx.uid) throw new HttpError(403, 'Only the person who submitted can withdraw.');
                const back = status === 'pending_approval' ? 'draft' : status === 'change_pending' || status === 'disposal_pending' ? 'active' : '';
                if (!back) throw new HttpError(400, 'Nothing is waiting for approval.');
                await updateFields(path, { status: back, pending: null, pendingNote: '', updatedAt: now, history: withHistory(doc, ctx, 'withdrawn', note) });
                await rec(ctx, 'data', 'org.assets.withdrawn', label, `Back to ${back}`, ctx.orgId);
                return { status: back };
            }

            if (action === 'approve' || action === 'reject') {
                need('AST.approve');
                if (!['pending_approval', 'change_pending', 'disposal_pending'].includes(status)) throw new HttpError(400, 'Nothing is waiting for approval.');
                // Segregation of duties: nobody approves their own submission or an asset they created.
                if (str(doc.data.submittedBy) === ctx.uid || (status === 'pending_approval' && str(doc.data.createdBy) === ctx.uid)) {
                    throw new HttpError(403, 'You cannot approve or reject your own submission. Another approver must decide.');
                }
                if (action === 'reject') {
                    if (note.length < 5) throw new HttpError(400, 'Give the reason for rejecting (at least 5 characters).');
                    const back = status === 'pending_approval' ? 'rejected' : 'active';
                    await updateFields(path, { status: back, pending: null, updatedAt: now, history: withHistory(doc, ctx, 'rejected', note) });
                    await rec(ctx, 'data', 'org.assets.rejected', label, note, ctx.orgId);
                    return { status: back };
                }
                if (status === 'pending_approval') {
                    await updateFields(path, { status: 'active', approvedBy: ctx.uid, approvedByName: displayName(ctx), approvedAt: now, updatedAt: now, history: withHistory(doc, ctx, 'approved', note) });
                } else if (status === 'change_pending') {
                    const p = isObj(doc.data.pending) ? doc.data.pending : null;
                    if (!p) throw new HttpError(400, 'The pending change is missing.');
                    const fields: Fields = {};
                    for (const k of ['name', 'description', 'attributes', 'nodeId', 'nodeCode', 'nodeName', 'nodeLevel', 'siteId', 'legalEntityId', 'completeness']) if (p[k] !== undefined) fields[k] = p[k];
                    if (str(p.siteId) !== str(doc.data.siteId) && str(doc.data.workCenterId)) {
                        await unlinkFromWorkCenter(ctx, doc);
                        fields.workCenterId = '';
                        fields.workCenterCode = '';
                    }
                    if (str(doc.data.workCenterId) && fields.name) await renameOnWorkCenter(ctx, str(doc.data.workCenterId), tag, str(fields.name));
                    await updateFields(path, { ...fields, status: 'active', pending: null, pendingNote: '', approvedBy: ctx.uid, approvedByName: displayName(ctx), approvedAt: now, updatedAt: now, history: withHistory(doc, ctx, 'change_approved', note) });
                } else {
                    await unlinkFromWorkCenter(ctx, doc);
                    await updateFields(path, { status: 'disposed', workCenterId: '', workCenterCode: '', disposedAt: now, approvedBy: ctx.uid, approvedByName: displayName(ctx), approvedAt: now, updatedAt: now, history: withHistory(doc, ctx, 'disposal_approved', note) });
                }
                await rec(ctx, 'data', 'org.assets.approved', label, status.replace(/_/g, ' '), ctx.orgId);
                return { status: status === 'disposal_pending' ? 'disposed' : 'active' };
            }

            throw new HttpError(400, 'Unknown action.');
        }),
    ],

    'POST /api/org/assets/delete': [
        orgRoute('org.assets.delete', 'AST.delete', async (ctx) => {
            requireAst(ctx);
            const doc = await getAsset(ctx, str(ctx.body.tag));
            if (str(ctx.body.confirm) !== doc.id) throw new HttpError(400, 'Type the asset tag exactly to confirm.');
            if (!['draft', 'rejected'].includes(str(doc.data.status)) || str(doc.data.approvedAt)) throw new HttpError(400, 'Only drafts that were never approved can be deleted. Approved assets are disposed through approval.');
            await unlinkFromWorkCenter(ctx, doc);
            await deleteDoc(`${assetCol(ctx.orgId)}/${doc.id}`);
            await rec(ctx, 'data', 'org.assets.delete', `${doc.id} ${str(doc.data.name)}`, 'Draft deleted', ctx.orgId);
            return { ok: true };
        }),
    ],

    // ----- Organization: its own saved copy of the asset master data -----
    'POST /api/org/assets/dictionary/status': [
        orgRoute('org.assets.dictionary.status', 'AST.view', async (ctx) => {
            requireAst(ctx);
            const pointer = await getDoc(POINTER);
            const loaded = !!str(pointer?.data.activeVid);
            return {
                imported: loaded,
                version: str(pointer?.data.activeVersion),
                importedAt: str(pointer?.data.activatedAt),
                importedByName: 'MEMS',
                stats: isObj(pointer?.data.stats) ? pointer?.data.stats : {},
                memsVersion: str(pointer?.data.activeVersion),
                updateAvailable: false,
                canImport: false,
            };
        }),
    ],

    'POST /api/org/assets/dictionary/import': [
        orgRoute('org.assets.dictionary.import', null, async (ctx) => {
            requireAst(ctx);
            if (!canAdministerAssets(ctx)) throw new HttpError(403, 'Only an asset administrator can import the asset master data.');
            const loaded = await importDictionaryToOrg(ctx, str(ctx.body.confirm));
            return { ok: true, version: loaded.version };
        }),
    ],

    // ----- Organization: the asset attributed to a work center -----
    'POST /api/org/assets/work-center': [
        orgRoute('org.assets.work_center', null, async (ctx) => {
            if (!hasPerm(ctx.permissions, 'ADM.structure') && !hasPerm(ctx.permissions, 'AST.view')) throw new HttpError(403, 'You do not have permission to do this.');
            const scope = await scopeOf(ctx);
            const wc = await getWorkCenter(ctx, str(ctx.body.workCenterId), scope);
            const modules = isObj(ctx.org.data.modules) ? ctx.org.data.modules : {};
            const meta = isObj(ctx.org.data.assetDictionary) ? ctx.org.data.assetDictionary : {};
            const can = {
                create: hasPerm(ctx.permissions, 'AST.create'),
                edit: hasPerm(ctx.permissions, 'AST.edit'),
                approve: hasPerm(ctx.permissions, 'AST.approve'),
                link: hasPerm(ctx.permissions, 'ADM.structure') && hasPerm(ctx.permissions, 'AST.create'),
            };
            const out = { workCenter: { id: wc.id, code: str(wc.data.code), name: str(wc.data.name) }, astEnabled: modules.AST === true, dictionaryImported: !!str((await getDoc(POINTER))?.data.activeVid), can };
            if (modules.AST !== true) return { ...out, asset: null, candidates: [] };
            const tag = isObj(wc.data.attributes) ? str(wc.data.attributes.assetTag) : '';
            const asset = TAG_RE.test(tag) ? await getDoc(`${assetCol(ctx.orgId)}/${tag}`) : null;
            let candidates: Array<{ tag: string; name: string; className: string; nodeCode: string }> = [];
            if (!asset) {
                const { siteId } = await lineage(ctx.orgId, wc.id);
                const wcAttrs = isObj(wc.data.attributes) ? wc.data.attributes : {};
                const unitClass = str(wcAttrs.equipmentClass)
                    ? await unitClassification(ctx, str(wcAttrs.equipmentClass)) : null;
                const units = await listDocs(`organizations/${ctx.orgId}/structure`);
                const previouslyClaimed = new Set(units.filter((u) => u.id !== wc.id && str(u.data.level) === 'work_center' && isObj(u.data.attributes))
                    .map((u) => str((u.data.attributes as Obj).assetTag)).filter(Boolean));
                candidates = (await listDocs(assetCol(ctx.orgId)))
                    .filter((d) => ['active', 'draft'].includes(str(d.data.status))
                        && assetIsAssignable(d.data) && !previouslyClaimed.has(d.id)
                        && unitClass !== null && identicalAssetEquipmentClass(d.data, unitClass)
                        && (!siteId || !str(d.data.siteId) || str(d.data.siteId) === siteId)
                        && inScope(scope, str(d.data.nodeId)))
                    .map((d) => ({ tag: d.id, name: str(d.data.name), className: str(d.data.className),
                        nodeCode: str(d.data.nodeCode), status: str(d.data.status) }))
                    .sort((a, b) => a.tag.localeCompare(b.tag));
            }
            return { ...out, asset: asset ? assetOut(asset, true) : null, candidates };
        }),
    ],

    'POST /api/org/assets/link': [
        orgRoute('org.assets.link', 'ADM.structure', async (ctx) => {
            requireAst(ctx);
            if (!hasPerm(ctx.permissions, 'AST.create')) throw new HttpError(403, 'You need Asset Management create rights to attribute an asset.');
            const scope = await scopeOf(ctx);
            const wc = await getWorkCenter(ctx, str(ctx.body.workCenterId), scope);
            const attrs: Obj = isObj(wc.data.attributes) ? { ...wc.data.attributes } : {};
            const previous = str(attrs.assetTag);
            const tag = str(ctx.body.tag);
            if (str(ctx.body.confirm) !== (tag || previous)) throw new HttpError(400, 'Type the asset tag exactly to confirm.');
            if (!tag && !previous) throw new HttpError(400, 'Nothing to unlink.');
            if (tag && previous && tag !== previous) throw new HttpError(409, 'Unlink the current asset first.');
            if (tag) await getAsset(ctx, tag, scope);
            const code = str(wc.data.code);
            const name = await linkWorkCenterAsset(ctx, { id: wc.id, code, parentId: str(wc.data.parentId) }, previous, tag);
            // linkWorkCenterAsset has already committed both sides with update-time
            // preconditions. Never apply a second unconditional write here.
            await rec(ctx, 'data', tag ? 'org.structure.asset_linked' : 'org.structure.asset_unlinked', `Equipment unit ${code}`, tag || previous, ctx.orgId);
            return { ok: true };
        }),
    ],

    /** Choose a compatible existing asset while creating an equipment unit. */
    'POST /api/org/assets/eligible-for-equipment': [
        orgRoute('org.assets.eligible_for_equipment', 'ADM.structure', async (ctx) => {
            requireAst(ctx);
            if (!hasPerm(ctx.permissions, 'AST.create')) throw new HttpError(403, 'Asset creation or mapping rights are required.');
            const parentId = str(ctx.body.parentId);
            const classCode = str(ctx.body.classCode);
            if (!NODE_ID_RE.test(parentId)) throw new HttpError(400, 'Choose the equipment parent cost center.');
            const parent = await getDoc(structPath(ctx.orgId, parentId));
            if (!parent || str(parent.data.level) !== 'cost_center') throw new HttpError(400, 'Equipment must be created under a cost center.');
            const scope = await scopeOf(ctx);
            if (!inScope(scope, parentId)) throw new HttpError(403, 'The selected parent is outside your permitted scope.');
            const equipment = await unitClassification(ctx, classCode);
            const { siteId } = await lineage(ctx.orgId, parentId);
            const occupied = new Set((await listDocs(`organizations/${ctx.orgId}/structure`))
                .filter((u) => str(u.data.level) === 'work_center' && isObj(u.data.attributes))
                .map((u) => str((u.data.attributes as Obj).assetTag)).filter(Boolean));
            const candidates = (await listDocs(assetCol(ctx.orgId)))
                .filter((a) => ['active', 'draft'].includes(str(a.data.status))
                    && assetIsAssignable(a.data) && !occupied.has(a.id)
                    && identicalAssetEquipmentClass(a.data, equipment)
                    && (!siteId || !str(a.data.siteId) || siteId === str(a.data.siteId))
                    && inScope(scope, str(a.data.nodeId)))
                .map((a) => ({ tag: a.id, name: str(a.data.name), classCode: str(a.data.classCode),
                    categoryCode: str(a.data.categoryCode), subcategoryCode: str(a.data.subcategoryCode),
                    status: str(a.data.status), nodeCode: str(a.data.nodeCode) }))
                .sort((a, b) => a.tag.localeCompare(b.tag));
            return { candidates };
        }),
    ],
    /** Choose compatible, unassigned equipment when creating an asset. */
    'POST /api/org/assets/eligible-equipment': [
        orgRoute('org.assets.eligible_equipment', 'AST.create', async (ctx) => {
            requireAst(ctx);
            if (!hasPerm(ctx.permissions, 'ADM.structure')) throw new HttpError(403, 'Organization design permission is required to assign equipment.');
            const classCode = str(ctx.body.classCode);
            const nodeId = str(ctx.body.nodeId);
            if (!NODE_ID_RE.test(nodeId)) throw new HttpError(400, 'Choose a location before assigning equipment.');
            const node = await getDoc(structPath(ctx.orgId, nodeId));
            const scope = await scopeOf(ctx);
            if (!node || !inScope(scope, nodeId)) throw new HttpError(403, 'Location outside your permitted scope.');
            const equipment = await unitClassification(ctx, classCode);
            const { siteId } = await lineage(ctx.orgId, nodeId);
            const occupiedEquipment = new Set((await listDocs(assetCol(ctx.orgId)))
                .filter((a) => !['disposed','deleted'].includes(str(a.data.status)))
                .map((a) => str(a.data.workCenterId)).filter(Boolean));
            const units = (await listDocs(`organizations/${ctx.orgId}/structure`))
                .filter((n) => str(n.data.level) === 'work_center' && !occupiedEquipment.has(n.id) && str(n.data.status) !== 'inactive'
                    && inScope(scope, n.id) && unitIsAssignable(isObj(n.data.attributes) ? n.data.attributes : {})
                    && str(isObj(n.data.attributes) ? n.data.attributes.equipmentClass : '') === equipment.classCode);
            const candidates = (await Promise.all(units.map(async (wc) => {
                const location = await lineage(ctx.orgId, wc.id);
                return (!siteId || location.siteId === siteId) ? { id: wc.id, code: str(wc.data.code),
                    name: str(wc.data.name), classCode, categoryCode: equipment.categoryCode,
                    subcategoryCode: equipment.subcategoryCode } : null;
            }))).filter((item): item is NonNullable<typeof item> => item !== null);
            return { candidates };
        }),
    ],

    // Assets a work center can be linked to: active, at the same site, not linked elsewhere.
    'POST /api/org/assets/options': [
        orgRoute('org.assets.options', 'ADM.structure', async (ctx) => {
            const map = isObj(ctx.org.data.modules) ? ctx.org.data.modules : {};
            if (map.AST !== true) return { enabled: false, assets: [] };
            const parentId = str(ctx.body.parentId);
            const nodeId = str(ctx.body.nodeId);
            const classCode = str(ctx.body.classCode);
            if (!NODE_ID_RE.test(parentId)) throw new HttpError(400, 'Invalid location.');
            const { siteId } = await lineage(ctx.orgId, parentId);
            const cls = classCode ? await unitClassification(ctx, classCode) : null;
            const docs = await listDocs(assetCol(ctx.orgId));
            const assets = docs
                .filter((d) => ['active','draft'].includes(str(d.data.status)) &&
                    (!siteId || !str(d.data.siteId) || str(d.data.siteId) === siteId) &&
                    assetIsAssignable(d.data, nodeId) &&
                    (!cls || identicalAssetEquipmentClass(d.data, cls)))
                .map((d) => ({ tag: d.id, name: str(d.data.name), className: str(d.data.className), nodeCode: str(d.data.nodeCode) }))
                .sort((a, b) => a.tag.localeCompare(b.tag));
            return { enabled: true, assets };
        }),
    ],
};
