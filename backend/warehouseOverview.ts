import { isObj, listDocs, str } from './core';
import { orgRoute } from './guards';
import { allowedNodeIds } from './positions';
import { materialCategories } from './procurement';
import { ownersOf, scopeKey } from './buyerGroups';

type Obj = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Warehouse overview: the warehouses this person can see, with the material categories each accepts, the
// subcategories its clusters hold, and the buyer group (if any) that buys each subcategory. Read only.
// ---------------------------------------------------------------------------

export const warehouseOverviewRoutes = {
    'POST /api/org/warehouse/overview': [
        orgRoute('org.warehouse.overview', null, async (ctx) => {
            const root = `organizations/${ctx.orgId}`;
            const all = ctx.role === 'org_super_admin';
            const allowed = all ? 'all' : await allowedNodeIds(ctx.orgId, ctx.me, true);
            const [warehouses, nodes, categories, owners] = await Promise.all([
                listDocs(`${root}/warehouses`),
                listDocs(`${root}/structure`),
                materialCategories(),
                ownersOf(ctx.orgId),
            ]);
            const nodeById = new Map(nodes.map((n) => [n.id, n.data]));
            const catName = new Map(categories.map((c) => [c.code, c.name]));
            const rows = [];
            for (const w of warehouses) {
                if (allowed !== 'all' && !allowed.has(w.id)) continue;
                const node = nodeById.get(w.id);
                const d = w.data;
                const catCodes = Array.isArray(d.materialCategoryCodes) ? (d.materialCategoryCodes as unknown[]).map(str).filter(Boolean) : str(d.materialCategoryCode) ? [str(d.materialCategoryCode)] : [];
                const clusters = await listDocs(`${root}/warehouses/${w.id}/clusters`);
                const subs = new Map<string, { code: string; name: string; categoryCode: string; clusters: number; positions: number }>();
                for (const c of clusters) {
                    const positions = Number(c.data.count) || 0;
                    for (const s of Array.isArray(c.data.subcategories) ? (c.data.subcategories as unknown[]).filter(isObj) : []) {
                        const o = s as Obj;
                        const code = str(o.code);
                        if (!code) continue;
                        const cur = subs.get(code) ?? { code, name: str(o.name), categoryCode: str(o.categoryCode), clusters: 0, positions: 0 };
                        cur.clusters += 1;
                        cur.positions += positions;
                        subs.set(code, cur);
                    }
                }
                rows.push({
                    id: w.id,
                    code: str(node?.code),
                    name: str(node?.name) || str(d.name) || w.id,
                    configured: true,
                    categories: catCodes.map((code) => ({ code, name: catName.get(code) ?? code })),
                    subcategories: [...subs.values()]
                        .sort((a, b) => a.code.localeCompare(b.code))
                        .map((s) => {
                            const owner = owners.get(scopeKey('material', s.categoryCode, s.code));
                            return { ...s, categoryName: catName.get(s.categoryCode) ?? s.categoryCode, buyerGroup: owner ? `${owner.number} ${owner.name}` : '' };
                        }),
                });
            }
            // Storage cost centers the person can see that have no setup yet.
            for (const n of nodes) {
                const attrs = isObj(n.data.attributes) ? (n.data.attributes as Obj) : {};
                if (str(n.data.level) !== 'cost_center' || !['INV', 'WHS'].includes(str(attrs.costType))) continue;
                if (rows.some((r) => r.id === n.id)) continue;
                if (allowed !== 'all' && !allowed.has(n.id)) continue;
                rows.push({ id: n.id, code: str(n.data.code), name: str(n.data.name), configured: false, categories: [], subcategories: [] });
            }
            rows.sort((a, b) => a.name.localeCompare(b.name));
            return { warehouses: rows };
        }),
    ],
};
