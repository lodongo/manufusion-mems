import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Building2, Check, CircleCheck, Clock, Eye, FileText, Upload, UserRound, X } from 'lucide-react';
import { firebaseAuth } from '../firebase';
import { callBackend } from '../lib/backend';
import { BRAND_PRESETS, BRAND_SWATCHES, buildBrandTheme } from '../lib/brandTheme';
import { fetchReference, type ReferenceData } from '../lib/reference';
import type { Session } from '../types';
import { Alert, Field, PrimaryButton, SelectField } from '../components/ui';
import VerifyEmail from '../components/VerifyEmail';
import BrandPreview from '../components/BrandPreview';
import { Badge, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { formatSize, prepareFile } from './files';
import { AppFrame, Group, ScrollFrame, StepFrame } from './Frame';
import { DOC_SLOTS, STATUS_LABELS, STEPS, type Application } from './types';

const LAST = STEPS.length - 1;

function doneFor(a: Application, key: string): boolean {
    if (key === 'documents') return !!(a.completeness.identity && a.completeness.documents);
    return !!a.completeness[key];
}

function firstIncomplete(a: Application): number {
    const index = STEPS.slice(0, LAST).findIndex((s) => !doneFor(a, s.key));
    return index === -1 ? LAST : index;
}

function useSection(section: string, onSaved: (app: Application) => void) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const save = async (data: Record<string, unknown>) => {
        setBusy(true);
        setError('');
        try {
            const res = await callBackend<{ application: Application }>('/api/applications/save', { section, data });
            onSaved(res.application);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
        } finally {
            setBusy(false);
        }
    };
    return { busy, error, setError, save };
}

function useDocUrl(slot: string, present: boolean, version: string) {
    const [url, setUrl] = useState('');
    useEffect(() => {
        if (!present) {
            setUrl('');
            return;
        }
        let active = true;
        callBackend<{ url: string }>('/api/applications/document-url', { slot })
            .then((res) => {
                if (active) setUrl(res.url);
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, [slot, present, version]);
    return url;
}

export default function ApplicationWizard({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
    const [verified, setVerified] = useState(Boolean(firebaseAuth.currentUser?.emailVerified));
    const [reload, setReload] = useState(0);
    const app = useLoad(() => callBackend<{ application: Application; verificationRequired?: boolean }>('/api/applications/me'), [reload]);
    const ref = useLoad(() => fetchReference());
    const [step, setStep] = useState<number | null>(null);
    const [sheet, setSheet] = useState(false);

    if (!verified && app.data?.verificationRequired === true) {
        return (
            <VerifyEmail
                email={session.user.email}
                message={`To keep your registration secure, confirm ${session.user.email} using the link we sent you, then continue with the next steps. Unverified registrations are removed after 48 hours.`}
                onVerified={() => {
                    setVerified(true);
                    setReload((r) => r + 1);
                }}
                onSignOut={onSignOut}
            />
        );
    }

    if ((app.loading && !app.data) || (ref.loading && !ref.data)) {
        return (
            <AppFrame onSignOut={onSignOut}>
                <ScrollFrame>
                    <div className='flex justify-center py-16'>
                        <div className='h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-400' aria-label='Loading' />
                    </div>
                </ScrollFrame>
            </AppFrame>
        );
    }
    if (app.error || !app.data || !ref.data?.loaded) {
        return (
            <AppFrame onSignOut={onSignOut}>
                <ScrollFrame>
                    <Alert tone='error'>{app.error || 'Registration is temporarily unavailable. Please try again later.'}</Alert>
                </ScrollFrame>
            </AppFrame>
        );
    }

    const a = app.data.application;
    const replace = (next: Application) => app.setData({ ...app.data!, application: next });
    const advance = (next: Application) => {
        replace(next);
        setStep((s) => Math.min((s ?? 0) + 1, LAST));
    };

    if (a.status === 'submitted' || a.status === 'rejected' || a.status === 'approved') {
        return (
            <AppFrame title={STATUS_LABELS[a.status]} onSignOut={onSignOut}>
                <ScrollFrame>
                    <div className='space-y-4 text-center'>
                        {a.status === 'submitted' && <Clock className='mx-auto h-14 w-14 text-amber-400' />}
                        {a.status === 'approved' && <CircleCheck className='mx-auto h-14 w-14 text-emerald-400' />}
                        {a.status === 'rejected' && <X className='mx-auto h-14 w-14 text-red-400' />}
                        <h1 className='text-2xl font-semibold text-white'>{a.status === 'submitted' ? 'Pending approval' : a.status === 'approved' ? 'You are approved' : 'Not approved'}</h1>
                        <p className='text-sm text-slate-300'>
                            {a.status === 'submitted' && (
                                <>
                                    Thank you. <span className='font-medium text-white'>{a.organization.name}</span> was submitted on {fmtDate(a.submittedAt)}. A MEMS administrator will review it, and you can use MEMS once it is approved.
                                </>
                            )}
                            {a.status === 'approved' && `Your organization ${a.orgCode} is ready.`}
                            {a.status === 'rejected' && `Reason: ${a.reviewNote}`}
                        </p>
                        {a.status === 'submitted' && (
                            <button onClick={() => setReload((r) => r + 1)} className='text-sm text-emerald-300 underline'>
                                Check status
                            </button>
                        )}
                        {a.status === 'approved' && <PrimaryButton onClick={() => window.location.reload()}>Open MEMS</PrimaryButton>}
                    </div>
                </ScrollFrame>
            </AppFrame>
        );
    }

    const current = step ?? firstIncomplete(a);
    const back = current > 0 ? () => setStep(current - 1) : undefined;
    const common = { app: a, refData: ref.data, onSaved: advance, onChanged: replace, onBack: back };

    return (
        <AppFrame title={STEPS[current].title} step={current} total={STEPS.length} onSteps={() => setSheet(true)} onSignOut={onSignOut}>
            {a.status === 'returned' && (
                <div className='shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300'>
                    <div className='mx-auto max-w-md'>Changes requested by MEMS: {a.reviewNote}</div>
                </div>
            )}
            {current === 0 && <ApplicantStep {...common} />}
            {current === 1 && <OrganizationStep {...common} />}
            {current === 2 && <RegistrationStep {...common} />}
            {current === 3 && <HeadquartersStep {...common} />}
            {current === 4 && <DocumentsStep {...common} />}
            {current === 5 && <BrandingStep {...common} />}
            {current === 6 && <ReviewStep {...common} onEdit={setStep} />}
            {sheet && (
                <div className='fixed inset-0 z-50 flex items-end bg-black/60' onClick={() => setSheet(false)}>
                    <div className='max-h-[80dvh] w-full overflow-y-auto rounded-t-3xl border-t border-slate-800 bg-slate-900 pb-[max(env(safe-area-inset-bottom),1rem)]' onClick={(e) => e.stopPropagation()}>
                        <div className='sticky top-0 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-5 py-4'>
                            <p className='font-semibold text-white'>Registration steps</p>
                            <button onClick={() => setSheet(false)} aria-label='Close steps' className='flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-slate-300'>
                                <X className='h-4 w-4' />
                            </button>
                        </div>
                        <ul className='px-3 py-2'>
                            {STEPS.map((s, i) => {
                                const done = i < LAST && doneFor(a, s.key);
                                return (
                                    <li key={s.key}>
                                        <button
                                            onClick={() => {
                                                setStep(i);
                                                setSheet(false);
                                            }}
                                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${i === current ? 'bg-emerald-500/10' : ''}`}
                                        >
                                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? 'bg-emerald-500 text-onbrand' : 'border border-slate-700 text-slate-400'}`}>
                                                {done ? <Check className='h-4 w-4' /> : i + 1}
                                            </span>
                                            <span className='min-w-0'>
                                                <span className='block text-sm font-medium text-white'>{s.title}</span>
                                                <span className='block truncate text-xs text-slate-500'>{s.hint}</span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
            )}
        </AppFrame>
    );
}

interface StepProps {
    app: Application;
    refData: ReferenceData;
    onSaved: (app: Application) => void;
    onChanged: (app: Application) => void;
    onBack?: () => void;
}

function useLists(refData: ReferenceData) {
    return useMemo(
        () => ({
            countries: [...refData.countries].sort((x, y) => x.name.localeCompare(y.name)),
            currencies: [...refData.currencies].sort((x, y) => Number(y.usedInAfrica) - Number(x.usedInAfrica) || x.code.localeCompare(y.code)),
            meta: (key: string) => refData.metadataLists.find((l) => l.key === key)?.items ?? [],
        }),
        [refData]
    );
}

function ApplicantStep({ app, refData, onSaved, onBack }: StepProps) {
    const lists = useLists(refData);
    const v = app.applicant;
    const [f, setF] = useState({ title: v.title ?? '', firstName: v.firstName ?? '', lastName: v.lastName ?? '', phoneCountry: v.phoneCountry ?? 'KE', phoneLocal: v.phoneLocal ?? '' });
    const { busy, error, save } = useSection('applicant', onSaved);
    const dial = lists.countries.find((c) => c.iso2 === f.phoneCountry)?.dialCode ?? '';
    return (
        <StepFrame hint={STEPS[0].hint} primary='Save and continue' busy={busy} error={error} onBack={onBack} onSubmit={() => save(f)}>
            <div className='rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300'>{app.email}</div>
            <Group title='About you'>
                <SelectField id='ap-title' label='Title (optional)' value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}>
                    <option value=''>None</option>
                    {lists.meta('titles').map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                </SelectField>
                <div className='grid grid-cols-2 gap-3'>
                    <Field id='ap-first' label='First name' maxLength={40} value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
                    <Field id='ap-last' label='Last name' maxLength={40} value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
                </div>
            </Group>
            <Group title='Telephone'>
                <SelectField id='ap-phone-country' label='Country' value={f.phoneCountry} onChange={(e) => setF({ ...f, phoneCountry: e.target.value })}>
                    {lists.countries.map((c) => <option key={c.iso2} value={c.iso2}>{c.flag} {c.name} ({c.dialCode})</option>)}
                </SelectField>
                <Field id='ap-phone' label={`Number (${dial})`} type='tel' inputMode='tel' value={f.phoneLocal} onChange={(e) => setF({ ...f, phoneLocal: e.target.value })} />
            </Group>
        </StepFrame>
    );
}

function OrganizationStep({ app, refData, onSaved, onBack }: StepProps) {
    const lists = useLists(refData);
    const v = app.organization;
    const [f, setF] = useState({ name: v.name ?? '', legalEntityType: v.legalEntityType ?? '', industryCategory: v.industryCategory ?? '', industry: v.industry ?? '', companySize: v.companySize ?? '', currencyCode: v.currencyCode ?? '', website: v.website ?? '' });
    const categories = lists.meta('industryCategories').filter((x) => x.active !== false);
    const subcategories = lists.meta('industries').filter((x) => x.categoryCode === f.industryCategory && x.active !== false);
    const { busy, error, save } = useSection('organization', onSaved);
    const sel = (key: 'legalEntityType' | 'companySize', label: string, list: string) => (
        <SelectField id={`org-${key}`} label={label} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
            <option value=''>Select...</option>
            {lists.meta(list).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </SelectField>
    );
    return (
        <StepFrame hint={STEPS[1].hint} primary='Save and continue' busy={busy} error={error} onBack={onBack} onSubmit={() => save(f)}>
            <Group title='Identity'>
                <Field id='org-name' label='Registered organization name' maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                <p className='-mt-1 text-xs text-slate-500'>Email extension: @{app.domain}</p>
                {sel('legalEntityType', 'Legal entity type', 'legalEntityTypes')}
            </Group>
            <Group title='Business'>
                <SelectField id='org-industry-category' label='Industry category' value={f.industryCategory} onChange={(e) => setF({ ...f, industryCategory: e.target.value, industry: '' })}>
                    <option value=''>Select an industry category...</option>
                    {categories.map((category) => <option key={category.code} value={category.code}>{category.code} — {category.label}</option>)}
                </SelectField>
                <SelectField id='org-industry-subcategory' label='Industry subcategory' value={f.industry} disabled={!f.industryCategory} onChange={(e) => setF({ ...f, industry: e.target.value })}>
                    <option value=''>{f.industryCategory ? 'Select your primary activity...' : 'Choose a category first...'}</option>
                    {subcategories.map((type) => <option key={type.code} value={type.code}>{type.code} — {type.label}{type.isicClass?` · ISIC Rev.5 ${type.isicClass}`:''}</option>)}
                </SelectField>
                <p className='-mt-1 text-xs text-slate-500'>Your primary activity determines recommended GL, Materials, Services and Assets. Other classifications remain available for authorized manual adoption.</p>
                {!categories.length && <Alert tone='error'>Industry categories are not loaded. Ask the MEMS administrator to load Industry categories and Industry subcategories under Default values.</Alert>}
                {sel('companySize', 'Company size', 'companySizes')}
                <SelectField id='org-currency' label='Base currency' value={f.currencyCode} onChange={(e) => setF({ ...f, currencyCode: e.target.value })}>
                    <option value=''>Select...</option>
                    {lists.currencies.map((c) => <option key={c.code} value={c.code}>{c.code} - {c.name}</option>)}
                </SelectField>
                <Field id='org-website' label='Website (optional, https://)' maxLength={200} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
            </Group>
        </StepFrame>
    );
}

function RegistrationStep({ app, refData, onSaved, onBack }: StepProps) {
    const lists = useLists(refData);
    const v = app.registration;
    const [f, setF] = useState({ countryCode: v.countryCode ?? '', registrationNumber: v.registrationNumber ?? '', registrationDate: v.registrationDate ?? '', taxNumber: v.taxNumber ?? '', originCountryCode: v.originCountryCode ?? '', originOther: v.originOther ?? '' });
    const { busy, error, save } = useSection('registration', onSaved);
    return (
        <StepFrame hint={STEPS[2].hint} primary='Save and continue' busy={busy} error={error} onBack={onBack} onSubmit={() => save(f)}>
            <Group title='Local registration'>
                <SelectField id='reg-country' label='Country of registration' value={f.countryCode} onChange={(e) => setF({ ...f, countryCode: e.target.value })}>
                    <option value=''>Select...</option>
                    {lists.countries.map((c) => <option key={c.iso2} value={c.iso2}>{c.flag} {c.name}</option>)}
                </SelectField>
                <Field id='reg-number' label='Registration / incorporation number' maxLength={60} value={f.registrationNumber} onChange={(e) => setF({ ...f, registrationNumber: e.target.value })} />
                <Field id='reg-date' label='Date of registration' type='date' max={new Date().toISOString().slice(0, 10)} value={f.registrationDate} onChange={(e) => setF({ ...f, registrationDate: e.target.value })} />
                <Field id='reg-tax' label='Tax number (optional)' maxLength={40} value={f.taxNumber} onChange={(e) => setF({ ...f, taxNumber: e.target.value })} />
            </Group>
            <Group title='Origin'>
                <SelectField id='reg-origin' label='Country of origin' value={f.originCountryCode} onChange={(e) => setF({ ...f, originCountryCode: e.target.value })}>
                    <option value=''>Select...</option>
                    {lists.countries.map((c) => <option key={c.iso2} value={c.iso2}>{c.flag} {c.name}</option>)}
                    <option value='OTHER'>Outside Africa</option>
                </SelectField>
                {f.originCountryCode === 'OTHER' && <Field id='reg-origin-other' label='Country of origin (outside Africa)' maxLength={60} value={f.originOther} onChange={(e) => setF({ ...f, originOther: e.target.value })} />}
            </Group>
        </StepFrame>
    );
}

function HeadquartersStep({ app, refData, onSaved, onBack }: StepProps) {
    const lists = useLists(refData);
    const v = app.headquarters;
    const [f, setF] = useState({ countryCode: v.countryCode ?? app.registration.countryCode ?? '', city: v.city ?? '', address: v.address ?? '', postalAddress: v.postalAddress ?? '' });
    const { busy, error, save } = useSection('headquarters', onSaved);
    return (
        <StepFrame hint={STEPS[3].hint} primary='Save and continue' busy={busy} error={error} onBack={onBack} onSubmit={() => save(f)}>
            <Group title='Location'>
                <SelectField id='hq-country' label='Country' value={f.countryCode} onChange={(e) => setF({ ...f, countryCode: e.target.value })}>
                    <option value=''>Select...</option>
                    {lists.countries.map((c) => <option key={c.iso2} value={c.iso2}>{c.flag} {c.name}</option>)}
                </SelectField>
                <Field id='hq-city' label='City or town' maxLength={80} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
            </Group>
            <Group title='Address'>
                <Field id='hq-address' label='Physical address' maxLength={200} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
                <Field id='hq-postal' label='Postal address (optional)' maxLength={120} value={f.postalAddress} onChange={(e) => setF({ ...f, postalAddress: e.target.value })} />
            </Group>
        </StepFrame>
    );
}

function UploadRow({ slot, app, onChanged }: { slot: (typeof DOC_SLOTS)[number]; app: Application; onChanged: (a: Application) => void }) {
    const meta = app.documents[slot.key];
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const upload = async (file?: File) => {
        if (!file) return;
        setBusy(true);
        setError('');
        try {
            const prepared = await prepareFile(file, slot.imageOnly, { logo: slot.key === 'logo' });
            const res = await callBackend<{ application: Application }>('/api/applications/upload', { slot: slot.key, fileName: prepared.name, data: prepared.data });
            onChanged(res.application);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed.');
        } finally {
            setBusy(false);
        }
    };
    const view = async () => {
        try {
            const res = await callBackend<{ url: string }>('/api/applications/document-url', { slot: slot.key });
            if (res.url) window.open(res.url, '_blank', 'noopener,noreferrer');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not open the file.');
        }
    };
    return (
        <div className={`rounded-2xl border p-3 ${meta ? 'border-emerald-500/40 bg-emerald-500/5' : slot.required ? 'border-slate-700' : 'border-slate-800'}`}>
            <div className='flex items-center gap-3'>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${meta ? 'bg-emerald-500 text-onbrand' : 'bg-slate-800 text-slate-400'}`}>
                    {meta ? <Check className='h-5 w-5' /> : <FileText className='h-5 w-5' />}
                </span>
                <div className='min-w-0 flex-1'>
                    <p className='text-sm font-medium text-white'>
                        {slot.label}
                        {slot.required && <span className='text-red-400'> *</span>}
                    </p>
                    <p className='truncate text-xs text-slate-500'>{meta ? `${meta.name} · ${formatSize(meta.size)}` : slot.hint}</p>
                </div>
                {meta && (
                    <button type='button' onClick={view} aria-label={`View ${slot.label}`} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-slate-200'>
                        <Eye className='h-4 w-4' />
                    </button>
                )}
            </div>
            <label className='mt-3 flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 text-sm text-slate-200'>
                <Upload className='h-4 w-4' />
                {busy ? 'Uploading...' : meta ? 'Replace file' : 'Choose file or take photo'}
                <input
                    type='file'
                    className='hidden'
                    accept={slot.imageOnly ? 'image/jpeg,image/png' : 'application/pdf,image/jpeg,image/png'}
                    disabled={busy}
                    onChange={(e) => {
                        void upload(e.target.files?.[0]);
                        e.target.value = '';
                    }}
                />
            </label>
            {error && <p className='mt-2 text-xs text-red-400'>{error}</p>}
        </div>
    );
}

function DocumentsStep({ app, refData, onSaved, onChanged, onBack }: StepProps) {
    const lists = useLists(refData);
    const [f, setF] = useState({ idType: app.identity.idType ?? '', idNumber: app.identity.idNumber ?? '' });
    const { busy, error, setError, save } = useSection('identity', onSaved);
    const slots = DOC_SLOTS.filter((d) => d.step === 'documents');
    return (
        <StepFrame
            hint={STEPS[4].hint}
            primary='Save and continue'
            busy={busy}
            error={error}
            onBack={onBack}
            onSubmit={() => {
                const missing = slots.filter((d) => d.required && !app.documents[d.key]);
                if (missing.length) return setError(`Please upload: ${missing.map((m) => m.label).join(', ')}.`);
                void save(f);
            }}
        >
            <Group title='Your identity'>
                <SelectField id='id-type' label='Identity document' value={f.idType} onChange={(e) => setF({ ...f, idType: e.target.value })}>
                    <option value=''>Select...</option>
                    {lists.meta('identityDocumentTypes').map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </SelectField>
                <Field id='id-number' label='Document number' maxLength={40} value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value })} />
            </Group>
            <Group title='Upload documents'>
                <p className='-mt-1 text-xs text-slate-500'>PDF, JPEG or PNG up to 3 MB. Photos are compressed to save data.</p>
                {slots.map((s) => (
                    <UploadRow key={s.key} slot={s} app={app} onChanged={onChanged} />
                ))}
            </Group>
        </StepFrame>
    );
}

function ImagePicker({
    label,
    url,
    round,
    busy,
    required,
    icon,
    onFile,
}: {
    label: string;
    url: string;
    round?: boolean;
    busy: boolean;
    required?: boolean;
    icon: ReactNode;
    onFile: (file?: File) => void;
}) {
    return (
        <label className='flex cursor-pointer flex-col items-center gap-2 text-center'>
            <span className={`relative flex h-24 w-24 items-center justify-center overflow-hidden border-2 border-dashed border-slate-600 bg-slate-900 ${round ? 'rounded-full' : 'rounded-2xl'}`}>
                {url ? <img src={url} alt={label} className={`h-full w-full ${round ? 'object-cover' : 'object-contain p-1'}`} /> : icon}
                {busy && <span className='absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white'>Uploading...</span>}
            </span>
            <span className='text-xs font-medium text-slate-200'>
                {label}
                {required && <span className='text-red-400'> *</span>}
            </span>
            <span className='text-[11px] text-emerald-300'>{url ? 'Change' : 'Upload'}</span>
            <input
                type='file'
                className='hidden'
                accept='image/jpeg,image/png'
                disabled={busy}
                onChange={(e) => {
                    onFile(e.target.files?.[0]);
                    e.target.value = '';
                }}
            />
        </label>
    );
}

function BrandingStep({ app, onSaved, onChanged, onBack }: StepProps) {
    const v = app.branding;
    const [f, setF] = useState({
        displayName: v.displayName ?? (app.organization.name ?? '').slice(0, 40),
        slogan: v.slogan ?? '',
        preset: v.preset ?? 'emerald',
        brandColor: v.brandColor ?? '#10b981',
    });
    const { busy, error, setError, save } = useSection('branding', onSaved);
    const [uploading, setUploading] = useState('');
    const logoUrl = useDocUrl('logo', !!app.documents.logo, app.documents.logo?.uploadedAt ?? '');
    const photoUrl = useDocUrl('photo', !!app.documents.photo, app.documents.photo?.uploadedAt ?? '');
    const theme = buildBrandTheme(f.preset, f.brandColor);

    const upload = async (slot: 'logo' | 'photo', file?: File) => {
        if (!file) return;
        setUploading(slot);
        setError('');
        try {
            const prepared = await prepareFile(file, true, { logo: slot === 'logo' });
            const res = await callBackend<{ application: Application }>('/api/applications/upload', { slot, fileName: prepared.name, data: prepared.data });
            onChanged(res.application);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed.');
        } finally {
            setUploading('');
        }
    };

    return (
        <StepFrame
            hint={STEPS[5].hint}
            primary='Save and continue'
            busy={busy}
            error={error}
            onBack={onBack}
            onSubmit={() => {
                if (!app.documents.logo) return setError('Upload your organization logo.');
                if (!app.documents.photo) return setError('Upload your photo.');
                void save(f);
            }}
        >
            <div className='grid grid-cols-2 gap-4'>
                <ImagePicker label='Logo' url={logoUrl} busy={uploading === 'logo'} required icon={<Building2 className='h-8 w-8 text-slate-500' />} onFile={(file) => upload('logo', file)} />
                <ImagePicker label='Your photo' url={photoUrl} round busy={uploading === 'photo'} required icon={<UserRound className='h-8 w-8 text-slate-500' />} onFile={(file) => upload('photo', file)} />
            </div>
            <Group title='Brand'>
                <Field id='br-name' label='Brand name your team will see' maxLength={40} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
                <Field id='br-slogan' label='Slogan' maxLength={120} placeholder='e.g. Quality you can taste' value={f.slogan} onChange={(e) => setF({ ...f, slogan: e.target.value })} />
            </Group>
            <Group title='Theme'>
                <div className='grid grid-cols-2 gap-2'>
                    {BRAND_PRESETS.map((p) => (
                        <button
                            key={p.key}
                            type='button'
                            onClick={() => setF({ ...f, preset: p.key })}
                            className={`flex items-center gap-2 rounded-xl border p-2 text-left text-sm ${f.preset === p.key ? 'border-emerald-500 bg-emerald-500/10 text-white' : 'border-slate-700 text-slate-300'}`}
                        >
                            <span className='flex h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-slate-700'>
                                <span className='flex-1' style={{ background: p.theme.page }} />
                                <span className='flex-1' style={{ background: p.theme.panel }} />
                            </span>
                            {p.label}
                        </button>
                    ))}
                </div>
            </Group>
            <Group title='Brand colour'>
                <div className='flex flex-wrap gap-2'>
                    {BRAND_SWATCHES.map((c) => (
                        <button
                            key={c}
                            type='button'
                            aria-label={`Colour ${c}`}
                            onClick={() => setF({ ...f, brandColor: c })}
                            className={`h-11 w-11 rounded-full border-2 ${f.brandColor.toLowerCase() === c ? 'border-white' : 'border-transparent'}`}
                            style={{ background: c }}
                        />
                    ))}
                    <label className='flex h-9 items-center gap-2 rounded-full border border-slate-700 pl-1 pr-3 text-xs text-slate-300'>
                        <input type='color' value={f.brandColor} onChange={(e) => setF({ ...f, brandColor: e.target.value })} className='h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent' aria-label='Custom colour' />
                        Custom
                    </label>
                </div>
            </Group>
            <Group title='Preview'>
                <BrandPreview name={f.displayName} slogan={f.slogan} logoUrl={logoUrl} theme={theme} />
            </Group>
        </StepFrame>
    );
}

function ReviewStep({ app, refData, onBack, onEdit, onChanged }: StepProps & { onEdit: (step: number) => void }) {
    const lists = useLists(refData);
    const [declared, setDeclared] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const logoUrl = useDocUrl('logo', !!app.documents.logo, app.documents.logo?.uploadedAt ?? '');
    const country = (iso: string) => lists.countries.find((c) => c.iso2 === iso)?.name ?? iso;
    const label = (list: string, code: string) => lists.meta(list).find((o) => o.code === code)?.label ?? code;
    const missing = STEPS.slice(0, LAST).map((s, i) => ({ s, i })).filter(({ s }) => !doneFor(app, s.key));
    const b = app.branding;

    const sections: Array<{ step: number; title: string; rows: Array<[string, string]> }> = [
        { step: 0, title: 'You', rows: [['Name', `${label('titles', app.applicant.title ?? '')} ${app.applicant.firstName ?? ''} ${app.applicant.lastName ?? ''}`.trim()], ['Email', app.email], ['Phone', app.applicant.phone ?? '']] },
        { step: 1, title: 'Organization', rows: [['Name', app.organization.name ?? ''], ['Legal entity', label('legalEntityTypes', app.organization.legalEntityType ?? '')], ['Industry category', label('industryCategories', app.organization.industryCategory ?? '')], ['Industry subcategory', label('industries', app.organization.industry ?? '')], ['Size', label('companySizes', app.organization.companySize ?? '')], ['Currency', app.organization.currencyCode ?? '']] },
        { step: 2, title: 'Registration', rows: [['Country', country(app.registration.countryCode ?? '')], ['Number', app.registration.registrationNumber ?? ''], ['Date', app.registration.registrationDate ?? ''], ['Origin', app.registration.originCountryCode === 'OTHER' ? app.registration.originOther ?? '' : country(app.registration.originCountryCode ?? '')]] },
        { step: 3, title: 'Headquarters', rows: [['Location', `${app.headquarters.city ?? ''}, ${country(app.headquarters.countryCode ?? '')}`], ['Address', app.headquarters.address ?? '']] },
        {
            step: 4,
            title: 'Documents',
            rows: [
                ['ID', `${label('identityDocumentTypes', app.identity.idType ?? '')} ${app.identity.idNumber ?? ''}`.trim()],
                ...DOC_SLOTS.filter((d) => d.step === 'documents').map((d) => [d.label, app.documents[d.key] ? 'Uploaded' : d.required ? 'Missing' : 'Not provided'] as [string, string]),
            ],
        },
    ];

    const submit = async () => {
        setError('');
        if (missing.length) return setError(`Still to complete: ${missing.map((m) => m.s.title).join(', ')}.`);
        if (!declared) return setError('Please confirm the declaration.');
        setBusy(true);
        try {
            const res = await callBackend<{ application: Application }>('/api/applications/submit', { declaration: true });
            onChanged(res.application);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not submit.');
            setBusy(false);
        }
    };

    return (
        <StepFrame hint={STEPS[6].hint} primary='Submit for approval' busy={busy} error={error} onBack={onBack} onSubmit={submit}>
            {missing.length > 0 && <Alert tone='error'>Still to complete: {missing.map((m) => m.s.title).join(', ')}.</Alert>}
            <section className='space-y-3'>
                <div className='flex items-center justify-between'>
                    <h3 className='text-xs font-semibold uppercase tracking-wider text-slate-500'>Your brand in MEMS</h3>
                    <button type='button' onClick={() => onEdit(5)} className='text-sm text-emerald-300'>
                        Edit
                    </button>
                </div>
                <BrandPreview name={b.displayName ?? ''} slogan={b.slogan ?? ''} logoUrl={logoUrl} theme={buildBrandTheme(b.preset ?? 'emerald', b.brandColor ?? '#10b981')} />
            </section>
            {sections.map((s) => (
                <section key={s.title} className='rounded-2xl border border-slate-800 bg-slate-900 p-4'>
                    <div className='mb-2 flex items-center justify-between'>
                        <h3 className='font-semibold text-white'>{s.title}</h3>
                        <button type='button' onClick={() => onEdit(s.step)} className='text-sm text-emerald-300'>
                            Edit
                        </button>
                    </div>
                    {s.rows.map(([k, val]) => (
                        <div key={k} className='flex justify-between gap-3 py-1 text-sm'>
                            <span className='text-slate-400'>{k}</span>
                            <span className={`text-right ${val === 'Missing' ? 'text-red-400' : 'text-white'}`}>{val || '—'}</span>
                        </div>
                    ))}
                </section>
            ))}
            <label className='flex items-start gap-3 rounded-2xl border border-slate-800 p-4 text-sm text-slate-300'>
                <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0 accent-emerald-500' checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
                I confirm that I am authorised to register this organization and that the information and documents provided are true and complete.
            </label>
            <Badge>{STATUS_LABELS[app.status] ?? app.status}</Badge>
        </StepFrame>
    );
}
