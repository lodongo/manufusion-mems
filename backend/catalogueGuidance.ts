/**
 * Set-up guidance stored in the catalogue files (materials, services, asset classes) under `setupGuidance`.
 * The files are the single source: the backend only reads and sanitises it for display. Nothing is added at
 * read time, so what is uploaded is exactly what users see and what is exported.
 */
type Data = Record<string, unknown>;
const obj = (v: unknown): Data => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Data) : {});
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const SUPPLY = ['OEM', 'OCM', 'GENERAL'] as const;
const PROVIDERS = ['OEM', 'OEM_AUTH', 'SPECIALIST', 'GENERAL', 'IN_HOUSE'] as const;

export interface CatalogueRoute {
    usual: string[];
    usualLabels: string[];
    note: string;
}
export interface CatalogueGuidance {
    id: string;
    label: string;
    guidance: string;
    /** Materials: usual supply route (OEM / OCM / general supplier). */
    supply?: CatalogueRoute;
    /** Services and assets: who normally does the work / services the asset. */
    providers?: CatalogueRoute;
}

function route(v: unknown, allowed: readonly string[]): CatalogueRoute | undefined {
    const r = obj(v);
    const usual = (Array.isArray(r.usual) ? r.usual : []).map((x) => text(x, 20)).filter((x) => allowed.includes(x));
    if (!usual.length) return undefined;
    const labels = Array.isArray(r.usualLabels) ? r.usualLabels.map((x) => text(x, 120)) : [];
    return { usual, usualLabels: usual.map((_, i) => labels[i] || usual[i]), note: text(r.note, 600) };
}

/** The entry's guidance for the form header, or null when the catalogue has none. */
export function catalogueGuidance(entry: unknown): CatalogueGuidance | null {
    const g = obj(obj(entry).setupGuidance);
    const id = text(g.id, 60);
    const label = text(g.label, 120);
    const guidance = text(g.guidance, 1200);
    if (!label || !guidance) return null;
    const out: CatalogueGuidance = { id, label, guidance };
    const supply = route(g.supply, SUPPLY);
    const providers = route(g.providers, PROVIDERS);
    if (supply) out.supply = supply;
    if (providers) out.providers = providers;
    return out;
}
