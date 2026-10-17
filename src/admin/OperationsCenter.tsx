import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Cloud, ExternalLink, GitBranch, GitCommit, Play, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Badge, Button, Card, PageTitle, Spinner, useLoad } from './kit';

type Result = { ok: boolean; data?: unknown; message?: string };
type RecordType = Record<string, unknown>;
interface Ops {
    project: string; serviceName: string; region: string; repository: string; branch: string;
    generatedAt: string; githubConfigured: boolean;
    service: Result; revisions: Result; logs: Result; runs: Result; commits: Result; firebase: Result;
}
const obj = (v: unknown): RecordType => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordType : {};
const entries = (section: Result, field: string): RecordType[] => {
    const x = obj(section.data)[field];
    return Array.isArray(x) ? x.map(obj) : [];
};
const txt = (v: unknown): string => typeof v === 'string' ? v : v == null ? '' : String(v);
const date = (v: unknown): string => {
    const t = Date.parse(txt(v));
    return Number.isFinite(t) ? new Date(t).toLocaleString() : 'Unknown';
};
const link = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

export default function OperationsCenter() {
    const {data,error,loading,reload} = useLoad(() => callBackend<Ops>('/api/admin/ops/overview'));
    const [tab,setTab] = useState<'github'|'cloud'|'firebase'|'faults'>('github');
    const [busy,setBusy] = useState('');
    const [notice,setNotice] = useState('');
    const [fault,setFault] = useState('');
    const runs = data ? entries(data.runs,'workflow_runs') : [];
    const revs = data ? entries(data.revisions,'revisions') : [];
    const logs = data ? entries(data.logs,'entries') : [];
    const commits = Array.isArray(data?.commits.data) ? (data?.commits.data as RecordType[]).map(obj) : [];
    const failures = runs.filter((r)=>txt(r.conclusion)==='failure');
    const successes = runs.filter((r)=>txt(r.conclusion)==='success');
    const warnLogs = logs.filter((e)=>['ERROR','CRITICAL','ALERT','EMERGENCY','WARNING'].includes(txt(e.severity)));
    const last = runs[0];
    const trend = useMemo(() => runs.slice(0,25).reverse().map((r)=>({
        id: Number(r.id) || 0, ok: txt(r.conclusion)==='success',
        status: txt(r.status), started: txt(r.created_at),
    })),[data?.runs.data]);

    const runAction = async (path: string, body: RecordType, label: string) => {
        setBusy(path);setFault('');setNotice('');
        try { await callBackend(path, body);setNotice(label);reload(); }
        catch(e){setFault(e instanceof Error?e.message:'Operation failed.');}
        finally{setBusy('');}
    };
    if (loading && !data) return <Spinner/>;
    if (error || !data) return <Alert tone='error'>{error||'Could not load operations dashboard.'}</Alert>;
    const good = (r: Result) => r.ok ? <Badge tone='brand'>Connected</Badge> : <Badge tone='warn'>Action needed</Badge>;
    return <div className='space-y-4'>
        <PageTitle title='Development operations center' subtitle='Super-administrator-only GitHub and Google Cloud Run administration' />
        <Alert tone='warn'>Protected development environment only. GitHub App write actions require explicit delegated permissions. Neither production credentials nor arbitrary cloud write actions are available here.</Alert>
        <div className='grid grid-cols-2 gap-3'>
            <Card className='space-y-1'>
                <p className='text-xs text-soft'>Recent deployments</p>
                <p className='text-2xl font-bold text-ink'>{runs.length}</p>
                <p className='text-xs text-soft'>{successes.length} passed · {failures.length} failed</p>
            </Card>
            <Card className='space-y-1'>
                <p className='text-xs text-soft'>Cloud Run revisions</p>
                <p className='text-2xl font-bold text-ink'>{data.revisions.ok?revs.length:'—'}</p>
                <p className='text-xs text-soft'>{warnLogs.length} warning/error logs available</p>
            </Card>
        </div>
        <div className='flex flex-wrap gap-2'>
            <Button variant='secondary' onClick={reload}><RefreshCw className='h-4 w-4'/> Refresh</Button>
            <Button variant='secondary' onClick={()=>link('https://github.com/lodongo/manufusion-mems/actions/workflows/deploy-development.yml')}><ExternalLink className='h-4 w-4'/> GitHub Actions</Button>
            <Button variant='secondary' onClick={()=>link('https://console.cloud.google.com/run/detail/africa-south1/mems-dev/observability?project=manufusion-mems-development')}><ExternalLink className='h-4 w-4'/> Cloud Run</Button>
        </div>
        <div className='grid grid-cols-4 gap-1.5'>
            {([['github','GitHub'],['cloud','Cloud Run'],['firebase','Firebase'],['faults','Faults']] as const).map(([k,v])=>
                <button key={k} type='button' onClick={()=>setTab(k)} className={`rounded-xl border p-3 text-xs font-semibold ${tab===k?'border-brand bg-brand text-onbrand':'border-line bg-panel text-ink'}`}>{v}</button>
            )}
        </div>
        {tab==='github'&&<div className='space-y-4'>
            <Card className='space-y-3'>
                <div className='flex items-center justify-between gap-2'>
                    <h2 className='flex items-center gap-2 font-semibold text-ink'><GitBranch className='h-5 w-5 text-brand'/> GitHub Actions</h2>{good(data.runs)}
                </div>
                <p className='text-xs text-soft'>Repository: {data.repository} · branch: {data.branch} · latest run: {last?date(last.created_at):'Unavailable'}</p>
                {!data.githubConfigured&&<Alert tone='warn'>A GitHub App has not yet been connected to MEMS Cloud Run. This private repository’s history and in-app deployment controls will be available after installation and secret configuration. Use the authorized GitHub website meanwhile.</Alert>}
                {!data.runs.ok&&<Alert tone='error'>{data.runs.message}</Alert>}
                <div className='flex gap-1 overflow-x-auto rounded-lg border border-line bg-page p-2' role='img' aria-label='Recent workflow success and failure history'>
                    {trend.length?trend.map(x=><span key={x.id} title={`Run #${x.id} — ${x.ok?'Success':x.status}`} className={`h-12 min-w-2 flex-1 rounded-sm ${x.ok?'bg-emerald-500':'bg-red-500'}`}/>):<p className='px-2 text-sm text-soft'>Connect GitHub App to show deployment trend.</p>}
                </div>
                <Button disabled={!data.githubConfigured||!!busy} busy={busy==='/api/admin/ops/github/dispatch'} onClick={()=>{
                    if(window.prompt('Type DEPLOY DEVELOPMENT to start the audited workflow:')!=='DEPLOY DEVELOPMENT')return;
                    void runAction('/api/admin/ops/github/dispatch',{confirm:'DEPLOY DEVELOPMENT'},'Development deployment requested; refresh for results.');
                }}><Play className='h-4 w-4'/> Deploy develop</Button>
            </Card>
            <Card className='space-y-3'>
                <h2 className='font-semibold text-ink'>Deployments and faults history</h2>
                {runs.slice(0,30).map(r=><div key={txt(r.id)} className='rounded-xl border border-line p-3'>
                    <div className='flex items-start justify-between gap-2'>
                        <div className='min-w-0'>
                            <p className='text-sm font-semibold text-ink'>Run #{txt(r.run_number||r.id)} · {txt(r.head_branch)}</p>
                            <p className='text-xs text-soft'>{date(r.created_at)} · {txt(r.head_sha).slice(0,8)}</p>
                        </div>
                        <Badge tone={r.conclusion==='success'?'brand':r.conclusion==='failure'?'danger':'warn'}>{txt(r.conclusion||r.status)}</Badge>
                    </div>
                    <div className='mt-2 flex flex-wrap gap-2'>
                        <Button variant='secondary' onClick={()=>link(txt(r.html_url))}><ExternalLink className='h-4 w-4'/> Details</Button>
                        {r.conclusion==='failure'&&<Button variant='secondary' disabled={!data.githubConfigured||!!busy} onClick={()=>{
                            const id=Number(r.id);if(window.prompt(`Type RETRY ${id} to rerun failed jobs:`)!==`RETRY ${id}`)return;
                            void runAction('/api/admin/ops/github/retry',{runId:id,confirm:`RETRY ${id}`},'Rerun requested.');
                        }}><RotateCcw className='h-4 w-4'/> Retry failed</Button>}
                    </div>
                </div>)}
                {!runs.length&&<p className='text-sm text-soft'>No workflow history currently available.</p>}
            </Card>
            <Card className='space-y-2'>
                <h2 className='flex items-center gap-2 font-semibold text-ink'><GitCommit className='h-5 w-5 text-brand'/> Recent source versions</h2>
                {!data.commits.ok&&<Alert tone='warn'>{data.commits.message}</Alert>}
                {commits.map((c,i)=><button type='button' key={txt(c.sha)||i} onClick={()=>link(txt(c.html_url))} className='flex w-full items-center justify-between gap-2 rounded-xl border border-line p-3 text-left'>
                    <div className='min-w-0'><p className='truncate text-sm text-ink'>{txt(obj(c.commit).message).split('\n')[0]}</p><p className='text-xs text-soft'>{txt(c.sha).slice(0,10)}</p></div><ExternalLink className='h-4 w-4 shrink-0 text-muted'/>
                </button>)}
            </Card>
        </div>}
        {tab==='cloud'&&<div className='space-y-4'>
            <Card className='space-y-2'>
                <h2 className='flex items-center gap-2 font-semibold text-ink'><Cloud className='h-5 w-5 text-brand'/> Cloud Run service</h2>
                {good(data.service)}
                {data.service.ok ? <>
                    <p className='break-all text-sm text-ink'>Service: {data.serviceName}</p>
                    <p className='text-sm text-soft'>Project: {data.project} · Region: {data.region}</p>
                    <p className='text-sm text-soft'>Updated: {date(obj(data.service.data).updateTime)}</p>
                    <p className='text-sm text-soft'>Ready revision: {txt(obj(data.service.data).latestReadyRevision)}</p>
                    <p className='break-all text-xs text-soft'>URL: {txt(obj(data.service.data).uri)}</p>
                </> : <Alert tone='warn'>{data.service.message}</Alert>}
            </Card>
            <Card className='space-y-3'>
                <h2 className='font-semibold text-ink'>Versions and revision history</h2>
                {!data.revisions.ok&&<Alert tone='warn'>{data.revisions.message}</Alert>}
                {revs.map((v,i)=><div key={txt(v.name)||i} className='rounded-xl border border-line p-3'>
                    <p className='break-all text-sm font-semibold text-ink'>{txt(v.name).split('/').pop()}</p>
                    <p className='text-xs text-soft'>Created {date(v.createTime)} · updated {date(v.updateTime)}</p>
                    <p className='mt-1 text-xs text-soft'>Image: {txt(obj(obj(obj(v.containers)).image)).slice(0,100)||'See revision details in Cloud Run'}</p>
                </div>)}
                {!revs.length&&<p className='text-sm text-soft'>No revisions are currently available to this account.</p>}
            </Card>
        </div>}
        {tab==='firebase'&&<div className='space-y-3'>
            <Card className='space-y-3'>
                <div className='flex items-center justify-between gap-2'>
                    <h2 className='font-semibold text-ink'>Firebase operations</h2>{good(data.firebase)}
                </div>
                {data.firebase.ok ? <>
                    <p className='text-xs text-soft'>Development project: {txt(obj(data.firebase.data).project)}</p>
                    <div className='grid grid-cols-2 gap-2'>
                        {([['authUsers','Auth users'],['userDocuments','MEMS user records'],['organizations','Organizations'],['applications','Registrations']] as const)
                            .map(([key,label])=><div key={key} className='rounded-xl border border-line bg-page p-3'>
                                <p className='text-xs text-soft'>{label}</p>
                                <p className='text-xl font-bold text-ink'>{txt(obj(data.firebase.data)[key])}</p>
                            </div>)}
                    </div>
                    <p className='text-sm text-soft'>Setup status: {txt(obj(data.firebase.data).setupStatus)}</p>
                </>:<Alert tone='warn'>{data.firebase.message}</Alert>}
            </Card>
            <Card className='space-y-2'>
                <h2 className='font-semibold text-ink'>Administration and incident investigation</h2>
                <Button variant='secondary' onClick={()=>link('https://console.firebase.google.com/project/manufusion-mems-development/authentication/users')}>
                    <ExternalLink className='h-4 w-4'/> Authentication users
                </Button>
                <Button variant='secondary' onClick={()=>link('https://console.firebase.google.com/project/manufusion-mems-development/firestore/databases/-default-/data')}>
                    <ExternalLink className='h-4 w-4'/> Firestore database
                </Button>
                <Button variant='secondary' onClick={()=>link('https://console.cloud.google.com/monitoring?project=manufusion-mems-development')}>
                    <ExternalLink className='h-4 w-4'/> Google Cloud Monitoring
                </Button>
                <p className='text-xs text-soft'>Privileged Firebase user mutations remain in MEMS user administration or the authenticated Firebase Console; this page does not expose unrestricted identity or database writes.</p>
            </Card>
        </div>}
        {tab==='faults'&&<div className='space-y-3'>
            <Card className='space-y-2'>
                <h2 className='flex items-center gap-2 font-semibold text-ink'><AlertTriangle className='h-5 w-5 text-brand'/> Application and infrastructure logs</h2>
                {good(data.logs)}
                {!data.logs.ok&&<Alert tone='warn'>{data.logs.message}</Alert>}
                <p className='text-xs text-soft'>Showing latest {logs.length} entries. Sensitive raw logs are visible only to the platform super administrator.</p>
            </Card>
            {logs.map((v,i)=><Card key={txt(v.insertId)||i} className='space-y-2'>
                <div className='flex items-center justify-between gap-2'>
                    <p className='text-xs text-soft'>{date(v.timestamp)}</p>
                    <Badge tone={['ERROR','CRITICAL'].includes(txt(v.severity))?'danger':txt(v.severity)==='WARNING'?'warn':'brand'}>{txt(v.severity)||'INFO'}</Badge>
                </div>
                <pre className='max-h-40 overflow-x-auto whitespace-pre-wrap break-all text-xs text-ink'>{txt(v.textPayload)||JSON.stringify(v.jsonPayload||{},null,2).slice(0,3000)}</pre>
            </Card>)}
            {!logs.length&&<Card><p className='text-sm text-soft'>No log entries have been returned.</p></Card>}
        </div>}
        {(fault||notice)&&<Alert tone={fault?'error':'success'}>{fault||notice}</Alert>}
        <p className='text-xs text-soft'>Refreshed {date(data.generatedAt)} · MEMS platform super administrator access only. Cloud Run and Logging read access may require viewer roles on the development runtime service account.</p>
    </div>;
}
