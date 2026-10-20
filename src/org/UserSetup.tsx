import { useState } from 'react';
import { CheckCircle2, Home, History, Palette } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Badge, Button, Card, PageTitle } from '../admin/kit';
import { DEFAULT_USER_PREFERENCES } from '../lib/personalTheme';
import { BRAND_PRESETS } from '../lib/brandTheme';
import { HeartPulse } from 'lucide-react';
import { navigate } from '../lib/route';
import HomeLayoutEditor from './HomeLayoutEditor';
import type { Session, UserPreferences } from '../types';

const APPEARANCES = [
    { value: 'organization', title: 'Organization default', dark: false, theme: null },
    ...BRAND_PRESETS.map((p) => ({ value: p.key, title: p.label, dark: p.dark, theme: p.theme })),
];
export default function UserSetup({
    session,
    onUpdated,
}: {
    session: Session;
    onUpdated: (session: Session) => void;
}) {
    const [appearance, setAppearance] = useState<UserPreferences['appearance']>(
        session.preferences?.appearance ?? DEFAULT_USER_PREFERENCES.appearance
    );
    const [startPage, setStartPage] = useState<UserPreferences['startPage']>(
        session.preferences?.startPage ?? DEFAULT_USER_PREFERENCES.startPage
    );
    const [busy, setBusy] = useState(false);
    const [info, setInfo] = useState('');
    const [error, setError] = useState('');

    const save = async () => {
        setBusy(true);
        setInfo('');
        setError('');
        try {
            const res = await callBackend<{ preferences: UserPreferences }>('/api/profile/preferences', {
                appearance,
                startPage,
            });
            onUpdated({ ...session, preferences: res.preferences });
            setInfo('Your personal setup has been saved.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save your setup.');
        } finally {
            setBusy(false);
        }
    };

    const changed = appearance !== (session.preferences?.appearance ?? 'organization')
        || startPage !== (session.preferences?.startPage ?? 'home');

    return (
        <div className='space-y-4'>
            <PageTitle title='My setup' subtitle='Personal preferences — only your account is affected' />
            <Card className='space-y-3'>
                <div className='flex items-center gap-2'>
                    <Palette className='h-4 w-4 text-brand' />
                    <h2 className='font-semibold text-white'>Appearance</h2>
                </div>
                <p className='text-sm text-slate-400'>
                    Choose any organizational theme preset, including dark themes. Your organization's primary brand color, logo and corporate settings stay unchanged.
                </p>
                <div className='grid grid-cols-2 gap-2 sm:grid-cols-3' role='radiogroup' aria-label='My personal appearance'>
                    {APPEARANCES.map((option) => (
                        <button
                            type='button'
                            role='radio'
                            aria-checked={appearance === option.value}
                            key={option.value}
                            onClick={() => setAppearance(option.value)}
                            className={`min-h-20 rounded-xl border p-3 text-left text-sm transition-colors ${appearance === option.value ? 'border-brand ring-2 ring-brand/30' : 'border-line'}`}
                        >
                            <span className='mb-2 flex h-8 w-full overflow-hidden rounded-lg border border-line'>
                                <span className='flex-1' style={{ background: option.theme?.page || session.organization?.branding?.theme.page || '#020617' }} />
                                <span className='flex-1' style={{ background: option.theme?.panel || session.organization?.branding?.theme.panel || '#0f172a' }} />
                                <span className='flex-1' style={{ background: session.organization?.branding?.theme.brand || '#10b981' }} />
                            </span>
                            <span className='block text-xs font-semibold text-ink'>{option.title}</span>
                            <span className='mt-1 flex items-center gap-1 text-[11px] text-muted'>
                                {appearance === option.value && <CheckCircle2 className='h-3 w-3 text-brand' />}
                                {option.value === 'organization' ? 'Corporate setting' : option.dark ? 'Dark' : 'Light'}
                            </span>
                        </button>
                    ))}
                </div>
            </Card>
            <Card className='space-y-3'>
                <h2 className='font-semibold text-white'>Where to start after login</h2>
                <p className='text-sm text-slate-400'>
                    Deep links you open intentionally will still work. Inaccessible or deleted pages fall back to the homepage.
                </p>
                <div className='space-y-2' role='radiogroup' aria-label='Startup page'>
                    {([
                        { value: 'home' as const, title: 'Organization homepage', description: 'Always open my organization homepage', Icon: Home },
                        { value: 'last' as const, title: 'Last visited page', description: 'Resume my most recently visited organization page', Icon: History },
                    ]).map((option) => (
                        <label key={option.value} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-3 ${startPage === option.value ? 'border-brand bg-brand/10' : 'border-slate-700'}`}>
                            <input type='radio' name='personal-start-page' value={option.value} checked={startPage === option.value} onChange={() => setStartPage(option.value)} className='h-5 w-5 shrink-0 accent-[rgb(var(--c-brand))]' />
                            <option.Icon className='h-5 w-5 shrink-0 text-brand' />
                            <span className='min-w-0 flex-1'>
                                <span className='block text-sm font-medium text-white'>{option.title}</span>
                                <span className='block text-xs text-slate-400'>{option.description}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </Card>
            {error && <Alert tone='error'>{error}</Alert>}
            {info && <Alert tone='success'>{info}</Alert>}
            <Button className='w-full' onClick={save} busy={busy} disabled={!changed || busy}>
                Save my setup
            </Button>
            {!changed && !info && <p className='text-center text-xs text-slate-500'>Your preferences are up to date.</p>}
            <section id='arrange-home' className='space-y-2'><h2 className='text-lg font-semibold text-ink'>Arrange home</h2><p className='text-sm text-muted'>Customize your organization homepage cards, their order, size and visibility.</p><HomeLayoutEditor /></section>
            <button type='button' onClick={() => navigate('organization_home/keep_alive')} className='flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-panel p-4 text-left'>
                <span className='flex items-center gap-2 text-sm font-semibold text-ink'><HeartPulse className='h-4 w-4 text-brand' /> Keep Alive</span>
                <span className='text-xs text-muted'>Screen time and healthy breaks →</span>
            </button>
        </div>
    );
}
