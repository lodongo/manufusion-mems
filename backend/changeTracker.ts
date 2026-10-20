/**
 * Material change tracking.
 *
 * Every Firestore write made while an organization request is handled passes through `observeFirestoreWrite` (called
 * from core.googleRequest after a successful write). Writes that change a material — its master record, its warehouse
 * inventory or procurement settings, its warehouse extensions, or a stock movement in the material journal — are
 * collected for the request. When the request has succeeded, the registered listeners (MRP) receive the set of
 * {organization, material, warehouse} that changed, whichever screen or route made the change.
 *
 * Nothing here reads or writes data; it only inspects the write requests the server itself makes.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface MaterialChange {
    orgId: string;
    materialId: string;
    /** Empty when the change is not tied to one warehouse (the material master): every warehouse is planned. */
    warehouseId: string;
    /** Collection that changed (materials, inventory_material_info, material_journal, ...). */
    source: string;
}
interface Pending {
    changes: Map<string, MaterialChange>;
    /** Partial updates of a journal entry carry no ids: the document is read after the request. */
    unresolved: Set<string>;
}

const storage = new AsyncLocalStorage<Pending>();
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const TRACKED = new Set(['materials', 'inventory_material_info', 'procurement_material_info', 'material_extensions', 'material_journal']);
const MAX_PER_REQUEST = 200;

type Encoded = Record<string, { stringValue?: string } | undefined>;
const field = (fields: unknown, name: string): string => {
    const v = (fields as Encoded | undefined)?.[name]?.stringValue;
    return typeof v === 'string' && ID.test(v) ? v : '';
};

function add(p: Pending, c: MaterialChange) {
    if (!c.orgId || !c.materialId || p.changes.size >= MAX_PER_REQUEST) return;
    p.changes.set(`${c.orgId}|${c.materialId}|${c.warehouseId}`, c);
}

/** Records one written document (path relative to the documents root). */
export function observeDocument(p: Pending, relPath: string, fields: unknown, partial: boolean) {
    const parts = relPath.split('/');
    if (parts.length !== 4 || parts[0] !== 'organizations' || !TRACKED.has(parts[2])) return;
    const [, orgId, source, docId] = parts;
    if (!ID.test(orgId) || !ID.test(docId)) return;
    if (source === 'materials') return add(p, { orgId, materialId: docId, warehouseId: '', source });
    if (source === 'material_extensions') return add(p, { orgId, materialId: field(fields, 'sourceId'), warehouseId: field(fields, 'warehouseId'), source });
    const materialId = field(fields, 'materialId');
    const warehouseId = field(fields, 'warehouseId');
    if (materialId) return add(p, { orgId, materialId, warehouseId, source });
    if (partial) p.unresolved.add(relPath);
}

/** Called by core.googleRequest after a successful write. Cheap when no request is being tracked. */
export function observeFirestoreWrite(url: string, method: string, body: unknown, documentsBase: string, documentNameRoot: string) {
    const p = storage.getStore();
    if (!p || method === 'GET' || method === 'DELETE') return;
    try {
        if (url.startsWith(`${documentsBase}:commit`)) {
            const writes = (body as { writes?: unknown[] } | undefined)?.writes ?? [];
            for (const w of writes) {
                const update = (w as { update?: { name?: string; fields?: unknown }; updateMask?: unknown }).update;
                if (!update?.name || !update.name.startsWith(`${documentNameRoot}/`)) continue;
                observeDocument(p, update.name.slice(documentNameRoot.length + 1), update.fields, !!(w as { updateMask?: unknown }).updateMask);
            }
            return;
        }
        if (!url.startsWith(`${documentsBase}/`)) return;
        const [path, query = ''] = url.slice(documentsBase.length + 1).split('?');
        const fields = (body as { fields?: unknown } | undefined)?.fields;
        if (method === 'PATCH') observeDocument(p, decodeURIComponent(path), fields, query.includes('updateMask'));
        // POST to a collection creates a document with a generated id; the fields still name the material.
        if (method === 'POST' && path.split('/').length === 3) observeDocument(p, `${decodeURIComponent(path)}/generated`, fields, false);
    } catch {
        /* never let tracking affect the write itself */
    }
}

/** Runs `fn` while recording material changes; returns its result and what changed. */
export async function withChangeTracking<T>(fn: () => Promise<T>): Promise<{ result: T; changes: MaterialChange[]; unresolved: string[] }> {
    const p: Pending = { changes: new Map(), unresolved: new Set() };
    const result = await storage.run(p, fn);
    return { result, changes: [...p.changes.values()], unresolved: [...p.unresolved].slice(0, 50) };
}

/** Listeners called after a successful organization request that changed materials. */
export type ChangeListener = (input: { orgId: string; uid: string; actorName: string; route: string; changes: MaterialChange[]; unresolved: string[] }) => Promise<void>;
const listeners: ChangeListener[] = [];
export function onMaterialChanges(fn: ChangeListener) {
    listeners.push(fn);
}

/**
 * Notifies the listeners, bounded in time so a slow planning run never delays the person's response for long.
 * Errors are reported by the listener itself (run log); they never fail the request that already succeeded.
 */
export async function notifyMaterialChanges(input: Parameters<ChangeListener>[0], budgetMs = 8000): Promise<void> {
    if (!listeners.length || (!input.changes.length && !input.unresolved.length)) return;
    const all = Promise.allSettled(listeners.map((l) => l(input)));
    await Promise.race([all, new Promise((resolve) => setTimeout(resolve, budgetMs))]);
}
