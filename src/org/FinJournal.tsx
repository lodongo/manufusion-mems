import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Loader2, Table2, Rows3 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Screen } from '../components/screen';
import { Amount, Card, FIN_API, FinScreen, Facts, Legend, Pill, SIDE, errText, fmt, go, useEntity, type Entity } from './finKit';

// THE journal of a legal entity. Read only: entries are made by system events and approvals, never typed, edited,
// deleted or uploaded. Debits are sky blue, credits amber. It opens on the current period and loads earlier periods
// as the person scrolls (only the list scrolls; the action bar stays on top). Tapping an entry shows every line and the
// trail back to the document that caused it.

interface Line {
    no: number;
    side: 'D' | 'C';
    glCode: string;
    glName: string;
    ccId: string;
    ccCode: string;
    ccName: string;
    amount: number;
    description: string;
    qty: number | null;
}
interface Entry {
    id: string;
    postingDate: string;
    type: string;
    typeLabel: string;
    narrative: string;
    currency: string;
    totalDebit: number;
    source: { kind?: string; id?: string; ref?: string; route?: string };
    postedByName: string;
    approvalRef: string;
    partial: boolean;
    lines: Line[];
}
interface Page {
    period: { fy: number; no: number; name: string; label: string; status: string; start: string; end: string };
    prev: { fy: number; no: number; name: string; label: string } | null;
    entries: Entry[];
    partial: boolean;
}

function EntryCard({ e }: { e: Entry }) {
    return (
        <button type='button' onClick={() => go(`fin_journal/${e.id}`)} className='w-full space-y-1 rounded-xl border border-line bg-panel p-3 text-left active:bg-page'>
            <div className='flex items-center gap-2'>
                <span className='font-mono text-xs text-brand'>{e.id}</span>
                <span className='text-xs text-muted'>{e.postingDate}</span>
                <span className='ml-auto font-mono text-sm text-ink'>
                    {e.currency} {fmt(e.totalDebit)}
                </span>
            </div>
            <p className='truncate text-sm font-medium text-ink'>{e.typeLabel}</p>
            <p className='truncate text-xs text-soft'>{e.narrative}</p>
            <ul className='space-y-0.5'>
                {e.lines.slice(0, 6).map((l) => (
                    <li key={l.no} className={`flex items-center gap-2 border-l-4 pl-2 text-xs ${SIDE[l.side].bar}`}>
                        <span className='min-w-0 flex-1 truncate text-soft'>
                            <span className='font-mono'>{l.glCode}</span> {l.glName}
                            {l.ccCode ? ` · ${l.ccCode}` : ''}
                        </span>
                        <Amount side={l.side} value={l.amount} />
                    </li>
                ))}
                {e.lines.length > 6 && <li className='text-xs text-muted'>and {e.lines.length - 6} more line(s)</li>}
            </ul>
        </button>
    );
}

/** The journal as a feed with lazy loading of earlier periods. Used by the Journal screen and inside a cost center. */
export function JournalFeed({ le, ccId, height = 'h-[calc(100dvh-19rem)]' }: { le: Entity; ccId?: string; height?: string }) {
    const [pages, setPages] = useState<Page[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [end, setEnd] = useState(false);
    const [table, setTable] = useState(false);
    const sentinel = useRef<HTMLDivElement | null>(null);
    const box = useRef<HTMLDivElement | null>(null);
    const load = async (fy?: number, no?: number, reset = false) => {
        setBusy(true);
        try {
            const p = await callBackend<Page>(`${FIN_API}/journal/list`, { leId: le.id, ccId: ccId ?? '', ...(fy ? { fy, no } : {}) });
            setPages((cur) => (reset ? [p] : [...cur, p]));
            setEnd(!p.prev);
            setError('');
        } catch (e) {
            setError(errText(e));
            setEnd(true);
        } finally {
            setBusy(false);
        }
    };
    useEffect(() => {
        setPages([]);
        setEnd(false);
        void load(undefined, undefined, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [le.id, ccId]);
    const last = pages[pages.length - 1];
    useEffect(() => {
        const el = sentinel.current;
        if (!el || table) return;
        const io = new IntersectionObserver(
            (items) => {
                if (items.some((i) => i.isIntersecting) && !busy && !end && last?.prev) void load(last.prev.fy, last.prev.no);
            },
            { root: box.current, rootMargin: '200px' }
        );
        io.observe(el);
        return () => io.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [last, busy, end, table]);
    const rows = pages.flatMap((p) => p.entries.flatMap((e) => e.lines.map((l) => ({ ...l, id: e.id, date: e.postingDate, type: e.typeLabel, narrative: e.narrative, period: `${p.period.label} ${p.period.name}`, currency: e.currency }))));
    type Row = (typeof rows)[number];
    const cols: Array<Column<Row>> = [
        { key: 'id', label: 'Entry', value: (r) => r.id, render: (r) => <span className='font-mono text-xs'>{r.id}</span> },
        { key: 'date', label: 'Posting date', type: 'date', value: (r) => r.date },
        { key: 'side', label: 'Dr / Cr', value: (r) => (r.side === 'D' ? 'Debit' : 'Credit'), render: (r) => <span className={SIDE[r.side].text}>{SIDE[r.side].label}</span> },
        { key: 'gl', label: 'Account', value: (r) => `${r.glCode} ${r.glName}` },
        { key: 'cc', label: 'Cost center', value: (r) => `${r.ccCode} ${r.ccName}`.trim() },
        { key: 'dr', label: 'Debit', type: 'number', value: (r) => (r.side === 'D' ? r.amount : null), render: (r) => (r.side === 'D' ? <span className='font-mono text-sky-300'>{fmt(r.amount)}</span> : '') },
        { key: 'cr', label: 'Credit', type: 'number', value: (r) => (r.side === 'C' ? r.amount : null), render: (r) => (r.side === 'C' ? <span className='font-mono text-amber-300'>{fmt(r.amount)}</span> : '') },
        { key: 'type', label: 'Type', value: (r) => r.type },
        { key: 'desc', label: 'Description', value: (r) => r.description, hidden: true },
        { key: 'per', label: 'Period', value: (r) => r.period, hidden: true },
        { key: 'qty', label: 'Quantity', type: 'number', value: (r) => r.qty, hidden: true },
    ];
    return (
        <div className='space-y-2'>
            <div className='flex flex-wrap items-center gap-2'>
                <Legend />
                <Button variant='secondary' className='ml-auto' onClick={() => setTable(!table)}>
                    {table ? <Rows3 className='h-4 w-4' /> : <Table2 className='h-4 w-4' />} {table ? 'Feed' : 'Table and Excel'}
                </Button>
            </div>
            {pages[0]?.partial && <Alert tone='info'>You see the lines of the cost centers you own or may view, not the whole entry.</Alert>}
            {error && <Alert tone='error'>{error}</Alert>}
            {table ? (
                <>
                    <RichTable id={`fin.journal.lines${ccId ? '.cc' : ''}`} columns={cols} rows={rows} rowKey={(r) => `${r.id}-${r.no}`} onRowClick={(r) => go(`fin_journal/${r.id}`)} empty='No postings in the loaded periods.' fileName={`journal-${le.code}${ccId ? '-cc' : ''}`} height={height} />
                    {last?.prev && (
                        <Button variant='secondary' busy={busy} onClick={() => void load(last.prev!.fy, last.prev!.no)}>
                            Load {last.prev.label} {last.prev.name}
                        </Button>
                    )}
                </>
            ) : (
                <div ref={box} className={`${height} space-y-3 overflow-y-auto overscroll-contain`}>
                    {pages.map((p) => (
                        <section key={`${p.period.fy}-${p.period.no}`} className='space-y-2'>
                            <div className='sticky top-0 z-10 flex items-center gap-2 bg-page py-1'>
                                <h3 className='text-sm font-semibold text-ink'>
                                    {p.period.label} · {p.period.name}
                                </h3>
                                <Pill status={p.period.status} />
                                <span className='ml-auto text-xs text-muted'>{p.entries.length} entr{p.entries.length === 1 ? 'y' : 'ies'}</span>
                            </div>
                            {!p.entries.length && <p className='text-xs text-muted'>No postings in this period.</p>}
                            {p.entries.map((e) => (
                                <EntryCard key={e.id} e={e} />
                            ))}
                        </section>
                    ))}
                    <div ref={sentinel} className='flex h-12 items-center justify-center text-xs text-muted'>
                        {busy ? <Loader2 className='h-5 w-5 animate-spin' /> : end ? 'Start of the journal' : ''}
                    </div>
                </div>
            )}
        </div>
    );
}

interface Detail extends Entry {
    leCode: string;
    leName: string;
    periodName: string;
    fy: number;
    docCurrency: string;
    fxRate: number;
    trace: Record<string, unknown>;
    mappingVersion: number;
    postedAt: string;
}
const ids = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

function DetailView({ id }: { id: string }) {
    const { data, error, loading } = useLoad(() => callBackend<Detail>(`${FIN_API}/journal/get`, { id }), [id]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Journal entry not found.'}</Alert>;
    const d = data;
    const t = d.trace ?? {};
    const dr = d.lines.filter((l) => l.side === 'D').reduce((s, l) => s + l.amount, 0);
    const cr = d.lines.filter((l) => l.side === 'C').reduce((s, l) => s + l.amount, 0);
    const link = (label: string, path: string, key: string) => (
        <button key={key} type='button' onClick={() => go(path)} className='flex min-h-11 w-full items-center gap-2 rounded-lg border border-line px-3 text-left text-sm active:bg-page'>
            <span className='min-w-0 flex-1 truncate text-ink'>{label}</span>
            <ArrowUpRight className='h-4 w-4 text-brand' />
        </button>
    );
    return (
        <Screen title={d.id} subtitle={`${d.typeLabel} · ${d.leCode}`} onBack={() => go('fin_journal')}>
            <Card title={d.typeLabel} right={<span className='font-mono text-sm text-ink'>{d.currency} {fmt(d.totalDebit)}</span>}>
                <Facts rows={[['Legal entity', `${d.leCode} ${d.leName}`], ['Posting date', d.postingDate], ['Period', `FY ${d.fy} ${d.periodName}`], ['Narrative', d.narrative], ['Document currency', d.docCurrency !== d.currency ? `${d.docCurrency} at ${d.fxRate}` : d.currency], ['Posted', `${fmtDate(d.postedAt)} by ${d.postedByName} (system posting)`], ['Mapping version', String(d.mappingVersion)]]} />
                <p className='text-xs text-muted'>A journal entry is never changed or deleted. A mistake is corrected only by a new, approved system posting.</p>
            </Card>
            <Card title='Lines'>
                <Legend />
                <ul className='space-y-1'>
                    {d.lines.map((l) => (
                        <li key={l.no} className={`space-y-0.5 rounded-lg border border-line border-l-4 p-2 ${SIDE[l.side].bar}`}>
                            <div className='flex items-center gap-2'>
                                <span className='min-w-0 flex-1 truncate text-sm text-ink'>
                                    <span className='font-mono'>{l.glCode}</span> {l.glName}
                                </span>
                                <Amount side={l.side} value={l.amount} />
                            </div>
                            <p className='text-xs text-soft'>
                                {l.ccCode ? `${l.ccCode} ${l.ccName}` : 'No cost center (balance sheet)'}
                                {l.qty !== null && l.qty !== undefined ? ` · quantity ${l.qty}` : ''}
                            </p>
                            <p className='text-xs text-muted'>{l.description}</p>
                        </li>
                    ))}
                </ul>
                <div className='flex justify-end gap-4 border-t border-line pt-2 text-sm'>
                    <span className='font-mono text-sky-300'>Dr {fmt(dr)}</span>
                    <span className='font-mono text-amber-300'>Cr {fmt(cr)}</span>
                    <Pill status={Math.abs(dr - cr) < 0.005 ? 'clean' : 'failed'} label={Math.abs(dr - cr) < 0.005 ? 'Balanced' : 'Out of balance'} />
                </div>
            </Card>
            <Card title='Trace back to the source'>
                <div className='space-y-1'>
                    {d.source?.route ? link(`${d.source.kind?.replace(/_/g, ' ')} ${d.source.id}${d.source.ref ? ` · ${d.source.ref}` : ''}`, d.source.route.replace(/^organization_home\//, ''), 'src') : <p className='text-sm text-soft'>{`${d.source?.kind?.replace(/_/g, ' ') ?? ''} ${d.source?.id ?? ''}${d.source?.ref ? ` · ${d.source.ref}` : ''}`}</p>}
                    {d.approvalRef && link(`Approved request ${d.approvalRef}`, `fin_approvals/${d.approvalRef}`, 'appr')}
                    {typeof t.request === 'string' && t.request !== d.approvalRef && link(`Request ${t.request}`, `fin_approvals/${t.request}`, 'req')}
                    {ids(t.requisitionIds).map((r) => link(`Requisition ${r}`, `procurement_requisitions/${r}`, r))}
                    {ids(t.quotationIds).map((q) => link(`Quotation ${q}`, `procurement_quotations/${q}`, q))}
                    {ids(t.requirementIds).map((r) => link(`Requirement ${r}`, `purchase_requirements/${r}`, r))}
                    {typeof t.workOrderId === 'string' && t.workOrderId && link(`Work order ${t.workOrderId}`, `work_orders/${t.workOrderId}`, 'wo')}
                </div>
                <Facts rows={Object.entries(t).filter(([k, v]) => typeof v === 'string' && v && !['request', 'workOrderId'].includes(k)).map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').toLowerCase(), String(v)])} />
            </Card>
        </Screen>
    );
}

export default function FinJournal({ id }: { id?: string }) {
    const ent = useEntity();
    if (id && /^[A-Z]{2,6}-\d{4}-\d{8}$/.test(id)) return <DetailView id={id} />;
    return (
        <FinScreen title='Journal' subtitle='The one journal of the legal entity, current period first' onBack={() => go('module/FIN')} entityState={ent}>
            {(le) => <JournalFeed le={le} />}
        </FinScreen>
    );
}
