import { getDoc, isObj, str, type Plain } from './core';
import { STOCK_META_BY_KEY } from './universalStockMetadata';
import { restrictionColor, type RestrictionEntry } from './restrictionRules';

// ---------------------------------------------------------------------------
// Stock masters (Procurement metadata) as one current list: the entries MEMS administration saved,
// plus any code shipped later that the saved list does not hold yet. Saved entries always win, so
// labels, descriptions, colours and enabled flags follow the newest administration change.
// ---------------------------------------------------------------------------

export interface StockMasterEntry { code: string; label: string; description: string; active: boolean; selectable: boolean; color: string; category: string }

export async function stockMasterItems(key: string): Promise<StockMasterEntry[]> {
    const def = STOCK_META_BY_KEY.get(key);
    const doc = await getDoc('module_workspaces/PRC/metadata/' + key);
    const saved = (Array.isArray(doc?.data.items) ? (doc?.data.items as Plain[]) : []).filter(isObj);
    const out: StockMasterEntry[] = saved
        .map((x) => ({
            code: str(x.code),
            label: str(x.label) || str(x.name),
            description: str(x.description) || str(x.label),
            active: x.active !== false && x.enabled !== false,
            selectable: x.selectable !== false,
            color: str(x.color),
            category: str(x.category),
        }))
        .filter((x) => x.code && x.label);
    const have = new Set(out.map((x) => x.code));
    for (const item of def?.items ?? []) if (!have.has(item.code)) out.push({ ...item });
    return out.sort((a, b) => a.code.localeCompare(b.code));
}

export interface RestrictionMasterEntry extends RestrictionEntry { description: string; color: string }

/** The warehouse restriction master used by materials, storage locations, clusters and bins alike. */
export async function warehouseRestrictionMaster(): Promise<RestrictionMasterEntry[]> {
    return (await stockMasterItems('warehouseRestrictions'))
        .filter((x) => x.selectable)
        .map((x) => ({ code: x.code, label: x.label, description: x.description, active: x.active, color: restrictionColor(x.code, x.color) }));
}
