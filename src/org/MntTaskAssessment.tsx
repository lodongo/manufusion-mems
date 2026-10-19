import {useEffect,useState,type ChangeEvent} from 'react';
import {callBackend} from '../lib/backend';
import {Alert} from '../components/ui';
import {Button,Card,useLoad} from '../admin/kit';
import {compressPhoto} from './mntShared';

type Spare={id:string;source:'warehouse'|'catalog'|'description';materialId:string;warehouseId:string;catalogCode:string;description:string;qty:number;uom:string;unitCost:number|null;photoPath?:string;specifications?:string;attributes?:Record<string,string>};
type Service={id:string;categoryCode:string;subcategoryCode:string;classCode:string;catalogCode:string;description:string;attributes:Record<string,string>;proposedVendorIds:string[];scope?:string;deliverables?:string;quantity?:number;qualifications?:string;expectedCost?:number|null;acceptanceCriteria?:string};
type Risk={hazard:string;impact:string;controls:string;before:string;after:string;permit:string;energyCode?:string;beforeRatings?:Record<string,number>;afterRatings?:Record<string,number>;exposedPersonnel?:string;responsiblePerson?:string;precautions?:string};
type RiskMatrix={version:number;formula:'multiply'|'add';factors:Array<{code:string;label:string;max:number;enabled:boolean}>;bands:Array<{label:string;min:number;max:number;color:string}>};
type SafetyOption={code:string;label:string;category:string;subcategory:string};
type Options={vendors:Array<{id:string;name:string}>;riskMatrix:RiskMatrix;hazardousEnergy:SafetyOption[];safetyPermits:SafetyOption[];photos:Record<string,string>;skills:Array<{code:string;label:string;category:string}>;equipmentId:string;equipmentOptions:Array<{id:string;name:string;code:string}>};
export type TaskAssessment={id:string;description:string;disciplineCode:string;resourceTypeCode:string;persons:number;hours:number;rate:number;tools:string;spares:Spare[];services:Service[];risk:Risk[];templateStatus:'pending_validation'|'existing';skillCodes?:string[];title?:string;equipmentId?:string;assemblyId?:string;instructions?:string;skills?:string;priority?:string;dependencies?:string[];isolation?:string;completionCriteria?:string;documentation?:string;safetyEquipment?:string;internalRoles?:string[];externalResource?:{type:string;persons:number;notes:string};lotoRequired?:boolean;liveEquipment?:boolean;energySourceCodes?:string[];permitCodes?:string[]};
const id=()=>Math.random().toString(36).slice(2,10);
const newRisk=():Risk=>({hazard:'',impact:'',controls:'',before:'',after:'',permit:'',beforeRatings:{},afterRatings:{}});
const seed=():TaskAssessment=>({id:'task_'+id(),description:'',disciplineCode:'',resourceTypeCode:'',persons:1,hours:1,rate:0,tools:'',spares:[],services:[],risk:[newRisk()],templateStatus:'pending_validation',internalRoles:[],externalResource:undefined,lotoRequired:false,liveEquipment:false,energySourceCodes:[],permitCodes:[]});
const input='mt-1 w-full rounded-xl border border-slate-600 bg-slate-900 p-3 text-base text-white';
const label='block text-sm text-slate-300';
const roles=[['operator','Operator'],['technician','Technician'],['specialist','Specialist'],['engineer','Engineer']] as const;
const externals=[['OEM','OEM'],['OCM','OCM'],['verified_supplier','Verified external supplier'],['other','Other external resource']] as const;
const newSpare=():Spare=>({id:'sp_'+id(),source:'description',materialId:'',warehouseId:'',catalogCode:'',description:'',qty:1,uom:'EA',unitCost:null});
export function WarehouseSparePicker({onSelect}:{onSelect:(item:{materialId:string;warehouseId:string;materialNumber:string;name:string;uom:string;available:number|null;stockVerified:boolean;warehouseName:string})=>void}){
 const {data:warehouseData,error:warehouseError}=useLoad(()=>callBackend<{warehouses:Array<{id:string;name:string}>}>('/api/org/mnt/warehouse-spares/search',{mode:'warehouses'}));
 const [warehouse,setWarehouse]=useState(''),[query,setQuery]=useState(''),[items,setItems]=useState<Array<{materialId:string;warehouseId:string;materialNumber:string;name:string;uom:string;available:number|null;stockVerified:boolean;warehouseName:string}>>([]),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!warehouse||query.trim().length<2){setItems([]);return;}
 let alive=true;const timer=setTimeout(async()=>{setBusy(true);
 try{const result=await callBackend<{items:typeof items}>('/api/org/mnt/warehouse-spares/search',{warehouseId:warehouse,q:query.trim()});if(alive)setItems(result.items);}
 catch{if(alive)setItems([]);}finally{if(alive)setBusy(false);}},300);
 return()=>{alive=false;clearTimeout(timer);};},[warehouse,query]);
 return <div className='space-y-2 rounded-xl border border-slate-700 p-3'>
  <p className='text-sm font-semibold text-white'>1. Choose warehouse, then a material</p>
  <label className={label}>Warehouse<select data-native-select='true' className={input} value={warehouse} onChange={e=>{setWarehouse(e.target.value);setQuery('');setItems([]);}}>
   <option value=''>Select warehouse first</option>{warehouseData?.warehouses?.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
  </select></label>
  {warehouseError&&<Alert tone='error'>{warehouseError}</Alert>}
  {warehouse&&<label className={label}>Search the selected warehouse<input type='search' className={input} value={query} placeholder='Material number or name' onChange={e=>setQuery(e.target.value)}/></label>}
  {busy&&<p className='text-xs text-slate-400'>Checking available stock…</p>}
  <div className='max-h-52 space-y-1 overflow-y-auto'>{items.map(x=><button key={x.materialId+':'+x.warehouseId} type='button'
   className='w-full rounded-lg border border-slate-600 p-3 text-left text-sm text-white' onClick={()=>{onSelect(x);setQuery('');setItems([]);}}>
   <span className='text-xs text-emerald-300'>{x.materialNumber}</span> · {x.name}
   <span className='block text-xs text-slate-400'>{x.stockVerified?'Available '+x.available+' '+x.uom:'Quantity not verified'} · {x.warehouseName}</span>
  </button>)}</div>
 </div>;
}
export function CatalogPicker({kind,onSelect}:{kind:'materials'|'services';onSelect:(item:{code:string;name:string;family:string})=>void}){
 const [q,setQ]=useState(''),[rows,setRows]=useState<Array<{code:string;name:string;family:string}>>([]),[loading,setLoading]=useState(false);
 useEffect(()=>{if(q.trim().length<2){setRows([]);return;}let active=true;
 const t=setTimeout(async()=>{setLoading(true);try{const result=await callBackend<{items:typeof rows}>('/api/org/mnt/catalog-search',{kind,q:q.trim()});if(active)setRows(result.items||[]);}catch{if(active)setRows([]);}finally{if(active)setLoading(false);}},320);
 return()=>{active=false;clearTimeout(t);};},[q,kind]);
 return <div className='space-y-2 rounded-xl border border-slate-700 p-3'><label className={label}>Search MEMS technical catalogue
  <input type='search' className={input} value={q} onChange={e=>setQ(e.target.value)} placeholder='Search name or code'/>
 </label>{loading&&<p className='text-sm text-slate-400'>Searching…</p>}
 <div className='max-h-52 space-y-1 overflow-y-auto'>{rows.map(x=><button type='button' key={x.code} className='w-full rounded-lg border border-slate-600 p-3 text-left text-sm text-white' onClick={()=>{onSelect(x);setQ('');setRows([]);}}>
  {x.name}<span className='block text-xs text-slate-400'>{x.code} · {x.family}</span></button>)}</div></div>;
}
const categories=(opts:SafetyOption[])=>[...new Set(opts.map(x=>x.category||'Other'))];
function ReviewAssessment({tasks,options}:{tasks:TaskAssessment[];options?:Options|null}){
 return <Card className='space-y-3'><h3 className='font-semibold text-white'>Work assessment — read-only review</h3>
  <p className='text-sm text-slate-400'>Review the submitted details. Approval or return does not alter the assessment.</p>
  {!tasks.length&&<p className='text-sm text-amber-300'>No tasks assessed.</p>}
  {tasks.map((t,i)=><section key={t.id} className='space-y-2 rounded-xl border border-slate-700 p-3 text-sm'>
   <h4 className='font-semibold text-white'>Task {i+1}: {t.title||t.description}</h4>
   <p className='text-slate-300'>{t.description}</p>
   <p>Internal: {(t.internalRoles||[]).map(c=>roles.find(x=>x[0]===c)?.[1]||c).join(', ')||'None'} · {t.persons} people · {t.hours} hours</p>
   {t.externalResource?.type&&<p>External: {externals.find(x=>x[0]===t.externalResource?.type)?.[1]||t.externalResource.type} · {t.externalResource.persons} people · {t.externalResource.notes}</p>}
   <p>Special tools: {t.tools||'None declared'}</p>
   <p className='font-medium text-white'>Spares ({t.spares?.length||0})</p>
   {t.spares?.map(sp=><div key={sp.id} className='rounded-lg bg-slate-800 p-2'>
    {sp.description} · {sp.qty} {sp.uom} · {sp.source}{sp.warehouseId?' · warehouse '+sp.warehouseId:''}
    {sp.photoPath&&<div>{options?.photos?.[sp.photoPath]?<a href={options.photos[sp.photoPath]} target='_blank' rel='noreferrer' className='text-emerald-300 underline'>View spare photo</a>:<span>Photo attached</span>}</div>}
   </div>)}
   <p>LOTO required: {t.lotoRequired?'Yes':'No'} · Working live: {t.liveEquipment?'Yes':'No'}</p>
   {!!t.energySourceCodes?.length&&<p>Hazardous energy: {t.energySourceCodes.map(code=>options?.hazardousEnergy.find(x=>x.code===code)?.label||code).join(', ')}</p>}
   {!!t.permitCodes?.length&&<p>Permits: {t.permitCodes.map(code=>options?.safetyPermits.find(x=>x.code===code)?.label||code).join(', ')}</p>}
   <p className='font-medium text-white'>Safety and risk assessment</p>
   {t.risk?.map((risk,j)=><div key={j} className='rounded-lg bg-slate-800 p-2'>
    <p>Hazard: {risk.hazard} · Impact: {risk.impact}</p><p>Controls: {risk.controls}</p>
    <p>Initial: {risk.before||'Pending'} · Residual: {risk.after||'Pending'}</p>
   </div>)}
  </section>)}
 </Card>;
}
export default function MntTaskAssessment({code,initial,onSaved,editable,recordType='wr',onCancel}:{code:string;initial:TaskAssessment[];onSaved:()=>void;editable:boolean;recordType?:'wr'|'wo';onCancel?:()=>void}){
 const [tasks,setTasks]=useState<TaskAssessment[]>(initial.length?initial:[seed()]);
 const options=useLoad(()=>callBackend<Options>('/api/org/mnt/assessment/options',{code}),[code]);
 const library=useLoad(()=>callBackend<{items:Array<{id:string;version:number;task:TaskAssessment}>}>('/api/org/mnt/tasks/library',{code}),[code]);
 const [current,setCurrent]=useState(0),[step,setStep]=useState(0),[saving,setSaving]=useState(false),[uploading,setUploading]=useState(''),[message,setMessage]=useState(''),[photoUrls,setPhotoUrls]=useState<Record<string,string>>({});
 const [showStock,setShowStock]=useState(false),[showCatalog,setShowCatalog]=useState(false),[energySearch,setEnergySearch]=useState(''),[permitSearch,setPermitSearch]=useState('');
 const task=tasks[current]||seed();
 const sections=['Task','Spares','People & tools','Safety'];
 const patch=(next:Partial<TaskAssessment>)=>setTasks(old=>old.map((t,i)=>i===current?{...t,...next}:t));
 const patchSpare=(i:number,next:Partial<Spare>)=>patch({spares:task.spares.map((sp,j)=>i===j?{...sp,...next}:sp)});
 const addSpare=(sp:Spare)=>patch({spares:[...task.spares,sp]});
 const permitFor=(pattern:RegExp)=>options.data?.safetyPermits.find(x=>pattern.test(x.label))?.code;
 const newEnergyRisk=(code:string):Risk=>({ ...newRisk(),energyCode:code,hazard:code==='LIVE_EQUIPMENT'?'Working on live equipment':options.data?.hazardousEnergy.find(x=>x.code===code)?.label||code,controls:code==='LIVE_EQUIPMENT'?'Confirm authorized live-work procedure, guarding, exclusion zone and emergency stop readiness.':'Identify all isolation points; isolate, lock, tag and prove zero energy before work.'});
 const toggleEnergy=(code:string,checked:boolean)=>{
   const codes=checked?[...(task.energySourceCodes||[]),code]:(task.energySourceCodes||[]).filter(x=>x!==code);
   const risk=checked?[...task.risk.filter(x=>x.hazard||x.impact||x.controls),newEnergyRisk(code)]:task.risk.filter(x=>x.energyCode!==code);
   patch({energySourceCodes:codes,risk:risk.length?risk:[newRisk()]});
 };
 const toggleSafety=(key:'lotoRequired'|'liveEquipment',yes:boolean)=>{
   const permit=key==='lotoRequired'?permitFor(/loto|lock.?out|isolation/i):permitFor(/live/i);
   const previous=task.permitCodes||[];
   const permitCodes=yes&&permit?[...new Set([...previous,permit])]:!yes&&permit?previous.filter(x=>x!==permit):previous;
   const risk=key==='liveEquipment'?(yes?[...task.risk.filter(x=>x.hazard||x.impact||x.controls),newEnergyRisk('LIVE_EQUIPMENT')]:task.risk.filter(x=>x.energyCode!=='LIVE_EQUIPMENT')):yes?task.risk:task.risk.filter(x=>!(task.energySourceCodes||[]).includes(x.energyCode||''));
   patch({[key]:yes,permitCodes,risk:risk.length?risk:[newRisk()],...(key==='lotoRequired'&&!yes?{energySourceCodes:[]}: {})});
 };
 const uploadPhoto=async(index:number,event:ChangeEvent<HTMLInputElement>)=>{
  const file=event.target.files?.[0];if(!file)return;setUploading(task.spares[index].id);setMessage('');
  try{const data=await compressPhoto(file);const res=await callBackend<{token:string;url:string}>('/api/org/mnt/assessment/photo',{code,data});
    patchSpare(index,{photoPath:res.token});setPhotoUrls(old=>({...old,[res.token]:res.url}));}
  catch(e){setMessage(e instanceof Error?e.message:'Photo upload failed.');}
  finally{setUploading('');event.target.value='';}
 };
 const save=async()=>{
  setSaving(true);setMessage('');try{
   await callBackend(recordType==='wo'?'/api/org/mnt/wo/action':'/api/org/mnt/wr/action',{code,action:'save_task_assessment',tasks});
   setMessage('Assessment saved. Independent review is required before conversion.');onSaved();
  }catch(e){setMessage(e instanceof Error?e.message:'Assessment could not be saved.');}finally{setSaving(false);}
 };
 if(!editable)return <ReviewAssessment tasks={initial} options={options.data??undefined}/>;
 return <Card className='space-y-4'>
   {onCancel&&<button type='button' className='text-sm text-emerald-300 underline' onClick={onCancel}>← Back</button>}
   <div><h3 className='text-lg font-semibold text-white'>Work assessment</h3>
    <p className='text-sm text-slate-400'>Add tasks and specify what each task needs. The reviewer sees a read-only copy after you save.</p>
    <p className='mt-2 text-xs text-emerald-300'>Task {current+1} of {tasks.length}</p></div>
   <div className='flex gap-2 overflow-x-auto pb-1'>{tasks.map((t,i)=><button type='button' key={t.id} onClick={()=>{setCurrent(i);setStep(0);}} className={'shrink-0 rounded-full px-3 py-2 text-sm '+(current===i?'bg-emerald-800 text-white':'border border-slate-700 text-slate-300')}>{i+1}. {t.title||'Task'}</button>)}</div>
   <div className='grid grid-cols-4 gap-1'>{sections.map((name,i)=><button type='button' key={name} onClick={()=>setStep(i)} className={'rounded-lg p-2 text-xs '+(step===i?'bg-emerald-800 text-white':'bg-slate-800 text-slate-300')}>{name}</button>)}</div>
   {step===0&&<div className='space-y-3'>
     {library.data?.items.length?<details className='rounded-xl border border-slate-700 p-3'><summary className='text-sm text-slate-200'>Reuse an approved assembly task</summary>
      {library.data.items.map(x=><button type='button' key={x.id} className='mt-2 block w-full rounded-lg border border-slate-700 p-2 text-left text-sm' onClick={()=>{if(tasks.some(t=>t.id===x.id)){setMessage('Task already selected.');return;}setTasks(old=>[...old,{...x.task,id:x.id,templateStatus:'existing'}]);setCurrent(tasks.length);}}>{x.task.description}</button>)}
     </details>:null}
     <label className={label}>Task name<input className={input} value={task.title||''} onChange={e=>patch({title:e.target.value})}/></label>
     <label className={label}>Describe the work<textarea className={input} rows={3} value={task.description} onChange={e=>patch({description:e.target.value})} placeholder='What is required?'/></label>
     <label className={label}>Assembly<select data-native-select='true' className={input} value={task.assemblyId||''} onChange={e=>patch({assemblyId:e.target.value,equipmentId:options.data?.equipmentId})}><option value=''>Use the request assembly</option>{options.data?.equipmentOptions.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    </div>}
   {step===1&&<div className='space-y-3'>
     <p className='font-semibold text-white'>Spares for this task</p>
     {task.spares.map((sp,i)=><div key={sp.id} className='space-y-2 rounded-xl border border-slate-700 p-3'>
       <p className='text-xs text-slate-400'>{i+1}. {sp.source==='warehouse'?'From inventory':sp.source==='catalog'?'From technical catalogue':'Describe or photograph'}</p>
       <label className={label}>Spare description<input className={input} value={sp.description} placeholder='Describe the part, or attach a photo' onChange={e=>patchSpare(i,{description:e.target.value})}/></label>
       {sp.source==='description'&&<label className={label}>Spare photo (optional instead of description)<input type='file' accept='image/jpeg,image/png' className={input} onChange={e=>void uploadPhoto(i,e)}/></label>}
       {uploading===sp.id&&<p className='text-xs text-slate-400'>Uploading photo…</p>}
       {sp.photoPath&&<a className='text-sm text-emerald-300 underline' href={photoUrls[sp.photoPath]||options.data?.photos?.[sp.photoPath]||'#'} target='_blank' rel='noreferrer'>View attached photo</a>}
       {sp.source==='warehouse'&&<p className='text-xs text-slate-400'>Warehouse {sp.warehouseId} · material {sp.materialId}</p>}
       {sp.source==='catalog'&&<p className='text-xs text-slate-400'>Catalogue code {sp.catalogCode}</p>}
       <div className='grid grid-cols-2 gap-2'>
        <label className={label}>Quantity<input type='number' min='0.001' step='any' className={input} value={sp.qty} onChange={e=>patchSpare(i,{qty:Number(e.target.value)})}/></label>
        <label className={label}>Unit<input className={input} value={sp.uom} onChange={e=>patchSpare(i,{uom:e.target.value})}/></label>
       </div>
       <button type='button' className='text-sm text-red-300 underline' onClick={()=>patch({spares:task.spares.filter((_,j)=>j!==i)})}>Remove spare</button>
     </div>)}
     <div className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
       <Button variant='secondary' onClick={()=>{setShowStock(v=>!v);setShowCatalog(false);}}>+ Choose inventory</Button>
       <Button variant='secondary' onClick={()=>{setShowCatalog(v=>!v);setShowStock(false);}}>+ Choose catalogue</Button>
       <Button variant='secondary' onClick={()=>addSpare(newSpare())}>+ Describe / photo</Button>
     </div>
     {showStock&&<WarehouseSparePicker onSelect={x=>{addSpare({...newSpare(),source:'warehouse',materialId:x.materialId,warehouseId:x.warehouseId,description:x.name,uom:x.uom});setShowStock(false);}}/>}
     {showCatalog&&<CatalogPicker kind='materials' onSelect={x=>{addSpare({...newSpare(),source:'catalog',catalogCode:x.code,description:x.name});setShowCatalog(false);}}/>}
    </div>}
   {step===2&&<div className='space-y-3'>
     <p className='font-semibold text-white'>People and special tools for this task</p>
     <fieldset className='space-y-2'><legend className={label}>Internal resources required</legend>
      <div className='grid grid-cols-2 gap-2'>{roles.map(([code,name])=><label key={code} className='flex items-center gap-2 rounded-lg border border-slate-700 p-3 text-sm'><input type='checkbox' checked={(task.internalRoles||[]).includes(code)} onChange={e=>patch({internalRoles:e.target.checked?[...(task.internalRoles||[]),code]:(task.internalRoles||[]).filter(x=>x!==code)})}/>{name}</label>)}</div>
     </fieldset>
     <label className={label}>Number of internal people<input type='number' min={0} max={50} className={input} value={task.persons} onChange={e=>patch({persons:Number(e.target.value)})}/></label>
     <label className={label}>External resources required<select data-native-select='true' className={input} value={task.externalResource?.type||''} onChange={e=>patch({externalResource:e.target.value?{type:e.target.value,persons:task.externalResource?.persons||1,notes:task.externalResource?.notes||''}:undefined})}>
       <option value=''>None</option>{externals.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label>
     {task.externalResource?.type&&<div className='space-y-2 rounded-xl border border-slate-700 p-3'>
       <label className={label}>How many external people?<input type='number' min={1} max={50} className={input} value={task.externalResource.persons} onChange={e=>patch({externalResource:{...task.externalResource!,persons:Number(e.target.value)}})}/></label>
       <label className={label}>External scope / qualification<textarea className={input} rows={2} value={task.externalResource.notes} onChange={e=>patch({externalResource:{...task.externalResource!,notes:e.target.value}})}/></label>
       <p className='text-xs text-slate-400'>The planner will secure the external resource through the applicable supplier and procurement process.</p>
     </div>}
     <label className={label}>Time required (hours)<input type='number' min={0.25} step={0.25} className={input} value={task.hours} onChange={e=>patch({hours:Number(e.target.value)})}/></label>
     <label className={label}>Special tools required<textarea className={input} rows={2} value={task.tools} onChange={e=>patch({tools:e.target.value})} placeholder='Tools, lifting gear, test instruments, calibration equipment…'/></label>
    </div>}
   {step===3&&<div className='space-y-3'>
     <p className='font-semibold text-white'>Safety requirements for this task</p>
     <label className='flex items-center gap-3 rounded-xl border border-slate-700 p-3 text-sm'><input type='checkbox' checked={!!task.lotoRequired} onChange={e=>toggleSafety('lotoRequired',e.target.checked)}/>Lock-out/tag-out (LOTO) required</label>
     {task.lotoRequired&&<div className='space-y-2 rounded-xl border border-amber-700 p-3'>
       <p className='font-semibold text-white'>Identify applicable hazardous energy sources (SAF master)</p>
       <input type='search' className={input} placeholder='Filter SAF energy sources (optional)' value={energySearch} onChange={e=>setEnergySearch(e.target.value)}/>
       {categories(options.data?.hazardousEnergy||[]).map(cat=><div key={cat}>
        <p className='mt-3 text-sm font-semibold text-emerald-300'>{cat}</p>
        <div className='grid gap-1 sm:grid-cols-2'>{options.data?.hazardousEnergy.filter(x=>(x.category||'Other')===cat&&(x.label.toLowerCase().includes(energySearch.toLowerCase())||x.code.toLowerCase().includes(energySearch.toLowerCase()))).map(x=><label key={x.code} className='flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-sm'><input type='checkbox' checked={(task.energySourceCodes||[]).includes(x.code)} onChange={e=>toggleEnergy(x.code,e.target.checked)}/>{x.label}</label>)}</div>
       </div>)}
       {options.data?.hazardousEnergy.length===0&&<Alert tone='error'>No hazardous energy sources configured in the SAF master. Contact MEMS Admin.</Alert>}
      </div>}
     <label className='flex items-center gap-3 rounded-xl border border-slate-700 p-3 text-sm'><input type='checkbox' checked={!!task.liveEquipment} onChange={e=>toggleSafety('liveEquipment',e.target.checked)}/>Work on live/running equipment required</label>
     {task.liveEquipment&&<p className='rounded-lg border border-amber-700 p-3 text-sm text-amber-300'>Live work requires an independent hazard assessment and SAF-authorized live-work permit. Confirm controls before execution.</p>}
     <details className='rounded-xl border border-slate-700 p-3'><summary className='font-semibold text-white'>Required permits from SAF ({task.permitCodes?.length||0} selected)</summary>
       <input type='search' className={input} placeholder='Filter permits' value={permitSearch} onChange={e=>setPermitSearch(e.target.value)}/>
       <div className='mt-2 max-h-64 space-y-1 overflow-y-auto'>{options.data?.safetyPermits.filter(x=>x.label.toLowerCase().includes(permitSearch.toLowerCase())||x.category.toLowerCase().includes(permitSearch.toLowerCase())).map(x=>{
        const locked=(task.lotoRequired&&x.code===permitFor(/loto|lock.?out|isolation/i))||(task.liveEquipment&&x.code===permitFor(/live/i));
        return <label key={x.code} className='flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-sm'>
         <input type='checkbox' checked={(task.permitCodes||[]).includes(x.code)} disabled={locked} onChange={e=>patch({permitCodes:e.target.checked?[...(task.permitCodes||[]),x.code]:(task.permitCodes||[]).filter(code=>code!==x.code)})}/>{x.label}{locked?' (required)':''}</label>;
       })}</div>
     </details>
     <p className='font-semibold text-white'>Task hazards and mitigation (SAF risk matrix)</p>
     <p className='text-xs text-slate-400'>Hazards from selected energy sources and live work are added automatically. Complete impact, controls and risk ratings before saving.</p>
     {task.risk.map((risk,i)=><div key={i} className='space-y-2 rounded-xl border border-slate-700 p-3'>
       <label className={label}>Hazard<input className={input} value={risk.hazard} readOnly={!!risk.energyCode} onChange={e=>patch({risk:task.risk.map((x,j)=>i===j?{...x,hazard:e.target.value}:x)})}/></label>
       <label className={label}>Potential impact<input className={input} value={risk.impact} onChange={e=>patch({risk:task.risk.map((x,j)=>i===j?{...x,impact:e.target.value}:x)})}/></label>
       <label className={label}>Mitigations<textarea rows={2} className={input} value={risk.controls} onChange={e=>patch({risk:task.risk.map((x,j)=>i===j?{...x,controls:e.target.value}:x)})}/></label>
       {(['beforeRatings','afterRatings'] as const).map(kind=><div key={kind}>
        <p className='text-xs font-semibold text-white'>{kind==='beforeRatings'?'Before mitigation':'After mitigation'}</p>
        <div className='grid grid-cols-2 gap-2'>{options.data?.riskMatrix?.factors.filter(x=>x.enabled).map(f=><label key={f.code} className={label}>{f.label}
         <select data-native-select='true' className={input} value={risk[kind]?.[f.code]||''} onChange={e=>patch({risk:task.risk.map((x,j)=>i===j?{...x,[kind]:{...(x[kind]||{}),[f.code]:Number(e.target.value)||0}}:x)})}>
          <option value=''>Choose</option>{Array.from({length:f.max},(_,n)=><option key={n+1} value={n+1}>{n+1}</option>)}</select></label>)}</div></div>)}
       {!risk.energyCode&&task.risk.length>1&&<button type='button' className='text-xs text-red-300 underline' onClick={()=>patch({risk:task.risk.filter((_,j)=>j!==i)})}>Remove hazard</button>}
      </div>)}
     <Button variant='secondary' onClick={()=>patch({risk:[...task.risk,newRisk()]})}>+ Add activity hazard</Button>
    </div>}
   <div className='flex flex-wrap gap-2'>
     <Button variant='secondary' disabled={step===0} onClick={()=>setStep(i=>Math.max(0,i-1))}>← Previous section</Button>
     <Button variant='secondary' disabled={step===3} onClick={()=>setStep(i=>Math.min(3,i+1))}>Next section →</Button>
   </div>
   <div className='flex flex-wrap gap-2'>
    <Button variant='secondary' disabled={current===0} onClick={()=>{setCurrent(i=>Math.max(0,i-1));setStep(0);}}>← Previous task</Button>
    <Button variant='secondary' onClick={()=>{if(current<tasks.length-1){setCurrent(i=>i+1);}else{setTasks(old=>[...old,seed()]);setCurrent(tasks.length);}setStep(0);}}>{current===tasks.length-1?'+ Add task':'Next task →'}</Button>
    {tasks.length>1&&<Button variant='secondary' onClick={()=>{setTasks(old=>old.filter((_,i)=>i!==current));setCurrent(Math.max(0,current-1));setStep(0);}}>Remove task</Button>}
   </div>
   <Button busy={saving} disabled={saving||!!uploading} onClick={save}>Save assessment for independent review</Button>
   {message&&<Alert tone='info'>{message}</Alert>}
  </Card>;
}
