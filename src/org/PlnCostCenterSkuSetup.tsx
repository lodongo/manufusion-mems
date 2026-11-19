import {useEffect,useId,useState,type ReactNode} from 'react';
import {Alert,Field,SelectField} from '../components/ui';
import {callBackend} from '../lib/backend';

type SkuComposition={containerId?:string;containerSizeId?:string;productionFormId?:string;
 packageId?:string;transportPackageId?:string};
type Output={id:string;name:string;siteId:string;uom:string;category:string;status:string;
 skuComponents:SkuComposition;revision:number};
type Container={id:string;name:string;categoryCode:string;categoryName:string;
 subcategoryCode:string;subcategoryName:string;containerAttributes:Record<string,string>;metadataCode:string;
 ratingCountUnitCode:string};
type Size={id:string;name:string;quantity:number;uom:string;uomSymbol:string};
type Measure={code:string;name:string;symbol:string;multiplier:number;categoryCode:string};
type Rating={skuId:string;containerId:string;containerSizeId:string;
 containerCategoryCode:string;containerSubcategoryCode:string;ratingQuantity:number;
 ratingUnitCode:string;periodUnitCode:string};
type Quantity={quantity:number|null;unit:string;name:string;reason?:string};
type Projection={source:{containerName:string;containerCategory:string;containerSubcategory:string;
 containerAttributes:Record<string,string>;sizeName:string;countUnit:string;timeUnit:string;
 ratedUnits:number;physicalContainers:number};
 physicalContainers:Quantity;productionForm:Quantity;finalProduct:Quantity;
 commercialPackaging:Quantity;transportLogistics:Quantity;normalised:Quantity};
type Line=Rating&{projection?:Projection|null;conversionIssue?:string;skuName?:string};
type Mapping={costCenterId:string;revision:number;skuCapacities:Line[];updatedAt:string};
type Details={location:{costCenterId:string;siteId:string;legalEntityId:string;name:string;code:string};
 outputs:Output[];containers:Container[];sizes:Size[];units:{count:Measure[];time:Measure[]};
 mapping:Mapping|null;canConfigure:boolean};
function Action({children,onClick,disabled=false,secondary=false}:{children:ReactNode;
 onClick:()=>void;disabled?:boolean;secondary?:boolean}){
 return <button type='button' disabled={disabled} onClick={onClick}
  className={'min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-50 '+
   (secondary?'border border-line text-ink':'bg-brand text-onbrand')}>{children}</button>;
}
function Picker({label,value,onChange,options,disabled=false}:{label:string;value:string;onChange:(value:string)=>void;
 options:Array<[string,string]>;disabled?:boolean}){
 const id=useId();
 return <SelectField id={id} label={label} disabled={disabled} value={value}
  onChange={e=>onChange(e.target.value)}>
  {options.map(([id,name])=><option key={id} value={id}>{name}</option>)}
 </SelectField>;
}
const pretty=(n:number)=>new Intl.NumberFormat(undefined,{maximumFractionDigits:3}).format(n);
const valid=(x:Line)=>!!(x.skuId&&x.containerId&&x.containerSizeId&&
 x.containerCategoryCode&&x.containerSubcategoryCode&&
 Number.isFinite(x.ratingQuantity)&&x.ratingQuantity>0&&x.ratingUnitCode&&x.periodUnitCode);
function projectedRow(title:string,value:Quantity){
 return <div className='rounded-lg border border-line bg-page p-3'>
  <p className='text-xs text-muted'>{title}</p>
  <p className='mt-1 text-sm font-semibold'>{value.quantity===null?'Not configured':pretty(value.quantity)+' '+value.unit}</p>
  <p className='mt-1 text-xs text-muted'>{value.name}{value.reason?' · '+value.reason:''}</p>
 </div>;
}

/** The Organization Design gear and PLN hierarchy share one physical-container-based rating editor. */
export default function PlnCostCenterSkuSetup({costCenterId,onBack}:{costCenterId:string;onBack?:()=>void}){
 const [data,setData]=useState<Details|null>(null),[lines,setLines]=useState<Line[]>([]);
 const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [showValidation,setShowValidation]=useState(false);
 const [openSku,setOpenSku]=useState('');
 const load=async()=>{
  setLoading(true);setError('');
  try{
   const response=await callBackend<Details>('/api/org/pln/cost-center/get',{costCenterId});
   setData(response);
   // Older ratings were entered per SKU stock unit; never reinterpret those as
   // primary containers. Require an explicit new physical-container rate.
   setLines((response.mapping?.skuCapacities??[]).map(x=>{
    if(Number.isFinite(x.ratingQuantity))return {...x};
    const output=response.outputs.find(o=>o.id===x.skuId);
    const container=response.containers.find(c=>c.id===output?.skuComponents?.containerId);
    return {...x,skuId:x.skuId||'',containerId:container?.id||'',
     containerSizeId:output?.skuComponents?.containerSizeId||'',
     containerCategoryCode:container?.categoryCode||'',
     containerSubcategoryCode:container?.subcategoryCode||'',
     ratingQuantity:0,ratingUnitCode:container?.ratingCountUnitCode||response.units.count.find(u=>u.multiplier===1)?.code||'',
     periodUnitCode:response.units.time.find(u=>u.name==='Hour')?.code||'',
     projection:null,conversionIssue:'Previous stock-unit/hour rating needs physical-container reconfiguration.'};
   }));
   setRevision(response.mapping?.revision??0);
   setOpenSku('');
  }catch(e){setError(e instanceof Error?e.message:'Could not load manufacturing cost-centre ratings.');}
  finally{setLoading(false);}
 };
 useEffect(()=>{void load();},[costCenterId]);
 const outputs=data?.outputs??[],already=new Set(lines.map(x=>x.skuId).filter(Boolean));
 const available=outputs.filter(o=>!already.has(o.id));
 const lineIssues=(line:Line,i:number):string[]=>{
  const result:string[]=[];
  const sku=outputs.find(o=>o.id===line.skuId);
  const container=data?.containers.find(c=>c.id===line.containerId);
  if(!line.skuId)result.push('Choose a manufactured SKU.');
  else if(!sku)result.push('This SKU is not available at the selected site. Refresh the available SKUs.');
  else if(lines.some((x,j)=>j!==i&&x.skuId===line.skuId))
   result.push('This SKU is already mapped to this manufacturing cost centre.');
  if(sku){
   if(!sku.skuComponents.containerId||!sku.skuComponents.containerSizeId)
    result.push('Configure the SKU physical container and its size in Materials & Products first.');
   if(!container)result.push('Choose an adopted physical container for this SKU.');
   else{
    if(container.id!==sku.skuComponents.containerId)
     result.push('Physical container does not match the SKU in Product Configuration.');
    if(container.categoryCode!==line.containerCategoryCode||
       container.subcategoryCode!==line.containerSubcategoryCode)
     result.push('Physical container category or subcategory does not match its adopted type.');
   }
   if(!line.containerSizeId||line.containerSizeId!==sku.skuComponents.containerSizeId)
    result.push('Select the physical container size configured on this SKU.');
  }
  if(!Number.isFinite(line.ratingQuantity)||line.ratingQuantity<=0||line.ratingQuantity>1e12)
   result.push('Enter a commissioned rating greater than zero and no more than 1,000,000,000,000.');
  if(!data?.units.count.some(u=>u.code===line.ratingUnitCode))
   result.push('Choose a published Count unit for the physical containers.');
  if(!data?.units.time.some(u=>u.code===line.periodUnitCode))
   result.push('Choose a published Time unit for the rating period.');
  return result;
 };
 const issues=lines.flatMap((line,i)=>lineIssues(line,i).map(message=>({index:i,message})));
 const canSave=lines.length>0&&issues.length===0;
 const update=(i:number,changes:Partial<Line>)=>{
  setError('');setNotice('');
  setLines(all=>all.map((x,j)=>j===i?{...x,...changes,projection:null,conversionIssue:''}:x));
 };
 const addSku=()=>{
  setNotice('');
  if(lines.length>=100){setError('A cost centre supports a maximum of 100 mapped SKUs.');return;}
  const next=available[0];
  if(!next){
   setError('All eligible manufactured SKUs at this site are already mapped. Create another finished or intermediate SKU in Materials & Products, then refresh this editor.');
   return;
  }
  setLines(all=>[...all,newSku(next.id)]);
  setOpenSku(next.id);
  setError('');setShowValidation(false);
 };
 const newSku=(skuId:string):Line=>{
  const output=outputs.find(x=>x.id===skuId);
  const chosen=data?.containers.find(c=>c.id===output?.skuComponents?.containerId);
  return {skuId,containerId:chosen?.id||'',
   containerSizeId:output?.skuComponents?.containerSizeId||'',
   containerCategoryCode:chosen?.categoryCode||'',
   containerSubcategoryCode:chosen?.subcategoryCode||'',ratingQuantity:0,
   ratingUnitCode:chosen?.ratingCountUnitCode||data?.units.count.find(x=>x.multiplier===1)?.code||'',
   periodUnitCode:data?.units.time.find(x=>x.name==='Hour')?.code||'',
   projection:null};
 };
 const preview=async(i:number)=>{
  const line=lines[i];if(!line||!valid(line))return;
  setBusy(true);setError('');setNotice('');
  try{
   const res=await callBackend<{line:Line}>('/api/org/pln/cost-center/preview',{
    costCenterId,rating:line
   });
   setLines(all=>all.map((x,j)=>j===i?{...x,projection:res.line.projection,conversionIssue:''}:x));
  }catch(e){setError(e instanceof Error?e.message:'Unable to calculate converted ratings.');}
  finally{setBusy(false);}
 };
 const save=async()=>{
  setShowValidation(true);
  if(!lines.length){setError('Add at least one manufactured SKU before saving.');return;}
  if(!canSave){
   const first=issues[0]?.index;
   if(first!==undefined)setOpenSku(lines[first].skuId||'draft-'+first);
   setError('Cannot save yet. Correct the SKU-specific issues shown below, then save again.');
   return;
  }
  setError('');setNotice('');setBusy(true);
  try{
   const result=await callBackend<{mapping:Mapping}>('/api/org/pln/cost-center/save',{
    costCenterId,skuCapacities:lines.map(({skuId,containerId,containerSizeId,
     containerCategoryCode,containerSubcategoryCode,ratingQuantity,ratingUnitCode,periodUnitCode})=>({
     skuId,containerId,containerSizeId,containerCategoryCode,containerSubcategoryCode,
     ratingQuantity,ratingUnitCode,periodUnitCode,
    })),expectedRevision:revision});
   // Use the committed revision and projections returned by the server. A second
   // GET must not turn a successful write into an apparent failure or wipe edits.
   setRevision(result.mapping.revision);
   setData(current=>current?{...current,mapping:result.mapping}:current);
   setLines(result.mapping.skuCapacities);
   setOpenSku('');
   setShowValidation(false);
   setNotice('Saved successfully: '+result.mapping.skuCapacities.length+
    ' SKU(s), revision '+result.mapping.revision+'. You can add another SKU without losing these ratings.');
  }catch(e){setError(e instanceof Error?e.message:'Could not save commissioned throughput.');}
  finally{setBusy(false);}
 };
 const clear=async()=>{
  if(!data?.mapping?.skuCapacities.length)return;
  setError('');setNotice('');setBusy(true);
  try{
   await callBackend('/api/org/pln/cost-center/clear',{costCenterId,expectedRevision:revision});
   await load();setNotice('Cost-centre rating mappings cleared. Physical Container and SKU masters are unchanged.');
  }catch(e){setError(e instanceof Error?e.message:'Could not clear rating mappings.');}
  finally{setBusy(false);}
 };
 return <div className='space-y-4'>
  <div className='flex flex-wrap items-start justify-between gap-2'>
   <div><h2 className='text-lg font-semibold'>Production Planning & MRP</h2>
    <p className='text-sm text-muted'>Manufacturing cost centre · physical-container commissioned rating</p></div>
   {onBack&&<Action secondary onClick={onBack}>Back</Action>}
  </div>
  {error&&<Alert tone='error'>{error}</Alert>}
  {notice&&<p role='status' className='rounded-xl border border-line p-3 text-sm'>{notice}</p>}
  {loading?<p className='text-sm text-muted'>Loading configured physical containers…</p>:
   data&&<section className='space-y-4 rounded-2xl border border-line bg-panel p-4'>
    <div className='rounded-xl bg-page p-3'>
     <p className='text-xs text-muted'>Manufacturing cost centre</p>
     <p className='text-sm font-semibold'>{data.location.name} · {data.location.code}</p>
     <p className='mt-1 text-xs text-muted'>Revision {revision}. Physical containers, sizes and packaging ratios come from Product Configuration and the selected SKU.</p>
    </div>
    <div className='flex flex-wrap items-start justify-between gap-2'>
     <div><h3 className='font-semibold'>Mapped manufactured SKUs</h3>
      <p className='mt-1 text-xs text-muted'>Rate the selected physical container, then view the equivalent production-form, finished-product, commercial and logistics outputs for the same time interval.</p>
     </div>
     {data.canConfigure&&<div className='flex flex-wrap gap-2'>
      <Action secondary disabled={busy||lines.length>=100} onClick={addSku}>Add SKU</Action>
      <Action secondary disabled={busy} onClick={()=>{
       if(lines.length&&!window.confirm('Refresh available SKUs? Unsaved changes will be discarded.'))return;
       void load();
      }}>Refresh SKUs</Action>
     </div>}
    </div>
    {!outputs.length&&<p role='status' className='text-sm text-muted'>No finished or intermediate output SKU is configured at this site. Create one in Materials & Products, then use Refresh SKUs.</p>}
    {!available.length&&lines.length>0&&<p className='text-xs text-muted'>All currently available site SKUs are mapped. To add more, configure additional manufactured SKUs in Materials & Products, then refresh this list. Your saved ratings remain intact.</p>}
    {lines.map((line,i)=>{
     const selected=outputs.find(x=>x.id===line.skuId);
     const categoryContainers=data.containers.filter(c=>c.categoryCode===line.containerCategoryCode);
     const currentContainer=data.containers.find(c=>c.id===line.containerId);
     const size=data.sizes.find(x=>x.id===line.containerSizeId);
     const expectedContainer=selected?.skuComponents?.containerId||'';
     const expectedSize=selected?.skuComponents?.containerSizeId||'';
     const matching=!!selected&&line.containerId===expectedContainer&&line.containerSizeId===expectedSize;
     const rowKey=line.skuId||'draft-'+i;
     const expanded=openSku===rowKey;
     const rowFaults=showValidation?lineIssues(line,i).length:0;
     const countUnit=data.units.count.find(u=>u.code===line.ratingUnitCode);
     const periodUnit=data.units.time.find(u=>u.code===line.periodUnitCode);
     return <div key={i} className='space-y-3 rounded-xl border border-line p-3'>
      <div className='flex items-start justify-between gap-2'>
       <button type='button' aria-expanded={expanded} aria-controls={'sku-rating-card-'+i}
        className='flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-lg p-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'
        onClick={()=>setOpenSku(current=>current===rowKey?'':rowKey)}>
        <span aria-hidden='true' className='mt-0.5 shrink-0 text-brand'>{expanded?'▾':'▸'}</span>
        <span className='min-w-0'>
         <span className='block break-words text-sm font-semibold'>SKU {i+1} · {selected?.name||line.skuName||line.skuId||'Choose SKU'}</span>
         <span className='mt-1 block text-xs text-muted'>
          {currentContainer?.name||'Physical container not set'}{size?' · '+size.name:''}
         </span>
         <span className='mt-1 block text-xs font-medium text-ink'>
          {line.ratingQuantity>0?pretty(line.ratingQuantity)+' '+(countUnit?.symbol||line.ratingUnitCode)+
            ' / '+(periodUnit?.symbol||line.periodUnitCode):'Commissioned speed not yet configured'}
         </span>
         {rowFaults>0&&<span className='mt-1 block text-xs text-red-500'>{rowFaults} item(s) need correction</span>}
        </span>
       </button>
       {data.canConfigure&&<Action secondary disabled={busy} onClick={()=>{
        setLines(rows=>rows.filter((_,j)=>j!==i));
        if(expanded)setOpenSku('');
        setNotice('');
       }}>Remove</Action>}
      </div>
      {expanded&&<div id={'sku-rating-card-'+i} className='space-y-4 border-t border-line pt-3'>
      <Picker label='Manufactured SKU / product' value={line.skuId} disabled={!data.canConfigure||busy}
       options={[['','Choose SKU'],...outputs.filter(x=>x.id===line.skuId||!already.has(x.id))
        .map(x=>[x.id,x.name+' · '+x.category] as [string,string])]}
       onChange={skuId=>{update(i,newSku(skuId));setOpenSku(skuId||'draft-'+i);}}/>
      {selected&&<div className='space-y-3 rounded-xl border border-line bg-page p-3'>
       <p className='text-sm font-semibold'>Physical container properties</p>
       <Picker label='Physical container category' value={line.containerCategoryCode} disabled={!data.canConfigure||busy}
        options={[['','Select category'],...[...new Map(data.containers.map(c=>[c.categoryCode,c.categoryName])).entries()]
         .map(([code,name])=>[code,name] as [string,string])]}
        onChange={categoryCode=>update(i,{containerCategoryCode:categoryCode,
         containerSubcategoryCode:'',containerId:'',containerSizeId:'',projection:null})}/>
       <Picker label='Physical container subcategory / type' value={line.containerId} disabled={!data.canConfigure||busy||!line.containerCategoryCode}
        options={[['','Select container type'],...categoryContainers.map(c=>[c.id,c.subcategoryName+' · '+c.name] as [string,string])]}
        onChange={containerId=>{
         const c=data.containers.find(x=>x.id===containerId);
         update(i,{containerId,containerCategoryCode:c?.categoryCode||'',
          containerSubcategoryCode:c?.subcategoryCode||'',containerSizeId:expectedSize,
          ratingUnitCode:c?.ratingCountUnitCode||line.ratingUnitCode});
        }}/>
       <Picker label='Configured physical container size' value={line.containerSizeId}
        disabled={!data.canConfigure||busy||!currentContainer}
        options={[['','Select container size'],...data.sizes.map(x=>[x.id,
         x.name+' · '+x.quantity+' '+x.uomSymbol] as [string,string])]}
        onChange={containerSizeId=>update(i,{containerSizeId})}/>
       {currentContainer&&<div className='rounded-lg border border-line p-3'>
        <p className='text-xs text-muted'>Adopted type: {currentContainer.subcategoryName} · {currentContainer.categoryName}</p>
        <div className='mt-2 grid gap-2 sm:grid-cols-2'>
         {Object.entries(currentContainer.containerAttributes).map(([name,value])=>
          <p key={name} className='text-xs'><span className='text-muted'>{name}: </span>{value}</p>)}
         {size&&<p className='text-xs'><span className='text-muted'>Size: </span>{size.quantity} {size.uomSymbol}</p>}
        </div>
       </div>}
       {!matching&&<p role='alert' className='text-xs text-red-500'>
        The selected container or size does not match the SKU. Update the SKU in Product Configuration or select its configured physical container; conversions cannot be guessed.
       </p>}
       {!expectedContainer&&<p role='alert' className='text-xs text-red-500'>
        This SKU has no physical container configured. Configure its physical container, size and production form in Materials & Products before rating it.
       </p>}
      </div>}
      {selected&&<div className='space-y-3 rounded-xl border border-line p-3'>
       <h4 className='font-semibold'>Commissioned rating parameters</h4>
       <div className='grid gap-3 sm:grid-cols-2'>
        <div><p className='mb-1 text-xs text-muted'>Rating unit category: Count</p>
         <Picker label='Count unit / physical containers' value={line.ratingUnitCode}
          disabled={!data.canConfigure||busy}
          options={[['','Choose count unit'],...data.units.count.map(u=>[u.code,u.name+' ('+u.symbol+')'] as [string,string])]}
          onChange={ratingUnitCode=>update(i,{ratingUnitCode})}/></div>
        <div><p className='mb-1 text-xs text-muted'>Period category: Time</p>
         <Picker label='Time period (used for every result)' value={line.periodUnitCode}
          disabled={!data.canConfigure||busy}
          options={[['','Choose period'],...data.units.time.map(u=>[u.code,u.name+' ('+u.symbol+')'] as [string,string])]}
          onChange={periodUnitCode=>update(i,{periodUnitCode})}/></div>
       </div>
       <Field id={`physical-rating-${costCenterId}-${i}`}
        label='Commissioned physical container quantity per selected time period' type='number'
        min='0.000001' step='any' inputMode='decimal' disabled={!data.canConfigure||busy}
        value={line.ratingQuantity||''} onChange={e=>update(i,{ratingQuantity:Number(e.target.value)})}/>
       <p className='text-xs text-muted'>The count unit may be Each, Dozen, etc. One Dozen means 12 physical containers. All derived ratings use exactly the time period selected above, without changing the denominator.</p>
       {line.conversionIssue&&<p className='text-xs text-red-500'>{line.conversionIssue}</p>}
       <div className='flex flex-wrap gap-2'>
        <Action secondary disabled={busy||!valid(line)||!matching}
         onClick={()=>void preview(i)}>Calculate linked ratings</Action>
       </div>
      </div>}
      {showValidation&&lineIssues(line,i).length>0&&<div role='alert' className='rounded-lg border border-red-400 p-3 text-xs text-red-600'>
       <p className='font-semibold'>SKU {i+1} — correct these issues:</p>
       <ul className='mt-2 list-disc space-y-1 pl-4'>{lineIssues(line,i).map((message,j)=><li key={j}>{message}</li>)}</ul>
      </div>}
      {line.projection&&<div className='space-y-2 rounded-xl border border-line p-3'>
       <h4 className='font-semibold'>Resolved ratings · same time period</h4>
       <p className='text-xs text-muted'>Basis: {pretty(line.ratingQuantity)} {data.units.count.find(u=>u.code===line.ratingUnitCode)?.name||'units'} per {data.units.time.find(u=>u.code===line.periodUnitCode)?.name||'period'}. Calculated from the selected SKU’s configured conversion relationships.</p>
       <div className='grid gap-2 sm:grid-cols-2'>
        {projectedRow('Physical containers',line.projection.physicalContainers)}
        {projectedRow('Final product form',line.projection.productionForm)}
        {projectedRow('Finished-product SKU',line.projection.finalProduct)}
        {projectedRow('Commercial packaging',line.projection.commercialPackaging)}
        {projectedRow('Transport & logistics',line.projection.transportLogistics)}
        {line.projection.normalised.quantity!==null&&projectedRow('Normalized output',line.projection.normalised)}
       </div>
      </div>}
      </div>}
     </div>;
    })}
    {!lines.length&&<p className='text-sm text-muted'>No SKUs mapped. Add an SKU to configure its physical-container rating.</p>}
    {data.canConfigure&&<div className='sticky bottom-0 z-10 space-y-2 rounded-xl border border-line bg-panel p-3 shadow-sm'>
     {showValidation&&issues.length>0&&<div role='alert' className='text-xs text-red-600'>
      {issues.length} issue(s) prevent saving. Review the relevant SKU cards above.
     </div>}
     {error&&<p role='alert' className='text-xs text-red-600'>{error}</p>}
     {notice&&<p role='status' className='text-xs font-semibold'>{notice}</p>}
     <div className='flex flex-wrap items-center justify-between gap-2'>
      <span className='text-xs text-muted'>{lines.length} SKU(s) in this configuration · revision {revision}</span>
      <div className='flex flex-wrap gap-2'>
       {data.mapping?.skuCapacities?.length?<Action secondary disabled={busy} onClick={()=>void clear()}>Clear SKU mappings</Action>:null}
       <Action disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Save commissioned ratings'}</Action>
       <Action secondary disabled={busy||lines.length>=100} onClick={addSku}>Add another SKU</Action>
      </div>
     </div>
    </div>}
    {!data.canConfigure&&<p className='text-xs text-muted'>You have read access; edits require Planning or Organization Design permission.</p>}
    <p className='text-xs text-muted'>This is a commissioned capacity reference, not a production schedule or material posting. Where a packaging or transport relationship is absent, the corresponding rating remains unavailable.</p>
   </section>}
 </div>;
}
