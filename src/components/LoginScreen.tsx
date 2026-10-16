import { useEffect, useState, type FormEvent } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { firebaseAuth } from '../firebase';
import { reportLoginAttempt } from '../lib/audit';
import { authErrorMessage } from '../lib/authErrors';
import { EMAIL_RE, isPublicEmail } from '../lib/emailPolicy';
import { useSite } from '../lib/site';
import { Alert, Field, PrimaryButton } from './ui';

type LockInfo = { email: string; locked: true; kind: string; until: string; message: string; policyVersion?: number };
/** A Health lock is visible only when the email being entered matches its owner. */
function existingLock(email: string): LockInfo | null {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;
    try {
        const key = 'mems.health.lock.' + normalized;
        // The second lookup supports locks recorded by the previous app version.
        const raw = sessionStorage.getItem(key) || sessionStorage.getItem('mems.health.lock');
        if (!raw) return null;
        const item = JSON.parse(raw) as LockInfo;
        if (!item || item.email?.trim().toLowerCase() !== normalized) return null;
        // Weekly locks from before the suspension are stale. Only new,
        // backend-confirmed account-specific locks may disable this login.
        if (item.kind === 'weekly' && item.policyVersion !== 2) {
            sessionStorage.removeItem(key);
            const legacy = sessionStorage.getItem('mems.health.lock');
            if (legacy) {
                try {
                    if ((JSON.parse(legacy) as LockInfo).email?.trim().toLowerCase() === normalized) {
                        sessionStorage.removeItem('mems.health.lock');
                    }
                } catch { sessionStorage.removeItem('mems.health.lock'); }
            }
            return null;
        }
        if (!item.until || Date.parse(item.until) <= Date.now()) {
            sessionStorage.removeItem(key);
            const old = sessionStorage.getItem('mems.health.lock');
            if (old) {
                try {
                    if ((JSON.parse(old) as LockInfo).email?.trim().toLowerCase() === normalized) {
                        sessionStorage.removeItem('mems.health.lock');
                    }
                } catch { sessionStorage.removeItem('mems.health.lock'); }
            }
            return null;
        }
        return item;
    } catch { return null; }
}
const asRemaining = (seconds: number) => {
    const total = Math.max(0, Math.ceil(seconds));
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return (hrs ? hrs + 'h ' : '') + (hrs ? String(mins).padStart(2, '0') : String(mins)) + 'm ' + String(secs).padStart(2, '0') + 's';
};

export default function LoginScreen({ notice }: { notice?: string }) {
    const { config } = useSite();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const interval = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(interval);
    }, []);
    const lock = existingLock(email);
    const remaining = lock ? Math.max(0, Math.ceil((Date.parse(lock.until) - now) / 1000)) : 0;
    const lockedEmail = !!lock && remaining > 0;

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        const cleanEmail = email.trim().toLowerCase();
        if (!EMAIL_RE.test(cleanEmail)) return setError('Enter a valid email address.');
        if (isPublicEmail(cleanEmail)) {
            void reportLoginAttempt(cleanEmail, 'blocked', 'public_email');
            return setError('Please use your company email address.');
        }
        if (lockedEmail) return setError('MEMS access is paused for ' + asRemaining(remaining) + '. Please return when the lockout ends.');
        if (!password) return setError('Enter your password.');
        setBusy(true);
        try {
            await signInWithEmailAndPassword(firebaseAuth, cleanEmail, password);
            void reportLoginAttempt(cleanEmail, 'success');
        } catch (err) {
            void reportLoginAttempt(cleanEmail, 'failure', (err as { code?: string }).code ?? 'unknown');
            setError(authErrorMessage(err));
            setBusy(false);
        }
    };

    return (
        <div className='flex min-h-screen flex-col bg-page px-6 py-10 text-ink'>
            <main className='mx-auto flex w-full max-w-sm flex-1 flex-col justify-center'>
                {config.logoUrl&&<img src={config.logoUrl} alt='MEMS logo' className='mx-auto mb-4 max-h-28 max-w-[240px] object-contain'/>}
                <h1 className='text-center text-3xl font-bold tracking-wide text-ink'>{config.brandName}</h1>
                {config.tagline&&<p className='mt-2 text-center text-sm font-medium text-brand'>{config.tagline}</p>}
                {config.loginSubtitle && <p className='mt-2 text-center text-sm text-muted'>{config.loginSubtitle}</p>}
                <form onSubmit={submit} className='mt-10 space-y-4' noValidate aria-label='Login'>
                    <Field id='email' label='Email' type='email' inputMode='email' autoComplete='username' value={email} onChange={(e) => setEmail(e.target.value)} />
                    <Field id='password' label='Password' type='password' autoComplete='current-password' value={password} onChange={(e) => setPassword(e.target.value)} />
                    {remaining > 0 && lock && (
                        <div className='rounded-xl border border-line bg-panel p-3 text-sm text-ink' role='status'>
                            <p className='font-semibold'>MEMS wellbeing lockout</p>
                            <p className='mt-1 text-soft'>{lock.message}</p>
                            <p className='mt-1 font-mono text-lg text-brand'>Remaining: {asRemaining(remaining)}</p>
                            <p className='mt-1 text-xs text-muted'>
                                Unlocks {new Date(lock.until).toLocaleString()}. Only this email account is restricted.
                            </p>
                            <button type='button' className='mt-3 w-full rounded-lg border border-line px-3 py-2 text-xs font-semibold text-brand'
                                onClick={() => { setEmail(''); setPassword(''); setError(''); }}>
                                Sign in with another account
                            </button>
                        </div>
                    )}
                    {(error || (notice && !lock)) && <Alert tone='error'>{error || notice}</Alert>}
                    <PrimaryButton type='submit' busy={busy} disabled={lockedEmail} className='!bg-[#1266bd] !text-white shadow-md ring-1 ring-[#0b4d93]'>
                        {config.loginButtonLabel}
                    </PrimaryButton>
                </form>
                <a href='#site' className='mt-8 block text-center text-sm text-brand underline'>
                    {config.memsWebsiteLinkLabel}
                </a>
            </main>
            {config.forgotPasswordText && <p className='mx-auto mt-8 max-w-sm text-center text-xs text-muted'>{config.forgotPasswordText}</p>}
        </div>
    );
}
