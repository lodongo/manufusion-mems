import { HttpError, getDoc, isObj, listDocs, nowIso, str, writeDoc } from './core';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { record } from './org';
import { catalogSummary } from './procurement';
import { assetCatalogSummary } from './assets';
import { recommendProcurementCategories } from './industryCatalog';
import { PROCUREMENT_AUTHORITY, PLANNED_SUBMODULES } from './procurementAuthority';

// ---------------------------------------------------------------------------
// Procurement setup: which categories and subcategories the organization accepts.
// The Material, Service and Asset masters (published by MEMS) list every category and subcategory; the organization
// adopts the ones it works with. Purchase requirements can only use adopted ones.
//   organizations/{orgId}/procurement_setup/{material|service|asset}              current adoption
//   organizations/{orgId}/procurement_setup/{kind}/versions/{n}                   every earlier version
// Changing it needs PRC.setup.manage and a reason, is audited with what was added and removed, and is refused while
// an open purchase requirement still uses something that would be removed.
// ---------------------------------------------------------------------------

export const LINE_KINDS = ['material', 'service', 'asset'] as const;
export type LineKind = (typeof LINE_KINDS)[number];
export const KIND_LABEL: Record<LineKind, string> = { material: 'Materials Master', service: 'Service Catalog', asset: 'Asset Catalog' };
export const OPEN_STATUSES = ['draft', 'pending_approval', 'approved', 'acknowledged', 'returned_user'];

export interface Category {
    code: string;
    name: string;
    recommended?: boolean;
    subcategories: Array<{ code: string; name: string; recommended?: boolean; industryMatchedItems?: number; totalItems?: number }>;
}
interface Summary {
    categories: Category[];
    items: Array<{ code: string; name: string; categoryCode: string; subcategoryCode: string; industryScope?: string; industryCodes?: string[] }>;
}

export const setupPath = (orgId: string, kind: LineKind) => `organizations/${orgId}/procurement_setup/${kind}`;
export const requirementsPath = (orgId: string) => `organizations/${orgId}/procurement_requirements`;

export function procurementOn(ctx: OrgContext): boolean {
    const map = isObj(ctx.org.data.modules) ? ctx.org.data.modules : {};
    return map.PRC === true;
}
export function requireProcurement(ctx: OrgContext) {
    if (!procurementOn(ctx)) throw new HttpError(403, 'Procurement (PRC) is not enabled for your organization. Adopt and enable it under Modules.');
}
export const isSuper = (ctx: OrgContext) => ctx.role === 'org_super_admin';
export const can = (ctx: OrgContext, perm: string) => isSuper(ctx) || hasPerm(ctx.permissions, perm);

export function kindOf(value: unknown): LineKind {
    const k = str(value) as LineKind;
    if (!LINE_KINDS.includes(k)) throw new HttpError(400, 'Choose Material, Service or Asset.');
    return k;
}

/** The published master for a kind (null when MEMS has not loaded it yet). */
export async function masterSummary(kind: LineKind): Promise<Summary | null> {
    if (kind === 'asset') return assetCatalogSummary();
    return catalogSummary(kind === 'material' ? 'materials' : 'services');
}

export interface Adoption {
    categories: Category[];
    version: number;
    updatedAt: string;
    updatedBy: string;
}
export async function adopted(orgId: string, kind: LineKind): Promise<Adoption> {
    const doc = await getDoc(setupPath(orgId, kind));
    const raw = Array.isArray(doc?.data.categories) ? (doc!.data.categories as unknown[]).filter(isObj) : [];
    return {
        categories: raw.map((c) => ({
            code: str(c.code),
            name: str(c.name),
            subcategories: (Array.isArray(c.subcategories) ? (c.subcategories as unknown[]).filter(isObj) : []).map((s) => ({ code: str(s.code), name: str(s.name) })),
        })),
        version: Number(doc?.data.version) || 0,
        updatedAt: str(doc?.data.updatedAt),
        updatedBy: str(doc?.data.updatedBy),
    };
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9._ /-]{0,59}$/;
const key = (c: string, s: string) => `${c}|${s}`;

export const procurementSetupRoutes = {
    // Everything the Setup screen needs: for each kind the master tree and what is adopted today.
    'POST /api/org/procurement/setup/overview': [
        orgRoute('org.procurement.setup.overview', null, async (ctx) => {
            requireProcurement(ctx);
            if (!can(ctx, 'PRC.setup.view') && !can(ctx, 'PRC.setup.manage')) throw new HttpError(403, 'You do not have permission to view procurement setup.');
            const kinds = await Promise.all(
                LINE_KINDS.map(async (kind) => {
                    const [master, current] = await Promise.all([masterSummary(kind), adopted(ctx.orgId, kind)]);
                    return { kind, label: KIND_LABEL[kind], masterLoaded: !!master, master: master ? recommendProcurementCategories(master.categories,master.items,str(ctx.org.data.industry)) : [], adopted: current.categories, version: current.version, updatedAt: current.updatedAt };
                })
            );
            return { kinds, canManage: can(ctx, 'PRC.setup.manage') };
        }),
    ],

    'POST /api/org/procurement/setup/save': [
        orgRoute('org.procurement.setup.save', 'PRC.setup.manage', async (ctx) => {
            requireProcurement(ctx);
            const kind = kindOf(ctx.body.kind);
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 10 || reason.length > 300) throw new HttpError(400, 'Give the reason for this change (10 to 300 characters).');
            const master = await masterSummary(kind);
            if (!master) throw new HttpError(409, `MEMS has not loaded the ${KIND_LABEL[kind]} yet.`);
            const selection = (Array.isArray(ctx.body.selection) ? (ctx.body.selection as unknown[]) : []).filter(isObj);
            if (selection.length > 400) throw new HttpError(400, 'Too many categories selected.');

            const byCode = new Map(master.categories.map((c) => [c.code, c]));
            const next: Category[] = [];
            const seen = new Set<string>();
            for (const s of selection) {
                const code = str(s.code);
                if (!CODE.test(code)) throw new HttpError(400, 'Invalid category code.');
                if (seen.has(code)) throw new HttpError(400, `Category ${code} is selected twice.`);
                seen.add(code);
                const m = byCode.get(code);
                if (!m) throw new HttpError(400, `Category ${code} is not in the ${KIND_LABEL[kind]}.`);
                const subs = new Map(m.subcategories.map((x) => [x.code, x]));
                const picked: Array<{ code: string; name: string }> = [];
                for (const sc of (Array.isArray(s.subcategories) ? (s.subcategories as unknown[]) : []).map(str)) {
                    const found = subs.get(sc);
                    if (!found) throw new HttpError(400, `Subcategory ${sc} does not belong to category ${code}.`);
                    if (!picked.some((p) => p.code === sc)) picked.push(found);
                }
                if (!picked.length) throw new HttpError(400, `Choose at least one subcategory for ${m.name}, or remove the category.`);
                next.push({ code, name: m.name, subcategories: picked });
            }

            const current = await adopted(ctx.orgId, kind);
            if (Number(ctx.body.expectedVersion) !== current.version) throw new HttpError(409, 'Someone else changed procurement setup. Reload and apply your changes again.');

            const before = new Set(current.categories.flatMap((c) => c.subcategories.map((s) => key(c.code, s.code))));
            const after = new Set(next.flatMap((c) => c.subcategories.map((s) => key(c.code, s.code))));
            const removed = [...before].filter((x) => !after.has(x));
            const added = [...after].filter((x) => !before.has(x));
            if (!removed.length && !added.length) throw new HttpError(400, 'Nothing has changed.');

            // Rule: nothing may be removed while an open purchase requirement still uses it.
            if (removed.length) {
                const gone = new Set(removed);
                const open = (await listDocs(requirementsPath(ctx.orgId))).filter((r) => OPEN_STATUSES.includes(str(r.data.status)));
                const using: string[] = [];
                for (const r of open) {
                    const lines = Array.isArray(r.data.lines) ? (r.data.lines as unknown[]).filter(isObj) : [];
                    if (lines.some((l) => str(l.type) === kind && gone.has(key(str(l.categoryCode), str(l.subcategoryCode))))) using.push(r.id);
                }
                if (using.length) throw new HttpError(409, `Cannot remove categories that are in use by open purchase requirements: ${using.slice(0, 5).join(', ')}${using.length > 5 ? ` and ${using.length - 5} more` : ''}.`);
            }

            const version = current.version + 1;
            const now = nowIso();
            const data = { kind, categories: next, version, updatedAt: now, updatedBy: ctx.uid };
            await writeDoc(`${setupPath(ctx.orgId, kind)}/versions/${version}`, { ...data, reason, added: added.length, removed: removed.length }, { exists: false });
            await writeDoc(setupPath(ctx.orgId, kind), data);
            await record(ctx, 'org.procurement.setup.save', KIND_LABEL[kind], `Version ${version}: ${added.length} subcategories added, ${removed.length} removed, ${next.length} categories adopted. Reason: ${reason}`);
            return { ok: true, version };
        }),
    ],

    // The chart of authority for procurement: who may do what, who approves, what must stay apart.
    'POST /api/org/procurement/authority': [
        orgRoute('org.procurement.authority', null, async (ctx) => {
            requireProcurement(ctx);
            if (!can(ctx, 'PRC.setup.view') && !can(ctx, 'PRC.setup.manage') && !can(ctx, 'ADM.roles')) throw new HttpError(403, 'You do not have permission to view the chart of authority.');
            return { rules: PROCUREMENT_AUTHORITY, planned: PLANNED_SUBMODULES };
        }),
    ],
};
