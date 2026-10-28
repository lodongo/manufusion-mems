import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';
import RichTable, { type Column } from '../components/RichTable';
import { Alert } from '../components/ui';
import { Segmented, useConfirm } from '../components/screen';
import Sheet from '../components/Sheet';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { appPrompt } from '../components/dialogs';

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
                    {canAssign && item.permissions.length > 0 ? <GrantToRole item={item} onSaved={onSaved} /> : <p className='text-xs text-muted'>Change it on Security roles; segregation of duties and sensitive-right checks apply there.</p>}
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

type RoleRow = { id: string; name: string; description: string; permissions: string[]; system: boolean };
type RoleList = { roles: RoleRow[]; catalogue: Array<{ permissions: Array<{ key: string }> }>; sensitive: string[]; sod: Array<{ id: string; a: string; b: string; why: string }> };
const holds = (perms: string[], key: string) => perms.some((p) => p === key || p === '*' || (p.endsWith('.*') && key.startsWith(p.slice(0, -1))));
const NOT_EDITABLE = new Set(['org_super_admin', 'org_user', 'default_security']);

// Grants a live transaction to a security role by adding its permission to that role, through the normal security
// role save (ADM.roles): you cannot grant rights you do not hold, nor edit your own role; duty conflicts need an
// audited business reason, sensitive rights an explicit confirmation, and the change reason goes into the audit trail.
function GrantToRole({ item, onSaved }: { item: Item; onSaved: () => void }) {
    const list = useLoad(() => callBackend<RoleList>('/api/org/roles/list'), [item.code]);
    const [roleId, setRoleId] = useState('');
    const [perms, setPerms] = useState<string[]>(item.permissions.length === 1 ? item.permissions : []);
    const [q, setQ] = useState('');
    const [failure, setFailure] = useState('');
    const confirm = useConfirm();
    if (list.loading && !list.data) return <Spinner />;
    if (list.error || !list.data) return <Alert tone='error'>{list.error || 'Security roles could not be loaded.'}</Alert>;
    const data = list.data;
    const valid = new Set(data.catalogue.flatMap((g) => g.permissions.map((p) => p.key)));
    const granting = new Set(item.granting.map((r) => r.id));
    const pre = new Set(item.preassigned.map((r) => r.id));
    const candidates = data.roles.filter((r) => !NOT_EDITABLE.has(r.id) && !granting.has(r.id) && (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase())))
        .sort((a, b) => Number(pre.has(b.id)) - Number(pre.has(a.id)) || a.name.localeCompare(b.name));
    const role = data.roles.find((r) => r.id === roleId);
    const ungrantable = perms.filter((p) => !valid.has(p));
    const sensitive = role ? perms.filter((p) => data.sensitive.includes(p) && !role.permissions.includes(p)) : [];
    const grant = () => {
        if (!role) return;
        setFailure('');
        confirm.ask(
            {
                title: `Grant ${item.code} to ${role.name}`,
                message: `Adds ${perms.join(', ')} to ${role.name}. Everyone holding ${role.name} can then run ${item.name}.${sensitive.length ? ` Sensitive right${sensitive.length === 1 ? '' : 's'}: ${sensitive.join(', ')}.` : ''} Duty conflicts are checked when saving.`,
                confirmLabel: 'Grant',
                reason: { label: 'Reason', minLength: 10 },
            },
            async (reason) => {
                try {
                    const permissions = [...new Set([...role.permissions, ...perms])];
                    // Duties that must stay apart: each conflict is named and needs its own audited business reason.
                    const conflicts = data.sod.filter((r) => holds(permissions, r.a) && holds(permissions, r.b));
                    let sodReason = '';
                    if (conflicts.length) {
                        const answer = await appPrompt(`Segregation of duties: ${conflicts.map((c) => c.why).join(' ')}\n\nGive the business reason for combining these duties in ${role.name} (10 to 300 characters). It is recorded in the audit trail.`);
                        if (answer === null) { setFailure('Not granted. The duty conflict was not acknowledged.'); return; }
                        sodReason = answer.trim();
                    }
                    await callBackend('/api/org/roles/save', {
                        role: { id: role.id, name: role.name, description: role.description, permissions, acknowledgeSensitive: sensitive, acknowledgeSod: conflicts.map((c) => c.id), sodReason },
                        reason: `Transaction access ${item.code}: ${reason}`,
                    });
                    onSaved();
                } catch (e) {
                    setFailure(e instanceof Error ? e.message : 'The role could not be updated.');
                }
            },
        );
    };
    return (
        <div className='mt-3 space-y-2 rounded-xl border border-line p-3'>
            <h3 className='text-sm font-semibold text-ink'>Grant to a security role</h3>
            {item.permissions.length > 1 && (
                <fieldset className='space-y-1'>
                    <legend className='text-xs text-muted'>Rights to add (each one is a different duty)</legend>
                    {item.permissions.map((p) => (
                        <label key={p} className='flex min-h-11 items-center gap-3 text-sm text-ink'>
                            <input type='checkbox' className='h-5 w-5' checked={perms.includes(p)} onChange={(e) => setPerms((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))} />
                            <span className='font-mono text-xs'>{p}</span>
                        </label>
                    ))}
                </fieldset>
            )}
            <input aria-label='Find a security role to grant' value={q} onChange={(e) => setQ(e.target.value)} placeholder='Find a security role' className='min-h-12 w-full rounded-xl border border-line bg-page px-3 text-base text-ink placeholder:text-muted' />
            <ul className='max-h-56 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line'>
                {candidates.map((r) => (
                    <li key={r.id}>
                        <label className='flex min-h-12 items-center gap-3 px-3 text-sm text-ink'>
                            <input type='radio' name='grant-role' className='h-5 w-5' checked={roleId === r.id} onChange={() => setRoleId(r.id)} />
                            <span className='min-w-0 flex-1 truncate'>{r.name}</span>
                            {pre.has(r.id) && <Badge tone='muted'>Pre-assigned</Badge>}
                        </label>
                    </li>
                ))}
                {!candidates.length && <li className='p-3 text-xs text-muted'>No other security role to grant.</li>}
            </ul>
            {ungrantable.length > 0 && <Alert tone='warn'>{ungrantable.join(', ')} cannot be granted through security roles.</Alert>}
            {failure && <Alert tone='error'>{failure}</Alert>}
            <Button className='w-full' disabled={!role || !perms.length || ungrantable.length > 0} onClick={grant}>Grant {perms.length ? perms.join(', ') : 'access'}{role ? ` to ${role.name}` : ''}</Button>
            {confirm.sheet}
        </div>
    );
}
