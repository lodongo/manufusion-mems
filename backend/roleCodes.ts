import { HttpError, deleteDoc, fieldEq, getDoc, isObj, listDocs, nowIso, runQuery, str, writeDoc, type Doc } from './core';
import { clearAccessCache, orgRoute, type OrgContext } from './guards';
import { record } from './org';
import { col } from './structure';

// ---------------------------------------------------------------------------
// Job role codes: ROL_ followed by six digits taken from the organization's database counter (ROL_000001 …).
// Older tenants have shorter codes (ROL_001). This tool renames them to the six-digit form, keeping the number,
// and rewrites every place that points at a job role: reporting lines, user assignments, site role selections and
// manager roles, and workflow approver steps. It is a super-admin action with a preview first. Audit history and
// finished approval history are left untouched on purpose (they are records of what happened).
// ---------------------------------------------------------------------------

const LEGACY = /^ROL_\d{1,5}$/;
const CURRENT = /^ROL_\d{6}$/;

const canonical = (code: string) => `ROL_${code.slice(4).padStart(6, '0')}`;

/** Copy of value with every string that equals a legacy code replaced; returns how many replacements were made. */
function rewrite(value: unknown, map: Map<string, string>): { value: unknown; count: number } {
    if (typeof value === 'string') {
        const to = map.get(value);
        return to ? { value: to, count: 1 } : { value, count: 0 };
    }
    if (Array.isArray(value)) {
        let count = 0;
        const out = value.map((v) => {
            const r = rewrite(v, map);
            count += r.count;
            return r.value;
        });
        return { value: out, count };
    }
    if (isObj(value)) {
        let count = 0;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            const r = rewrite(v, map);
            count += r.count;
            out[k] = r.value;
        }
        return { value: out, count };
    }
    return { value, count: 0 };
}

async function plan(ctx: OrgContext) {
    const root = `organizations/${ctx.orgId}`;
    const positions = await listDocs(`${root}/positions`);
    const map = new Map<string, string>();
    const clashes: string[] = [];
    const existing = new Set(positions.map((p) => p.id));
    for (const p of positions) {
        if (!LEGACY.test(p.id)) continue;
        const to = canonical(p.id);
        if (existing.has(to)) clashes.push(`${p.id} → ${to}`);
        else map.set(p.id, to);
    }
    const sources: Array<{ label: string; docs: Doc[]; path: (d: Doc) => string }> = [
        { label: 'Job roles', docs: positions, path: (d) => `${root}/positions/${d.id}` },
        { label: 'Users', docs: await runQuery({ from: [{ collectionId: 'users' }], where: fieldEq('orgId', ctx.orgId) }), path: (d) => `users/${d.id}` },
        { label: 'Organization design', docs: await listDocs(col(ctx.orgId)), path: (d) => `${col(ctx.orgId)}/${d.id}` },
        { label: 'Workflow configuration', docs: await listDocs(`${root}/workflow_registry`), path: (d) => `${root}/workflow_registry/${d.id}` },
        { label: 'Material workflow', docs: await listDocs(`${root}/material_workflows`), path: (d) => `${root}/material_workflows/${d.id}` },
    ];
    const touched: Array<{ label: string; path: string; data: Record<string, unknown>; count: number }> = [];
    const perArea = new Map<string, number>();
    for (const s of sources) {
        for (const d of s.docs) {
            const r = rewrite(d.data, map);
            const renamed = s.label === 'Job roles' && map.has(d.id);
            if (r.count || renamed) {
                if (!isObj(r.value)) throw new HttpError(500, 'Role code rewrite produced an invalid document.');
                touched.push({ label: s.label, path: s.path(d), data: r.value, count: r.count });
                perArea.set(s.label, (perArea.get(s.label) ?? 0) + 1);
            }
        }
    }
    return {
        map,
        clashes,
        touched,
        positions: positions.length,
        legacy: map.size,
        alreadyCurrent: positions.filter((p) => CURRENT.test(p.id)).length,
        other: positions.filter((p) => !LEGACY.test(p.id) && !CURRENT.test(p.id)).map((p) => p.id),
        areas: [...perArea.entries()].map(([label, documents]) => ({ label, documents })),
        renames: [...map.entries()].map(([from, to]) => ({ from, to })),
    };
}

function guard(ctx: OrgContext) {
    if (ctx.role !== 'org_super_admin') throw new HttpError(403, 'Only a super admin can renumber job roles.');
}

export const roleCodeRoutes = {
    'POST /api/org/positions/codes/review': [
        orgRoute('org.positions.codes.review', 'ADM.structure', async (ctx) => {
            guard(ctx);
            const p = await plan(ctx);
            return { format: 'ROL_000000', positions: p.positions, legacy: p.legacy, alreadyCurrent: p.alreadyCurrent, other: p.other, clashes: p.clashes, areas: p.areas, renames: p.renames.slice(0, 200) };
        }),
    ],

    'POST /api/org/positions/codes/apply': [
        orgRoute('org.positions.codes.apply', 'ADM.structure', async (ctx) => {
            guard(ctx);
            if (ctx.body.confirm !== true) throw new HttpError(400, 'Confirm the renumbering to continue.');
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 10 || reason.length > 300) throw new HttpError(400, 'Give the reason for renumbering (10 to 300 characters).');
            const p = await plan(ctx);
            if (p.clashes.length) throw new HttpError(409, `Cannot renumber: ${p.clashes.join(', ')} already exist.`);
            if (!p.map.size) return { ok: true, renamed: 0, documents: 0 };
            const root = `organizations/${ctx.orgId}`;
            // 1. Create the new job role documents first, so nothing ever points at a missing role.
            for (const t of p.touched.filter((x) => x.label === 'Job roles')) {
                const oldId = t.path.split('/').pop() as string;
                const to = p.map.get(oldId);
                if (!to) continue;
                if (!(await getDoc(`${root}/positions/${to}`))) await writeDoc(`${root}/positions/${to}`, { ...t.data, previousCode: oldId, recodedAt: nowIso(), recodedBy: ctx.uid }, { exists: false });
            }
            // 2. Rewrite every document that points at a job role (including job roles that report to a renamed one).
            for (const t of p.touched) {
                const oldId = t.path.split('/').pop() as string;
                if (t.label === 'Job roles' && p.map.has(oldId)) continue;
                await writeDoc(t.path, t.data);
            }
            // 3. Remove the old documents.
            for (const [from] of p.map) await deleteDoc(`${root}/positions/${from}`);
            clearAccessCache(ctx.orgId);
            await record(ctx, 'org.positions.recode', 'Job role codes', `${p.map.size} job roles renumbered to ROL_ + 6 digits, ${p.touched.length} documents updated. Reason: ${reason}`);
            return { ok: true, renamed: p.map.size, documents: p.touched.length };
        }),
    ],
};
