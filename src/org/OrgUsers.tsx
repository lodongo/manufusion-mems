import { useState, type FormEvent } from 'react';
import { Lock, Plus, UserRound } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import { fmtDate } from '../admin/format';
import { Badge, Button, Card, Empty, PageTitle, Spinner, useLoad } from '../admin/kit';
import { passwordProblem } from '../lib/password';
import ResetPassword from '../admin/ResetPassword';
import UserScope from './UserScope';
import RoleCoreSkills from './RoleCoreSkills';
import type { OrgRole } from './types';

interface OrgUser {
    uid: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
    role: string;
    status: string;
    roleExpiresAt?: string;
    jobRoles?: string[];
    skillCodes?: string[];
    lastLoginAt: string;
    isCreator?: boolean;
    photoUrl?: string;
}

interface AdminPolicy {
    designated: number;
    active: number;
    maximum: number;
    minimumActive: number;
    canManage: boolean;
}

function UserAvatar({ user }: { user: OrgUser }) {
    const [imageFailed, setImageFailed] = useState(false);
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;

    const administrator = user.role === 'org_super_admin' || user.role === 'org_admin';

    return (
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-panel ${administrator ? 'border-red-500' : 'border-line'}`} aria-label={'Profile photo: ' + name}>
            {user.photoUrl && !imageFailed ? (
                <img
                    src={user.photoUrl}
                    alt={name}
                    loading='lazy'
                    className='h-full w-full object-cover'
                    onError={() => setImageFailed(true)}
                />
            ) : (
                <UserRound className='h-6 w-6 text-muted' aria-hidden='true' />
            )}
        </span>
    );
}

export default function OrgUsers({ id, myUid, myRole, canRoles }: { id?: string; myUid: string; myRole: string; canRoles: boolean }) {
    const users = useLoad(() => callBackend<{ users: OrgUser[]; domain: string; adminPolicy: AdminPolicy }>('/api/org/users/list'));
    const roles = useLoad(() => (canRoles ? callBackend<{ roles: OrgRole[] }>('/api/org/roles/list') : Promise.resolve({ roles: [] as OrgRole[] })));
    const roleName = (rid: string) => roles.data?.roles.find((r) => r.id === rid)?.name ?? (rid === 'org_super_admin' ? 'Organization super admin' : rid === 'org_user' ? 'Standard user' : rid);

    if (users.loading && !users.data) return <Spinner />;
    if (users.error || !users.data) return <Alert tone='error'>{users.error || 'Could not load users.'}</Alert>;

    const policy = users.data.adminPolicy;
    if (id) {
        const isNew = id === 'new' || id === 'new-admin';
        const user = isNew ? undefined : users.data.users.find((u) => u.uid === id);
        if (!isNew && !user) return <Alert tone='error'>User not found.</Alert>;
        const roleOptions = roles.data?.roles.length
            ? roles.data.roles
            : [
                  { id: 'org_user', name: 'Standard user' },
                  { id: 'org_super_admin', name: 'Organization super admin' },
              ];
        return (
            <UserForm
                key={id}
                user={user}
                domain={users.data.domain}
                roles={[...roleOptions, ...(user && !roleOptions.some((r) => r.id === user.role) ? [{ id: user.role, name: roleName(user.role) }] : [])]
                    .filter((r) => r.id !== 'org_super_admin' || (policy.canManage && (policy.designated < policy.maximum || user?.role === 'org_super_admin')))}
                initialRole={id === 'new-admin' ? 'org_super_admin' : 'org_user'}
                adminPolicy={policy}
                isSelf={user?.uid === myUid}
                onDone={() => {
                    users.reload();
                    navigate('organization_admin/users');
                }}
            />
        );
    }

    return (
        <div>
            <PageTitle
                title='Users'
                subtitle={`Everyone uses @${users.data.domain}`}
                action={
                    <Button onClick={() => navigate('organization_admin/users/new')}>
                        <Plus className='h-4 w-4' />
                        Add user
                    </Button>
                }
            />
            <Card className='mb-3'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                    <div>
                        <p className='text-sm font-semibold text-white'>Organization administrators</p>
                        <p className='text-xs text-slate-400'>Minimum {policy.minimumActive} active · Maximum {policy.maximum} designated administrators</p>
                    </div>
                    <Badge tone={policy.active < policy.minimumActive || policy.designated > policy.maximum ? 'danger' : 'brand'}>
                        {policy.designated} / {policy.maximum} · {policy.active} active
                    </Badge>
                </div>
                <p className='mt-2 text-xs text-slate-400'>Open an existing user to grant or remove administrator rights without deleting their account.</p>
            </Card>
            {users.data.users.length === 0 ? (
                <Empty>No users yet.</Empty>
            ) : (
                <div className='space-y-3'>
                    {users.data.users.map((u) => (
                        <button key={u.uid} onClick={() => navigate(`organization_admin/users/${u.uid}`)} className='block w-full text-left'>
                            <Card>
                                <div className='flex items-start gap-3'>
                                    <UserAvatar user={u} />
                                    <div className='min-w-0 flex-1'>
                                        <p className='truncate font-medium text-white'>
                                            {u.firstName} {u.lastName}
                                            {u.uid === myUid && <span className='text-slate-500'> (you)</span>}
                                        </p>
                                        <p className='truncate text-sm text-slate-400'>{u.email}</p>
                                        <p className='text-xs text-slate-500'>Last login: {fmtDate(u.lastLoginAt)}</p>
                                    </div>
                                    <div className='flex max-w-[46%] shrink-0 flex-col items-end gap-1'>
                                        <span className={u.role === 'org_super_admin' || u.role === 'org_admin' ? 'inline-flex max-w-full rounded-full border-2 border-red-500 p-0.5' : ''}>
                                            <Badge tone='brand'>{roleName(u.role)}</Badge>
                                        </span>
                                        {u.isCreator && <Badge tone='muted'>Original creator · Protected</Badge>}
                                        {u.status === 'disabled' && <Badge tone='danger'>Disabled</Badge>}
                                        {u.roleExpiresAt && <Badge tone={u.roleExpiresAt < new Date().toISOString().slice(0, 10) ? 'danger' : 'warn'}>{u.roleExpiresAt < new Date().toISOString().slice(0, 10) ? 'Role expired' : `Role until ${u.roleExpiresAt}`}</Badge>}
                                        {(u.jobRoles ?? []).length > 0 && <span className='font-mono text-[11px] text-slate-500'>{(u.jobRoles ?? []).join(' · ')}</span>}
                                    </div>
                                </div>
                            </Card>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function UserForm({
    user,
    domain,
    roles,
    initialRole,
    adminPolicy,
    isSelf,
    onDone,
}: {
    user?: OrgUser;
    domain: string;
    roles: Array<{ id: string; name: string }>;
    initialRole: string;
    adminPolicy: AdminPolicy;
    isSelf: boolean;
    onDone: () => void;
}) {
    const isNew = !user;
    const [emailLocal, setEmailLocal] = useState('');
    const [firstName, setFirstName] = useState(user?.firstName ?? '');
    const [lastName, setLastName] = useState(user?.lastName ?? '');
    const [phone, setPhone] = useState(user?.phone ?? '');
    const [role, setRole] = useState(user?.role ?? initialRole);
    const [status, setStatus] = useState(user?.status ?? 'active');
    const roleExpiresAt = user?.roleExpiresAt ?? '';
    const [password, setPassword] = useState('');
    const [skillCodes, setSkillCodes] = useState<string[]>(user?.skillCodes ?? []);
    const positions = useLoad(() => callBackend<{ positions: Array<{ code:string; title:string; coreSkills?:string[] }> }>('/api/org/positions/list'));
    const assignedRoles = (positions.data?.positions ?? []).filter(p => (user?.jobRoles ?? []).includes(p.code));
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        if (isNew && !/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i.test(emailLocal.trim())) {
            return setError('Enter a valid email ID using letters, numbers, dots, dashes or underscores.');
        }
        if (!firstName.trim() || !lastName.trim()) return setError('Enter the first and last name.');
        if (!/^\+[1-9]\d{7,14}$/.test(phone.replace(/[\s()-]/g, ''))) return setError('Enter the telephone number in international format, e.g. +254712345678.');
        if (isNew && passwordProblem(password)) return setError(passwordProblem(password));
        
        if (role === 'org_super_admin' && roleExpiresAt) return setError('The super administrator role cannot expire.');
        if (role === 'org_super_admin' && (!user || user.role !== 'org_super_admin') && adminPolicy.designated >= adminPolicy.maximum) {
            return setError('The organization already has three administrators. Remove administrator rights from an existing account first.');
        }
        if (!isNew && user && user.role === 'org_super_admin' && (role !== 'org_super_admin' || status === 'disabled') && adminPolicy.active <= adminPolicy.minimumActive) {
            return setError('At least one active organization administrator must remain.');
        }
        if (!isNew && user?.isCreator && (role !== 'org_super_admin' || status === 'disabled')) {
            return setError('The original organization creator must remain an active super administrator.');
        }
        if (!isNew && user && (role !== user.role || status !== user.status)) {
            const proceeding = window.confirm('Change access for ' + user.email + '? The user may need to sign in again. This change is recorded in the audit trail.');
            if (!proceeding) return;
        }
        setBusy('save');
        try {
            if (isNew) {
                await callBackend('/api/org/users/create', { emailLocal: emailLocal.trim().toLowerCase(), firstName, lastName, phone, role, password, skillCodes });
            } else {
                await callBackend('/api/org/users/update', { uid: user.uid, firstName, lastName, phone, role, status, skillCodes, roleExpiresAt: role === 'org_super_admin' ? '' : roleExpiresAt });
            }
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
            setBusy('');
        }
    };

    const remove = async () => {
        if (!user || !window.confirm(`Delete ${user.email}? This cannot be undone.`)) return;
        setBusy('delete');
        try {
            await callBackend('/api/org/users/delete', { uid: user.uid });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete.');
            setBusy('');
        }
    };

    return (
        <div>
            <button onClick={() => navigate('organization_admin/users')} className='mb-4 text-sm text-slate-400'>
                ← Users
            </button>
            <PageTitle title={isNew ? (initialRole === 'org_super_admin' ? 'Add administrator' : 'Add user') : `${user.firstName} ${user.lastName}`} />
            <form onSubmit={submit} noValidate aria-label='User details'>
                <Card className='space-y-4'>
                    {isNew ? (
                        <label htmlFor='org-email-local' className='block'>
                            <span className='mb-1 block text-sm text-slate-300'>Email ID</span>
                            <div className='flex'>
                                <input
                                    id='org-email-local'
                                    value={emailLocal}
                                    onChange={(e) => setEmailLocal(e.target.value.replace(/@.*/, ''))}
                                    autoCapitalize='none'
                                    autoComplete='off'
                                    placeholder='jane.doe'
                                    className='h-12 min-w-0 flex-1 rounded-l-xl border border-slate-700 bg-slate-950 px-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none'
                                />
                                <span className='flex h-12 max-w-[55%] items-center gap-1 truncate rounded-r-xl border border-l-0 border-slate-700 bg-slate-800 px-3 text-sm text-slate-300'>
                                    <Lock className='h-3.5 w-3.5 shrink-0' />@{domain}
                                </span>
                            </div>
                        </label>
                    ) : (
                        <div>
                            <span className='mb-1 block text-sm text-slate-300'>Email</span>
                            <div className='flex h-12 items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 text-slate-400'>
                                <Lock className='h-4 w-4' />
                                <span className='truncate'>{user.email}</span>
                            </div>
                            <p className='mt-1 text-xs text-slate-500'>The email address can never be changed.</p>
                        </div>
                    )}
                    <div className='grid grid-cols-2 gap-3'>
                        <Field id='org-first' label='First name' maxLength={40} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                        <Field id='org-last' label='Last name' maxLength={40} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    </div>
                    <Field id='org-phone' label='Telephone number' type='tel' placeholder='+254712345678' value={phone} onChange={(e) => setPhone(e.target.value)} />
                    <SelectField id='org-role' label='Security role' value={role} disabled={isSelf || user?.isCreator === true} onChange={(e) => setRole(e.target.value)}>
                        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </SelectField>
                    {user?.isCreator && <Alert tone='info'>Original organization creator: super administrator rights cannot be removed, disabled, or deleted.</Alert>}
                    <p className='text-xs text-slate-500'>
                        An organization may have {adminPolicy.minimumActive}–{adminPolicy.maximum} super administrators. Only a super administrator may grant or remove this role.
                        Removing administrator rights keeps the person's account and organizational assignments.
                    </p>
                    {!isNew && !isSelf && !user?.isCreator && user?.role === 'org_super_admin' && role === 'org_super_admin' && adminPolicy.active > adminPolicy.minimumActive && (
                        <Button type='button' variant='secondary' onClick={() => setRole('org_user')}>Remove administrator rights — select standard user</Button>
                    )}
                    {!isNew && (
                        <SelectField id='org-status' label='Status' value={status} disabled={isSelf || user?.isCreator === true} onChange={(e) => setStatus(e.target.value)}>
                            <option value='active'>Active</option>
                            <option value='disabled'>Disabled</option>
                        </SelectField>
                    )}
                    {isNew && <Field id='org-password' label='Initial password' type='password' autoComplete='new-password' value={password} onChange={(e) => setPassword(e.target.value)} />}
                    {error && <Alert tone='error'>{error}</Alert>}
                    <div className='flex flex-wrap gap-2'>
                        <Button type='submit' className='flex-1' busy={busy === 'save'} disabled={!!busy}>
                            {isNew ? (role === 'org_super_admin' ? 'Add administrator' : 'Add user') : 'Save changes'}
                        </Button>
                        {!isNew && !isSelf && !user?.isCreator && (
                            <Button type='button' variant='danger' busy={busy === 'delete'} disabled={!!busy} onClick={remove}>
                                Delete
                            </Button>
                        )}
                    </div>
                </Card>
            </form>
            {!isNew && <UserScope uid={user.uid} />}
            {!isNew && !isSelf && <ResetPassword endpoint='/api/org/users/reset-password' uid={user.uid} />}
        </div>
    );
}
