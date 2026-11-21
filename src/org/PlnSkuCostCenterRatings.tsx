import {useEffect,useState} from 'react';
import {callBackend} from '../lib/backend';
import {ManufacturingResourceDetail} from './ManufacturingResources';

type RatedQuantity={quantity:number|null;unit:string;name:string;reason?:string};
type Projection={
 source:{containerName:string;containerCategory:string;containerSubcategory:string;
  containerAttributes:Record<string,string>;sizeName:string;countUnit:string;
  timeUnit:string;ratedUnits:number;physicalContainers:number;
  ratingOutputCode:string;ratingOutputName:string;primaryContainersPerRatedOutput:number};
 physicalContainers:RatedQuantity;productionForm:RatedQuantity;finalProduct:RatedQuantity;
 commercialPackaging:RatedQuantity;transportLogistics:RatedQuantity;normalised:RatedQuantity;
};
type Mapping={
 costCenterId:string;costCenterName:string;costCenterCode:string;
 siteId:string;siteName:string;legalEntityId:string;legalEntityName:string;
 revision:number;updatedAt:string;
 countUnit:{name:string;symbol:string;multiplier:number}|null;
 periodUnit:{name:string;symbol:string}|null;
 rating:{skuId:string;containerId:string;containerSizeId:string;
  ratingQuantity?:number;ratingUnitCode?:string;periodUnitCode?:string;ratingOutputCode?:string;
  projection?:Projection|null;conversionIssue?:string};
};
type Response={skuId:string;skuName:string;costCenters:Mapping[]};
type ResourceLocation={costCenterId:string;costCenterName:string;costCenterCode:string;canConfigure:boolean};
type Resources={costCenters:ResourceLocation[]};
const format=(n:number)=>new Intl.NumberFormat(undefined,{maximumFractionDigits:3}).format(n);
function RateOutput({title,value}:{title:string;value:RatedQuantity}){
 return <div className='rounded-lg border border-line bg-page p-3'>
  <p className='text-xs text-muted'>{title}</p>
  <p className='mt-1 text-sm font-semibold text-ink'>
   {value.quantity===null?'Not configured':format(value.quantity)+' '+value.unit}
  </p>
  <p className='text-xs text-muted'>{value.name}{value.reason?' · '+value.reason:''}</p>
 </div>;
}
/** Read-only, scoped reverse lookup of the cost-centre-owned SKU speed master. */
export default function PlnSkuCostCenterRatings({skuId}:{skuId:string}){
 const [response,setResponse]=useState<Response|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [reload,setReload]=useState(0);
 const [opened,setOpened]=useState('');
 const [chooser,setChooser]=useState(false);
 const [scopeCenters,setScopeCenters]=useState<ResourceLocation[]>([]);
 const [selectedCc,setSelectedCc]=useState('');
 const [scopeError,setScopeError]=useState('');
 const loadCenters=async()=>{
  setScopeError('');setChooser(true);
  try{
   const r=await callBackend<Resources>('/api/org/pln/resource/list');
   setScopeCenters(r.costCenters.filter(x=>x.canConfigure));
  }catch(e){setScopeError(e instanceof Error?e.message:'Unable to list permitted production cost centres.');}
 };
 useEffect(()=>{
  let active=true;
  setResponse(null);setError('');setLoading(true);
  void callBackend<Response>('/api/org/pln/cost-center/sku-mappings',{skuId})
   .then(data=>{if(active)setResponse(data);})
   .catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to retrieve commissioned SKU speeds.');})
   .finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;};
 },[skuId,reload]);
 if(opened)return <ManufacturingResourceDetail key={opened} costCenterId={opened}
    initialTab='sku' initialSkuId={skuId}
    onBack={()=>{setOpened('');setReload(n=>n+1);}} onSaved={()=>setReload(n=>n+1)}/>;
 return <section className='space-y-3 rounded-xl border border-line p-3'>
  <div className='flex flex-wrap items-start justify-between gap-2'>
   <div>
    <h3 className='font-semibold text-ink'>Mapped manufacturing cost centres</h3>
    <p className='mt-1 text-xs text-muted'>Commissioned output speed and its equivalent primary-unit throughput for each accessible manufacturing cost centre.</p>
   </div>
   <div className='flex flex-wrap gap-2'>
    <button type='button' className='min-h-10 rounded-lg border border-line px-3 text-sm font-semibold'
     onClick={()=>void loadCenters()}>Allocate SKU</button>
    <button type='button' className='min-h-10 rounded-lg border border-line px-3 text-sm font-semibold'
     disabled={loading} onClick={()=>setReload(n=>n+1)}>Refresh speeds</button>
   </div>
  </div>
  {chooser&&<section className='space-y-3 rounded-xl border border-line bg-page p-3'>
   <h4 className='text-sm font-semibold'>Allocate this SKU to a production cost centre</h4>
   <p className='text-xs text-muted'>Select an authorized cost centre. The same SKU allocation and physical-container rating editor opens as in Manufacturing Resources and Asset Management.</p>
   {scopeError&&<p role='alert' className='text-xs text-red-600'>{scopeError}</p>}
   <select aria-label='Production cost centre' className='min-h-11 w-full rounded-xl border border-line bg-panel p-2 text-sm'
    value={selectedCc} onChange={e=>setSelectedCc(e.target.value)}>
    <option value=''>Select production cost centre</option>
    {scopeCenters.map(c=><option key={c.costCenterId} value={c.costCenterId}>{c.costCenterName} · {c.costCenterCode}</option>)}
   </select>
   <div className='flex gap-2'>
    <button type='button' disabled={!selectedCc} className='min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand disabled:opacity-50'
     onClick={()=>setOpened(selectedCc)}>Configure SKU allocation</button>
    <button type='button' className='min-h-11 rounded-xl border border-line px-4 text-sm'
     onClick={()=>setChooser(false)}>Cancel</button>
   </div>
  </section>}
  {loading&&<p role='status' className='text-sm text-muted'>Loading manufacturing cost-centre speeds…</p>}
  {error&&<p role='alert' className='rounded-lg border border-red-400 p-3 text-sm text-red-600'>{error}</p>}
  {!loading&&response&&<>
   <p className='text-sm font-medium'>{response.costCenters.length} configured cost centre(s) visible to you</p>
   {!response.costCenters.length&&<p className='rounded-lg bg-page p-3 text-sm text-muted'>
    No commissioned speed mappings were found in your authorized manufacturing cost centres.
    Configure this SKU from Production Planning &amp; MRP → Manufacturing Cost Centre &amp; SKUs.
   </p>}
   <div className='grid gap-3'>
    {response.costCenters.map(row=>{
     const p=row.rating.projection;
     const configured=typeof row.rating.ratingQuantity==='number'&&
      Number.isFinite(row.rating.ratingQuantity)&&row.rating.ratingQuantity>0;
     const count=row.countUnit?.symbol||row.rating.ratingUnitCode||'count';
     const period=row.periodUnit?.symbol||row.rating.periodUnitCode||'period';
     return <article key={row.costCenterId} className='space-y-3 rounded-xl border border-line bg-panel p-3'>
      <div className='space-y-1'>
       <h4 className='break-words text-sm font-semibold'>{row.costCenterName} · {row.costCenterCode}</h4>
       <p className='text-xs text-muted'>{row.legalEntityName} / {row.siteName}</p>
      </div>
      <div className='grid gap-2 sm:grid-cols-2'>
       <div className='rounded-lg bg-page p-3'>
        <p className='text-xs text-muted'>Commissioned manufacturing output speed</p>
        <p className='mt-1 text-lg font-semibold tabular-nums'>
         {configured?format(row.rating.ratingQuantity!)+' '+count+' '+
          (p?.source.ratingOutputName||row.rating.ratingOutputCode||'primary units')+' / '+period:'Not configured'}
        </p>
        <p className='text-xs text-muted'>Configured rated output, not actual line performance</p>
       </div>
       <div className='rounded-lg bg-page p-3'>
        <p className='text-xs text-muted'>Equivalent SKU physical primary units</p>
        <p className='mt-1 text-lg font-semibold tabular-nums'>
         {p&&p.physicalContainers.quantity!==null
          ?format(p.physicalContainers.quantity)+' / '+period:'Requires valid SKU conversion'}
        </p>
        <p className='text-xs text-muted'>
         {p?p.source.containerName+' · '+p.source.sizeName:
          'Container conversion could not be verified against current SKU master'}
        </p>
       </div>
      </div>
      {!p&&<p role='alert' className='rounded-lg border border-amber-500 p-2 text-xs text-amber-700'>
       Rating requires review: {row.rating.conversionIssue||'Physical container or SKU configuration needs correction.'}
      </p>}
      {p&&<details className='rounded-lg border border-line p-3'>
       <summary className='cursor-pointer text-sm font-semibold'>View container properties and linked output speeds</summary>
       <div className='mt-3 space-y-3'>
        <p className='text-xs text-muted'>
         Rated output: {p.source.ratingOutputName} · {p.source.primaryContainersPerRatedOutput} primary units per rated output.
         Primary container: {p.source.containerName} · {p.source.sizeName} ·
         category {p.source.containerCategory} / {p.source.containerSubcategory}
        </p>
        {Object.keys(p.source.containerAttributes).length>0&&
         <div className='grid gap-2 rounded-lg bg-page p-3 sm:grid-cols-2'>
          {Object.entries(p.source.containerAttributes).map(([key,value])=>
           <p key={key} className='text-xs'><span className='text-muted'>{key}: </span>{value}</p>)}
         </div>}
        <div className='grid gap-2 sm:grid-cols-2'>
         <RateOutput title='Production form' value={p.productionForm}/>
         <RateOutput title='Finished-product SKU' value={p.finalProduct}/>
         <RateOutput title='Commercial packaging' value={p.commercialPackaging}/>
         <RateOutput title='Transport & logistics' value={p.transportLogistics}/>
         {p.normalised.quantity!==null&&<RateOutput title='Normalized output' value={p.normalised}/>}
        </div>
        <p className='text-xs text-muted'>All outputs use the same {row.periodUnit?.name||'selected'} time period. Packaging ratios come from Product Configuration, not from separate cost-centre inputs.</p>
       </div>
      </details>}
      <div className='flex flex-wrap items-center justify-between gap-2'>
       <p className='text-xs text-muted'>Cost-centre revision {row.revision} · Updated {row.updatedAt?row.updatedAt.slice(0,10):'not recorded'}</p>
       <button type='button' className='min-h-10 rounded-lg border border-line px-3 text-sm font-semibold'
        onClick={()=>setOpened(row.costCenterId)}>Open shared SKU configuration</button>
      </div>
     </article>;
    })}
   </div>
  </>}
 </section>;
}
