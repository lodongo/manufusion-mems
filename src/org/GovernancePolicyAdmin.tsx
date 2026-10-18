import { useCallback, useEffect, useState } from 'react';
import { callBackend } from '../lib/backend';
import SelectField from '../components/SearchableSelect';

type Endpoint={code:string|null;name:string;permission:string|null;path:string;module:string};
type Proposal={
  id:string;code:string;kind:string;reason:string;status:string;
  configuredBy:string;configuredAt:string;approvedBy:string;canReview:boolean;
};
const modules=['ADM','AST','FIN','INV','MNT','PRC','WHS','SAF','QLT','HRM','PAY','MFG','LOG','DST','SAL','CRM','POS','PRJ','DOC','RPT','PLN','CST'];

/** This UI never grants rights: proposal and independent approval are separate APIs. */
export default function GovernancePolicyAdmin(){
  const [module,setModule]=useState('MNT');
  const [endpoints,setEndpoints]=useState<Endpoint[]>([]);
  const [code,setCode]=useState('');
  const [classification,setClassification]=useState('permission_only');
  const [evidence,setEvidence]=useState({handlerEvidenceId:'',scopeEvidenceId:'',sodEvidenceId:''});
  const [reason,setReason]=useState('');
  const [proposals,setProposals]=useState<Proposal[]>([]);
  const [reviewId,setReviewId]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const refresh=useCallback(async()=>{
    try{const response=await callBackend<{items:Proposal[]}>('/api/org/governance/config/list');setProposals(response.items??[]);}
    catch(e){setError(e instanceof Error?e.message:'Could not retrieve governance proposals.');}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    let active=true;setCode('');
    callBackend<{wiredEndpoints:Endpoint[]}>('/api/org/governance/blueprints/list',{module})
      .then(d=>{if(active)setEndpoints((d.wiredEndpoints??[]).filter(x=>x.code&&x.permission));})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load installed transactions.');});
    return ()=>{active=false;};
  },[module]);
  async function propose(){
    if(busy||!code||reason.trim().length<10)return;
    setBusy(true);setError('');setNotice('');
    try{
      const r=await callBackend<{id:string}>('/api/org/governance/config/propose',{
        code,kind:'binding',classification,...evidence,reason:reason.trim(),
      });
      setNotice('Proposal submitted for independent review: '+r.id);
      setReason('');setEvidence({handlerEvidenceId:'',scopeEvidenceId:'',sodEvidenceId:''});
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:'Could not propose this transaction binding.');}
    finally{setBusy(false);}
  }
  async function approve(){
    if(busy||!reviewId)return;
    setBusy(true);setError('');setNotice('');
    try{
      const r=await callBackend<{code:string;version:number}>('/api/org/governance/config/review',{id:reviewId});
      setNotice('Independently reviewed '+r.code+' · revision '+r.version);
      setReviewId('');await refresh();
    }catch(e){setError(e instanceof Error?e.message:'Could not independently review proposal.');}
    finally{setBusy(false);}
  }
  return <section className='space-y-4 rounded-xl border border-[rgb(var(--c-border))] p-4'>
    <header className='space-y-1'>
      <h2 className='font-semibold text-ink'>Transaction binding review</h2>
      <p className='text-sm text-soft'>Bind installed handlers to security controls. A separate authorized administrator must approve changes. Proposals do not activate transactions.</p>
    </header>
    {error&&<p role='alert' className='text-sm text-red-600'>{error}</p>}
    {notice&&<p role='status' className='text-sm text-ink'>{notice}</p>}
    <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
      <SelectField id='governance-binding-module' label='Module' value={module} onChange={e=>setModule(e.target.value)}>
        {modules.map(m=><option key={m} value={m}>{m}</option>)}
      </SelectField>
      <SelectField id='governance-binding-endpoint' label='Installed transaction' value={code} onChange={e=>setCode(e.target.value)}>
        <option value=''>Select a transaction</option>
        {endpoints.map(x=><option key={x.code} value={x.code!}>{x.code} · {x.name}</option>)}
      </SelectField>
      <SelectField id='governance-binding-class' label='Required governance' value={classification} onChange={e=>setClassification(e.target.value)}>
        <option value='permission_only'>Permission-based</option>
        <option value='approval_required'>Authority and approval required</option>
      </SelectField>
    </div>
    <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
      {([
        ['handlerEvidenceId','Handler verification evidence'],
        ['scopeEvidenceId','Scope verification evidence'],
        ['sodEvidenceId','Separation-of-duties evidence'],
      ] as const).map(([field,label])=><label key={field} className='text-sm text-ink'>{label}
        <input value={evidence[field]} onChange={e=>setEvidence(cur=>({...cur,[field]:e.target.value}))}
          placeholder='Evidence reference' className='mt-1 w-full rounded-lg border border-[rgb(var(--c-border))] bg-transparent p-3 text-base'/>
      </label>)}
    </div>
    <label className='block text-sm text-ink'>Change justification
      <textarea rows={2} value={reason} onChange={e=>setReason(e.target.value)} placeholder='Reason for this configuration'
        className='mt-1 w-full rounded-lg border border-[rgb(var(--c-border))] bg-transparent p-3 text-base'/>
    </label>
    <button type='button' disabled={busy||!code||reason.trim().length<10||Object.values(evidence).some(v=>!v.trim())}
      onClick={()=>void propose()} className='min-h-12 rounded-lg bg-[rgb(var(--c-brand))] px-4 font-semibold text-white disabled:opacity-40'>Submit for review</button>
    <div className='space-y-2 border-t border-[rgb(var(--c-border))] pt-4'>
      <div className='flex items-center justify-between gap-3'>
        <h3 className='font-semibold text-ink'>Configuration proposals</h3>
        <button type='button' onClick={()=>void refresh()} className='rounded-lg border border-[rgb(var(--c-border))] px-3 py-2 text-sm text-ink'>Refresh</button>
      </div>
      {proposals.slice(0,60).map(p=><div key={p.id} className='flex flex-col gap-2 rounded-lg border border-[rgb(var(--c-border))] p-3 sm:flex-row sm:items-center'>
        <span className='min-w-0 flex-1 break-words text-sm text-ink'><strong>{p.code}</strong> · {p.kind} · {p.status}<span className='block text-xs text-soft'>{p.reason}</span></span>
        {p.canReview&&<button type='button' onClick={()=>setReviewId(p.id)}
          className='min-h-11 rounded-lg border border-[rgb(var(--c-border))] px-3 text-sm text-ink'>Review</button>}
      </div>)}
      {!proposals.length&&<p className='text-sm text-soft'>No governance configuration proposals yet.</p>}
      {reviewId&&<div className='rounded-lg border border-[rgb(var(--c-border))] p-3 space-y-2'>
        <p className='text-sm text-ink'>Approve independent review of {reviewId}?</p>
        <div className='flex flex-wrap gap-2'>
          <button disabled={busy} type='button' onClick={()=>void approve()} className='min-h-11 rounded-lg bg-[rgb(var(--c-brand))] px-4 text-sm font-semibold text-white'>Approve configuration</button>
          <button type='button' onClick={()=>setReviewId('')} className='min-h-11 rounded-lg border border-[rgb(var(--c-border))] px-4 text-sm text-ink'>Cancel</button>
        </div>
      </div>}
    </div>
  </section>;
}
