import { useState, type FormEvent } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { Lock } from 'lucide-react';
import { firebaseAuth } from '../firebase';
import { callBackend } from '../lib/backend';
import { ROLE_LABELS, type Session } from '../types';
import { Alert, Field } from '../components/ui';
import { Button, Card, PageTitle } from './kit';
import { passwordProblem } from '../lib/password';
import ProfilePhoto from '../components/ProfilePhoto';

export default function ProfilePage({ session, onUpdated }: { session: Session; onUpdated: (session: Session) => void }) {
    const { user } = session;
    const [firstName, setFirstName] = useState(user.firstName);
    const [lastName, setLastName] = useState(user.lastName);
    const [phone, setPhone] = useState(user.phone);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');

    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [pwBusy, setPwBusy] = useState(false);
    const [pwError, setPwError] = useState('');
    const [pwInfo, setPwInfo] = useState('');

    const saveProfile = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        setInfo('');
        if (!firstName.trim() || !lastName.trim()) return setError('Enter your first and last name.');
        if (!/^\+[1-9]\d{7,14}$/.test(phone.replace(/[\s()-]/g, ''))) {
            return setError('Enter the telephone number in international format, e.g. +254712345678.');
        }
        setBusy(true);
        try {
            const res = await callBackend<{ firstName: string; lastName: string; phone: string }>('/api/profile/update', { firstName, lastName, phone });
            onUpdated({ ...session, user: { ...user, ...res } });
            setInfo('Personal details saved.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
        } finally {
            setBusy(false);
        }
    };

    const changePassword = async (event: FormEvent) => {
        event.preventDefault();
        setPwError('');
        setPwInfo('');
        const current_user = firebaseAuth.currentUser;
        if (!current_user?.email) return setPwError('Please log in again.');
        if (!current) return setPwError('Enter your current password.');
        if (passwordProblem(next)) return setPwError(passwordProblem(next));
        if (next !== confirm) return setPwError('New passwords do not match.');
        setPwBusy(true);
        try {
            await reauthenticateWithCredential(current_user, EmailAuthProvider.credential(current_user.email, current));
            await updatePassword(current_user, next);
            setCurrent('');
            setNext('');
            setConfirm('');
            setPwInfo('Password changed.');
        } catch (err) {
            const code = (err as { code?: string }).code ?? '';
            setPwError(
                code === 'auth/invalid-credential' || code === 'auth/wrong-password'
                    ? 'Your current password is incorrect.'
                    : code === 'auth/too-many-requests'
                      ? 'Too many attempts. Please wait and try again.'
                      : 'Could not change the password.'
            );
        } finally {
            setPwBusy(false);
        }
    };

    return (
        <div className='space-y-4'>
            <PageTitle title='Personal details' subtitle={ROLE_LABELS[session.role ?? ''] ?? session.roleName ?? ''} />
            <ProfilePhoto photoUrl={session.photoUrl ?? ''} onUpdated={(photoUrl) => onUpdated({ ...session, photoUrl, photoRequired: false })} />
            <form onSubmit={saveProfile} noValidate>
                <Card className='space-y-4'>
                    <div>
                        <span className='mb-1 block text-sm text-slate-300'>Email</span>
                        <div className='flex h-12 items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 text-slate-400'>
                            <Lock className='h-4 w-4' />
                            <span className='truncate'>{user.email}</span>
                        </div>
                        <p className='mt-1 text-xs text-slate-500'>Your email address cannot be changed.</p>
                    </div>
                    <div className='grid grid-cols-2 gap-3'>
                        <Field id='p-first' label='First name' maxLength={40} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                        <Field id='p-last' label='Last name' maxLength={40} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    </div>
                    <Field id='p-phone' label='Telephone number' type='tel' value={phone} onChange={(e) => setPhone(e.target.value)} />
                    {error && <Alert tone='error'>{error}</Alert>}
                    {info && <Alert tone='info'>{info}</Alert>}
                    <Button type='submit' busy={busy} className='w-full'>
                        Save details
                    </Button>
                </Card>
            </form>

            <form onSubmit={changePassword} noValidate>
                <Card className='space-y-4'>
                    <h2 className='font-semibold text-white'>Change password</h2>
                    <Field id='pw-current' label='Current password' type='password' autoComplete='current-password' value={current} onChange={(e) => setCurrent(e.target.value)} />
                    <Field id='pw-new' label='New password' type='password' autoComplete='new-password' value={next} onChange={(e) => setNext(e.target.value)} />
                    <Field id='pw-confirm' label='Confirm new password' type='password' autoComplete='new-password' value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                    {pwError && <Alert tone='error'>{pwError}</Alert>}
                    {pwInfo && <Alert tone='info'>{pwInfo}</Alert>}
                    <Button type='submit' variant='secondary' busy={pwBusy} className='w-full'>
                        Change password
                    </Button>
                </Card>
            </form>
        </div>
    );
}
