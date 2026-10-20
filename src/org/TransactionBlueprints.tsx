import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';
import RichTable, { type Column } from '../components/RichTable';
import { Alert } from '../components/ui';
import { Segmented, useConfirm } from '../components/screen';
import Sheet from '../components/Sheet';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';

// Organization › Transaction access
// Every MEMS transaction in the organization's modules, with its state and who can run it:
//   live       access follows the transaction's permission, granted through security roles (Security roles page)
//   reserved   a placeholder: security roles can be pre-assigned now (ADM.roles, reason, audited) so access is ready to
//              review when the transaction goes live. Pre-assigning grants nothing that can run.

type Item = {
    code: string; module: string; moduleName: string; area: string; areaName: string; action: string; actionName: string; name: string;
    state: string; adopted: boolean; permissions: string[]; routes: number;
    granting: Array<{ id: string; name: string }>; preassigned: Array<{ id: string; name: string }>;
    preassignedAt: string; preassignedBy: string; glAccounts: number;
    postings: Array<{ event: string; label: string; state: string }>;
};
type Data = { items: Item[]; roles: Array<{ id: string; name: string }>; can: { assign: boolean }; totals: { codes: number; live: number; adopted: number; preassigned: number } };
type Filter = 'adopted' | 'live' | 'reserved' | 'financial' | 'all';

const isLive = (i: Item) => i.state === 'live';

export default function TransactionBlueprints() {
    const { data, error, loading, reload } = useLoad(() => callBackend<Data>('/api/org/transactions/access/list', {}), []);
    const [filter, setFilter] = useState<Filter>('adopted');
    const [selected, setSelected] = useState<Item | null>(null);
    const rows = useMemo(() => (data?.items ?? []).filter((i) => (filter === 'all' ? true : filter === 'live' ? i.adopted && isLive(i) : filter === 'reserved' ? i.adopted && !isLive(i) : filter === 'financial' ? i.adopted && (i.glAccounts > 0 || i.postings.length > 0) : i.adopted)), [data, filter]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Unable to load transactions.'}</Alert>;
    const columns: Array<Column<Item>> = [
        { key: 'code', label: 'Code', value: (i) => i.code, render: (i) => <span className='whitespace-nowrap font-mono text-xs font-semibold text-ink'>{i.code}</span> },
        { key: 'state', label: 'State', value: (i) => (isLive(i) ? 'Live' : 'Reserved'), render: (i) => <Badge tone={isLive(i) ? 'brand' : 'muted'}>{isLive(i) ? 'Live' : 'Reserved'}</Badge> },
        { key: 'name', label: 'Transaction', value: (i) => i.name, render: (i) => <span className='block min-w-[12rem] max-w-[20rem] whitespace-normal'>{i.name}</span> },
        { key: 'module', label: 'Module', value: (i) => `${i.module} ${i.moduleName}`, render: (i) => <span title={i.moduleName}>{i.module}</span> },
        { key: 'area', label: 'Submodule', value: (i) => `${i.area} ${i.areaName}`, render: (i) => <span className='block min-w-[9rem] whitespace-normal'>{i.areaName}</span> },
        { key: 'action', label: 'Action', value: (i) => i.actionName || i.action },
        { key: 'access', label: 'Access', value: (i) => (isLive(i) ? i.granting.map((r) => r.name).join(', ') : i.preassigned.map((r) => r.name).join(', ')), render: (i) => <span className='block min-w-[10rem] max-w-[16rem] whitespace-normal text-xs'>{isLive(i) ? (i.granting.map((r) => r.name).join(', ') || (i.permissions.length ? 'No role yet' : 'Ownership and workflow rules')) : i.preassigned.length ? `Pre-assigned: ${i.preassigned.map((r) => r.name).join(', ')}` : 'Not configured'}</span> },
        { key: 'permission', label: 'Permission', value: (i) => i.permissions.join(', '), render: (i) => <span className='block max-w-[14rem] whitespace-normal break-words font-mono text-[11px]'>{i.permissions.join(', ') || '—'}</span> },
        { key: 'gl', label: 'GL accounts', type: 'number', value: (i) => i.glAccounts },
        { key: 'adopted', label: 'Module adopted', value: (i) => (i.adopted ? 'Yes' : 'No'), hidden: true },
        { key: 'routes', label: 'Installed routes', type: 'number', value: (i) => i.routes, hidden: true },
    ];
    return (
        <section className='space-y-3'>
            <div className='space-y-1'>
                <h2 className='text-lg font-semibold text-ink'>Transaction access</h2>
                <p className='text-sm text-soft'>Every transaction of your modules, mapped to its module and submodule. Live transactions follow their permission through security roles. Reserved transactions are ready to configure: pre-assign the security roles that should receive them when they go live.</p>
            </div>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                {([
                    ['Transactions', data.totals.adopted, 'In your adopted modules'],
                    ['Live', data.items.filter((i) => i.adopted && isLive(i)).length, 'Running today'],
                    ['Reserved', data.items.filter((i) => i.adopted && !isLive(i)).length, 'Ready to configure'],
                    ['Pre-assigned', data.totals.preassigned, 'Reserved with security roles'],
                ] as const).map(([label, value, hint]) => (
                    <div key={label} className='rounded-xl border border-line bg-panel p-3'>
                        <p className='text-xs text-muted'>{label}</p>
                        <p className='mt-1 text-xl font-semibold text-ink'>{value}</p>
                        <p className='mt-0.5 text-[11px] leading-tight text-muted'>{hint}</p>
                    </div>
                ))}
            </div>
            <Segmented label='Transactions' value={filter} onChange={setFilter} options={[
                { value: 'adopted', label: 'My modules' },
                { value: 'live', label: 'Live' },
                { value: 'reserved', label: 'Reserved' },
                { value: 'financial', label: 'Financial' },
                { value: 'all', label: 'All MEMS' },
            ]} />
            <RichTable id='org-transaction-access' title='Transactions' fileName='transaction_access' height='h-[calc(100dvh-22rem)]' columns={columns} rows={rows} rowKey={(i) => i.code} onRowClick={setSelected} empty='No transactions in this view.' />
            <p className='flex items-start gap-2 text-xs text-muted'>
                <ShieldCheck className='h-4 w-4 shrink-0' />
                Listing or pre-assigning never grants access to anything that runs. Every change needs ADM.roles and a reason, and is recorded in the audit trail.
            </p>
            {selected && <AccessSheet item={selected} roles={data.roles} canAssign={data.can.assign} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); reload(); }} />}
        </section>
    );
}

function AccessSheet({ item, roles, canAssign, onClose, onSaved }: { item: Item; roles: Array<{ id: string; name: string }>; canAssign: boolean; onClose: () => void; onSaved: () => void }) {
    const [chosen, setChosen] = useState<string[]>(item.preassigned.map((r) => r.id));
    const [q, setQ] = useState('');
    const confirm = useConfirm();
    const live = isLive(item);
    const dirty = JSON.stringify([...chosen].sort()) !== JSON.stringify(item.preassigned.map((r) => r.id).sort());
    const shown = roles.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.toLowerCase()));
    const save = () =>
        confirm.ask(
            { title: `Pre-assign roles to ${item.code}`, message: 'The roles are recorded against this reserved transaction for review when it goes live. Nothing is granted now.', confirmLabel: 'Save', reason: { label: 'Reason', minLength: 10 } },
            async (reason) => {
                await callBackend('/api/org/transactions/access/save', { code: item.code, roleIds: chosen, reason });
                onSaved();
            },
        );
    return (
        <Sheet title={item.code} onClose={onClose} footer={!live && canAssign ? <Button className='flex-1' disabled={!dirty} onClick={save}>Save pre-assignment</Button> : undefined}>
            <div className='flex flex-wrap items-center gap-2'>
                <Badge tone={live ? 'brand' : 'muted'}>{live ? 'Live' : 'Reserved'}</Badge>
                <span className='text-xs text-muted'>{item.module} · {item.moduleName} › {item.areaName} › {item.actionName || item.action}</span>
            </div>
            <p className='text-base font-semibold text-ink'>{item.name}</p>
            {item.glAccounts > 0 && <p className='text-sm text-soft'>Posts to {item.glAccounts} account{item.glAccounts === 1 ? '' : 's'} of the MEMS GL master by default (Finance › GL Accounts › Account transactions).</p>}
            {live ? (
                <section className='space-y-1'>
                    <h3 className='text-sm font-semibold text-ink'>Who can run it</h3>
                    <p className='text-sm text-soft'>{item.permissions.length ? <>Permission <span className='font-mono'>{item.permissions.join(', ')}</span>, granted by:</> : 'Ownership, site and workflow rules of the transaction itself.'}</p>
                    {item.permissions.length > 0 && (item.granting.length ? <ul className='space-y-1'>{item.granting.map((r) => <li key={r.id} className='rounded-lg border border-line px-3 py-2 text-sm text-ink'>{r.name}</li>)}</ul> : <p className='text-sm text-amber-300'>No security role grants it yet.</p>)}
                    <p className='text-xs text-muted'>Change it on Security roles; segregation of duties and sensitive-right checks apply there.</p>
                </section>
            ) : (
                <section className='space-y-2'>
                    <h3 className='text-sm font-semibold text-ink'>Pre-assigned security roles</h3>
                    {item.preassignedAt && <p className='text-xs text-muted'>Last changed {new Date(item.preassignedAt).toLocaleString()} by {item.preassignedBy}</p>}
                    {!canAssign && <p className='text-sm text-muted'>{item.preassigned.map((r) => r.name).join(', ') || 'None'}. Changing it needs ADM.roles.</p>}
                    {canAssign && (
                        <>
                            <input aria-label='Find a security role' value={q} onChange={(e) => setQ(e.target.value)} placeholder='Find a security role' className='min-h-12 w-full rounded-xl border border-line bg-page px-3 text-base text-ink placeholder:text-muted' />
                            <ul className='max-h-72 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line'>
                                {shown.map((r) => (
                                    <li key={r.id}>
                                        <label className='flex min-h-12 items-center gap-3 px-3 text-sm text-ink'>
                                            <input type='checkbox' className='h-5 w-5' checked={chosen.includes(r.id)} onChange={(e) => setChosen((cur) => (e.target.checked ? [...cur, r.id] : cur.filter((x) => x !== r.id)))} />
                                            <span className='min-w-0 flex-1 truncate'>{r.name}</span>
                                        </label>
                                    </li>
                                ))}
                                {!shown.length && <li className='p-3 text-xs text-muted'>No security role matches.</li>}
                            </ul>
                        </>
                    )}
                </section>
            )}
            {confirm.sheet}
        </Sheet>
    );
}
