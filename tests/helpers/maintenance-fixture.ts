/** In-memory Firestore REST adapter. Only installed by the test subprocess loader. */
export * from '../../backend/core.ts?actual';
import { encodeFields, toDoc, HttpError, type Doc } from '../../backend/core.ts?actual';
const documents = new Map<string, Doc>();
let sequence = 0;
export function dump() {
    return [...documents.entries()];
}
export function restore(entries: Array<[string, Doc]>) {
    documents.clear();
    for (const [path, doc] of entries) seed(path, doc.data);
}
export function seed(path: string, data: Record<string, unknown>) {
    documents.set(path, { id: path.split('/').pop()!, data: structuredClone(data) as any, updateTime: 'fixture-' + ++sequence });
}
export function snapshot(path: string) {
    return structuredClone(documents.get(path) || null);
}
export async function getDoc(path: string) {
    return snapshot(path);
}
export async function listDocs(collection: string) {
    return [...documents.entries()]
        .filter(([p]) => p.startsWith(collection + '/') && p.split('/').length === collection.split('/').length + 1)
        .map(([, d]) => structuredClone(d));
}
export async function writeDoc(path: string, data: Record<string, unknown>, condition?: { exists?: boolean; updateTime?: string }) {
    const d = documents.get(path);
    if ((condition?.exists !== undefined && condition.exists !== !!d) || (condition?.updateTime && condition.updateTime !== d?.updateTime))
        return false;
    seed(path, data);
    return true;
}
export async function updateFields(path: string, data: Record<string, unknown>) {
    const d = documents.get(path);
    if (!d) throw new HttpError(404, 'Missing fixture document ' + path);
    seed(path, { ...d.data, ...data });
}
export async function deleteDoc(path: string) {
    documents.delete(path);
}
export async function commitCreates(items: Array<{ collection: string; data: Record<string, unknown> }>) {
    for (const i of items) seed(i.collection + '/fixture_' + ++sequence, i.data);
}
function value(encoded: any) {
    return toDoc({ fields: { v: encoded } }).data.v;
}
function matches(d: Doc, where: any): boolean {
    if (!where) return true;
    if (where.compositeFilter) return where.compositeFilter.filters.every((f: any) => matches(d, f));
    const f = where.fieldFilter,
        a = d.data[f.field.fieldPath],
        b = value(f.value);
    return f.op === 'IN' ? Array.isArray(b) && b.includes(a) : a === b;
}
export async function runQuery(q: any, parent = '') {
    const docs = await listDocs((parent ? parent + '/' : '') + q.from[0].collectionId);
    return docs.filter((d) => matches(d, q.where));
}
const response = (data: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
});
export async function googleRequest(url: string, method: string, body: any) {
    if (url.endsWith(':commit')) {
        const changes: Array<[string, any]> = [],
            results: any[] = [];
        for (const w of body.writes) {
            const path = (w.update?.name || w.transform?.document || '').split('/documents/')[1];
            if (!path) throw Error('Invalid test write');
            const current = documents.get(path),
                condition = w.currentDocument;
            if (
                (condition?.exists !== undefined && condition.exists !== !!current) ||
                (condition?.updateTime && condition.updateTime !== current?.updateTime)
            )
                return response({ error: { status: 'ABORTED', message: 'Fixture precondition failed' } }, 409);
            let data: any = w.update ? toDoc({ fields: w.update.fields || {} }).data : { ...(current?.data || {}) };
            if (w.updateMask) data = { ...(current?.data || {}), ...data };
            const transforms = w.transform?.fieldTransforms || w.updateTransforms || [],
                values = [];
            for (const f of transforms) {
                data[f.fieldPath] =
                    Number(current?.data[f.fieldPath] || 0) + Number(f.increment?.integerValue || f.increment?.doubleValue || 0);
                values.push({ integerValue: String(data[f.fieldPath]) });
            }
            changes.push([path, data]);
            results.push({ transformResults: values });
        }
        for (const [path, data] of changes) seed(path, data);
        return response({ writeResults: results });
    }
    throw Error('Unexpected network request in maintenance integration test: ' + method + ' ' + url);
}
