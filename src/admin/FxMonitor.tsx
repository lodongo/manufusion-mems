import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownUp, RefreshCw, Save } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { observedPairRate, formatFxRate } from './fxPair';
import { Alert, Field, SelectField } from '../components/ui';
import { Badge, Button, Card, PageTitle, Spinner, useLoad } from './kit';

interface History { capturedAt: string; observedAt: string; provider: string; usdKes: number | null; kesUsd: number | null; rates?: Record<string, number> }
interface Provider { id: string; label: string; apiKeyRequired: boolean; cadence: string; notes: string }
interface Config { provider: string; enabled: boolean; frequency: string; timeUtc: string; weekday: number }
interface FxData {
    settings: Config; providers: Provider[];
    rates: { usdKes: number | null; kesUsd: number | null; providerObservedAt: string; source: string };
    currencies: Array<{ code:string;name:string;unitsPerUsd:number|null;usdPerUnit:number|null;rateSource:string;rateObservedAt:string }>;
    coverage: { matched?:number;total?:number;unsupported?:number;unavailableCodes?:string[] } | null;
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

function MiniTrend({ points, base, quote }: { points: History[]; base: string; quote: string }) {
    const series = points.map((point) => ({
        time: point.observedAt || point.capturedAt,
        rate: observedPairRate(point, base, quote),
    })).filter((p): p is { time: string; rate: number } => p.rate !== null && Number.isFinite(p.rate));
    // Plot real observations only. Identical source publication timestamps are not distinct
    // intraday market observations even if repeated manual polls were recorded.
    const unique = Array.from(new Map(series.map((p) => [p.time, p])).values()).slice(-200);
    if (unique.length < 2) return <div className='rounded-xl border border-line bg-panel p-5 text-center text-sm text-soft'>
        No change history available for {base}/{quote} in this period. We only plot real provider observations.
    </div>;
    const values = unique.map((p) => p.rate);
    const low = Math.min(...values), high = Math.max(...values), span = high - low || Math.max(1e-12, high * 0.001);
    const path = values.map((v, i) => `${i ? 'L' : 'M'} ${20 + (i / (values.length - 1)) * 560} ${160 - ((v - low) / span) * 130}`).join(' ');
    const delta = values[values.length - 1] - values[0];
    return <div className='rounded-xl border border-line bg-panel p-3'>
        <svg viewBox='0 0 600 195' className='w-full text-brand' role='img' aria-label={`${base} to ${quote} historical exchange rate chart`}>
            <path d='M20 160 H580' fill='none' stroke='currentColor' strokeOpacity='.2' />
            <path d={path} stroke='currentColor' fill='none' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' />
            <circle cx='580' cy={160 - ((values[values.length - 1] - low) / span) * 130} r='5' fill='currentColor' />
            <text x='22' y='20' fill='currentColor' fontSize='13'>{formatFxRate(high)} {quote}</text>
            <text x='22' y='185' fill='currentColor' fontSize='13'>{formatFxRate(low)} {quote}</text>
        </svg>
        <p className='text-center text-sm text-soft'>Change: {delta >= 0 ? '+' : ''}{formatFxRate(delta)} {quote} per {base} · {unique.length} distinct source observations</p>
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
    const [base, setBase] = useState('USD');
    const [quote, setQuote] = useState('KES');
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
    const first = data?.currencies.find((c)=>c.code===base);
    const second = data?.currencies.find((c)=>c.code===quote);
    const currentRate = first?.unitsPerUsd && second?.unitsPerUsd ? second.unitsPerUsd / first.unitsPerUsd : null;
    const reverseRate = currentRate && currentRate > 0 ? 1/currentRate : null;
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
        <PageTitle title='World exchange rates & automation' subtitle='All uploaded currencies · USD base · source-verified history' />
        <Card className='space-y-3'>
            <h2 className='font-semibold text-ink'>Loaded currency catalogue</h2>
            <div className='grid grid-cols-2 gap-2'>
                <div className='rounded-xl border border-line p-3'><p className='text-xs text-soft'>Uploaded currencies</p><p className='text-xl font-bold text-ink'>{data.currencies.length}</p></div>
                <div className='rounded-xl border border-line p-3'><p className='text-xs text-soft'>Provider coverage</p><p className='text-xl font-bold text-ink'>{data.coverage?.matched ?? '—'}</p></div>
            </div>
            <div className='grid grid-cols-[1fr_auto_1fr] items-end gap-2'>
                <SelectField label='From' id='fx-base' value={base} onChange={(e)=>setBase(e.target.value)}>
                    {data.currencies.map((c)=><option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                </SelectField>
                <button type='button' aria-label='Swap currency direction' title='Swap currencies' onClick={()=>{setBase(quote);setQuote(base);}}
                    className='mb-0 flex h-12 w-12 items-center justify-center rounded-xl border border-brand bg-brand/10 text-brand active:bg-brand/20'>
                    <ArrowDownUp className='h-5 w-5'/>
                </button>
                <SelectField label='To' id='fx-quote' value={quote} onChange={(e)=>setQuote(e.target.value)}>
                    {data.currencies.map((c)=><option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                </SelectField>
            </div>
            <div className='grid grid-cols-2 gap-3'>
                <div className='rounded-xl border border-line bg-panel p-3'>
                    <p className='text-xs text-soft'>1 {base} equals</p>
                    <p className='mt-1 break-words text-xl font-bold text-ink'>{formatFxRate(currentRate)} <span className='text-xs'>{quote}</span></p>
                </div>
                <div className='rounded-xl border border-line bg-panel p-3'>
                    <p className='text-xs text-soft'>1 {quote} equals</p>
                    <p className='mt-1 break-words text-xl font-bold text-ink'>{formatFxRate(reverseRate)} <span className='text-xs'>{base}</span></p>
                </div>
            </div>
            <p className='text-xs text-soft'>Source: {first?.rateSource || second?.rateSource || data.rates.source || 'Not refreshed'} · Published:
                {first?.rateObservedAt ? ' '+new Date(first.rateObservedAt).toLocaleString() : second?.rateObservedAt ? ' '+new Date(second.rateObservedAt).toLocaleString() : ' Unconfirmed'}
            </p>
            {first?.rateObservedAt && second?.rateObservedAt && first.rateObservedAt !== second.rateObservedAt &&
                <Alert tone='warn'>These currencies have differing rate timestamps. The displayed cross-rate is indicative only; refresh a common provider snapshot before making financial decisions.</Alert>}
            {data.coverage && <p className='text-sm font-semibold text-ink'>Last refresh: {data.coverage?.matched ?? 0} of {data.coverage?.total ?? data.currencies.length} uploaded currencies matched the provider.</p>}
            {(data.coverage?.unsupported ?? 0)>0 && <Alert tone='warn'>{data.coverage?.unsupported} uploaded currencies were not supplied by this provider. Existing recorded rates were preserved. {data.coverage?.unavailableCodes?.length ? `Codes: ${data.coverage?.unavailableCodes.join(', ')}` : ''}</Alert>}
            <p className='text-xs text-soft'>Reference rates inform conversions; they do not alter already-posted transactions or replace bank execution rates.</p>
        </Card>
        <Card className='space-y-3'>
            <div className='flex items-center gap-2'><Activity className='h-5 w-5 text-brand'/><h2 className='font-semibold text-ink'>{base}/{quote} exchange-rate trends</h2></div>
            <div className='flex gap-2 overflow-x-auto pb-2'>
                {WINDOWS.map(([key,title])=><button type='button' key={key} onClick={()=>setWindowKey(key)}
                    className={`shrink-0 rounded-lg border px-3 py-2 text-xs ${windowKey===key?'border-brand bg-brand text-onbrand':'border-line bg-panel text-ink'}`}>{title}</button>)}
            </div>
            <MiniTrend points={filtered} base={base} quote={quote} />
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
            <button type='button' onClick={()=>navigate('admin/automation_center')} className='w-full rounded-xl border border-brand bg-brand/10 p-3 text-left text-sm font-semibold text-ink'>
                Open shared Automation Center → Connect one trigger for all future MEMS automations
            </button>
            <Alert tone={data.scheduler.status === 'heartbeat_seen' ? 'success' : 'warn'}>
                {data.scheduler.notes}
                {data.scheduler.lastReceivedAt ? ` Last verified callback: ${new Date(data.scheduler.lastReceivedAt).toLocaleString()}.` : ''}
                {data.scheduler.lastCompletedAt ? ` Last completed refresh: ${new Date(data.scheduler.lastCompletedAt).toLocaleString()}.` : ''}
            </Alert>
            {data.scheduler.lastError && <Alert tone='error'>Last scheduler fault: {data.scheduler.lastError}</Alert>}
            <div className='grid grid-cols-2 gap-2'>
                <Button variant='secondary' busy={!!busy} onClick={()=>execute('/api/admin/fx/config',{provider,frequency,timeUtc,weekday:Number(weekday),enabled},'Provider and schedule preferences saved.')}>
                    <Save className='h-4 w-4' /> Save settings
                </Button>
                <Button busy={!!busy} onClick={()=>execute('/api/admin/fx/refresh',{},'Updated every currency supported by the configured provider; new published values were archived.')}>
                    <RefreshCw className='h-4 w-4'/> Refresh now
                </Button>
            </div>
            {notice && <Alert tone='success'>{notice}</Alert>}
            {fault && <Alert tone='error'>{fault}</Alert>}
        </Card>
        <Card className='space-y-2'>
            <h2 className='font-semibold text-ink'>Recorded {base}/{quote} observations</h2>
            <div className='max-h-72 space-y-2 overflow-y-auto'>
                {filtered.filter((h)=>observedPairRate(h,base,quote)!==null).slice(-40).reverse().map((h,i)=><div key={h.capturedAt+'-'+i} className='flex items-center justify-between gap-2 rounded-lg border border-line p-2 text-xs text-soft'>
                    <div>{new Date(h.capturedAt).toLocaleString()}<span className='block text-muted'>{h.provider}</span></div>
                    <strong className='text-ink'>1 {base} = {formatFxRate(observedPairRate(h,base,quote))} {quote}</strong>
                </div>)}
                {!filtered.some((h)=>observedPairRate(h,base,quote)!==null) && <p className='text-sm text-soft'>No provider observations for this pair in the selected period.</p>}
            </div>
        </Card>
    </div>;
}
