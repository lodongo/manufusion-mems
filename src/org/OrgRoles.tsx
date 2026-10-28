import { useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, ClipboardCheck, Lock, Plus, Search, ShieldAlert, Sparkles } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field } from '../components/ui';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import RichTable, { type Column } from '../components/RichTable';
import { Screen, messageOf, useConfirm } from '../components/screen';
import type { OrgRole } from './types';
import RoleDocs, { DocStatusBadge, type RoleDoc } from './RoleDocs';
import SecurityInspector from './SecurityInspector';
import LevelRoles from './LevelRoles';

// Security roles: what each person can do in MEMS (permissions only). Job roles (ROL_ + 6 digits) describe the
// organization chart and are managed under Organization design.
//   Roles list         every role with its leftovers and segregation-of-duties flags
//   Role editor        permissions per module; sensitive rights need an acknowledgement; roles that combine duties
//                      which must stay apart need an acknowledged reason (audited)
//   Access review      which permissions are real, which are leftovers, cleanup, job role code renumbering
//   Recommended roles  ready-made, editable roles for the modules that are built
// Only rights that code enforces are ever offered (server side policy). Every change is audited on the server.

interface SodRule {
    id: string;
    a: string;
    b: string;
    why: string;
}
interface RoleItem extends OrgRole {
    jobRoles: string[];
    staleCount: number;
    conflicts: string[];
    docStatus: RoleDoc['status'];
}
interface ListResponse {
    roles: RoleItem[];
    catalogue: Array<{ module: string; name: string; permissions: Array<{ key: string; label: string; sensitive?: boolean }> }>;
    sod: SodRule[];
    sensitive: string[];
}

const BASE = 'organization_admin/roles';

export default function OrgRoles({ id }: { id?: string }) {
    if (id === 'inspector') return <SecurityInspector />;
    if (id === 'review') return <AccessReview />;
    if (id === 'recommended') return <RecommendedRoles />;
    if (id === 'levels') return <LevelRoles />;
    if (id?.startsWith('docs-')) return <RoleDocs roleId={id.slice(5)} back={BASE} />;
    return <RolesHome id={id} />;
}

function RolesHome({ id }: { id?: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<ListResponse>('/api/org/roles/list'));
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load roles.'}</Alert>;

    if (id) {
        const role = id === 'new' ? undefined : data.roles.find((r) => r.id === id);
        if (id !== 'new' && !role) return <Alert tone='error'>Role not found.</Alert>;
        return (
            <RoleForm
                key={id}
                role={role}
                data={data}
                onDone={() => {
                    reload();
                    navigate(BASE);
                }}
            />
        );
    }

    const columns: Array<Column<RoleItem>> = [
        { key: 'name', label: 'Security role', value: (r) => r.name, render: (r) => <span className='font-medium text-ink'>{r.name}</span> },
        { key: 'type', label: 'Type', value: (r) => (r.system ? 'System' : r.level ? 'Level' : 'Custom'), render: (r) => (r.system ? 'System' : r.level ? <Badge tone='brand'>{r.level.module} L{r.level.rank}</Badge> : <span className='text-muted'>Custom</span>) },
        { key: 'perms', label: 'Permissions', type: 'number', value: (r) => (r.permissions.includes('*') ? 9999 : r.permissions.length), render: (r) => (r.permissions.includes('*') ? 'All' : String(r.permissions.length)) },
        { key: 'users', label: 'Users', type: 'number', value: (r) => r.users },
        { key: 'jobs', label: 'Job roles', type: 'number', value: (r) => r.jobRoles.length },
        {
            key: 'issues',
            label: 'Needs attention',
            value: (r) => [r.staleCount ? `${r.staleCount} leftover` : '', r.conflicts.length ? 'duty conflict' : ''].filter(Boolean).join(', '),
            render: (r) =>
                r.staleCount || r.conflicts.length ? (
                    <span className='flex flex-wrap gap-1'>
                        {r.staleCount > 0 && <Badge tone='warn'>{r.staleCount} leftover</Badge>}
                        {r.conflicts.length > 0 && <Badge tone='danger'>Duty conflict</Badge>}
                    </span>
                ) : (
                    <span className='text-muted'>OK</span>
                ),
        },
        { key: 'rules', label: 'Rules', value: (r) => (r.docStatus === 'current' ? 'Documented' : r.docStatus === 'outdated' ? 'Needs review' : 'Missing'), render: (r) => <DocStatusBadge status={r.docStatus} /> },
        { key: 'desc', label: 'Description', value: (r) => r.description, hidden: true },
        { key: 'jobList', label: 'Mapped job roles', value: (r) => r.jobRoles.join('; '), hidden: true },
        { key: 'updated', label: 'Updated', type: 'date', value: (r) => r.updatedAt, hidden: true },
    ];
    const attention = data.roles.filter((r) => r.staleCount || r.conflicts.length).length;
    const undocumented = data.roles.filter((r) => !r.system && r.docStatus !== 'current').length;

    return (
        <Screen
            title='Security roles'
            subtitle='Permissions only. Job roles (ROL_ codes) describe your organization chart.'
            actions={
                <Button onClick={() => navigate(`${BASE}/new`)}>
                    <Plus className='h-4 w-4' />
                    <span>New</span>
                </Button>
            }
            toolbar={
                <nav aria-label='Security role sections' className='grid grid-cols-3 gap-1 rounded-xl border border-line p-1'>
                    <button type='button' aria-current='page' className='flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-brand px-2 text-sm font-medium text-onbrand'>
                        <ShieldAlert className='h-4 w-4 shrink-0' /><span className='truncate'>All roles</span>
                    </button>
                    <button type='button' onClick={() => navigate(`${BASE}/levels`)} className='flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-soft active:bg-panel'>
                        <Sparkles className='h-4 w-4 shrink-0' /><span className='truncate'>Level roles</span>
                    </button>
                    <button type='button' onClick={() => navigate(`${BASE}/review`)} className='flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-soft active:bg-panel'>
                        <ClipboardCheck className='h-4 w-4 shrink-0' /><span className='truncate'>Review</span>
                    </button>
                </nav>
            }
        >
            {attention > 0 && (
                <Alert tone='warn'>
                    {attention} role{attention === 1 ? '' : 's'} hold permissions that do nothing or combine duties that must stay apart.{' '}
                    <button type='button' className='font-semibold underline' onClick={() => navigate(`${BASE}/review`)}>
                        Review access
                    </button>
                </Alert>
            )}
            {data.roles.filter((r) => !r.system && !r.level).length > 0 && (
                <Alert tone='info'>
                    {data.roles.filter((r) => !r.system && !r.level).length} custom role(s). Use one ladder per module instead.{' '}
                    <button type='button' className='font-semibold underline' onClick={() => navigate(`${BASE}/levels`)}>Set up level roles</button>
                </Alert>
            )}
                        {undocumented > 0 && <Alert tone='info'>{undocumented} role{undocumented === 1 ? ' has' : 's have'} missing or outdated documentation. Standard template rules can be initialized without overwriting existing documentation. <StandardRuleDocsButton onDone={reload} /></Alert>}
            <RichTable<RoleItem>
                id='org.roles'
                title='Security roles'
                fileName='security-roles'
                columns={columns}
                rows={data.roles}
                rowKey={(r) => r.id}
                onRowClick={(r) => navigate(`${BASE}/${r.id}`)}
                empty='No security roles yet.'
                height='h-[calc(100dvh-19rem)]'
            />
        </Screen>
    );
}

function RoleForm({ role, data, onDone }: { role?: RoleItem; data: ListResponse; onDone: () => void }) {
    const isNew = !role;
    const locked = role?.id === 'org_super_admin';
    const [name, setName] = useState(role?.name ?? '');
    const [description, setDescription] = useState(role?.description ?? '');
    const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [ackSod, setAckSod] = useState<string[]>([]);
    const [sodReason, setSodReason] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const { ask, sheet } = useConfirm();

    const sensitive = useMemo(() => new Set(data.sensitive), [data.sensitive]);
    const offered = useMemo(() => new Set(data.catalogue.flatMap((g) => g.permissions.map((p) => p.key))), [data.catalogue]);
    const original = role?.permissions ?? [];
    const dropped = original.filter((k) => k !== '*' && !offered.has(k));
    const conflicts = data.sod.filter((r) => perms.includes(r.a) && perms.includes(r.b));
    const newSensitive = perms.filter((k) => sensitive.has(k) && !original.includes(k));
    const baseline = role?.id === 'default_security';
    const system = role?.system === true;

    const nameError = name.trim().length < 2 ? 'Enter a role name of at least 2 characters.' : name.trim().length > 60 ? 'Use 60 characters or fewer.' : '';
    const descError = description.length > 300 ? 'Use 300 characters or fewer.' : '';
    const sodError = conflicts.length && (!conflicts.every((c) => ackSod.includes(c.id)) || sodReason.trim().length < 10) ? 'Tick every conflict and give a reason of at least 10 characters.' : '';
    const invalid = (!system && (!!nameError || !!descError)) || !!sodError;

    const toggle = (key: string) => setPerms((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));
    const toggleGroup = (keys: string[], on: boolean) => setPerms((p) => (on ? Array.from(new Set([...p, ...keys])) : p.filter((x) => !keys.includes(x))));

    const save = async () => {
        await callBackend('/api/org/roles/save', {
            role: { id: role?.id, name: name.trim(), description: description.trim(), permissions: perms, acknowledgeSod: ackSod.filter((x) => conflicts.some((c) => c.id === x)), sodReason: conflicts.length ? sodReason.trim() : '', acknowledgeSensitive: newSensitive },
        });
        onDone();
    };

    const submit = () => {
        setSubmitted(true);
        setError('');
        if (invalid) return;
        if (newSensitive.length) {
            const labels = data.catalogue.flatMap((g) => g.permissions).filter((p) => newSensitive.includes(p.key)).map((p) => p.label);
            ask(
                {
                    title: 'Grant sensitive permissions?',
                    message: (
                        <div className='space-y-2'>
                            <p>These rights let people approve, post, delete, configure or administer. Everything is recorded in the audit trail.</p>
                            <ul className='list-disc space-y-1 pl-5'>
                                {labels.map((l) => (
                                    <li key={l}>{l}</li>
                                ))}
                            </ul>
                        </div>
                    ),
                    confirmLabel: 'Save role',
                    acknowledge: 'I understand what these permissions allow and who will hold them.',
                },
                async () => save()
            );
            return;
        }
        setBusy(true);
        save().catch((err) => {
            setError(messageOf(err, 'Could not save.'));
            setBusy(false);
        });
    };

    const remove = () => {
        if (!role) return;
        ask(
            { title: `Delete ${role.name}?`, message: 'The role is removed for good. It can only be deleted when no user holds it and no job role is mapped to it.', confirmLabel: 'Delete role', tone: 'danger' },
            async () => {
                await callBackend('/api/org/roles/delete', { id: role.id });
                onDone();
            }
        );
    };

    const q = search.trim().toLowerCase();

    return (
        <Screen
            title={isNew ? 'New security role' : role.name}
            eyebrow={role?.system ? 'System role' : undefined}
            onBack={() => navigate(BASE)}
            actions={
                locked ? (
                    <Button variant='secondary' onClick={() => navigate(`${BASE}/docs-${role!.id}`)}>
                        <BookOpen className='h-4 w-4' />
                        <span>Rules</span>
                    </Button>
                ) : (
                    <>
                        {!isNew && (
                            <Button variant='secondary' onClick={() => navigate(`${BASE}/docs-${role!.id}`)} aria-label='Role rules'>
                                <BookOpen className='h-4 w-4' />
                                <span className='hidden sm:inline'>Rules</span>
                            </Button>
                        )}
                        {!isNew && !system && (
                            <Button variant='danger' onClick={remove} disabled={busy}>
                                Delete
                            </Button>
                        )}
                        <Button onClick={submit} busy={busy}>
                            Save
                        </Button>
                    </>
                )
            }
            toolbar={
                locked ? undefined : (
                    <label className='relative block'>
                        <span className='sr-only'>Find a permission</span>
                        <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted' />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Find a permission' className='h-11 w-full rounded-xl border border-line bg-panel pl-9 pr-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none' />
                    </label>
                )
            }
        >
            {locked ? (
                <p className='flex items-center gap-2 rounded-xl border border-line bg-panel p-4 text-sm text-soft'>
                    <Lock className='h-4 w-4' />
                    The organization super admin always has every permission. It cannot be edited.
                </p>
            ) : (
                <>
                    {baseline && <Alert tone='info'>Required baseline: permissions selected here are automatically included when new security roles are created. This role cannot be deleted.</Alert>}
                    <section className='space-y-4 rounded-2xl border border-line bg-panel p-4'>
                        <Field id='role-name' label='Security role name' maxLength={60} value={name} disabled={system} error={submitted ? nameError : ''} onChange={(e) => setName(e.target.value)} />
                        <Field id='role-description' label='Description' maxLength={300} value={description} disabled={system} error={submitted ? descError : ''} hint={`${description.length}/300`} onChange={(e) => setDescription(e.target.value)} />
                    </section>

                    {dropped.length > 0 && (
                        <Alert tone='warn'>
                            {dropped.length} stored permission{dropped.length === 1 ? ' is' : 's are'} not offered to your organization any more and will be dropped when you save: {dropped.slice(0, 8).join(', ')}
                            {dropped.length > 8 ? '…' : ''}
                        </Alert>
                    )}

                    {conflicts.length > 0 && (
                        <section className='space-y-3 rounded-2xl border border-red-500/50 bg-panel p-4' aria-label='Segregation of duties'>
                            <p className='flex items-center gap-2 text-sm font-semibold text-red-300'>
                                <ShieldAlert className='h-4 w-4' /> Duties that must stay apart
                            </p>
                            {conflicts.map((c) => (
                                <label key={c.id} className='flex min-h-[44px] items-start gap-3 rounded-xl border border-line p-3 text-sm text-soft'>
                                    <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0 accent-emerald-500' checked={ackSod.includes(c.id)} onChange={() => setAckSod((a) => (a.includes(c.id) ? a.filter((x) => x !== c.id) : [...a, c.id]))} />
                                    <span>{c.why} I accept the risk for this role.</span>
                                </label>
                            ))}
                            <Field id='sod-reason' label='Reason (kept in the audit trail)' maxLength={300} value={sodReason} onChange={(e) => setSodReason(e.target.value)} error={submitted && sodError ? sodError : ''} hint='The system also stops one person from completing both steps of the same record.' />
                        </section>
                    )}

                    {data.catalogue.map((group) => {
                        const shown = group.permissions.filter((p) => !q || p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q));
                        if (!shown.length) return null;
                        const keys = group.permissions.map((p) => p.key);
                        const selected = keys.filter((k) => perms.includes(k)).length;
                        const expanded = open[group.module] ?? (!!q || selected > 0);
                        return (
                            <section key={group.module} className='rounded-2xl border border-line bg-panel'>
                                <div className='flex items-center gap-2 p-3'>
                                    <button type='button' aria-expanded={expanded} onClick={() => setOpen((o) => ({ ...o, [group.module]: !expanded }))} className='flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left'>
                                        <span className='font-mono text-sm text-brandsoft'>{group.module}</span>
                                        <span className='min-w-0 flex-1 truncate text-sm font-medium text-ink'>{group.name}</span>
                                        <span className='shrink-0 text-xs text-muted'>
                                            {selected}/{keys.length}
                                        </span>
                                    </button>
                                    <button type='button' onClick={() => toggleGroup(keys, selected !== keys.length)} className='min-h-[44px] shrink-0 px-2 text-xs font-semibold text-brandsoft'>
                                        {selected === keys.length ? 'Clear all' : 'Select all'}
                                    </button>
                                </div>
                                {expanded && (
                                    <div className='grid grid-cols-1 gap-2 border-t border-line p-3 sm:grid-cols-2'>
                                        {shown.map((p) => (
                                            <label key={p.key} className='flex min-h-[44px] items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm text-soft'>
                                                <input type='checkbox' className='h-5 w-5 shrink-0 accent-emerald-500' checked={perms.includes(p.key)} onChange={() => toggle(p.key)} />
                                                <span className='min-w-0 flex-1'>{p.label}</span>
                                                {sensitive.has(p.key) && (
                                                    <span title='Sensitive: approve, post, delete, configure or administer' className='shrink-0'>
                                                        <AlertTriangle className='h-4 w-4 text-amber-400' aria-label='Sensitive permission' />
                                                    </span>
                                                )}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </section>
                        );
                    })}
                    {error && <Alert tone='error'>{error}</Alert>}
                </>
            )}
            {sheet}
        </Screen>
    );
}

interface ReviewRole {
    id: string;
    name: string;
    system: boolean;
    users: number;
    jobRoles: string[];
    before: string[];
    after: string[];
    stale: Array<{ key: string; reason: string; replacedBy: string[] }>;
    wildcards: string[];
    inactive: string[];
    conflicts: Array<{ id: string; why: string }>;
    changed: boolean;
    deletable: boolean;
}
interface ReviewResponse {
    roles: ReviewRole[];
    summary: { roles: number; rolesWithLeftovers: number; leftoverPermissions: number; rolesWithConflicts: number; wildcardRoles: number; deletableRoles: number };
    built: Array<{ code: string; name: string; permissions: number }>;
    notBuilt: Array<{ code: string; name: string }>;
    notAdopted: string[];
    canCleanup: boolean;
}
interface CodesResponse {
    format: string;
    positions: number;
    legacy: number;
    alreadyCurrent: number;
    other: string[];
    clashes: string[];
    areas: Array<{ label: string; documents: number }>;
    renames: Array<{ from: string; to: string }>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'danger' }) {
    return (
        <div className='rounded-xl border border-line bg-panel p-3'>
            <p className={`text-2xl font-semibold ${value > 0 && tone === 'danger' ? 'text-red-300' : value > 0 && tone === 'warn' ? 'text-amber-300' : 'text-ink'}`}>{value}</p>
            <p className='text-xs text-muted'>{label}</p>
        </div>
    );
}

function AccessReview() {
    const { data, error, loading, reload } = useLoad(() => callBackend<ReviewResponse>('/api/org/roles/review'));
    const codes = useLoad(() => callBackend<CodesResponse>('/api/org/positions/codes/review').catch(() => null));
    const [info, setInfo] = useState('');
    const { ask, sheet } = useConfirm();

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the review.'}</Alert>;

    const s = data.summary;
    const columns: Array<Column<ReviewRole>> = [
        { key: 'name', label: 'Security role', value: (r) => r.name, render: (r) => <span className='font-medium text-ink'>{r.name}</span> },
        { key: 'users', label: 'Users', type: 'number', value: (r) => r.users },
        { key: 'jobs', label: 'Job roles', type: 'number', value: (r) => r.jobRoles.length },
        { key: 'stale', label: 'Leftovers', type: 'number', value: (r) => r.stale.length },
        { key: 'conflicts', label: 'Duty conflicts', type: 'number', value: (r) => r.conflicts.length },
        { key: 'wild', label: 'Wildcards', value: (r) => r.wildcards.join(', ') },
        { key: 'status', label: 'Result', value: (r) => (r.deletable ? 'Unused' : r.changed ? 'Will be cleaned' : 'OK'), render: (r) => (r.deletable ? <Badge tone='warn'>Unused</Badge> : r.changed ? <Badge tone='warn'>Will be cleaned</Badge> : <span className='text-muted'>OK</span>) },
        { key: 'leftovers', label: 'Leftover permissions', value: (r) => r.stale.map((x) => x.key).join('; '), hidden: true },
        { key: 'why', label: 'Why they go', value: (r) => r.stale.map((x) => `${x.key}: ${x.reason}`).join(' | '), hidden: true },
        { key: 'inactive', label: 'Module not adopted', value: (r) => r.inactive.join('; '), hidden: true },
    ];

    const clean = (deleteUnused: boolean) =>
        ask(
            {
                title: deleteUnused ? 'Clean up permissions and delete unused roles?' : 'Clean up permissions?',
                message: (
                    <div className='space-y-2'>
                        <p>
                            {s.leftoverPermissions} leftover permission{s.leftoverPermissions === 1 ? '' : 's'} in {s.rolesWithLeftovers} role{s.rolesWithLeftovers === 1 ? '' : 's'} are removed. Older module-wide maintenance rights are replaced by the exact activities they covered, so nobody
                            gains or loses a working right.
                        </p>
                        {deleteUnused && <p>{s.deletableRoles} custom role{s.deletableRoles === 1 ? '' : 's'} with no users, no job role mapping and nothing left to grant will be deleted.</p>}
                        <p>Each role change is written to the audit trail with before and after.</p>
                    </div>
                ),
                confirmLabel: 'Clean up',
                tone: 'danger',
                reason: { label: 'Reason', minLength: 10, placeholder: 'For example: quarterly access review' },
                phrase: 'CLEAN UP',
            },
            async (reason) => {
                const res = await callBackend<{ updated: number; removedPermissions: number; deleted: number }>('/api/org/roles/cleanup', { confirm: true, reason, deleteUnused });
                setInfo(`${res.updated} role(s) updated, ${res.removedPermissions} permission(s) removed, ${res.deleted} unused role(s) deleted.`);
                reload();
            }
        );

    const renumber = () => {
        const c = codes.data;
        if (!c) return;
        ask(
            {
                title: 'Renumber job roles?',
                message: (
                    <div className='space-y-2'>
                        <p>
                            {c.legacy} job role{c.legacy === 1 ? '' : 's'} change to {c.format.replace('000000', 'NNNNNN')} (the number stays, for example {c.renames[0]?.from} becomes {c.renames[0]?.to}).
                        </p>
                        <p>Reporting lines, user assignments, site role selections, manager roles and workflow approver steps are updated together. Do this when nobody is editing the organization design.</p>
                        {c.areas.length > 0 && <p>Documents to update: {c.areas.map((a) => `${a.label} ${a.documents}`).join(', ')}.</p>}
                    </div>
                ),
                confirmLabel: 'Renumber',
                tone: 'danger',
                reason: { label: 'Reason', minLength: 10 },
                phrase: 'RENUMBER',
            },
            async (reason) => {
                const res = await callBackend<{ renamed: number; documents: number }>('/api/org/positions/codes/apply', { confirm: true, reason });
                setInfo(`${res.renamed} job role(s) renumbered, ${res.documents} document(s) updated.`);
                codes.reload();
            }
        );
    };

    return (
        <Screen
            title='Access review'
            subtitle='Which permissions are real, and which roles need attention'
            onBack={() => navigate(BASE)}
            actions={
                data.canCleanup ? (
                    <Button onClick={() => clean(false)} disabled={s.rolesWithLeftovers === 0}>
                        Clean up
                    </Button>
                ) : undefined
            }
        >
            {info && <Alert tone='success'>{info}</Alert>}
            <Button variant='secondary' className='w-full' onClick={() => navigate(BASE + '/inspector')}>
                <ShieldAlert className='h-4 w-4' /> Inspect user access and security events
            </Button>
            {!data.canCleanup && <Alert tone='info'>Only a super admin can clean up roles. You can review and download this list.</Alert>}
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
                <Stat label='Security roles' value={s.roles} />
                <Stat label='Leftover permissions' value={s.leftoverPermissions} tone='warn' />
                <Stat label='Roles with duty conflicts' value={s.rolesWithConflicts} tone='danger' />
                <Stat label='Roles with wildcards' value={s.wildcardRoles} tone='warn' />
                <Stat label='Unused roles' value={s.deletableRoles} tone='warn' />
                <Stat label='Roles to clean' value={s.rolesWithLeftovers} tone='warn' />
            </div>
            {data.canCleanup && s.deletableRoles > 0 && (
                <Button variant='secondary' className='w-full' onClick={() => clean(true)}>
                    Clean up and delete {s.deletableRoles} unused role{s.deletableRoles === 1 ? '' : 's'}
                </Button>
            )}

            <section className='space-y-2 rounded-2xl border border-line bg-panel p-4 text-sm text-soft'>
                <p className='font-semibold text-ink'>What can be granted today</p>
                <p>
                    {data.built.map((m) => `${m.code} (${m.permissions})`).join(', ') || 'Nothing yet'}. Each right is enforced by the system.
                </p>
                {data.notBuilt.length > 0 && <p className='text-muted'>No permissions offered yet, because these modules have no screens or actions: {data.notBuilt.map((m) => m.code).join(', ')}. They appear here as soon as the module ships.</p>}
                {data.notAdopted.length > 0 && <p className='text-muted'>Built but not adopted by your organization: {data.notAdopted.join(', ')}.</p>}
                <p className='text-muted'>Delegation and Chart of authority permissions are withheld until their screens exist, so a role can never hold a right that does nothing.</p>
            </section>

            <RichTable<ReviewRole> id='org.roles.review' title='Role review' fileName='security-role-review' columns={columns} rows={data.roles} rowKey={(r) => r.id} onRowClick={(r) => navigate(`${BASE}/${r.id}`)} empty='No roles to review.' height='h-[calc(100dvh-26rem)]' />

            {codes.data && (
                <section className='space-y-2 rounded-2xl border border-line bg-panel p-4 text-sm text-soft'>
                    <p className='font-semibold text-ink'>Job role codes</p>
                    {codes.data.legacy === 0 ? (
                        <p>All {codes.data.positions} job roles use the ROL_ + 6 digit code. New roles continue from the database counter.</p>
                    ) : (
                        <>
                            <p>
                                {codes.data.legacy} of {codes.data.positions} job roles still use a short code such as {codes.data.renames[0]?.from}. They can be renumbered to the six digit form.
                            </p>
                            {codes.data.clashes.length > 0 && <Alert tone='error'>Cannot renumber yet: {codes.data.clashes.join(', ')} already exist.</Alert>}
                            <Button variant='secondary' className='w-full' onClick={renumber} disabled={codes.data.clashes.length > 0}>
                                Renumber job roles
                            </Button>
                        </>
                    )}
                </section>
            )}
            {sheet}
        </Screen>
    );
}

interface Template {
    id: string;
    module: string;
    name: string;
    description: string;
    permissions: string[];
    exists: boolean;
    moduleAdopted: boolean;
    grantable: boolean;
    conflicts: number;
}

function RecommendedRoles() {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ templates: Template[] }>('/api/org/roles/templates'));
    const [picked, setPicked] = useState<string[]>([]);
    const [info, setInfo] = useState('');
    const { ask, sheet } = useConfirm();
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load recommended roles.'}</Alert>;

    const blocked = (t: Template) => (t.exists ? 'Already created' : !t.moduleAdopted ? `${t.module} not adopted` : !t.grantable ? 'Carries rights you do not hold' : '');
    const usable = data.templates.filter((t) => !blocked(t));
    const apply = () =>
        ask(
            {
                title: `Adopt ${picked.length} standard role${picked.length === 1 ? '' : 's'}?`,
                message: 'Adopt these suggested roles without changing existing role assignments. Templates can be customized afterwards. Existing templates are preserved.',
                confirmLabel: 'Adopt roles',
            },
            async () => {
                const res = await callBackend<{ created: string[]; skipped: Array<{ id: string; reason: string }> }>('/api/org/roles/templates/apply', { ids: picked });
                setInfo(`Created ${res.created.length} role(s).${res.skipped.length ? ` Skipped ${res.skipped.length}: ${res.skipped.map((x) => x.reason).join(' ')}` : ''}`);
                setPicked([]);
                reload();
            }
        );

    return (
        <Screen
            title='Adopt Standard Security Roles'
            subtitle='One-click adoption of transaction-ready roles for your enabled modules. Existing roles are preserved.'
            onBack={() => navigate(BASE)}
            actions={
                <Button onClick={apply} disabled={picked.length === 0}>
                    Create {picked.length || ''}
                </Button>
            }
            toolbar={
                <div className='flex gap-2'>
                    <Button variant='secondary' className='flex-1' onClick={() => setPicked(usable.map((t) => t.id))}>
                        Adopt all available
                    </Button>
                    <Button variant='secondary' className='flex-1' onClick={() => setPicked([])}>
                        Clear
                    </Button>
                </div>
            }
        >
            {info && <Alert tone='success'>{info}</Alert>}
            {data.templates.map((t) => {
                const why = blocked(t);
                return (
                    <label key={t.id} className={`flex min-h-[44px] items-start gap-3 rounded-2xl border border-line bg-panel p-3 ${why ? 'opacity-60' : ''}`}>
                        <input type='checkbox' className='mt-1 h-5 w-5 shrink-0 accent-emerald-500' disabled={!!why} checked={picked.includes(t.id)} onChange={() => setPicked((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))} />
                        <span className='min-w-0 flex-1'>
                            <span className='flex flex-wrap items-center gap-2'>
                                <span className='font-mono text-xs text-brandsoft'>{t.module}</span>
                                <span className='text-sm font-medium text-ink'>{t.name}</span>
                                {why && <Badge tone='muted'>{why}</Badge>}
                            </span>
                            <span className='mt-0.5 block text-xs text-muted'>{t.description}</span>
                            <span className='mt-0.5 block text-xs text-muted'>{t.permissions.length} permissions</span>
                        </span>
                    </label>
                );
            })}
            {sheet}
        </Screen>
    );
}

function StandardRuleDocsButton({onDone}:{onDone:()=>void}) {
    const [busy,setBusy]=useState(false);
    const [result,setResult]=useState('');
    return <span className='inline-flex flex-wrap items-center gap-2'>
        <button type='button' disabled={busy} className='font-semibold underline' onClick={async()=>{
            setBusy(true);
            try {
                const response=await callBackend<{created:number}>('/api/org/roles/docs/fill-standard');
                setResult(`Created ${response.created} missing standard rule documents.`);
                onDone();
            } catch(e) {setResult(messageOf(e));}
            finally {setBusy(false);}
        }}>{busy?'Preparing rules…':'Prepare standard rules'}</button>
        {result&&<span>{result}</span>}
    </span>;
}
