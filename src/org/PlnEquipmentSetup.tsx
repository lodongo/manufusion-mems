import {useEffect,useId,useMemo,useState,type ReactNode} from 'react';
import {Alert,Field,SelectField} from '../components/ui';
import {callBackend} from '../lib/backend';
import {hasPerm} from '../types';

type Node={id:string;parentId:string;level:string;code:string;name:string;costType:string;status:string};
type Equipment={id:string;parentId:string;code:string;name:string;assetTag:string;assetName:string;eligible:boolean};
type Output={id:string;name:string;siteId:string;uom:string;category:string;status:string};
type Line={skuId:string;commissionedRatePerHour:number;rateUom:string;skuName?:string;skuStatus?:string};
type Mapping={costCenterId:string;unitId:string;assetTag:string;siteId:string;legalEntityId:string;
 skuCapacities:Line[];revision:number;updatedAt:string};
type Hierarchy={legalEntities:Node[];sites:Node[];departments:Node[];costCenters:Node[];
 equipment:Equipment[];outputs:Output[];mappings:Mapping[]};

function Selection({title,value,options,onChange,disabled=false}:{
 title:string;value:string;options:Array<[string,string]>;onChange:(v:string)=>void;disabled?:boolean;
}){
 const id=useId();
 return <SelectField id={id} label={title} value={value} disabled={disabled}
  onChange={e=>onChange(e.target.value)}>
  {options.map(([code,name])=><option key={code} value={code}>{name}</option>)}
 </SelectField>;
}
function Action({children,onClick,disabled=false,outline=false}:{
 children:ReactNode;onClick:()=>void;disabled?:boolean;outline?:boolean;
}){
 return <button type='button' disabled={disabled} onClick={onClick}
  className={'min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-50 '+
    (outline?'border border-line text-ink':'bg-brand text-onbrand')}>{children}</button>;
}

export default function PlnEquipmentSetup({permissions}:{permissions:string[]}){
 const [hierarchy,setHierarchy]=useState<Hierarchy|null>(null);
 const [legalEntity,setLegalEntity]=useState('');
 const [site,setSite]=useState('');
 const [department,setDepartment]=useState('');
 const [costCenter,setCostCenter]=useState('');
 const [unitId,setUnitId]=useState('');
 const [lines,setLines]=useState<Line[]>([]);
 const [revision,setRevision]=useState(0);
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const canConfigure=hasPerm(permissions,'PLN.configure');
 const reload=async()=>{
  setLoading(true);setError('');
  try{
   const result=await callBackend<Hierarchy>('/api/org/pln/equipment/hierarchy');
   setHierarchy(result);
  }catch(e){setError(e instanceof Error?e.message:'Could not load manufacturing equipment.');}
  finally{setLoading(false);}
 };
 useEffect(()=>{void reload();},[]);
 const entities=hierarchy?.legalEntities??[];
 const sites=(hierarchy?.sites??[]).filter(x=>x.parentId===legalEntity);
 const depts=(hierarchy?.departments??[]).filter(x=>x.parentId===site&&
   (hierarchy?.costCenters??[]).some(cc=>cc.parentId===x.id));
 const centers=(hierarchy?.costCenters??[]).filter(x=>x.parentId===department);
 const units=(hierarchy?.equipment??[]).filter(x=>x.parentId===costCenter);
 const available=(hierarchy?.outputs??[]).filter(o=>!o.siteId||o.siteId===site);
 const selectedUnit=units.find(x=>x.id===unitId);
 const existing=(hierarchy?.mappings??[]).find(x=>x.costCenterId===costCenter);
 const alreadyUsed=new Set(lines.map(x=>x.skuId));
 const eligibleOutputs=available.filter(o=>!alreadyUsed.has(o.id));
 const valid=!!costCenter&&!!unitId&&!!selectedUnit?.eligible&&lines.length>0&&
   lines.every(x=>x.skuId&&Number.isFinite(x.commissionedRatePerHour)&&x.commissionedRatePerHour>0);
 const chooseCenter=(id:string)=>{
  setCostCenter(id);setError('');setMessage('');
  const mapping=(hierarchy?.mappings??[]).find(x=>x.costCenterId===id);
  setUnitId(mapping?.unitId||'');setLines((mapping?.skuCapacities??[]).map(x=>({...x})));
  setRevision(mapping?.revision??0);
 };
 const persist=async()=>{
  if(!valid){setError('Select one linked active asset and enter a positive commissioned throughput for every chosen SKU.');return;}
  setBusy(true);setError('');setMessage('');
  try{
   const response=await callBackend<{mapping:Mapping}>('/api/org/pln/equipment/save',{
    costCenterId:costCenter,unitId,skuCapacities:lines,expectedRevision:revision,
   });
   setRevision(response.mapping.revision);
   setMessage('Planning equipment and commissioned SKU throughputs saved for this cost centre.');
   await reload();
  }catch(e){setError(e instanceof Error?e.message:'Could not save equipment mapping.');}
  finally{setBusy(false);}
 };
 const disable=async()=>{
  if(!existing?.unitId)return;
  setBusy(true);setError('');setMessage('');
  try{
   await callBackend('/api/org/pln/equipment/clear',{costCenterId:costCenter,expectedRevision:revision});
   setUnitId('');setLines([]);setRevision(revision+1);
   setMessage('The equipment planning assignment has been disabled. Asset linkage remains unchanged.');
   await reload();
  }catch(e){setError(e instanceof Error?e.message:'Could not disable equipment mapping.');}
  finally{setBusy(false);}
 };
 const mappedCount=useMemo(()=>(hierarchy?.mappings??[]).filter(x=>!!x.unitId).length,[hierarchy]);
 return <div className='space-y-4'>
  <div className='flex flex-wrap items-start justify-between gap-2'>
   <div><h2 className='text-lg font-semibold'>Equipment & SKU capacity</h2>
    <p className='text-sm text-muted'>Configure manufacturing equipment from the Asset Register, with commissioned throughput for each product it can produce.</p></div>
   <Action outline disabled={busy||loading} onClick={()=>void reload()}>Refresh</Action>
  </div>
  {error&&<Alert tone='error'>{error}</Alert>}
  {message&&<Alert tone='success'>{message}</Alert>}
  {loading?<p className='text-sm text-muted'>Loading organization equipment…</p>:<>
   <section className='rounded-2xl border border-line bg-panel p-4 space-y-3'>
    <h3 className='font-semibold'>1. Select manufacturing location</h3>
    <div className='grid gap-3 sm:grid-cols-2'>
     <Selection title='Legal entity' value={legalEntity}
      options={[['','Choose legal entity'],...entities.map(x=>[x.id,x.name+' · '+x.code] as [string,string])]}
      onChange={v=>{setLegalEntity(v);setSite('');setDepartment('');chooseCenter('');}}/>
     <Selection title='Site' value={site} disabled={!legalEntity}
      options={[['','Choose site'],...sites.map(x=>[x.id,x.name+' · '+x.code] as [string,string])]}
      onChange={v=>{setSite(v);setDepartment('');chooseCenter('');}}/>
     <div className='rounded-xl border border-line bg-page p-3'>
      <p className='text-sm text-soft'>Activity</p><p className='mt-2 font-semibold'>Manufacturing</p>
      <p className='mt-1 text-xs text-muted'>Only cost centres whose adopted Finance type is Manufacturing are included.</p>
     </div>
     <Selection title='Manufacturing department' value={department} disabled={!site}
      options={[['','Choose department'],...depts.map(x=>[x.id,x.name+' · '+x.code] as [string,string])]}
      onChange={v=>{setDepartment(v);chooseCenter('');}}/>
     <Selection title='Manufacturing cost centre' value={costCenter} disabled={!department}
      options={[['','Choose cost centre'],...centers.map(x=>[x.id,x.name+' · '+x.code+' · Manufacturing'] as [string,string])]}
      onChange={chooseCenter}/>
    </div>
    {!entities.length&&<p className='text-sm text-muted'>There are no accessible manufacturing cost centres. Check Organization Design, your site permissions and the Finance cost-centre type configuration.</p>}
    {site&&!depts.length&&<p className='text-sm text-muted'>No manufacturing cost centres are configured under this site.</p>}
   </section>
   {costCenter&&<section className='rounded-2xl border border-line bg-panel p-4 space-y-4'>
    <h3 className='font-semibold'>2. Designate one planning equipment unit</h3>
    <p className='text-xs text-muted'>Only one equipment unit can be marked for Production Planning & MRP in each manufacturing cost centre. Its Asset Register link must be active. This selection never replaces the Asset Register's equipment mapping.</p>
    <Selection title='Equipment unit · Asset Register' value={unitId}
     options={[['','Select equipment unit'],...units.map(x=>[x.id,
      x.code+' · '+x.name+(x.eligible?' · '+x.assetTag:' · asset not approved/linked')] as [string,string])]}
     onChange={v=>{setUnitId(v);setLines([]);}}
     disabled={!canConfigure||busy}/>
    {selectedUnit&&<div className='rounded-xl bg-page p-3 text-sm'>
     <p className='font-medium'>{selectedUnit.name}</p>
     <p className='text-xs text-muted'>Asset: {selectedUnit.assetTag||'Not linked'} · {selectedUnit.assetName||'No active approved asset'}</p>
     <p className='mt-1 text-xs'>{selectedUnit.eligible?'Eligible for planning setup':'Link and approve this equipment in Asset Management first.'}</p>
    </div>}
    {!units.length&&<p className='text-sm text-muted'>No equipment units exist for this cost centre. Create an Equipment Unit under Organization Design and link it to an approved asset.</p>}
    {existing?.unitId&&<p className='text-xs text-muted'>Currently marked: {units.find(x=>x.id===existing.unitId)?.name||existing.unitId} · Revision {existing.revision}. Saving another selection replaces this cost centre’s single designation.</p>}
    {selectedUnit?.eligible&&<div className='space-y-3'>
     <div className='flex flex-wrap items-center justify-between gap-2'>
      <h3 className='font-semibold'>3. SKUs and commissioned throughput</h3>
      <Action outline disabled={!canConfigure||busy||!eligibleOutputs.length||lines.length>=100}
       onClick={()=>setLines(x=>[...x,{skuId:'',commissionedRatePerHour:0,rateUom:''}])}>Add SKU</Action>
     </div>
     <p className='text-xs text-muted'>For each SKU, enter the equipment’s commissioned rate per hour in that SKU’s material-master unit. Rates are SKU-specific; do not use the same general line speed for different products unless actually commissioned at that rate.</p>
     {lines.map((line,i)=><div key={i} className='rounded-xl border border-line p-3 space-y-2'>
      <div className='flex items-center justify-between gap-2'>
       <p className='text-sm font-semibold'>SKU {i+1}</p>
       <Action outline disabled={!canConfigure||busy} onClick={()=>setLines(x=>x.filter((_,j)=>j!==i))}>Remove</Action>
      </div>
      <Selection title='Manufactured SKU' value={line.skuId}
       options={[['','Select SKU'],...available.filter(o=>!alreadyUsed.has(o.id)||o.id===line.skuId)
        .map(o=>[o.id,o.name+' · '+o.category] as [string,string])]}
       onChange={v=>{const sku=available.find(o=>o.id===v);
        setLines(x=>x.map((l,j)=>j===i?{skuId:v,rateUom:sku?.uom||'',commissionedRatePerHour:0}:l));}}
       disabled={!canConfigure||busy}/>
      <div className='grid grid-cols-2 gap-2 items-end'>
       <Field id={'commissioned-rate-'+i} label='Commissioned output per hour'
        type='number' inputMode='decimal' min='0.000001' step='any'
        value={line.commissionedRatePerHour||''} disabled={!canConfigure||busy}
        onChange={e=>setLines(x=>x.map((l,j)=>j===i?{...l,commissionedRatePerHour:Number(e.target.value)}:l))}/>
       <div className='rounded-xl bg-page border border-line p-3'>
        <p className='text-xs text-muted'>Throughput unit</p>
        <p className='mt-1 font-semibold'>{line.rateUom?line.rateUom+'/hour':'Select SKU'}</p>
       </div>
      </div>
      {line.skuId&&available.find(o=>o.id===line.skuId)?.status!=='active'&&
       <p className='text-xs text-muted'>SKU is not active; throughput can be configured, but the material still needs its release before execution.</p>}
     </div>)}
     {!lines.length&&<p className='text-sm text-muted'>No SKU capacities defined. Choose Add SKU, then record its commissioned output rate.</p>}
     <div className='flex flex-wrap justify-end gap-2'>
      {existing?.unitId&&<Action outline disabled={!canConfigure||busy}
       onClick={()=>void disable()}>Remove planning designation</Action>}
      <Action disabled={!canConfigure||busy||!valid} onClick={()=>void persist()}>
       Save equipment & SKU capacities
      </Action>
     </div>
    </div>}
   </section>}
   <section className='rounded-2xl border border-line bg-panel p-4 space-y-2'>
    <h3 className='font-semibold'>Planning linkage</h3>
    <p className='text-sm text-muted'>{mappedCount} manufacturing cost centre{mappedCount===1?'':'s'} currently have one marked equipment unit. Asset Management displays the chosen equipment’s SKUs and commissioned rates as read-only information.</p>
    <p className='text-xs text-muted'>This configuration is a capacity master, not a production schedule, work order, inventory movement or financial posting.</p>
   </section>
  </>}
 </div>;
}
