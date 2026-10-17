import { useState } from 'react';
import { Activity, CalendarClock, CheckCircle2, AlertTriangle, RefreshCw, Play } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { Button, Card, PageTitle, Spinner, useLoad } from './kit';

type Run = { id: string; jobId: string; mode: string; status: string; startedAt: string; completedAt: string; provider: string; matched?: number; changed?: number; missing?: number; error?: string };
type Job = { id: string; label: string; category: string; enabled: boolean; schedule: { frequency: string; timeUtc: string; provider: string };
    lastStartedAt: string; lastCompletedAt: string; lastError: string; lastErrorAt: string; lastResult: unknown };
type Engine = {
    engine: { name: string; version: string; registered: string[]; tickMinutes: number;
        lastHeartbeat: string; connected: boolean;
        sharedTrigger: { provisioned: boolean; reason?: string; state?: string; schedule?: string; job: string; lastAttemptTime?: string } };
    jobs: Job[]; history: Run[];
};
const pretty = (stamp?: string) => stamp && Number.isFinite(Date.parse(stamp)) ? new Date(stamp).toLocaleString() : 'Not yet';
export default function AutomationCenter() {
    const { data, error, loading, reload } = useLoad(() => callBackend<Engine>('/api/admin/automations/status'));
    const [busy, setBusy] = useState(false);
    const [fault, setFault] = useState('');
    const [notice, setNotice] = useState('');
    const activate = async () => {
        if (window.prompt('To activate the shared MEMS automation scheduler, type ACTIVATE AUTOMATIONS') !== 'ACTIVATE AUTOMATIONS') return;
        setBusy(true); setFault(''); setNotice('');
        try {
            const result = await callBackend<{message:string}>('/api/admin/automations/activate', { confirm: 'ACTIVATE AUTOMATIONS' });
            setNotice(result.message); reload();
        } catch (e) { setFault(e instanceof Error ? e.message : 'Could not activate scheduler.'); }
        finally { setBusy(false); }
    };
    if (loading && !data) return <Spinner/>;
    if (error || !data) return <Alert tone='error'>{error || 'Cannot load automation service.'}</Alert>;
    const trigger = data.engine.sharedTrigger;
    const operational = trigger.provisioned && trigger.state === 'ENABLED' && data.engine.connected;
    const ok = data.history.filter((r)=>r.status==='success').length;
    const errors = data.history.filter((r)=>r.status==='failed').length;
    const scheduledExecutions = data.history.filter((r)=>r.mode==='scheduled').length;
    const manualExecutions = data.history.filter((r)=>r.mode==='manual').length;
    return <div className='space-y-4'>
        <PageTitle title='MEMS Automation Center' subtitle='One secure execution engine for finance and future platform automations' />
        <div className='grid grid-cols-2 gap-3'>
            <Card className='space-y-1'>
                <p className='text-xs text-soft'>Registered automations</p><p className='text-2xl font-bold text-ink'>{data.engine.registered.length}</p>
                <p className='text-xs text-soft'>{data.jobs.filter((j)=>j.enabled).length} enabled</p>
            </Card>
            <Card className='space-y-1'>
                <p className='text-xs text-soft'>Recent executions</p><p className='text-2xl font-bold text-ink'>{ok} / {data.history.length}</p>
                <p className='text-xs text-soft'>{scheduledExecutions} scheduled · {manualExecutions} manual · {errors} failed</p>
            </Card>
        </div>
        <Card className='space-y-3'>
            <div className='flex items-start justify-between gap-2'>
                <div className='flex items-center gap-2'><CalendarClock className='h-5 w-5 text-brand'/><h2 className='font-semibold text-ink'>Shared scheduler</h2></div>
                {operational ? <CheckCircle2 className='h-6 w-6 text-emerald-600'/> : <AlertTriangle className='h-6 w-6 text-amber-700'/>}
            </div>
            <p className='text-sm text-ink'>{operational ? 'Connected, enabled and receiving authenticated callbacks.' :
                trigger.provisioned ? 'Cloud Scheduler job exists; waiting for a recent verified heartbeat.' : 'Cloud Scheduler trigger not yet verified.'}</p>
            {!trigger.provisioned && <p className='text-sm text-soft'>{trigger.reason || 'Activate the single shared trigger.'}</p>}
            <div className='grid grid-cols-2 gap-2 text-xs text-soft'>
                <div className='rounded-lg border border-line p-3'>Trigger interval <strong className='block text-ink'>{data.engine.tickMinutes} minutes</strong></div>
                <div className='rounded-lg border border-line p-3'>State <strong className='block text-ink'>{trigger.state || 'Not configured'}</strong></div>
            </div>
            <p className='text-xs text-soft'>Scheduler location: me-central1 (Doha). Cloud Run remains in africa-south1 (Johannesburg).</p>
            <p className='text-xs text-soft'>Last OIDC-verified scheduler callback: {pretty(data.engine.lastHeartbeat)}</p>
            <Button className='w-full' onClick={activate} busy={busy}><Play className='h-4 w-4'/> {trigger.provisioned ? 'Verify or repair scheduler' : 'Activate shared scheduler'}</Button>
            <Button className='w-full' variant='secondary' onClick={reload}><RefreshCw className='h-4 w-4'/> Check connection</Button>
            {fault && <Alert tone='error'>{fault}</Alert>}
            {!operational && <div className='space-y-2 rounded-xl border border-line bg-panel p-3'>
                <p className='font-semibold text-ink'>One-time Google Cloud connection</p>
                <p className='text-sm text-soft'>The application cannot grant itself Google Cloud permissions. An authorized project administrator must complete these development-only steps once.</p>
                <ol className='list-inside list-decimal space-y-1 text-sm text-ink'>
                    <li>Enable the Cloud Scheduler API.</li>
                    <li>Ensure the dedicated caller identity <code className='break-all text-xs'>mems-fx-scheduler@manufusion-mems-development.iam.gserviceaccount.com</code> exists.</li>
                    <li>Temporarily grant <code>roles/cloudscheduler.admin</code> to the development runtime service account.</li>
                    <li>Grant <code>roles/iam.serviceAccountUser</code> on the dedicated caller identity to the runtime service account.</li>
                    <li>Return here and activate the shared scheduler. Remove Cloud Scheduler Admin after provisioning.</li>
                </ol>
                <div className='grid grid-cols-2 gap-2'>
                    <a href='https://console.cloud.google.com/apis/library/cloudscheduler.googleapis.com?project=manufusion-mems-development'
                        target='_blank' rel='noopener noreferrer'
                        className='flex min-h-12 items-center justify-center rounded-xl border border-brand px-2 py-2 text-center text-xs font-semibold text-ink'>Enable API</a>
                    <a href='https://console.cloud.google.com/iam-admin/iam?project=manufusion-mems-development'
                        target='_blank' rel='noopener noreferrer'
                        className='flex min-h-12 items-center justify-center rounded-xl border border-brand px-2 py-2 text-center text-xs font-semibold text-ink'>Project IAM</a>
                    <a href='https://console.cloud.google.com/iam-admin/serviceaccounts?project=manufusion-mems-development'
                        target='_blank' rel='noopener noreferrer'
                        className='flex min-h-12 items-center justify-center rounded-xl border border-line px-2 py-2 text-center text-xs font-semibold text-ink'>Service accounts</a>
                    <a href='https://console.cloud.google.com/cloudscheduler?project=manufusion-mems-development'
                        target='_blank' rel='noopener noreferrer'
                        className='flex min-h-12 items-center justify-center rounded-xl border border-line px-2 py-2 text-center text-xs font-semibold text-ink'>Scheduler jobs</a>
                </div>
            </div>}
            {notice && <Alert tone='success'>{notice}</Alert>}
            <p className='text-xs text-soft'>One-time setup requires Cloud Scheduler API, Cloud Scheduler job permissions for the MEMS runtime identity, and Service Account User permission on the dedicated automation caller identity. Once connected, new MEMS automation types reuse this trigger.</p>
        </Card>
        <Card className='space-y-3'>
            <h2 className='flex items-center gap-2 font-semibold text-ink'><Activity className='h-5 w-5 text-brand'/> Registered jobs</h2>
            {data.jobs.map((j)=><div className='space-y-2 rounded-xl border border-line p-3' key={j.id}>
                <div className='flex items-center justify-between gap-2'>
                    <div><p className='font-semibold text-ink'>{j.label}</p><p className='text-xs text-soft'>{j.id}</p></div>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${j.enabled?'bg-emerald-100 text-emerald-950':'bg-slate-200 text-slate-800'}`}>{j.enabled?'Enabled':'Disabled'}</span>
                </div>
                <p className='text-xs text-soft'>Frequency: {j.schedule.frequency} · Provider: {j.schedule.provider} · UTC: {j.schedule.timeUtc}</p>
                <p className='text-xs text-soft'>Last successful run: {pretty(j.lastCompletedAt)}</p>
                {j.lastError && <Alert tone='error'>{j.lastError} ({pretty(j.lastErrorAt)})</Alert>}
                <Button variant='secondary' onClick={()=>navigate('admin/fx_monitor')}>Configure exchange rates</Button>
            </div>)}
        </Card>
        <Card className='space-y-3'>
            <h2 className='font-semibold text-ink'>Execution history and faults</h2>
            {data.history.length === 0 && <p className='text-sm text-soft'>No automated or manual runs have been recorded yet.</p>}
            {data.history.slice(0,40).map((r)=><div key={r.id} className='rounded-xl border border-line p-3'>
                <div className='flex justify-between gap-2'><p className='text-sm font-semibold text-ink'>{r.jobId}</p>
                    <span className={`text-xs font-bold ${r.status==='success'?'text-emerald-700':'text-red-700'}`}>{r.status}</span></div>
                <p className='mt-1 text-xs text-soft'>{pretty(r.startedAt)} · {r.mode} · {r.provider}</p>
                {r.status==='success' ? <p className='text-xs text-soft'>{r.matched} currencies matched, {r.changed} changed, {r.missing} unmatched</p> :
                    <p className='mt-1 text-sm text-red-800'>{r.error || 'Execution failed'}</p>}
            </div>)}
        </Card>
    </div>;
}
