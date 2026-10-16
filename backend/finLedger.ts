import { HttpError, fieldEq, getDoc, listDocs, nowIso, runQuery, str, writeDoc, type Doc, type Fields } from './core';
import { type OrgContext } from './guards';
import { record } from './org';
import {
    P,
    ROLES,
    TXN_LABEL,
    cents,
    chainOf,
    chartOf,
    commit,
    createRequest,
    entityOf,
    leOf,
    mappingOf,
    nameOf,
    needEntity,
    nextApprovers,
    o,
    objs,
    oneLine,
    ownedCostCenters,
    periodAt,
    permAt,
    post,
    reasonOf,
    registerHandler,
    roleAccount,
    round2,
    scopeOf,
    strs,
    today,
    unitsOf,
    yearsOf,
    ccFinOf,
    type Obj,
    type PostLine,
    type Scope,
    type Unit,
    type Year,
} from './finCore';
import { fin } from './finRoutes';

// ---------------------------------------------------------------------------
// The journal of a legal entity (read only, colour coded by debit and credit, traced back to its source) and the
// period-end routines: trial balance, inventory reconciliation, cost reallocation and the year-end close. Every
// period-end posting is computed by the system, approved under the finance chart of authority and only then posted.
// ---------------------------------------------------------------------------

interface Env {
    units: Map<string, Unit>;
    scope: Scope;
    le: Unit;
}
async function env(ctx: OrgContext, leId: unknown): Promise<Env> {
    const [units, scope] = await Promise.all([unitsOf(ctx.orgId), scopeOf(ctx)]);
    return { units, scope, le: needEntity(units, scope, str(leId)) };
}
const may = (ctx: OrgContext, e: Env, perm: string) => permAt(ctx, perm, e.le.id, e.units, e.scope);
function need(ctx: OrgContext, e: Env, perm: string, what: string) {
    if (!may(ctx, e, perm)) throw new HttpError(403, `${what} needs ${perm} for ${e.le.code} ${e.le.name}.`);
}

async function balancesOf(orgId: string, leId: string): Promise<Doc[]> {
    return runQuery({ from: [{ collectionId: 'fin_bal' }], where: fieldEq('leId', leId) }, `organizations/${orgId}`);
}
function pickPeriod(years: Year[], fy: unknown, no: unknown): { year: Year; no: number } {
    const f = Number(fy);
    const n = Number(no);
    if (Number.isInteger(f) && Number.isInteger(n)) {
        const y = years.find((x) => x.fy === f && x.status !== 'draft');
        if (!y || !y.periods.some((p) => p.no === n)) throw new HttpError(404, 'Period not found.');
        return { year: y, no: n };
    }
    const at = periodAt(years, today());
    if (at) return { year: at.year, no: at.period.no };
    const last = years.filter((y) => y.status !== 'draft').sort((a, b) => b.fy - a.fy)[0];
    if (!last) throw new HttpError(409, 'No financial year is initialised yet.');
    const started = last.periods.filter((p) => p.status !== 'future');
    return { year: last, no: (started[started.length - 1] ?? last.periods[0]).no };
}
function neighbours(years: Year[], fy: number, no: number) {
    const live = years.filter((y) => y.status !== 'draft').sort((a, b) => a.fy - b.fy);
    const flat = live.flatMap((y) => y.periods.map((p) => ({ fy: y.fy, no: p.no, name: p.name, label: y.label })));
    const i = flat.findIndex((x) => x.fy === fy && x.no === no);
    return { prev: i > 0 ? flat[i - 1] : null, next: i >= 0 && i < flat.length - 1 ? flat[i + 1] : null };
}

/** Trial balance at the end of a period: opening, movement and closing by account (and cost center). */
async function trialBalance(orgId: string, leId: string, fy: number, no: number) {
    const [bals, chart] = await Promise.all([balancesOf(orgId, leId), chartOf(orgId, leId)]);
    const rows = new Map<string, { glCode: string; glName: string; statement: string; ccId: string; open: number; dr: number; cr: number }>();
    let priorPl = 0;
    for (const b of bals) {
        const code = str(b.data.glCode);
        const a = chart.get(code);
        const bfy = Number(b.data.fy);
        const bno = Number(b.data.period);
        const pl = a?.statement === 'PL';
        const before = bfy < fy || (bfy === fy && bno < no);
        const now = bfy === fy && bno === no;
        if (!before && !now) continue;
        if (pl && bfy !== fy) {
            // Profit or loss of an earlier year: part of retained earnings (until that year's close is posted).
            priorPl += (Number(b.data.drC) || 0) - (Number(b.data.crC) || 0);
            continue;
        }
        const k = `${code}|${str(b.data.ccId)}`;
        const r = rows.get(k) ?? { glCode: code, glName: a?.name ?? '', statement: a?.statement ?? 'BS', ccId: str(b.data.ccId), open: 0, dr: 0, cr: 0 };
        const dr = Number(b.data.drC) || 0;
        const cr = Number(b.data.crC) || 0;
        if (before) r.open += dr - cr;
        else {
            r.dr += dr;
            r.cr += cr;
        }
        rows.set(k, r);
    }
    if (priorPl) rows.set('PRIOR|', { glCode: '(earlier years)', glName: 'Profit or loss of earlier years not yet closed to retained earnings', statement: 'BS', ccId: '', open: priorPl, dr: 0, cr: 0 });
    const list = Array.from(rows.values()).map((r) => ({ ...r, close: r.open + r.dr - r.cr }));
    const totals = list.reduce((t, r) => ({ open: t.open + r.open, dr: t.dr + r.dr, cr: t.cr + r.cr, close: t.close + r.close }), { open: 0, dr: 0, cr: 0, close: 0 });
    return { rows: list, totals, balanced: totals.dr === totals.cr && totals.close === 0 && totals.open === 0 };
}

/** Inventory in the ledger compared with the stock valuation, per warehouse cost center and inventory account. */
async function inventoryCompare(orgId: string, leId: string, fy: number, no: number, units: Map<string, Unit>) {
    const [bals, map, stocks] = await Promise.all([balancesOf(orgId, leId), mappingOf(orgId, leId), runQuery({ from: [{ collectionId: 'fin_stock' }], where: fieldEq('leId', leId) }, `organizations/${orgId}`)]);
    const invAccounts = new Set<string>([map.roles.INVENTORY, ...Object.values(map.byCategory).map((v) => v.INVENTORY ?? '')].filter(Boolean));
    const ledger = new Map<string, number>();
    for (const b of bals) {
        const code = str(b.data.glCode);
        if (!invAccounts.has(code)) continue;
        const bfy = Number(b.data.fy);
        const bno = Number(b.data.period);
        if (bfy > fy || (bfy === fy && bno > no)) continue;
        const k = `${str(b.data.ccId)}|${code}`;
        ledger.set(k, (ledger.get(k) ?? 0) + (Number(b.data.drC) || 0) - (Number(b.data.crC) || 0));
    }
    const sub = new Map<string, number>();
    for (const s of stocks) {
        const k = `${str(s.data.warehouseId)}|${str(s.data.glCode) || map.roles.INVENTORY || ''}`;
        sub.set(k, (sub.get(k) ?? 0) + (Number(s.data.valueC) || 0));
    }
    const keys = new Set([...ledger.keys(), ...sub.keys()]);
    const lines = Array.from(keys).map((k) => {
        const [ccId, glCode] = k.split('|');
        const l = ledger.get(k) ?? 0;
        const s = sub.get(k) ?? 0;
        return { ccId, ccCode: units.get(ccId)?.code ?? ccId, ccName: units.get(ccId)?.name ?? '', glCode, ledger: l / 100, stock: s / 100, diff: (s - l) / 100 };
    });
    return { lines: lines.sort((a, b) => a.ccCode.localeCompare(b.ccCode)), clean: lines.every((x) => x.diff === 0) };
}

/** Net debit balance of a cost center on accounts in one period. */
async function ccPeriodNet(orgId: string, leId: string, fy: number, no: number, ccId: string, glCodes: string[]): Promise<Map<string, number>> {
    const bals = await balancesOf(orgId, leId);
    const out = new Map<string, number>();
    for (const b of bals) {
        if (Number(b.data.fy) !== fy || Number(b.data.period) !== no || str(b.data.ccId) !== ccId || !glCodes.includes(str(b.data.glCode))) continue;
        out.set(str(b.data.glCode), (out.get(str(b.data.glCode)) ?? 0) + (Number(b.data.drC) || 0) - (Number(b.data.crC) || 0));
    }
    return out;
}
function reallocLines(net: Map<string, number>, sender: string, receivers: Array<{ ccId: string; pct: number }>): PostLine[] {
    const lines: PostLine[] = [];
    for (const [gl, c] of net) {
        if (c <= 0) continue;
        lines.push({ side: 'C', glCode: gl, ccId: sender, amount: c / 100, description: 'Reallocated out' });
        let left = c;
        receivers.forEach((r, i) => {
            const share = i === receivers.length - 1 ? left : Math.round((c * r.pct) / 100);
            left -= share;
            if (share > 0) lines.push({ side: 'D', glCode: gl, ccId: r.ccId, amount: share / 100, description: `Reallocated in (${r.pct}%)` });
        });
    }
    return lines;
}
async function yearEndLines(orgId: string, leId: string, fy: number): Promise<{ lines: PostLine[]; result: number }> {
    const [bals, chart, map] = await Promise.all([balancesOf(orgId, leId), chartOf(orgId, leId), mappingOf(orgId, leId)]);
    const net = new Map<string, number>();
    for (const b of bals) {
        if (Number(b.data.fy) !== fy || chart.get(str(b.data.glCode))?.statement !== 'PL') continue;
        const k = `${str(b.data.glCode)}|${str(b.data.ccId)}`;
        net.set(k, (net.get(k) ?? 0) + (Number(b.data.drC) || 0) - (Number(b.data.crC) || 0));
    }
    const lines: PostLine[] = [];
    let profitC = 0;
    for (const [k, c] of net) {
        if (!c) continue;
        const [gl, cc] = k.split('|');
        lines.push({ side: c > 0 ? 'C' : 'D', glCode: gl, ccId: cc, amount: Math.abs(c) / 100, description: 'Year-end close to retained earnings' });
        profitC -= c;
    }
    if (lines.length) {
        const re = roleAccount(map, 'RETAINED_EARNINGS');
        lines.push({ side: profitC > 0 ? 'C' : 'D', glCode: re, ccId: '', amount: Math.abs(profitC) / 100, description: profitC >= 0 ? 'Profit for the year' : 'Loss for the year' });
    }
    return { lines: lines.filter((l) => l.amount > 0), result: profitC / 100 };
}
function yearEndTarget(y: Year) {
    const target = y.periods[y.periods.length - 1];
    const before = y.periods.filter((p) => p.no < target.no);
    const open = before.filter((p) => !['closed', 'locked'].includes(p.status));
    if (open.length) throw new HttpError(409, `Close ${open.map((p) => p.name).join(', ')} before the year-end close.`);
    if (!['open', 'closing'].includes(target.status)) throw new HttpError(409, `${target.name} must be open or in closing to take the year-end close.`);
    return target;
}

// ----- Handlers -----

registerHandler('recon.post', {
    label: 'Inventory reconciliation adjustment',
    approvePerm: 'FIN.post.approve',
    valued: true,
    apply: async (ctx, req, id) => {
        const leId = str(req.leId);
        const p = o(req.payload);
        const fy = Number(p.fy);
        const no = Number(p.no);
        const units = await unitsOf(ctx.orgId);
        const now = await inventoryCompare(ctx.orgId, leId, fy, no, units);
        const proposed = objs(p.lines);
        const same = now.lines.filter((l) => l.diff !== 0).length === proposed.length && proposed.every((x) => now.lines.some((l) => l.ccId === str(x.ccId) && l.glCode === str(x.glCode) && l.diff === Number(x.diff)));
        if (!same) throw new HttpError(409, 'Stock or the ledger changed since the reconciliation was run. Reject this request and run the reconciliation again.');
        const map = await mappingOf(ctx.orgId, leId);
        const diffAcc = roleAccount(map, 'RECON_DIFF');
        const lines: PostLine[] = [];
        for (const l of now.lines.filter((x) => x.diff !== 0)) {
            const amt = Math.abs(l.diff);
            lines.push({ side: l.diff > 0 ? 'D' : 'C', glCode: l.glCode, ccId: l.ccId, amount: amt, description: `Inventory brought to stock valuation (${l.ccCode})` });
            lines.push({ side: l.diff > 0 ? 'C' : 'D', glCode: diffAcc, ccId: l.ccId, amount: amt, description: 'Reconciliation difference' });
        }
        const e = await entityOf(ctx.orgId, leId);
        const posted = await post(ctx, { leId, type: 'INV_RECON', period: { fy, no }, docCurrency: e.functionalCurrency, fxRate: 1, lines, narrative: `Inventory reconciliation ${str(p.runId)}`, source: { kind: 'reconciliation', id: str(p.runId), ref: id, route: '' }, trace: { runId: str(p.runId), request: id }, sourceKey: `RECON_${id}`, approvalRef: id });
        const run = await getDoc(P(ctx.orgId).run(str(p.runId)));
        if (run) await writeDoc(P(ctx.orgId).run(run.id), { ...run.data, status: 'adjusted', journalId: posted.id, adjustedAt: nowIso() });
        return { journalId: posted.id };
    },
});
registerHandler('realloc.post', {
    label: 'Cost reallocation',
    approvePerm: 'FIN.post.approve',
    valued: true,
    apply: async (ctx, req, id) => {
        const leId = str(req.leId);
        const p = o(req.payload);
        const fy = Number(p.fy);
        const no = Number(p.no);
        const sender = str(p.senderCc);
        const receivers = objs(p.receivers).map((r) => ({ ccId: str(r.ccId), pct: Number(r.pct) }));
        const net = await ccPeriodNet(ctx.orgId, leId, fy, no, sender, strs(p.glCodes));
        const lines = reallocLines(net, sender, receivers);
        const total = round2(lines.filter((l) => l.side === 'C').reduce((s, l) => s + l.amount, 0));
        if (total !== Number(p.total)) throw new HttpError(409, `The balance to reallocate changed (was ${p.total}, now ${total}). Reject and propose again.`);
        const e = await entityOf(ctx.orgId, leId);
        const posted = await post(ctx, { leId, type: 'REALLOC', period: { fy, no }, docCurrency: e.functionalCurrency, fxRate: 1, lines, narrative: `Reallocation from ${str(p.senderCode)}: ${str(p.note)}`.slice(0, 300), source: { kind: 'reallocation', id, ref: id, route: '' }, trace: { request: id, receivers: receivers as unknown as Obj }, sourceKey: `REALLOC_${id}`, approvalRef: id });
        return { journalId: posted.id };
    },
});
registerHandler('yearend.close', {
    label: 'Year-end close',
    approvePerm: 'FIN.close.approve',
    valued: true,
    apply: async (ctx, req, id) => {
        const leId = str(req.leId);
        const fy = Number(o(req.payload).fy);
        const years = await yearsOf(ctx.orgId, leId);
        const y = years.find((x) => x.fy === fy);
        if (!y || y.status !== 'active') throw new HttpError(409, 'The year is not active.');
        if (str(y.doc.data.yearEndJournal)) throw new HttpError(409, 'The year-end close is already posted.');
        const target = yearEndTarget(y);
        const { lines, result } = await yearEndLines(ctx.orgId, leId, fy);
        if (round2(result) !== Number(o(req.payload).result)) throw new HttpError(409, 'The profit or loss changed since this was proposed. Reject and propose again.');
        const at = nowIso();
        if (!lines.length) {
            const fresh = (await yearsOf(ctx.orgId, leId)).find((x) => x.fy === fy)!;
            await commit([{ path: P(ctx.orgId).year(leId, fy), fields: { yearEndNotNeeded: true, yearEndAt: at, updatedAt: at }, mask: ['yearEndNotNeeded', 'yearEndAt', 'updatedAt'], updateTime: fresh.doc.updateTime }]);
            return { journalId: '', note: 'No profit and loss balances; nothing to post.' };
        }
        const e = await entityOf(ctx.orgId, leId);
        const posted = await post(ctx, { leId, type: 'YE_CLOSE', period: { fy, no: target.no }, docCurrency: e.functionalCurrency, fxRate: 1, lines, narrative: `Year-end close ${y.label}: ${result >= 0 ? 'profit' : 'loss'} ${Math.abs(result)}`, source: { kind: 'year_end', id: `${fy}`, ref: id, route: '' }, trace: { request: id }, sourceKey: `YE_${leId}_${fy}`, approvalRef: id });
        const fresh = (await yearsOf(ctx.orgId, leId)).find((x) => x.fy === fy)!;
        await commit([{ path: P(ctx.orgId).year(leId, fy), fields: { yearEndJournal: posted.id, yearEndAt: at, updatedAt: at }, mask: ['yearEndJournal', 'yearEndAt', 'updatedAt'], updateTime: fresh.doc.updateTime }]);
        return { journalId: posted.id };
    },
});

// ----- Visibility of journal entries -----

function journalScope(ctx: OrgContext, e: Env): { all: boolean; ccs: Set<string> } {
    if (may(ctx, e, 'FIN.journal.view') || may(ctx, e, 'FIN.close.run') || may(ctx, e, 'PRC.journal.view')) return { all: true, ccs: new Set() };
    const owned = ownedCostCenters(e.units, ctx.me);
    const ccs = new Set<string>();
    for (const c of owned) if (leOf(e.units, c)?.id === e.le.id) ccs.add(c);
    // Journal view held at a site or department covers the cost centers below it.
    for (const u of e.units.values()) if (u.level === 'cost_center' && leOf(e.units, u.id)?.id === e.le.id && permAt(ctx, 'FIN.journal.view', u.id, e.units, e.scope)) ccs.add(u.id);
    return { all: false, ccs };
}
function entryOut(d: Doc, js: { all: boolean; ccs: Set<string> }, ccFilter: string) {
    const lines = objs(d.data.lines).filter((l) => (js.all || js.ccs.has(str(l.ccId))) && (!ccFilter || str(l.ccId) === ccFilter));
    return {
        id: d.id,
        postingDate: str(d.data.postingDate),
        fy: Number(d.data.fy),
        period: Number(d.data.period),
        type: str(d.data.type),
        typeLabel: str(d.data.typeLabel) || TXN_LABEL[str(d.data.type)] || str(d.data.type),
        narrative: str(d.data.narrative),
        currency: str(d.data.currency),
        totalDebit: Number(d.data.totalDebit) || 0,
        source: o(d.data.source),
        postedByName: str(d.data.postedByName),
        postedAt: str(d.data.postedAt),
        approvalRef: str(d.data.approvalRef),
        partial: !js.all,
        lines: lines.map((l) => ({ no: Number(l.no), side: str(l.side), glCode: str(l.glCode), glName: str(l.glName), ccId: str(l.ccId), ccCode: str(l.ccCode), ccName: str(l.ccName), amount: Number(l.amount) || 0, description: str(l.description), qty: l.qty ?? null })),
    };
}

export const finLedgerRoutes = {
    // Journal of one period (the current period by default). The screen loads earlier periods as the person scrolls.
    'POST /api/org/fin/journal/list': [
        fin('org.fin.journal.list', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            const js = journalScope(ctx, e);
            if (!js.all && !js.ccs.size) throw new HttpError(403, `You cannot see the journal of ${e.le.code}. It needs FIN.journal.view, or owning a cost center.`);
            const years = await yearsOf(ctx.orgId, e.le.id);
            const { year, no } = pickPeriod(years, ctx.body.fy, ctx.body.no);
            const ccFilter = str(ctx.body.ccId);
            if (ccFilter && !js.all && !js.ccs.has(ccFilter)) throw new HttpError(403, 'You cannot see this cost center.');
            const docs = await runQuery({ from: [{ collectionId: 'fin_journal' }], where: { compositeFilter: { op: 'AND', filters: [fieldEq('leId', e.le.id), fieldEq('fy', year.fy), fieldEq('period', no)] } } }, `organizations/${ctx.orgId}`);
            const entries = docs
                .map((d) => entryOut(d, js, ccFilter))
                .filter((x) => x.lines.length)
                .sort((a, b) => b.postingDate.localeCompare(a.postingDate) || b.id.localeCompare(a.id));
            const p = year.periods.find((x) => x.no === no)!;
            return { leCode: e.le.code, period: { fy: year.fy, no, name: p.name, label: year.label, status: p.status, start: p.start, end: p.end }, ...neighbours(years, year.fy, no), entries, partial: !js.all };
        }),
    ],
    // One entry with every line and the trail back to the document that caused it.
    'POST /api/org/fin/journal/get': [
        fin('org.fin.journal.get', async (ctx) => {
            const id = str(ctx.body.id);
            if (!/^[A-Z]{2,6}-\d{4}-\d{8}$/.test(id)) throw new HttpError(404, 'Journal entry not found.');
            const d = await getDoc(P(ctx.orgId).journal(id));
            if (!d) throw new HttpError(404, 'Journal entry not found.');
            const e = await env(ctx, d.data.leId);
            const js = journalScope(ctx, e);
            const out = entryOut(d, js, '');
            if (!out.lines.length) throw new HttpError(404, 'Journal entry not found.');
            await record(ctx, 'org.fin.journal.view', id, str(d.data.typeLabel));
            return { ...out, leCode: e.le.code, leName: e.le.name, periodName: str(d.data.periodName), docCurrency: str(d.data.docCurrency), fxRate: Number(d.data.fxRate) || 1, trace: o(d.data.trace), mappingVersion: Number(d.data.mappingVersion) || 0, postedBy: str(d.data.postedBy) };
        }),
    ],

    // ----- Period-end -----

    'POST /api/org/fin/close/tb': [
        fin('org.fin.close.tb', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            if (!may(ctx, e, 'FIN.journal.view') && !may(ctx, e, 'FIN.close.run')) throw new HttpError(403, 'The trial balance needs FIN.journal.view or FIN.close.run.');
            const years = await yearsOf(ctx.orgId, e.le.id);
            const { year, no } = pickPeriod(years, ctx.body.fy, ctx.body.no);
            const tb = await trialBalance(ctx.orgId, e.le.id, year.fy, no);
            const byCc = ctx.body.byCc === true;
            const merged = new Map<string, { glCode: string; glName: string; statement: string; ccId: string; open: number; dr: number; cr: number; close: number }>();
            for (const r of tb.rows) {
                const k = byCc ? `${r.glCode}|${r.ccId}` : r.glCode;
                const m = merged.get(k) ?? { ...r, ccId: byCc ? r.ccId : '', open: 0, dr: 0, cr: 0, close: 0 };
                m.open += r.open;
                m.dr += r.dr;
                m.cr += r.cr;
                m.close += r.close;
                merged.set(k, m);
            }
            const p = year.periods.find((x) => x.no === no)!;
            let runId = '';
            if (ctx.body.save === true) {
                need(ctx, e, 'FIN.close.run', 'Recording the trial balance for period-end');
                runId = `TB_${e.le.id}_${year.fy}_${no}_${Date.now()}`;
                await writeDoc(P(ctx.orgId).run(runId), { key: `${e.le.id}_${year.fy}_${no}`, kind: 'trial_balance', leId: e.le.id, fy: year.fy, no, balanced: tb.balanced, totals: { open: tb.totals.open / 100, dr: tb.totals.dr / 100, cr: tb.totals.cr / 100, close: tb.totals.close / 100 }, at: nowIso(), by: ctx.uid, byName: nameOf(ctx.me) } as unknown as Fields);
                await record(ctx, 'org.fin.close.tb', `${e.le.code} ${year.label} ${p.name}`, tb.balanced ? 'Balanced' : 'NOT balanced');
            }
            return {
                period: { fy: year.fy, no, name: p.name, label: year.label, status: p.status },
                rows: Array.from(merged.values())
                    .sort((a, b) => a.glCode.localeCompare(b.glCode) || a.ccId.localeCompare(b.ccId))
                    .map((r) => ({ ...r, ccCode: e.units.get(r.ccId)?.code ?? '', ccName: e.units.get(r.ccId)?.name ?? '', open: r.open / 100, dr: r.dr / 100, cr: r.cr / 100, close: r.close / 100 })),
                totals: { open: tb.totals.open / 100, dr: tb.totals.dr / 100, cr: tb.totals.cr / 100, close: tb.totals.close / 100 },
                balanced: tb.balanced,
                runId,
            };
        }),
    ],
    // Period checklist: what has been run, what is waiting, what blocks closing.
    'POST /api/org/fin/close/status': [
        fin('org.fin.close.status', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            if (!may(ctx, e, 'FIN.view') && !may(ctx, e, 'FIN.close.run') && !may(ctx, e, 'FIN.journal.view')) throw new HttpError(403, 'You have no finance access here.');
            const years = await yearsOf(ctx.orgId, e.le.id);
            const { year, no } = pickPeriod(years, ctx.body.fy, ctx.body.no);
            const runs = await runQuery({ from: [{ collectionId: 'fin_runs' }], where: fieldEq('key', `${e.le.id}_${year.fy}_${no}`) }, `organizations/${ctx.orgId}`);
            const reqs = (await runQuery({ from: [{ collectionId: 'fin_requests' }], where: fieldEq('leId', e.le.id) }, `organizations/${ctx.orgId}`)).filter((r) => Number(o(r.data.payload).fy) === year.fy && (Number(o(r.data.payload).no) === no || str(r.data.type) === 'yearend.close'));
            const p = year.periods.find((x) => x.no === no)!;
            const next = await nextApprovers(ctx, reqs.map((r) => ({ ...r.data, id: r.id })), e.units);
            return {
                period: { fy: year.fy, no, name: p.name, label: year.label, status: p.status, start: p.start, end: p.end, special: p.special, last: year.periods[year.periods.length - 1].no === no },
                yearEndJournal: str(year.doc.data.yearEndJournal),
                yearEndNotNeeded: year.doc.data.yearEndNotNeeded === true,
                runs: runs.map((r) => ({ id: r.id, kind: str(r.data.kind), at: str(r.data.at), byName: str(r.data.byName), balanced: r.data.balanced === true, clean: r.data.clean === true, status: str(r.data.status), journalId: str(r.data.journalId), lines: objs(r.data.lines), grir: objs(r.data.grir) })).sort((a, b) => b.at.localeCompare(a.at)),
                requests: reqs.map((r) => ({ id: r.id, typeLabel: str(r.data.typeLabel), title: str(r.data.title), status: str(r.data.status), result: o(r.data.result), next: next.get(r.id)?.text ?? '' })).sort((a, b) => b.id.localeCompare(a.id)),
                can: { run: may(ctx, e, 'FIN.close.run'), journal: may(ctx, e, 'FIN.journal.view') },
            };
        }),
    ],
    // Inventory (stock valuation against the ledger) and GR/IR open items for a period.
    'POST /api/org/fin/close/recon/run': [
        fin('org.fin.close.recon.run', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            need(ctx, e, 'FIN.close.run', 'Running the reconciliation');
            const years = await yearsOf(ctx.orgId, e.le.id);
            const { year, no } = pickPeriod(years, ctx.body.fy, ctx.body.no);
            const p = year.periods.find((x) => x.no === no)!;
            if (!['open', 'closing'].includes(p.status)) throw new HttpError(409, `${p.name} is ${p.status}; reconciliation runs on an open or closing period.`);
            const cmp = await inventoryCompare(ctx.orgId, e.le.id, year.fy, no, e.units);
            // GR/IR: what has been received and accepted but not yet invoiced, per purchase order.
            const map = await mappingOf(ctx.orgId, e.le.id);
            const grirAcc = map.roles.GRIR;
            const grir = new Map<string, { po: string; amount: number; first: string; last: string }>();
            if (grirAcc) {
                const docs = await runQuery({ from: [{ collectionId: 'fin_journal' }], where: fieldEq('leId', e.le.id) }, `organizations/${ctx.orgId}`);
                for (const d of docs) {
                    const src = o(d.data.source);
                    const po = str(o(d.data.trace).poId) || (str(src.kind) === 'purchase_order' ? str(src.id) : '');
                    if (!po) continue;
                    for (const l of objs(d.data.lines)) {
                        if (str(l.glCode) !== grirAcc) continue;
                        const x = grir.get(po) ?? { po, amount: 0, first: str(d.data.postingDate), last: str(d.data.postingDate) };
                        x.amount += (str(l.side) === 'C' ? 1 : -1) * cents(Number(l.amount) || 0);
                        if (str(d.data.postingDate) < x.first) x.first = str(d.data.postingDate);
                        if (str(d.data.postingDate) > x.last) x.last = str(d.data.postingDate);
                        grir.set(po, x);
                    }
                }
            }
            const grirOpen = Array.from(grir.values()).filter((x) => x.amount !== 0).map((x) => ({ po: x.po, amount: x.amount / 100, since: x.first, ageDays: Math.max(0, Math.floor((Date.parse(p.end) - Date.parse(x.first)) / 86_400_000)) }));
            const runId = `RC_${e.le.id}_${year.fy}_${no}_${Date.now()}`;
            await writeDoc(P(ctx.orgId).run(runId), { key: `${e.le.id}_${year.fy}_${no}`, kind: 'inventory', leId: e.le.id, fy: year.fy, no, clean: cmp.clean, status: cmp.clean ? 'clean' : 'differences', lines: cmp.lines as unknown as Fields[keyof Fields], grir: grirOpen as unknown as Fields[keyof Fields], at: nowIso(), by: ctx.uid, byName: nameOf(ctx.me) } as unknown as Fields);
            await record(ctx, 'org.fin.close.recon', `${e.le.code} ${year.label} ${p.name}`, cmp.clean ? 'Inventory agrees with the ledger' : `${cmp.lines.filter((l) => l.diff !== 0).length} difference(s)`);
            return { runId, ...cmp, grir: grirOpen };
        }),
    ],
    'POST /api/org/fin/close/recon/propose': [
        fin('org.fin.close.recon.propose', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            need(ctx, e, 'FIN.close.run', 'Proposing a reconciliation adjustment');
            const runId = str(ctx.body.runId);
            const run = await getDoc(P(ctx.orgId).run(runId));
            if (!run || str(run.data.leId) !== e.le.id || str(run.data.kind) !== 'inventory') throw new HttpError(404, 'Run not found.');
            if (run.data.clean === true || str(run.data.status) !== 'differences') throw new HttpError(409, 'This run has no differences to adjust.');
            const reason = reasonOf(ctx.body, 15);
            const fy = Number(run.data.fy);
            const no = Number(run.data.no);
            const now = await inventoryCompare(ctx.orgId, e.le.id, fy, no, e.units);
            const lines = now.lines.filter((l) => l.diff !== 0);
            const stored = objs(run.data.lines).filter((l) => Number(l.diff) !== 0);
            if (lines.length !== stored.length || !lines.every((l) => stored.some((s) => str(s.ccId) === l.ccId && str(s.glCode) === l.glCode && Number(s.diff) === l.diff))) throw new HttpError(409, 'Stock or the ledger changed since this run. Run the reconciliation again.');
            const amount = round2(lines.reduce((s, l) => s + Math.abs(l.diff), 0));
            return createRequest(ctx, { leId: e.le.id, type: 'recon.post', title: `${e.le.code} FY ${fy} P${no}: inventory adjustment ${amount}`, summary: lines.map((l) => `${l.ccCode} ${l.glCode}: ledger ${l.ledger}, stock ${l.stock}, adjust ${l.diff}`).join('; '), payload: { fy, no, runId, lines: lines as unknown as Obj }, reason, amount, scopeKey: `recon_${e.le.id}_${fy}_${no}` });
        }),
    ],
    'POST /api/org/fin/close/realloc/preview': [
        fin('org.fin.close.realloc.preview', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            need(ctx, e, 'FIN.close.run', 'Reallocating costs');
            const years = await yearsOf(ctx.orgId, e.le.id);
            const { year, no } = pickPeriod(years, ctx.body.fy, ctx.body.no);
            const sender = str(ctx.body.senderCc);
            const cc = e.units.get(sender);
            if (!cc || cc.level !== 'cost_center' || leOf(e.units, sender)?.id !== e.le.id) throw new HttpError(400, 'Choose the sending cost center.');
            const [bals, chart] = await Promise.all([balancesOf(ctx.orgId, e.le.id), chartOf(ctx.orgId, e.le.id)]);
            const net = new Map<string, number>();
            for (const b of bals) {
                if (Number(b.data.fy) !== year.fy || Number(b.data.period) !== no || str(b.data.ccId) !== sender) continue;
                const a = chart.get(str(b.data.glCode));
                if (a?.statement !== 'PL') continue;
                net.set(a.code, (net.get(a.code) ?? 0) + (Number(b.data.drC) || 0) - (Number(b.data.crC) || 0));
            }
            return { accounts: Array.from(net.entries()).filter(([, c]) => c > 0).map(([code, c]) => ({ code, name: chart.get(code)?.name ?? '', amount: c / 100 })), receivers: Array.from(e.units.values()).filter((u) => u.level === 'cost_center' && u.id !== sender && u.status !== 'inactive' && leOf(e.units, u.id)?.id === e.le.id).map((u) => ({ id: u.id, code: u.code, name: u.name })) };
        }),
    ],
    'POST /api/org/fin/close/realloc/propose': [
        fin('org.fin.close.realloc.propose', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            need(ctx, e, 'FIN.close.run', 'Reallocating costs');
            const reason = reasonOf(ctx.body, 15);
            const years = await yearsOf(ctx.orgId, e.le.id);
            const { year, no } = pickPeriod(years, ctx.body.fy, ctx.body.no);
            const p = year.periods.find((x) => x.no === no)!;
            if (!['open', 'closing'].includes(p.status)) throw new HttpError(409, `${p.name} is ${p.status}.`);
            const sender = str(ctx.body.senderCc);
            const sc = e.units.get(sender);
            if (!sc || leOf(e.units, sender)?.id !== e.le.id) throw new HttpError(400, 'Choose the sending cost center.');
            const glCodes = Array.from(new Set(strs(ctx.body.glCodes))).slice(0, 50);
            if (!glCodes.length) throw new HttpError(400, 'Choose the accounts to reallocate.');
            const receivers = objs(ctx.body.receivers).slice(0, 30).map((r) => ({ ccId: str(r.ccId), pct: Math.round(Number(r.pct) * 100) / 100 }));
            if (!receivers.length) throw new HttpError(400, 'Add the receiving cost centers.');
            for (const r of receivers) {
                const u = e.units.get(r.ccId);
                if (!u || u.level !== 'cost_center' || r.ccId === sender || leOf(e.units, r.ccId)?.id !== e.le.id) throw new HttpError(400, 'Receivers must be other cost centers of the same legal entity.');
                if (!(r.pct > 0)) throw new HttpError(400, 'Every receiver needs a share above 0%.');
                if ((await ccFinOf(ctx.orgId, r.ccId)).status !== 'open') throw new HttpError(409, `${u.code} is not open for posting.`);
            }
            if (new Set(receivers.map((r) => r.ccId)).size !== receivers.length) throw new HttpError(400, 'A receiver is listed twice.');
            if (Math.abs(receivers.reduce((s, r) => s + r.pct, 0) - 100) > 0.001) throw new HttpError(400, 'The shares must add up to 100%.');
            const net = await ccPeriodNet(ctx.orgId, e.le.id, year.fy, no, sender, glCodes);
            const lines = reallocLines(net, sender, receivers);
            if (!lines.length) throw new HttpError(409, 'The sending cost center has no debit balance on these accounts in this period.');
            const total = round2(lines.filter((l) => l.side === 'C').reduce((s, l) => s + l.amount, 0));
            const note = oneLine(ctx.body.note, 120);
            return createRequest(ctx, {
                leId: e.le.id,
                type: 'realloc.post',
                title: `${e.le.code} ${year.label} ${p.name}: reallocate ${total} from ${sc.code}`,
                summary: `${glCodes.join(', ')} from ${sc.code} ${sc.name} to ${receivers.map((r) => `${e.units.get(r.ccId)?.code} ${r.pct}%`).join(', ')}. ${note}`,
                payload: { fy: year.fy, no, senderCc: sender, senderCode: sc.code, glCodes, receivers: receivers as unknown as Obj, total, note },
                reason,
                amount: total,
                scopeKey: `realloc_${e.le.id}_${year.fy}_${no}_${sender}`,
            });
        }),
    ],
    'POST /api/org/fin/close/yearend/propose': [
        fin('org.fin.close.yearend.propose', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            need(ctx, e, 'FIN.close.run', 'Proposing the year-end close');
            const reason = reasonOf(ctx.body, 15);
            const fy = Number(ctx.body.fy);
            const years = await yearsOf(ctx.orgId, e.le.id);
            const y = years.find((x) => x.fy === fy);
            if (!y || y.status !== 'active') throw new HttpError(409, 'The year is not active.');
            if (str(y.doc.data.yearEndJournal)) throw new HttpError(409, 'The year-end close is already posted.');
            const target = yearEndTarget(y);
            const map = await mappingOf(ctx.orgId, e.le.id);
            if (!map.roles.RETAINED_EARNINGS) throw new HttpError(409, `Map ${ROLES.find((r) => r.code === 'RETAINED_EARNINGS')!.label} first.`);
            const { lines, result } = await yearEndLines(ctx.orgId, e.le.id, fy);
            return createRequest(ctx, { leId: e.le.id, type: 'yearend.close', title: `${e.le.code} ${y.label}: year-end close (${result >= 0 ? 'profit' : 'loss'} ${Math.abs(result)})`, summary: `${lines.length} line(s) posted into ${target.name}: every profit and loss account is closed to retained earnings.`, payload: { fy, no: target.no, result: round2(result) }, reason, amount: Math.abs(result), scopeKey: `ye_${e.le.id}_${fy}` });
        }),
    ],
};

export { chainOf };
