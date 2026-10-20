import { useState, type FormEvent } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { firebaseAuth } from '../firebase';
import { publicPost } from '../lib/backend';
import { EMAIL_RE, SUPER_ADMIN_DOMAIN, emailDomain } from '../lib/emailPolicy';
import { Alert, Field, PrimaryButton } from './ui';

export default function SetupScreen({ onDone }: { onDone: (message?: string) => void }) {
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        const cleanEmail = email.trim().toLowerCase();
        const cleanPhone = phone.replace(/[\s()-]/g, '');

        if (!firstName.trim()) return setError('Enter your first name.');
        if (!lastName.trim()) return setError('Enter your last name.');
        if (!EMAIL_RE.test(cleanEmail)) return setError('Enter a valid email address.');
        if (emailDomain(cleanEmail) !== SUPER_ADMIN_DOMAIN) {
            return setError(`The super admin must use a @${SUPER_ADMIN_DOMAIN} email address.`);
        }
        if (!/^\+[1-9]\d{7,14}$/.test(cleanPhone)) {
            return setError('Enter the telephone number in international format, e.g. +254712345678.');
        }
        if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
            return setError('Password must be at least 10 characters with upper-case and lower-case letters and a number.');
        }
        if (password !== confirm) return setError('Passwords do not match.');

        setBusy(true);
        try {
            await publicPost('/api/setup/register', {
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                email: cleanEmail,
                phone: cleanPhone,
                password,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not complete setup.');
            setBusy(false);
            return;
        }
        try {
            await signInWithEmailAndPassword(firebaseAuth, cleanEmail, password);
            onDone();
        } catch {
            onDone('Super admin created. Please log in.');
        }
    };

    return (
        <div className='flex min-h-dvh items-center justify-center bg-slate-950 px-6 py-10'>
            <main className='w-full max-w-sm'>
                <h1 className='text-center text-3xl font-bold tracking-wide text-white'>MEMS</h1>
                <h2 className='mt-6 text-center text-lg font-semibold text-white'>Set up MEMS</h2>
                <p className='mt-1 text-center text-sm text-slate-400'>
                    Create the MEMS super admin account. This can only be done once.
                </p>
                <form onSubmit={submit} className='mt-8 space-y-4' noValidate>
                    <div className='grid grid-cols-2 gap-3'>
                        <Field
                            id='first-name'
                            label='First name'
                            autoComplete='given-name'
                            maxLength={40}
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                        />
                        <Field
                            id='last-name'
                            label='Last name'
                            autoComplete='family-name'
                            maxLength={40}
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                        />
                    </div>
                    <Field
                        id='setup-email'
                        label='Email'
                        type='email'
                        inputMode='email'
                        autoComplete='username'
                        placeholder={`name@${SUPER_ADMIN_DOMAIN}`}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                    <Field
                        id='setup-phone'
                        label='Telephone number'
                        type='tel'
                        inputMode='tel'
                        autoComplete='tel'
                        placeholder='+254712345678'
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                    />
                    <Field
                        id='setup-password'
                        label='Password'
                        type='password'
                        autoComplete='new-password'
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                    <Field
                        id='setup-confirm'
                        label='Confirm password'
                        type='password'
                        autoComplete='new-password'
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                    />
                    {error && <Alert tone='error'>{error}</Alert>}
                    <PrimaryButton type='submit' busy={busy}>
                        Create super admin
                    </PrimaryButton>
                </form>
            </main>
        </div>
    );
}
