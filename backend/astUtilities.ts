import { HttpError, getDoc, isObj, nowIso, str, writeDoc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { seedModuleMetadata } from './moduleDefaults';
import { PERMS, audited, diffByKey, requireAt } from './scopeGuard';

// ---------------------------------------------------------------------------
// Utilities supplied to an equipment unit (power, compressed air, steam …), with the attributes defined
// in AST metadata (utilitySupplies).   organizations/{org}/equipment_utilities/{workCenterId}
// Reading needs AST.utilities.view (or edit / AST.view) at the unit; saving needs AST.utilities.edit
// (or AST.edit) at the unit. Every save is audited with the utilities added, removed and changed.
// ---------------------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const docPath = (org: string, id: string) => `organizations/${org}/equipment_utilities/${id}`;

async function equipmentUnit(ctx: OrgContext) {
    const id = str(ctx.body.workCenterId);
    if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid unit');
    const node = await getDoc(`organizations/${ctx.orgId}/structure/${id}`);
    if (!node || str(node.data.level) !== 'work_center') throw new HttpError(404, 'Equipment unit not found');
    return { id, node };
}

async function definitions() {
    const master = await getDoc('module_workspaces/AST/metadata/utilitySupplies');
    return (Array.isArray(master?.data.items) ? master.data.items : []).filter(isObj).filter((x) => x.active !== false);
}

export const utilityRoutes = {
    'POST /api/org/ast/utilities/read': [
        orgRoute('org.ast.utilities.read', null, async (ctx) => {
            const { id } = await equipmentUnit(ctx);
            await requireAt(ctx, PERMS.utilitiesView, id, 'read', 'You do not have permission to view the utilities of this equipment unit.');
            await seedModuleMetadata('AST');
            const [catalogue, doc] = await Promise.all([definitions(), getDoc(docPath(ctx.orgId, id))]);
            return { catalogue, items: Array.isArray(doc?.data.items) ? doc.data.items : [] };
        }),
    ],

    'POST /api/org/ast/utilities/save': [
        orgRoute('org.ast.utilities.save', null, async (ctx) => {
            const { id, node } = await equipmentUnit(ctx);
            await requireAt(ctx, PERMS.utilitiesEdit, id, 'write', 'You do not have permission to change the utilities of this equipment unit.');
            const rows = ctx.body.items;
            if (!Array.isArray(rows) || rows.length > 80) throw new HttpError(400, 'Invalid entries');
            const defs = await definitions();
            if (!defs.length) throw new HttpError(409, 'AST utility metadata is not loaded');
            const seen = new Set<string>();
            const items = rows.map((row: unknown) => {
                if (!isObj(row)) throw new HttpError(400, 'Invalid utility');
                const code = str(row.code);
                const def = defs.find((x) => str(x.code) === code);
                if (!def || seen.has(code)) throw new HttpError(400, 'Invalid or duplicate utility');
                seen.add(code);
                const values: Record<string, string | number> = {};
                const raw = isObj(row.values) ? row.values : {};
                for (const attr of (Array.isArray(def.attributes) ? def.attributes : []).filter(isObj)) {
                    const key = str(attr.key);
                    const v = raw[key];
                    if (v == null || v === '') {
                        if (attr.required) throw new HttpError(400, `${str(def.label)}: ${str(attr.label)} required`);
                        continue;
                    }
                    if (attr.type === 'number') {
                        const n = Number(v);
                        if (!Number.isFinite(n)) throw new HttpError(400, `${str(def.label)}: ${str(attr.label)} must be a number`);
                        values[key] = n;
                    } else {
                        const value = String(v).trim();
                        const options = Array.isArray(attr.options) ? attr.options.map(str) : [];
                        if (value.length > 180 || (attr.type === 'select' && !options.includes(value))) throw new HttpError(400, `${str(def.label)}: invalid ${str(attr.label)}`);
                        values[key] = value;
                    }
                }
                return { code, label: str(def.label), values };
            });

            const path = docPath(ctx.orgId, id);
            const existing = await getDoc(path);
            const before = (Array.isArray(existing?.data.items) ? existing.data.items : []).filter(isObj);
            await writeDoc(path, { ...(existing?.data ?? {}), items, updatedAt: nowIso(), updatedBy: ctx.uid });
            const diff = diffByKey(before, items, (x: any) => str(x.code));
            await audited(ctx, 'ast.utilities.save', `Utilities of ${str(node.data.code) || id}`, diff);
            return { saved: items.length };
        }),
    ],
};
