/* eslint-disable max-lines */
/**
 * Catalogue enrichment: writes type-specific attributes, mandatory flags, pick-lists, plain guidance and the
 * usual supply / service route into the MEMS catalogue files (materials, services, assets).
 *
 *   node --import tsx tools/catalogue/enrich.ts --materials <in.json> --services <in.json> --assets <in.json> --out <dir>
 *
 * Nothing is removed from a catalogue: existing attributes are reused (matched by name) and kept on every entry;
 * generic mandatory flags are relaxed only where a specific rule now defines what is mandatory. Every change is
 * listed in the entry's setupGuidance and in the release notes written next to the files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { POOL, type LibAttribute } from './library';
import './library-ext';
import type { Kind, Ref, TypeSpec } from './types';
import { SUPPLY_LABEL, PROVIDER_LABEL } from './types';
import { MATERIAL_TYPES } from './types-materials';
import { MATERIAL_TYPES_2 } from './types-materials-2';
import { SERVICE_TYPES } from './types-services';
import { ASSET_TYPES } from './types-assets';
import { describeExisting } from './descriptions';

type Obj = Record<string, any>;
export const normName = (s: string) =>
    String(s ?? '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const OTHER_OPT = { code: 'OTHER', label: 'Other — state in notes' };
const CONTROL: Record<string, string> = { text: 'text', enum: 'dropdown', multi_select: 'multiSelect', boolean: 'toggle', integer: 'number', decimal: 'number', date: 'date', country: 'countryPicker', currency: 'currencyPicker', file: 'upload' };
const SVC_CONTROL: Record<string, string> = { ...CONTROL, multi_select: 'checklist' };
const GENERIC_DESC = /technical specification$|for this service\.|record explicit value, standard, tolerance and revision/i;

// ------------------------------------------------------------------------------------------------ adapters
interface Adapter {
    kind: Kind;
    itemsKey: string;
    l1: string; // top level array key
    l2: string;
    l3: string | null;
    /** codes of the hierarchy for an item, top first */
    hierarchy(it: Obj): string[];
    newAttributeCode(lib: LibAttribute, type: TypeSpec, file: Obj): string;
    domainFor(lib: LibAttribute, type: TypeSpec): string;
    decorate(attr: Obj, lib: LibAttribute): void;
    profilePrefix: string;
    /** Existing mandatory attributes that are only placeholders (relaxed when a specific rule applies). */
    isGeneric(a: Obj): boolean;
    /** Keep existing mandatory attributes that the type does not mention? */
    keepExistingRequired: boolean;
    newDomains: Array<{ code: string; name: string }>;
}

const seqByFile = new WeakMap<Obj, Map<string, number>>();
function nextSeq(file: Obj, prefix: string): number {
    if (!seqByFile.has(file)) seqByFile.set(file, new Map());
    const seq = seqByFile.get(file)!;
    if (!seq.has(prefix)) {
        let max = 0;
        for (const a of file.attributes) {
            const m = String(a.code).match(new RegExp('^' + prefix.replace(/[-]/g, '\\-') + '(\\d+)$'));
            if (m) max = Math.max(max, Number(m[1]));
        }
        seq.set(prefix, max);
    }
    const n = (seq.get(prefix) ?? 0) + 1;
    seq.set(prefix, n);
    return n;
}

const MATERIALS: Adapter = {
    kind: 'materials',
    itemsKey: 'materials',
    l1: 'categories',
    l2: 'subcategories',
    l3: 'families',
    hierarchy: (it) => [it.categoryCode, it.subcategoryCode, it.familyCode],
    newAttributeCode(lib, _t, file) {
        const base = 'AT-' + lib.code.replace(/^MEMS\./, '').replace(/_/g, '-');
        let code = base;
        let i = 2;
        while (file.attributes.some((a: Obj) => a.code === code)) code = `${base}-${i++}`;
        return code;
    },
    domainFor: (lib) => ({ IDENTITY: 'SUP', PACK: 'PCK', COMPLIANCE: 'CMP' } as Record<string, string>)[lib.domain] ?? 'TECH',
    decorate() {},
    profilePrefix: 'PRF-M-',
    isGeneric: (a) => /^AT-UID-/.test(a.code) || a.code === 'AT-GENERIC-DESCRIPTION' || /^(standard material description|primary technical specification|compatibility or application|technical specification or standard reference|specification or standard reference|size or capacity|performance rating|dimensions|material or composition|size or grade designation)$/.test(normName(a.name)),
    keepExistingRequired: false,
    newDomains: [
        { code: 'SUP', name: 'Identification & supply' },
        { code: 'PCK', name: 'Packaging & storage' },
        { code: 'CMP', name: 'Standards, certificates & compliance' },
    ],
};

const SVC_DOMAIN: Record<string, string> = { IDENTITY: 'TEC', RATING: 'TEC', DIMENSION: 'TEC', MATERIAL: 'TEC', ENVIRONMENT: 'HSE', CONNECTION: 'TEC', COMPLIANCE: 'CTR', SERVICE: 'SCP', PACK: 'LOC' };
const SERVICES: Adapter = {
    kind: 'services',
    itemsKey: 'services',
    l1: 'categories',
    l2: 'subcategories',
    l3: 'families',
    hierarchy: (it) => [it.categoryCode, it.subcategoryCode, it.familyCode],
    newAttributeCode(lib, type, file) {
        const d = this.domainFor(lib, type);
        return `SA-${d}-${String(nextSeq(file, `SA-${d}-`)).padStart(3, '0')}`;
    },
    domainFor: (lib, type) => (lib.domain === 'SERVICE' && type.domain ? type.domain : SVC_DOMAIN[lib.domain] ?? 'TEC'),
    decorate(attr) {
        attr.key = String(attr.name).toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        attr.inputControl = SVC_CONTROL[attr.dataType] ?? 'text';
    },
    profilePrefix: 'PRF-S-T-',
    isGeneric: () => false,
    keepExistingRequired: true,
    newDomains: [],
};

const ASSETS: Adapter = {
    kind: 'assets',
    itemsKey: 'assetClasses',
    l1: 'groups',
    l2: 'categories',
    l3: 'subcategories',
    hierarchy: (it) => [it.groupCode, it.categoryCode, it.subcategoryCode],
    newAttributeCode(lib, type, file) {
        const d = this.domainFor(lib, type);
        return `ATT-${d}-${String(nextSeq(file, `ATT-${d}-`)).padStart(3, '0')}`;
    },
    domainFor: (lib, type) => (lib.domain === 'IDENTITY' ? 'IDN' : lib.domain === 'COMPLIANCE' && !type.domain ? 'IDN' : type.domain ?? 'MNT'),
    decorate(attr) {
        attr.key = String(attr.name).toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        attr.inputControl = CONTROL[attr.dataType] ?? 'text';
    },
    profilePrefix: 'PRF-T-',
    isGeneric: () => false,
    keepExistingRequired: true,
    newDomains: [],
};

// ------------------------------------------------------------------------------------------------ helpers
const within = (code: string, prefixes: string[]) => !prefixes.length || prefixes.some((p) => code === p || code.startsWith(p + '-'));
const compatible = (a: Obj, lib: LibAttribute) => {
    const num = (t: string) => t === 'integer' || t === 'decimal';
    if (num(a.dataType) && num(lib.dataType)) return !a.unit || !lib.unit || normName(a.unit) === normName(lib.unit) || a.unit === lib.unit;
    if (a.dataType === lib.dataType) return true;
    if (a.dataType === 'text' && ['enum', 'multi_select'].includes(lib.dataType)) return true;
    if (['enum', 'multi_select'].includes(a.dataType) && lib.dataType === 'text') return true;
    return false;
};

export interface Report {
    kind: Kind;
    items: number;
    byType: Record<string, number>;
    fallback: string[];
    newAttributes: number;
    reused: number;
    upgraded: number;
    converted: number;
    relaxed: number;
    unresolved: string[];
    demoted: Record<string, number>;
}

/** Off: converting a saved free-text attribute to a pick-list would invalidate values already stored against it. */
const CONVERT_EXISTING_TO_PICKLIST = false;

export function enrichCatalogue(kind: Kind, file: Obj, types: TypeSpec[], opts: { date: string }): Report {
    const ad = kind === 'materials' ? MATERIALS : kind === 'services' ? SERVICES : ASSETS;
    const items: Obj[] = file[ad.itemsKey];
    const attrs: Obj[] = file.attributes;
    const byCode = new Map(attrs.map((a) => [a.code, a]));
    const byName = new Map<string, Obj[]>();
    for (const a of attrs) {
        const k = normName(a.name);
        if (!byName.has(k)) byName.set(k, []);
        byName.get(k)!.push(a);
    }
    const names = new Map<string, string>();
    for (const lvl of [ad.l1, ad.l2, ad.l3]) if (lvl) for (const x of file[lvl] ?? []) names.set(x.code, x.name);
    const report: Report = { kind, items: items.length, byType: {}, fallback: [], newAttributes: 0, reused: 0, upgraded: 0, converted: 0, relaxed: 0, unresolved: [], demoted: {} };
    for (const d of ad.newDomains) if (!file.attributeDomains.some((x: Obj) => x.code === d.code)) file.attributeDomains.push(d);

    const created = new Map<string, string>(); // lib code -> new attribute code
    const matches = new Map<string, Map<string, Set<string>>>(); // existing code -> lib code -> type ids
    const usersOf = new Map<string, Set<string>>(); // attribute code -> item codes using it
    for (const it of items) for (const c of it.attributes ?? []) {
        if (!usersOf.has(c)) usersOf.set(c, new Set());
        usersOf.get(c)!.add(it.code);
    }
    const coveredUse = new Map<string, Map<string, Set<string>>>(); // existing code -> lib code -> items where matched

    const libKeys = (lib: LibAttribute) => [normName(lib.name), ...(lib.aliases ?? []).map(normName)];
    const record = (existing: string, lib: string, type: string, item: string) => {
        if (!matches.has(existing)) matches.set(existing, new Map());
        const m = matches.get(existing)!;
        if (!m.has(lib)) m.set(lib, new Set());
        m.get(lib)!.add(type);
        if (!coveredUse.has(existing)) coveredUse.set(existing, new Map());
        const c = coveredUse.get(existing)!;
        if (!c.has(lib)) c.set(lib, new Set());
        c.get(lib)!.add(item);
    };

    function resolve(ref: Ref, it: Obj, type: TypeSpec, used: Set<string>): string | string[] | null {
        if (ref.startsWith('@')) {
            const key = normName(ref.slice(1));
            const own = (it.attributes as string[]).find((c) => !used.has(c) && normName(byCode.get(c)?.name) === key);
            if (own) return own;
            // the dictionary may hold two attributes with one name (e.g. Length in mm and in m) — prefer the rule's domain
            const all = byName.get(key) ?? [];
            const g = all.find((a) => type.domain && a.domain === type.domain) ?? all[0];
            if (g) return g.code;
            report.unresolved.push(`${type.id}: ${ref}`);
            return null;
        }
        const lib = POOL.get(ref);
        if (!lib) {
            report.unresolved.push(`${type.id}: unknown library attribute ${ref}`);
            return null;
        }
        // 1. the entry already has it (by name or alias)
        // (an entry's own attribute with the same name is always reused, even if its data type differs, so the
        //  entry never shows two fields for the same thing)
        const keys = libKeys(lib);
        const own = (it.attributes as string[]).filter((c) => !used.has(c) && keys.includes(normName(byCode.get(c)?.name)));
        const ownPick = own.find((c) => compatible(byCode.get(c)!, lib)) ?? own[0];
        if (ownPick) {
            if (compatible(byCode.get(ownPick)!, lib)) record(ownPick, lib.code, type.id, it.code);
            report.reused++;
            return ownPick;
        }
        // 1b. the entry keeps the value in several fields (e.g. minimum and maximum) — reuse those
        for (const set of lib.aliasSets ?? []) {
            const found = set.map((n) => (it.attributes as string[]).find((c) => !used.has(c) && normName(byCode.get(c)?.name) === normName(n)));
            if (found.every(Boolean)) {
                report.reused += found.length;
                return found as string[];
            }
        }
        // 2. created already for another entry
        if (created.has(lib.code)) return created.get(lib.code)!;
        // 3. the catalogue defines it under exactly the same name
        const same = (byName.get(normName(lib.name)) ?? []).find((a) => compatible(a, lib) && !used.has(a.code));
        if (same) {
            record(same.code, lib.code, type.id, it.code);
            report.reused++;
            return same.code;
        }
        // 4. new attribute
        const code = ad.newAttributeCode(lib, type, file);
        const attr: Obj = { code, name: lib.name, dataType: lib.dataType, domain: ad.domainFor(lib, type), description: lib.description };
        if (lib.unit) attr.unit = lib.unit;
        if (lib.options?.length) attr.options = lib.options.map((o) => ({ ...o }));
        if (lib.validation && Object.keys(lib.validation).length) attr.validation = { ...lib.validation };
        if (lib.example) attr.example = lib.example;
        ad.decorate(attr, lib);
        attrs.push(attr);
        byCode.set(code, attr);
        if (!byName.has(normName(attr.name))) byName.set(normName(attr.name), []);
        byName.get(normName(attr.name))!.push(attr);
        created.set(lib.code, code);
        report.newAttributes++;
        return code;
    }

    // Profiles per type (shown in the dictionary browser; item lists stay authoritative).
    const typeProfiles = new Map<string, { code: string; attrs: Map<string, boolean> }>();
    const fallbackIds = new Set(types.filter((t) => !t.match && /GENERIC|GENERAL|UNCLASSIFIED/.test(t.id)).map((t) => t.id));

    for (const it of items) {
        const hierarchyCodes = ad.hierarchy(it).filter(Boolean);
        const searchName = [it.name, ...((it.synonyms as string[]) ?? [])].join(' | ');
        const type = types.find((t) => within(it.code, t.scope) && (!t.match || t.match.test(searchName)) && !(t.exclude && t.exclude.test(searchName)));
        if (!type) {
            report.fallback.push(`${it.code} ${it.name}`);
            continue;
        }
        report.byType[type.id] = (report.byType[type.id] ?? 0) + 1;
        it.attributes = it.attributes ?? [];
        it.requiredAttributes = it.requiredAttributes ?? [];
        const used = new Set<string>();
        const resolveAll = (refs: Ref[] = []) => {
            const out: string[] = [];
            for (const r of refs) {
                const got = resolve(r, it, type, used);
                for (const c of got === null ? [] : Array.isArray(got) ? got : [got]) {
                    if (!out.includes(c)) {
                        out.push(c);
                        used.add(c);
                    }
                }
            }
            return out;
        };
        const originalSpecific: string[] = Array.isArray(it.specificAttributes) ? [...it.specificAttributes] : [];
        const req = resolveAll(type.required);
        if (type.promoteSpecific) for (const c of originalSpecific.filter((c) => (it.attributes as string[]).includes(c)).slice(0, type.promoteSpecific)) if (!req.includes(c)) req.push(c);
        const opt = resolveAll(type.optional).filter((c) => !req.includes(c));
        const spec = (type.specific?.length ? type.specific.flatMap((r) => { const g = resolve(r, it, type, new Set()); return g === null ? [] : Array.isArray(g) ? g : [g]; }) : req.filter((c) => !['IDN', 'SUP'].includes(byCode.get(c)?.domain)).slice(0, 3)).filter((c, i, a) => a.indexOf(c) === i);

        const original = { attributes: [...it.attributes], requiredAttributes: [...it.requiredAttributes] };
        // attribute list: required first (type order), then existing, then optional additions
        const list = [...req];
        for (const c of original.attributes) if (!list.includes(c)) list.push(c);
        for (const c of opt) if (!list.includes(c)) list.push(c);
        it.attributes = list;

        // mandatory set
        const specificRule = !fallbackIds.has(type.id);
        const nonIdentityReq = req.filter((c) => !['SUP', 'IDN'].includes(byCode.get(c)?.domain));
        let keep: string[];
        if (ad.keepExistingRequired) keep = original.requiredAttributes;
        else if (specificRule && nonIdentityReq.length >= 2 && !type.keepGenericRequired) keep = [];
        else keep = original.requiredAttributes.filter((c) => !ad.isGeneric(byCode.get(c) ?? {}));
        const required = [...req];
        for (const c of keep) if (!required.includes(c)) required.push(c);
        const demoted = original.requiredAttributes.filter((c) => !required.includes(c));
        for (const c of demoted) {
            const n = byCode.get(c)?.name ?? c;
            report.demoted[n] = (report.demoted[n] ?? 0) + 1;
        }
        report.relaxed += demoted.length;
        it.requiredAttributes = required;
        // materials: the rule defines the short text; services and assets keep their own distinguishing attributes first
        const mergedSpec = kind === 'materials' ? spec : [...originalSpecific, ...spec].filter((c, i, a) => a.indexOf(c) === i);
        it.specificAttributes = mergedSpec.length ? mergedSpec : it.specificAttributes ?? [];
        if ('attributeCount' in it) it.attributeCount = it.attributes.length;
        if ('requiredAttributeCount' in it) it.requiredAttributeCount = it.requiredAttributes.length;

        // identity specification follows the mandatory technical attributes
        if (it.identitySpecification && typeof it.identitySpecification === 'object') {
            if (kind === 'materials') it.identitySpecification.requiredDiscriminators = nonIdentityReq.length ? nonIdentityReq : it.identitySpecification.requiredDiscriminators;
            if (kind === 'assets') it.identitySpecification.classSpecificationAttributes = required;
        }

        // set-up guidance written into the entry
        const relaxedNames = demoted.map((c) => byCode.get(c)?.name ?? c);
        it.setupGuidance = {
            id: type.id,
            label: type.label,
            guidance: type.guidance,
            ...(type.supply ? { supply: { usual: type.supply.usual, usualLabels: type.supply.usual.map((s) => SUPPLY_LABEL[s]), note: type.supply.note } } : {}),
            ...(type.providers ? { providers: { usual: type.providers.usual, usualLabels: type.providers.usual.map((s) => PROVIDER_LABEL[s]), note: type.providers.note } } : {}),
            mandatory: required.map((c) => byCode.get(c)?.name ?? c),
            ...(relaxedNames.length ? { madeOptional: relaxedNames } : {}),
            release: opts.date,
        };

        // type profile
        const pcode = ad.profilePrefix + type.id.replace(/_/g, '-');
        if (!typeProfiles.has(type.id)) typeProfiles.set(type.id, { code: pcode, attrs: new Map() });
        const tp = typeProfiles.get(type.id)!;
        for (const c of req) tp.attrs.set(c, true);
        for (const c of opt) if (!tp.attrs.has(c)) tp.attrs.set(c, false);
        it.profiles = Array.isArray(it.profiles) ? (it.profiles.includes(pcode) ? it.profiles : [...it.profiles, pcode]) : [pcode];
    }

    // profiles
    file.profiles = file.profiles ?? [];
    for (const [id, p] of typeProfiles) {
        const t = types.find((x) => x.id === id)!;
        const entry = { code: p.code, name: `${t.label} (type)`, description: t.guidance.slice(0, 400), attributes: [...p.attrs].map(([code, required]) => ({ code, required })) };
        const i = file.profiles.findIndex((x: Obj) => x.code === p.code);
        if (i >= 0) file.profiles[i] = entry;
        else file.profiles.push(entry);
    }

    // upgrade matched existing attributes (better description, examples, pick-lists where it is safe)
    for (const [code, libs] of matches) {
        const a = byCode.get(code);
        if (!a || libs.size !== 1) continue;
        const [libCode] = [...libs.keys()];
        const lib = POOL.get(libCode)!;
        let changed = false;
        if (GENERIC_DESC.test(a.description ?? '') || String(a.description ?? '').length < 60) {
            a.description = lib.description;
            changed = true;
        }
        if (!a.example && lib.example) {
            a.example = lib.example;
            changed = true;
        }
        if (a.dataType === 'text' && lib.options?.length) {
            // Existing attributes keep their data type: records already saved with free text must stay valid.
            // The pick-list is offered as guidance in the description instead.
            const users = usersOf.get(code) ?? new Set();
            const covered = coveredUse.get(code)?.get(libCode) ?? new Set();
            const all = CONVERT_EXISTING_TO_PICKLIST && [...users].every((u) => covered.has(u));
            if (all) {
                a.dataType = lib.dataType;
                a.options = lib.options.map((o) => ({ ...o }));
                if (lib.dataType === 'enum' && !a.options.some((o: Obj) => o.code === 'OTHER')) a.options.push({ ...OTHER_OPT });
                delete a.validation?.maxLength;
                if (a.validation && !Object.keys(a.validation).length) delete a.validation;
                if (a.inputControl) a.inputControl = (kind === 'services' ? SVC_CONTROL : CONTROL)[a.dataType];
                report.converted++;
            } else {
                const sample = lib.options.slice(0, 8).map((o) => o.label).join('; ');
                if (!String(a.description).includes('Typical values')) a.description = `${a.description} Typical values: ${sample}.`;
            }
            changed = true;
        }
        if (changed) report.upgraded++;
    }

    // plain descriptions and examples for attributes no rule touched
    for (const a of attrs) describeExisting(kind, a);

    return report;
}

// ------------------------------------------------------------------------------------------------ release metadata
function stamp(kind: Kind, file: Obj, date: string, report: Report) {
    const note = {
        release: date,
        summary: 'Type-specific attributes, mandatory flags, pick-lists, plain set-up guidance and usual supply / service route added to every entry (setupGuidance). Existing attributes and codes are unchanged; generic placeholder requirements are optional where a specific rule now defines what is mandatory.',
        types: Object.keys(report.byType).length,
        newAttributes: report.newAttributes,
        upgradedAttributes: report.upgraded,
        mandatoryFlagsRelaxed: report.relaxed,
    };
    if (kind === 'materials') {
        file.schemaVersion = '5.3.0';
        file.enrichmentRelease = note;
    } else if (kind === 'services') {
        file.supersedes = `${file.catalogName ?? 'MEMS Universal Service Master Catalog'} ${file.version}`;
        file.version = '3.3.0';
        file.generatedDate = date;
        file.enrichmentRelease = note;
    } else {
        file.supersedes = `${file.dictionaryName ?? 'MEMS Universal Asset Master Dictionary'} ${file.version}`;
        file.version = '2.3.0';
        file.generatedDate = date;
        file.enrichmentRelease = note;
    }
    const items: Obj[] = file[kind === 'assets' ? 'assetClasses' : kind];
    if (file.statistics && typeof file.statistics === 'object') {
        const assignments = items.reduce((n, i) => n + (i.attributes?.length ?? 0), 0);
        file.statistics.attributes = file.attributes.length;
        file.statistics.profiles = file.profiles.length;
        file.statistics.attributeDomains = file.attributeDomains.length;
        if ('classAttributeAssignments' in file.statistics) file.statistics.classAttributeAssignments = assignments;
        if ('serviceAttributeAssignments' in file.statistics) file.statistics.serviceAttributeAssignments = assignments;
        const avgKey = 'averageAttributesPerClass' in file.statistics ? 'averageAttributesPerClass' : 'averageAttributesPerService';
        if (avgKey in file.statistics) file.statistics[avgKey] = Math.round((assignments / items.length) * 10) / 10;
        if ('unusedAttributes' in file.statistics) {
            const usedCodes = new Set(items.flatMap((i) => i.attributes ?? []));
            file.statistics.unusedAttributes = file.attributes.filter((a: Obj) => !usedCodes.has(a.code)).length;
        }
    }
}

/** Catch-all rules for a whole category: tried only after every specific rule has had its chance. */
const CATCH_ALL = new Set(['MRO_GENERIC', 'OPS_CONSUMABLE', 'LAB_GENERAL', 'OFFICE_GENERAL', 'CONSTRUCTION_GENERAL', 'AGRI_HARDWARE', 'MEDICAL_GENERAL', 'FOOD_GENERAL', 'MERCH_GENERAL', 'SPECIALISED_GENERAL']);
const orderMaterials = (all: TypeSpec[]) => [...all.filter((t) => !CATCH_ALL.has(t.id)), ...all.filter((t) => CATCH_ALL.has(t.id))];
export const TYPES: Record<Kind, TypeSpec[]> = { materials: orderMaterials([...MATERIAL_TYPES_2.slice(0, 2), ...MATERIAL_TYPES, ...MATERIAL_TYPES_2.slice(2)]), services: SERVICE_TYPES, assets: ASSET_TYPES };

// ------------------------------------------------------------------------------------------------ CLI
const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('tools', 'catalogue', 'enrich.ts'));
if (isMain) {
    const arg = (k: string) => {
        const i = process.argv.indexOf('--' + k);
        return i > 0 ? process.argv[i + 1] : '';
    };
    const out = arg('out') || '.';
    const date = arg('date') || new Date().toISOString().slice(0, 10);
    fs.mkdirSync(out, { recursive: true });
    const names: Record<Kind, string> = { materials: 'MEMS_Materials_Master_Technical_v5_3_0_INTEGRATED.json', services: 'mems_service_master_catalog_v3_3_INTEGRATED.json', assets: 'mems_asset_catalog_2_3_0_INTEGRATED.json' };
    const reports: Report[] = [];
    for (const kind of ['materials', 'services', 'assets'] as Kind[]) {
        const src = arg(kind);
        if (!src) continue;
        const file = JSON.parse(fs.readFileSync(src, 'utf8'));
        const report = enrichCatalogue(kind, file, TYPES[kind], { date });
        stamp(kind, file, date, report);
        fs.writeFileSync(path.join(out, names[kind]), JSON.stringify(file, null, 2));
        reports.push(report);
        console.log(`${kind}: ${report.items} entries, ${Object.keys(report.byType).length} types, ${report.fallback.length} without a rule, ${report.newAttributes} new attributes, ${report.reused} reuses, ${report.upgraded} upgraded, ${report.converted} converted to lists, ${report.relaxed} mandatory flags relaxed, ${report.unresolved.length} unresolved`);
    }
    fs.writeFileSync(path.join(out, 'enrichment-report.json'), JSON.stringify(reports, null, 1));
}
