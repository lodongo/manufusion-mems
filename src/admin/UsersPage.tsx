import { useState, type FormEvent } from 'react';
import { Lock, Plus } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { useSite } from '../lib/site';
import { ROLE_LABELS, STAFF_ROLES } from '../types';
import { Alert, Field, SelectField } from '../components/ui';
import { fmtDate } from './format';
import { Badge, Button, Card, Empty, PageTitle, Spinner, useLoad } from './kit';
import { passwordProblem } from '../lib/password';
import ResetPassword from './ResetPassword';
import OrphanAccounts from './OrphanAccounts';

interface StaffUser {
    uid: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
    role: string;
    status: string;
    createdAt: string;
    lastLoginAt: string;
}

export default function UsersPage({ id, myUid, isSuper }: { id?: string; myUid: string; isSuper: boolean }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ users: StaffUser[] }>('/api/admin/users/list'));

    if (id) {
        if (loading && !data) return <Spinner />;
        const user = id === 'new' ? undefined : data?.users.find((u) => u.uid === id);
        if (id !== 'new' && !user) return <Alert tone='error'>{error || 'User not found.'}</Alert>;
        return (
            <UserForm
                user={user}
                isSelf={user?.uid === myUid}
                canEdit={isSuper}
                onDone={() => {
                    reload();
                    navigate('admin/users');
                }}
            />
        );
    }

    return (
        <div>
            <PageTitle
                title='Users'
                subtitle='MEMS staff accounts'
                action={
                    isSuper && (
                        <Button onClick={() => navigate('admin/users/new')}>
                            <Plus className='h-4 w-4' />
                            Add user
                        </Button>
                    )
                }
            />
            {!isSuper && (
                <div className='mb-4'>
                    <Alert tone='info'>Only a super admin can add, edit or delete MEMS users.</Alert>
                </div>
            )}
            {isSuper && <OrphanAccounts onRepaired={reload} />}
            {loading && !data ? (
                <Spinner />
            ) : error ? (
                <Alert tone='error'>{error}</Alert>
            ) : !data || data.users.length === 0 ? (
                <Empty>No MEMS users yet.</Empty>
            ) : (
                <div className='space-y-3'>
                    {data.users.map((u) => (
                        <button key={u.uid} onClick={() => navigate(`admin/users/${u.uid}`)} className='block w-full text-left'>
                            <Card>
                                <div className='flex items-start justify-between gap-3'>
                                    <div className='min-w-0'>
                                        <p className='truncate font-medium text-white'>
                                            {u.firstName} {u.lastName}
                                            {u.uid === myUid && <span className='text-slate-500'> (you)</span>}
                                        </p>
                                        <p className='truncate text-sm text-slate-400'>{u.email}</p>
                                        <p className='text-xs text-slate-500'>Last login: {fmtDate(u.lastLoginAt)}</p>
                                    </div>
                                    <div className='flex shrink-0 flex-col items-end gap-1'>
                                        <Badge tone='brand'>{ROLE_LABELS[u.role] ?? u.role}</Badge>
                                        {u.status === 'disabled' && <Badge tone='danger'>Disabled</Badge>}
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

function UserForm({ user, isSelf, canEdit, onDone }: { user?: StaffUser; isSelf: boolean; canEdit: boolean; onDone: () => void }) {
    const { locked } = useSite();
    const isNew = !user;
    const [emailLocal, setEmailLocal] = useState('');
    const [firstName, setFirstName] = useState(user?.firstName ?? '');
    const [lastName, setLastName] = useState(user?.lastName ?? '');
    const [phone, setPhone] = useState(user?.phone ?? '');
    const [role, setRole] = useState(user?.role ?? 'mems_admin');
    const [status, setStatus] = useState(user?.status ?? 'active');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        if (isNew && !/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i.test(emailLocal.trim())) {
            return setError('Enter a valid email ID using letters, numbers, dots, dashes or underscores.');
        }
        if (!firstName.trim() || !lastName.trim()) return setError('Enter the first and last name.');
        if (!/^\+[1-9]\d{7,14}$/.test(phone.replace(/[\s()-]/g, ''))) {
            return setError('Enter the telephone number in international format, e.g. +254712345678.');
        }
        if (isNew && passwordProblem(password)) return setError(passwordProblem(password));
        setBusy('save');
        try {
            if (isNew) {
                await callBackend('/api/admin/users/create', { emailLocal: emailLocal.trim().toLowerCase(), firstName, lastName, phone, role, password });
            } else {
                await callBackend('/api/admin/users/update', { uid: user.uid, firstName, lastName, phone, role, status });
            }
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
            setBusy('');
        }
    };

    const remove = async () => {
        if (!user || !window.confirm(`Delete ${user.email}? This cannot be undone.`)) return;
        setError('');
        setBusy('delete');
        try {
            await callBackend('/api/admin/users/delete', { uid: user.uid });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete.');
            setBusy('');
        }
    };

    const disabled = !canEdit;

    return (
        <div>
            <button onClick={() => navigate('admin/users')} className='mb-4 text-sm text-slate-400'>
                ← Users
            </button>
            <PageTitle title={isNew ? 'Add MEMS user' : `${user.firstName} ${user.lastName}`} subtitle={isNew ? undefined : ROLE_LABELS[user.role]} />
            <form onSubmit={submit} noValidate>
                <Card className='space-y-4'>
                    {isNew ? (
                        <label htmlFor='email-local' className='block'>
                            <span className='mb-1 block text-sm text-slate-300'>Email ID</span>
                            <div className='flex'>
                                <input
                                    id='email-local'
                                    value={emailLocal}
                                    onChange={(e) => setEmailLocal(e.target.value.replace(/@.*/, ''))}
                                    autoCapitalize='none'
                                    autoComplete='off'
                                    placeholder='jane.doe'
                                    className='h-12 min-w-0 flex-1 rounded-l-xl border border-slate-700 bg-slate-950 px-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none'
                                />
                                <span className='flex h-12 items-center gap-1 rounded-r-xl border border-l-0 border-slate-700 bg-slate-800 px-3 text-sm text-slate-300'>
                                    <Lock className='h-3.5 w-3.5' />@{locked.staffEmailDomain}
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
                        <Field id='first-name' label='First name' maxLength={40} value={firstName} disabled={disabled} onChange={(e) => setFirstName(e.target.value)} />
                        <Field id='last-name' label='Last name' maxLength={40} value={lastName} disabled={disabled} onChange={(e) => setLastName(e.target.value)} />
                    </div>
                    <Field id='phone' label='Telephone number' type='tel' placeholder='+254712345678' value={phone} disabled={disabled} onChange={(e) => setPhone(e.target.value)} />
                    <SelectField id='role' label='Role' value={role} disabled={disabled || isSelf} onChange={(e) => setRole(e.target.value)}>
                        {STAFF_ROLES.map((r) => (
                            <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                            </option>
                        ))}
                    </SelectField>
                    {!isNew && (
                        <SelectField id='status' label='Status' value={status} disabled={disabled || isSelf} onChange={(e) => setStatus(e.target.value)}>
                            <option value='active'>Active</option>
                            <option value='disabled'>Disabled</option>
                        </SelectField>
                    )}
                    {isNew && (
                        <Field id='password' label='Initial password' type='password' autoComplete='new-password' value={password} onChange={(e) => setPassword(e.target.value)} />
                    )}
                    {error && <Alert tone='error'>{error}</Alert>}
                    {canEdit && (
                        <div className='flex flex-wrap gap-2'>
                            <Button type='submit' busy={busy === 'save'} disabled={!!busy} className='flex-1'>
                                {isNew ? 'Add user' : 'Save changes'}
                            </Button>
                            {!isNew && !isSelf && (
                                <Button type='button' variant='danger' busy={busy === 'delete'} disabled={!!busy} onClick={remove}>
                                    Delete
                                </Button>
                            )}
                        </div>
                    )}
                </Card>
            </form>
            {!isNew && canEdit && !isSelf && <ResetPassword endpoint='/api/admin/users/reset-password' uid={user.uid} />}
        </div>
    );
}
