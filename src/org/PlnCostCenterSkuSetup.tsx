import {useEffect,useId,useState,type ReactNode} from 'react';
import {Alert,Field,SelectField} from '../components/ui';
import {callBackend} from '../lib/backend';
type Output={id:string;name:string;siteId:string;uom:string;category:string;status:string};
type Line={skuId:string;commissionedRatePerHour:number;rateUom:string;skuName?:string};
type Mapping={costCenterId:string;revision:number;skuCapacities:Line[];updatedAt:string};
type Details={location:{costCenterId:string;siteId:string;legalEntityId:string;name:string;code:string};
 outputs:Output[];mapping:Mapping|null;canConfigure:boolean};
function Action({children,onClick,disabled=false,secondary=false}:{children:ReactNode;
 onClick:()=>void;disabled?:boolean;secondary?:boolean}){
 return <button type='button' disabled={disabled} onClick={onClick}
  className={'min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-50 '+
   (secondary?'border border-line text-ink':'bg-brand text-onbrand')}>{children}</button>;
}
function Picker({label,value,onChange,options,disabled=false}:{label:string;value:string;onChange:(value:string)=>void;
 options:Array<[string,string]>;disabled?:boolean}){
 const id=useId();return <SelectField id={id} label={label} disabled={disabled} value={value}
  onChange={e=>onChange(e.target.value)}>
  {options.map(([id,name])=><option key={id} value={id}>{name}</option>)}
 </SelectField>;
}
/**
 * One shared editor in Organization Design's manufacturing cost centre gear
 * and in Production Planning & MRP. This never selects/configures equipment.
 */
export default function PlnCostCenterSkuSetup({costCenterId,onBack}:{costCenterId:string;onBack?:()=>void}){
 const [data,setData]=useState<Details|null>(null),[lines,setLines]=useState<Line[]>([]);
 const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{
  setLoading(true);setError('');
  try{
   const response=await callBackend<Details>('/api/org/pln/cost-center/get',{costCenterId});
   setData(response);setLines((response.mapping?.skuCapacities??[]).map(x=>({...x})));
   setRevision(response.mapping?.revision??0);
  }catch(e){setError(e instanceof Error?e.message:'Could not load manufacturing cost-centre SKU setup.');}
  finally{setLoading(false);}
 };
 useEffect(()=>{void load();},[costCenterId]);
 const outputs=data?.outputs??[],configured=new Set(lines.map(x=>x.skuId));
 const valid=lines.length>0&&lines.every(x=>x.skuId&&Number.isFinite(x.commissionedRatePerHour)&&
  x.commissionedRatePerHour>0&&!!outputs.find(s=>s.id===x.skuId&&s.uom===x.rateUom));
 const save=async()=>{
  if(!valid){setError('Select each SKU and enter its positive commissioned throughput.');return;}
  setError('');setNotice('');setBusy(true);
  try{
   await callBackend('/api/org/pln/cost-center/save',{costCenterId,skuCapacities:lines,expectedRevision:revision});
   await load();setNotice('SKUs and their commissioned throughputs are synchronized with this manufacturing cost centre.');
  }catch(e){setError(e instanceof Error?e.message:'SKU mapping could not be saved.');}
  finally{setBusy(false);}
 };
 const clear=async()=>{
  if(!data?.mapping?.skuCapacities.length)return;
  setError('');setNotice('');setBusy(true);
  try{
   await callBackend('/api/org/pln/cost-center/clear',{costCenterId,expectedRevision:revision});
   await load();setNotice('SKU mappings cleared for this cost centre; material records are unchanged.');
  }catch(e){setError(e instanceof Error?e.message:'Could not clear cost-centre SKU mapping.');}
  finally{setBusy(false);}
 };
 return <div className='space-y-4'>
  <div className='flex flex-wrap items-start justify-between gap-2'>
   <div><h2 className='text-lg font-semibold'>Production Planning & MRP</h2>
    <p className='text-sm text-muted'>Manufacturing cost centre · SKU configuration</p></div>
   {onBack&&<Action secondary onClick={onBack}>Back</Action>}
  </div>
  {error&&<Alert tone='error'>{error}</Alert>}
  {notice&&<p role='status' className='rounded-xl border border-line p-3 text-sm'>{notice}</p>}
  {loading?<p className='text-sm text-muted'>Loading SKU configuration…</p>:
   data&&<section className='space-y-4 rounded-2xl border border-line bg-panel p-4'>
    <div className='rounded-xl bg-page p-3'>
     <p className='text-xs text-muted'>Manufacturing cost centre</p>
     <p className='text-sm font-semibold'>{data.location.name} · {data.location.code}</p>
     <p className='mt-1 text-xs text-muted'>Configuration revision {revision}. SKUs come from Materials & Products; they are never created in this screen.</p>
    </div>
    <div className='flex flex-wrap items-start justify-between gap-2'>
     <div><h3 className='font-semibold'>Mapped manufactured SKUs</h3>
      <p className='text-xs text-muted'>Configure commissioned output per hour separately for every SKU assigned to this cost centre.</p></div>
     {data.canConfigure&&<Action secondary disabled={busy||lines.length>=100||outputs.length<=configured.size}
       onClick={()=>setLines(x=>[...x,{skuId:'',commissionedRatePerHour:0,rateUom:''}])}>Add SKU</Action>}
    </div>
    {!outputs.length&&<p className='text-sm text-muted'>No finished or intermediate manufactured SKUs are available for this site. Create them in Materials & Products first.</p>}
    {lines.map((line,i)=><div key={i} className='space-y-3 rounded-xl border border-line p-3'>
     <div className='flex items-center justify-between gap-2'>
      <h4 className='text-sm font-semibold'>SKU {i+1}</h4>
      {data.canConfigure&&<Action secondary disabled={busy}
        onClick={()=>setLines(rows=>rows.filter((_,j)=>j!==i))}>Remove</Action>}
     </div>
     <Picker label='Output SKU / product' value={line.skuId}
      disabled={!data.canConfigure||busy}
      options={[['','Choose SKU'],...outputs.filter(x=>x.id===line.skuId||!configured.has(x.id))
       .map(x=>[x.id,x.name+' · '+x.category] as [string,string])]}
      onChange={skuId=>{
       const selected=outputs.find(x=>x.id===skuId);
       setLines(rows=>rows.map((row,j)=>j===i?{skuId,rateUom:selected?.uom||'',commissionedRatePerHour:0}:row));
      }}/>
     <div className='grid grid-cols-2 gap-2 items-end'>
      <Field id={`capacity-cc-${costCenterId}-${i}`} label='Commissioned throughput / hour'
       type='number' min='0.000001' step='any' inputMode='decimal'
       disabled={!data.canConfigure||busy} value={line.commissionedRatePerHour||''}
       onChange={e=>setLines(rows=>rows.map((row,j)=>j===i?
        {...row,commissionedRatePerHour:Number(e.target.value)}:row))}/>
      <div className='rounded-xl border border-line bg-page px-3 py-2'>
       <p className='text-xs text-muted'>Output unit</p>
       <p className='mt-1 text-sm font-semibold'>{line.rateUom?line.rateUom+'/hour':'Select SKU'}</p>
      </div>
     </div>
    </div>)}
    {!lines.length&&<p className='text-sm text-muted'>No SKUs mapped to this manufacturing cost centre yet.</p>}
    {data.canConfigure&&<div className='flex flex-wrap justify-end gap-2'>
     {data.mapping?.skuCapacities?.length?<Action secondary disabled={busy} onClick={()=>void clear()}>Clear SKU mappings</Action>:null}
     <Action disabled={!valid||busy} onClick={()=>void save()}>Save SKU configuration</Action>
    </div>}
    {!data.canConfigure&&<p className='text-xs text-muted'>You have read access. Configuration requires authorized Planning or Organization Design permissions.</p>}
    <p className='text-xs text-muted'>Commissioned throughput is the cost-centre capacity for each SKU, before efficiency or scheduling adjustments. This does not modify assets or equipment and does not post inventory or production transactions.</p>
   </section>}
 </div>;
}
