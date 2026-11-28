import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Boxes, CalendarRange, Check, ChevronDown, ChevronRight, ClipboardCheck, Gauge, Layers, MapPin, Plus, RefreshCw, Rocket, Send, ShoppingCart, Trash2, Undo2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField, TextArea } from '../components/ui';
import { messageOf, useConfirm } from '../components/screen';
import RichTable, { type Column } from '../components/RichTable';
import { suggestedSplitRule } from '../shared/bomSplitRule';
import { Btn, Choice, MenuItem, MenuSection, Panel, Pill, Sheet, Stat } from './PlnPlanningWorkspace';

// Commercial requirements: final-product SKUs are firmed by hand (the commercial forecast will feed the same lines later),
// worked back through the BOMs level by level with the unit link, minimum batch and total required at every leaf, firmed as
// purchase requirements under the Chart of Authority, then confirmed (quantities changeable) and pushed to Procurement.
// The server enforces every rule (site scope, independent people, Chart of Authority, value ceiling, audit); this screen guides.

const API = '/api/org/pln/requirements/';
const post = <T,>(path: string, body: Record<string, unknown> = {}) => callBackend<T>(API + path, body);
type Status = 'draft' | 'commercial_review' | 'firmed' | 'purchase_review' | 'approved' | 'pushed' | 'cancelled';
type Action = 'edit_lines' | 'submit_commercial' | 'firm_commercial' | 'return_commercial' | 'run_explosion' | 'submit_purchase' | 'approve_purchase' | 'return_purchase' | 'push' | 'reopen' | 'cancel';
interface Sku { id: string; name: string; uom: string; uomLabel: string; uomSymbol: string; whole: boolean }
interface Context { sites: Array<{ id: string; name: string }>; skus: Sku[]; can: Record<string, boolean>; steps: Array<{ status: Status; label: string; role: string }>; today: string }
interface Brief { id: string; title: string; siteId: string; siteName: string; status: Status; revision: number; lines: number; units: number; from: string; to: string; materials: number | null; toBuy: number | null; value: number | null; firmedValue: number; firmedLines: number; pushed: number; createdByName: string; updatedAt: string }
interface Line { no: number; skuId: string; quantity: number; uom: string; needDate: string; customer: string; note: string; source: 'MANUAL' }
interface Step { level: string; title: string; positionTitle: string; status: 'pending' | 'approved'; byName: string; at: string; note: string }
interface Firmed { key: string; materialId: string; warehouseId: string; number: string; name: string; stockUom: string; firmQty: number; unitCost: number; value: number; needBy: string; orderNow: boolean; forSkus: string[]; pushedTo?: string }
interface Summary { lines: number; skus: number; intermediates: number; materials: number; toBuy: number; covered: number; orderNow: number; late: number; notPushable: number; utilities: number; blocking: number; warnings: number; value: number }
interface ReqSet {
    id: string; title: string; siteId: string; siteName: string; status: Status; revision: number; lines: Line[]; createdByName?: string; firmed?: Firmed[]; firmedValue?: number;
    coa?: { amount: number; steps: Step[]; returnReason?: string }; explosionAt?: string; explosionPreview?: boolean; explosionSummary?: Summary | null; returnReason?: string; cancelReason?: string; firmedAt?: string;
    history: Array<{ at: string; byName: string; action: string; note: string; status: string }>; pushes?: Array<{ at: string; byName: string; requirementId: string; warehouseId: string; total: number; lines: Array<{ key: string; quantity: number; firmQty: number; reason: string }> }>;
}
interface TreeNode {
    id: string; depth: number; kind: 'sku' | 'material' | 'utility'; itemId: string; warehouseId: string; name: string; bomLine: number | null;
    perParent: { qty: number; uom: string; basisQty: number; basisUom: string; scrapPct: number; rule: string } | null;
    lineQty: number | null; lineUom: string; ownUom: string; factor: number | null; ownQty: number | null;
    bom: { id: string; name: string; outputQty: number; outputUom: string; outputFactor: number | null; minimalBatch: number; exactBatch: number; lot: number; processBatch: number | null; notes: string[] } | null;
    children: TreeNode[]; issues: string[];
}
interface Peg { lineNo: number; skuId: string; skuName: string; needDate: string; parentSku: string; parentName: string; path: string; bomLine: number; lineQty: number; lineUom: string; factor: number; qty: number }
interface Mat {
    key: string; materialId: string; warehouseId: string; number: string; name: string; level: number; pushable: boolean; stockUom: string; purchaseUom: string; purchaseFactor: number | null; bomUnits: string[]; pegs: Peg[];
    exact: number; rounding: number; gross: number; available: number; safetyStock: number; openSupply: number; net: number; moq: number | null; orderMultiple: number | null; buy: number; buyPurchase: number | null; excess: number;
    unitCost: number; value: number; leadDays: number; needBy: string; orderBy: string; arrival: string; orderNow: boolean; lateDays: number; issues: string[];
}
interface Prod { skuId: string; name: string; level: number; category: string; ownUom: string; required: number; bomId: string; bomName: string; outputUom: string; outputFactor: number | null; requiredOutput: number; minimalBatch: number; exactBatch: number; lot: number; processBatch: number | null; lots: number; producedOutput: number; excessOutput: number; producedOwn: number; notes: string[] }
interface Explosion {
    trees: Array<{ line: Line; skuName: string; root: TreeNode }>; production: Prod[]; materials: Mat[]; utilities: Array<{ key: string; code: string; uom: string; gross: number; pegs: number }>;
    issues: Array<{ severity: 'block' | 'warn'; text: string; lineNo: number; item: string }>; summary: Summary;
}
type Units = Record<string, { label: string; symbol: string }>;
interface Detail { set: ReqSet; explosion: Explosion | null; units: Units; actions: Action[]; warehouses: Record<string, { code: string; name: string }>; can: Record<string, boolean>; stale: boolean; unpriced: number }
type View = 'overview' | 'products' | 'work' | 'materials' | 'approval' | 'procurement';
const VIEWS: Array<{ key: View; label: string; Icon: typeof Gauge }> = [
    { key: 'overview', label: 'Overview', Icon: Gauge },
    { key: 'products', label: 'Final products', Icon: CalendarRange },
    { key: 'work', label: 'Work back', Icon: Layers },
    { key: 'materials', label: 'Materials', Icon: Boxes },
    { key: 'approval', label: 'Approval', Icon: ClipboardCheck },
    { key: 'procurement', label: 'Procurement', Icon: ShoppingCart },
];
const STATUS_LABEL: Record<Status, string> = { draft: 'Commercial requirements', commercial_review: 'Firming review', firmed: 'Firmed · work back', purchase_review: 'Purchase approval', approved: 'Ready to push', pushed: 'In procurement', cancelled: 'Cancelled' };
const fmt = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: d }).format(v));
const day = (v: string) => (v ? v.slice(0, 10) : '—');
const OPEN: Status[] = ['draft', 'commercial_review', 'firmed', 'purchase_review', 'approved'];

export default function PlnRequirements() {
    const [ctx, setCtx] = useState<Context | null>(null);
    const [siteId, setSiteId] = useState('');
    const [sets, setSets] = useState<Brief[]>([]);
    const [setId, setSetId] = useState('');
    const [detail, setDetail] = useState<Detail | null>(null);
    const [view, setView] = useState<View>('overview');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState('');
    const [picker, setPicker] = useState(false);
    const [pushing, setPushing] = useState(false);
    const confirm = useConfirm();

    const loadSets = async () => setSets((await post<{ sets: Brief[] }>('list')).sets);
    const loadSet = async (id = setId) => setDetail(id ? await post<Detail>('get', { id }) : null);
    useEffect(() => {
        (async () => {
            try {
                const c = await post<Context>('context');
                setCtx(c);
                setSiteId((s) => s || c.sites[0]?.id || '');
                await loadSets();
            } catch (e) {
                setError(messageOf(e));
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const siteSets = useMemo(() => sets.filter((s) => s.siteId === siteId), [sets, siteId]);
    useEffect(() => {
        const open = siteSets.find((s) => OPEN.includes(s.status)) ?? siteSets[0];
        setSetId((cur) => (siteSets.some((s) => s.id === cur) ? cur : open?.id ?? ''));
    }, [siteSets]);
    useEffect(() => {
        setError('');
        loadSet(setId).catch((e) => setError(messageOf(e)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setId]);
    const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
        setBusy(key);
        setError('');
        setNotice('');
        try {
            await fn();
            if (done) setNotice(done);
        } catch (e) {
            setError(messageOf(e));
        } finally {
            setBusy('');
        }
    };
    const refresh = async () => {
        await Promise.all([loadSets(), loadSet()]);
    };
    if (!ctx) return error ? <Alert tone='error'>{error}</Alert> : <p className='p-6 text-center text-sm text-muted'>Loading commercial requirements…</p>;
    const set = detail?.set ?? null;
    const can = (a: Action) => !!detail?.actions.includes(a);
    const rev = set?.revision;

    const decide = (path: string, decision: string, title: string, message: string, label: string, danger = false) =>
        confirm.ask(
            { title, message, confirmLabel: label, tone: danger ? 'danger' : 'primary', reason: danger ? { label: 'Reason', minLength: 10 } : { label: 'Comment (optional)', minLength: 0 } },
            async (reason) => {
                await post(path, { id: set!.id, decision, reason, expectedRevision: rev });
                await refresh();
                setNotice(danger ? 'Returned with your reason.' : 'Done.');
            }
        );
    const simple = (path: string, title: string, message: string, label: string, done: string, reasonMin = 0, danger = false) =>
        confirm.ask(
            { title, message, confirmLabel: label, tone: danger ? 'danger' : 'primary', reason: reasonMin ? { label: 'Reason', minLength: reasonMin } : { label: 'Note (optional)', minLength: 0 } },
            async (note) => {
                await post(path, { id: set!.id, note, reason: note, expectedRevision: rev });
                await refresh();
                setNotice(done);
            }
        );
    const newSet = () =>
        confirm.ask({ title: 'New requirement set', message: `A set of final products to firm at ${ctx.sites.find((s) => s.id === siteId)?.name ?? 'the site'}. Give it a title, for example the customer order or the month.`, confirmLabel: 'Create', reason: { label: 'Title', minLength: 3 } }, async (title) => {
            const r = await post<{ set: { id: string } }>('create', { siteId, title });
            await loadSets();
            setSetId(r.set.id);
            setView('products');
            setNotice(`Requirement set ${r.set.id} created.`);
        });
    const explode = () => run('explode', async () => { await post('explode', { id: set!.id }); await refresh(); setView('work'); }, 'Worked back through the BOMs to the materials.');

    const next = (() => {
        if (!set) return null;
        if (can('submit_commercial')) return set.lines.length ? { label: 'Submit for firming', Icon: Send, go: () => simple('submit', 'Submit for firming', 'An independent approver firms the final products and quantities. You cannot change them while they are in review.', 'Submit', 'Submitted for firming.') } : { label: 'Add final products', Icon: Plus, go: () => setView('products') };
        if (can('firm_commercial')) return { label: 'Firm requirements', Icon: ClipboardCheck, go: () => decide('decide', 'firm', 'Firm the commercial requirements', 'The quantities and dates become the firm commercial requirement that is worked back to the materials.', 'Firm') };
        if (can('run_explosion') && set.status === 'firmed' && (!set.explosionAt || detail?.stale)) return { label: 'Work back to materials', Icon: Layers, go: explode };
        if (can('submit_purchase')) return { label: 'Submit purchase for approval', Icon: Send, go: () => simple('purchase/submit', 'Submit the purchase requirements', `${detail?.explosion?.summary.toBuy ?? 0} materials worth ${fmt(detail?.explosion?.summary.value, 2)} are frozen and routed through the Chart of Authority.`, 'Submit', 'Submitted for approval.') };
        if (can('approve_purchase')) return { label: 'Approve purchase level', Icon: ClipboardCheck, go: () => decide('purchase/decide', 'approve', 'Approve this purchase level', 'Your approval is recorded against your Chart of Authority level.', 'Approve') };
        if (can('push')) return { label: 'Confirm and push', Icon: Rocket, go: () => setPushing(true) };
        return null;
    })();

    return (
        <div className='flex h-[calc(100dvh-13rem)] min-h-[32rem] flex-col gap-2'>
            {confirm.sheet}
            {picker && (
                <Sheet title='Site and requirement set' onClose={() => setPicker(false)} footer={<Btn className='ml-auto' onClick={() => setPicker(false)}>Done</Btn>}>
                    <MenuSection title='Site'>
                        {ctx.sites.map((s) => <MenuItem key={s.id} selected={s.id === siteId} label={s.name} onClick={() => { setSiteId(s.id); setSetId(''); }} />)}
                        {!ctx.sites.length && <p className='px-1 text-sm text-muted'>You have no planning access at any site.</p>}
                    </MenuSection>
                    <MenuSection title='Requirement set'>
                        {siteSets.map((s) => <MenuItem key={s.id} selected={s.id === setId} label={`${s.id} · ${s.title}`} hint={`${STATUS_LABEL[s.status]} · ${s.lines} final products · updated ${day(s.updatedAt)}${s.createdByName ? ` · by ${s.createdByName}` : ''}`} onClick={() => { setSetId(s.id); setPicker(false); }} />)}
                        {!siteSets.length && <p className='px-1 text-sm text-muted'>No requirement set for this site yet.</p>}
                    </MenuSection>
                </Sheet>
            )}
            {/* Action bar: always on top; only the content below scrolls. */}
            <div className='sticky top-0 z-20 space-y-2 rounded-2xl border border-line bg-panel/95 p-2 backdrop-blur sm:p-3'>
                <div className='flex items-center gap-2'>
                    <button type='button' aria-haspopup='menu' aria-expanded={picker} onClick={() => setPicker(true)} className='flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-page px-3 text-left'>
                        <MapPin className='h-4 w-4 shrink-0 text-brand' />
                        <span className='min-w-0 flex-1'>
                            <span className='block truncate text-sm font-semibold text-ink'>{set ? `${set.id} · ${set.title}` : 'Commercial requirements'}</span>
                            <span className='block truncate text-xs text-muted'>{ctx.sites.find((s) => s.id === siteId)?.name ?? 'Choose a site'}{set ? ` · ${STATUS_LABEL[set.status]}` : siteSets.length ? ' · choose a set' : ' · no set yet'}</span>
                        </span>
                        <ChevronDown className='h-4 w-4 shrink-0 text-muted' />
                    </button>
                    {ctx.can['PLN.commercial.plan'] && <Btn aria-label='New requirement set' title='New requirement set' className='px-3' disabled={!siteId} onClick={newSet}><Plus className='h-4 w-4' /><span className='hidden sm:inline'>New set</span></Btn>}
                    <Btn variant='secondary' aria-label='Reload' title='Reload' className='px-3' busy={busy === 'reload'} onClick={() => run('reload', refresh)}><RefreshCw className='h-4 w-4' /></Btn>
                </div>
                {set && (
                    <div className='flex flex-wrap items-center gap-2'>
                        <Pill tone={set.status === 'pushed' ? 'brand' : set.status === 'cancelled' ? 'danger' : 'warn'}>{STATUS_LABEL[set.status]}</Pill>
                        <span className='text-xs text-muted'>Rev {set.revision}</span>
                        {next && <Btn className='ml-auto' busy={busy === 'explode'} onClick={next.go}><next.Icon className='h-4 w-4' /> {next.label}</Btn>}
                    </div>
                )}
                <nav aria-label='Requirement views' className='flex gap-1 overflow-x-auto'>
                    {VIEWS.filter((v) => v.key === 'overview' || set).map(({ key, label, Icon }) => (
                        <button key={key} type='button' aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)} className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm ${view === key ? 'bg-brand text-onbrand' : 'text-soft hover:bg-page'}`}><Icon className='h-4 w-4' />{label}</button>
                    ))}
                </nav>
            </div>
            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-6'>
                {error && <Alert tone='error'>{error}</Alert>}
                {notice && <Alert tone='success'>{notice}</Alert>}
                {!set || !detail ? (
                    <Panel className='space-y-3'>
                        <Cycle steps={ctx.steps} status='draft' />
                        <p className='text-sm text-soft'>{ctx.sites.length ? 'No requirement set at this site yet.' : 'You have no planning access at any site.'} Firm the final products you must deliver, work back through the BOMs to the materials, firm the purchase and push it to Procurement.</p>
                        {!ctx.can['PLN.commercial.plan'] && <p className='text-xs text-muted'>A Requirements Planner creates requirement sets.</p>}
                    </Panel>
                ) : view === 'overview' ? (
                    <Overview ctx={ctx} detail={detail} />
                ) : view === 'products' ? (
                    <ProductsView ctx={ctx} detail={detail} onSaved={async (t) => { await refresh(); setNotice(t); }} onReopen={() => simple('reopen', 'Reopen the commercial requirements', 'The lines become editable again and the firming, work back and approvals have to be done again.', 'Reopen', 'Reopened for editing.', 10, true)} onCancel={() => simple('cancel', 'Cancel the requirement set', 'The set is closed. Requirements already pushed to procurement stay there.', 'Cancel set', 'Cancelled.', 10, true)} />
                ) : view === 'work' ? (
                    <WorkView detail={detail} busy={busy === 'explode'} onRun={explode} />
                ) : view === 'materials' ? (
                    <MaterialsView detail={detail} />
                ) : view === 'approval' ? (
                    <ApprovalView detail={detail} onApprove={() => decide('purchase/decide', 'approve', 'Approve this purchase level', 'Your approval is recorded against your Chart of Authority level.', 'Approve')} onReturn={() => decide('purchase/decide', 'return', 'Return the purchase requirements', 'They go back to the planner, who works back again and resubmits. Every approval level starts again.', 'Return', true)} onReturnCommercial={() => decide('decide', 'return', 'Return the commercial requirements', 'They go back to the planner with your reason.', 'Return', true)} />
                ) : (
                    <ProcurementView detail={detail} onPush={() => setPushing(true)} />
                )}
            </div>
            {pushing && set && <PushSheet detail={detail!} rev={set.revision} onClose={() => setPushing(false)} onDone={async (t) => { setPushing(false); await refresh(); setView('procurement'); setNotice(t); }} />}
        </div>
    );
}

// ----- Pieces -----

const sym = (u: Units, v: string) => u[v]?.symbol ?? v;
const lab = (u: Units, v: string) => (u[v] ? `${u[v].label} (${u[v].symbol})` : v);
const qty = (u: Units, n: number | null | undefined, v: string, d = 3) => (n === null || n === undefined ? '—' : `${fmt(n, d)} ${sym(u, v)}`);

function Cycle({ steps, status }: { steps: Context['steps']; status: Status }) {
    const at = Math.max(0, steps.findIndex((s) => s.status === status));
    const done = status === 'pushed';
    return (
        <ol className='flex gap-1 overflow-x-auto' aria-label='Stages'>
            {steps.map((s, i) => {
                const state = done || i < at ? 'done' : i === at ? 'now' : 'next';
                return (
                    <li key={s.status} className={`min-w-[9.5rem] flex-1 rounded-xl border p-2 ${state === 'now' ? 'border-brand bg-brand/10' : 'border-line bg-page'}`}>
                        <p className={`flex items-start gap-1 text-xs font-semibold ${state === 'done' ? 'text-brand' : state === 'now' ? 'text-ink' : 'text-muted'}`}>{state === 'done' ? <Check className='h-3.5 w-3.5' /> : <span>{i + 1}</span>}<span className='leading-tight'>{s.label}</span></p>
                        {s.role && <p className='mt-0.5 text-[12px] leading-tight text-muted'>{s.role}</p>}
                    </li>
                );
            })}
        </ol>
    );
}

function Overview({ ctx, detail }: { ctx: Context; detail: Detail }) {
    const { set, explosion } = detail;
    const sum = explosion?.summary;
    const units = set.lines.reduce((t, l) => t + l.quantity, 0);
    return (
        <div className='space-y-3'>
            <Panel className='space-y-3'>
                <Cycle steps={ctx.steps} status={set.status} />
                {set.status === 'cancelled' && <Alert tone='warn'>Cancelled: {set.cancelReason}</Alert>}
                {set.status === 'draft' && set.returnReason && <Alert tone='warn'>Returned: {set.returnReason}</Alert>}
                {set.status === 'firmed' && set.coa?.returnReason && <Alert tone='warn'>Purchase returned: {set.coa.returnReason}</Alert>}
                {detail.stale && set.status === 'firmed' && <Alert tone='info'>The last work back is out of date (more than a day old, or made before the firming). Work back again before submitting the purchase.</Alert>}
            </Panel>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                <Stat label='Final products' value={fmt(set.lines.length)} hint={`${fmt(units)} units firmed`} />
                <Stat label='Materials' value={sum ? fmt(sum.materials) : '—'} hint={sum ? `${fmt(sum.intermediates)} intermediate${sum.intermediates === 1 ? '' : 's'} split` : 'Work back to see'} />
                <Stat label='To buy' value={sum ? fmt(sum.toBuy) : '—'} hint={sum ? `${fmt(sum.covered)} covered by stock` : undefined} />
                <Stat label='Purchase value' value={sum ? fmt(sum.value, 2) : '—'} hint={set.firmedValue ? `Firmed ${fmt(set.firmedValue, 2)}` : undefined} />
                <Stat label='Order now' value={sum ? fmt(sum.orderNow) : '—'} hint='Past order-by' tone={sum && sum.orderNow ? 'warn' : undefined} />
                <Stat label='Late' value={sum ? fmt(sum.late) : '—'} hint='Misses need date' tone={sum && sum.late ? 'warn' : undefined} />
                <Stat label='Blocking issues' value={sum ? fmt(sum.blocking) : '—'} hint='Must be fixed' tone={sum && sum.blocking ? 'danger' : undefined} />
                <Stat label='Pushed' value={`${fmt(set.firmed?.filter((f) => f.pushedTo).length ?? 0)} / ${fmt(set.firmed?.length ?? 0)}`} hint='In procurement' />
            </div>
            {explosion && explosion.issues.length > 0 && <Issues explosion={explosion} />}
            <History items={set.history} />
        </div>
    );
}
function Issues({ explosion }: { explosion: Explosion }) {
    const block = explosion.issues.filter((i) => i.severity === 'block');
    const warn = explosion.issues.filter((i) => i.severity === 'warn');
    const list = (items: typeof block) => items.slice(0, 20).map((i, k) => <span key={k} className='mt-1 block pl-3 -indent-3'>• {i.text}</span>);
    return (
        <div className='space-y-2'>
            {block.length > 0 && <Alert tone='error'><span className='block font-semibold'>Fix before the purchase can be submitted</span>{list(block)}</Alert>}
            {warn.length > 0 && <Alert tone='warn'><span className='block font-semibold'>To watch</span>{list(warn)}</Alert>}
        </div>
    );
}
function History({ items }: { items: ReqSet['history'] }) {
    if (!items?.length) return null;
    return (
        <Panel className='space-y-2'>
            <h3 className='text-sm font-semibold text-ink'>History</h3>
            <ul className='space-y-2'>
                {items.slice(0, 30).map((h, i) => (
                    <li key={i} className='text-sm'>
                        <p className='text-ink'>{h.action.replace(/[._]/g, ' ')}{h.note ? ` · ${h.note}` : ''}</p>
                        <p className='text-xs text-muted'>{h.byName} · {new Date(h.at).toLocaleString()} · {STATUS_LABEL[h.status as Status] ?? h.status}</p>
                    </li>
                ))}
            </ul>
        </Panel>
    );
}

// ----- Final products -----

function ProductsView({ ctx, detail, onSaved, onReopen, onCancel }: { ctx: Context; detail: Detail; onSaved: (t: string) => Promise<void>; onReopen: () => void; onCancel: () => void }) {
    const { set } = detail;
    const editable = detail.actions.includes('edit_lines');
    const [lines, setLines] = useState<Line[]>(set.lines);
    const [dirty, setDirty] = useState(false);
    const [open, setOpen] = useState<{ index: number } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => { setLines(set.lines); setDirty(false); }, [set.id, set.revision]); // eslint-disable-line react-hooks/exhaustive-deps
    const sku = (id: string) => ctx.skus.find((s) => s.id === id);
    const columns: Array<Column<Line>> = [
        { key: 'sku', label: 'Final product', value: (l) => sku(l.skuId)?.name ?? l.skuId, render: (l) => <span className='font-medium text-ink'>{sku(l.skuId)?.name ?? l.skuId}</span> },
        { key: 'quantity', label: 'Quantity', type: 'number', value: (l) => l.quantity, render: (l) => `${fmt(l.quantity, 3)} ${sku(l.skuId)?.uomSymbol ?? ''}` },
        { key: 'unit', label: 'Unit', value: (l) => sku(l.skuId)?.uomLabel ?? l.uom },
        { key: 'needDate', label: 'Needed by', type: 'date', value: (l) => l.needDate },
        { key: 'customer', label: 'Customer / order', value: (l) => l.customer },
        { key: 'note', label: 'Note', value: (l) => l.note, hidden: true },
        { key: 'source', label: 'Source', value: () => 'Manual', hidden: true },
    ];
    const save = async () => {
        setBusy(true);
        setError('');
        try {
            await post('lines/save', { id: set.id, lines: lines.map((l) => ({ skuId: l.skuId, quantity: l.quantity, needDate: l.needDate, customer: l.customer, note: l.note })), expectedRevision: set.revision });
            await onSaved('Final products saved.');
        } catch (e) {
            setError(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className='space-y-3'>
            <Panel className='space-y-2'>
                <div className='flex flex-wrap items-center gap-2'>
                    <p className='w-full text-sm text-soft sm:w-auto sm:min-w-0 sm:flex-1'>{lines.length} final product line{lines.length === 1 ? '' : 's'} · {fmt(lines.reduce((t, l) => t + l.quantity, 0), 3)} units. Only final products are firmed; intermediates and materials are worked out from the BOMs. Quantities are in each product's own unit. Source: manual (the commercial forecast will feed these lines later).</p>
                    {editable && <Btn variant='secondary' onClick={() => setOpen({ index: -1 })}><Plus className='h-4 w-4' /> Add product</Btn>}
                    {editable && <Btn busy={busy} disabled={!dirty} onClick={save}><Check className='h-4 w-4' /> Save</Btn>}
                </div>
                {!editable && <p className='text-xs text-muted'>The lines can only be changed while the set is in commercial requirements. {detail.actions.includes('reopen') ? 'Reopen it to change them.' : ''}</p>}
                {error && <Alert tone='error'>{error}</Alert>}
                <div className='flex flex-wrap gap-2'>
                    {detail.actions.includes('reopen') && <Btn variant='secondary' onClick={onReopen}><Undo2 className='h-4 w-4' /> Reopen for editing</Btn>}
                    {detail.actions.includes('cancel') && <Btn variant='danger' onClick={onCancel}><Trash2 className='h-4 w-4' /> Cancel set</Btn>}
                </div>
            </Panel>
            <RichTable id='pln.req.lines' title='Final products' fileName={`${set.id}_final_products`} columns={columns} rows={lines} rowKey={(l) => `${l.skuId}|${l.needDate}`} onRowClick={editable ? (l) => setOpen({ index: lines.indexOf(l) }) : undefined} height='h-[calc(100dvh-26rem)]' />
            {open && (
                <LineSheet
                    ctx={ctx} initial={open.index >= 0 ? lines[open.index] : null} others={lines.filter((_, i) => i !== open.index)}
                    onClose={() => setOpen(null)}
                    onRemove={open.index >= 0 ? () => { setLines(lines.filter((_, i) => i !== open.index)); setDirty(true); setOpen(null); } : undefined}
                    onApply={(l) => { setLines(open.index >= 0 ? lines.map((x, i) => (i === open.index ? l : x)) : [...lines, l]); setDirty(true); setOpen(null); }}
                />
            )}
        </div>
    );
}

function LineSheet({ ctx, initial, others, onClose, onApply, onRemove }: { ctx: Context; initial: Line | null; others: Line[]; onClose: () => void; onApply: (l: Line) => void; onRemove?: () => void }) {
    const [skuId, setSkuId] = useState(initial?.skuId ?? '');
    const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : '');
    const [needDate, setNeedDate] = useState(initial?.needDate ?? '');
    const [customer, setCustomer] = useState(initial?.customer ?? '');
    const [note, setNote] = useState(initial?.note ?? '');
    const [submitted, setSubmitted] = useState(false);
    const sku = ctx.skus.find((s) => s.id === skuId);
    const q = Number(quantity.replace(/,/g, ''));
    const issues = {
        sku: !sku ? 'Choose a final product.' : '',
        quantity: !(Number.isFinite(q) && q > 0) ? 'Enter a quantity greater than zero.' : sku && suggestedSplitRule(sku.uom) === 'WHOLE' && !Number.isInteger(q) ? `${sku.name} is counted in whole units: enter a whole number.` : Math.abs(q * 1000 - Math.round(q * 1000)) > 1e-6 ? 'Use at most 3 decimals.' : '',
        date: !/^\d{4}-\d{2}-\d{2}$/.test(needDate) || needDate < ctx.today ? 'Choose today or a later date.' : others.some((o) => o.skuId === skuId && o.needDate === needDate) ? 'This product is already on the set for that date: add the quantities together.' : '',
    };
    const show = (k: keyof typeof issues) => (submitted ? issues[k] || undefined : undefined);
    const apply = () => {
        setSubmitted(true);
        if (Object.values(issues).some(Boolean) || !sku) return;
        onApply({ no: initial?.no ?? 0, skuId, quantity: Math.round(q * 1000) / 1000, uom: sku.uom, needDate, customer: customer.trim(), note: note.trim(), source: 'MANUAL' });
    };
    return (
        <Sheet title={initial ? 'Edit final product' : 'Add final product'} onClose={onClose} footer={<>{onRemove && <Btn variant='danger' onClick={onRemove}><Trash2 className='h-4 w-4' /> Remove</Btn>}<Btn className='ml-auto' onClick={apply}><Check className='h-4 w-4' /> {initial ? 'Apply' : 'Add'}</Btn></>}>
            <SelectField id='req-sku' label='Final product' required value={skuId} error={show('sku')} onChange={(e) => setSkuId(e.target.value)}>
                <option value=''>Choose…</option>
                {ctx.skus.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
            <Field id='req-qty' label={`Quantity${sku ? ` (${sku.uomLabel})` : ''}`} inputMode='decimal' required value={quantity} error={show('quantity')} hint={sku ? `In the product's own unit: ${sku.uomLabel} (${sku.uomSymbol}).` : 'Choose the product first: the quantity is in its own unit.'} onChange={(e) => setQuantity(e.target.value)} />
            <Field id='req-date' label='Needed by' type='date' min={ctx.today} required value={needDate} error={show('date')} onChange={(e) => setNeedDate(e.target.value)} />
            <Field id='req-customer' label='Customer or order reference' maxLength={120} value={customer} onChange={(e) => setCustomer(e.target.value)} />
            <TextArea id='req-note' label='Note' maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Sheet>
    );
}

// ----- Work back -----

function WorkView({ detail, busy, onRun }: { detail: Detail; busy: boolean; onRun: () => void }) {
    const { explosion, units, set } = detail;
    const [part, setPart] = useState<'tree' | 'production' | 'utilities'>('tree');
    const canRun = detail.actions.includes('run_explosion');
    return (
        <div className='space-y-3'>
            <Panel className='space-y-2'>
                <div className='flex flex-wrap items-center gap-2'>
                    <p className='w-full text-sm text-soft sm:w-auto sm:min-w-0 sm:flex-1'>
                        {explosion ? `Worked back ${set.explosionAt ? new Date(set.explosionAt).toLocaleString() : ''}${set.explosionPreview ? ' (a preview: it does not count until the set is firmed and worked back again)' : ''}. ` : 'Not worked back yet. '}
                        Each final product is exploded through its approved BOM. At every level the BOM line unit is converted to the unit of the item it makes up, made items are produced in whole minimum batches, and what is bought is netted against stock and open supply.
                    </p>
                    {canRun && <Btn busy={busy} onClick={onRun}><RefreshCw className='h-4 w-4' /> {explosion ? 'Work back again' : 'Work back'}</Btn>}
                </div>
                {detail.stale && set.status === 'firmed' && <Alert tone='info'>This work back is out of date: run it again before submitting the purchase.</Alert>}
            </Panel>
            {!explosion ? <Panel><p className='text-sm text-muted'>{set.lines.length ? 'Work back to see every level, the unit links, the minimum batches and the total required.' : 'Add final products first.'}</p></Panel> : (
                <>
                    <Issues explosion={explosion} />
                    <Choice label='Show' value={part} onChange={setPart} options={[['tree', 'By final product'], ['production', 'Production plan'], ['utilities', `Utilities (${explosion.utilities.length})`]]} />
                    {part === 'tree' && <p className='text-xs text-muted'>Each tree shows what that one line needs, exactly, with the unit link at every level. Minimum batches and whole packs are rounded once for all lines together: see the Production plan and the Materials.</p>}
                    {part === 'tree' && explosion.trees.map((t, i) => <TreeCard key={t.line.no} tree={t} units={units} open={i === 0} />)}
                    {part === 'production' && <ProductionTable explosion={explosion} units={units} id={set.id} />}
                    {part === 'utilities' && <UtilityTable explosion={explosion} units={units} />}
                </>
            )}
        </div>
    );
}

function TreeCard({ tree, units, open: initial }: { tree: Explosion['trees'][number]; units: Units; open: boolean }) {
    const [open, setOpen] = useState(initial);
    const count = (n: TreeNode): number => n.children.reduce((t, c) => t + (c.kind === 'material' ? 1 : 0) + count(c), 0);
    const blocked = (n: TreeNode): boolean => n.issues.length > 0 && n.factor === null || n.children.some(blocked);
    return (
        <Panel className='space-y-2'>
            <button type='button' aria-expanded={open} onClick={() => setOpen(!open)} className='flex min-h-11 w-full items-center gap-2 text-left'>
                {open ? <ChevronDown className='h-4 w-4 shrink-0 text-brand' /> : <ChevronRight className='h-4 w-4 shrink-0 text-brand' />}
                <span className='min-w-0 flex-1'>
                    <span className='block truncate text-sm font-semibold text-ink'>{tree.skuName}</span>
                    <span className='block truncate text-xs text-muted'>{qty(units, tree.line.quantity, tree.line.uom)} · needed {tree.line.needDate}{tree.line.customer ? ` · ${tree.line.customer}` : ''} · {count(tree.root)} material lines</span>
                </span>
                {blocked(tree.root) && <Pill tone='danger'>Fix</Pill>}
            </button>
            {open && <div className='space-y-1'><NodeRow node={tree.root} units={units} /></div>}
        </Panel>
    );
}

function NodeRow({ node, units }: { node: TreeNode; units: Units }) {
    const [open, setOpen] = useState(node.depth < 2);
    const kind = node.kind === 'sku' ? (node.depth === 0 ? 'Final product' : 'Intermediate') : node.kind === 'material' ? 'Material' : 'Utility';
    const same = node.lineUom === node.ownUom;
    const p = node.perParent;
    return (
        <div className={node.depth ? 'ml-3 border-l border-line pl-2 sm:ml-5 sm:pl-3' : ''}>
            <div className={`rounded-xl border p-2.5 ${node.issues.length ? 'border-red-500/40 bg-red-500/5' : 'border-line bg-page'}`}>
                <div className='flex items-start gap-2'>
                    {node.children.length > 0 ? (
                        <button type='button' aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)} className='-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-brand'>{open ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}</button>
                    ) : <span className='w-1.5 shrink-0' />}
                    <div className='min-w-0 flex-1'>
                        <div className='flex flex-wrap items-center gap-1.5'>
                            <Pill tone={node.kind === 'sku' ? 'brand' : 'muted'}>{kind}</Pill>
                            <span className='min-w-0 break-words text-sm font-semibold text-ink'>{node.name}</span>
                        </div>
                        {p && <p className='mt-1 text-xs text-soft'>BOM line {node.bomLine}: {fmt(p.qty, 4)} {sym(units, p.uom)} per {fmt(p.basisQty, 4)} {sym(units, p.basisUom)} of the parent{p.scrapPct ? `, scrap ${p.scrapPct}%` : ''} · {p.rule}</p>}
                        <p className='mt-1 text-sm text-ink'>
                            Required <span className='font-semibold tabular-nums'>{node.lineQty === null ? '—' : qty(units, node.lineQty, node.lineUom)}</span>
                            {!same && node.factor !== null && <> = <span className='font-semibold tabular-nums'>{qty(units, node.ownQty, node.ownUom)}</span></>}
                        </p>
                        {!same && node.depth > 0 && <p className='text-xs text-soft'>Unit link: {lab(units, node.lineUom)} → {lab(units, node.ownUom)}{node.factor !== null ? ` · 1 ${sym(units, node.lineUom)} = ${fmt(node.factor, 6)} ${sym(units, node.ownUom)}` : ' · no conversion'}</p>}
                        {node.bom && (
                            <p className='mt-1 text-xs text-soft'>
                                {node.bom.id}: makes {fmt(node.bom.outputQty, 4)} {sym(units, node.bom.outputUom)}
                                {node.bom.outputFactor !== null && node.bom.outputUom !== node.ownUom ? ` (1 ${sym(units, node.ownUom)} = ${fmt(node.bom.outputFactor, 6)} ${sym(units, node.bom.outputUom)})` : ''}
                                {' '}· minimum batch {fmt(node.bom.lot, 4)} {sym(units, node.bom.outputUom)}
                                {node.bom.lot !== node.bom.minimalBatch ? ` (full process batches; smallest ${fmt(node.bom.minimalBatch, 4)})` : ''}
                            </p>
                        )}
                        {node.issues.map((i, k) => <p key={k} className='mt-1 text-xs font-medium text-red-600 dark:text-red-400'>{i}</p>)}
                    </div>
                </div>
            </div>
            {open && node.children.length > 0 && <div className='mt-1 space-y-1'>{node.children.map((c) => <NodeRow key={c.id} node={c} units={units} />)}</div>}
        </div>
    );
}

function ProductionTable({ explosion, units, id }: { explosion: Explosion; units: Units; id: string }) {
    const columns: Array<Column<Prod>> = [
        { key: 'name', label: 'Made item', value: (p) => p.name, render: (p) => <span className='font-medium text-ink'>{p.name}</span> },
        { key: 'level', label: 'Level', type: 'number', value: (p) => p.level, render: (p) => (p.level === 0 ? 'Final' : `Intermediate ${p.level}`) },
        { key: 'required', label: 'Required', type: 'number', value: (p) => p.required, render: (p) => qty(units, p.required, p.ownUom) },
        { key: 'batch', label: 'Minimum batch', type: 'number', value: (p) => p.lot, render: (p) => qty(units, p.lot, p.outputUom, 4) },
        { key: 'lots', label: 'Batches', type: 'number', value: (p) => p.lots },
        { key: 'produced', label: 'Produced', type: 'number', value: (p) => p.producedOwn, render: (p) => qty(units, p.producedOwn, p.ownUom) },
        { key: 'excess', label: 'Excess', type: 'number', value: (p) => p.excessOutput, render: (p) => qty(units, p.excessOutput, p.outputUom) },
        { key: 'bom', label: 'BOM', value: (p) => p.bomId },
        { key: 'exact', label: 'Smallest exact batch', type: 'number', value: (p) => p.exactBatch, hidden: true },
        { key: 'vessel', label: 'Process vessel', type: 'number', value: (p) => p.processBatch, hidden: true },
        { key: 'outUnit', label: 'BOM output unit', value: (p) => units[p.outputUom]?.label ?? p.outputUom, hidden: true },
    ];
    return (
        <div className='space-y-2'>
            <p className='text-xs text-muted'>Requirements of one made item from several parents are added up first and then rounded up to whole minimum batches once, so the excess is never counted twice.</p>
            <RichTable id='pln.req.production' title='Production plan' fileName={`${id}_production_plan`} columns={columns} rows={explosion.production} rowKey={(p) => p.skuId} height='h-[calc(100dvh-27rem)]' />
        </div>
    );
}
function UtilityTable({ explosion, units }: { explosion: Explosion; units: Units }) {
    if (!explosion.utilities.length) return <Panel><p className='text-sm text-muted'>No metered utilities in these BOMs.</p></Panel>;
    return (
        <Panel className='space-y-2'>
            <p className='text-xs text-muted'>Utilities are metered and reported as requirements only; they are not purchased from here.</p>
            <ul className='divide-y divide-line'>{explosion.utilities.map((u) => <li key={u.key} className='flex items-center justify-between gap-2 py-2 text-sm'><span className='font-medium text-ink'>{u.code}</span><span className='tabular-nums text-soft'>{qty(units, u.gross, u.uom)}</span></li>)}</ul>
        </Panel>
    );
}

// ----- Materials -----

function MaterialsView({ detail }: { detail: Detail }) {
    const { explosion, units, warehouses, set } = detail;
    const [open, setOpen] = useState<Mat | null>(null);
    if (!explosion) return <Panel><p className='text-sm text-muted'>Work back to see the material requirements.</p></Panel>;
    const flag = (m: Mat) => (!m.pushable && m.buy > 0 ? 'Raise by hand' : m.orderNow ? 'Order now' : m.lateDays > 0 ? `Late ${m.lateDays} d` : m.buy === 0 ? 'Covered' : 'To buy');
    const columns: Array<Column<Mat>> = [
        { key: 'material', label: 'Material', value: (m) => `${m.number} ${m.name}`, render: (m) => <span><span className='font-medium text-ink'>{m.number}</span><span className='block max-w-[16rem] truncate text-xs text-soft'>{m.name}</span></span> },
        { key: 'status', label: 'Status', value: flag, render: (m) => <Pill tone={m.orderNow || m.lateDays > 0 || (!m.pushable && m.buy > 0) ? 'warn' : m.buy === 0 ? 'muted' : 'brand'}>{flag(m)}</Pill> },
        { key: 'unit', label: 'Stock unit', value: (m) => units[m.stockUom]?.label ?? m.stockUom, render: (m) => sym(units, m.stockUom) },
        { key: 'gross', label: 'Total required', type: 'number', value: (m) => m.gross, render: (m) => fmt(m.gross, 3) },
        { key: 'net', label: 'Net of stock', type: 'number', value: (m) => m.net, render: (m) => fmt(m.net, 3) },
        { key: 'buy', label: 'To buy', type: 'number', value: (m) => m.buy, render: (m) => <span className='font-semibold'>{fmt(m.buy, 3)}</span> },
        { key: 'buyPurchase', label: 'To buy (purchase unit)', type: 'number', value: (m) => m.buyPurchase, render: (m) => (m.buyPurchase === null ? '—' : qty(units, m.buyPurchase, m.purchaseUom)) },
        { key: 'value', label: 'Value', type: 'number', value: (m) => m.value, render: (m) => fmt(m.value, 2) },
        { key: 'needBy', label: 'Needed by', type: 'date', value: (m) => m.needBy },
        { key: 'orderBy', label: 'Order by', type: 'date', value: (m) => m.orderBy },
        { key: 'warehouse', label: 'Warehouse', value: (m) => warehouses[m.warehouseId]?.name ?? (m.warehouseId || 'None'), hidden: true },
        { key: 'level', label: 'BOM level', type: 'number', value: (m) => m.level, hidden: true },
        { key: 'exact', label: 'Each product alone', type: 'number', value: (m) => m.exact, hidden: true },
        { key: 'rounding', label: 'Batch and pack rounding', type: 'number', value: (m) => m.rounding, hidden: true },
        { key: 'available', label: 'Available', type: 'number', value: (m) => m.available, hidden: true },
        { key: 'safety', label: 'Safety stock', type: 'number', value: (m) => m.safetyStock, hidden: true },
        { key: 'supply', label: 'Open supply', type: 'number', value: (m) => m.openSupply, hidden: true },
        { key: 'moq', label: 'Minimum order', type: 'number', value: (m) => m.moq, hidden: true },
        { key: 'multiple', label: 'Order multiple', type: 'number', value: (m) => m.orderMultiple, hidden: true },
        { key: 'purchaseUnit', label: 'Purchase unit', value: (m) => (m.purchaseUom ? units[m.purchaseUom]?.label ?? m.purchaseUom : ''), hidden: true },
        { key: 'lead', label: 'Lead time (days)', type: 'number', value: (m) => m.leadDays, hidden: true },
        { key: 'excess', label: 'Excess bought', type: 'number', value: (m) => m.excess, hidden: true },
    ];
    return (
        <div className='space-y-2'>
            <p className='text-xs text-muted'>{explosion.materials.length} materials · {explosion.summary.toBuy} to buy worth {fmt(explosion.summary.value, 2)}. Tap a row for the unit chain, what each final product needs and how the quantity to buy is reached.</p>
            <RichTable id='pln.req.materials' title='Material requirements' fileName={`${set.id}_material_requirements`} columns={columns} rows={explosion.materials} rowKey={(m) => m.key} onRowClick={setOpen} height='h-[calc(100dvh-26rem)]' />
            {open && <MaterialSheet m={open} units={units} warehouse={warehouses[open.warehouseId]} onClose={() => setOpen(null)} />}
        </div>
    );
}

function Row({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean }) {
    return <div className='flex items-baseline justify-between gap-3 py-1.5 text-sm'><span className='min-w-0 text-soft'>{k}</span><span className={`shrink-0 whitespace-nowrap text-right tabular-nums ${strong ? 'font-semibold text-ink' : 'text-ink'}`}>{v}</span></div>;
}
function MaterialSheet({ m, units, warehouse, onClose }: { m: Mat; units: Units; warehouse?: { code: string; name: string }; onClose: () => void }) {
    const su = m.stockUom;
    const usable = m.available - m.safetyStock;
    return (
        <Sheet title={`${m.number} · ${m.name}`} onClose={onClose}>
            <p className='text-sm text-soft'>{warehouse ? `${warehouse.code} ${warehouse.name}` : 'No warehouse on the BOM line'} · BOM level {m.level}</p>
            {m.issues.map((i, k) => <Alert key={k} tone='warn'>{i}</Alert>)}
            <section className='space-y-1 rounded-xl border border-line p-3'>
                <h3 className='text-sm font-semibold text-ink'>Unit chain</h3>
                <Row k='BOM line unit' v={m.bomUnits.map((u) => lab(units, u)).join(', ') || '—'} />
                <Row k='Stock unit (requirements are raised in this)' v={lab(units, su)} />
                <Row k='Purchase unit' v={m.purchaseUom ? lab(units, m.purchaseUom) : 'None set: the stock unit is used'} />
                {m.purchaseFactor !== null && m.purchaseUom && m.purchaseUom !== su && <Row k='Relationship' v={`1 ${sym(units, m.purchaseUom)} = ${fmt(m.purchaseFactor, 6)} ${sym(units, su)}`} />}
            </section>
            <section className='space-y-1 rounded-xl border border-line p-3'>
                <h3 className='text-sm font-semibold text-ink'>Total required, in {lab(units, su)}</h3>
                {m.pegs.map((p, i) => (
                    <div key={i} className='py-1.5 text-sm'>
                        <div className='flex items-baseline justify-between gap-3'><span className='min-w-0 text-ink'>{p.skuName}</span><span className='tabular-nums text-ink'>{fmt(p.qty, 3)}</span></div>
                        <p className='text-xs text-soft'>via {p.parentName} line {p.bomLine}: {fmt(p.lineQty, 3)} {sym(units, p.lineUom)}{p.lineUom !== su ? ` × ${fmt(p.factor, 6)}` : ''} · needed {p.needDate}</p>
                    </div>
                ))}
                <Row k='Batch and pack rounding' v={fmt(m.rounding, 3)} />
                <Row k='Total required' v={`${fmt(m.gross, 3)} ${sym(units, su)}`} strong />
            </section>
            <section className='space-y-1 rounded-xl border border-line p-3'>
                <h3 className='text-sm font-semibold text-ink'>To buy</h3>
                <Row k='Total required' v={fmt(m.gross, 3)} />
                <Row k={`Less available (${fmt(m.available, 3)}) above safety stock (${fmt(m.safetyStock, 3)})`} v={`− ${fmt(Math.max(0, usable), 3)}`} />
                {usable < 0 && <Row k='Plus refill to safety stock' v={`+ ${fmt(-usable, 3)}`} />}
                <Row k='Less open supply (requirements, requisitions, orders)' v={`− ${fmt(m.openSupply, 3)}`} />
                <Row k='Net requirement' v={fmt(m.net, 3)} strong />
                <Row k='Minimum order' v={m.moq === null ? 'None' : `${fmt(m.moq, 3)} ${sym(units, su)}`} />
                <Row k='Order multiple' v={m.orderMultiple === null ? 'None' : `${fmt(m.orderMultiple, 3)} ${sym(units, su)}`} />
                <Row k='Quantity to buy' v={`${fmt(m.buy, 3)} ${sym(units, su)}`} strong />
                {m.buyPurchase !== null && <Row k='In the purchase unit' v={qty(units, m.buyPurchase, m.purchaseUom)} />}
                <Row k='Excess from the minimum order and multiple' v={fmt(m.excess, 3)} />
                <Row k='Unit cost' v={m.unitCost ? fmt(m.unitCost, 4) : 'Not known'} />
                <Row k='Value' v={fmt(m.value, 2)} strong />
            </section>
            <section className='space-y-1 rounded-xl border border-line p-3'>
                <h3 className='text-sm font-semibold text-ink'>Dates</h3>
                <Row k='Needed by' v={m.needBy || '—'} />
                <Row k={`Order by (lead time ${m.leadDays} days)`} v={m.orderBy || '—'} />
                <Row k='Arrives if ordered today' v={m.arrival} />
                {m.orderNow && <p className='text-xs font-medium text-amber-700 dark:text-amber-400'>The order-by date has passed: order now.</p>}
                {m.lateDays > 0 && <p className='text-xs font-medium text-amber-700 dark:text-amber-400'>Ordered today it arrives {m.lateDays} days after it is needed.</p>}
            </section>
        </Sheet>
    );
}

// ----- Approval -----

function ApprovalView({ detail, onApprove, onReturn, onReturnCommercial }: { detail: Detail; onApprove: () => void; onReturn: () => void; onReturnCommercial: () => void }) {
    const { set, units, warehouses } = detail;
    const firmed = set.firmed ?? [];
    const columns: Array<Column<Firmed>> = [
        { key: 'material', label: 'Material', value: (f) => `${f.number} ${f.name}`, render: (f) => <span><span className='font-medium text-ink'>{f.number}</span><span className='block max-w-[16rem] truncate text-xs text-soft'>{f.name}</span></span> },
        { key: 'qty', label: 'Firmed quantity', type: 'number', value: (f) => f.firmQty, render: (f) => qty(units, f.firmQty, f.stockUom) },
        { key: 'value', label: 'Value', type: 'number', value: (f) => f.value, render: (f) => fmt(f.value, 2) },
        { key: 'needBy', label: 'Needed by', type: 'date', value: (f) => f.needBy },
        { key: 'warehouse', label: 'Warehouse', value: (f) => warehouses[f.warehouseId]?.name ?? f.warehouseId },
        { key: 'for', label: 'For', value: (f) => f.forSkus.join(', '), hidden: true },
    ];
    const steps = set.coa?.steps ?? [];
    return (
        <div className='space-y-3'>
            <Panel className='space-y-3'>
                <h3 className='text-sm font-semibold text-ink'>Chart of Authority</h3>
                {set.status === 'commercial_review' && <Alert tone='info'>Waiting for an independent approver to firm the commercial requirements.{detail.actions.includes('return_commercial') ? ' You can firm them from the top bar or return them here.' : ''}</Alert>}
                {steps.length ? (
                    <ol className='space-y-2'>
                        {steps.map((s) => (
                            <li key={s.level} className={`rounded-xl border p-3 ${s.status === 'approved' ? 'border-brand/40 bg-brand/5' : 'border-line bg-page'}`}>
                                <div className='flex flex-wrap items-center gap-2'><Pill tone={s.status === 'approved' ? 'brand' : 'warn'}>{s.status === 'approved' ? 'Approved' : 'Waiting'}</Pill><span className='text-sm font-semibold text-ink'>Level {s.level} · {s.title}</span></div>
                                <p className='mt-1 text-xs text-soft'>{s.status === 'approved' ? `${s.byName} · ${new Date(s.at).toLocaleString()}${s.note ? ` · ${s.note}` : ''}` : `Approved by ${s.positionTitle}`}</p>
                            </li>
                        ))}
                    </ol>
                ) : <p className='text-sm text-muted'>The approval levels are set when the purchase is submitted, from the firmed purchase value.</p>}
                <p className='text-sm text-soft'>Firmed purchase value: <span className='font-semibold text-ink'>{fmt(set.firmedValue, 2)}</span>. A push can move quantity between lines with a reason but never above this value.</p>
                <div className='flex flex-wrap gap-2'>
                    {detail.actions.includes('approve_purchase') && <Btn onClick={onApprove}><Check className='h-4 w-4' /> Approve level</Btn>}
                    {detail.actions.includes('return_purchase') && <Btn variant='danger' onClick={onReturn}><Undo2 className='h-4 w-4' /> Return</Btn>}
                    {detail.actions.includes('return_commercial') && <Btn variant='danger' onClick={onReturnCommercial}><Undo2 className='h-4 w-4' /> Return commercial requirements</Btn>}
                </div>
            </Panel>
            {firmed.length > 0 && <RichTable id='pln.req.firmed' title='Firmed purchase requirements' fileName={`${set.id}_firmed_purchase`} columns={columns} rows={firmed} rowKey={(f) => f.key} height='h-[calc(100dvh-30rem)]' />}
        </div>
    );
}

// ----- Procurement -----

function ProcurementView({ detail, onPush }: { detail: Detail; onPush: () => void }) {
    const { set, units, warehouses } = detail;
    const firmed = set.firmed ?? [];
    const columns: Array<Column<Firmed>> = [
        { key: 'material', label: 'Material', value: (f) => `${f.number} ${f.name}`, render: (f) => <span><span className='font-medium text-ink'>{f.number}</span><span className='block max-w-[16rem] truncate text-xs text-soft'>{f.name}</span></span> },
        { key: 'warehouse', label: 'Warehouse', value: (f) => warehouses[f.warehouseId]?.name ?? f.warehouseId },
        { key: 'qty', label: 'Firmed quantity', type: 'number', value: (f) => f.firmQty, render: (f) => qty(units, f.firmQty, f.stockUom) },
        { key: 'value', label: 'Value', type: 'number', value: (f) => f.value, render: (f) => fmt(f.value, 2) },
        { key: 'status', label: 'Status', value: (f) => (f.pushedTo ? (f.pushedTo === 'PENDING' ? 'Pushing' : 'In procurement') : 'Not pushed'), render: (f) => <Pill tone={f.pushedTo ? 'brand' : 'warn'}>{f.pushedTo ? (f.pushedTo === 'PENDING' ? 'Pushing' : 'In procurement') : 'Not pushed'}</Pill> },
        { key: 'req', label: 'Purchase requirement', value: (f) => (f.pushedTo && f.pushedTo !== 'PENDING' ? f.pushedTo : '') },
    ];
    const left = firmed.filter((f) => !f.pushedTo).length;
    return (
        <div className='space-y-3'>
            <Panel className='space-y-2'>
                <p className='text-sm text-soft'>
                    {set.status === 'approved' ? `${left} of ${firmed.length} firmed lines are waiting to be pushed. You confirm the quantity of every line (a change needs a reason and the total cannot exceed the approved value), and choose the GL account for each warehouse. One purchase requirement is raised per warehouse; you become its requester and your manager approves it before the stores release it and procurement takes it.`
                        : set.status === 'pushed' ? 'Every firmed line is in procurement.' : 'Lines can be pushed once the purchase requirements are approved under the Chart of Authority.'}
                </p>
                {detail.actions.includes('push') && <Btn onClick={onPush}><Rocket className='h-4 w-4' /> Confirm and push</Btn>}
            </Panel>
            {firmed.length > 0 && <RichTable id='pln.req.push' title='Push to procurement' fileName={`${set.id}_push`} columns={columns} rows={firmed} rowKey={(f) => f.key} height='h-[calc(100dvh-30rem)]' />}
            {(set.pushes?.length ?? 0) > 0 && (
                <Panel className='space-y-2'>
                    <h3 className='text-sm font-semibold text-ink'>Purchase requirements raised</h3>
                    <ul className='divide-y divide-line'>
                        {set.pushes!.map((p, i) => (
                            <li key={i} className='py-2 text-sm'>
                                <p className='font-semibold text-ink'>{p.requirementId} · {warehouses[p.warehouseId]?.code ?? p.warehouseId}</p>
                                <p className='text-xs text-soft'>{p.lines.length} lines · {fmt(p.total, 2)} · {p.byName} · {new Date(p.at).toLocaleString()}{p.lines.some((l) => l.quantity !== l.firmQty) ? ' · quantities changed' : ''}</p>
                            </li>
                        ))}
                    </ul>
                </Panel>
            )}
        </div>
    );
}

interface PushRow { key: string; include: boolean; qty: string; reason: string; date: string }
interface Review { ok: boolean; problems: string[]; groups: Array<{ warehouseId: string; code: string; name: string; glCode: string; total: number; lines: Array<{ key: string; number: string; quantity: number; firmQty: number; changed: boolean; stockUom: string; pushValue: number; dateRequired: string }> }>; total: number; firmedTotal: number; ceiling: number; approver: string }

function PushSheet({ detail, rev, onClose, onDone }: { detail: Detail; rev: number; onClose: () => void; onDone: (t: string) => Promise<void> }) {
    const { set, units, warehouses } = detail;
    const todo = (set.firmed ?? []).filter((f) => !f.pushedTo);
    const today = new Date().toISOString().slice(0, 10);
    const [rows, setRows] = useState<Record<string, PushRow>>(() => Object.fromEntries(todo.map((f) => [f.key, { key: f.key, include: true, qty: String(f.firmQty), reason: '', date: f.needBy && f.needBy > today ? f.needBy : today }])));
    const [gl, setGl] = useState<Record<string, string>>({});
    const [review, setReview] = useState<Review | null>(null);
    const [submitted, setSubmitted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const set1 = (k: string, patch: Partial<PushRow>) => { setRows((r) => ({ ...r, [k]: { ...r[k], ...patch } })); setReview(null); };
    const chosen = todo.filter((f) => rows[f.key]?.include);
    const warehousesIn = [...new Set(chosen.map((f) => f.warehouseId))];
    const num = (s: string) => Number(s.replace(/,/g, ''));
    const lineIssues = (f: Firmed) => {
        const r = rows[f.key];
        const q = num(r.qty);
        let qtyIssue = '';
        if (!(Number.isFinite(q) && q > 0)) qtyIssue = 'Enter a quantity greater than zero.';
        else if (suggestedSplitRule(f.stockUom) === 'WHOLE' && !Number.isInteger(q)) qtyIssue = 'Counted in whole units: enter a whole number.';
        else if (Math.abs(q * 1000 - Math.round(q * 1000)) > 1e-6) qtyIssue = 'Use at most 3 decimals.';
        const reasonIssue = !qtyIssue && q !== f.firmQty && (r.reason.trim().length < 10 || r.reason.trim().length > 300) ? 'Say why the quantity changes (10 to 300 characters).' : '';
        const dateIssue = !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || r.date < today ? 'The date required must be today or later.' : '';
        return { qty: qtyIssue, reason: reasonIssue, date: dateIssue };
    };
    const lineIssue = (f: Firmed) => Object.values(lineIssues(f)).find(Boolean) ?? '';
    const total = chosen.reduce((t, f) => { const q = num(rows[f.key].qty); return t + (Number.isFinite(q) ? q * f.unitCost : 0); }, 0);
    const ceiling = set.firmedValue ?? 0;
    const already = (set.firmed ?? []).filter((f) => f.pushedTo).reduce((t, f) => t + f.value, 0);
    const over = total + already > ceiling + 0.01;
    const payload = (dryRun: boolean) => ({ id: set.id, dryRun, expectedRevision: rev, gl, edits: chosen.map((f) => ({ key: f.key, quantity: num(rows[f.key].qty), reason: rows[f.key].reason.trim(), dateRequired: rows[f.key].date })) });
    const blocked = () => !chosen.length || chosen.some((f) => lineIssue(f)) || over || warehousesIn.some((w) => !gl[w]);
    const check = async () => {
        setSubmitted(true);
        setError('');
        if (blocked()) return;
        setBusy(true);
        try {
            setReview(await post<Review>('push', payload(true)));
        } catch (e) {
            setError(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    const push = async () => {
        setBusy(true);
        setError('');
        try {
            const r = await post<{ raised: Array<{ id: string; warehouse: string; lines: number; approver: string }> }>('push', payload(false));
            await onDone(`${r.raised.map((x) => `${x.id} (${x.warehouse}, ${x.lines} lines)`).join(', ')} raised and sent to ${r.raised[0]?.approver ?? 'your manager'} for approval.`);
        } catch (e) {
            setError(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Sheet title='Confirm quantities and push' onClose={onClose} footer={review?.ok ? <><Btn variant='secondary' onClick={() => setReview(null)}>Edit</Btn><Btn className='ml-auto' busy={busy} onClick={push}><Rocket className='h-4 w-4' /> Push to procurement</Btn></> : <Btn className='ml-auto' busy={busy} onClick={check}><Check className='h-4 w-4' /> Review</Btn>}>
            <div className='grid grid-cols-3 gap-2'>
                <Stat label='This push' value={fmt(total, 2)} tone={over ? 'danger' : undefined} />
                <Stat label='Approved' value={fmt(ceiling, 2)} hint={already ? `${fmt(already, 2)} already pushed` : undefined} />
                <Stat label='Lines' value={`${chosen.length} / ${todo.length}`} />
            </div>
            {over && <Alert tone='error'>The push is above the approved value. Lower a quantity: a push can move quantity between lines but cannot raise the spend.</Alert>}
            {error && <Alert tone='error'>{error}</Alert>}
            {review && (
                <section className='space-y-2 rounded-xl border border-line p-3'>
                    <h3 className='text-sm font-semibold text-ink'>{review.ok ? 'Ready to push' : 'Cannot push yet'}</h3>
                    {review.problems.map((p, i) => <Alert key={i} tone='error'>{p}</Alert>)}
                    {review.groups.map((g) => <p key={g.warehouseId} className='text-sm text-soft'><span className='font-semibold text-ink'>{g.code} {g.name}</span>: one purchase requirement, {g.lines.length} lines, {fmt(g.total, 2)}, GL {g.glCode || 'not chosen'}</p>)}
                    {review.ok && <p className='text-sm text-soft'>You become the requester. {review.approver ? `${review.approver} approves` : 'Your manager approves'}, then the stores release and procurement acknowledges.</p>}
                </section>
            )}
            {warehousesIn.map((w) => <GlPick key={w} warehouseId={w} label={`GL account for ${warehouses[w]?.code ?? w}`} value={gl[w] ?? ''} error={submitted && !gl[w] ? 'Choose the GL account.' : undefined} onPick={(code) => { setGl((g) => ({ ...g, [w]: code })); setReview(null); }} />)}
            {todo.map((f) => {
                const r = rows[f.key];
                const issue = submitted && r.include ? lineIssues(f) : { qty: '', reason: '', date: '' };
                const changed = num(r.qty) !== f.firmQty;
                return (
                    <section key={f.key} className={`space-y-2 rounded-xl border p-3 ${r.include ? 'border-line' : 'border-line opacity-60'}`}>
                        <label className='flex min-h-11 items-start gap-3'>
                            <input type='checkbox' className='mt-1 h-5 w-5 shrink-0' checked={r.include} onChange={(e) => set1(f.key, { include: e.target.checked })} />
                            <span className='min-w-0 flex-1'>
                                <span className='block text-sm font-semibold text-ink'>{f.number} · {f.name}</span>
                                <span className='block text-xs text-soft'>{warehouses[f.warehouseId]?.code ?? f.warehouseId} · firmed {qty(units, f.firmQty, f.stockUom)} · {fmt(f.value, 2)}{f.forSkus.length ? ` · for ${f.forSkus.join(', ')}` : ''}</span>
                            </span>
                        </label>
                        {r.include && (
                            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                                <Field id={`pq-${f.key}`} label={`Quantity in ${lab(units, f.stockUom)}`} inputMode='decimal' required value={r.qty} error={issue.qty || undefined} onChange={(e) => set1(f.key, { qty: e.target.value })} />
                                <Field id={`pd-${f.key}`} label='Needed by' type='date' min={today} required value={r.date} error={issue.date || undefined} onChange={(e) => set1(f.key, { date: e.target.value })} />
                                {changed && <div className='sm:col-span-2'><Field id={`pr-${f.key}`} label={`Why the quantity changes from ${fmt(f.firmQty, 3)} to ${r.qty || '…'}`} required maxLength={300} value={r.reason} error={issue.reason || undefined} onChange={(e) => set1(f.key, { reason: e.target.value })} /></div>}
                            </div>
                        )}
                    </section>
                );
            })}
        </Sheet>
    );
}

function GlPick({ warehouseId, label, value, error, onPick }: { warehouseId: string; label: string; value: string; error?: string; onPick: (code: string) => void }) {
    const [query, setQuery] = useState('');
    const [options, setOptions] = useState<Array<{ code: string; name: string }>>([]);
    useEffect(() => {
        if (query.trim().length < 2) return setOptions([]);
        const t = window.setTimeout(() => {
            callBackend<{ items: Array<{ code: string; name: string }> }>('/api/org/procurement/req/gl', { costCenterId: warehouseId, q: query })
                .then((r) => setOptions(r.items))
                .catch(() => setOptions([]));
        }, 250);
        return () => window.clearTimeout(t);
    }, [query, warehouseId]);
    return (
        <div className='space-y-1'>
            <Field id={`gl-${warehouseId}`} label={value ? `${label}: ${value}` : label} required placeholder='Type to search approved accounts' value={query} error={error} onChange={(e) => setQuery(e.target.value)} />
            {options.length > 0 && (
                <ul className='max-h-48 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line'>
                    {options.map((a) => (
                        <li key={a.code}>
                            <button type='button' onClick={() => { onPick(a.code); setQuery(`${a.code} ${a.name}`); setOptions([]); }} className='flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm active:bg-page'>
                                <span className='font-mono text-xs text-muted'>{a.code}</span>
                                <span className='min-w-0 flex-1 truncate text-ink'>{a.name}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
