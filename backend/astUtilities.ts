import { HttpError, getDoc, isObj, nowIso, randomId, str, writeDoc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { seedModuleMetadata } from './moduleDefaults';
import { effectiveSafetyItems } from './safConfiguration';
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
            const [defs, doc, adopted] = await Promise.all([definitions(), getDoc(docPath(ctx.orgId, id)), effectiveSafetyItems(ctx.orgId,'externalEnergySources')]);
            const allowed=new Set(adopted.map(x=>str(x.code)));
            const catalogue=defs.filter(x=>allowed.has(str(x.code)));
            return { catalogue, items: Array.isArray(doc?.data.items) ? doc.data.items : [], version:Number(doc?.data.version)||0 };
        }),
    ],

    'POST /api/org/ast/utilities/save': [
        orgRoute('org.ast.utilities.save', null, async (ctx) => {
            const { id, node } = await equipmentUnit(ctx);
            await requireAt(ctx, PERMS.utilitiesEdit, id, 'write', 'You do not have permission to change the utilities of this equipment unit.');
            const rows = ctx.body.items;
            if (!Array.isArray(rows) || rows.length > 80) throw new HttpError(400, 'Invalid entries');
            await seedModuleMetadata('AST');
            const path=docPath(ctx.orgId,id), existing=await getDoc(path);
            const version=Number(existing?.data.version)||0;
            if(ctx.body.version!==undefined&&Number(ctx.body.version)!==version)throw new HttpError(409,'Utility register changed. Reload.');
            const before=(Array.isArray(existing?.data.items)?existing.data.items:[]).filter(isObj);
            const [defs,adopted]=await Promise.all([definitions(),effectiveSafetyItems(ctx.orgId,'externalEnergySources')]);
            const allowed=new Set(adopted.map(x=>str(x.code)));
            if (!defs.length) throw new HttpError(409, 'AST utility metadata is not loaded');
            const seen = new Set<string>();
            const items = rows.map((row: unknown) => {
                if (!isObj(row)) throw new HttpError(400, 'Invalid utility');
                const code = str(row.code);
                const def = defs.find((x) => str(x.code) === code);
                if(seen.has(code)) throw new HttpError(400,'Duplicate utility');
                seen.add(code);
                const prior=before.find(x=>str(x.code)===code);
                if(!def||!allowed.has(code)){
                    if(!prior||JSON.stringify(row.values)!==JSON.stringify(prior.values))throw new HttpError(400,'Select an adopted utility or retain the existing historical values.');
                    return prior;
                }
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
                return { code, label: str(def.label), values, connectionId:prior?str(prior.connectionId)||'legacy-'+code:randomId(16) };
            });

            if(!await writeDoc(path, { ...(existing?.data ?? {}), items, version:version+1, updatedAt: nowIso(), updatedBy: ctx.uid },existing?{updateTime:existing.updateTime}:{exists:false}))throw new HttpError(409,'Utility register changed. Reload.');
            const diff = diffByKey(before, items, (x: any) => str(x.code));
            await audited(ctx, 'ast.utilities.save', `Utilities of ${str(node.data.code) || id}`, diff);
            return { saved: items.length,version:version+1 };
        }),
    ],
};
