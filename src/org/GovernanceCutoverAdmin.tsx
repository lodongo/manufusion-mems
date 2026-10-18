import { useCallback, useEffect, useState } from 'react';
import { callBackend } from '../lib/backend';
type Blocked = { code:string|null;module:string;area:string;handler:string;route:string;classification:string;issues:string[] };
type Proposal = {id:string;status:string;reason:string;configuredBy:string;configuredAt:string;canReview:boolean};
type Status = {mode:string;proposals:Proposal[];report:{
  inspected:number;ready:number;blocked:number;coveragePercent:number;
  digest:string;canActivate:boolean;items:Blocked[];truncated:boolean;
}};
function routeOwner(item:Blocked):{owner:string;next:string;bindingReady:boolean}{
  const all=item.issues.join('; ').toLowerCase();
  if(all.includes('route has no organization guard')||all.includes('canonical transaction code missing')||
     all.includes('explicit route action permission missing')||all.includes('handler name is not unique')){
    return {owner:'Engineering',next:'Register this route with an exact transaction code and enforced server permission. Validate tenant/site scope and separation of duties before assigning an administrator.',bindingReady:false};
  }
  if(all.includes('handler, scope or separation-of-duties evidence missing')||all.includes('binding does not match')){
    return {owner:'Engineering + governance administrator',next:'Resolve handler evidence or permission mapping in code; then submit a corrected binding for independent review.',bindingReady:true};
  }
  if(all.includes('chart of authority')||all.includes('authority rules')){
    return {owner:'Governance administrators',next:'Configure the applicable Chart of Authority, approver streams and levels, then obtain approval from a different authorized administrator.',bindingReady:false};
  }
  return {owner:'Governance administrators',next:'Open the Security tab, select the installed transaction, attach genuine engineering verification evidence and submit a binding. A second authorized administrator must approve it.',bindingReady:true};
}
export default function GovernanceCutoverAdmin({onReviewBinding}:{onReviewBinding?:(module:string)=>void}){
  const [data,setData]=useState<Status|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [reason,setReason]=useState('');
  const [showIssues,setShowIssues]=useState(false);
  const [confirmRecovery,setConfirmRecovery]=useState(false);
  const load=useCallback(async()=>{
    try{setData(await callBackend<Status>('/api/org/governance/cutover/status'));}
    catch(e){setError(e instanceof Error?e.message:'Cutover readiness is unavailable.');}
  },[]);
  useEffect(()=>{void load();},[load]);
  async function act(endpoint:string,body:Record<string,unknown>){
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      await callBackend(endpoint,body);
      setNotice('Request processed. The live readiness state has been refreshed.');
      setReason('');setConfirmRecovery(false);await load();
    }catch(e){setError(e instanceof Error?e.message:'Cutover operation failed.');}
    finally{setBusy(false);}
  }
  return <section className='space-y-3 rounded-xl border border-[rgb(var(--c-border))] p-4'>
    <div className='flex flex-wrap items-start justify-between gap-2'>
      <div>
        <h2 className='font-semibold text-ink'>Governance activation readiness</h2>
        <p className='text-xs text-soft'>Server-verified route coverage. No transaction is activated by this report.</p>
      </div>
      <button type='button' onClick={()=>void load()} className='min-h-11 rounded-lg border border-[rgb(var(--c-border))] px-3 text-sm text-ink'>Refresh assessment</button>
    </div>
    {error&&<p role='alert' className='text-sm text-red-600'>{error}</p>}
    {notice&&<p role='status' className='text-sm text-ink'>{notice}</p>}
    {data&&<>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
        {([['Current mode',data.mode],['Handlers',String(data.report.inspected)],
          ['Validated',String(data.report.ready)],['Blocked',String(data.report.blocked)]] as const)
          .map(([label,value])=><div key={label} className='rounded-lg border border-[rgb(var(--c-border))] p-3'>
            <p className='text-xs text-soft'>{label}</p><p className='font-semibold text-ink'>{value}</p>
          </div>)}
      </div>
      <p className='text-sm text-soft'>{data.report.coveragePercent}% of guarded transaction handlers have reviewed, matching configuration.
        {data.report.blocked>0?' Activation is blocked until every remaining handler is resolved. Existing business routes continue under their present controls.':''}</p>
      {data.report.blocked>0&&<div className='space-y-2'>
        <p className='text-xs text-soft'>Resolution order: (1) Engineering assigns and enforces missing route permissions/codes; (2) an authorized governance administrator submits verified bindings and authority policies; (3) a different authorized administrator approves; (4) refresh this assessment. A missing code cannot be resolved by entering a justification.</p>
        <button type='button' aria-expanded={showIssues} onClick={()=>setShowIssues(x=>!x)}
          className='min-h-11 rounded-lg border border-[rgb(var(--c-border))] px-3 text-sm text-ink'>
          {showIssues?'Hide':'Show'} blocked handlers
        </button>
        {showIssues&&<div className='max-h-80 space-y-2 overflow-y-auto'>
          {data.report.items.map((item,i)=><div key={item.route+'-'+i} className='rounded-lg border border-[rgb(var(--c-border))] p-2'>
            <p className='break-all text-xs font-semibold text-ink'>{item.code??'Unassigned'} · {item.route}</p>
            <p className='text-xs text-soft'>{item.module} / {item.area} · {item.handler}</p>
            <p className='text-xs text-red-600'>{item.issues.join('; ')}</p>
            <p className='mt-2 text-xs font-semibold text-ink'>Owner: {routeOwner(item).owner}</p>
            <p className='text-xs text-soft'>{routeOwner(item).next}</p>
            {routeOwner(item).bindingReady&&item.code&&onReviewBinding&&
              <button type='button' onClick={()=>onReviewBinding(item.module)}
                className='mt-2 min-h-10 rounded-lg border border-[rgb(var(--c-border))] px-3 text-xs font-semibold text-ink'>
                Open binding review for {item.module}
              </button>}
          </div>)}
          {data.report.truncated&&<p className='text-xs text-soft'>Showing the first 250 blocked handlers.</p>}
        </div>}
      </div>}
      <label className='block text-sm text-ink'>Justification for a governance change
        <textarea rows={2} value={reason} onChange={e=>setReason(e.target.value)}
          className='mt-1 w-full rounded-lg border border-[rgb(var(--c-border))] bg-transparent p-3 text-base'
          placeholder='Why is the governance change required?'/>
      </label>
      <div className='flex flex-wrap gap-2'>
        <button type='button' disabled={busy||!data.report.canActivate||data.mode==='enforce'||reason.trim().length<15}
          onClick={()=>void act('/api/org/governance/cutover/propose',{reason})}
          className='min-h-11 rounded-lg border border-[rgb(var(--c-border))] px-3 text-sm font-semibold text-ink disabled:opacity-40'>
          Propose full activation
        </button>
        {data.mode==='enforce'&&<button type='button' onClick={()=>setConfirmRecovery(true)}
          className='min-h-11 rounded-lg border border-[rgb(var(--c-border))] px-3 text-sm text-ink'>Emergency recovery</button>}
      </div>
      {confirmRecovery&&<div className='space-y-2 rounded-lg border border-red-400 p-3 text-sm'>
        <p className='text-ink'>Emergency recovery restores the previously configured business controls and creates a high-risk audit event.</p>
        <button disabled={busy||reason.trim().length<15} type='button'
          onClick={()=>void act('/api/org/governance/cutover/disable',{reason})}
          className='min-h-11 rounded-lg border border-red-400 px-3 text-red-600 disabled:opacity-40'>Confirm emergency recovery</button>
      </div>}
      {data.proposals.some(p=>p.status==='proposed')&&<div className='space-y-2 border-t border-[rgb(var(--c-border))] pt-3'>
        <h3 className='font-medium text-ink'>Awaiting independent cutover review</h3>
        {data.proposals.filter(p=>p.status==='proposed').map(p=><div key={p.id} className='flex flex-wrap items-center gap-2 rounded-lg border border-[rgb(var(--c-border))] p-3'>
          <span className='min-w-0 flex-1 text-xs text-ink'>{p.reason}<span className='block text-soft'>{p.id}</span></span>
          {p.canReview&&<button type='button' disabled={busy||!data.report.canActivate}
            onClick={()=>void act('/api/org/governance/cutover/approve',{id:p.id})}
            className='min-h-11 rounded-lg border border-[rgb(var(--c-border))] px-3 text-sm text-ink'>Approve activation</button>}
        </div>)}
      </div>}
    </>}
  </section>;
}
