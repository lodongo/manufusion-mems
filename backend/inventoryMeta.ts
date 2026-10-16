import { getDoc, isObj, str, type Obj, type Plain } from './core';
import { DEFAULT_MODULE_METADATA } from './moduleDefaults';

// ---------------------------------------------------------------------------
// Inventory (INV) reference lists maintained by MEMS administration (Modules › INV › Metadata), codified:
//   materialClassifications  MCL-001 … colour-coded (general stock, hazardous, rotables, quarantine …)
//   storageLocationTypes     SLT-001 … (main store, cold room, hazardous materials store, yard …)
// Organizations use them when they name the storage locations of a warehouse. If MEMS has not added a list
// yet, the shipped defaults apply.
// ---------------------------------------------------------------------------

export interface MetaEntry {
    code: string;
    label: string;
    color: string;
    active: boolean;
}

async function list(key: string): Promise<MetaEntry[]> {
    const doc = await getDoc(`module_workspaces/INV/metadata/${key}`);
    const fromDb = Array.isArray(doc?.data.items) ? (doc?.data.items as Plain[]).filter(isObj) : [];
    const items: Obj[] = fromDb.length ? fromDb : (((DEFAULT_MODULE_METADATA.INV ?? []).find((l) => l.key === key)?.items ?? []) as unknown as Obj[]);
    return items
        .filter((i) => i.selectable !== false)
        .map((i) => ({ code: str(i.code), label: str(i.label), color: /^#[0-9a-fA-F]{6}$/.test(str(i.color)) ? str(i.color) : '#64748B', active: i.active !== false }))
        .filter((i) => i.code && i.label);
}

export const classifications = () => list('materialClassifications');
export const locationTypes = () => list('storageLocationTypes');
