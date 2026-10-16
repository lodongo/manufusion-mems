import { useState, type FormEvent } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { KeyRound } from 'lucide-react';
import { firebaseAuth } from '../firebase';
import { callBackend } from '../lib/backend';
import { PASSWORD_RULE, passwordProblem } from '../lib/password';
import { Alert, Field, PrimaryButton } from './ui';

export default function ChangePassword({ email, onDone, onSignOut }: { email: string; onDone: () => void; onSignOut: () => void }) {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        const user = firebaseAuth.currentUser;
        if (!user) return setError('Please log in again.');
        if (!current) return setError('Enter the temporary password you were given.');
        const problem = passwordProblem(next);
        if (problem) return setError(problem);
        if (next === current) return setError('Choose a new password that is different from the temporary one.');
        if (next !== confirm) return setError('New passwords do not match.');
        setBusy(true);
        try {
            await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, current));
            await updatePassword(user, next);
            await callBackend('/api/profile/password-changed');
            onDone();
        } catch (err) {
            const code = (err as { code?: string }).code ?? '';
            setError(
                code === 'auth/invalid-credential' || code === 'auth/wrong-password'
                    ? 'The temporary password is incorrect.'
                    : code === 'auth/password-does-not-meet-requirements'
                      ? PASSWORD_RULE
                      : err instanceof Error && !code
                        ? err.message
                        : 'Could not change the password. Please try again.'
            );
            setBusy(false);
        }
    };

    return (
        <div className='flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10'>
            <main className='w-full max-w-sm'>
                <KeyRound className='mx-auto h-12 w-12 text-emerald-400' />
                <h1 className='mt-4 text-center text-2xl font-semibold text-white'>Set your own password</h1>
                <p className='mt-2 text-center text-sm text-slate-400'>For security, replace the temporary password before continuing.</p>
                <form onSubmit={submit} noValidate className='mt-6 space-y-4' aria-label='Change password'>
                    <Field id='cp-current' label='Temporary password' type='password' autoComplete='current-password' value={current} onChange={(e) => setCurrent(e.target.value)} />
                    <Field id='cp-new' label='New password' type='password' autoComplete='new-password' value={next} onChange={(e) => setNext(e.target.value)} />
                    <Field id='cp-confirm' label='Confirm new password' type='password' autoComplete='new-password' value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                    <p className='text-xs text-slate-500'>{PASSWORD_RULE}</p>
                    {error && <Alert tone='error'>{error}</Alert>}
                    <PrimaryButton type='submit' busy={busy}>
                        Save new password
                    </PrimaryButton>
                </form>
                <button onClick={onSignOut} className='mt-6 block w-full text-center text-sm text-slate-400 underline'>
                    Log out
                </button>
            </main>
        </div>
    );
}
