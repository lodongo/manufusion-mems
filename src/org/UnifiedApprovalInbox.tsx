import { useCallback, useEffect, useState } from 'react';
import { callBackend } from '../lib/backend';

type ApprovalRow = {
  id:string;code:string;handlerName:string;status:string;createdAt:string;
  requestedBy:string;canDecide:boolean;
};
type Decision = 'approve'|'reject'|'return';

/** Tenant-scoped universal approval inbox, alongside existing module workflows. */
export default function UnifiedApprovalInbox(){
  const [items,setItems]=useState<ApprovalRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selection,setSelection]=useState<{id:string;decision:Decision}|null>(null);
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{const r=await callBackend<{items:ApprovalRow[]}>('/api/org/governance/approvals/my');setItems(r.items??[]);}
    catch(e){setError(e instanceof Error?e.message:'Could not load unified approvals.');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  async function decide(){
    if(!selection||(selection.decision!=='approve'&&!reason.trim())||busy)return;
    setBusy(true);setError('');
    try{
      await callBackend('/api/org/governance/approvals/decide',{
        id:selection.id,decision:selection.decision,reason:reason.trim(),
      });
      setSelection(null);setReason('');await load();
    }catch(e){setError(e instanceof Error?e.message:'Could not record approval decision.');}
    finally{setBusy(false);}
  }
  if(!loading&&!error&&!items.length)return null;
  return <section className='rounded-xl border border-[rgb(var(--c-border))] p-3 space-y-3'>
    <div className='flex flex-wrap items-center justify-between gap-2'>
      <h2 className='font-semibold text-ink'>Unified transaction approvals</h2>
      <button type='button' onClick={()=>void load()} className='rounded-lg border border-[rgb(var(--c-border))] px-3 py-2 text-sm text-ink'>Refresh</button>
    </div>
    {loading&&<p role='status' className='text-xs text-soft'>Loading approval requests…</p>}
    {error&&<p role='alert' className='text-sm text-red-600'>{error}</p>}
    <div className='space-y-2'>
      {items.map(item=><div key={item.id} className='rounded-lg border border-[rgb(var(--c-border))] p-3 space-y-2'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <strong className='text-sm text-ink'>{item.code}</strong>
          <span className='text-xs text-soft'>{item.status.replaceAll('_',' ')}</span>
        </div>
        <p className='break-words text-xs text-soft'>{item.handlerName} · {item.id}</p>
        {item.canDecide&&<div className='flex flex-wrap gap-2'>
          {(['approve','return','reject'] as const).map(decision=><button key={decision} type='button'
            onClick={()=>{setSelection({id:item.id,decision});setReason('');}}
            className='min-h-11 rounded-lg border border-[rgb(var(--c-border))] px-3 text-sm font-medium capitalize text-ink'>
            {decision}
          </button>)}
        </div>}
      </div>)}
    </div>
    {selection&&<div className='rounded-xl border border-[rgb(var(--c-border))] bg-[rgb(var(--c-surface))] p-3 space-y-3'>
      <p className='text-sm text-ink'>Confirm {selection.decision} for {selection.id}</p>
      {selection.decision!=='approve'&&<label className='block text-sm text-ink'>Reason (required)
        <textarea value={reason} onChange={e=>setReason(e.target.value)} rows={3}
          className='mt-1 w-full rounded-lg border border-[rgb(var(--c-border))] bg-transparent p-3 text-base'
          placeholder='Explain your decision'/>
      </label>}
      <div className='flex flex-wrap gap-2'>
        <button type='button' disabled={busy||(selection.decision!=='approve'&&!reason.trim())}
          onClick={()=>void decide()} className='min-h-11 rounded-lg bg-[rgb(var(--c-brand))] px-4 font-semibold text-white disabled:opacity-50'>Confirm decision</button>
        <button type='button' disabled={busy} onClick={()=>setSelection(null)}
          className='min-h-11 rounded-lg border border-[rgb(var(--c-border))] px-4 text-ink'>Cancel</button>
      </div>
    </div>}
  </section>;
}
