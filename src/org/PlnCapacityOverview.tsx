import {useEffect,useState} from 'react';
import {callBackend} from '../lib/backend';
import {SelectField} from '../components/ui';
import PlnFlowOpportunities from './PlnFlowOpportunities';
import type {FlowAnalysis} from '../shared/mfgFlowCapacity';

type Site={id:string;name:string;code?:string};
type Variant={skuId:string;ready:boolean;issueCount:number;flowAnalysis:FlowAnalysis;
 stages:Array<{code:string;name:string;dependsOn:string[];
 capacity:{quantity:number;unit:string;source:string}|null}>};
type Flow={id:string;name:string;siteId:string;processClassId:string;
 alternativeCode:string;status:string;revision:number;mappedSkus:string[];skuReviews:Variant[]};
type Page={total:number;offset:number;limit:number;hasMore:boolean;flows:Flow[]};
const fmt=(n:number)=>new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(n);

/** Read-only analysis; does not issue inventory, start production or submit approvals. */
export default function PlnCapacityOverview({sites,processClasses,items,units}:{
 sites:Site[];processClasses:Array<{id:string;name:string}>;items:Array<{id:string;name:string}>;
 units:Array<{code:string;label?:string;symbol?:string}>;
}){
 const [siteId,setSiteId]=useState('');
 const [offset,setOffset]=useState(0);
 const [page,setPage]=useState<Page|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  let active=true;setBusy(true);setError('');
  void callBackend<Page>('/api/org/pln-mfg/foundation/capacity-overview',{siteId,offset,limit:6})
   .then(result=>{if(active)setPage(result);})
   .catch(e=>{if(active){setPage(null);setError(e instanceof Error?e.message:'Unable to analyze manufacturing capacities.');}})
   .finally(()=>{if(active)setBusy(false);});
  return ()=>{active=false;};
 },[siteId,offset,revision]);
 const flows=page?.flows||[];
 const variants=flows.flatMap(x=>x.skuReviews);
 const constrained=variants.filter(x=>x.flowAnalysis.limitedLinks>0).length;
 const pending=variants.reduce((n,x)=>n+x.flowAnalysis.unresolved.length,0);
 return <section className='space-y-4'>
  <div className='space-y-1'>
   <h2 className='text-lg font-semibold'>Production capacity overview</h2>
   <p className='text-sm text-muted'>Compare every authorized manufacturing routing's upstream and downstream capacity. Each assigned SKU is reviewed with its own recipe and stage capacities. Results use saved planning rates, not live meter readings.</p>
  </div>
  <div className='grid gap-2 rounded-xl border border-line bg-panel p-3 sm:grid-cols-[1fr_auto] sm:items-end'>
   <SelectField id='mfg-overview-site' label='Production site' value={siteId}
    onChange={e=>{setSiteId(e.target.value);setOffset(0);}}>
    <option value=''>All permitted sites</option>
    {sites.map(site=><option key={site.id} value={site.id}>{site.name}{site.code?' · '+site.code:''}</option>)}
   </SelectField>
   <button type='button' className='min-h-11 rounded-xl border border-line px-3 text-sm font-semibold disabled:opacity-50'
    disabled={busy} onClick={()=>setRevision(x=>x+1)}>{busy?'Analyzing…':'Recalculate'}</button>
  </div>
  {error&&<p role='alert' className='rounded-xl border border-red-500/60 p-3 text-sm text-red-600'>{error}</p>}
  <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
   {[
    ['Routing flows',String(page?.total??0)],
    ['Flows on page',String(flows.length)],
    ['SKU analyses with gaps',String(constrained)],
    ['Unresolved comparisons',String(pending)],
   ].map(([title,value])=><div className='rounded-xl border border-line bg-panel p-3' key={title}>
    <p className='text-xs text-muted'>{title}</p>
    <p className='mt-1 text-xl font-semibold tabular-nums'>{busy&&!page?'…':value}</p>
   </div>)}
  </div>
  {busy&&<p role='status' className='text-sm text-muted'>Checking authorized process flows and configured capacities…</p>}
  {!busy&&page&&page.total===0&&<p className='rounded-xl border border-line p-3 text-sm text-muted'>No manufacturing routes found in this scope. Configure a process route and its stage capacities to begin analysis.</p>}
  {flows.map(flow=><article className='space-y-3 rounded-xl border border-line bg-panel p-3' key={flow.id}>
   <div className='space-y-1'>
    <h3 className='break-words text-base font-semibold'>{flow.name}</h3>
    <p className='text-xs text-muted'>
     {sites.find(x=>x.id===flow.siteId)?.name||'Organization route'} ·
     {' '+(processClasses.find(x=>x.id===flow.processClassId)?.name||'Process unclassified')} ·
     {' '+(flow.alternativeCode||'No alternative code')} · {flow.status||'draft'}
    </p>
    <p className='text-xs text-muted'>{flow.mappedSkus.length} mapped SKU(s) · revision {flow.revision}</p>
   </div>
   {flow.skuReviews.map((sku,i)=><section key={sku.skuId||String(i)} className='space-y-2 rounded-lg border border-line p-3'>
    <div className='flex flex-wrap justify-between gap-2'>
     <h4 className='text-sm font-semibold'>{sku.skuId?
      (items.find(x=>x.id===sku.skuId)?.name||sku.skuId):'Preliminary flow · SKU mapping incomplete'}</h4>
     <span className='text-xs text-muted'>{sku.issueCount} readiness issue(s)</span>
    </div>
    <PlnFlowOpportunities analysis={sku.flowAnalysis} units={units}
     heading='Upstream and downstream flow balance'/>
    {sku.stages.length>0&&<details className='rounded-lg border border-line p-3'>
     <summary className='cursor-pointer text-xs font-semibold'>View stage-by-stage capacity ({sku.stages.length})</summary>
     <div className='mt-2 space-y-2'>
      {sku.stages.map(stage=><div key={stage.code} className='rounded-lg bg-page p-2 text-xs'>
       <p className='font-semibold'>{stage.name||stage.code}</p>
       <p className='mt-1'>{stage.capacity?
        fmt(stage.capacity.quantity)+' '+(units.find(u=>u.code===stage.capacity?.unitCode)?.symbol||stage.capacity.unit):'Rate not configured or comparable'}</p>
       <p className='text-muted'>Depends on: {stage.dependsOn.length?stage.dependsOn.join(', '):'No predecessors'} ·
        {' '+(stage.capacity?.source||'Missing master-data basis')}</p>
      </div>)}
     </div>
    </details>}
   </section>)}
  </article>)}
  {page&&page.total>page.limit&&<div className='flex items-center justify-between gap-2'>
   <button type='button' className='min-h-11 rounded-xl border border-line px-3 text-sm disabled:opacity-50'
    disabled={busy||offset===0} onClick={()=>setOffset(x=>Math.max(0,x-page.limit))}>Previous</button>
   <p className='text-xs text-muted'>{page.offset+1}–{Math.min(page.offset+page.limit,page.total)} of {page.total} flows</p>
   <button type='button' className='min-h-11 rounded-xl border border-line px-3 text-sm disabled:opacity-50'
    disabled={busy||!page.hasMore} onClick={()=>setOffset(x=>x+page.limit)}>Next</button>
  </div>}
  <p className='text-xs text-muted'>A capacity alert identifies a potential planning constraint. It is not proof of equipment failure or a scheduled stop. Incompatible units and parallel feed requirements remain unresolved until correct material conversion ratios are provided.</p>
 </section>;
}
