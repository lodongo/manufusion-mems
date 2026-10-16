import { useMemo, useState } from 'react';
import { sendEmailVerification, signInWithEmailAndPassword } from 'firebase/auth';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { firebaseAuth } from '../firebase';
import { clientInfo } from '../lib/audit';
import { publicPost } from '../lib/backend';
import { EMAIL_RE, emailDomain, isPublicEmail } from '../lib/emailPolicy';
import { PASSWORD_RULE, passwordProblem } from '../lib/password';
import { fetchReference } from '../lib/reference';
import { navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import { useLoad } from '../admin/kit';
import { AppFrame, Group, ScrollFrame, StepFrame } from './Frame';
import { STEPS } from './types';

export default function RegisterStart() {
    const ref = useLoad(() => fetchReference());
    const [form, setForm] = useState({ title: '', firstName: '', lastName: '', email: '', phoneCountry: 'KE', phoneLocal: '', password: '', confirm: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

    const countries = useMemo(() => [...(ref.data?.countries ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [ref.data]);
    const titles = ref.data?.metadataLists.find((l) => l.key === 'titles')?.items ?? [];
    const dial = countries.find((c) => c.iso2 === form.phoneCountry)?.dialCode ?? '';

    const submit = async () => {
        setError('');
        const email = form.email.trim().toLowerCase();
        const domain = emailDomain(email);
        if (!form.firstName.trim() || !form.lastName.trim()) return setError('Enter your first and last name.');
        if (!EMAIL_RE.test(email)) return setError('Enter a valid email address.');
        if (isPublicEmail(email)) return setError("Public email addresses are not allowed. Use your organization's email address.");
        if (domain === 'manufusion.com' || domain.endsWith('.manufusion.com')) return setError('Manufusion email addresses cannot be used to register an organization.');
        const digits = form.phoneLocal.replace(/\D/g, '').replace(/^0+/, '');
        if (digits.length < 6 || digits.length > 12) return setError('Enter a valid telephone number.');
        const problem = passwordProblem(form.password);
        if (problem) return setError(problem);
        if (form.password !== form.confirm) return setError('Passwords do not match.');
        setBusy(true);
        try {
            await publicPost('/api/applications/start', {
                title: form.title,
                firstName: form.firstName.trim(),
                lastName: form.lastName.trim(),
                email,
                phoneCountry: form.phoneCountry,
                phoneLocal: digits,
                password: form.password,
                client: clientInfo(),
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not start the registration.');
            setBusy(false);
            return;
        }
        try {
            const credential = await signInWithEmailAndPassword(firebaseAuth, email, form.password);
            try {
                await sendEmailVerification(credential.user);
            } catch {
                // The applicant can resend later if verification is required.
            }
        } catch {
            navigate('');
        }
    };

    if (ref.loading && !ref.data) {
        return (
            <div className='flex h-[100dvh] items-center justify-center bg-slate-950'>
                <Loader2 className='h-8 w-8 animate-spin text-emerald-400' aria-label='Loading' />
            </div>
        );
    }

    if (!ref.data?.loaded) {
        return (
            <AppFrame title='Register your organization'>
                <ScrollFrame>
                    <Alert tone='error'>{ref.error || 'Organization registration is not open yet. Please check back soon.'}</Alert>
                    <button onClick={() => navigate('site')} className='mt-6 flex items-center gap-2 text-sm text-slate-400'>
                        <ArrowLeft className='h-4 w-4' />
                        Back to the website
                    </button>
                </ScrollFrame>
            </AppFrame>
        );
    }

    return (
        <AppFrame title={STEPS[0].title} step={0} total={STEPS.length}>
            <StepFrame primary='Create account and continue' busy={busy} error={error} onBack={() => navigate('site')} onSubmit={submit}>
                <div className='rounded-2xl border border-slate-800 bg-slate-900 p-4'>
                    <p className='text-sm font-medium text-white'>Register your organization in {STEPS.length} short steps</p>
                    <p className='mt-1 text-xs text-slate-400'>Your progress is saved. Log in with your email any time to continue. A MEMS administrator approves every registration.</p>
                </div>
                <Group title='About you'>
                    <SelectField id='rs-title' label='Title (optional)' value={form.title} onChange={(e) => set('title')(e.target.value)}>
                        <option value=''>None</option>
                        {titles.map((t) => (
                            <option key={t.code} value={t.code}>
                                {t.label}
                            </option>
                        ))}
                    </SelectField>
                    <div className='grid grid-cols-2 gap-3'>
                        <Field id='rs-first' label='First name' autoComplete='given-name' maxLength={40} value={form.firstName} onChange={(e) => set('firstName')(e.target.value)} />
                        <Field id='rs-last' label='Last name' autoComplete='family-name' maxLength={40} value={form.lastName} onChange={(e) => set('lastName')(e.target.value)} />
                    </div>
                </Group>
                <Group title='Contact'>
                    <Field id='rs-email' label='Work email (organization domain)' type='email' inputMode='email' autoComplete='username' value={form.email} onChange={(e) => set('email')(e.target.value)} />
                    <SelectField id='rs-phone-country' label='Phone country' value={form.phoneCountry} onChange={(e) => set('phoneCountry')(e.target.value)}>
                        {countries.map((c) => (
                            <option key={c.iso2} value={c.iso2}>
                                {c.flag} {c.name} ({c.dialCode})
                            </option>
                        ))}
                    </SelectField>
                    <label htmlFor='rs-phone' className='block'>
                        <span className='mb-1 block text-sm text-slate-300'>Telephone number</span>
                        <div className='flex gap-2'>
                            <span className='flex h-12 min-w-[4.5rem] items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-2 text-slate-200'>{dial}</span>
                            <input
                                id='rs-phone'
                                type='tel'
                                inputMode='tel'
                                autoComplete='tel-national'
                                placeholder='712 345 678'
                                value={form.phoneLocal}
                                onChange={(e) => set('phoneLocal')(e.target.value)}
                                className='h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none'
                            />
                        </div>
                    </label>
                </Group>
                <Group title='Secure your account'>
                    <Field id='rs-password' label='Create a password' type='password' autoComplete='new-password' value={form.password} onChange={(e) => set('password')(e.target.value)} />
                    <Field id='rs-confirm' label='Confirm password' type='password' autoComplete='new-password' value={form.confirm} onChange={(e) => set('confirm')(e.target.value)} />
                    <p className='text-xs text-slate-500'>{PASSWORD_RULE}</p>
                </Group>
                <button type='button' onClick={() => navigate('')} className='block w-full py-2 text-center text-sm text-emerald-300 underline'>
                    Already started? Log in to continue
                </button>
            </StepFrame>
        </AppFrame>
    );
}
