import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, ChevronRight, FolderTree, Layers, ListChecks, Lock, Search } from 'lucide-react';
import { callBackend } from '../lib/backend';
import FinEntityAccounts from './FinEntityAccounts';
import { Alert, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Button, Spinner, useLoad } from '../admin/kit';
import { useConfirm } from '../components/screen';
import { Balance, Card, FIN_API, FinScreen, Facts, Pending, Pill, fmt, go, useEntity, type Entity } from './finKit';

// GL Accounts of a legal entity:
//   Chart     the accounts adopted from the MEMS GL master and approved for this legal entity (the only accounts that
//             can be used anywhere), with status, statement, postings and balance
//   Browse    the MEMS GL master as cards: class > category > group > account, with back buttons; pick accounts and
//             propose their adoption (approved by a second person)
//   Mapping   which account every system transaction posts to, the category overrides and the taxes that apply
// An account that has journal postings can never be blocked or removed; an account in the mapping cannot either.

interface Acc {
    code: string;
    name: string;
    className: string;
    categoryName: string;
    groupName: string;
    statement: string;
    normalBalance: string;
    accountType: string;
    postable: boolean;
    status: string;
    hasPostings: boolean;
    roles: string[];
    core: string;
    ccLists: number;
    balance: number;
}
interface ChartData {
    accounts: Acc[];
    fy: number;
    pending: Array<{ id: string; typeLabel: string; title: string; makerName: string }>;
    can: Record<string, boolean>;
}
const COLS: Array<Column<Acc>> = [
    { key: 'code', label: 'Account', value: (a) => a.code, render: (a) => <span className='font-mono text-xs'>{a.code}</span> },
    { key: 'name', label: 'Name', value: (a) => a.name },
    { key: 'st', label: 'Status', value: (a) => a.status, render: (a) => <Pill status={a.status} /> },
    { key: 'core', label: 'Core', value: (a) => (a.core ? 'Core' : ''), render: (a) => (a.core ? <Pill status='core' label='Core' /> : '') },
    { key: 'stmt', label: 'BS / PL', value: (a) => a.statement },
    { key: 'bal', label: 'Balance', type: 'number', value: (a) => a.balance, render: (a) => <Balance value={a.balance} /> },
    { key: 'cls', label: 'Class', value: (a) => a.className, hidden: true },
    { key: 'cat', label: 'Category', value: (a) => a.categoryName, hidden: true },
    { key: 'grp', label: 'Group', value: (a) => a.groupName, hidden: true },
    { key: 'nb', label: 'Normal balance', value: (a) => a.normalBalance, hidden: true },
    { key: 'type', label: 'Account type', value: (a) => a.accountType, hidden: true },
    { key: 'post', label: 'Takes postings', value: (a) => (a.postable ? 'Yes' : 'Heading') },
    { key: 'used', label: 'Has postings', value: (a) => (a.hasPostings ? 'Yes' : 'No') },
    { key: 'roles', label: 'Mapped as', value: (a) => a.roles.join(', '), hidden: true },
    { key: 'why', label: 'Why core', value: (a) => a.core, hidden: true },
    { key: 'cc', label: 'In cost center lists', type: 'number', value: (a) => a.ccLists, hidden: true },
];

function Chart({ le, entities }: { le: Entity; entities: Entity[] }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<ChartData>(`${FIN_API}/chart/list`, { leId: le.id }), [le.id]);
    const [from, setFrom] = useState('');
    const [msg, setMsg] = useState('');
    const confirm = useConfirm();
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the chart.'}</Alert>;
    const others = entities.filter((e) => e.id !== le.id);
    return (
        <>
            {msg && <Alert tone='success'>{msg}</Alert>}
            <Pending items={data.pending} />
            {!data.accounts.length && <Alert tone='warn'>The chart of {le.code} is empty because the MEMS GL account master is not loaded yet. Once it is, every MEMS account joins the chart, active and approved by default.</Alert>}
            {data.can.gl_manage && (
                <div className='flex flex-wrap items-center gap-2'>
                    <Button variant='secondary' onClick={() => confirm.ask({ title: 'Propose adding back removed accounts', message: `Every MEMS GL account is in the chart of ${le.code}, active and approved by default. This adds back the accounts that were removed through an approved request. A person with FIN.gl.approve must approve.`, confirmLabel: 'Propose', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${FIN_API}/chart/propose`, { leId: le.id, action: 'adopt', all: true, reason }); setMsg('Proposed for approval.'); reload(); })}>
                        <ListChecks className='h-4 w-4' /> Add back removed accounts
                    </Button>
                    <span className='text-xs text-muted'>Every MEMS account is active and approved by default. Blocking or removing one needs approval; core accounts (mapped, used by a tax, with postings, or MEMS control accounts) can never be removed or blocked.</span>
                </div>
            )}
            <RichTable id='fin.chart' title={`Chart of accounts · balances FY ${data.fy}`} columns={COLS} rows={data.accounts} rowKey={(a) => a.code} onRowClick={(a) => go(`fin_gl/account/${encodeURIComponent(a.code)}`)} empty='No approved accounts.' fileName={`chart-of-accounts-${le.code}`} height='h-[calc(100dvh-22rem)]' rowClassName={(a) => (a.status === 'blocked' ? 'opacity-60' : '')} />
            {data.can.gl_manage && others.length > 0 && (
                <Card title='Copy the chart of another legal entity'>
                    <div className='flex items-end gap-2'>
                        <div className='min-w-0 flex-1'>
                            <SelectField id='fg-copy' label='Copy active accounts from' value={from} onChange={(e) => setFrom(e.target.value)}>
                                <option value=''>Choose</option>
                                {others.map((e) => (
                                    <option key={e.id} value={e.id}>
                                        {e.code} {e.name}
                                    </option>
                                ))}
                            </SelectField>
                        </div>
                        <Button disabled={!from} onClick={() => confirm.ask({ title: 'Propose copying the chart', message: `Every active account of the other legal entity that ${le.code} does not have yet is proposed for adoption. A person with FIN.gl.approve must approve.`, confirmLabel: 'Propose', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${FIN_API}/chart/propose`, { leId: le.id, action: 'adopt', fromLeId: from, reason }); setFrom(''); setMsg('Proposed for approval.'); reload(); })}>
                            Propose copy
                        </Button>
                    </div>
                </Card>
            )}
            {confirm.sheet}
        </>
    );
}

interface Master {
    version: string;
    classes: Array<{ code: string; name: string; description: string }>;
    categories: Array<{ code: string; name: string; description: string; classCode: string }>;
    groups: Array<{ code: string; name: string; description: string; categoryCode: string }>;
    accounts: Array<{ code: string; name: string; description: string; classCode: string; categoryCode: string; groupCode: string; normalBalance: string; accountType: string; postingMode: string; statement: string; postable: boolean; core: boolean; adopted: string }>;
}

type SelState = 'none' | 'some' | 'all' | 'done';
/** Tick box for a whole class, category or group: none, some, all selected, or everything already in the chart. */
function SelBox({ state, label, onToggle }: { state: SelState; label: string; onToggle: () => void }) {
    if (state === 'done')
        return (
            <span title='Already in the chart' className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 text-emerald-400'>
                <Lock className='h-4 w-4' />
            </span>
        );
    return (
        <button type='button' role='checkbox' aria-checked={state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false'} aria-label={`Select every account in ${label}`} onClick={onToggle} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${state === 'all' ? 'border-brand bg-brand text-onbrand' : state === 'some' ? 'border-brand text-brand' : 'border-line text-soft'}`}>
            {state === 'all' ? <Check className='h-5 w-5' /> : state === 'some' ? <span className='h-0.5 w-4 rounded bg-current' /> : null}
        </button>
    );
}
function Tile({ title, code, sub, onClick, right, sel }: { title: string; code: string; sub?: string; onClick: () => void; right?: ReactNode; sel?: ReactNode }) {
    return (
        <div className='flex min-h-16 w-full items-center gap-2 rounded-2xl border border-line bg-panel p-2'>
            {sel}
            <button type='button' onClick={onClick} className='flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left active:bg-page'>
                <span className='min-w-0 flex-1'>
                    <span className='block font-mono text-xs text-brand'>{code}</span>
                    <span className='block text-sm font-medium text-ink'>{title}</span>
                    {sub && <span className='line-clamp-2 block text-xs text-muted'>{sub}</span>}
                </span>
                {right}
                <ChevronRight className='h-4 w-4 shrink-0 text-muted' />
            </button>
        </div>
    );
}

function Browse({ le }: { le: Entity }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<Master>(`${FIN_API}/chart/master`, { leId: le.id }), [le.id]);
    const [cls, setCls] = useState('');
    const [cat, setCat] = useState('');
    const [grp, setGrp] = useState('');
    const [q, setQ] = useState('');
    const [pick, setPick] = useState<string[]>([]);
    const [msg, setMsg] = useState('');
    const confirm = useConfirm();
    const can = le.can.gl_manage;
    const found = useMemo(() => {
        const t = q.trim().toLowerCase();
        if (!data || t.length < 2) return [];
        return data.accounts.filter((a) => `${a.code} ${a.name} ${a.description}`.toLowerCase().includes(t)).slice(0, 80);
    }, [data, q]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the MEMS GL master.'}</Alert>;
    const back = () => (grp ? setGrp('') : cat ? setCat('') : setCls(''));
    const crumbs = [data.classes.find((c) => c.code === cls)?.name, data.categories.find((c) => c.code === cat)?.name, data.groups.find((g) => g.code === grp)?.name].filter(Boolean);
    const accountsHere = grp ? data.accounts.filter((a) => a.groupCode === grp) : found;
    const picked = new Set(pick);
    const freeOf = (list: Master['accounts']) => list.filter((a) => !a.adopted).map((a) => a.code);
    const stateOf = (list: Master['accounts']): SelState => {
        const free = freeOf(list);
        if (!free.length) return 'done';
        const n = free.filter((c) => picked.has(c)).length;
        return n === 0 ? 'none' : n === free.length ? 'all' : 'some';
    };
    const toggle = (list: Master['accounts']) => {
        const free = freeOf(list);
        setPick(stateOf(list) === 'all' ? pick.filter((c) => !free.includes(c)) : Array.from(new Set([...pick, ...free])));
    };
    const here = grp ? data.accounts.filter((a) => a.groupCode === grp) : cat ? data.accounts.filter((a) => a.categoryCode === cat) : cls ? data.accounts.filter((a) => a.classCode === cls) : data.accounts;
    const hereLabel = crumbs.length ? String(crumbs[crumbs.length - 1]) : 'the MEMS GL master';
    const box = (list: Master['accounts'], label: string) => (can ? <SelBox state={stateOf(list)} label={label} onToggle={() => toggle(list)} /> : undefined);
    const AccTile = (a: Master['accounts'][number]) => {
        const on = pick.includes(a.code);
        return (
            <div key={a.code} className={`flex items-center gap-3 rounded-2xl border p-3 ${on ? 'border-brand bg-emerald-500/10' : 'border-line bg-panel'}`}>
                {can && !a.adopted && (
                    <button type='button' aria-label={on ? 'Unselect' : 'Select'} onClick={() => setPick(on ? pick.filter((x) => x !== a.code) : [...pick, a.code])} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${on ? 'border-brand bg-brand text-onbrand' : 'border-line text-soft'}`}>
                        {on && <Check className='h-5 w-5' />}
                    </button>
                )}
                <button type='button' onClick={() => go(`fin_gl/account/${encodeURIComponent(a.code)}`)} className='min-w-0 flex-1 text-left'>
                    <span className='block font-mono text-xs text-brand'>{a.code}</span>
                    <span className='block text-sm text-ink'>{a.name}</span>
                    {a.description && <span className='line-clamp-2 block text-xs text-muted'>{a.description}</span>}
                    <span className='mt-1 flex flex-wrap gap-1'>
                        <Pill status='draft' label={a.statement === 'PL' ? 'Profit and loss' : 'Balance sheet'} />
                        {a.normalBalance && <Pill status='future' label={`Normal ${a.normalBalance}`} />}
                        {!a.postable && <Pill status='closed' label='Heading' />}
                        {a.core && <Pill status='core' label='Core' />}
                        {a.adopted && <Pill status={a.adopted} label={`In chart: ${a.adopted}`} />}
                    </span>
                </button>
            </div>
        );
    };
    return (
        <>
            {msg && <Alert tone='success'>{msg}</Alert>}
            <label className='flex h-12 items-center gap-2 rounded-xl border border-line bg-panel px-3'>
                <Search className='h-4 w-4 text-muted' />
                <input aria-label='Search the GL master' value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${data.accounts.length} accounts by code, name or description`} className='h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted' />
            </label>
            {q.trim().length >= 2 ? (
                <div className='space-y-2'>{found.length ? found.map(AccTile) : <p className='text-sm text-muted'>No account matches.</p>}</div>
            ) : (
                <>
                    {cls && (
                        <div className='flex items-center gap-2'>
                            <button type='button' onClick={back} className='flex h-11 items-center gap-1 rounded-xl border border-line px-3 text-sm text-soft'>
                                <ArrowLeft className='h-4 w-4' /> Back
                            </button>
                            <p className='min-w-0 flex-1 truncate text-xs text-muted'>{crumbs.join(' › ')}</p>
                        </div>
                    )}
                    {can && stateOf(here) !== 'done' && (
                        <div className='flex items-center gap-2 rounded-2xl border border-dashed border-line p-2'>
                            <SelBox state={stateOf(here)} label={hereLabel} onToggle={() => toggle(here)} />
                            <span className='min-w-0 flex-1 text-sm text-soft'>
                                Select all {freeOf(here).length} account(s) not yet in the chart in {hereLabel}
                            </span>
                        </div>
                    )}
                    <div className='grid gap-2 sm:grid-cols-2'>
                        {!cls && data.classes.map((c) => <Tile key={c.code} code={c.code} title={c.name} sub={c.description} sel={box(data.accounts.filter((a) => a.classCode === c.code), c.name)} onClick={() => setCls(c.code)} right={<span className='text-xs text-muted'>{data.accounts.filter((a) => a.classCode === c.code).length}</span>} />)}
                        {cls && !cat && data.categories.filter((c) => c.classCode === cls).map((c) => <Tile key={c.code} code={c.code} title={c.name} sub={c.description} sel={box(data.accounts.filter((a) => a.categoryCode === c.code), c.name)} onClick={() => setCat(c.code)} right={<span className='text-xs text-muted'>{data.accounts.filter((a) => a.categoryCode === c.code).length}</span>} />)}
                        {cat && !grp && data.groups.filter((g) => g.categoryCode === cat).map((g) => <Tile key={g.code} code={g.code} title={g.name} sub={g.description} sel={box(data.accounts.filter((a) => a.groupCode === g.code), g.name)} onClick={() => setGrp(g.code)} right={<span className='text-xs text-muted'>{data.accounts.filter((a) => a.groupCode === g.code).length}</span>} />)}
                    </div>
                    {grp && (
                        <div className='space-y-2'>
                            {accountsHere.map(AccTile)}
                        </div>
                    )}
                </>
            )}
            {can && pick.length > 0 && (
                <div className='sticky bottom-0 flex items-center gap-2 rounded-2xl border border-brand bg-panel p-3'>
                    <span className='min-w-0 flex-1 text-sm text-ink'>{pick.length} account(s) selected</span>
                    <Button variant='secondary' onClick={() => setPick([])}>
                        Clear
                    </Button>
                    <Button onClick={() => confirm.ask({ title: `Propose adopting ${pick.length} account(s)`, message: `They join the chart of ${le.code} once a person with FIN.gl.approve approves. Only approved accounts can be used anywhere.`, confirmLabel: 'Propose', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${FIN_API}/chart/propose`, { leId: le.id, action: 'adopt', codes: pick, reason }); setPick([]); setMsg('Proposed for approval.'); reload(); })}>
                        Propose adoption
                    </Button>
                </div>
            )}
            <p className='text-xs text-muted'>MEMS GL master version {data.version}. Only active accounts of the master are shown.</p>
            {confirm.sheet}
        </>
    );
}

interface AccountData {
    chart: Record<string, unknown> | null;
    inChart: boolean;
    core: string;
    master: { code: string; name: string; description: string; groupCode: string; categoryCode: string; subcategoryCode: string; synonyms: string[]; legacyCodes: string[]; properties: Array<{ label: string; value: string }>; attributes: Array<{ name: string; dataType: string; required: boolean; description: string }> } | null;
    roles: string[];
    periods: Array<{ fy: number; period: number; dr: number; cr: number }>;
}
function AccountView({ le, code }: { le: Entity; code: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<AccountData>(`${FIN_API}/chart/account`, { leId: le.id, code }), [le.id, code]);
    const [msg, setMsg] = useState('');
    const confirm = useConfirm();
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Account not found.'}</Alert>;
    const c = data.chart ?? {};
    const m = data.master;
    const s = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : typeof c[k] === 'boolean' ? (c[k] ? 'Yes' : 'No') : '');
    const params = Array.isArray(c.params) ? (c.params as Array<{ key: string; value: string }>) : [];
    const status = s('status');
    const posted = c.hasPostings === true;
    const propose = (action: string, label: string, tone: 'primary' | 'danger' = 'primary') =>
        confirm.ask({ title: `${label} ${code}`, message: action === 'block' ? 'A blocked account takes no postings. Only accounts with no journal postings and not in the mapping can be blocked.' : action === 'remove' ? 'The account leaves the chart. Only accounts that never had a posting can be removed.' : 'Needs approval by a person with FIN.gl.approve.', confirmLabel: 'Propose', tone, reason: { label: 'Reason', minLength: 10 } }, async (reason) => {
            await callBackend(`${FIN_API}/chart/propose`, { leId: le.id, action, codes: [code], reason });
            setMsg('Proposed for approval.');
            reload();
        });
    let total = 0;
    return (
        <>
            {msg && <Alert tone='success'>{msg}</Alert>}
            <Card title={`${code} ${s('name') || m?.name || ''}`} right={<span className='flex gap-1'>{data.core && <Pill status='core' label='Core' />}{data.inChart ? <Pill status={status} /> : <Pill status='draft' label='Not in the chart' />}</span>}>
                <Facts
                    rows={[
                        ['Class', `${s('classCode')} ${s('className')}`.trim() || m?.groupCode || ''],
                        ['Category', `${s('categoryCode')} ${s('categoryName')}`.trim() || m?.categoryCode || ''],
                        ['Group', `${s('groupCode')} ${s('groupName')}`.trim() || m?.subcategoryCode || ''],
                        ['Statement', s('statement') === 'PL' ? 'Profit and loss' : s('statement') ? 'Balance sheet' : ''],
                        ['Normal balance', s('normalBalance')],
                        ['Account type', s('accountType')],
                        ['Account role', s('accountRole')],
                        ['Posting mode', s('postingMode')],
                        ['Takes postings', s('postable')],
                        ['Has journal postings', posted ? 'Yes' : 'No'],
                        ['Core account', data.core ? `Yes: ${data.core}. It can never be removed or blocked.` : 'No'],
                        ['Mapped as', data.roles.join(', ')],
                        ['Description', s('description') || m?.description || ''],
                    ]}
                />
                {data.inChart && le.can.gl_manage && (
                    <div className='flex flex-wrap gap-2'>
                        {status === 'active' && !data.core && <Button variant='secondary' onClick={() => propose('block', 'Block')}>Propose block</Button>}
                        {status === 'blocked' && <Button variant='secondary' onClick={() => propose('unblock', 'Unblock')}>Propose unblock</Button>}
                        {!data.core && <Button variant='danger' onClick={() => propose('remove', 'Remove', 'danger')}>Propose removal</Button>}
                    </div>
                )}
                {!data.inChart && m && le.can.gl_manage && <Button onClick={() => propose('adopt', 'Adopt')}>Propose adoption</Button>}
            </Card>
            {(params.length > 0 || (m && (m.properties.length || m.synonyms.length || m.legacyCodes.length))) && (
                <Card title='All parameters from the MEMS GL master'>
                    <Facts rows={[...params.map((p): [string, string] => [p.key, p.value]), ...(m?.properties ?? []).map((p): [string, string] => [p.label, p.value]), ...(m?.synonyms.length ? [['Synonyms', m.synonyms.join(', ')] as [string, string]] : []), ...(m?.legacyCodes.length ? [['Legacy codes', m.legacyCodes.join(', ')] as [string, string]] : [])]} />
                    {m && m.attributes.length > 0 && (
                        <ul className='space-y-1 text-xs text-soft'>
                            {m.attributes.map((a) => (
                                <li key={a.name}>
                                    {a.name} ({a.dataType}){a.required ? ', required' : ''}
                                    {a.description ? `: ${a.description}` : ''}
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            )}
            {data.inChart && (
                <Card title='Movements by period'>
                    {!data.periods.length && <p className='text-sm text-muted'>No postings yet.</p>}
                    <ul className='divide-y divide-line text-sm'>
                        {data.periods.map((p) => {
                            total += p.dr - p.cr;
                            return (
                                <li key={`${p.fy}-${p.period}`} className='flex flex-wrap items-center gap-3 py-2'>
                                    <span className='w-24 text-muted'>
                                        FY {p.fy} P{p.period}
                                    </span>
                                    <span className='font-mono text-sky-300'>Dr {fmt(p.dr)}</span>
                                    <span className='font-mono text-amber-300'>Cr {fmt(p.cr)}</span>
                                    <span className='ml-auto'>
                                        <Balance value={total} />
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </Card>
            )}
            {confirm.sheet}
        </>
    );
}

interface MapData {
    roles: Array<{ code: string; label: string; statement: 'BS' | 'PL'; required: boolean; note: string }>;
    mapping: { roles: Record<string, string>; byCategory: Record<string, { INVENTORY?: string; CONSUMPTION?: string }>; version: number };
    txns: Array<{ code: string; label: string; debit: string; credit: string; live: boolean; source: string; taxes: string[] }>;
    accounts: Array<{ code: string; name: string; statement: string }>;
    categories: Array<{ code: string; name: string }>;
    pending: Array<{ id: string; typeLabel: string; title: string; makerName: string }>;
    can: Record<string, boolean>;
}
function Mapping({ le }: { le: Entity }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<MapData>(`${FIN_API}/mapping/get`, { leId: le.id }), [le.id]);
    const [roles, setRoles] = useState<Record<string, string> | null>(null);
    const [cats, setCats] = useState<Record<string, { INVENTORY?: string; CONSUMPTION?: string }> | null>(null);
    const [newCat, setNewCat] = useState('');
    const [msg, setMsg] = useState('');
    const confirm = useConfirm();
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the mapping.'}</Alert>;
    const r = roles ?? data.mapping.roles;
    const bc = cats ?? data.mapping.byCategory;
    const can = data.can.mapping_manage;
    const opts = (st: string) => data.accounts.filter((a) => a.statement === st);
    const name = (code?: string) => (code ? `${code} ${data.accounts.find((a) => a.code === code)?.name ?? ''}` : '');
    const resolve = (role: string) => (data.roles.some((x) => x.code === role) ? name(r[role]) || `${role} (not mapped)` : role);
    const changed = JSON.stringify(r) !== JSON.stringify(data.mapping.roles) || JSON.stringify(bc) !== JSON.stringify(data.mapping.byCategory);
    const missing = data.roles.filter((x) => x.required && !r[x.code]);
    return (
        <>
            {msg && <Alert tone='success'>{msg}</Alert>}
            <Pending items={data.pending} />
            {!data.accounts.length && <Alert tone='warn'>Approve accounts in the chart first; only approved accounts can be mapped.</Alert>}
            <Card title={`Account determination · version ${data.mapping.version}`}>
                {data.roles.map((x) => (
                    <SelectField key={x.code} id={`fm-${x.code}`} label={`${x.label}${x.required ? ' *' : ''}`} hint={`${x.note} ${x.statement === 'BS' ? 'Balance sheet account.' : 'Profit and loss account.'}`} value={r[x.code] ?? ''} disabled={!can} onChange={(e) => setRoles({ ...r, [x.code]: e.target.value })}>
                        <option value=''>Not mapped</option>
                        {opts(x.statement).map((a) => (
                            <option key={a.code} value={a.code}>
                                {a.code} {a.name}
                            </option>
                        ))}
                    </SelectField>
                ))}
                {missing.length > 0 && <p className='text-xs text-amber-300'>Required before go-live: {missing.map((x) => x.label).join(', ')}.</p>}
            </Card>
            <Card title='By material category (optional)'>
                <p className='text-xs text-soft'>A material category can carry its own inventory and consumption accounts; otherwise the accounts above apply.</p>
                {Object.entries(bc).map(([k, v]) => (
                    <div key={k} className='space-y-2 rounded-xl border border-line p-2'>
                        <div className='flex items-center justify-between'>
                            <p className='text-sm text-ink'>{data.categories.find((c) => c.code === k)?.name ?? k}</p>
                            {can && (
                                <button type='button' className='min-h-11 px-2 text-sm text-red-300' onClick={() => { const n = { ...bc }; delete n[k]; setCats(n); }}>
                                    Remove
                                </button>
                            )}
                        </div>
                        <SelectField id={`fmc-i-${k}`} label='Inventory' value={v.INVENTORY ?? ''} disabled={!can} onChange={(e) => setCats({ ...bc, [k]: { ...v, INVENTORY: e.target.value } })}>
                            <option value=''>Use the default</option>
                            {opts('BS').map((a) => (
                                <option key={a.code} value={a.code}>
                                    {a.code} {a.name}
                                </option>
                            ))}
                        </SelectField>
                        <SelectField id={`fmc-c-${k}`} label='Consumption' value={v.CONSUMPTION ?? ''} disabled={!can} onChange={(e) => setCats({ ...bc, [k]: { ...v, CONSUMPTION: e.target.value } })}>
                            <option value=''>Use the default</option>
                            {opts('PL').map((a) => (
                                <option key={a.code} value={a.code}>
                                    {a.code} {a.name}
                                </option>
                            ))}
                        </SelectField>
                    </div>
                ))}
                {can && (
                    <div className='flex items-end gap-2'>
                        <div className='min-w-0 flex-1'>
                            <SelectField id='fmc-new' label='Add a category' value={newCat} onChange={(e) => setNewCat(e.target.value)}>
                                <option value=''>Choose</option>
                                {data.categories.filter((c) => !bc[c.code]).map((c) => (
                                    <option key={c.code} value={c.code}>
                                        {c.code} {c.name}
                                    </option>
                                ))}
                            </SelectField>
                        </div>
                        <Button variant='secondary' disabled={!newCat} onClick={() => { setCats({ ...bc, [newCat]: {} }); setNewCat(''); }}>
                            Add
                        </Button>
                    </div>
                )}
            </Card>
            {can && (
                <Button disabled={!changed} onClick={() => confirm.ask({ title: 'Propose the mapping', message: 'Every posting from approval on uses the new accounts. A person with FIN.mapping.approve must approve it.', confirmLabel: 'Propose', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${FIN_API}/mapping/propose`, { leId: le.id, mapping: { roles: r, byCategory: bc }, reason }); setRoles(null); setCats(null); setMsg('Proposed for approval.'); reload(); })}>
                    Propose mapping
                </Button>
            )}
            <Card title='Every financial transaction and where it posts'>
                <ul className='space-y-2'>
                    {data.txns.map((t) => (
                        <li key={t.code} className='space-y-1 rounded-xl border border-line p-3'>
                            <div className='flex items-center gap-2'>
                                <span className='font-mono text-xs text-muted'>{t.code}</span>
                                <span className='min-w-0 flex-1 text-sm text-ink'>{t.label}</span>
                                <Pill status={t.live ? 'active' : 'draft'} label={t.live ? 'Posting' : 'Planned'} />
                            </div>
                            <p className='border-l-4 border-l-sky-400 pl-2 text-xs text-sky-200'>Dr {t.debit.split(/\s*\/\s*|\s\+\s/).map((x) => resolve(x.trim())).join(' / ')}</p>
                            <p className='border-l-4 border-l-amber-400 pl-2 text-xs text-amber-200'>Cr {t.credit.split(/\s*\/\s*|\s\+\s/).map((x) => resolve(x.trim())).join(' / ')}</p>
                            <p className='text-xs text-muted'>
                                From: {t.source}
                                {t.taxes.length ? ` · Taxes that apply: ${t.taxes.join('; ')}` : ''}
                            </p>
                        </li>
                    ))}
                </ul>
            </Card>
            {confirm.sheet}
        </>
    );
}

export default function FinGl({ tab, code }: { tab?: string; code?: string }) {
    const ent = useEntity();
    const t = tab === 'browse' || tab === 'mapping' || tab === 'account' || tab === 'scope' ? tab : 'chart';
    const account = t === 'account' && code ? decodeURIComponent(code) : '';
    type Tab = 'chart' | 'browse' | 'mapping' | 'scope';
    return (
        <FinScreen
            title={account ? `GL account ${account}` : 'GL Accounts'}
            subtitle={account ? 'All parameters, status and movements' : 'Chart of accounts, MEMS GL master and mapping'}
            onBack={() => (account ? window.history.back() : go('module/FIN'))}
            entityState={ent}
            nav={account ? undefined : [{ value: 'chart', label: 'Chart of accounts', icon: ListChecks }, { value: 'scope', label: 'Legal entity selection', icon: ListChecks }, { value: 'browse', label: 'Browse MEMS master', icon: FolderTree }, { value: 'mapping', label: 'GL account mapping', icon: Layers }]}
            navValue={(account ? undefined : t) as Tab | undefined}
            onNav={(v: Tab) => go(v === 'chart' ? 'fin_gl' : `fin_gl/${v}`)}
        >
            {(le) => (account ? <AccountView le={le} code={account} /> : t === 'browse' ? <Browse le={le} /> : t === 'scope' ? <FinEntityAccounts le={le} entities={ent.entities ?? []} /> : t === 'mapping' ? <Mapping le={le} /> : <Chart le={le} entities={ent.entities ?? []} />)}
        </FinScreen>
    );
}
