// Group-by and aggregation for rich tables: up to four levels, with sum, simple average and count of every value
// column per group and for the whole table. Pure functions so they can be tested without a browser.

import { toNumber, type Num } from './tableFormula';

export const MAX_GROUP_LEVELS = 4;

export interface Agg {
    sum: number;
    avg: number | null;
    /** Number of filled numeric cells. */
    n: number;
}
export interface Totals {
    rows: number;
    values: Record<string, Agg>;
}
export interface GroupNode<T> {
    /** Stable id of the group: the values of every level down to this one. */
    path: string;
    level: number;
    col: string;
    value: string;
    rows: T[];
    totals: Totals;
    children: GroupNode<T>[];
}
export type FlatItem<T> = { kind: 'group'; node: GroupNode<T> } | { kind: 'row'; row: T; level: number };

const ID_WORDS = /(^|[^a-z])(code|id|no|nr|number|num|ref|reference|phone|tel|mobile|year|fy|account|acc|zip|postal|pin|sku|serial|version|batch|lot|period|seq|sequence|ext)([^a-z]|$)/i;

/**
 * Columns that hold values to add up. Declared number columns always do; date columns never do. Other columns do
 * when at least 90% of their filled cells are numbers and the column is not an identifier (codes, numbers, years,
 * phone numbers, and long fixed-length digit strings such as account codes).
 */
export function detectValueColumns(columns: Array<{ key: string; label: string; type?: string }>, rows: unknown[], get: (key: string, row: unknown) => unknown): string[] {
    const sample = rows.length > 300 ? rows.filter((_, i) => i % Math.ceil(rows.length / 300) === 0) : rows;
    const out: string[] = [];
    for (const c of columns) {
        if (c.type === 'number') {
            out.push(c.key);
            continue;
        }
        if (c.type === 'date' || ID_WORDS.test(c.label) || ID_WORDS.test(c.key)) continue;
        let filled = 0;
        let numeric = 0;
        let codeLike = 0;
        for (const r of sample) {
            const v = get(c.key, r);
            if (v === null || v === undefined || String(v).trim() === '') continue;
            filled++;
            if (toNumber(v) !== null) {
                numeric++;
                if (typeof v === 'string' && /^0\d+$|^\d{6,}$/.test(v.trim())) codeLike++;
            }
        }
        if (filled > 0 && numeric / filled >= 0.9 && codeLike / filled < 0.5) out.push(c.key);
    }
    return out;
}

export function aggregate<T>(rows: T[], valueKeys: string[], get: (key: string, row: T) => unknown): Totals {
    const values: Record<string, Agg> = {};
    for (const k of valueKeys) {
        let sum = 0;
        let n = 0;
        for (const r of rows) {
            const v: Num = toNumber(get(k, r));
            if (v === null) continue;
            sum += v;
            n++;
        }
        values[k] = { sum: Math.round(sum * 1e6) / 1e6, avg: n ? Math.round((sum / n) * 1e6) / 1e6 : null, n };
    }
    return { rows: rows.length, values };
}

const label = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v).trim();
    return s || '(empty)';
};

/** Builds the group tree. Groups keep the order of the (already sorted) rows; empty values group as "(empty)". */
export function buildGroups<T>(rows: T[], levels: string[], valueKeys: string[], get: (key: string, row: T) => unknown, level = 0, parent = ''): GroupNode<T>[] {
    if (level >= levels.length || level >= MAX_GROUP_LEVELS) return [];
    const col = levels[level];
    const buckets = new Map<string, T[]>();
    for (const r of rows) {
        const v = label(get(col, r));
        const list = buckets.get(v);
        if (list) list.push(r);
        else buckets.set(v, [r]);
    }
    return [...buckets.entries()].map(([value, list]) => {
        const path = `${parent}\u001f${value}`;
        return { path, level, col, value, rows: list, totals: aggregate(list, valueKeys, get), children: buildGroups(list, levels, valueKeys, get, level + 1, path) };
    });
}

/** Flattens the tree into display rows: a group shows its children (or its rows at the last level) when expanded. */
export function flatten<T>(nodes: GroupNode<T>[], expanded: Set<string>, all = false): FlatItem<T>[] {
    const out: FlatItem<T>[] = [];
    const walk = (list: GroupNode<T>[]) => {
        for (const node of list) {
            out.push({ kind: 'group', node });
            if (!all && !expanded.has(node.path)) continue;
            if (node.children.length) walk(node.children);
            else for (const row of node.rows) out.push({ kind: 'row', row, level: node.level + 1 });
        }
    };
    walk(nodes);
    return out;
}

/** Every group path (for expand all). */
export function allPaths<T>(nodes: GroupNode<T>[]): string[] {
    return nodes.flatMap((n) => [n.path, ...allPaths(n.children)]);
}

export const fmtNumber = (v: number | null, dp = 2) => (v === null || !Number.isFinite(v) ? '' : v.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(v) && dp === 2 ? 0 : dp, maximumFractionDigits: dp }));
