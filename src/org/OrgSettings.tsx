import { useMemo, useState } from 'react';
import { Settings2, ArrowRight } from 'lucide-react';
import { navigate } from '../lib/route';
import { callBackend } from '../lib/backend';
import { fetchReference } from '../lib/reference';
import { Alert, SelectField } from '../components/ui';
import { Button, Card, PageTitle, Spinner, useLoad } from '../admin/kit';

interface Settings {
    dateFormat?: string;
    fiscalYearStart?: string;
    language?: string;
    timezone?: string;
    weekStart?: string;
}

export default function OrgSettings() {
    const settings = useLoad(() => callBackend<{ settings: Settings }>('/api/org/settings/get'));
    const ref = useLoad(() => fetchReference());
    if ((settings.loading && !settings.data) || (ref.loading && !ref.data)) return <Spinner />;
    if (settings.error || !settings.data || !ref.data) return <Alert tone='error'>{settings.error || ref.error || 'Could not load settings.'}</Alert>;
    return <SettingsForm initial={settings.data.settings} refData={ref.data} />;
}

function SettingsForm({ initial, refData }: { initial: Settings; refData: NonNullable<Awaited<ReturnType<typeof fetchReference>>> }) {
    const meta = (key: string) => refData.metadataLists.find((l) => l.key === key)?.items ?? [];
    const timezones = useMemo(() => Array.from(new Set(refData.countries.map((c) => c.timezone).filter(Boolean))).sort(), [refData]);
    const [f, setF] = useState<Settings>({
        dateFormat: initial.dateFormat ?? meta('dateFormats')[0]?.code ?? '',
        fiscalYearStart: initial.fiscalYearStart ?? meta('fiscalYearStart')[0]?.code ?? '',
        language: initial.language ?? meta('languages')[0]?.code ?? '',
        timezone: initial.timezone ?? 'Africa/Nairobi',
        weekStart: initial.weekStart ?? 'monday',
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');

    const save = async () => {
        setBusy(true);
        setError('');
        setInfo('');
        try {
            await callBackend('/api/org/settings/save', { settings: f });
            setInfo('Settings saved.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
        } finally {
            setBusy(false);
        }
    };

    const select = (key: keyof Settings, label: string, options: Array<{ code: string; label: string }>) => (
        <SelectField id={`os-${key}`} label={label} value={f[key] ?? ''} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
            {options.map((o) => (
                <option key={o.code} value={o.code}>
                    {o.label}
                </option>
            ))}
        </SelectField>
    );

    return (
        <div className='space-y-4'>
            <PageTitle title='Settings' subtitle='Regional, calendar and personal workspace settings' />
            <button type='button' onClick={()=>navigate('organization_home/my_setup')} className='flex min-h-16 w-full items-center gap-3 rounded-xl border border-line bg-panel px-4 text-left'><Settings2 className='h-5 w-5 text-brand'/><span className='min-w-0 flex-1'><span className='block text-sm font-semibold text-ink'>Arrange home</span><span className='block text-xs text-muted'>Open personal Settings to customize the homepage layout</span></span><ArrowRight className='h-4 w-4 text-brand'/></button>
            <Card className='space-y-4'>
                {select('timezone', 'Time zone', timezones.map((t) => ({ code: t, label: t.replace('_', ' ') })))}
                {select('dateFormat', 'Date format', meta('dateFormats'))}
                {select('language', 'Default language', meta('languages'))}
            </Card>
            <Card className='space-y-4'>
                {select('fiscalYearStart', 'Financial year starts in', meta('fiscalYearStart'))}
                {select('weekStart', 'First day of the week', [
                    { code: 'monday', label: 'Monday' },
                    { code: 'sunday', label: 'Sunday' },
                    { code: 'saturday', label: 'Saturday' },
                ])}
            </Card>
            {error && <Alert tone='error'>{error}</Alert>}
            {info && <Alert tone='info'>{info}</Alert>}
            <Button className='w-full' busy={busy} onClick={save}>
                Save settings
            </Button>
        </div>
    );
}
