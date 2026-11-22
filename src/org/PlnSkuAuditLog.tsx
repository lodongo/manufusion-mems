import {useEffect,useState} from 'react';
import {callBackend} from '../lib/backend';

type Change={field:string;before:string;after:string};
type Revision={
    revision:number;current:boolean;action:string;at:string;actorUid:string;
    status:string;changes:Change[];fieldsTruncated:boolean;
};
type Event={
    id:string;at:string;action:string;actorUid:string;actorEmail:string;
    actorRole:string;outcome:string;priority:string;controls:string[];details:string;
};
type AuditResult={
    skuId:string;name:string;currentRevision:number;entries:Revision[];events:Event[];
    revisionHistoryLimited:boolean;auditEventLimitReached:boolean;
};
const label=(key:string)=>key.split('.').map(part=>part
    .replace(/([a-z0-9])([A-Z])/g,'$1 $2')
    .replace(/_/g,' ')).join(' / ');
const dateLabel=(date:string)=>{
    if(!date)return 'Date unavailable';
    const parsed=new Date(date);
    return Number.isNaN(parsed.getTime())?date:parsed.toLocaleString();
};
export default function PlnSkuAuditLog({skuId}:{skuId:string}){
    const [result,setResult]=useState<AuditResult|null>(null);
    const [loading,setLoading]=useState(true);
    const [error,setError]=useState('');
    const [reload,setReload]=useState(0);
    useEffect(()=>{
        let mounted=true;
        setLoading(true);setError('');setResult(null);
        void callBackend<AuditResult>('/api/org/pln-mfg/foundation/sku/audit-log',{skuId})
            .then(data=>{if(mounted)setResult(data);})
            .catch(e=>{if(mounted)setError(e instanceof Error?e.message:'Unable to read SKU audit log.');})
            .finally(()=>{if(mounted)setLoading(false);});
        return ()=>{mounted=false;};
    },[skuId,reload]);
    return <section className='space-y-4' aria-label={'Audit log for '+skuId}>
        <div className='flex flex-wrap items-center justify-between gap-2'>
            <div>
                <h3 className='font-semibold'>SKU audit log</h3>
                <p className='break-all text-xs text-muted'>{skuId} · read-only</p>
            </div>
            <button type='button' className='min-h-11 rounded-xl border border-line px-4 text-sm'
                onClick={()=>setReload(i=>i+1)}>Refresh</button>
        </div>
        {loading&&<p role='status' className='text-sm text-muted'>Loading SKU audit records…</p>}
        {error&&<p role='alert' className='rounded-lg border border-red-400 p-3 text-sm text-red-600'>{error}</p>}
        {result&&<>
            <p className='text-sm text-soft'>Saved revision history and recorded security actions for {result.name||skuId}.
                Each change lists its previous and new values.</p>
            {result.revisionHistoryLimited&&<p className='text-xs text-amber-600'>
                Showing the newest 250 saved states. Earlier states are retained in the master history.
            </p>}
            <div className='space-y-2'>
                <h4 className='font-semibold'>Changes by revision ({result.entries.length})</h4>
                {!result.entries.length&&<p className='text-sm text-muted'>No saved revisions found.</p>}
                {result.entries.map((entry,i)=><details key={entry.revision+'-'+i}
                    className='rounded-xl border border-line bg-page p-3' open={i===0}>
                    <summary className='cursor-pointer text-sm font-semibold'>
                        Revision {entry.revision}{entry.current?' · Current state':''} · {entry.action}
                        <span className='mt-1 block font-normal text-muted'>
                            {dateLabel(entry.at)} · {entry.actorUid||'Actor not recorded'} · {entry.status||'Status unavailable'}
                            {' · '}{entry.changes.length} field changes
                        </span>
                    </summary>
                    {entry.changes.length?<div className='mt-3 space-y-3'>
                        {entry.changes.map((change,index)=><div key={change.field+'-'+index} className='min-w-0 rounded-lg border border-line bg-panel p-3'>
                            <p className='break-words text-sm font-semibold'>{label(change.field)}</p>
                            <div className='mt-2 grid gap-2 sm:grid-cols-2'>
                                <div><p className='text-xs text-muted'>Previous</p>
                                    <pre className='max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs'>{change.before}</pre>
                                </div>
                                <div><p className='text-xs text-muted'>Updated</p>
                                    <pre className='max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs'>{change.after}</pre>
                                </div>
                            </div>
                        </div>)}
                        {entry.fieldsTruncated&&<p className='text-xs text-amber-600'>Field list limited to 200 changes for this revision.</p>}
                    </div>:<p className='mt-2 text-xs text-muted'>No tracked field differences in this saved state.</p>}
                </details>)}
            </div>
            <div className='space-y-2'>
                <h4 className='font-semibold'>Recorded audit actions ({result.events.length})</h4>
                {result.auditEventLimitReached&&<p className='text-xs text-amber-600'>
                    Audit event results reached the 500-event query limit. Older events may not be included.
                </p>}
                {!result.events.length&&<p className='text-sm text-muted'>
                    No matching organization audit events were found. Saved revision records above remain available.
                </p>}
                {result.events.map(event=><div key={event.id} className='rounded-xl border border-line p-3'>
                    <div className='flex flex-wrap items-start justify-between gap-2'>
                        <p className='break-all text-sm font-semibold'>{label(event.action)}</p>
                        <span className='text-xs text-muted'>{event.outcome}{event.priority==='high'?' · High priority':''}</span>
                    </div>
                    <p className='mt-1 text-xs text-muted'>{dateLabel(event.at)} · {event.actorEmail||event.actorUid||'Actor unavailable'}
                        {event.actorRole?' · '+event.actorRole:''}</p>
                    {event.details&&<p className='mt-2 whitespace-pre-wrap break-words text-sm'>{event.details}</p>}
                    {event.controls.length>0&&<p className='mt-2 break-words text-xs text-muted'>
                        Test-mode/security overrides: {event.controls.join(', ')}
                    </p>}
                </div>)}
            </div>
        </>}
    </section>;
}
