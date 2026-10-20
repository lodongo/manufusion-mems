import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CalendarOff, CheckCircle2, Clock3, HeartPulse, RefreshCw } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Badge, Button, Card, Spinner } from '../admin/kit';
import { appConfirm } from '../components/dialogs';

type HealthLock = { locked: true; kind: 'break' | 'weekly'; until: string; message: string };
type HealthSettings = {
    tracking: boolean;
    breaks: boolean;
    workMinutes: number;
    breakMinutes: number;
    weeklyDay: number;
    weeklyActive: boolean;
    timeZone: string;
};
type HealthOverview = {
    settings: HealthSettings;
    weeklyLockoutEnabled: boolean;
    todaySeconds: number;
    weekSeconds: number;
    workSeconds: number;
    breakCount: number;
    days: Array<{ date: string; seconds: number }>;
    lock: HealthLock | null;
    note: string;
    measuredFrom: string;
};
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FOCUS = [15, 20, 30, 45, 60, 90, 120, 180, 240];
const BREAKS = [1, 2, 3, 5, 7, 10];
const ZONES = [
    'Africa/Nairobi', 'Africa/Kampala', 'Africa/Dar_es_Salaam', 'Africa/Johannesburg',
    'Africa/Lagos', 'Africa/Accra', 'Africa/Cairo', 'Africa/Casablanca', 'UTC',
];
const formatTime = (seconds: number) => {
    const total = Math.max(0, Math.floor(seconds / 60));
    if (total < 60) return total + ' min';
    return Math.floor(total / 60) + ' h ' + String(total % 60).padStart(2, '0') + ' min';
};

export default function UserHealth({ uid }: { uid: string }) {
    const [data, setData] = useState<HealthOverview | null>(null);
    const [draft, setDraft] = useState<HealthSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');

    const load = async () => {
        setError('');
        try {
            const result = await callBackend<HealthOverview>('/api/profile/health/status');
            setData(result);
            setDraft(result.settings);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not read screen-time information.');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { void load(); }, []);
    const userZone = useMemo(() => {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; }
    }, []);
    const zones = Array.from(new Set([...ZONES, ...(userZone ? [userZone] : []), ...(draft?.timeZone ? [draft.timeZone] : [])]));
    const currentDay = (zone: string): number => {
        const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(new Date());
        return DAYS.indexOf(name);
    };

    const save = async () => {
        if (!draft || !data) return;
        if (draft.breaks && !draft.tracking) return setError('Enable screen-time tracking before requiring timed breaks.');
        if (data.weeklyLockoutEnabled && draft.weeklyActive && draft.weeklyDay !== -1 && (
            draft.weeklyDay !== data.settings.weeklyDay
            || draft.timeZone !== data.settings.timeZone
            || !data.settings.weeklyActive
        )) {
            const today = draft.weeklyDay === currentDay(draft.timeZone);
            const message = today
                ? 'Today is the chosen weekly rest day. Saving will immediately sign you out of MEMS until local midnight. Continue?'
                : 'MEMS will prevent access for the entire selected weekday, including organization administrators. Confirm your operational coverage before continuing.';
            if (!(await appConfirm(message))) return;
        }
        setSaving(true);
        setInfo('');
        setError('');
        try {
            const result = await callBackend<HealthOverview>('/api/profile/health/settings', { settings: draft });
            setData(result);
            setDraft(result.settings);
            setInfo('Health preferences saved to your user account.');
            if (result.lock) {
                window.dispatchEvent(new CustomEvent('mems-health-lock', { detail: { ...result.lock, uid } }));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save your health setup.');
        } finally {
            setSaving(false);
        }
    };
    const suggest = () => {
        if (!draft) return;
        setDraft({ ...draft, tracking: true, breaks: true, workMinutes: 60, breakMinutes: 5 });
        setInfo('Suggested routine selected. Choose Save health setup to activate it.');
        setError('');
    };
    const changed = !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(data.settings);
    const maxDay = Math.max(1, ...(data?.days.map((d) => d.seconds) || []));
    return (
        <section aria-label='Health and screen time' className='space-y-4'>
            <div className='flex items-center justify-between gap-2'>
                <div>
                    <h2 className='flex items-center gap-2 text-lg font-semibold text-ink'>
                        <HeartPulse className='h-5 w-5 text-brand' /> Health & screen time
                    </h2>
                    <p className='mt-1 text-xs text-muted'>Personal digital-wellbeing controls for your MEMS account.</p>
                </div>
                <Button variant='secondary' type='button' disabled={loading} onClick={() => { setLoading(true); void load(); }} aria-label='Refresh screen time'>
                    <RefreshCw className='h-4 w-4' />
                </Button>
            </div>
            {loading && !data ? <Spinner /> : error && !data ? <Alert tone='error'>{error}</Alert> : data && draft ? (
                <>
                    <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                        {[
                            { title: 'Today', value: formatTime(data.todaySeconds) },
                            { title: 'Last 7 days', value: formatTime(data.weekSeconds) },
                            { title: 'Current focus', value: formatTime(data.workSeconds) },
                            { title: 'Completed breaks', value: String(data.breakCount) },
                        ].map((stat) => (
                            <div key={stat.title} className='rounded-xl border border-line bg-panel p-3'>
                                <p className='text-lg font-semibold text-ink'>{stat.value}</p>
                                <p className='text-xs text-muted'>{stat.title}</p>
                            </div>
                        ))}
                    </div>
                    <Card className='space-y-3'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                            <h3 className='flex items-center gap-2 text-sm font-semibold text-ink'>
                                <Activity className='h-4 w-4 text-brand' /> Active time
                            </h3>
                            <Badge tone={draft.tracking ? 'brand' : 'muted'}>{draft.tracking ? 'Tracking on' : 'Tracking off'}</Badge>
                        </div>
                        <div className='flex h-28 items-end justify-between gap-2' aria-label='Active MEMS usage by day'>
                            {data.days.map((entry) => (
                                <div key={entry.date} className='flex min-w-0 flex-1 flex-col items-center gap-1'>
                                    <span className='text-[11px] text-muted'>{Math.floor(entry.seconds / 60)}m</span>
                                    <div className='flex h-20 w-full items-end rounded bg-page'>
                                        <div
                                            className='w-full rounded-t bg-brand/80'
                                            style={{ height: (entry.seconds ? Math.max(3, Math.round((entry.seconds / maxDay) * 100)) : 0) + '%' }}
                                            title={entry.date + ': ' + formatTime(entry.seconds)}
                                        />
                                    </div>
                                    <span className='truncate text-[11px] text-muted'>{entry.date.slice(5)}</span>
                                </div>
                            ))}
                        </div>
                        <p className='text-xs text-muted'>{data.note} Background tabs and periods without recent interaction are excluded.</p>
                        {data.measuredFrom && <p className='text-xs text-muted'>Tracking history starts {new Date(data.measuredFrom).toLocaleDateString()}.</p>}
                    </Card>
                    <Card className='space-y-3'>
                        <h3 className='font-semibold text-ink'>Suggested healthy-work routine</h3>
                        <p className='text-sm text-soft'>Start with a five-minute break after 60 minutes of active MEMS use. Adjust the timings to suit your responsibilities.</p>
                        <Button variant='secondary' type='button' onClick={suggest}>
                            <CheckCircle2 className='h-4 w-4' /> Use suggested 60 / 5-minute routine
                        </Button>
                    </Card>
                    <Card className='space-y-4'>
                        <h3 className='flex items-center gap-2 font-semibold text-ink'>
                            <Clock3 className='h-4 w-4 text-brand' /> Mandatory break setup
                        </h3>
                        <label className='flex items-center gap-3 text-sm text-ink'>
                            <input type='checkbox' checked={draft.tracking}
                                onChange={(e) => setDraft({ ...draft, tracking: e.target.checked, breaks: e.target.checked ? draft.breaks : false })}
                                className='h-5 w-5 accent-[rgb(var(--c-brand))]' />
                            Track active MEMS screen time
                        </label>
                        <label className='flex items-center gap-3 text-sm text-ink'>
                            <input type='checkbox' checked={draft.breaks} disabled={!draft.tracking}
                                onChange={(e) => setDraft({ ...draft, breaks: e.target.checked })}
                                className='h-5 w-5 accent-[rgb(var(--c-brand))]' />
                            Require a timed break after my selected focus period
                        </label>
                        <div className='grid grid-cols-2 gap-3'>
                            <label className='block text-xs font-medium text-muted'>
                                Active time before a break
                                <select value={draft.workMinutes} disabled={!draft.breaks}
                                    onChange={(e) => setDraft({ ...draft, workMinutes: Number(e.target.value) })}
                                    className='mt-1 min-h-11 w-full rounded-xl border border-line bg-page px-3 text-sm text-ink'>
                                    {FOCUS.map((v) => <option key={v} value={v}>{v} minutes</option>)}
                                </select>
                            </label>
                            <label className='block text-xs font-medium text-muted'>
                                Mandatory break duration
                                <select value={draft.breakMinutes} disabled={!draft.breaks}
                                    onChange={(e) => setDraft({ ...draft, breakMinutes: Number(e.target.value) })}
                                    className='mt-1 min-h-11 w-full rounded-xl border border-line bg-page px-3 text-sm text-ink'>
                                    {BREAKS.map((v) => <option key={v} value={v}>{v} {v === 1 ? 'minute' : 'minutes'}</option>)}
                                </select>
                            </label>
                        </div>
                        <p className='text-xs text-muted'>
                            With mandatory breaks enabled, MEMS signs you out when the focus limit is reached and denies access until the break ends. The maximum break is 10 minutes.
                        </p>
                    </Card>
                    <Card className='space-y-3'>
                        <h3 className='flex items-center gap-2 font-semibold text-ink'>
                            <CalendarOff className='h-4 w-4 text-brand' /> Weekly Off · Full-day rest
                        </h3>
                        {!data.weeklyLockoutEnabled && (
                            <Alert tone='info'>
                                Weekly full-day lockouts are temporarily disabled for everyone. Your saved rest-day preference is retained but will not restrict your login.
                            </Alert>
                        )}
                        {data.weeklyLockoutEnabled && (
                            <label className='flex items-center gap-3 text-sm text-ink'>
                                <input type='checkbox' checked={draft.weeklyActive}
                                    disabled={draft.weeklyDay === -1}
                                    onChange={(e) => setDraft({ ...draft, weeklyActive: e.target.checked })}
                                    className='h-5 w-5 accent-[rgb(var(--c-brand))]' />
                                Enable my Weekly Off lockout
                            </label>
                        )}
                        {data.weeklyLockoutEnabled && !data.settings.weeklyActive && data.settings.weeklyDay !== -1 && (
                            <Alert tone='info'>
                                Your previously selected rest day is saved but inactive. Tick Enable my Weekly Off lockout and save to reactivate it. Until then, you can log in normally.
                            </Alert>
                        )}
                        <label className='block text-xs font-medium text-muted'>
                            My weekly rest day
                            <select value={draft.weeklyDay}
                                disabled={!data.weeklyLockoutEnabled}
                                onChange={(e) => {
                                    const day = Number(e.target.value);
                                    setDraft({ ...draft, weeklyDay: day, weeklyActive: day !== -1 });
                                }}
                                className='mt-1 min-h-11 w-full rounded-xl border border-line bg-page px-3 text-sm text-ink'>
                                <option value={-1}>Off — no scheduled weekly lockout</option>
                                {DAYS.map((day, index) => <option key={day} value={index}>{day} — full 24-hour rest day</option>)}
                            </select>
                        </label>
                        <label className='block text-xs font-medium text-muted'>
                            Time zone for tracking and lockout
                            <select value={draft.timeZone}
                                onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })}
                                className='mt-1 min-h-11 w-full rounded-xl border border-line bg-page px-3 text-sm text-ink'>
                                {zones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}
                            </select>
                        </label>
                        {data.weeklyLockoutEnabled && draft.weeklyActive && draft.weeklyDay !== -1 && (
                            <Alert tone='warn'>
                                <span className='inline-flex items-start gap-2'>
                                    <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
                                    The entire {DAYS[draft.weeklyDay]} is blocked, from local midnight to the following midnight, including for organization administrators. Arrange cover for urgent work before enabling it.
                                </span>
                            </Alert>
                        )}
                        <p className='text-xs text-muted'>
                            {data.weeklyLockoutEnabled
                                ? 'Weekly Off is per account and works independently of screen-time tracking. It only applies after you explicitly enable and save it.'
                                : 'Full-day lockouts are on hold. Short breaks and screen-time tracking remain available.'}
                        </p>
                    </Card>
                    {error && <Alert tone='error'>{error}</Alert>}
                    {info && <Alert tone='info'>{info}</Alert>}
                    <Button type='button' busy={saving} disabled={!changed || saving} onClick={() => { void save(); }} className='w-full'>
                        Save health setup
                    </Button>
                </>
            ) : null}
        </section>
    );
}
