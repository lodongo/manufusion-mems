import { useState } from 'react';
import { ExternalLink, Lock, Plus, Trash2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { FEATURE_ICON_MAP, FEATURE_ICON_NAMES } from '../lib/icons';
import { THEME_LABELS, THEME_PRESETS, applyTheme, useSite, type SiteConfig, type Theme } from '../lib/site';
import { Alert, Field, SelectField } from '../components/ui';
import { fmtDate } from './format';
import { Button, Card, PageTitle, SubTabs, TextArea } from './kit';

export default function SiteSetupPage({ canWrite }: { canWrite: boolean }) {
    const { config, locked, setConfig } = useSite();
    const [draft, setDraft] = useState<SiteConfig>(() => JSON.parse(JSON.stringify(config)) as SiteConfig);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const ro = !canWrite;
    const [section, setSection] = useState('brand');
    const hide = (key: string) => (section === key ? '' : 'hidden');

    const set = <K extends keyof SiteConfig>(key: K, value: SiteConfig[K]) => setDraft((d) => ({ ...d, [key]: value }));
    const setTheme = (theme: Theme) => {
        set('theme', theme);
        applyTheme(theme);
    };

    const save = async () => {
        setBusy('save');
        setError('');
        setInfo('');
        try {
            const res = await callBackend<{ config: SiteConfig }>('/api/admin/site/save', { config: draft });
            setConfig(res.config);
            setDraft(res.config);
            setInfo('Site setup saved.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
        } finally {
            setBusy('');
        }
    };

    const reset = async () => {
        if (!window.confirm('Reset the MEMS website and theme to the defaults?')) return;
        setBusy('reset');
        setError('');
        setInfo('');
        try {
            const res = await callBackend<{ config: SiteConfig }>('/api/admin/site/reset');
            setConfig(res.config);
            setDraft(res.config);
            setInfo('Site setup reset to defaults.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not reset.');
        } finally {
            setBusy('');
        }
    };

    const discard = () => {
        setDraft(JSON.parse(JSON.stringify(config)) as SiteConfig);
        applyTheme(config.theme);
        setInfo('');
        setError('');
    };

    const textField = (key: keyof SiteConfig, label: string, max: number) => (
        <Field id={`site-${key}`} label={label} maxLength={max} value={String(draft[key] ?? '')} disabled={ro} onChange={(e) => set(key, e.target.value as never)} />
    );

    return (
        <div className='space-y-4 pb-24'>
            <PageTitle
                title='Site setup'
                subtitle='Configure the MEMS website, login page and theme'
                action={
                    <a href='#site' target='_blank' rel='noopener noreferrer' className='flex h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200'>
                        <ExternalLink className='h-4 w-4' />
                        Preview
                    </a>
                }
            />

            <SubTabs
                value={section}
                onChange={setSection}
                tabs={[
                    { key: 'brand', label: 'Branding' },
                    { key: 'website', label: 'Website content and features' },
                    { key: 'login', label: 'Login page and links' },
                    { key: 'theme', label: 'Theme and colours' },
                    { key: 'locked', label: 'Critical details (locked)' },
                ]}
            />
            <Card className={`space-y-4 ${hide('brand')}`}>
                <h2 className='font-semibold text-white'>Branding</h2>
                {draft.logoUrl&&<img src={draft.logoUrl} alt='Current MEMS logo' className='mx-auto max-h-32 max-w-full object-contain'/>}
                <label className='block text-sm text-ink'>Upload MEMS logo (PNG with transparent background preferred)<input type='file' accept='image/png,image/jpeg,image/webp' disabled={ro||!!busy} className='mt-2 block w-full text-sm text-ink' onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>1200000){setError('Logo must be under 1.2 MB.');return;}setBusy('logo');setError('');try{const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.onerror=()=>reject(new Error('Could not read logo'));reader.readAsDataURL(file)});const res=await callBackend<{logoUrl:string}>('/api/admin/site/logo',{data,mime:file.type});setDraft(d=>({...d,logoUrl:res.logoUrl}));setConfig({...config,logoUrl:res.logoUrl});setInfo('MEMS logo uploaded.');}catch(err){setError(err instanceof Error?err.message:'Logo upload failed.')}finally{setBusy('')}}}/></label>
                {textField('brandName', 'Brand name', 30)}
                {textField('tagline', 'Catchy phrase / tagline', 120)}
                {textField('platformName', 'Platform name', 80)}
                {textField('organizationFooterMessage', 'Organization footer message', 160)}
                <p className='text-xs text-slate-400'>Displayed beside the MEMS logo at the bottom of organization pages. Leave blank to use the default: Run by Manufusion Africa Limited © {new Date().getFullYear()}.</p>
            </Card>

            <Card className={`space-y-4 ${hide('website')}`}>
                <h2 className='font-semibold text-white'>Website content</h2>
                {textField('heroTitle', 'Headline', 120)}
                <TextArea id='site-heroDescription' label='Description' rows={4} maxLength={600} value={draft.heroDescription} disabled={ro} onChange={(e) => set('heroDescription', e.target.value)} />
                {textField('registerButtonLabel', 'Register button label', 40)}
                {textField('footerText', 'Footer text', 160)}
            </Card>

            <Card className={`space-y-4 ${hide('website')}`}>
                <div className='flex items-center justify-between'>
                    <h2 className='font-semibold text-white'>Website features ({draft.features.length}/8)</h2>
                    {!ro && draft.features.length < 8 && (
                        <Button variant='secondary' onClick={() => set('features', [...draft.features, { icon: 'boxes', title: '', text: '' }])}>
                            <Plus className='h-4 w-4' />
                            Add
                        </Button>
                    )}
                </div>
                {draft.features.map((feature, index) => {
                    const Icon = FEATURE_ICON_MAP[feature.icon] ?? FEATURE_ICON_MAP.boxes;
                    const update = (patch: Partial<typeof feature>) =>
                        set('features', draft.features.map((f, i) => (i === index ? { ...f, ...patch } : f)));
                    return (
                        <div key={index} className='space-y-3 rounded-xl border border-slate-800 p-3'>
                            <div className='flex items-center gap-2'>
                                <Icon className='h-5 w-5 shrink-0 text-emerald-400' />
                                <select
                                    aria-label='Icon'
                                    value={feature.icon}
                                    disabled={ro}
                                    onChange={(e) => update({ icon: e.target.value })}
                                    className='h-10 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-white'
                                >
                                    {FEATURE_ICON_NAMES.map((name) => (
                                        <option key={name} value={name}>
                                            {name}
                                        </option>
                                    ))}
                                </select>
                                {!ro && (
                                    <button
                                        type='button'
                                        aria-label='Remove feature'
                                        onClick={() => set('features', draft.features.filter((_, i) => i !== index))}
                                        className='flex h-10 w-10 items-center justify-center rounded-lg border border-red-500/40 text-red-400'
                                    >
                                        <Trash2 className='h-4 w-4' />
                                    </button>
                                )}
                            </div>
                            <Field id={`feature-title-${index}`} label='Title' maxLength={40} value={feature.title} disabled={ro} onChange={(e) => update({ title: e.target.value })} />
                            <Field id={`feature-text-${index}`} label='Text' maxLength={160} value={feature.text} disabled={ro} onChange={(e) => update({ text: e.target.value })} />
                        </div>
                    );
                })}
            </Card>

            <Card className={`space-y-4 ${hide('login')}`}>
                <h2 className='font-semibold text-white'>Login page and links</h2>
                {textField('loginSubtitle', 'Login subtitle (optional)', 120)}
                {textField('forgotPasswordText', 'Forgot password note (bottom of login page)', 200)}
                {textField('loginButtonLabel', 'Login button label', 30)}
                {textField('memsWebsiteLinkLabel', 'Website link label (login page)', 40)}
                {textField('companyWebsiteLabel', 'Company website link label', 40)}
                {textField('companyWebsiteUrl', 'Company website URL', 200)}
                {textField('supportEmail', `Support email (@${locked.staffEmailDomain})`, 120)}
                {textField('supportPhone', 'Support telephone (optional, e.g. +254712345678)', 20)}
            </Card>

            <Card className={`space-y-4 ${hide('theme')}`}>
                <h2 className='font-semibold text-white'>Theme</h2>
                <div className='grid grid-cols-2 gap-2'>
                    {THEME_PRESETS.map((preset) => (
                        <button
                            key={preset.name}
                            type='button'
                            disabled={ro}
                            onClick={() => setTheme(preset.theme)}
                            className='flex items-center gap-2 rounded-xl border border-slate-700 p-2 text-left text-sm text-slate-200'
                        >
                            <span className='flex h-8 w-8 shrink-0 overflow-hidden rounded-lg'>
                                <span className='flex-1' style={{ background: preset.theme.page }} />
                                <span className='flex-1' style={{ background: preset.theme.brand }} />
                            </span>
                            {preset.name}
                        </button>
                    ))}
                </div>
                <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                    {(Object.keys(THEME_LABELS) as Array<keyof Theme>).map((key) => (
                        <label key={key} className='flex items-center justify-between gap-3 rounded-xl border border-slate-800 px-3 py-2'>
                            <span className='text-sm text-slate-300'>{THEME_LABELS[key]}</span>
                            <span className='flex items-center gap-2'>
                                <span className='font-mono text-xs text-slate-500'>{draft.theme[key]}</span>
                                <input
                                    type='color'
                                    value={draft.theme[key]}
                                    disabled={ro}
                                    onChange={(e) => setTheme({ ...draft.theme, [key]: e.target.value })}
                                    className='h-9 w-9 cursor-pointer rounded border border-slate-700 bg-transparent'
                                />
                            </span>
                        </label>
                    ))}
                </div>
                <p className='text-xs text-slate-500'>Colour changes preview immediately. Save to apply them for everyone.</p>
            </Card>

            <Card className={`space-y-3 ${hide('locked')}`}>
                <h2 className='flex items-center gap-2 font-semibold text-white'>
                    <Lock className='h-4 w-4' />
                    Critical details (locked)
                </h2>
                {[
                    { label: 'MEMS staff email extension', value: `@${locked.staffEmailDomain}` },
                    { label: 'Firebase project', value: locked.firebaseProjectId },
                    { label: 'Super admin setup completed', value: fmtDate(locked.setupCompletedAt) },
                    { label: 'Sign-in method', value: 'Email and password only' },
                    { label: 'Public email addresses', value: 'Always blocked' },
                ].map((row) => (
                    <div key={row.label} className='flex items-center justify-between gap-3 text-sm'>
                        <span className='text-slate-400'>{row.label}</span>
                        <span className='text-right font-medium text-white'>{row.value}</span>
                    </div>
                ))}
            </Card>

            {error && <Alert tone='error'>{error}</Alert>}
            {info && <Alert tone='info'>{info}</Alert>}
            {canWrite && (
                <div className='flex flex-wrap gap-2'>
                    <Button className='flex-1' busy={busy === 'save'} disabled={!!busy} onClick={save}>
                        Save site setup
                    </Button>
                    <Button variant='secondary' disabled={!!busy} onClick={discard}>
                        Discard
                    </Button>
                    <Button variant='danger' busy={busy === 'reset'} disabled={!!busy} onClick={reset}>
                        Reset
                    </Button>
                </div>
            )}
            {!canWrite && (
                <SelectField id='ro' label='Access' value='ro' disabled onChange={() => undefined}>
                    <option value='ro'>Read-only</option>
                </SelectField>
            )}
        </div>
    );
}
