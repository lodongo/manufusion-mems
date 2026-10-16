import { randomInt } from 'crypto';
import { HttpError, deleteDoc, getDoc, isObj, listDocs, nowIso, str, writeDoc, type Doc } from './core';
import { allowedNodeIds, nextOrgCounter } from './positions';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { audited, requireAt } from './scopeGuard';
import { postStockTake } from './finOps';

// ---------------------------------------------------------------------------
// Stock take (physical inventory, PI documents).
//   organizations/{org}/stock_take_configs/{COUNT_CONFIGnnnnnnnn}   reusable count configurations
//   organizations/{org}/stock_take_sessions/{PInnnnnnnnn[_n]}       a PI document and its recounts
//   organizations/{org}/stock_take_attachments/{sessionId}          the signed PI scan (kept out of the session)
//
// Flow: awaiting_print → counting → verification → verified → pending_post_approval → approved_for_posting
//       → reconciled (or recount_pending while recount PIs are open); disregarded / closed_posted end a session.
// Controls:
//   - every action needs its INV_ST_ permission at the session's warehouse (job roles bound to places);
//   - separation of duties: the counter cannot verify, approve or post; the person requesting posting cannot
//     approve it; there is no self-approval exception for anyone;
//   - stock is only posted after approval; every step is audited.
// ---------------------------------------------------------------------------

const TYPES = ['Cycle Count', 'Full Stock Take', 'Cluster Stock Take', 'Random Stock Take'];
const PERIODS = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually'];
const CLOSED = ['reconciled', 'disregarded', 'closed_posted'];
const CLUSTER_RE = /^CL-\d{4}$/;
const SESSION_RE = /^PI\d{9}(_\d{1,3})?$/;
const CONFIG_RE = /^COUNT_CONFIG\d{8}$/;
const MAX_ATTACHMENT_CHARS = 650_000; // about 450 KB of file as base64
const ACTION_PERMS: Record<string, string> = {
    printed: 'INV_ST_010',
    counts: 'INV_ST_017',
    edit_counts: 'INV_ST_016',
    verify: 'INV_ST_020',
    recount: 'INV_ST_022',
    refresh_baseline: 'INV_ST_024',
    submit_posting: 'INV_ST_026',
    approve_posting: 'INV_ST_027',
    post: 'INV_ST_028',
    disregard: 'INV_ST_012',
    close_posted: 'INV_ST_013',
};

const rootOf = (ctx: OrgContext) => `organizations/${ctx.orgId}`;

/** Warehouses the user may see ('read', includes view-only extra scopes) or act on ('write'). */
async function warehousesFor(ctx: OrgContext, mode: 'read' | 'write') {
    const allowed = ctx.role === 'org_super_admin' ? 'all' : await allowedNodeIds(ctx.orgId, ctx.me, mode === 'read');
    return (await listDocs(`${rootOf(ctx)}/warehouses`)).filter((w) => allowed === 'all' || allowed.has(w.id));
}

function canView(ctx: OrgContext) {
    if (ctx.role === 'org_super_admin') return;
    if (!['INV.view', 'INV.edit', 'INV_ST_001', 'INV_ST_007'].some((p) => hasPerm(ctx.permissions, p))) throw new HttpError(403, 'Inventory access required');
}

/** Configurations are organization-wide templates: the permission counts wherever it is held. */
function requireAnywhere(ctx: OrgContext, key: string) {
    if (ctx.role !== 'org_super_admin' && !hasPerm(ctx.permissions, key)) throw new HttpError(403, `Stock take permission required: ${key}`);
}

/** Session work is bound to the warehouse: the permission must apply at that warehouse. */
function requireAtWarehouse(ctx: OrgContext, key: string, warehouseId: string) {
    return requireAt(ctx, [key], warehouseId, 'write', `Stock take permission ${key} is required for this warehouse.`);
}

async function snapshot(root: string, warehouseId: string) {
    const [occupancy, materials, journal, infos] = await Promise.all([
        listDocs(`${root}/warehouse_bin_occupancy`),
        listDocs(`${root}/materials`),
        listDocs(`${root}/material_journal`),
        listDocs(`${root}/inventory_material_info`),
    ]);
    const mm = new Map(materials.map((x) => [x.id, x.data]));
    const im = new Map(infos.map((x) => [x.id, x.data]));
    const byKey = new Map<string, { q: number; valid: boolean; seen: boolean }>();
    for (const x of journal) {
        const d = x.data;
        if (str(d.warehouseId) !== warehouseId) continue;
        const k = str(d.materialId);
        const v = byKey.get(k) || { q: 0, valid: true, seen: false };
        v.seen = true;
        if (str(d.status) !== 'posted' || d.reconciled !== true) v.valid = false;
        else v.q += Number(isObj(d.balancesDelta) ? d.balancesDelta.physicalStock : 0) || 0;
        byKey.set(k, v);
    }
    return occupancy
        .filter((x) => str(x.data.warehouseId) === warehouseId)
        .map((x) => {
            const d = x.data;
            const m = mm.get(str(d.materialId));
            const j = byKey.get(str(d.materialId));
            return {
                binId: str(d.binId),
                materialId: str(d.materialId),
                materialNumber: str(m?.materialNumber) || str(d.materialNumber),
                description: str(m?.shortText) || str(m?.name),
                expected: j?.seen && j.valid ? j.q : null,
                info: im.get(`${str(d.materialId)}_${warehouseId}`),
            };
        })
        .sort((a, b) => a.binId.localeCompare(b.binId, undefined, { numeric: true }));
}

async function getSession(ctx: OrgContext, id: string, mode: 'read' | 'write') {
    if (!SESSION_RE.test(id)) throw new HttpError(400, 'Invalid PI document');
    const root = rootOf(ctx);
    const [warehouses, doc] = await Promise.all([warehousesFor(ctx, mode), getDoc(`${root}/stock_take_sessions/${id}`)]);
    if (!doc || !warehouses.some((w) => w.id === str(doc.data.warehouseId))) throw new HttpError(404, 'Stock take session not found');
    return { root, doc };
}

/**
 * Session as listed. Counting is blind: system quantities are withheld until counts are submitted. The signed PI
 * scan itself is fetched separately (stocktake/attachment).
 */
function publicSession(x: Doc) {
    const a = isObj(x.data.piAttachment) ? x.data.piAttachment : null;
    const blind = ['awaiting_print', 'counting'].includes(str(x.data.status));
    const lines = Array.isArray(x.data.lines) ? x.data.lines.filter(isObj).map((l) => (blind ? { ...l, expected: null } : l)) : [];
    return {
        id: x.id,
        ...x.data,
        lines,
        piAttachment: a ? { name: str(a.name), type: str(a.type), uploadedBy: str(a.uploadedBy), uploadedAt: str(a.uploadedAt) } : undefined,
    };
}

function readConfig(b: Record<string, unknown>) {
    const name = str(b.name).trim();
    const type = str(b.type);
    const selection = str(b.selection);
    const period = str(b.period);
    const size = Number(b.documentSize);
    const duration = Number(b.durationDays);
    const clusterId = str(b.clusterId).trim().toUpperCase();
    if (name.length < 3 || name.length > 80) throw new HttpError(400, 'Enter a configuration name of 3 to 80 characters');
    if (!TYPES.includes(type) || !['Sequence', 'Random'].includes(selection)) throw new HttpError(400, 'Invalid stock take type or selection order');
    if (!Number.isInteger(size) || size < 1 || size > 1000) throw new HttpError(400, 'PI document size must be 1–1000 physical locations');
    if (b.periodic === true && !PERIODS.includes(period)) throw new HttpError(400, 'Select a valid period');
    if (type === 'Cycle Count' && (!Number.isInteger(duration) || duration < 1 || duration > 3650)) throw new HttpError(400, 'Cycle count duration must be 1–3650 days');
    if (type === 'Cluster Stock Take' && !CLUSTER_RE.test(clusterId)) throw new HttpError(400, 'Enter the cluster code, for example CL-0001');
    return {
        name,
        type,
        selection,
        periodic: b.periodic === true,
        period: b.periodic === true ? period : '',
        durationDays: type === 'Cycle Count' ? duration : null,
        documentSize: size,
        clusterId: type === 'Cluster Stock Take' ? clusterId : '',
    };
}

/** Cryptographically random sample, so nobody can predict which locations will be counted. */
function randomSample<T>(items: T[], size: number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, size);
}

export const stockTakeRoutes = {
    'POST /api/org/inventory/stocktake/list': [
        orgRoute('org.inventory.stocktake.list', null, async (ctx) => {
            canView(ctx);
            const root = rootOf(ctx);
            const warehouses = await warehousesFor(ctx, 'read');
            const visible = new Set(warehouses.map((w) => w.id));
            const [configs, sessions] = await Promise.all([listDocs(`${root}/stock_take_configs`), listDocs(`${root}/stock_take_sessions`)]);
            return {
                warehouses: warehouses.map((w) => ({ id: w.id, name: str(w.data.name) || str(w.data.costCenterCode) || str(w.data.code) || w.id })),
                configs: configs.filter((x) => !str(x.data.warehouseId) || visible.has(str(x.data.warehouseId))).map((x) => ({ id: x.id, ...x.data })),
                sessions: sessions
                    .filter((x) => visible.has(str(x.data.warehouseId)))
                    .map(publicSession)
                    .sort((a, b) => str((b as Record<string, unknown>).createdAt).localeCompare(str((a as Record<string, unknown>).createdAt))),
            };
        }),
    ],

    'POST /api/org/inventory/stocktake/config': [
        orgRoute('org.inventory.stocktake.config', null, async (ctx) => {
            requireAnywhere(ctx, 'INV_ST_002');
            const root = rootOf(ctx);
            const config = readConfig(ctx.body);
            for (let attempt = 0; attempt < 3; attempt++) {
                const n = await nextOrgCounter(ctx.orgId, 'stockCountConfigSeq');
                if (n > 99_999_999) throw new HttpError(409, 'Stock count configuration sequence exhausted');
                const id = `COUNT_CONFIG${String(n).padStart(8, '0')}`;
                const ok = await writeDoc(`${root}/stock_take_configs/${id}`, { warehouseId: '', ...config, createdBy: ctx.uid, createdAt: nowIso(), active: true }, { exists: false });
                if (ok) {
                    await audited(ctx, 'inventory.stocktake.config.create', `Stock take configuration ${id}`, config);
                    return { ok: true, id };
                }
            }
            throw new HttpError(409, 'Unable to reserve configuration ID. Retry.');
        }),
    ],

    'POST /api/org/inventory/stocktake/config/edit': [
        orgRoute('org.inventory.stocktake.config.edit', null, async (ctx) => {
            requireAnywhere(ctx, 'INV_ST_003');
            const root = rootOf(ctx);
            const id = str(ctx.body.id);
            if (!CONFIG_RE.test(id)) throw new HttpError(400, 'Invalid configuration');
            const existing = await getDoc(`${root}/stock_take_configs/${id}`);
            if (!existing) throw new HttpError(404, 'Configuration not found');
            const config = readConfig(ctx.body);
            const patch = { ...existing.data, ...config, updatedBy: ctx.uid, updatedAt: nowIso() };
            await writeDoc(`${root}/stock_take_configs/${id}`, patch);
            const changed = Object.keys(config).filter((k) => JSON.stringify(existing.data[k] ?? null) !== JSON.stringify((config as Record<string, unknown>)[k] ?? null));
            await audited(ctx, 'inventory.stocktake.config.edit', `Stock take configuration ${id}`, {
                changed: Object.fromEntries(changed.map((k) => [k, { from: existing.data[k] ?? null, to: (config as Record<string, unknown>)[k] ?? null }])),
            });
            return { ok: true, id };
        }),
    ],

    'POST /api/org/inventory/stocktake/config/delete': [
        orgRoute('org.inventory.stocktake.config.delete', null, async (ctx) => {
            requireAnywhere(ctx, 'INV_ST_005');
            const root = rootOf(ctx);
            const id = str(ctx.body.id);
            if (!CONFIG_RE.test(id)) throw new HttpError(400, 'Invalid configuration');
            const existing = await getDoc(`${root}/stock_take_configs/${id}`);
            if (!existing) throw new HttpError(404, 'Configuration not found');
            const sessions = await listDocs(`${root}/stock_take_sessions`);
            if (sessions.some((x) => str(x.data.configId) === id)) throw new HttpError(409, 'Configuration has stock take sessions and cannot be deleted. Disable it instead.');
            await deleteDoc(`${root}/stock_take_configs/${id}`);
            await audited(ctx, 'inventory.stocktake.config.delete', `Stock take configuration ${id}`, existing.data);
            return { ok: true, id };
        }),
    ],

    'POST /api/org/inventory/stocktake/start': [
        orgRoute('org.inventory.stocktake.start', null, async (ctx) => {
            const root = rootOf(ctx);
            const b = ctx.body;
            const warehouseId = str(b.warehouseId);
            const warehouses = await warehousesFor(ctx, 'write');
            if (!warehouseId || !warehouses.some((w) => w.id === warehouseId)) throw new HttpError(403, 'Select an accessible warehouse for this PI');
            await requireAtWarehouse(ctx, 'INV_ST_008', warehouseId);
            const configId = str(b.configId);
            const config = CONFIG_RE.test(configId) ? await getDoc(`${root}/stock_take_configs/${configId}`) : null;
            if (!config || config.data.active === false) throw new HttpError(403, 'Configuration not accessible');
            if (str(config.data.warehouseId) && warehouseId !== str(config.data.warehouseId)) throw new HttpError(400, 'Selected warehouse does not match configuration');

            let eligible = await snapshot(root, warehouseId);
            if (str(config.data.type) === 'Cluster Stock Take') {
                const cluster = str(config.data.clusterId);
                if (!CLUSTER_RE.test(cluster)) throw new HttpError(400, 'Cluster configuration required');
                eligible = eligible.filter((x) => x.binId.startsWith(`${cluster}__`));
            }
            if (!eligible.length) throw new HttpError(409, 'No mapped physical locations found for this selection');
            const size = Number(config.data.documentSize) || 1;
            if (str(config.data.selection) === 'Sequence') {
                const start = str(b.startBin) || eligible[0].binId;
                const index = eligible.findIndex((x) => x.binId === start);
                if (index < 0) throw new HttpError(400, 'Starting physical location not found');
                eligible = eligible.slice(index, index + size);
            } else {
                eligible = randomSample(eligible, size);
            }
            if (!eligible.length) throw new HttpError(409, 'No physical locations selected');
            if (new Set(eligible.map((x) => x.materialId)).size !== eligible.length) {
                throw new HttpError(409, 'Multiple mapped locations for one material require location-level stock ledger; select a smaller PI document to avoid unsafe reconciliation.');
            }

            const sessions = await listDocs(`${root}/stock_take_sessions`);
            const top = sessions.reduce((n, x) => Math.max(n, Number(/^PI([0-9]{9})$/.exec(x.id)?.[1] || 0)), 0);
            for (let n = top + 1; n < top + 50; n++) {
                const id = `PI${String(n).padStart(9, '0')}`;
                const now = nowIso();
                const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
                const part = (key: string) => parts.find((p) => p.type === key)?.value || '';
                const sessionName = `${str(config.data.name)} ${part('day')}${part('month').toUpperCase()}${part('year')}${part('hour')}${part('minute')}`;
                const ok = await writeDoc(
                    `${root}/stock_take_sessions/${id}`,
                    {
                        piNumber: id,
                        sessionName,
                        configId,
                        configName: str(config.data.name),
                        warehouseId,
                        type: str(config.data.type),
                        status: 'awaiting_print',
                        createdAt: now,
                        createdBy: ctx.uid,
                        printedAt: '',
                        parentPi: '',
                        recountNumber: 0,
                        lines: eligible.map((x) => ({ binId: x.binId, materialId: x.materialId, materialNumber: x.materialNumber, description: x.description, expected: x.expected, counted: null, verified: false, recount: false, posted: false })),
                        documentSize: eligible.length,
                    } as never,
                    { exists: false }
                );
                if (ok) {
                    await audited(ctx, 'inventory.stocktake.start', `PI ${id}`, { configId, warehouseId, locations: eligible.length, selection: str(config.data.selection) });
                    return { ok: true, id };
                }
            }
            throw new HttpError(409, 'Unable to reserve a PI sequence. Retry.');
        }),
    ],

    'POST /api/org/inventory/stocktake/attachment': [
        orgRoute('org.inventory.stocktake.attachment', null, async (ctx) => {
            canView(ctx);
            const id = str(ctx.body.id);
            const { root, doc } = await getSession(ctx, id, 'read');
            await requireAt(ctx, ['INV_ST_011', 'INV_ST_017', 'INV_ST_020', 'INV_ST_027', 'INV.view'], str(doc.data.warehouseId), 'read', 'You do not have permission to view PI documents for this warehouse.');
            const stored = await getDoc(`${root}/stock_take_attachments/${id}`);
            const legacy = isObj(doc.data.piAttachment) ? doc.data.piAttachment : null;
            const source = stored?.data ?? legacy;
            if (!source || !str(source.data)) throw new HttpError(404, 'No signed PI document is attached');
            await audited(ctx, 'inventory.stocktake.attachment.view', `PI ${id}`, { name: str(source.name) });
            return { name: str(source.name), type: str(source.type), data: str(source.data) };
        }),
    ],

    'POST /api/org/inventory/stocktake/action': [
        orgRoute('org.inventory.stocktake.action', null, async (ctx) => {
            const id = str(ctx.body.id);
            const action = str(ctx.body.action);
            const perm = ACTION_PERMS[action];
            if (!perm) throw new HttpError(400, 'Unsupported Stock Take action');
            const { root, doc } = await getSession(ctx, id, 'write');
            const d = doc.data;
            const warehouseId = str(d.warehouseId);
            await requireAtWarehouse(ctx, perm, warehouseId);
            const status = str(d.status);
            const lines: Array<Record<string, any>> = Array.isArray(d.lines) ? d.lines.filter(isObj).map((x) => ({ ...x })) : [];
            const sessionPath = `${root}/stock_take_sessions/${id}`;
            const children = async () => (await listDocs(`${root}/stock_take_sessions`)).filter((x) => str(x.data.parentPi) === id);

            const save = async (patch: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
                await writeDoc(sessionPath, { ...d, ...patch, updatedAt: nowIso(), updatedBy: ctx.uid } as never);
                await audited(ctx, `inventory.stocktake.${action}`, `PI ${id}`, {
                    from: status,
                    to: str(patch.status) || status,
                    reason: str(patch.disregardReason || patch.closureReason || patch.countEditReason),
                    linesChanged: Array.isArray(patch.lines) ? patch.lines.length : 0,
                    ...extra,
                });
                return { ok: true };
            };

            if (action === 'close_posted') {
                if (status !== 'posted' && !lines.some((x) => x.posted)) throw new HttpError(409, 'Only sessions with posted stock can use Close Posted Session');
                if (CLOSED.includes(status)) throw new HttpError(409, 'Session already closed');
                const reason = str(ctx.body.reason).trim();
                if (reason.length < 10) throw new HttpError(400, 'Enter a closure reason of at least 10 characters');
                if ((await children()).some((x) => !CLOSED.includes(str(x.data.status)))) throw new HttpError(409, 'Close active recount PI documents first');
                return save({ status: 'closed_posted', closedAt: nowIso(), closedBy: ctx.uid, closureReason: reason.slice(0, 500), closureType: 'posted_session', reconciledAt: d.reconciledAt || '' });
            }

            if (action === 'disregard') {
                if (['reconciled', 'disregarded', 'posted', 'recount_pending', 'closed_posted'].includes(status) || lines.some((x) => x.posted)) throw new HttpError(409, 'This PI has posted stock movements and cannot be disregarded');
                const reason = str(ctx.body.reason).trim();
                if (reason.length < 10) throw new HttpError(400, 'Enter a reason of at least 10 characters');
                if ((await children()).some((x) => !CLOSED.includes(str(x.data.status)))) throw new HttpError(409, 'Close active recount PI documents first');
                return save({ status: 'disregarded', disregardedAt: nowIso(), disregardedBy: ctx.uid, disregardReason: reason.slice(0, 500) });
            }

            if (action === 'printed') {
                if (status !== 'awaiting_print') throw new HttpError(409, 'PI is not awaiting printing');
                return save({ status: 'counting', printedAt: nowIso(), printedBy: ctx.uid });
            }

            if (action === 'counts') {
                if (status !== 'counting') throw new HttpError(409, 'PI must be printed before counts are entered');
                const values = Array.isArray(ctx.body.counts) ? ctx.body.counts : [];
                if (values.length !== lines.length) throw new HttpError(400, 'Every line requires a count');
                values.forEach((v: unknown, i: number) => {
                    if (v === '' || v === null || !Number.isFinite(Number(v)) || Number(v) < 0) throw new HttpError(400, 'Enter a non-negative count for every physical location');
                    lines[i].counted = Number(v);
                });
                const attachment = ctx.body.attachment;
                const type = isObj(attachment) ? str(attachment.type) : '';
                const data = isObj(attachment) ? str(attachment.data) : '';
                if (
                    !isObj(attachment) ||
                    !['application/pdf', 'image/jpeg', 'image/png'].includes(type) ||
                    !data.startsWith(`data:${type};base64,`) ||
                    !/^data:(application\/pdf|image\/jpeg|image\/png);base64,[A-Za-z0-9+/=]+$/.test(data) ||
                    data.length > MAX_ATTACHMENT_CHARS
                ) {
                    throw new HttpError(400, 'Attach a signed PI PDF or image (maximum 450 KB)');
                }
                const meta = { name: str(attachment.name).slice(0, 120), type, uploadedBy: ctx.uid, uploadedAt: nowIso() };
                await writeDoc(`${root}/stock_take_attachments/${id}`, { ...meta, data, sessionId: id, warehouseId });
                return save({ lines, status: 'verification', countedAt: nowIso(), countedBy: ctx.uid, piAttachment: meta }, { attachment: meta.name });
            }

            if (action === 'edit_counts') {
                if (status !== 'verification') throw new HttpError(409, 'Counts may only be edited before verification');
                const reason = str(ctx.body.reason).trim();
                if (reason.length < 10) throw new HttpError(400, 'Count correction reason must be at least 10 characters');
                const values = Array.isArray(ctx.body.counts) ? ctx.body.counts : [];
                if (values.length !== lines.length) throw new HttpError(400, 'Provide all corrected counts');
                const before = lines.map((x) => x.counted);
                values.forEach((v: unknown, i: number) => {
                    if (v === '' || v === null || !Number.isFinite(Number(v)) || Number(v) < 0) throw new HttpError(400, 'Counts must be non-negative');
                    lines[i].counted = Number(v);
                });
                return save({ lines, countEditedBy: ctx.uid, countEditedAt: nowIso(), countEditReason: reason.slice(0, 500) }, { before, after: lines.map((x) => x.counted) });
            }

            if (action === 'verify') {
                if (status !== 'verification') throw new HttpError(409, 'Session not awaiting verification');
                if (str(d.countedBy) === ctx.uid || str(d.countEditedBy) === ctx.uid) throw new HttpError(403, 'Counts must be verified by someone other than the person who counted or corrected them.');
                const recountIds = Array.isArray(ctx.body.recountIndices) ? ctx.body.recountIndices.map(Number) : [];
                if (recountIds.some((i: number) => !Number.isInteger(i) || i < 0 || i >= lines.length || lines[i].expected === lines[i].counted)) throw new HttpError(400, 'Recount selection must contain inconsistent lines');
                lines.forEach((line, i) => {
                    line.verified = true;
                    line.recount = recountIds.includes(i);
                });
                return save({ lines, status: 'verified', verifiedAt: nowIso(), verifiedBy: ctx.uid }, { recountLines: recountIds.length });
            }

            if (action === 'recount') {
                if (status !== 'verified') throw new HttpError(409, 'Verify discrepancies before recount');
                const flagged = lines.filter((x) => x.recount && !x.posted);
                if (!flagged.length) throw new HttpError(409, 'No discrepancies marked for recount');
                const currentSnapshot = await snapshot(root, warehouseId);
                const parent = str(d.parentPi) || id;
                const siblings = (await listDocs(`${root}/stock_take_sessions`)).filter((x) => x.id === parent || x.id.startsWith(`${parent}_`));
                const number = Math.max(0, ...siblings.map((x) => Number(new RegExp(`^${parent}_([0-9]+)$`).exec(x.id)?.[1] || 0))) + 1;
                const next = `${parent}_${number}`;
                const ok = await writeDoc(
                    `${root}/stock_take_sessions/${next}`,
                    {
                        piNumber: next,
                        configId: d.configId,
                        configName: d.configName,
                        warehouseId,
                        type: d.type,
                        status: 'awaiting_print',
                        createdAt: nowIso(),
                        createdBy: ctx.uid,
                        parentPi: parent,
                        recountNumber: number,
                        lines: flagged.map((x) => ({
                            ...x,
                            expected: currentSnapshot.find((v) => v.materialId === str(x.materialId) && v.binId === str(x.binId))?.expected ?? null,
                            counted: null,
                            verified: false,
                            recount: false,
                            posted: false,
                        })),
                        documentSize: flagged.length,
                    } as never,
                    { exists: false }
                );
                if (!ok) throw new HttpError(409, 'Recount already created; refresh');
                await save({ recountPi: next }, { recountPi: next });
                return { ok: true, id: next };
            }

            if (action === 'refresh_baseline') {
                if (status !== 'verified') throw new HttpError(409, 'Only verified sessions can refresh a stale baseline');
                const current = await snapshot(root, warehouseId);
                for (const line of lines) {
                    if (line.posted || line.recount) continue;
                    const fresh = current.find((x) => x.materialId === str(line.materialId) && x.binId === str(line.binId));
                    if (!fresh || fresh.expected === null) throw new HttpError(409, 'Current reconciled stock unavailable; cannot refresh baseline');
                    line.expected = fresh.expected;
                    line.verified = false;
                }
                return save({ lines, status: 'verification', baselineRefreshedAt: nowIso(), baselineRefreshedBy: ctx.uid });
            }

            if (action === 'submit_posting') {
                if (status !== 'verified') throw new HttpError(409, 'Verify the count before posting');
                if (!lines.some((x) => x.verified && !x.recount && !x.posted)) throw new HttpError(409, 'No verified non-recount lines to post');
                return save({ status: 'pending_post_approval', postingRequestedBy: ctx.uid, postingRequestedAt: nowIso() });
            }

            if (action === 'approve_posting') {
                if (status !== 'pending_post_approval') throw new HttpError(409, 'Posting not awaiting approval');
                if (str(d.postingRequestedBy) === ctx.uid || str(d.countedBy) === ctx.uid) throw new HttpError(403, 'Posting must be approved by someone other than the person who requested it or counted the stock.');
                return save({ status: 'approved_for_posting', postingApprovedBy: ctx.uid, postingApprovedAt: nowIso() });
            }

            if (action === 'post') {
                if (status !== 'approved_for_posting') throw new HttpError(409, 'Posting must be approved first. Submit the PI for posting approval.');
                if (str(d.countedBy) === ctx.uid) throw new HttpError(403, 'The person who counted the stock cannot post it.');
                const pending = lines.filter((x) => x.verified && !x.recount && !x.posted);
                if (!pending.length) throw new HttpError(409, 'No eligible lines to reconcile');
                // Value the differences in finance first (refused when finance is live and cannot post), then move the quantities.
                const freshStock = await snapshot(root, warehouseId);
                const finDeltas: Array<{ materialId: string; delta: number }> = [];
                for (const line of pending) {
                    if (line.expected === null || line.counted === null) continue;
                    const delta = Number(line.counted) - Number(line.expected);
                    if (!delta) continue;
                    const key = `PI_${id}_${str(line.materialId).replace(/[^a-zA-Z0-9_-]/g, '_')}_${str(line.binId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                    if (await getDoc(`${root}/material_journal/${key}`)) continue;
                    const current = freshStock.find((x) => x.materialId === str(line.materialId) && x.binId === str(line.binId));
                    if (!current || current.expected !== line.expected) throw new HttpError(409, 'Stock has changed since counting; recount is required');
                    finDeltas.push({ materialId: str(line.materialId), delta });
                }
                const financeJournal = await postStockTake(ctx, warehouseId, id, finDeltas);
                let adjustments = 0;
                for (const line of pending) {
                    if (line.expected === null || line.counted === null) throw new HttpError(409, 'Cannot post without reconciled baseline and count');
                    const delta = Number(line.counted) - Number(line.expected);
                    const key = `PI_${id}_${str(line.materialId).replace(/[^a-zA-Z0-9_-]/g, '_')}_${str(line.binId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                    if (delta !== 0) {
                        const existing = await getDoc(`${root}/material_journal/${key}`);
                        if (!existing) {
                            const latest = await snapshot(root, warehouseId);
                            const current = latest.find((x) => x.materialId === str(line.materialId) && x.binId === str(line.binId));
                            if (!current || current.expected !== line.expected) throw new HttpError(409, 'Stock has changed since counting; recount is required');
                            const created = await writeDoc(
                                `${root}/material_journal/${key}`,
                                {
                                    materialId: str(line.materialId),
                                    warehouseId,
                                    type: 'STOCK_TAKE_ADJUSTMENT',
                                    status: 'posted',
                                    reconciled: true,
                                    balancesDelta: { physicalStock: delta },
                                    reference: id,
                                    binId: str(line.binId),
                                    createdAt: nowIso(),
                                    postedAt: nowIso(),
                                    postedBy: ctx.uid,
                                    approvedBy: str(d.postingApprovedBy),
                                    source: 'stock_take',
                                    version: 1,
                                },
                                { exists: false }
                            );
                            if (!created) throw new HttpError(409, 'Concurrent stock take posting detected');
                            adjustments++;
                        }
                    }
                    line.posted = true;
                }
                const partial = lines.some((x) => x.recount && !x.posted);
                const result = await save({ lines, status: partial ? 'recount_pending' : 'reconciled', postedAt: nowIso(), postedBy: ctx.uid, reconciledAt: partial ? '' : nowIso(), financeJournal }, { linesPosted: pending.length, adjustments, financeJournal });
                if (d.parentPi && !partial) {
                    const parentId = str(d.parentPi);
                    const parent = await getDoc(`${root}/stock_take_sessions/${parentId}`);
                    if (parent) {
                        const siblings = (await listDocs(`${root}/stock_take_sessions`)).filter((x) => str(x.data.parentPi) === parentId);
                        if (siblings.length && siblings.every((x) => x.id === id || str(x.data.status) === 'reconciled')) {
                            const pLines = Array.isArray(parent.data.lines) ? parent.data.lines.filter(isObj) : [];
                            if (pLines.every((x) => x.posted || x.recount)) await writeDoc(`${root}/stock_take_sessions/${parentId}`, { ...parent.data, status: 'reconciled', reconciledAt: nowIso(), updatedAt: nowIso() });
                        }
                    }
                }
                return result;
            }

            throw new HttpError(400, 'Unknown stock take action');
        }),
    ],
};
