import { useEffect, useState } from 'react';
import { ArrowLeft, Hash, Lock, UserPlus } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import { Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { PASSWORD_RULE, passwordProblem } from '../lib/password';
import { ConfirmBox, ReviewSection, StepProgress, StepSection, type WizardStep } from './materialCreateUi';

// HR > Employee Records & Administration: add employees (the only place user accounts are created) and give
// every employee a system employee number (EMP_ + 5 digits, from the database counter). The server enforces who may
// do this (HRM.employees.manage), which roles can be given (never more rights than your own) and audits each step.

interface Setup {
    domain: string;
    roles: Array<{ id: string; name: string }>;
    adminPolicy: { designated: number; active: number; maximum: number; minimumActive: number; canManage: boolean };
    missingNumbers: number;
    format: string;
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const EMAIL_LOCAL = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i;
const PHONE = /^\+[1-9]\d{7,14}$/;

/** Actions shown above the employee directory to people who may manage employees (renders nothing otherwise). */
export function HrEmployeeActions({ onChanged }: { onChanged?: () => void }) {
    const [setup, setSetup] = useState<Setup | null>(null);
    const [open, setOpen] = useState(false);
    const load = () => callBackend<Setup>('/api/org/hr/employees/setup').then(setSetup).catch(() => setSetup(null));
    useEffect(() => { void load(); }, []);
    if (!setup) return null;
    return (
        <section className='rounded-2xl border border-line bg-panel p-3 sm:p-4'>
            <div className='flex flex-wrap items-center gap-2'>
                <div className='min-w-0 flex-1'>
                    <h2 className='font-semibold text-ink'>Employee administration</h2>
                    <p className='text-xs text-muted'>Employees get a sign-in account and an employee number ({setup.format.replace(/0/g, 'n')}).</p>
                </div>
                <Button onClick={() => navigate('organization_home/hr/HR02/new')}><UserPlus className='h-4 w-4' />Add employee</Button>
                {setup.missingNumbers > 0 && <Button variant='secondary' onClick={() => setOpen((o) => !o)}><Hash className='h-4 w-4' />Update employee numbers ({setup.missingNumbers})</Button>}
            </div>
            {open && <AssignNumbers onDone={() => { setOpen(false); void load(); onChanged?.(); }} />}
        </section>
    );
}

function AssignNumbers({ onDone }: { onDone: () => void }) {
    const { data, error, loading } = useLoad(() => callBackend<{ count: number; missing: Array<{ uid: string; name: string; email: string; registeredAt: string; currentNumber: string }> }>('/api/org/hr/employees/numbers'));
    const [reason, setReason] = useState('');
    const [ok, setOk] = useState(false);
    const [tried, setTried] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const [done, setDone] = useState('');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load employees without numbers.'}</Alert>;
    const run = async () => {
        setTried(true);
        setFailure('');
        if (reason.trim().length < 10 || !ok) return;
        setBusy(true);
        try {
            const r = await callBackend<{ assigned: number; remaining: number; first: string; last: string }>('/api/org/hr/employees/numbers/assign', { confirm: true, reason: reason.trim() });
            setDone(`${r.assigned} employee number(s) assigned${r.first ? ` (${r.first}${r.last && r.last !== r.first ? ` to ${r.last}` : ''})` : ''}.${r.remaining ? ` ${r.remaining} remain: run it again.` : ''}`);
            if (!r.remaining) setTimeout(onDone, 1500);
        } catch (e) {
            setFailure(msg(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className='mt-3 space-y-3 border-t border-line pt-3'>
            <p className='text-sm text-soft'>{data.count} employee(s) have no employee number. Numbers are given in the order they were registered, oldest first, from the organization counter. Existing numbers never change.</p>
            <ol className='max-h-56 space-y-1 overflow-y-auto overscroll-contain rounded-xl border border-line bg-page p-2 text-xs'>
                {data.missing.map((m, i) => (
                    <li key={m.uid} className='flex items-center gap-2'>
                        <span className='w-6 shrink-0 text-right font-mono text-muted'>{i + 1}</span>
                        <span className='min-w-0 flex-1 truncate text-ink'>{m.name} <span className='text-muted'>· {m.email}</span></span>
                        <span className='shrink-0 text-muted'>{m.registeredAt ? fmtDate(m.registeredAt) : 'date unknown'}</span>
                    </li>
                ))}
            </ol>
            <Field id='emp-num-reason' label='Reason (at least 10 characters)' maxLength={300} value={reason} error={tried && reason.trim().length < 10 ? 'At least 10 characters' : ''} onChange={(e) => setReason(e.target.value)} />
            <ConfirmBox checked={ok} onChange={setOk}>Assign employee numbers to these {data.count} employee(s) in registration order. This is recorded in the audit trail.</ConfirmBox>
            {tried && !ok && <p className='text-xs text-red-400'>Confirm to continue.</p>}
            {failure && <Alert tone='error'>{failure}</Alert>}
            {done && <Alert tone='success'>{done}</Alert>}
            <Button busy={busy} onClick={() => void run()}>Assign employee numbers</Button>
        </div>
    );
}

/** Add an employee: identity, access, sign-in, review. Same rules as before, now owned by HR. */
export default function HrAddEmployee() {
    const { data, error, loading } = useLoad(() => callBackend<Setup>('/api/org/hr/employees/setup'));
    const [step, setStep] = useState(1);
    const [tried, setTried] = useState<Record<number, boolean>>({});
    const [emailLocal, setEmailLocal] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [phone, setPhone] = useState('');
    const [role, setRole] = useState('org_user');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const [created, setCreated] = useState<{ employeeNumber: string; email: string } | null>(null);
    const back = () => navigate('organization_home/hr/HR02');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'You cannot add employees.'}</Alert>;

    const cleanPhone = phone.replace(/[\s()-]/g, '');
    const problems: Record<1 | 2 | 3, string[]> = {
        1: [
            ...(EMAIL_LOCAL.test(emailLocal.trim()) ? [] : ['Email ID: letters, numbers, dots, dashes or underscores.']),
            ...(firstName.trim() ? [] : ['First name.']),
            ...(lastName.trim() ? [] : ['Last name.']),
            ...(PHONE.test(cleanPhone) ? [] : ['Telephone in international format, e.g. +254712345678.']),
        ],
        2: [
            ...(data.roles.some((r) => r.id === role) ? [] : ['Choose a security role.']),
            ...(role === 'org_super_admin' && data.adminPolicy.designated >= data.adminPolicy.maximum ? ['The organization already has the maximum number of administrators.'] : []),
        ],
        3: passwordProblem(password) ? [PASSWORD_RULE] : [],
    };
    const steps: WizardStep[] = [
        { label: 'Identity', open: problems[1].length },
        { label: 'Access', open: problems[2].length },
        { label: 'Sign-in', open: problems[3].length },
        { label: 'Review', open: confirm ? 0 : 1 },
    ];
    const err = (n: 1 | 2 | 3, match: string) => (tried[n] ? problems[n].find((p) => p.startsWith(match)) ?? '' : '');
    const next = () => {
        setFailure('');
        if (step <= 3) {
            const n = step as 1 | 2 | 3;
            setTried((t) => ({ ...t, [n]: true }));
            if (problems[n].length) return setFailure(problems[n][0]);
        }
        setStep((s) => Math.min(4, s + 1));
    };
    const submit = async () => {
        setFailure('');
        const all = [...problems[1], ...problems[2], ...problems[3]];
        if (all.length) return setFailure(`Complete the earlier steps first: ${all[0]}`);
        if (!confirm) return setFailure('Confirm the details before adding the employee.');
        setBusy(true);
        try {
            const r = await callBackend<{ uid: string; employeeNumber: string }>('/api/org/hr/employees/create', { emailLocal: emailLocal.trim().toLowerCase(), firstName: firstName.trim(), lastName: lastName.trim(), phone: cleanPhone, role, password, skillCodes: [], confirm: true });
            setCreated({ employeeNumber: r.employeeNumber, email: `${emailLocal.trim().toLowerCase()}@${data.domain}` });
        } catch (e) {
            setFailure(msg(e));
        } finally {
            setBusy(false);
        }
    };
    const roleName = data.roles.find((r) => r.id === role)?.name ?? role;

    if (created) {
        return (
            <div className='mx-auto max-w-xl space-y-3 p-1'>
                <Alert tone='success'>Employee added. Employee number <strong>{created.employeeNumber}</strong>. {created.email} must change the initial password at first sign-in.</Alert>
                <div className='flex flex-wrap gap-2'>
                    <Button onClick={() => { setCreated(null); setStep(1); setTried({}); setEmailLocal(''); setFirstName(''); setLastName(''); setPhone(''); setPassword(''); setConfirm(false); setRole('org_user'); }}>Add another</Button>
                    <Button variant='secondary' onClick={back}>Back to employee records</Button>
                </div>
            </div>
        );
    }

    return (
        <div className='flex h-[calc(100dvh-9rem)] min-h-[420px] flex-col'>
            <header className='shrink-0 space-y-2 border-b border-line bg-page pb-3'>
                <div className='flex items-center gap-2'>
                    <button type='button' aria-label='Back to employee records' onClick={back} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-soft active:bg-panel'><ArrowLeft className='h-5 w-5' /></button>
                    <div className='min-w-0 flex-1'>
                        <p className='truncate text-xs font-semibold text-brand'>HUMAN RESOURCES · HR02</p>
                        <h1 className='truncate text-base font-semibold text-ink'>Add employee</h1>
                        <p className='truncate text-xs text-muted'>Step {step} of 4 · {steps[step - 1].label}</p>
                    </div>
                    {step > 1 && <Button variant='secondary' disabled={busy} onClick={() => { setFailure(''); setStep(step - 1); }}>Back</Button>}
                    {step < 4 ? <Button onClick={next}>Next</Button> : <Button busy={busy} onClick={() => void submit()}>Add</Button>}
                </div>
                <StepProgress steps={steps} stage={step} onStep={(n) => { setFailure(''); setStep(n); }} />
                {failure && <p role='alert' className='rounded-lg border border-red-500/50 bg-red-500/10 p-2 text-xs text-red-400'>{failure}</p>}
            </header>
            <main className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3'>
                {step === 1 && (
                    <StepSection title='Identity' hint='The email can never be changed afterwards.'>
                        <div className='space-y-3'>
                            <label htmlFor='emp-email' className='block'>
                                <span className='mb-1 block text-sm text-soft'>Email ID *</span>
                                <span className='flex'>
                                    <input id='emp-email' value={emailLocal} onChange={(e) => setEmailLocal(e.target.value.replace(/@.*/, ''))} autoCapitalize='none' autoComplete='off' placeholder='jane.doe' aria-invalid={!!err(1, 'Email')}
                                        className={`h-12 min-w-0 flex-1 rounded-l-xl border bg-page px-3 text-base text-ink placeholder:text-muted focus:outline-none ${err(1, 'Email') ? 'border-red-500/70' : 'border-line focus:border-brand'}`} />
                                    <span className='flex h-12 max-w-[55%] items-center gap-1 truncate rounded-r-xl border border-l-0 border-line bg-panel px-3 text-sm text-soft'><Lock className='h-3.5 w-3.5 shrink-0' />@{data.domain}</span>
                                </span>
                                {err(1, 'Email') && <span className='mt-1 block text-xs text-red-400'>{err(1, 'Email')}</span>}
                            </label>
                            <div className='grid grid-cols-2 gap-3'>
                                <Field id='emp-first' label='First name *' maxLength={40} value={firstName} error={err(1, 'First')} onChange={(e) => setFirstName(e.target.value)} />
                                <Field id='emp-last' label='Last name *' maxLength={40} value={lastName} error={err(1, 'Last')} onChange={(e) => setLastName(e.target.value)} />
                            </div>
                            <Field id='emp-phone' label='Telephone *' type='tel' placeholder='+254712345678' value={phone} error={err(1, 'Telephone')} onChange={(e) => setPhone(e.target.value)} />
                        </div>
                    </StepSection>
                )}
                {step === 2 && (
                    <StepSection title='Access' hint='Standard user gives employee self-service only. Business rights come from the job role or a security role; you can only give roles within your own rights.'>
                        <div className='space-y-3'>
                            <SelectField id='emp-role' label='Security role' required value={role} error={err(2, 'Choose') || err(2, 'The organization')} onChange={(e) => setRole(e.target.value)}>
                                {data.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </SelectField>
                            {role === 'org_super_admin' && <Alert tone='warn'>Organization super admin has every right. {data.adminPolicy.designated} of {data.adminPolicy.maximum} administrator places are used.</Alert>}
                            <p className='text-xs text-muted'>Assign the job role afterwards under Organization design, so location-bound rights follow the position.</p>
                        </div>
                    </StepSection>
                )}
                {step === 3 && (
                    <StepSection title='Sign-in' hint='Share the initial password privately. The employee must change it at first sign-in.'>
                        <Field id='emp-password' label='Initial password *' type='password' autoComplete='new-password' value={password} error={err(3, 'Use')} hint={PASSWORD_RULE} onChange={(e) => setPassword(e.target.value)} />
                    </StepSection>
                )}
                {step === 4 && (
                    <>
                        <ReviewSection title='Identity' onEdit={() => setStep(1)} items={[['Email', `${emailLocal.trim().toLowerCase()}@${data.domain}`], ['Name', `${firstName.trim()} ${lastName.trim()}`], ['Telephone', cleanPhone]]} />
                        <ReviewSection title='Access' onEdit={() => setStep(2)} items={[['Security role', roleName], ['Employee number', `Assigned automatically (${data.format.replace(/0/g, 'n')})`]]} />
                        <ConfirmBox checked={confirm} onChange={setConfirm}>The details are correct and this person is an employee of the organization. Adding is recorded in the audit trail.</ConfirmBox>
                    </>
                )}
            </main>
        </div>
    );
}
