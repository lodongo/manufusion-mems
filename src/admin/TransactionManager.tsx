import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';
import RichTable, { type Column } from '../components/RichTable';
import { Alert, Field, SelectField } from '../components/ui';
import { Segmented, messageOf, useConfirm } from '../components/screen';
import { Badge, Button, PageTitle, Spinner } from './kit';
import Sheet from '../components/Sheet';
import GlAccountTransactions from './GlAccountTransactions';
import FinanceTransactionAudit from './FinanceTransactionAudit';

// MEMS admin › Transactions Manager
// Every transaction code with its state:
//   live            reserved code with at least one installed route linked to it
//   reserved        placeholder only; nothing is installed and nothing can run
//   live_unlinked   installed route that does not match a reserved code yet (keeps its permanent route code)
//   added_reserved  placeholder added by MEMS administration
//   retired         withdrawn placeholder; the code is never reused
// Listing or reserving a code never grants anyone access.

type State = 'live' | 'reserved' | 'live_unlinked' | 'added_reserved' | 'retired';
type Row = {
    code: string; module: string; area: string; areaName: string; action: string; actionName: string; name: string;
    kind: 'module_access' | 'submodule_access' | 'transaction' | 'route'; state: State;
    source: 'built_in' | 'mems_admin' | 'installed_route'; routes: string[]; permissions: string[];
    addedBy?: string; addedAt?: string; reason?: string;
    postings: Array<{ event: string; label: string; debit: string[]; credit: string[]; state: 'live' | 'planned' }>;
};
type GlRole = { code: string; label: string; statement: 'BS' | 'PL'; live: boolean; note: string; default: { code: string; name: string; basis: 'gl_master_role' | 'account_name' } | null };
type GlEvent = { event: string; label: string; codes: string[]; debit: string[]; credit: string[]; state: 'live' | 'planned'; source: string; routes: string[] };
type GlDefaults = { masterVersion: string; masterAccounts: number; roles: GlRole[]; events: GlEvent[] };
type AreaDef = { module: string; area: string; name: string; actions: string[] };
type Catalogue = {
    items: Row[];
    totals: { codes: number; live: number; reserved: number; liveUnlinked: number; added: number; retired: number; installedRoutes: number; linkedRoutes: number };
    modules: Array<{ code: string; name: string }>;
    areas: AreaDef[];
    actions: Array<{ code: string; name: string }>;
    gl: GlDefaults;
};

const STATE_LABEL: Record<State, string> = {
    live: 'Live',
    reserved: 'Reserved',
    live_unlinked: 'Live · not linked',
    added_reserved: 'Added · reserved',
    retired: 'Retired',
};
const STATE_TONE: Record<State, 'brand' | 'muted' | 'warn' | 'danger'> = {
    live: 'brand', reserved: 'muted', live_unlinked: 'warn', added_reserved: 'muted', retired: 'danger',
};
const KIND_LABEL: Record<Row['kind'], string> = {
    module_access: 'Module access', submodule_access: 'Submodule access', transaction: 'Transaction', route: 'Installed route',
};

type Filter = 'all' | 'financial' | State;
type View = 'transactions' | 'gl' | 'accounts' | 'audit';

export default function TransactionManager() {
    const [data, setData] = useState<Catalogue | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState<Filter>('all');
    const [module, setModule] = useState('');
    const [selected, setSelected] = useState<Row | null>(null);
    const [adding, setAdding] = useState(false);
    const [copied, setCopied] = useState('');
    const [view, setView] = useState<View>('transactions');
    const { ask, sheet } = useConfirm();

    const load = () => {
        setLoading(true);
        setError('');
        callBackend<Catalogue>('/api/admin/transactions/list', {})
            .then(setData)
            .catch((e) => setError(messageOf(e, 'Unable to load the transaction catalogue.')))
            .finally(() => setLoading(false));
    };
    useEffect(load, []);

    const rows = useMemo(
        () => (data?.items ?? []).filter((r) => (filter === 'all' || (filter === 'financial' ? r.postings.length > 0 : r.state === filter)) && (!module || r.module === module)),
        [data, filter, module],
    );
    const moduleName = useMemo(() => new Map((data?.modules ?? []).map((m) => [m.code, m.name])), [data]);

    const copy = async (code: string) => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(code);
            window.setTimeout(() => setCopied(''), 1500);
        } catch {
            setCopied('');
        }
    };

    const columns: Array<Column<Row>> = [
        {
            key: 'code', label: 'Code', value: (r) => r.code,
            render: (r) => <span className='whitespace-nowrap font-mono text-xs font-semibold text-ink'>{r.code}</span>,
        },
        { key: 'state', label: 'State', value: (r) => STATE_LABEL[r.state], render: (r) => <Badge tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</Badge> },
        { key: 'name', label: 'Transaction', value: (r) => r.name, render: (r) => <span className='block min-w-[12rem] max-w-[20rem] whitespace-normal'>{r.name}</span> },
        { key: 'module', label: 'Module', value: (r) => `${r.module} ${moduleName.get(r.module) ?? ''}`, render: (r) => <span title={moduleName.get(r.module)}>{r.module}</span> },
        { key: 'area', label: 'Submodule', value: (r) => `${r.area} ${r.areaName}`, render: (r) => <span className='block min-w-[9rem] whitespace-normal'>{r.areaName}<span className='block font-mono text-xs text-muted'>{r.area}</span></span> },
        { key: 'action', label: 'Action', value: (r) => r.actionName || r.action },
        { key: 'routes', label: 'Installed routes', type: 'number', value: (r) => r.routes.length },
        {
            key: 'posting', label: 'GL posting', value: (r) => r.postings.map((p) => `${p.event} (${p.state})`).join(', '),
            render: (r) => r.postings.length ? <span className='block max-w-[14rem] whitespace-normal text-xs'>{r.postings.map((p) => p.event).join(', ')}</span> : <span className='text-muted'>—</span>,
        },
        { key: 'permissions', label: 'Permissions', value: (r) => r.permissions.join(', '), render: (r) => <span className='block max-w-[16rem] whitespace-normal break-words text-xs'>{r.permissions.join(', ') || '—'}</span> },
        { key: 'kind', label: 'Kind', hidden: true, value: (r) => KIND_LABEL[r.kind] },
        { key: 'routeList', label: 'Route paths', hidden: true, value: (r) => r.routes.join('; ') },
        { key: 'addedBy', label: 'Added by', hidden: true, value: (r) => r.addedBy ?? '' },
        { key: 'addedAt', label: 'Added on', type: 'date', hidden: true, value: (r) => r.addedAt ?? '' },
        { key: 'reason', label: 'Reason', hidden: true, value: (r) => r.reason ?? '' },
    ];

    const retire = (row: Row) =>
        ask(
            {
                title: `Retire ${row.code}?`,
                message: 'The code stays in the catalogue as retired and is never reused. Nothing is installed against it, so no one loses access.',
                confirmLabel: 'Retire code',
                tone: 'danger',
                reason: { label: 'Reason for retiring', minLength: 10, placeholder: 'Why this placeholder is no longer needed' },
            },
            async (reason) => {
                await callBackend('/api/admin/transactions/code/retire', { code: row.code, reason });
                setSelected(null);
                load();
            },
        );

    const t = data?.totals;
    const filters: Array<{ value: Filter; label: string; count?: number }> = [
        { value: 'all', label: 'All', count: t?.codes },
        { value: 'financial', label: 'Financial', count: data?.items.filter((r) => r.postings.length > 0).length },
        { value: 'live', label: 'Live', count: t?.live },
        { value: 'reserved', label: 'Reserved', count: t?.reserved },
        { value: 'live_unlinked', label: 'Not linked', count: t?.liveUnlinked },
        { value: 'added_reserved', label: 'Added', count: t?.added },
        { value: 'retired', label: 'Retired', count: t?.retired },
    ];

    return (
        <div className='min-w-0 space-y-3'>
            <PageTitle
                title='Transactions Manager'
                subtitle='Every MEMS transaction code and its state. Installed routes link to their reserved codes automatically on each deployment.'
                action={
                    <>
                        <Button variant='secondary' onClick={load} disabled={loading} aria-label='Refresh'>
                            <RefreshCw className='h-4 w-4' />
                            <span className='hidden sm:inline'>Refresh</span>
                        </Button>
                        <Button onClick={() => setAdding(true)} disabled={!data}>
                            <Plus className='h-4 w-4' />
                            Add code
                        </Button>
                    </>
                }
            />
            {error && <Alert tone='error'>{error}</Alert>}
            {!data && loading && <Spinner />}
            {t && (
                <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                    {([
                        ['Live codes', t.live, 'Reserved codes with installed routes'],
                        ['Reserved', t.reserved, 'Placeholders ready for future work'],
                        ['Not linked', t.liveUnlinked, 'Installed routes without a reserved code'],
                        ['Routes linked', `${t.linkedRoutes} / ${t.installedRoutes}`, 'Installed routes matched to a code'],
                    ] as const).map(([label, value, hint]) => (
                        <div key={label} className='rounded-xl border border-line bg-panel p-3'>
                            <p className='text-xs text-muted'>{label}</p>
                            <p className='mt-1 text-xl font-semibold text-ink'>{value}</p>
                            <p className='mt-0.5 text-[11px] leading-tight text-muted'>{hint}</p>
                        </div>
                    ))}
                </div>
            )}
            {data && (
                <Segmented label='View' value={view} onChange={setView} options={[{ value: 'transactions', label: 'Transactions' }, { value: 'accounts', label: 'GL account transactions' }, { value: 'gl', label: 'GL posting defaults' }, {value:'audit',label:'Financial integration audit'}]} />
            )}
            {data && view === 'gl' && <GlDefaultsView gl={data.gl} />}
            {data && view === 'audit' && <FinanceTransactionAudit />}
            {data && view === 'accounts' && <GlAccountTransactions />}
            {data && view === 'transactions' && (
                <>
                    <Segmented label='Transaction state' value={filter} options={filters} onChange={setFilter} />
                    <SelectField id='txn-module' label='Module' value={module} onChange={(e) => setModule(e.target.value)}>
                        <option value=''>All modules</option>
                        {data.modules.map((m) => (
                            <option key={m.code} value={m.code}>
                                {m.code} · {m.name}
                            </option>
                        ))}
                    </SelectField>
                    <RichTable
                        id='mems-transactions'
                        title='Transactions'
                        fileName='mems_transactions'
                        height='h-[calc(100dvh-14rem)]'
                        columns={columns}
                        rows={rows}
                        rowKey={(r) => r.code}
                        onRowClick={setSelected}
                        empty='No transactions in this view.'
                    />
                </>
            )}
            <p className='flex items-start gap-2 text-xs text-muted'>
                <ShieldCheck className='h-4 w-4 shrink-0' />
                Codes are permanent and never grant access. A reserved code runs nothing until its server handler is built, verified and linked.
            </p>

            {selected && (
                <DetailSheet
                    row={selected}
                    gl={data?.gl}
                    moduleName={moduleName.get(selected.module) ?? selected.module}
                    copied={copied === selected.code}
                    onCopy={() => void copy(selected.code)}
                    onRetire={() => retire(selected)}
                    onClose={() => setSelected(null)}
                />
            )}
            {adding && data && (
                <AddCodeSheet
                    data={data}
                    defaultModule={module}
                    onClose={() => setAdding(false)}
                    onSaved={(code) => {
                        setAdding(false);
                        setFilter('all');
                        load();
                        void copy(code);
                    }}
                />
            )}
            {sheet}
        </div>
    );
}

function accountFor(gl: GlDefaults | undefined, role: string): string {
    if (role === 'EXPENSE') return 'Line account (cost center allowed accounts)';
    const d = gl?.roles.find((r) => r.code === role)?.default;
    return d ? `${d.code} ${d.name}` : 'No default in the GL master';
}

function DetailSheet({ row, gl, moduleName, copied, onCopy, onRetire, onClose }: { row: Row; gl?: GlDefaults; moduleName: string; copied: boolean; onCopy: () => void; onRetire: () => void; onClose: () => void }) {
    return (
        <Sheet
            title={row.code}
            onClose={onClose}
            footer={
                <>
                    <Button variant='secondary' className='flex-1' onClick={onCopy}>
                        {copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
                        {copied ? 'Copied' : 'Copy code'}
                    </Button>
                    {row.source === 'mems_admin' && row.state === 'added_reserved' && (
                        <Button variant='danger' className='flex-1' onClick={onRetire}>
                            Retire
                        </Button>
                    )}
                </>
            }
        >
            <div className='flex flex-wrap items-center gap-2'>
                <Badge tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</Badge>
                <span className='text-xs text-muted'>{KIND_LABEL[row.kind]}</span>
            </div>
            <p className='text-base font-semibold text-ink'>{row.name}</p>
            <dl className='grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm'>
                <dt className='text-muted'>Module</dt>
                <dd className='text-ink'>{row.module} · {moduleName}</dd>
                <dt className='text-muted'>Submodule</dt>
                <dd className='text-ink'>{row.area} · {row.areaName}</dd>
                {row.action && (
                    <>
                        <dt className='text-muted'>Action</dt>
                        <dd className='text-ink'>{row.action} · {row.actionName}</dd>
                    </>
                )}
                {row.addedBy && (
                    <>
                        <dt className='text-muted'>Added</dt>
                        <dd className='text-ink'>{row.addedBy}{row.addedAt ? ` · ${new Date(row.addedAt).toLocaleDateString()}` : ''}</dd>
                    </>
                )}
                {row.reason && (
                    <>
                        <dt className='text-muted'>Reason</dt>
                        <dd className='break-words text-ink'>{row.reason}</dd>
                    </>
                )}
            </dl>
            <section className='space-y-1'>
                <h3 className='text-sm font-semibold text-ink'>Installed routes ({row.routes.length})</h3>
                {row.routes.length ? (
                    <ul className='space-y-1'>
                        {row.routes.map((r) => (
                            <li key={r} className='break-all rounded-lg bg-page px-3 py-2 font-mono text-xs text-soft'>{r}</li>
                        ))}
                    </ul>
                ) : (
                    <p className='text-sm text-muted'>Nothing is installed. This code is a placeholder and cannot run.</p>
                )}
            </section>
            {row.postings.length > 0 && (
                <section className='space-y-2'>
                    <h3 className='text-sm font-semibold text-ink'>General-ledger postings</h3>
                    {row.postings.map((p) => (
                        <div key={p.event} className='space-y-1 rounded-xl border border-line p-3'>
                            <div className='flex flex-wrap items-center gap-2'>
                                <span className='font-mono text-xs font-semibold text-ink'>{p.event}</span>
                                <Badge tone={p.state === 'live' ? 'brand' : 'muted'}>{p.state === 'live' ? 'Posting live' : 'Planned'}</Badge>
                            </div>
                            <p className='text-sm text-soft'>{p.label}</p>
                            <PostingLines side='Debit' roles={p.debit} gl={gl} />
                            <PostingLines side='Credit' roles={p.credit} gl={gl} />
                        </div>
                    ))}
                    <p className='text-xs text-muted'>Defaults come from the MEMS GL master. Each legal entity confirms its own accounts in Finance › GL accounts › Mapping (proposed and approved).</p>
                </section>
            )}
            {row.permissions.length > 0 && (
                <section className='space-y-1'>
                    <h3 className='text-sm font-semibold text-ink'>Route permissions</h3>
                    <p className='break-words font-mono text-xs text-soft'>{row.permissions.join(', ')}</p>
                </section>
            )}
        </Sheet>
    );
}

function AddCodeSheet({ data, defaultModule, onClose, onSaved }: { data: Catalogue; defaultModule: string; onClose: () => void; onSaved: (code: string) => void }) {
    const [module, setModule] = useState(defaultModule || 'FIN');
    const [area, setArea] = useState('');
    const [newArea, setNewArea] = useState('');
    const [newAreaName, setNewAreaName] = useState('');
    const [action, setAction] = useState('');
    const [newAction, setNewAction] = useState('');
    const [newActionName, setNewActionName] = useState('');
    const [name, setName] = useState('');
    const [reason, setReason] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const areas = data.areas.filter((a) => a.module === module);
    const areaCode = area === '__new' ? newArea.trim().toUpperCase() : area;
    const actionCode = action === '__new' ? newAction.trim().toUpperCase() : action;
    const code = module && areaCode && actionCode ? `${module}-${areaCode}-${actionCode}` : '';
    const exists = !!code && data.items.some((r) => r.code === code);

    const issues = {
        area: !area ? 'Choose a submodule.' : area === '__new' && !/^[A-Z0-9]{3,4}$/.test(areaCode) ? 'Use 3 or 4 capital letters or digits.' : area === '__new' && ['MOD', 'LEG'].includes(areaCode) ? 'MOD and LEG are reserved.' : area === '__new' && areas.some((a) => a.area === areaCode) ? 'This submodule already exists; choose it from the list.' : '',
        areaName: area === '__new' && (newAreaName.trim().length < 3 || newAreaName.trim().length > 60) ? 'Name the submodule (3 to 60 characters).' : '',
        action: !action ? 'Choose an action.' : action === '__new' && !/^[A-Z0-9]{2,4}$/.test(actionCode) ? 'Use 2 to 4 capital letters or digits.' : action === '__new' && data.actions.some((a) => a.code === actionCode) ? 'This action exists; choose it from the list.' : '',
        actionName: action === '__new' && (newActionName.trim().length < 3 || newActionName.trim().length > 40) ? 'Name the action (3 to 40 characters).' : '',
        name: name.trim().length < 3 || name.trim().length > 80 ? 'Describe the transaction in 3 to 80 characters.' : '',
        reason: reason.trim().length < 10 || reason.trim().length > 300 ? 'Give the reason in 10 to 300 characters.' : '',
        code: exists ? `${code} already exists.` : '',
    };
    const invalid = Object.values(issues).some(Boolean);
    const show = (k: keyof typeof issues) => (submitted ? issues[k] || undefined : undefined);

    const save = async () => {
        setSubmitted(true);
        setError('');
        if (invalid) return;
        setBusy(true);
        try {
            const res = await callBackend<{ code: string }>('/api/admin/transactions/code/add', {
                module, area: areaCode, areaName: area === '__new' ? newAreaName.trim() : '', action: actionCode,
                actionName: action === '__new' ? newActionName.trim() : '', name: name.trim(), reason: reason.trim(),
            });
            onSaved(res.code);
        } catch (e) {
            setError(messageOf(e, 'Could not reserve the code.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Sheet
            title='Add transaction code'
            onClose={onClose}
            footer={
                <>
                    <Button variant='secondary' className='flex-1' onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button className='flex-1' onClick={() => void save()} busy={busy}>
                        Reserve code
                    </Button>
                </>
            }
        >
            <p className='text-sm text-muted'>A reserved code is a placeholder for future work. It never runs and never grants access. Codes are permanent and are never reused.</p>
            <SelectField id='add-module' label='Module' required value={module} onChange={(e) => { setModule(e.target.value); setArea(''); }}>
                {data.modules.map((m) => (
                    <option key={m.code} value={m.code}>
                        {m.code} · {m.name}
                    </option>
                ))}
            </SelectField>
            <SelectField id='add-area' label='Submodule' required value={area} error={show('area')} onChange={(e) => setArea(e.target.value)}>
                <option value=''>Choose…</option>
                {areas.map((a) => (
                    <option key={a.area} value={a.area}>
                        {a.area} · {a.name}
                    </option>
                ))}
                <option value='__new'>New submodule…</option>
            </SelectField>
            {area === '__new' && (
                <div className='grid grid-cols-[6rem_minmax(0,1fr)] gap-2'>
                    <Field id='add-area-code' label='Code' maxLength={4} autoCapitalize='characters' value={newArea} error={show('area')} onChange={(e) => setNewArea(e.target.value.toUpperCase())} />
                    <Field id='add-area-name' label='Submodule name' maxLength={60} value={newAreaName} error={show('areaName')} onChange={(e) => setNewAreaName(e.target.value)} />
                </div>
            )}
            <SelectField id='add-action' label='Action' required value={action} error={show('action')} onChange={(e) => setAction(e.target.value)}>
                <option value=''>Choose…</option>
                {data.actions.map((a) => (
                    <option key={a.code} value={a.code}>
                        {a.code} · {a.name}
                    </option>
                ))}
                <option value='__new'>New action…</option>
            </SelectField>
            {action === '__new' && (
                <div className='grid grid-cols-[6rem_minmax(0,1fr)] gap-2'>
                    <Field id='add-action-code' label='Code' maxLength={4} autoCapitalize='characters' value={newAction} error={show('action')} onChange={(e) => setNewAction(e.target.value.toUpperCase())} />
                    <Field id='add-action-name' label='Action name' maxLength={40} value={newActionName} error={show('actionName')} onChange={(e) => setNewActionName(e.target.value)} />
                </div>
            )}
            <Field id='add-name' label='Transaction description' required maxLength={80} value={name} error={show('name')} placeholder='For example: Approve supplier credit note' onChange={(e) => setName(e.target.value)} />
            <label htmlFor='add-reason' className='block'>
                <span className='mb-1 block text-sm text-soft'>Reason for reserving *</span>
                <textarea id='add-reason' rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
                    className={`w-full rounded-xl border bg-panel p-3 text-base text-ink focus:outline-none ${show('reason') ? 'border-red-500/70' : 'border-line focus:border-brand'}`} />
                {show('reason') && <span role='alert' className='mt-1 block text-xs text-red-300'>{show('reason')}</span>}
            </label>
            <div className='rounded-xl border border-line bg-page p-3'>
                <p className='text-xs text-muted'>Code to be reserved</p>
                <p className='mt-1 font-mono text-lg font-semibold text-ink'>{code || '—'}</p>
                {show('code') && <p role='alert' className='mt-1 text-xs text-red-300'>{show('code')}</p>}
            </div>
            {error && <Alert tone='error'>{error}</Alert>}
        </Sheet>
    );
}

function PostingLines({ side, roles, gl }: { side: 'Debit' | 'Credit'; roles: string[]; gl?: GlDefaults }) {
    return (
        <dl className='grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-2 text-xs'>
            {roles.map((role, i) => (
                <div key={role} className='contents'>
                    <dt className='text-muted'>{i === 0 ? side : ''}</dt>
                    <dd className='break-words text-ink'>
                        <span className='font-mono'>{role}</span> · {accountFor(gl, role)}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

function GlDefaultsView({ gl }: { gl: GlDefaults }) {
    const roleColumns: Array<Column<GlRole>> = [
        { key: 'code', label: 'Role', value: (r) => r.code, render: (r) => <span className='whitespace-nowrap font-mono text-xs font-semibold text-ink'>{r.code}</span> },
        { key: 'label', label: 'Accounting role', value: (r) => r.label, render: (r) => <span className='block min-w-[12rem] whitespace-normal'>{r.label}</span> },
        { key: 'statement', label: 'Statement', value: (r) => (r.statement === 'BS' ? 'Balance sheet' : 'Profit and loss') },
        { key: 'state', label: 'State', value: (r) => (r.live ? 'Live' : 'Planned'), render: (r) => <Badge tone={r.live ? 'brand' : 'muted'}>{r.live ? 'Live' : 'Planned'}</Badge> },
        { key: 'default', label: 'Default GL account', value: (r) => (r.default ? `${r.default.code} ${r.default.name}` : ''), render: (r) => (r.default ? <span className='block min-w-[12rem] whitespace-normal'><span className='font-mono text-xs'>{r.default.code}</span> {r.default.name}</span> : <span className='text-amber-300'>No match in GL master</span>) },
        { key: 'basis', label: 'Matched by', value: (r) => (r.default ? (r.default.basis === 'gl_master_role' ? 'GL master role' : 'Account name') : '') },
        { key: 'note', label: 'Use', hidden: true, value: (r) => r.note },
    ];
    const eventColumns: Array<Column<GlEvent>> = [
        { key: 'event', label: 'Posting event', value: (e) => e.event, render: (e) => <span className='whitespace-nowrap font-mono text-xs font-semibold text-ink'>{e.event}</span> },
        { key: 'state', label: 'State', value: (e) => (e.state === 'live' ? 'Posting live' : 'Planned'), render: (e) => <Badge tone={e.state === 'live' ? 'brand' : 'muted'}>{e.state === 'live' ? 'Posting live' : 'Planned'}</Badge> },
        { key: 'label', label: 'Movement', value: (e) => e.label, render: (e) => <span className='block min-w-[12rem] whitespace-normal'>{e.label}</span> },
        { key: 'debit', label: 'Debit (default)', value: (e) => e.debit.map((r) => `${r} ${accountFor(gl, r)}`).join('; '), render: (e) => <span className='block min-w-[12rem] whitespace-normal text-xs'>{e.debit.map((r) => `${r} · ${accountFor(gl, r)}`).join('; ')}</span> },
        { key: 'credit', label: 'Credit (default)', value: (e) => e.credit.map((r) => `${r} ${accountFor(gl, r)}`).join('; '), render: (e) => <span className='block min-w-[12rem] whitespace-normal text-xs'>{e.credit.map((r) => `${r} · ${accountFor(gl, r)}`).join('; ')}</span> },
        { key: 'codes', label: 'Transaction codes', value: (e) => e.codes.join(', '), render: (e) => <span className='block whitespace-normal font-mono text-xs'>{e.codes.join(', ')}</span> },
        { key: 'source', label: 'Source', hidden: true, value: (e) => e.source },
        { key: 'routes', label: 'Installed routes', hidden: true, value: (e) => e.routes.join('; ') },
    ];
    const unmatched = gl.roles.filter((r) => !r.default).length;
    return (
        <div className='space-y-3'>
            {!gl.masterAccounts ? (
                <Alert tone='warn'>The MEMS GL master is not loaded, so no default accounts can be shown. Load it under Modules › FIN.</Alert>
            ) : (
                <p className='text-sm text-muted'>
                    MEMS GL master {gl.masterVersion ? `version ${gl.masterVersion}` : ''} · {gl.masterAccounts} accounts. {gl.roles.length - unmatched} of {gl.roles.length} roles have a default account
                    {unmatched ? `; ${unmatched} need an account added or tagged with its role in the GL master.` : '.'}
                </p>
            )}
            <RichTable id='mems-gl-events' title='Financial movements' fileName='mems_gl_posting_events' height='h-[26rem]' columns={eventColumns} rows={gl.events} rowKey={(e) => e.event} />
            <RichTable id='mems-gl-roles' title='Accounting roles and default accounts' fileName='mems_gl_role_defaults' height='h-[26rem]' columns={roleColumns} rows={gl.roles} rowKey={(r) => r.code} />
        </div>
    );
}
