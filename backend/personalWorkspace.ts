import {
    HttpError, deleteDoc, getDoc, isObj, listDocs, nowIso, randomId,
    str, updateFields, writeDoc,
} from './core';
import { orgRoute } from './guards';
import { audit } from './audit';

const HOME_KEYS = [
    'waiting', 'passed', 'requests', 'orders', 'favorites', 'recent',
    'my_tables', 'modules', 'quick_links',
] as const;
type HomeKey = typeof HOME_KEYS[number];
const KEY_SET = new Set<string>(HOME_KEYS);
const SIZE_SET = new Set(['compact', 'regular', 'wide']);
const MAX_VIEWS = 60;

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
function homeLayout(raw: unknown) {
    const r = isObj(raw) ? raw : {};
    const order = [...new Set(stringList(r.order).filter((k) => KEY_SET.has(k)))];
    for (const k of HOME_KEYS) if (!order.includes(k)) order.push(k);
    const hidden = [...new Set(stringList(r.hidden).filter((k) => KEY_SET.has(k)))];
    const requested = isObj(r.sizes) ? r.sizes : {};
    const sizes: Record<string, string> = {};
    for (const k of HOME_KEYS) sizes[k] = SIZE_SET.has(str(requested[k])) ? str(requested[k]) : 'regular';
    return { order, hidden, sizes };
}
function availableKeys(permissions: string[], modules: unknown): string[] {
    const has = (prefix: string) => permissions.includes('*') || permissions.some((p) => p.startsWith(prefix));
    const mnt = has('MNT.');
    const hasModule = (Array.isArray(modules) && modules.length > 0) || permissions.length > 0;
    return HOME_KEYS.filter((key) => {
        if (key === 'requests' || key === 'orders') return mnt;
        if (key === 'modules') return hasModule;
        return true;
    });
}
const tableCollection = (uid: string) => 'users/' + uid + '/saved_tables';
const ROUTE = /^organization_(?:home|admin)\/[A-Za-z0-9_/-]{1,145}$/;
const IDENT = /^[A-Za-z0-9._-]{1,90}$/;
const OPS = new Set([
    'contains', 'not_contains', 'eq', 'neq', 'starts', 'ends', 'lt', 'lte',
    'gt', 'gte', 'between', 'in', 'empty', 'not_empty',
]);

function validateSavedView(body: Record<string, unknown>) {
    const tableId = str(body.tableId).trim();
    const name = str(body.name).trim();
    const title = str(body.title).trim().slice(0, 100);
    const route = str(body.route).trim();
    const tabKey = str(body.tabKey).trim();
    if (tabKey && !/^[A-Za-z0-9_-]{1,50}$/.test(tabKey)) throw new HttpError(400, 'Invalid table tab.');
    if (!IDENT.test(tableId)) throw new HttpError(400, 'Invalid table identifier.');
    if (!name || name.length > 40) throw new HttpError(400, 'Use a view name up to 40 characters.');
    if (!ROUTE.test(route) || /\/(my_setup|keep_alive|my_tables)(\/|$)/.test(route)) {
        throw new HttpError(400, 'Save the view from a supported organization table page.');
    }
    const raw = isObj(body.view) ? body.view : {};
    const order = [...new Set(stringList(raw.order).filter((v) => IDENT.test(v)))].slice(0, 100);
    const hidden = [...new Set(stringList(raw.hidden).filter((v) => IDENT.test(v)))].slice(0, 100);
    const sortRaw = isObj(raw.sort) ? raw.sort : null;
    const sort = sortRaw && IDENT.test(str(sortRaw.col)) && ['asc', 'desc'].includes(str(sortRaw.dir))
        ? { col: str(sortRaw.col), dir: str(sortRaw.dir) } : null;
    const criteria = (Array.isArray(raw.criteria) ? raw.criteria : []).filter(isObj).slice(0, 20)
        .map((c) => ({
            col: str(c.col),
            op: str(c.op),
            value: str(c.value).slice(0, 200),
            value2: str(c.value2).slice(0, 200),
        }))
        .filter((c) => IDENT.test(c.col) && OPS.has(c.op));
    // Group-by (up to four levels), value columns (null = detected) and formula columns. Formulas are stored as text and
    // only ever parsed by the table's own expression parser in the browser; they are never executed as code.
    const groupBy = [...new Set(stringList(raw.groupBy).filter((v) => IDENT.test(v)))].slice(0, 4);
    const valueCols = Array.isArray(raw.valueCols) ? [...new Set(stringList(raw.valueCols).filter((v) => IDENT.test(v)))].slice(0, 100) : null;
    const formulas = (Array.isArray(raw.formulas) ? raw.formulas : []).filter(isObj).slice(0, 6)
        .map((f) => ({ key: str(f.key), label: str(f.label).trim(), expr: str(f.expr).trim() }))
        .filter((f) => /^fx_[A-Za-z0-9]{4,30}$/.test(f.key) && f.label.length > 0 && f.label.length <= 40 && f.expr.length > 0 && f.expr.length <= 300
            && !/[\u0000-\u001f\u007f<>`\\]/.test(f.label + f.expr));
    return { tableId, name, title: title || tableId, route, tabKey, view: { order, hidden, sort, criteria, groupBy, valueCols, formulas } };
}
function tableOut(doc: { id: string; data: Record<string, unknown> }) {
    return {
        id: doc.id,
        tableId: str(doc.data.tableId),
        name: str(doc.data.name),
        title: str(doc.data.title),
        route: str(doc.data.route),
        tabKey: str(doc.data.tabKey),
        view: doc.data.view,
        updatedAt: str(doc.data.updatedAt),
    };
}

export const personalWorkspaceRoutes = {
    'POST /api/org/home-layout/get': [
        orgRoute('org.home_layout.get', null, async (ctx) => {
            const user = await getDoc('users/' + ctx.uid);
            if (!user) throw new HttpError(404, 'User not found.');
            return {
                layout: homeLayout(user.data.homeLayout),
                available: availableKeys(ctx.permissions, ctx.org.data.modules),
            };
        }),
    ],
    'POST /api/org/home-layout/save': [
        orgRoute('org.home_layout.save', null, async (ctx) => {
            const user = await getDoc('users/' + ctx.uid);
            if (!user) throw new HttpError(404, 'User not found.');
            const layout = homeLayout(ctx.body.layout);
            await updateFields('users/' + ctx.uid, { homeLayout: layout, homeLayoutUpdatedAt: nowIso() });
            return { layout, available: availableKeys(ctx.permissions, ctx.org.data.modules) };
        }),
    ],
    'POST /api/org/my-tables/list': [
        orgRoute('org.my_tables.list', null, async (ctx) => {
            const docs = await listDocs(tableCollection(ctx.uid));
            return { items: docs.filter((d) => isObj(d.data.view)).map(tableOut).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
        }),
    ],
    'POST /api/org/my-tables/save': [
        orgRoute('org.my_tables.save', null, async (ctx) => {
            const record = validateSavedView(ctx.body);
            const docs = await listDocs(tableCollection(ctx.uid));
            const existing = docs.find((d) => str(d.data.tableId) === record.tableId && str(d.data.name).toLowerCase() === record.name.toLowerCase());
            if (!existing && docs.length >= MAX_VIEWS) throw new HttpError(409, 'You can save up to 60 personal table views.');
            const id = existing?.id ?? randomId(12);
            const next = {
                ...record, updatedAt: nowIso(),
                orgId: ctx.orgId,
                ownerUid: ctx.uid,
            };
            await writeDoc(tableCollection(ctx.uid) + '/' + id, next);
            await audit([{
                category: 'interaction', action: 'my_tables.save',
                actor: ctx.actor, orgId: ctx.orgId, meta: ctx.meta,
                target: { type: 'saved_table_view', id, label: record.name },
                details: 'Saved personal table layout: ' + record.tableId,
            }]);
            return { item: { id, ...next } };
        }),
    ],
    'POST /api/org/my-tables/delete': [
        orgRoute('org.my_tables.delete', null, async (ctx) => {
            const id = str(ctx.body.id);
            if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) throw new HttpError(400, 'Invalid saved table view.');
            const path = tableCollection(ctx.uid) + '/' + id;
            const existing = await getDoc(path);
            if (!existing) throw new HttpError(404, 'Saved view not found.');
            await deleteDoc(path);
            await audit([{
                category: 'interaction', action: 'my_tables.delete',
                actor: ctx.actor, orgId: ctx.orgId, meta: ctx.meta,
                target: { type: 'saved_table_view', id, label: str(existing.data.name) },
            }]);
            return { ok: true };
        }),
    ],
};
