import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownUp, RefreshCw, Save } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import { Badge, Button, Card, PageTitle, Spinner, useLoad } from './kit';

interface History { capturedAt: string; observedAt: string; provider: string; usdKes: number; kesUsd: number }
interface Provider { id: string; label: string; apiKeyRequired: boolean; cadence: string; notes: string }
interface Config { provider: string; enabled: boolean; frequency: string; timeUtc: string; weekday: number }
interface FxData {
    settings: Config; providers: Provider[];
    rates: { usdKes: number | null; kesUsd: number | null; providerObservedAt: string; source: string };
    history: History[]; scheduler: { status: string; notes: string; lastReceivedAt?: string; lastCompletedAt?: string; lastError?: string };
}
type Window = 'hour' | 'today' | '24h' | 'month' | '30d' | 'year' | 'lastYear';
const WINDOWS: Array<[Window, string]> = [['hour','This hour'],['today','Today'],['24h','Last 24 hours'],['month','This month'],['30d','Last 30 days'],['year','This year'],['lastYear','Last 1 year']];
function after(range: Window): number {
    const date = new Date();
    const ms = date.getTime();
    if (range === 'hour') return ms - 3600000;
    if (range === '24h') return ms - 86400000;
    if (range === '30d') return ms - 30 * 86400000;
    if (range === 'lastYear') return ms - 365 * 86400000;
    if (range === 'today') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    if (range === 'month') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    return Date.UTC(date.getUTCFullYear(), 0, 1);
}

function MiniTrend({ points }: { points: History[] }) {
    const series = points.filter((p) => Number.isFinite(p.usdKes)).slice(-200);
    if (series.length < 2) return <div className='rounded-xl border border-line bg-panel p-5 text-center text-sm text-soft'>No meaningful trend yet. Refresh rates over time to build a historical series.</div>;
    const values = series.map((p) => p.usdKes);
    const low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
    const path = values.map((v, i) => `${i ? 'L' : 'M'} ${20 + (i / (values.length - 1)) * 560} ${160 - ((v - low) / span) * 130}`).join(' ');
    const delta = values[values.length - 1] - values[0];
    return <div className='rounded-xl border border-line bg-panel p-3'>
        <svg viewBox='0 0 600 195' className='w-full text-brand' role='img' aria-label='USD to KES history line graph'>
            <path d='M20 160 H580' fill='none' stroke='currentColor' strokeOpacity='.2' />
            <path d={path} stroke='currentColor' fill='none' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' />
            <circle cx='580' cy={160 - ((values[values.length - 1] - low) / span) * 130} r='5' fill='currentColor' />
            <text x='22' y='20' fill='currentColor' fontSize='13'>{high.toFixed(3)} KES</text>
            <text x='22' y='185' fill='currentColor' fontSize='13'>{low.toFixed(3)} KES</text>
        </svg>
        <p className='text-center text-sm text-soft'>Change within available observations: {delta >= 0 ? '+' : ''}{delta.toFixed(4)} KES per USD · {series.length} snapshots</p>
    </div>;
}

export default function FxMonitor() {
    const { data, error, loading, reload } = useLoad(() => callBackend<FxData>('/api/admin/fx/status'));
    const [provider, setProvider] = useState('open_er_api');
    const [frequency, setFrequency] = useState('daily');
    const [timeUtc, setTimeUtc] = useState('06:00');
    const [weekday, setWeekday] = useState('1');
    const [enabled, setEnabled] = useState(false);
    const [windowKey, setWindowKey] = useState<Window>('30d');
    const [busy, setBusy] = useState('');
    const [notice, setNotice] = useState('');
    const [fault, setFault] = useState('');
    useEffect(() => {
        if (!data) return;
        setProvider(data.settings.provider);
        setFrequency(data.settings.frequency);
        setTimeUtc(data.settings.timeUtc);
        setWeekday(String(data.settings.weekday));
        setEnabled(data.settings.enabled);
    }, [data?.settings]);
    const filtered = useMemo(() =>
        (data?.history ?? []).filter((p) => Date.parse(p.capturedAt) >= after(windowKey)).sort((a,b) => a.capturedAt.localeCompare(b.capturedAt)),
        [data?.history, windowKey]
    );

    const execute = async (path: string, body: Record<string, unknown>, message: string) => {
        setBusy(path); setFault(''); setNotice('');
        try { await callBackend(path, body); setNotice(message); reload(); }
        catch (e) { setFault(e instanceof Error ? e.message : 'Operation failed.'); }
        finally { setBusy(''); }
    };
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load exchange-rate data.'}</Alert>;
    return <div className='space-y-4'>
        <PageTitle title='FX monitoring & automation' subtitle='USD base, KES settlement rate · published observations and preserved history' />
        <div className='grid grid-cols-2 gap-3'>
            <Card className='space-y-1'>
                <p className='text-xs text-soft'>1 USD equals</p>
                <p className='text-xl font-bold text-ink'>{data.rates.usdKes?.toFixed(4) ?? 'Unavailable'} <span className='text-xs'>KES</span></p>
            </Card>
            <Card className='space-y-1'>
                <p className='text-xs text-soft'>1 KES equals</p>
                <p className='text-xl font-bold text-ink'>{data.rates.kesUsd?.toFixed(6) ?? 'Unavailable'} <span className='text-xs'>USD</span></p>
            </Card>
        </div>
        <Card className='space-y-2 text-xs text-soft'>
            <p>Source: <strong className='text-ink'>{data.rates.source || 'Not yet refreshed'}</strong></p>
            <p>Provider's published rate: {data.rates.providerObservedAt ? new Date(data.rates.providerObservedAt).toLocaleString() : 'Unknown'}</p>
            <p>Last fetched snapshots available: {data.history.length}. These are observations, not guaranteed live market ticks.</p>
        </Card>
        <Card className='space-y-3'>
            <div className='flex items-center gap-2'><Activity className='h-5 w-5 text-brand'/><h2 className='font-semibold text-ink'>USD/KES exchange-rate trends</h2></div>
            <div className='flex gap-2 overflow-x-auto pb-2'>
                {WINDOWS.map(([key,title])=><button type='button' key={key} onClick={()=>setWindowKey(key)}
                    className={`shrink-0 rounded-lg border px-3 py-2 text-xs ${windowKey===key?'border-brand bg-brand text-onbrand':'border-line bg-panel text-ink'}`}>{title}</button>)}
            </div>
            <MiniTrend points={filtered} />
            <p className='text-xs text-soft'>Hourly and daily periods only show changes when the selected provider publishes new values. Empty periods are not estimated.</p>
        </Card>
        <Card className='space-y-4'>
            <div className='flex items-center gap-2'><ArrowDownUp className='h-5 w-5 text-brand'/><h2 className='font-semibold text-ink'>Provider & schedule settings</h2></div>
            <SelectField id='fx-provider' label='Exchange-rate provider' value={provider} onChange={(e)=>setProvider(e.target.value)}>
                {data.providers.map((p)=><option key={p.id} value={p.id}>{p.label} · {p.cadence}{p.apiKeyRequired?' · key required':''}</option>)}
            </SelectField>
            <p className='text-xs text-soft'>{data.providers.find((p)=>p.id===provider)?.notes}</p>
            <SelectField id='fx-frequency' label='Requested automatic refresh frequency' value={frequency} onChange={(e)=>setFrequency(e.target.value)}>
                <option value='hourly'>Hourly</option><option value='three_hourly'>Every 3 hours</option><option value='six_hourly'>Every 6 hours</option><option value='daily'>Daily</option><option value='weekly'>Weekly</option>
            </SelectField>
            <Field id='fx-time' label='Run time (UTC, 24-hour HH:MM)' value={timeUtc} placeholder='06:00' onChange={(e)=>setTimeUtc(e.target.value)} maxLength={5} />
            {frequency === 'weekly' && <SelectField id='fx-weekday' label='Weekday (UTC)' value={weekday} onChange={(e)=>setWeekday(e.target.value)}>
                {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((x,i)=><option key={x} value={String(i)}>{x}</option>)}
            </SelectField>}
            <label className='flex min-h-12 items-center gap-3 rounded-xl border border-line p-3 text-sm text-ink'>
                <input type='checkbox' checked={enabled} onChange={(e)=>setEnabled(e.target.checked)} className='h-5 w-5 accent-brand' />
                Enable scheduled-rate refresh configuration
            </label>
            <Alert tone={data.scheduler.status === 'oidc_schedule_connected' ? 'success' : 'warn'}>
                {data.scheduler.notes}
                {data.scheduler.lastReceivedAt ? ` Last verified callback: ${new Date(data.scheduler.lastReceivedAt).toLocaleString()}.` : ''}
                {data.scheduler.lastCompletedAt ? ` Last completed refresh: ${new Date(data.scheduler.lastCompletedAt).toLocaleString()}.` : ''}
            </Alert>
            {data.scheduler.lastError && <Alert tone='error'>Last scheduler fault: {data.scheduler.lastError}</Alert>}
            <div className='grid grid-cols-2 gap-2'>
                <Button variant='secondary' busy={!!busy} onClick={()=>execute('/api/admin/fx/config',{provider,frequency,timeUtc,weekday:Number(weekday),enabled},'Provider and schedule preferences saved.')}>
                    <Save className='h-4 w-4' /> Save settings
                </Button>
                <Button busy={!!busy} onClick={()=>execute('/api/admin/fx/refresh',{},'Updated KES exchange rate and added a historical snapshot.')}>
                    <RefreshCw className='h-4 w-4'/> Refresh now
                </Button>
            </div>
            {notice && <Alert tone='success'>{notice}</Alert>}
            {fault && <Alert tone='error'>{fault}</Alert>}
        </Card>
        <Card className='space-y-2'>
            <h2 className='font-semibold text-ink'>Rate observations</h2>
            <div className='max-h-72 space-y-2 overflow-y-auto'>
                {filtered.slice(-40).reverse().map((h,i)=><div key={h.capturedAt+'-'+i} className='flex items-center justify-between gap-2 rounded-lg border border-line p-2 text-xs text-soft'>
                    <div>{new Date(h.capturedAt).toLocaleString()}<span className='block text-muted'>{h.provider}</span></div>
                    <strong className='text-ink'>1 USD = {h.usdKes.toFixed(4)} KES</strong>
                </div>)}
                {!filtered.length && <p className='text-sm text-soft'>No snapshots in this period.</p>}
            </div>
        </Card>
    </div>;
}
