import {useEffect,useId,useMemo,useState, type ReactNode} from 'react';
import {Alert,Field as MemsField,SelectField} from '../components/ui';
import {callBackend} from '../lib/backend';
import {hasPerm} from '../types';

type DemandType='FORECAST'|'FIRM_ORDER';
type DemandStatus='draft'|'pending_approval'|'approved'|'rejected';
type Demand={
 id?:string;skuId:string;siteId:string;needDate:string;type:DemandType;
 quantity:number;uom:string;source:'MANUAL';externalId:string;market:string;
 customerReference:string;notes:string;status?:DemandStatus;revision?:number;
 createdBy?:string;submittedBy?:string;
};
type Output={id:string;name:string;uom:string;siteId:string;category:string};
type Site={id:string;name:string};
type DemandSummary={skuId:string;siteId:string;market:string;period:string;uom:string;
 forecast:number;firmOrders:number;forecastConsumed:number;remainingForecast:number;
 totalDemand:number;sourceIds:string[]};
const initial=():Demand=>({skuId:'',siteId:'',needDate:'',type:'FORECAST',quantity:1,
 uom:'EA',source:'MANUAL',externalId:'',market:'',customerReference:'',notes:''});
const inputClass='w-full min-h-11 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-ink';
const fmt=(v:number)=>new Intl.NumberFormat(undefined,{maximumFractionDigits:3}).format(v);
const statusLabel=(v:string)=>v==='pending_approval'?'Awaiting approval':v==='approved'?'Approved':
 v==='rejected'?'Returned':'Draft';
function Card({children}:{children:ReactNode}){return <section className='rounded-2xl border border-line bg-panel p-4 text-ink'>{children}</section>;}
function Input({title,value,onChange,type='text',required=false}:{
 title:string;value:string|number;onChange:(v:string)=>void;type?:string;required?:boolean;
}){const id=useId();return <MemsField id={id} label={title} type={type}
 required={required} value={value} onChange={e=>onChange(e.target.value)} />;}
function Select({title,value,onChange,options}:{title:string;value:string;
 onChange:(v:string)=>void;options:Array<[string,string]>;}){
 const id=useId();
 return <SelectField id={id} label={title} value={value} onChange={e=>onChange(e.target.value)}>
    {options.map(([key,name])=><option key={key} value={key}>{name}</option>)}
 </SelectField>;
}
function Btn({children,onClick,disabled=false,secondary=false}:{children:ReactNode;
 onClick:()=>void;disabled?:boolean;secondary?:boolean;}){return <button type='button' disabled={disabled}
 onClick={onClick} className={'min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-50 '+
 (secondary?'border border-line text-ink':'bg-brand text-onbrand')}>{children}</button>;}

export default function PlnDemand({permissions}:{permissions:string[]}){
 const [sites,setSites]=useState<Site[]>([]);
 const [outputs,setOutputs]=useState<Output[]>([]);
 const [records,setRecords]=useState<Demand[]>([]);
 const [summary,setSummary]=useState<DemandSummary[]>([]);
 const [draft,setDraft]=useState<Demand|null>(null);
 const [showList,setShowList]=useState<'ALL'|'draft'|'pending_approval'|'approved'|'rejected'>('ALL');
 const [decisionReason,setDecisionReason]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const canEdit=hasPerm(permissions,'PLN.configure');
 const load=async()=>{
  setLoading(true);setError('');
  try{
   const [refs,lines,buckets]=await Promise.all([
    callBackend<{sites:Site[];outputs:Output[]}>('/api/org/pln/demand/references'),
    callBackend<{records:Demand[]}>('/api/org/pln/demand/list'),
    callBackend<{rows:DemandSummary[]}>('/api/org/pln/demand/summary')
   ]);
   setSites(refs.sites);setOutputs(refs.outputs);setRecords(lines.records);setSummary(buckets.rows);
  }catch(e){setError(e instanceof Error?e.message:'Could not load demand planning.');}
  finally{setLoading(false);}
 };
 useEffect(()=>{void load();},[]);
 const output=outputs.find(x=>x.id===draft?.skuId);
 const availableSites=output?.siteId?sites.filter(x=>x.id===output.siteId):sites;
 const visible=useMemo(()=>records.filter(x=>showList==='ALL'||x.status===showList)
  .sort((a,b)=>b.needDate.localeCompare(a.needDate)),[records,showList]);
 const counts=useMemo(()=>({
    forecasts:records.filter(r=>r.type==='FORECAST'&&r.status==='approved').length,
    orders:records.filter(r=>r.type==='FIRM_ORDER'&&r.status==='approved').length,
    awaiting:records.filter(r=>r.status==='pending_approval').length,
    buckets:summary.length,
 }),[records,summary]);
 const save=async()=>{
  if(!draft)return;
  if(!draft.skuId||!draft.siteId||!draft.needDate){setError('Choose output, site and required date.');return;}
  if(draft.type==='FIRM_ORDER'&&!draft.customerReference.trim()){
   setError('Confirmed orders need a customer/order reference.');return;
  }
  setBusy(true);setError('');setNotice('');
  try{
   await callBackend('/api/org/pln/demand/save',{
    id:draft.id||'',expectedRevision:draft.revision||0,record:draft
   });
   setDraft(null);await load();setNotice('Demand draft saved. Submit it for independent approval when ready.');
  }catch(e){setError(e instanceof Error?e.message:'Could not save demand.');}
  finally{setBusy(false);}
 };
 const act=async(row:Demand,action:'submit'|'approve'|'reject')=>{
  if(!row.id)return;
  if(action==='reject'&&!decisionReason.trim()){setError('Enter a rejection reason first.');return;}
  setBusy(true);setError('');setNotice('');
  try{
   await callBackend(action==='submit'?'/api/org/pln/demand/submit':'/api/org/pln/demand/decide',
    {id:row.id,...(action==='submit'?{}:{decision:action,reason:decisionReason.trim()})});
   setDecisionReason('');await load();
   setNotice(action==='submit'?'Demand submitted for approval':action==='approve'?'Demand approved and included in the S&OP view':'Demand returned for correction');
  }catch(e){setError(e instanceof Error?e.message:'Could not update demand.');}
  finally{setBusy(false);}
 };
 return <div className='space-y-4'>
  <div className='flex flex-wrap items-center justify-between gap-3'>
   <div><h2 className='text-lg font-semibold'>Demand & S&OP</h2>
    <p className='text-sm text-muted'>Manual forecasts and confirmed orders. Approval comes before demand can feed a production plan.</p></div>
   <Btn secondary onClick={()=>void load()} disabled={busy||loading}>Refresh</Btn>
  </div>
  {error&&<Alert tone='error'>{error}</Alert>}
  {notice&&<p role='status' className='rounded-lg border border-line p-3 text-sm'>{notice}</p>}
  {loading?<p className='text-sm text-muted'>Loading demand records…</p>:<>
  <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
   {([
    ['Approved forecasts',counts.forecasts],['Approved firm orders',counts.orders],
    ['Awaiting approval',counts.awaiting],['Net demand periods',counts.buckets],
   ] as Array<[string,number]>).map(([title,n])=><Card key={title}>
      <p className='text-xs text-muted'>{title}</p><p className='mt-1 text-lg font-semibold tabular-nums'>{fmt(n)}</p>
   </Card>)}
  </div>
  <p className='text-xs text-muted'>Summary cards count records, never add unlike units (such as cases, litres or pieces). Quantity calculations are reported per SKU, site, market, unit and month below.</p>
  <Card>
   <div className='flex flex-wrap items-center justify-between gap-2'>
    <h3 className='font-semibold'>Demand records</h3>
    {canEdit&&<Btn onClick={()=>{setDraft(initial());setError('');}}>Add demand</Btn>}
   </div>
   {!outputs.length&&<p className='mt-3 text-sm text-muted'>No demand outputs are available yet. Configure a finished or intermediate material under Manufacturing → Materials & Products, then refresh this page.</p>}
   {draft&&<div className='mt-4 space-y-3 rounded-xl border border-line p-3'>
    <div className='flex items-center justify-between gap-2'><h4 className='font-semibold'>{draft.id?'Edit demand draft':'New demand'}</h4>
      <Btn secondary onClick={()=>setDraft(null)}>Cancel</Btn></div>
    <div className='grid gap-3 sm:grid-cols-2'>
     <Select title='Output material / product' value={draft.skuId}
      options={[['','Select output'],...outputs.map(o=>[o.id,o.name+' · '+o.category] as [string,string])]}
      onChange={id=>{const item=outputs.find(o=>o.id===id);
       setDraft(x=>x?{...x,skuId:id,siteId:item?.siteId||'',uom:item?.uom||'EA'}:x);}}/>
     <Select title='Production site' value={draft.siteId}
      options={[['','Select site'],...availableSites.map(o=>[o.id,o.name] as [string,string])]}
      onChange={v=>setDraft(x=>x?{...x,siteId:v}:x)}/>
     <Select title='Demand type' value={draft.type} options={ [['FORECAST','Forecast'],['FIRM_ORDER','Confirmed customer order']] }
      onChange={v=>setDraft(x=>x?{...x,type:v as DemandType}:x)}/>
     <Input title='Required date' type='date' value={draft.needDate} required
      onChange={v=>setDraft(x=>x?{...x,needDate:v}:x)}/>
     <Input title='Quantity' type='number' value={draft.quantity} required
      onChange={v=>setDraft(x=>x?{...x,quantity:Number(v)}:x)}/>
     <div className='rounded-xl bg-page p-3 text-sm'><p className='text-xs text-muted'>Unit from material master</p>
      <p className='mt-1 font-semibold'>{draft.uom}</p></div>
     <Input title='Market / demand pool (optional)' value={draft.market}
      onChange={v=>setDraft(x=>x?{...x,market:v}:x)}/>
     <Input title={draft.type==='FIRM_ORDER'?'Customer / order reference (required)':'Customer / order reference (optional)'}
      value={draft.customerReference} onChange={v=>setDraft(x=>x?{...x,customerReference:v}:x)}/>
    </div>
    <label className='block text-xs font-medium text-soft'>Notes
     <textarea value={draft.notes} onChange={e=>setDraft(x=>x?{...x,notes:e.target.value}:x)}
      rows={2} className={inputClass+' mt-1'}/>
    </label>
    <p className='text-xs text-muted'>Source: manually entered. Nothing is posted to stock, procurement or customers.</p>
    <div className='flex justify-end'><Btn disabled={busy} onClick={()=>void save()}>Save draft</Btn></div>
   </div>}
   <div className='mt-4'>
    <Select title='Status filter' value={showList}
      options={ [['ALL','All statuses'],['draft','Draft'],['pending_approval','Awaiting approval'],
       ['approved','Approved'],['rejected','Returned']] }
      onChange={v=>setShowList(v as typeof showList)}/>
   </div>
   <div className='mt-3 space-y-3'>
    {visible.map(row=><div key={row.id} className='rounded-xl border border-line p-3'>
     <div className='flex flex-wrap items-start justify-between gap-2'>
      <div><p className='font-semibold'>{outputs.find(o=>o.id===row.skuId)?.name||row.skuId}</p>
       <p className='text-xs text-muted'>{row.type==='FORECAST'?'Forecast':'Firm order'} · {row.needDate} · {sites.find(s=>s.id===row.siteId)?.name||row.siteId}</p></div>
      <span className='rounded-full bg-page px-2 py-1 text-xs'>{statusLabel(row.status||'draft')}</span>
     </div>
     <p className='mt-2 text-sm font-semibold tabular-nums'>{fmt(row.quantity)} {row.uom}</p>
     {row.customerReference&&<p className='text-xs text-muted'>Reference: {row.customerReference}</p>}
     {row.market&&<p className='text-xs text-muted'>Market: {row.market}</p>}
     {canEdit&&(row.status==='draft'||row.status==='rejected')&&<div className='mt-3 flex flex-wrap gap-2'>
      <Btn secondary disabled={busy} onClick={()=>{setDraft(row);setError('');}}>Edit</Btn>
      {row.status==='draft'&&<Btn disabled={busy} onClick={()=>void act(row,'submit')}>Submit for approval</Btn>}
     </div>}
     {canEdit&&row.status==='pending_approval'&&<div className='mt-3 space-y-2'>
      <Input title='Approval note / rejection reason' value={decisionReason} onChange={setDecisionReason}/>
      <div className='flex flex-wrap gap-2'><Btn disabled={busy} onClick={()=>void act(row,'approve')}>Approve</Btn>
       <Btn secondary disabled={busy} onClick={()=>void act(row,'reject')}>Return for correction</Btn></div>
      <p className='text-xs text-muted'>An independent reviewer must approve. The maker cannot approve their own record.</p>
     </div>}
    </div>)}
    {!visible.length&&<p className='text-sm text-muted'>No demand records for this filter.</p>}
   </div>
  </Card>
  <Card>
   <h3 className='font-semibold'>Approved demand consolidation</h3>
   <p className='mt-1 text-xs text-muted'>Monthly forecast consumption: net demand = confirmed orders + forecast not consumed by those orders. This is a planning preview, not an approved production schedule.</p>
   <div className='mt-3 space-y-2'>
    {summary.map((r,i)=><div key={r.skuId+'|'+r.siteId+'|'+r.market+'|'+r.period+'|'+i}
     className='rounded-lg border border-line p-3 text-sm'>
     <p className='font-medium'>{outputs.find(o=>o.id===r.skuId)?.name||r.skuId}</p>
     <p className='text-xs text-muted'>{r.period} · {sites.find(s=>s.id===r.siteId)?.name||r.siteId}{r.market?' · '+r.market:''}</p>
     <div className='mt-2 grid grid-cols-2 gap-2 text-xs'>
      <span>Forecast: {fmt(r.forecast)} {r.uom}</span>
      <span>Firm orders: {fmt(r.firmOrders)} {r.uom}</span>
      <span>Consumed forecast: {fmt(r.forecastConsumed)} {r.uom}</span>
      <span className='font-semibold'>Net demand: {fmt(r.totalDemand)} {r.uom}</span>
     </div>
    </div>)}
    {!summary.length&&<p className='text-sm text-muted'>No approved demand yet. Save, submit and approve demand records to populate this view.</p>}
   </div>
  </Card>
  </>}
 </div>;
}
