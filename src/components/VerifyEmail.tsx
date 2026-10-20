import { useState } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { MailCheck } from 'lucide-react';
import { firebaseAuth } from '../firebase';
import { Alert, PrimaryButton } from './ui';

export default function VerifyEmail({ email, message, onVerified, onSignOut }: { email: string; message: string; onVerified: () => void; onSignOut: () => void }) {
    const [busy, setBusy] = useState('');
    const [info, setInfo] = useState('');
    const [error, setError] = useState('');

    const resend = async () => {
        const user = firebaseAuth.currentUser;
        if (!user) return;
        setBusy('resend');
        setError('');
        setInfo('');
        try {
            await sendEmailVerification(user);
            setInfo(`A new verification link was sent to ${email}.`);
        } catch (err) {
            const code = (err as { code?: string }).code;
            setError(code === 'auth/too-many-requests' ? 'Please wait a few minutes before requesting another link.' : 'Could not send the link. Please try again.');
        } finally {
            setBusy('');
        }
    };

    const check = async () => {
        const user = firebaseAuth.currentUser;
        if (!user) return;
        setBusy('check');
        setError('');
        try {
            await user.reload();
            if (!user.emailVerified) {
                setError('Your email is not verified yet. Open the link in the email, then tap the button again.');
                return;
            }
            await user.getIdToken(true);
            onVerified();
        } catch {
            setError('Could not check. Please try again.');
        } finally {
            setBusy('');
        }
    };

    return (
        <div className='flex min-h-dvh items-center justify-center bg-slate-950 px-6'>
            <main className='w-full max-w-sm space-y-4 text-center'>
                <MailCheck className='mx-auto h-12 w-12 text-emerald-400' />
                <h1 className='text-2xl font-semibold text-white'>Verify your email</h1>
                <p className='text-sm text-slate-300'>{message}</p>
                {error && <Alert tone='error'>{error}</Alert>}
                {info && <Alert tone='info'>{info}</Alert>}
                <PrimaryButton busy={busy === 'check'} onClick={check}>
                    I have verified my email
                </PrimaryButton>
                <button onClick={resend} disabled={!!busy} className='h-12 w-full rounded-xl border border-slate-700 text-slate-200 disabled:opacity-50'>
                    Resend link
                </button>
                <button onClick={onSignOut} className='text-sm text-slate-400 underline'>
                    Log out
                </button>
            </main>
        </div>
    );
}
