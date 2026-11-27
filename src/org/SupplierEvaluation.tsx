import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Circle, Info, ListChecks, MoreVertical, Send, XCircle } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field, SearchField, SelectField, TextArea } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import Sheet from '../components/Sheet';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Screen, Segmented, messageOf, useConfirm } from '../components/screen';
import {
    ACCOUNTABILITY, ACCOUNTABILITY_LABEL, KIND_PROFILE, PROFILE_LABEL, answerKey, nextState, overallOf, scoreCard,
    type Accountability, type Answer, type AnswerState, type Profile, type ProfileId,
} from '../../backend/supplierEvaluationModel';
import { BandChip, BandStrip, Ring, ScoreBar, ScoreGauge, TrendChart, answerStyle, fmt, scoreColor } from './srmVisuals';

// Procurement › Supplier evaluation: supplier relationship evaluation for materials, services and assets.
// Setup (frequency, bands, eligible suppliers and categories, window, adopted template questions) -> per legal entity
// and supplier, a scorecard per template: tap a question to cycle not assessed / OK / not OK; the score out of 100
// and the supplier, organization and joint scores update at once and every few seconds from other evaluators.
// Submitted evaluations are approved independently; the final score becomes the supplier's SRM score.

const BASE = 'organization_home/procurement_srm';
const API = '/api/org/procurement/srm';
const SRE = /^SRE\d{8}$/;
const VND = /^VND\d{6}$/;
const today = () => new Date().toISOString().slice(0, 10);
type Bands = { improveFrom: number; passFrom: number };
const STATUS: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', returned: 'Returned', submitted: 'Awaiting approval', finalized: 'Final', cancelled: 'Cancelled' };
const statusTone = (s: string): 'brand' | 'muted' | 'warn' | 'danger' => (s === 'finalized' ? 'brand' : ['submitted', 'returned', 'in_progress'].includes(s) ? 'warn' : s === 'cancelled' ? 'danger' : 'muted');

/** Re-runs `fn` every `ms` while the page is visible: the "real time" refresh. */
function usePoll(fn: () => void, ms: number, on = true) {
    const ref = useRef(fn);
    ref.current = fn;
    useEffect(() => {
        if (!on) return;
        const t = window.setInterval(() => { if (document.visibilityState === 'visible') ref.current(); }, ms);
        return () => window.clearInterval(t);
    }, [ms, on]);
}

export default function SupplierEvaluation({ id }: { id?: string }) {
    if (id && SRE.test(id)) return <Scorecard id={id} />;
    if (id && VND.test(id)) return <SupplierDashboardScreen vendorId={id} />;
    return <Home initial={id === 'setup' ? 'setup' : id === 'results' ? 'results' : 'evaluate'} />;
}

// =============================== Home ===============================

interface Row { key: string; legalEntityId: string; legalEntityName: string; mine: boolean; vendorId: string; vendorNumber: string; vendorName: string; profiles: ProfileId[]; evaluationId: string; status: string; score: number | null; coverage: number; band: string; updatedAt: string }
interface Hist { id: string; number: string; vendorId: string; vendorName: string; legalEntityName: string; windowStart: string; windowEnd: string; score: number; band: string; sub: Record<string, number | null>; approvedAt: string }
interface ListData { setup: { version: number; frequencyLabel: string; bands: Bands; window: { id: string; start: string; end: string } | null } | null; windowOpen: boolean; rows: Row[]; history: Hist[]; open: number; can: { evaluate: boolean; approve: boolean; setup: boolean }; stamp: string }

function Home({ initial }: { initial: 'evaluate' | 'results' | 'setup' }) {
    const [tab, setTab] = useState(initial);
    const { data, error, loading, reload } = useLoad(() => callBackend<ListData>(`${API}/evaluations/list`, {}), []);
    const stamp = useRef('');
    usePoll(async () => {
        try {
            const r = await callBackend<ListData>(`${API}/evaluations/list`, {});
            if (r.stamp !== stamp.current) { stamp.current = r.stamp; reload(); }
        } catch { /* keep the last view */ }
    }, 15000, tab !== 'setup');
    useEffect(() => { if (data) stamp.current = data.stamp; }, [data]);
    return (
        <Screen
            title='Supplier evaluation'
            subtitle='Supplier relationship evaluation for materials, services and assets'
            onBack={() => navigate('organization_home')}
            toolbar={<Segmented label='Supplier evaluation' value={tab} onChange={(t) => setTab(t)} options={[{ value: 'evaluate', label: 'Evaluate', count: data?.open || undefined }, { value: 'results', label: 'Results' }, { value: 'setup', label: 'Setup' }]} />}
            bodyFlush={tab !== 'setup' && !!data?.setup}
        >
            {tab === 'setup' ? <Setup onSaved={reload} /> : loading && !data ? <Spinner /> : error ? <Alert tone='error'>{error}</Alert> : !data?.setup ? (
                <div className='space-y-3 p-1'>
                    <Alert tone='info'>Supplier evaluation is not set up yet. {data?.can.setup ? 'Open Setup to choose the frequency, performance bands, suppliers, window and template questions.' : 'Ask the supplier evaluation administrator to set it up.'}</Alert>
                    {data?.can.setup && <Button onClick={() => setTab('setup')}>Open setup</Button>}
                </div>
            ) : tab === 'evaluate' ? <EvaluateTab data={data} /> : <ResultsTab data={data} />}
        </Screen>
    );
}

function WindowCard({ data }: { data: ListData }) {
    const w = data.setup!.window;
    const rows = data.rows;
    const total = rows.length || 1;
    const final = rows.filter((r) => r.status === 'finalized').length;
    const daysLeft = w ? Math.max(0, Math.round((Date.parse(`${w.end}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86_400_000)) : 0;
    const counts = ['not_started', 'in_progress', 'submitted', 'finalized'].map((s) => ({ s, n: rows.filter((r) => r.status === s || (s === 'in_progress' && r.status === 'returned')).length }));
    return (
        <div className='m-3 rounded-2xl border border-line bg-panel p-4'>
            <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0'>
                    <p className='text-xs uppercase tracking-wide text-muted'>Evaluation window · {data.setup!.frequencyLabel}</p>
                    <p className='mt-0.5 text-base font-semibold text-ink'>{w ? `${w.start} to ${w.end}` : 'Not set'}</p>
                    <p className='text-xs text-soft'>{!w ? '' : data.windowOpen ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : today() < w.start ? `Opens on ${w.start}` : 'Closed. Set the next window in Setup.'}</p>
                </div>
                <div className='text-right'>
                    <p className='text-2xl font-bold' style={{ color: scoreColor((final / total) * 100) }}>{Math.round((final / total) * 100)}%</p>
                    <p className='text-xs text-muted'>{final} of {rows.length} final</p>
                </div>
            </div>
            <div className='mt-3'><ScoreBar pct={(final / total) * 100} /></div>
            <div className='mt-3 grid grid-cols-4 gap-2 text-center'>
                {counts.map(({ s, n }) => (
                    <div key={s} className='rounded-xl bg-page px-1 py-2'>
                        <p className='text-lg font-semibold text-ink'>{n}</p>
                        <p className='text-xs leading-tight text-muted'>{STATUS[s]}</p>
                    </div>
                ))}
            </div>
            <div className='mt-3'><BandStrip {...data.setup!.bands} /></div>
        </div>
    );
}

function EvaluateTab({ data }: { data: ListData }) {
    const [scope, setScope] = useState<'mine' | 'all'>(data.rows.some((r) => r.mine) ? 'mine' : 'all');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const { ask, sheet } = useConfirm();
    const rows = scope === 'mine' ? data.rows.filter((r) => r.mine) : data.rows;
    const open = (r: Row) => {
        setFailure('');
        if (r.evaluationId) return navigate(`${BASE}/${r.evaluationId}`);
        if (!data.can.evaluate) return setFailure('You need the supplier evaluator right to start an evaluation.');
        if (!r.mine) return setFailure(`You can evaluate only for the legal entities you work in, not ${r.legalEntityName}.`);
        if (!data.windowOpen) return setFailure('The evaluation window is not open.');
        ask({ title: `Evaluate ${r.vendorName}?`, message: `For ${r.legalEntityName}, window ${data.setup!.window!.start} to ${data.setup!.window!.end}. Scorecards: ${r.profiles.map((p) => PROFILE_LABEL[p]).join(', ')}.`, confirmLabel: 'Start evaluation' }, async () => {
            setBusy(true);
            try {
                const x = await callBackend<{ id: string }>(`${API}/evaluations/start`, { legalEntityId: r.legalEntityId, vendorId: r.vendorId });
                navigate(`${BASE}/${x.id}`);
            } finally {
                setBusy(false);
            }
        });
    };
    const columns: Array<Column<Row>> = [
        { key: 'vendor', label: 'Supplier', value: (r) => r.vendorName, render: (r) => <span className='font-medium text-ink'>{r.vendorName}</span> },
        { key: 'le', label: 'Legal entity', value: (r) => r.legalEntityName },
        { key: 'status', label: 'Status', value: (r) => STATUS[r.status] ?? r.status, render: (r) => <Badge tone={statusTone(r.status)}>{STATUS[r.status] ?? r.status}</Badge> },
        { key: 'score', label: 'Score', type: 'number', value: (r) => r.score, render: (r) => (r.score === null ? '—' : <span className='font-semibold' style={{ color: scoreColor(r.score) }}>{fmt(r.score)}</span>) },
        { key: 'coverage', label: 'Assessed %', type: 'number', value: (r) => (r.evaluationId ? r.coverage : null) },
        { key: 'band', label: 'Band', value: (r) => (r.band === 'pass' ? 'Pass' : r.band === 'improve' ? 'Needs improvement' : r.band === 'fail' && r.status === 'finalized' ? 'Fail' : '') },
        { key: 'templates', label: 'Templates', value: (r) => r.profiles.map((p) => PROFILE_LABEL[p]).join(', ') },
        { key: 'number', label: 'Supplier number', value: (r) => r.vendorNumber, hidden: true },
        { key: 'updated', label: 'Updated', type: 'date', value: (r) => r.updatedAt.slice(0, 10), hidden: true },
    ];
    return (
        <div className='flex h-full min-h-0 flex-col'>
            <WindowCard data={data} />
            <div className='flex items-center gap-2 px-3 pb-2'>
                <Segmented label='Legal entities' value={scope} onChange={setScope} options={[{ value: 'mine', label: 'My legal entities', count: data.rows.filter((r) => r.mine).length }, { value: 'all', label: 'All', count: data.rows.length }]} />
                {busy && <Spinner />}
            </div>
            {failure && <div className='px-3 pb-2'><Alert tone='warn'>{failure}</Alert></div>}
            <div className='min-h-0 flex-1'>
                <RichTable<Row> id='prc.srm.window' title='Suppliers to evaluate' columns={columns} rows={rows} rowKey={(r) => r.key} onRowClick={open} empty='No suppliers selected for evaluation.' fileName='supplier-evaluation-window' height='h-full' />
            </div>
            {sheet}
        </div>
    );
}

function ResultsTab({ data }: { data: ListData }) {
    const columns: Array<Column<Hist>> = [
        { key: 'vendor', label: 'Supplier', value: (r) => r.vendorName },
        { key: 'score', label: 'Score', type: 'number', value: (r) => r.score, render: (r) => <span className='font-semibold' style={{ color: scoreColor(r.score) }}>{fmt(r.score)}</span> },
        { key: 'band', label: 'Band', value: (r) => (r.band === 'pass' ? 'Pass' : r.band === 'improve' ? 'Needs improvement' : 'Fail') },
        { key: 'sup', label: 'Supplier score', type: 'number', value: (r) => r.sub.SUPPLIER ?? null },
        { key: 'org', label: 'Organization score', type: 'number', value: (r) => r.sub.ORGANIZATION ?? null },
        { key: 'joint', label: 'Joint score', type: 'number', value: (r) => r.sub.BOTH ?? null },
        { key: 'le', label: 'Legal entity', value: (r) => r.legalEntityName },
        { key: 'window', label: 'Window', value: (r) => `${r.windowStart} to ${r.windowEnd}` },
        { key: 'number', label: 'Evaluation', value: (r) => r.number, hidden: true },
        { key: 'approved', label: 'Approved', type: 'date', value: (r) => r.approvedAt.slice(0, 10), hidden: true },
    ];
    return <RichTable<Hist> id='prc.srm.results' title='Final evaluations' columns={columns} rows={data.history} rowKey={(r) => r.id} onRowClick={(r) => navigate(`${BASE}/${r.vendorId}`)} empty='No final evaluations yet.' fileName='supplier-evaluation-results' height='h-full' />;
}

// =============================== Setup ===============================

interface TQ { id: string; text: string; accountability: Accountability; weight: number }
interface TC { id: string; name: string; weight: number; questions: TQ[] }
interface TP { id: ProfileId; name: string; scope: string; defaultFrequency: string; categories: TC[] }
interface Scope { kind: string; categoryCode: string; categoryName: string }
interface SetupData {
    templateLoaded: boolean; templateVersion: string; template: TP[];
    setup: { version: number; frequency: string; bands: Bands; window: { start: string; end: string } | null; eligible: Array<{ vendorId: string; scopes: Scope[] }>; adoption: Record<string, string[]>; updatedAt: string; updatedByName: string } | null;
    suggestedNext: { start: string; end: string } | null; suggestedFirst: { start: string; end: string };
    suppliers: Array<{ id: string; number: string; name: string; scopes: Scope[] }>; legalEntities: Array<{ id: string; name: string }>;
    frequencies: Array<{ value: string; label: string }>; can: { setup: boolean };
}

function Setup({ onSaved }: { onSaved: () => void }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<SetupData>(`${API}/setup/get`, {}), []);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'The setup could not be loaded.'}</Alert>;
    if (!data.templateLoaded) return <Alert tone='warn'>The supplier relationship evaluation template is not loaded yet. MEMS Admin loads it under Modules › Procurement.</Alert>;
    return <SetupForm key={data.setup?.version ?? 0} data={data} onSaved={() => { reload(); onSaved(); }} />;
}

function SetupForm({ data, onSaved }: { data: SetupData; onSaved: () => void }) {
    const s = data.setup;
    const allIds = (p: TP) => p.categories.flatMap((c) => c.questions.map((q) => q.id));
    const [section, setSection] = useState<'rules' | 'suppliers' | 'template'>('rules');
    const [frequency, setFrequency] = useState(s?.frequency ?? 'quarterly');
    const [bands, setBands] = useState({ improveFrom: String(s?.bands.improveFrom ?? 60), passFrom: String(s?.bands.passFrom ?? 75) });
    const [win, setWin] = useState(s?.window ?? data.suggestedFirst);
    const [eligible, setEligible] = useState<Record<string, Scope[]>>(() => Object.fromEntries((s?.eligible ?? []).map((e) => [e.vendorId, e.scopes])));
    const [adoption, setAdoption] = useState<Record<string, Set<string>>>(() => Object.fromEntries(data.template.map((p) => [p.id, new Set(s ? s.adoption[p.id] ?? [] : allIds(p))])));
    const [profile, setProfile] = useState<ProfileId>('MAT');
    const [q, setQ] = useState('');
    const [open, setOpen] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'warn'; text: string } | null>(null);
    const { ask, sheet } = useConfirm();
    const ro = !data.can.setup;

    const i = Number(bands.improveFrom), pf = Number(bands.passFrom);
    const bandErr = !(i > 0 && pf <= 100 && i < pf) ? 'Needs 0 < improve from < pass from ≤ 100' : '';
    const winErr = !win.start || !win.end || win.end < win.start ? 'The window must end on or after its start' : '';
    const chosen = Object.entries(eligible).filter(([, sc]) => sc.length);
    const problems = [
        ...(bandErr ? [bandErr] : []), ...(winErr ? [winErr] : []),
        ...(chosen.length ? [] : ['Select at least one supplier.']),
        ...(data.template.some((p) => adoption[p.id]?.size) ? [] : ['Adopt at least one question.']),
        ...chosen.flatMap(([vid, sc]) => [...new Set(sc.map((x) => KIND_PROFILE[x.kind]))].filter((p) => !adoption[p]?.size).map((p) => `${data.suppliers.find((v) => v.id === vid)?.name ?? vid}: nothing adopted from ${PROFILE_LABEL[p]}.`)),
    ];
    const save = () => {
        setNotice(null);
        if (problems.length) return setNotice({ tone: 'warn', text: problems.join(' ') });
        ask({ title: 'Save the evaluation setup?', message: `${data.frequencies.find((f) => f.value === frequency)?.label}; Fail below ${i}, Pass from ${pf}; window ${win.start} to ${win.end}; ${chosen.length} supplier(s). Evaluations already started keep the version they started with.`, confirmLabel: 'Save setup', reason: { label: 'Reason for the change', minLength: 10 } }, async (reason) => {
            setBusy(true);
            try {
                await callBackend(`${API}/setup/save`, { expectedVersion: s?.version ?? 0, frequency, bands: { improveFrom: i, passFrom: pf }, window: win, eligible: chosen.map(([vendorId, scopes]) => ({ vendorId, scopes })), adoption: Object.fromEntries(Object.entries(adoption).map(([k, v]) => [k, [...v]])), reason, confirm: true });
                setNotice({ tone: 'success', text: 'Setup saved.' });
                onSaved();
            } catch (e) {
                setNotice({ tone: 'error', text: messageOf(e) });
            } finally {
                setBusy(false);
            }
        });
    };

    const tp = data.template.find((p) => p.id === profile)!;
    const adoptedSet = adoption[profile] ?? new Set<string>();
    const adoptedTotal = tp.categories.reduce((t, c) => t + c.questions.filter((x) => adoptedSet.has(x.id)).reduce((a, x) => a + x.weight, 0), 0);
    const factor = adoptedTotal > 0 ? 100 / adoptedTotal : 0;
    const setSet = (fn: (set: Set<string>) => void) => setAdoption((a) => { const n = new Set(a[profile]); fn(n); return { ...a, [profile]: n }; });

    return (
        <div className='space-y-3'>
            <div className='flex flex-wrap items-center gap-2'>
                <Segmented label='Setup sections' value={section} onChange={setSection} options={[{ value: 'rules', label: 'Rules and window' }, { value: 'suppliers', label: 'Suppliers', count: chosen.length }, { value: 'template', label: 'Template' }]} />
                {!ro && <Button busy={busy} onClick={save} className='ml-auto'>Save setup</Button>}
            </div>
            {s ? <p className='text-xs text-muted'>Version {s.version} · saved by {s.updatedByName} {fmtDate(s.updatedAt)} · template {data.templateVersion}</p> : <Alert tone='info'>Not saved yet. Review the three sections and save.</Alert>}
            {ro && <Alert tone='info'>View only. Changes need the supplier evaluation administrator right.</Alert>}
            {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

            {section === 'rules' && (
                <div className='mx-auto max-w-2xl space-y-4'>
                    <SelectField label='How often suppliers are evaluated' value={frequency} disabled={ro} onChange={(e) => setFrequency(e.target.value)}>
                        {data.frequencies.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </SelectField>
                    <div className='rounded-2xl border border-line bg-panel p-4'>
                        <p className='text-sm font-semibold text-ink'>Performance bands (score out of 100)</p>
                        <div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2'>
                            <Field label='Needs improvement from' inputMode='decimal' value={bands.improveFrom} readOnly={ro} onChange={(e) => setBands({ ...bands, improveFrom: e.target.value })} hint={`Below ${i || '…'} is Fail`} error={bandErr || undefined} />
                            <Field label='Pass from' inputMode='decimal' value={bands.passFrom} readOnly={ro} onChange={(e) => setBands({ ...bands, passFrom: e.target.value })} hint={`${pf || '…'} and above is Pass`} />
                        </div>
                        {!bandErr && <div className='mt-4'><BandStrip improveFrom={i} passFrom={pf} /></div>}
                    </div>
                    <div className='rounded-2xl border border-line bg-panel p-4'>
                        <p className='text-sm font-semibold text-ink'>Evaluation window</p>
                        <p className='text-xs text-muted'>Evaluations are started and scored between these dates, for each legal entity.</p>
                        <div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2'>
                            <Field label='Opens' type='date' value={win.start} readOnly={ro} onChange={(e) => setWin({ ...win, start: e.target.value })} />
                            <Field label='Closes' type='date' value={win.end} min={win.start} readOnly={ro} onChange={(e) => setWin({ ...win, end: e.target.value })} error={winErr || undefined} />
                        </div>
                        {!ro && data.suggestedNext && (
                            <Button variant='secondary' className='mt-3 w-full' onClick={() => setWin(data.suggestedNext!)}>Set the next window: {data.suggestedNext.start} to {data.suggestedNext.end}</Button>
                        )}
                    </div>
                </div>
            )}

            {section === 'suppliers' && (
                <div className='space-y-2'>
                    <SearchField label='Search suppliers' value={q} onChange={(e) => setQ(e.target.value)} placeholder='Name or number' />
                    <p className='text-xs text-muted'>Tick a supplier, then the categories it is registered for that are evaluated. Materials use the materials template, services the services template, assets the assets and capital projects template.</p>
                    {data.suppliers.filter((v) => !q.trim() || `${v.name} ${v.number}`.toLowerCase().includes(q.trim().toLowerCase())).map((v) => {
                        const sel = eligible[v.id] ?? [];
                        const on = sel.length > 0;
                        return (
                            <div key={v.id} className={`rounded-2xl border p-3 ${on ? 'border-brand bg-brand/5' : 'border-line bg-panel'}`}>
                                <label className='flex min-h-[44px] cursor-pointer items-center gap-3'>
                                    <input type='checkbox' className='h-5 w-5 shrink-0' disabled={ro || !v.scopes.length} checked={on} onChange={(e) => setEligible((x) => ({ ...x, [v.id]: e.target.checked ? v.scopes : [] }))} />
                                    <span className='min-w-0 flex-1'>
                                        <span className='block truncate text-sm font-medium text-ink'>{v.name}</span>
                                        <span className='block text-xs text-muted'>{v.number} · {v.scopes.length ? `${v.scopes.length} categor${v.scopes.length === 1 ? 'y' : 'ies'}` : 'no categories registered'}</span>
                                    </span>
                                </label>
                                {on && (
                                    <div className='mt-2 flex flex-wrap gap-2'>
                                        {v.scopes.map((sc) => {
                                            const picked = sel.some((x) => x.kind === sc.kind && x.categoryCode === sc.categoryCode);
                                            return (
                                                <button key={`${sc.kind}${sc.categoryCode}`} type='button' disabled={ro} aria-pressed={picked} onClick={() => setEligible((x) => ({ ...x, [v.id]: picked ? sel.filter((y) => !(y.kind === sc.kind && y.categoryCode === sc.categoryCode)) : [...sel, sc] }))} className={`min-h-[44px] rounded-full border px-3 text-xs font-medium ${picked ? 'border-brand bg-brand text-onbrand' : 'border-line text-soft'}`}>
                                                    {PROFILE_LABEL[KIND_PROFILE[sc.kind]].split(' ')[0]} · {sc.categoryName}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {!data.suppliers.length && <p className='text-sm text-muted'>No approved suppliers yet.</p>}
                </div>
            )}

            {section === 'template' && (
                <div className='space-y-3'>
                    <Segmented label='Template' value={profile} onChange={(p) => { setProfile(p); setOpen(null); }} options={data.template.map((p) => ({ value: p.id, label: PROFILE_LABEL[p.id], count: adoption[p.id]?.size ?? 0 }))} />
                    <div className='rounded-2xl border border-line bg-panel p-3'>
                        <p className='text-sm text-soft'>{tp.scope}</p>
                        <div className='mt-2 flex items-center justify-between text-sm'>
                            <span className='text-muted'>{adoptedSet.size} of {allIds(tp).length} questions adopted</span>
                            <span className='font-semibold' style={{ color: adoptedSet.size ? scoreColor(100) : scoreColor(0) }}>{adoptedSet.size ? 'Weights total 100' : 'Nothing adopted'}</span>
                        </div>
                        {!ro && (
                            <div className='mt-2 flex gap-2'>
                                <Button variant='secondary' className='flex-1' onClick={() => setSet((x) => allIds(tp).forEach((id) => x.add(id)))}>Adopt all</Button>
                                <Button variant='secondary' className='flex-1' onClick={() => setSet((x) => x.clear())}>Clear</Button>
                            </div>
                        )}
                    </div>
                    {tp.categories.map((c) => {
                        const ids = c.questions.map((x) => x.id);
                        const n = ids.filter((id) => adoptedSet.has(id)).length;
                        const eff = c.questions.filter((x) => adoptedSet.has(x.id)).reduce((a, x) => a + x.weight, 0) * factor;
                        const expanded = open === c.id;
                        return (
                            <div key={c.id} className='overflow-hidden rounded-2xl border border-line bg-panel'>
                                <div className='flex items-center gap-3 p-3'>
                                    <input type='checkbox' aria-label={`Adopt ${c.name}`} className='h-5 w-5 shrink-0' disabled={ro} checked={n === ids.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < ids.length; }} onChange={(e) => setSet((x) => ids.forEach((id) => (e.target.checked ? x.add(id) : x.delete(id))))} />
                                    <button type='button' className='flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left' onClick={() => setOpen(expanded ? null : c.id)} aria-expanded={expanded}>
                                        <span className='min-w-0 flex-1'>
                                            <span className='block text-sm font-medium text-ink'>{c.name}</span>
                                            <span className='block text-xs text-muted'>{n}/{ids.length} questions · template {c.weight} → <strong className='text-ink'>{fmt(eff, 2)}</strong> points</span>
                                        </span>
                                        <ChevronRight className={`h-5 w-5 shrink-0 text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
                                    </button>
                                </div>
                                {expanded && (
                                    <div className='border-t border-line'>
                                        {c.questions.map((x) => {
                                            const on = adoptedSet.has(x.id);
                                            return (
                                                <label key={x.id} className='flex cursor-pointer items-start gap-3 border-b border-line/60 px-3 py-3 last:border-0'>
                                                    <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0' disabled={ro} checked={on} onChange={(e) => setSet((set) => (e.target.checked ? set.add(x.id) : set.delete(x.id)))} />
                                                    <span className='min-w-0 flex-1 text-sm'>
                                                        <span className='block text-ink'>{x.text}</span>
                                                        <span className='mt-1 flex flex-wrap items-center gap-2 text-xs text-muted'>
                                                            <span className='font-mono'>{x.id}</span>
                                                            <AccChip a={x.accountability} />
                                                            <span>{x.weight} → {on ? <strong className='text-ink'>{fmt(x.weight * factor, 2)}</strong> : '0'} points</span>
                                                        </span>
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            {sheet}
        </div>
    );
}

function AccChip({ a }: { a: Accountability }) {
    const hue = a === 'SUPPLIER' ? 210 : a === 'ORGANIZATION' ? 280 : 30;
    return <span className='rounded-full px-2 py-0.5 text-xs font-medium' style={{ background: `hsla(${hue}, 70%, 50%, 0.14)`, color: `hsl(${hue}, 60%, 45%)` }}>{ACCOUNTABILITY_LABEL[a]}</span>;
}

// =============================== Scorecard ===============================

interface Action { id: string; profile: string; questionId: string; question: string; description: string; accountability: Accountability; owner: string; dueDate: string; status: string; evidence?: string; doneByName?: string; verifiedByName?: string; createdByName: string; createdAt: string }
interface Evaluation {
    id: string; number: string; status: string; windowStart: string; windowEnd: string; legalEntityName: string; vendorId: string; vendorNumber: string; vendorName: string;
    scopes: Scope[]; scorecards: Profile[]; answers: Record<string, Answer>; actions: Action[]; bands: Bands; history: Array<{ at: string; byName: string; action: string; note: string }>;
    createdByName: string; submittedByName: string; approvedByName: string; returnReason: string; version: number;
    can: { answer: boolean; submit: boolean; cancel: boolean; actions: boolean; approve: boolean; approveWhy: string; verify: boolean };
}

function Scorecard({ id }: { id: string }) {
    const [ev, setEv] = useState<Evaluation | null>(null);
    const [error, setError] = useState('');
    const [profile, setProfile] = useState<ProfileId | 'actions' | 'history' | null>(null);
    const [category, setCategory] = useState<string | null>(null);
    const [note, setNote] = useState<{ tone: 'success' | 'error' | 'warn'; text: string } | null>(null);
    const [info, setInfo] = useState<Profile['categories'][number]['questions'][number] | null>(null);
    const [actionFor, setActionFor] = useState<{ profile: string; questionId: string; text: string } | null>(null);
    const [menu, setMenu] = useState(false);
    const [live, setLive] = useState(true);
    const pending = useRef(0);
    const verRef = useRef(0);
    const { ask, sheet } = useConfirm();

    const load = useCallback(async (force = false) => {
        try {
            const r = await callBackend<{ unchanged: boolean; version: number; evaluation?: Evaluation }>(`${API}/evaluations/get`, { id, knownVersion: force ? 0 : verRef.current });
            setLive(true);
            if (r.unchanged || !r.evaluation || pending.current > 0) return;
            verRef.current = r.evaluation.version;
            setEv(r.evaluation);
            setProfile((p) => p ?? (r.evaluation!.scorecards[0]?.id as ProfileId) ?? 'actions');
        } catch (e) {
            if (!verRef.current) setError(messageOf(e));
            setLive(false);
        }
    }, [id]);
    useEffect(() => { void load(true); }, [load]);
    usePoll(() => void load(), 4000);

    const scores = useMemo(() => {
        if (!ev) return null;
        const cards = ev.scorecards.map((c) => scoreCard(c, ev.answers));
        return { cards, overall: overallOf(cards) };
    }, [ev]);

    if (error && !ev) return <Alert tone='error'>{error}</Alert>;
    if (!ev || !scores) return <Spinner />;
    const bands = { improveFrom: Number(ev.bands.improveFrom) || 60, passFrom: Number(ev.bands.passFrom) || 75 };
    const card = ev.scorecards.find((c) => c.id === profile);
    const cardScore = scores.cards.find((c) => c.profile === profile);
    const cat = card?.categories.find((c) => c.id === category);
    const catScore = cardScore?.categories.find((c) => c.id === category);

    // One tap: optimistic, then confirmed by the server (which refuses if someone else changed it meanwhile).
    const tap = async (p: string, qid: string, findingText?: string) => {
        if (!ev.can.answer) return;
        const key = answerKey(p, qid);
        const cur = ev.answers[key]?.state ?? 'unassessed';
        const next: AnswerState = findingText !== undefined ? cur : nextState(cur);
        const answers = { ...ev.answers };
        if (next === 'unassessed') delete answers[key];
        else answers[key] = { ...answers[key], state: next, note: findingText ?? answers[key]?.note ?? '' };
        setEv({ ...ev, answers });
        pending.current++;
        try {
            const r = await callBackend<{ version: number }>(`${API}/evaluations/answer`, { id, profile: p, questionId: qid, state: next, note: findingText ?? '', expected: cur });
            verRef.current = r.version - 1; // fetch the confirmed copy on the next tick
        } catch (e) {
            setNote({ tone: 'error', text: messageOf(e) });
            verRef.current = 0;
        } finally {
            pending.current--;
            if (pending.current === 0) void load(true);
        }
    };

    const actions: Array<{ key: string; label: string; run: () => void; danger?: boolean }> = [];
    if (ev.can.submit) actions.push({ key: 'submit', label: 'Submit for approval', run: () => ask({ title: 'Submit the evaluation?', message: `Overall ${fmt(scores.overall.score)} out of 100. Every question must be assessed and every "not OK" needs its finding.`, confirmLabel: 'Submit', acknowledge: 'Every answer is backed by evidence.' }, async () => { await callBackend(`${API}/evaluations/submit`, { id, acknowledge: true }); setNote({ tone: 'success', text: 'Submitted for approval.' }); void load(true); }) });
    if (ev.can.approve) {
        actions.push({ key: 'approve', label: 'Approve and finalize', run: () => ask({ title: 'Approve and finalize?', message: `${ev.vendorName}: ${fmt(scores.overall.score)} out of 100. This becomes the supplier's SRM score used in quotation analysis.`, confirmLabel: 'Approve', acknowledge: 'I reviewed the answers, findings and actions.' }, async () => { await callBackend(`${API}/evaluations/approve`, { id, acknowledge: true }); setNote({ tone: 'success', text: 'Finalized.' }); void load(true); }) });
        actions.push({ key: 'return', label: 'Return for correction', run: () => ask({ title: 'Return the evaluation?', message: 'It goes back to the evaluators with your reason.', confirmLabel: 'Return', reason: { label: 'Reason', minLength: 20 } }, async (reason) => { await callBackend(`${API}/evaluations/return`, { id, reason }); setNote({ tone: 'success', text: 'Returned.' }); void load(true); }) });
    }
    if (ev.can.cancel) actions.push({ key: 'cancel', label: 'Cancel the evaluation', danger: true, run: () => ask({ title: 'Cancel the evaluation?', message: 'A cancelled evaluation can be started again in the same window.', confirmLabel: 'Cancel evaluation', tone: 'danger', reason: { label: 'Reason', minLength: 20 } }, async (reason) => { await callBackend(`${API}/evaluations/cancel`, { id, reason }); setNote({ tone: 'success', text: 'Cancelled.' }); void load(true); }) });
    actions.push({ key: 'dashboard', label: 'Supplier dashboard', run: () => navigate(`${BASE}/${ev.vendorId}`) });
    const primary = actions.find((x) => ['approve', 'submit'].includes(x.key));
    const openActions = ev.actions.filter((a) => a.status === 'open').length;

    return (
        <Screen
            eyebrow={`${ev.number} · ${ev.legalEntityName}`}
            title={ev.vendorName}
            subtitle={`Window ${ev.windowStart} to ${ev.windowEnd} · ${STATUS[ev.status] ?? ev.status}`}
            onBack={() => (category ? setCategory(null) : navigate(BASE))}
            actions={
                <>
                    <span className='flex items-center gap-1 text-xs text-muted' title={live ? 'Live' : 'Offline'}><span className='h-2 w-2 rounded-full' style={{ background: live ? scoreColor(100) : scoreColor(0) }} />{live ? 'Live' : 'Offline'}</span>
                    {primary && <Button onClick={primary.run}>{primary.key === 'submit' ? <Send className='h-4 w-4' /> : null}{primary.key === 'submit' ? 'Submit' : 'Approve'}</Button>}
                    <button type='button' aria-label='More actions' onClick={() => setMenu(true)} className='flex h-11 w-11 items-center justify-center rounded-xl border border-line text-soft active:bg-panel'><MoreVertical className='h-5 w-5' /></button>
                </>
            }
            toolbar={!category ? <Segmented label='Scorecards' value={(profile ?? 'actions') as string} onChange={(v) => { setProfile(v as ProfileId); setCategory(null); }} options={[...ev.scorecards.map((c) => ({ value: c.id as string, label: PROFILE_LABEL[c.id] })), { value: 'actions', label: 'Actions', count: openActions || undefined }, { value: 'history', label: 'History' }]} /> : undefined}
        >
            {note && <Alert tone={note.tone}>{note.text}</Alert>}
            {ev.returnReason && ['returned', 'in_progress'].includes(ev.status) && <Alert tone='warn'>Returned: {ev.returnReason}</Alert>}
            {ev.can.approveWhy && <Alert tone='info'>{ev.can.approveWhy}</Alert>}

            {!category && card && cardScore && (
                <div className='space-y-3'>
                    <div className='rounded-2xl border border-line bg-panel p-4'>
                        <div className='grid grid-cols-1 items-center gap-2 sm:grid-cols-2'>
                            <div>
                                <ScoreGauge score={cardScore.score} coverage={cardScore.coverage} bands={bands} label={PROFILE_LABEL[card.id]} />
                                <div className='mt-1 flex justify-center'><BandChip score={cardScore.score} bands={bands} /></div>
                            </div>
                            <div className='space-y-3'>
                                <div className='grid grid-cols-3 gap-1'>
                                    {ACCOUNTABILITY.map((a) => <Ring key={a} pct={cardScore.sub[a].pct} label={ACCOUNTABILITY_LABEL[a]} />)}
                                </div>
                                <div className='grid grid-cols-3 gap-2 text-center'>
                                    <Count icon={<CheckCircle2 className='h-4 w-4' />} n={cardScore.ok} label='OK' tone={100} />
                                    <Count icon={<XCircle className='h-4 w-4' />} n={cardScore.notOk} label='Not OK' tone={0} />
                                    <Count icon={<Circle className='h-4 w-4' />} n={cardScore.open} label='Open' tone={null} />
                                </div>
                                {ev.scorecards.length > 1 && (
                                    <p className='text-center text-xs text-muted'>Overall across {ev.scorecards.length} scorecards: <strong style={{ color: scoreColor(scores.overall.score) }}>{fmt(scores.overall.score)}</strong></p>
                                )}
                            </div>
                        </div>
                    </div>
                    <p className='px-1 text-xs text-muted'>Scope: {ev.scopes.filter((s) => KIND_PROFILE[s.kind] === card.id).map((s) => s.categoryName).join(', ')}</p>
                    {card.categories.map((c) => {
                        const cs = cardScore.categories.find((x) => x.id === c.id)!;
                        return (
                            <button key={c.id} type='button' onClick={() => setCategory(c.id)} className='w-full rounded-2xl border border-line bg-panel p-3 text-left active:bg-page'>
                                <div className='flex items-center gap-3'>
                                    <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold' style={{ background: scoreColor(cs.pct, 0.14), color: scoreColor(cs.pct) }}>{cs.pct === null ? '—' : Math.round(cs.pct)}</div>
                                    <div className='min-w-0 flex-1'>
                                        <p className='text-sm font-medium text-ink'>{c.name}</p>
                                        <p className='text-xs text-muted'>{fmt(cs.earned, 2)} of {fmt(cs.weight, 2)} points · {cs.ok} OK · {cs.notOk} not OK · {cs.open} open</p>
                                        <div className='mt-1.5'><ScoreBar pct={cs.assessed > 0 ? (cs.earned / cs.weight) * 100 : null} height={6} /></div>
                                    </div>
                                    <ChevronRight className='h-5 w-5 shrink-0 text-muted' />
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            {category && card && cat && catScore && (
                <div className='space-y-2'>
                    <button type='button' onClick={() => setCategory(null)} className='flex min-h-[44px] items-center gap-1 text-sm text-soft'><ChevronLeft className='h-4 w-4' />{PROFILE_LABEL[card.id]}</button>
                    <div className='sticky top-0 z-10 rounded-2xl border border-line bg-panel p-3 shadow-sm'>
                        <div className='flex items-center justify-between gap-2'>
                            <p className='min-w-0 text-sm font-semibold text-ink'>{cat.name}</p>
                            <span className='shrink-0 text-lg font-bold' style={{ color: scoreColor(catScore.pct) }}>{catScore.pct === null ? '—' : `${Math.round(catScore.pct)}%`}</span>
                        </div>
                        <div className='mt-1.5'><ScoreBar pct={catScore.assessed > 0 ? (catScore.earned / catScore.weight) * 100 : null} /></div>
                        <p className='mt-1 text-xs text-muted'>Card score {fmt(cardScore!.score)} / 100 · tap a question: not assessed → OK → not OK</p>
                    </div>
                    {cat.questions.map((x) => {
                        const a = ev.answers[answerKey(card.id, x.id)];
                        const st = a?.state ?? 'unassessed';
                        const qActions = ev.actions.filter((y) => y.profile === card.id && y.questionId === x.id);
                        return (
                            <div key={x.id} className='rounded-2xl border border-line p-3 transition-colors duration-300' style={answerStyle(st)}>
                                <div className='flex items-start gap-2'>
                                    <button type='button' disabled={!ev.can.answer} onClick={() => void tap(card.id, x.id)} className='min-h-[56px] min-w-0 flex-1 text-left disabled:cursor-default' aria-label={`${x.id}: ${st === 'ok' ? 'OK' : st === 'not_ok' ? 'not OK' : 'not assessed'}. Tap to change.`}>
                                        <p className='text-sm text-ink'>{x.text}</p>
                                        <p className='mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted'>
                                            <span className='font-mono'>{x.id}</span><AccChip a={x.accountability} /><span>{fmt(x.weight, 2)} pts</span>
                                            <span className='font-semibold' style={{ color: st === 'ok' ? scoreColor(100) : st === 'not_ok' ? scoreColor(0) : undefined }}>{st === 'ok' ? 'OK' : st === 'not_ok' ? 'Not OK' : 'Not assessed'}</span>
                                            {a?.byName && <span>· {a.byName}</span>}
                                        </p>
                                    </button>
                                    <button type='button' aria-label='How to measure' onClick={() => setInfo(x)} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted active:bg-page'><Info className='h-5 w-5' /></button>
                                </div>
                                {st === 'not_ok' && (
                                    <Finding key={`${x.id}-${a?.note ?? ''}`} initial={a?.note ?? ''} readOnly={!ev.can.answer} onSave={(t) => void tap(card.id, x.id, t)} />
                                )}
                                {st === 'not_ok' && (
                                    <div className='mt-2 flex flex-wrap items-center gap-2'>
                                        {qActions.map((y) => <span key={y.id} className='rounded-full bg-page px-2 py-1 text-xs text-soft'>Action · {y.owner} · {y.status}</span>)}
                                        {ev.can.actions && <Button variant='secondary' onClick={() => setActionFor({ profile: card.id, questionId: x.id, text: x.text })}><ListChecks className='h-4 w-4' />Raise action</Button>}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {!category && profile === 'actions' && <ActionsPanel ev={ev} ask={ask} onDone={(t) => { setNote({ tone: 'success', text: t }); void load(true); }} />}
            {!category && profile === 'history' && (
                <div className='space-y-2'>
                    {ev.history.map((h, i) => (
                        <div key={`${h.at}${i}`} className='rounded-xl border border-line bg-panel p-3 text-sm'>
                            <p className='font-medium text-ink'>{h.action}</p>
                            <p className='text-xs text-muted'>{h.byName} · {fmtDate(h.at)}</p>
                            {h.note && <p className='mt-1 text-soft'>{h.note}</p>}
                        </div>
                    ))}
                </div>
            )}

            {menu && (
                <Sheet title='Actions' onClose={() => setMenu(false)}>
                    {actions.map((x) => (
                        <button key={x.key} type='button' onClick={() => { setMenu(false); x.run(); }} className={`flex min-h-12 w-full items-center rounded-xl border border-line px-3 text-left text-sm font-medium ${x.danger ? 'text-red-400' : 'text-ink'} active:bg-page`}>{x.label}</button>
                    ))}
                </Sheet>
            )}
            {info && (
                <Sheet title={info.id} onClose={() => setInfo(null)}>
                    <p className='text-sm text-ink'>{info.text}</p>
                    <div className='flex flex-wrap gap-2 text-xs'><AccChip a={info.accountability} /><span className='text-muted'>{fmt(info.weight, 2)} points</span>{info.critical && <span className='font-semibold' style={{ color: scoreColor(0) }}>Critical control</span>}</div>
                    {info.measurement && <div><p className='text-xs font-semibold text-muted'>How it is measured</p><p className='text-sm text-soft'>{info.measurement}</p></div>}
                    {info.evidence.length > 0 && <div><p className='text-xs font-semibold text-muted'>Evidence</p><p className='text-sm text-soft'>{info.evidence.join(', ')}</p></div>}
                </Sheet>
            )}
            {actionFor && <ActionSheet evId={id} target={actionFor} onClose={() => setActionFor(null)} onDone={(t) => { setActionFor(null); setNote({ tone: 'success', text: t }); void load(true); }} />}
            {sheet}
        </Screen>
    );
}

function Count({ icon, n, label, tone }: { icon: ReactNode; n: number; label: string; tone: number | null }) {
    return (
        <div className='rounded-xl bg-page py-2'>
            <p className='flex items-center justify-center gap-1 text-lg font-semibold' style={{ color: tone === null ? undefined : scoreColor(tone) }}>{icon}{n}</p>
            <p className='text-xs text-muted'>{label}</p>
        </div>
    );
}

function Finding({ initial, readOnly, onSave }: { initial: string; readOnly: boolean; onSave: (t: string) => void }) {
    const [t, setT] = useState(initial);
    const short = t.trim().length < 10;
    return (
        <div className='mt-2'>
            <TextArea label='Finding (required for not OK)' value={t} readOnly={readOnly} maxLength={600} onChange={(e) => setT(e.target.value)} onBlur={() => { if (!readOnly && t !== initial && !short) onSave(t.trim()); }} error={!readOnly && short ? 'At least 10 characters' : undefined} hint={!readOnly ? 'Saved when you leave the box' : undefined} />
        </div>
    );
}

function ActionSheet({ evId, target, onClose, onDone }: { evId: string; target: { profile: string; questionId: string; text: string }; onClose: () => void; onDone: (t: string) => void }) {
    const [f, setF] = useState({ description: '', owner: '', accountability: 'SUPPLIER', dueDate: '' });
    const [tried, setTried] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const errs = { description: f.description.trim().length < 10 ? 'At least 10 characters' : '', owner: f.owner.trim().length < 2 ? 'Name the owner' : '', dueDate: !f.dueDate || f.dueDate < today() ? 'Today or later' : '' };
    const save = async () => {
        setTried(true);
        if (Object.values(errs).some(Boolean)) return;
        setBusy(true);
        try {
            await callBackend(`${API}/actions/add`, { id: evId, ...target, ...f });
            onDone('Action raised.');
        } catch (e) {
            setFailure(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Sheet title={`Action on ${target.questionId}`} onClose={onClose} footer={<Button className='flex-1' busy={busy} onClick={() => void save()}>Raise action</Button>}>
            <p className='text-sm text-soft'>{target.text}</p>
            <TextArea label='What must be done' value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} error={tried ? errs.description || undefined : undefined} />
            <SelectField label='Accountable' value={f.accountability} onChange={(e) => setF({ ...f, accountability: e.target.value })}>
                {ACCOUNTABILITY.map((a) => <option key={a} value={a}>{ACCOUNTABILITY_LABEL[a]}</option>)}
            </SelectField>
            <Field label='Owner (name)' value={f.owner} maxLength={120} onChange={(e) => setF({ ...f, owner: e.target.value })} error={tried ? errs.owner || undefined : undefined} />
            <Field label='Due date' type='date' min={today()} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} error={tried ? errs.dueDate || undefined : undefined} />
            {failure && <Alert tone='error'>{failure}</Alert>}
        </Sheet>
    );
}

function ActionsPanel({ ev, ask, onDone }: { ev: Evaluation; ask: ReturnType<typeof useConfirm>['ask']; onDone: (t: string) => void }) {
    const step = (a: Action, s: 'done' | 'verify' | 'reopen') =>
        ask({ title: s === 'done' ? 'Mark the action done?' : s === 'verify' ? 'Verify the action?' : 'Reopen the action?', message: a.description, confirmLabel: s === 'done' ? 'Mark done' : s === 'verify' ? 'Verify' : 'Reopen', reason: { label: s === 'done' ? 'Evidence of completion' : s === 'verify' ? 'How it was verified' : 'Why it is not effective', minLength: 10 } }, async (note) => {
            await callBackend(`${API}/actions/update`, { id: ev.id, actionId: a.id, step: s, note });
            onDone(s === 'done' ? 'Action marked done.' : s === 'verify' ? 'Action verified.' : 'Action reopened.');
        });
    if (!ev.actions.length) return <p className='text-sm text-muted'>No actions yet. Raise one on any question marked not OK.</p>;
    return (
        <div className='space-y-2'>
            {ev.actions.map((a) => {
                const late = a.status === 'open' && a.dueDate < today();
                return (
                    <div key={a.id} className='rounded-2xl border border-line bg-panel p-3'>
                        <div className='flex items-start justify-between gap-2'>
                            <p className='min-w-0 text-sm font-medium text-ink'>{a.description}</p>
                            <Badge tone={a.status === 'verified' ? 'brand' : late ? 'danger' : a.status === 'done' ? 'warn' : 'muted'}>{late ? 'Overdue' : a.status === 'open' ? 'Open' : a.status === 'done' ? 'Done' : 'Verified'}</Badge>
                        </div>
                        <p className='mt-1 text-xs text-muted'>{a.questionId} · <AccChip a={a.accountability} /> · {a.owner} · due {a.dueDate}</p>
                        {a.evidence && <p className='mt-1 text-xs text-soft'>Evidence: {a.evidence}</p>}
                        <div className='mt-2 flex flex-wrap gap-2'>
                            {a.status === 'open' && ev.can.actions && <Button variant='secondary' onClick={() => step(a, 'done')}>Mark done</Button>}
                            {a.status === 'done' && ev.can.verify && <Button variant='secondary' onClick={() => step(a, 'verify')}>Verify</Button>}
                            {a.status === 'done' && ev.can.verify && <Button variant='secondary' onClick={() => step(a, 'reopen')}>Reopen</Button>}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// =============================== Supplier dashboard ===============================

interface Dash {
    vendor: { id: string; number: string; name: string; srmScore: number | null }; bands: Bands; eligible: boolean;
    last: { id: string; number: string; score: number; band: string; sub: Record<string, number | null>; windowStart: string; windowEnd: string; legalEntityName: string } | null;
    trend: Array<{ id: string; windowStart: string; windowEnd: string; score: number; legalEntityName: string }>;
    lastCard: Record<string, { score: number; previous: number | null; at: string; sub: Record<string, { pct: number | null }> }>;
    lastCategory: Record<string, Array<{ id: string; name: string; pct: number | null; previous: number | null; earned: number; weight: number }>>;
    procurementCategories: Array<{ kind: string; categoryCode: string; categoryName: string; score: number | null; at: string }>;
    current: Array<{ id: string; number: string; legalEntityName: string; status: string; score: number; coverage: number }>;
    actions: Array<Action & { evaluationId: string; evaluationNumber: string; legalEntityName: string; overdue: boolean }>;
    actionCounts: { open: number; overdue: number; done: number; verified: number };
    stamp: string;
}

function SupplierDashboardScreen({ vendorId }: { vendorId: string }) {
    return (
        <Screen title='Supplier evaluation dashboard' onBack={() => navigate(BASE)}>
            <SupplierRelationshipDashboard vendorId={vendorId} />
        </Screen>
    );
}

/** Last scores, trends and action follow-up for one supplier. Also shown on the supplier's page. */
export function SupplierRelationshipDashboard({ vendorId }: { vendorId: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<Dash>(`${API}/dashboard`, { vendorId }), [vendorId]);
    const stamp = useRef('');
    useEffect(() => { if (data) stamp.current = data.stamp; }, [data]);
    usePoll(async () => {
        try {
            const r = await callBackend<Dash>(`${API}/dashboard`, { vendorId });
            if (r.stamp !== stamp.current) reload();
        } catch { /* keep the last view */ }
    }, 20000);
    const [p, setP] = useState<string>('');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'The dashboard could not be loaded.'}</Alert>;
    const profiles = Object.keys(data.lastCard) as ProfileId[];
    const sel = (p && data.lastCard[p] ? p : profiles[0]) as ProfileId | undefined;
    const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
    const actionColumns: Array<Column<Dash['actions'][number]>> = [
        { key: 'desc', label: 'Action', value: (a) => a.description },
        { key: 'status', label: 'Status', value: (a) => (a.overdue ? 'Overdue' : a.status), render: (a) => <Badge tone={a.status === 'verified' ? 'brand' : a.overdue ? 'danger' : a.status === 'done' ? 'warn' : 'muted'}>{a.overdue ? 'Overdue' : a.status === 'open' ? 'Open' : a.status === 'done' ? 'Done' : 'Verified'}</Badge> },
        { key: 'due', label: 'Due', type: 'date', value: (a) => a.dueDate },
        { key: 'owner', label: 'Owner', value: (a) => a.owner },
        { key: 'acc', label: 'Accountable', value: (a) => ACCOUNTABILITY_LABEL[a.accountability] ?? a.accountability },
        { key: 'q', label: 'Question', value: (a) => a.questionId },
        { key: 'le', label: 'Legal entity', value: (a) => a.legalEntityName, hidden: true },
        { key: 'eval', label: 'Evaluation', value: (a) => a.evaluationNumber, hidden: true },
    ];
    return (
        <div className='space-y-3'>
            <div className='rounded-2xl border border-line bg-panel p-4'>
                <p className='text-xs uppercase tracking-wide text-muted'>{data.vendor.number}</p>
                <p className='text-base font-semibold text-ink'>{data.vendor.name}</p>
                {!data.last ? (
                    <Alert tone='info'>{data.eligible ? 'No final evaluation yet. Scores appear here once an evaluation is approved.' : 'This supplier is not selected for evaluation.'}</Alert>
                ) : (
                    <div className='mt-2 grid grid-cols-1 items-center gap-3 sm:grid-cols-2'>
                        <div>
                            <ScoreGauge score={data.last.score} bands={data.bands} label='Latest overall score' caption={`${data.last.legalEntityName} · ${data.last.windowStart} to ${data.last.windowEnd}`} />
                            <div className='mt-1 flex items-center justify-center gap-2'>
                                <BandChip score={data.last.score} bands={data.bands} />
                                {(() => { const prev = data.trend[data.trend.length - 2]; const d = prev ? data.last!.score - prev.score : null; return d === null ? null : <span className='text-xs font-semibold' style={{ color: scoreColor(d >= 0 ? 100 : 0) }}>{d >= 0 ? '▲' : '▼'} {fmt(Math.abs(d))} vs previous</span>; })()}
                            </div>
                        </div>
                        <div className='space-y-3'>
                            <div className='grid grid-cols-3 gap-1'>{ACCOUNTABILITY.map((a) => <Ring key={a} pct={data.last!.sub[a] ?? null} label={ACCOUNTABILITY_LABEL[a]} />)}</div>
                            <div className='grid grid-cols-4 gap-2 text-center'>
                                <Count icon={<ListChecks className='h-4 w-4' />} n={data.actionCounts.open} label='Open' tone={null} />
                                <Count icon={<AlertTriangle className='h-4 w-4' />} n={data.actionCounts.overdue} label='Overdue' tone={data.actionCounts.overdue ? 0 : null} />
                                <Count icon={<Circle className='h-4 w-4' />} n={data.actionCounts.done} label='Done' tone={50} />
                                <Count icon={<CheckCircle2 className='h-4 w-4' />} n={data.actionCounts.verified} label='Verified' tone={100} />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {data.current.length > 0 && (
                <div className='rounded-2xl border border-line bg-panel p-3'>
                    <p className='text-sm font-semibold text-ink'>Current window</p>
                    {data.current.map((c) => (
                        <button key={c.id} type='button' onClick={() => navigate(`${BASE}/${c.id}`)} className='mt-2 flex min-h-[44px] w-full items-center gap-3 text-left'>
                            <span className='min-w-0 flex-1 text-sm text-soft'>{c.legalEntityName} · {STATUS[c.status] ?? c.status} · {fmt(c.coverage, 0)}% assessed</span>
                            <span className='font-semibold' style={{ color: scoreColor(c.score) }}>{fmt(c.score)}</span>
                            <ChevronRight className='h-4 w-4 text-muted' />
                        </button>
                    ))}
                </div>
            )}

            {data.trend.length > 0 && (
                <div className='rounded-2xl border border-line bg-panel p-3'>
                    <p className='text-sm font-semibold text-ink'>Trend</p>
                    <TrendChart points={data.trend.map((t) => ({ label: t.windowEnd.slice(2, 7), score: t.score }))} bands={data.bands} />
                </div>
            )}

            {sel && (
                <div className='rounded-2xl border border-line bg-panel p-3'>
                    <div className='mb-2 flex flex-wrap items-center justify-between gap-2'>
                        <p className='text-sm font-semibold text-ink'>Last score by category</p>
                        {profiles.length > 1 && <Segmented label='Template' value={sel} onChange={(x) => setP(x)} options={profiles.map((x) => ({ value: x, label: PROFILE_LABEL[x].split(' ')[0] }))} />}
                    </div>
                    <p className='mb-2 text-xs text-muted'>{PROFILE_LABEL[sel]}: <strong style={{ color: scoreColor(data.lastCard[sel].score) }}>{fmt(data.lastCard[sel].score)}</strong>{data.lastCard[sel].previous !== null && ` (previous ${fmt(data.lastCard[sel].previous)})`}</p>
                    <div className='space-y-2.5'>
                        {(data.lastCategory[sel] ?? []).map((c) => {
                            const d = delta(c.pct, c.previous);
                            return (
                                <div key={c.id}>
                                    <div className='flex items-center justify-between gap-2 text-sm'>
                                        <span className='min-w-0 truncate text-soft'>{c.name}</span>
                                        <span className='shrink-0 font-semibold' style={{ color: scoreColor(c.pct) }}>{c.pct === null ? '—' : `${Math.round(c.pct)}%`}{d !== null && d !== 0 && <span className='ml-1 text-xs' style={{ color: scoreColor(d > 0 ? 100 : 0) }}>{d > 0 ? '▲' : '▼'}{Math.abs(Math.round(d))}</span>}</span>
                                    </div>
                                    <ScoreBar pct={c.pct} height={6} />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {data.procurementCategories.length > 0 && (
                <div className='rounded-2xl border border-line bg-panel p-3'>
                    <p className='text-sm font-semibold text-ink'>Procurement categories</p>
                    <div className='mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2'>
                        {data.procurementCategories.map((c) => (
                            <div key={`${c.kind}${c.categoryCode}`} className='flex items-center gap-3 rounded-xl bg-page p-2'>
                                <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold' style={{ background: scoreColor(c.score, 0.14), color: scoreColor(c.score) }}>{c.score === null ? '—' : Math.round(c.score)}</div>
                                <div className='min-w-0'><p className='truncate text-sm text-ink'>{c.categoryName}</p><p className='text-xs text-muted'>{PROFILE_LABEL[KIND_PROFILE[c.kind]]} · {c.at}</p></div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className='h-[420px] overflow-hidden rounded-2xl border border-line'>
                <RichTable id='prc.srm.vendor.actions' title='Action follow-up' columns={actionColumns} rows={data.actions} rowKey={(a) => `${a.evaluationId}-${a.id}`} onRowClick={(a) => navigate(`${BASE}/${a.evaluationId}`)} rowClassName={(a) => (a.overdue ? 'text-red-400' : '')} empty='No improvement actions.' fileName={`${data.vendor.number}-srm-actions`} height='h-full' />
            </div>
        </div>
    );
}

