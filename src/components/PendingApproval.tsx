import { useState } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { CircleX, Clock, MailCheck } from 'lucide-react';
import { firebaseAuth } from '../firebase';
import { useSite } from '../lib/site';
import type { Session } from '../types';
import { Alert, PrimaryButton } from './ui';

export default function PendingApproval({ session, onRefresh, onSignOut }: { session: Session; onRefresh: () => void; onSignOut: () => void }) {
    const { config } = useSite();
    const org = session.organization!;
    const rejected = org.status === 'rejected';
    const [busy, setBusy] = useState('');
    const [info, setInfo] = useState('');
    const [error, setError] = useState('');
    const emailVerified = Boolean(org.emailVerified || firebaseAuth.currentUser?.emailVerified);

    const resend = async () => {
        const user = firebaseAuth.currentUser;
        if (!user) return;
        setBusy('resend');
        setError('');
        setInfo('');
        try {
            await sendEmailVerification(user);
            setInfo(`A verification link was sent to ${session.user.email}.`);
        } catch (err) {
            const code = (err as { code?: string }).code;
            setError(code === 'auth/too-many-requests' ? 'Please wait a few minutes before requesting another link.' : 'Could not send the link. Please try again.');
        } finally {
            setBusy('');
        }
    };

    const refresh = async () => {
        const user = firebaseAuth.currentUser;
        setBusy('refresh');
        setError('');
        try {
            if (user) {
                await user.reload();
                await user.getIdToken(true);
            }
            onRefresh();
        } catch {
            setError('Could not check your status. Please try again.');
        } finally {
            setBusy('');
        }
    };

    return (
        <div className='flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10'>
            <main className='w-full max-w-sm space-y-4 text-center'>
                {rejected ? <CircleX className='mx-auto h-12 w-12 text-red-400' /> : <Clock className='mx-auto h-12 w-12 text-amber-400' />}
                <h1 className='text-2xl font-semibold text-white'>{rejected ? 'Registration not approved' : 'Pending approval'}</h1>
                <p className='text-sm text-slate-300'>
                    <span className='font-medium text-white'>{org.name}</span>
                    {org.code ? <span className='block font-mono text-xs text-emerald-300'>{org.code}</span> : null}
                </p>
                {rejected ? (
                    <>
                        {org.rejectionReason && <Alert tone='error'>Reason: {org.rejectionReason}</Alert>}
                        <p className='text-sm text-slate-400'>
                            If you believe this is a mistake, contact MEMS support{config.supportEmail ? ` at ${config.supportEmail}` : ''}.
                        </p>
                    </>
                ) : (
                    <>
                        <p className='text-sm text-slate-300'>
                            MEMS is reviewing your registration details and documents. You will be able to use MEMS as soon as your organization is approved.
                        </p>
                        {!emailVerified && (
                            <div className='space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-left'>
                                <p className='flex items-center gap-2 text-sm font-medium text-white'>
                                    <MailCheck className='h-4 w-4 text-emerald-400' />
                                    Please verify your email
                                </p>
                                <p className='text-xs text-slate-400'>
                                    We sent a link to {session.user.email}. Verifying speeds up approval. Unverified registrations are removed after 48 hours.
                                </p>
                                <button onClick={resend} disabled={!!busy} className='h-11 w-full rounded-xl border border-slate-700 text-sm text-slate-200 disabled:opacity-50'>
                                    Resend verification link
                                </button>
                            </div>
                        )}
                        <PrimaryButton busy={busy === 'refresh'} onClick={refresh}>
                            Check approval status
                        </PrimaryButton>
                    </>
                )}
                {error && <Alert tone='error'>{error}</Alert>}
                {info && <Alert tone='info'>{info}</Alert>}
                <button onClick={onSignOut} className='text-sm text-slate-400 underline'>
                    Log out
                </button>
            </main>
        </div>
    );
}
