import {useEffect,useState} from 'react';
import {callBackend} from '../lib/backend';
import {Alert} from '../components/ui';
import {Button,Card,useLoad} from '../admin/kit';
import {Attachments,ServiceEditor,SpareFinder,SOURCE_LABEL,freeTextProblems,newService,serviceProblems,type ServiceHierarchy} from './mntSourcing';

type Spare={id:string;source:'warehouse'|'material'|'catalog'|'description';materialId:string;warehouseId:string;catalogCode:string;description:string;qty:number;uom:string;unitCost:number|null;photoPath?:string;specifications?:string;attributes?:Record<string,string>;function?:string;categoryCode?:string;subcategoryCode?:string;requiredDate?:string;attachments?:string[];searchReceiptId?:string;noMatchConfirmed?:boolean;noMatchReason?:string};
type Service={id:string;categoryCode:string;subcategoryCode:string;classCode:string;catalogCode:string;description:string;attributes:Record<string,string>;proposedVendorIds:string[];scope?:string;deliverables?:string;quantity?:number;qualifications?:string;expectedCost?:number|null;acceptanceCriteria?:string;instructions?:string;certifications?:string;personnel?:number;durationHours?:number;executionDate?:string;supplierCategory?:string;attachments?:string[]};
type Risk={hazard:string;impact:string;controls:string;before:string;after:string;permit:string;energyCode?:string;beforeRatings?:Record<string,number>;afterRatings?:Record<string,number>;exposedPersonnel?:string;responsiblePerson?:string;precautions?:string};
type RiskMatrix={version:number;formula:'multiply'|'add';factors:Array<{code:string;label:string;max:number;enabled:boolean}>;bands:Array<{label:string;min:number;max:number;color:string}>};
type SafetyOption={code:string;label:string;category:string;subcategory:string};
type Options={serviceHierarchy?:ServiceHierarchy;vendors:Array<{id:string;name:string}>;riskMatrix:RiskMatrix;hazardousEnergy:SafetyOption[];safetyPermits:SafetyOption[];photos:Record<string,string>;skills:Array<{code:string;label:string;category:string}>;equipmentId:string;equipmentOptions:Array<{id:string;name:string;code:string}>};
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
    {sp.description} · {sp.qty} {sp.uom} · {SOURCE_LABEL[sp.source]||sp.source}{sp.warehouseId?' · warehouse '+sp.warehouseId:''}
    {sp.source==='description'&&<span className='block text-xs text-slate-400'>Function: {sp.function||'—'} · {sp.specifications||'No specification'}{sp.requiredDate?' · by '+sp.requiredDate:''}</span>}
    {sp.photoPath&&<div>{options?.photos?.[sp.photoPath]?<a href={options.photos[sp.photoPath]} target='_blank' rel='noreferrer' className='text-emerald-300 underline'>View spare photo</a>:<span>Photo attached</span>}</div>}
   </div>)}
   <p className='font-medium text-white'>External services ({t.services?.length||0})</p>
   {t.services?.map(sv=><div key={sv.id} className='rounded-lg bg-slate-800 p-2'>
    {sv.description} · {sv.supplierCategory||'No supplier category'} · execute {sv.executionDate||'—'}
    <span className='block text-xs text-slate-400'>Scope: {sv.scope} · Acceptance: {sv.acceptanceCriteria}</span>
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
export default function MntTaskAssessment({code,initial,onSaved,editable,recordType='wr',onCancel,onDirtyChange}:{code:string;initial:TaskAssessment[];onSaved:()=>void;editable:boolean;recordType?:'wr'|'wo';onCancel?:()=>void;onDirtyChange?:(dirty:boolean)=>void}){
 const [tasks,setTasks]=useState<TaskAssessment[]>(initial);
 const [dirty,setDirty]=useState(false);
 const options=useLoad(()=>callBackend<Options>('/api/org/mnt/assessment/options',{code}),[code]);
 const library=useLoad(()=>callBackend<{items:Array<{id:string;version:number;task:TaskAssessment}>}>('/api/org/mnt/tasks/library',{code}),[code]);
 const [current,setCurrent]=useState<number|null>(null),[step,setStep]=useState(0),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[photoUrls,setPhotoUrls]=useState<Record<string,string>>({});
 const [finder,setFinder]=useState(false),[openService,setOpenService]=useState<number|null>(null),[energySearch,setEnergySearch]=useState(''),[permitSearch,setPermitSearch]=useState('');
 useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
 const task=tasks[current??0]||seed();
 const sections=['Task','Spares','Services','People & tools','Safety'];
 const urls={...(options.data?.photos||{}),...photoUrls};
 const taskProblems=(t:TaskAssessment)=>[...t.spares.filter(sp=>sp.source==='description').flatMap(sp=>freeTextProblems(sp).map(x=>(sp.description||'New material')+': '+x)),...t.services.flatMap(sv=>serviceProblems(sv).map(x=>(sv.description||'Service')+': '+x))];
 const patch=(next:Partial<TaskAssessment>)=>{setDirty(true);setTasks(old=>old.map((t,i)=>i===current?{...t,...next}:t));};
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
 const save=async()=>{
  const problems=tasks.flatMap((t,i)=>taskProblems(t).map(x=>'Task '+(i+1)+' — '+x));
  if(problems.length){setMessage('Complete before saving: '+problems.slice(0,4).join('; ')+(problems.length>4?' …':''));return;}
  setSaving(true);setMessage('');try{
   await callBackend(recordType==='wo'?'/api/org/mnt/wo/action':'/api/org/mnt/wr/action',{code,action:'save_task_assessment',tasks});
   setDirty(false);setCurrent(null);setMessage('Assessment saved. Independent review is required before conversion.');onSaved();
  }catch(e){setMessage(e instanceof Error?e.message:'Assessment could not be saved.');}finally{setSaving(false);}
 };
 const openTask=(i:number)=>{setCurrent(i);setStep(0);setMessage('');setFinder(false);setOpenService(null);};
 const addTask=()=>{
   if(!editable)return;
   setTasks(old=>[...old,seed()]);
   setDirty(true);openTask(tasks.length);
 };
 if(current===null)return <div className='min-w-0 space-y-3'>
  <div className='flex min-w-0 flex-wrap items-start justify-between gap-2'>
   <div className='min-w-0'>
    <h3 className='text-lg font-semibold text-white'>Tasks <span className='text-sm font-normal text-slate-400'>({tasks.length})</span></h3>
    <p className='mt-1 text-xs text-slate-400'>{editable?'Open any task to configure its spares, people, time, tools and safety.':'Open any task to inspect the saved assessment (read-only).'}</p>
   </div>
   {editable&&<Button onClick={addTask} className='shrink-0'>+ Add Task</Button>}
  </div>
  {!tasks.length&&<div className='rounded-xl border border-dashed border-slate-600 bg-slate-900/40 px-4 py-8 text-center'>
   <p className='font-semibold text-white'>No tasks added yet</p>
   <p className='mt-1 text-sm text-slate-400'>{editable?'Use + Add Task to start the work assessment.':'The assessor has not saved any tasks yet.'}</p>
  </div>}
  <div className='space-y-2'>{tasks.map((t,i)=><button key={t.id} type='button' onClick={()=>openTask(i)}
   className='flex w-full min-w-0 items-start gap-2 rounded-xl border border-slate-700 bg-slate-900 p-3 text-left active:bg-slate-800'>
    <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-xs font-bold text-white'>{i+1}</span>
    <span className='min-w-0 flex-1'>
     <strong className='block break-words text-sm text-white'>{t.title||t.description||'Untitled task'}</strong>
     {t.title&&t.description&&<span className='mt-1 block line-clamp-2 text-xs text-slate-400'>{t.description}</span>}
     <span className='mt-2 flex flex-wrap gap-1 text-[11px] text-slate-300'>
      <span className='rounded-lg bg-slate-800 px-2 py-1'>{t.hours||0}h</span>
      <span className='rounded-lg bg-slate-800 px-2 py-1'>{t.spares?.length||0} spares</span>
      <span className='rounded-lg bg-slate-800 px-2 py-1'>{t.services?.length||0} services</span>
      <span className='rounded-lg bg-slate-800 px-2 py-1'>{t.persons||0} people</span>
      {t.lotoRequired&&<span className='rounded-lg bg-amber-900/40 px-2 py-1 text-amber-300'>LOTO</span>}
     </span>
    </span>
    <span className='shrink-0 text-lg text-slate-400' aria-hidden='true'>›</span>
   </button>)}</div>
  {editable&&tasks.length>0&&<div className='space-y-2 rounded-xl border border-slate-700 bg-slate-900/50 p-3'>
    <p className='text-xs text-slate-400'>Save all task changes to the work request before an independent reviewer can approve them.</p>
    <Button busy={saving} disabled={saving} onClick={save}>Save assessment for review</Button>
  </div>}
  {dirty&&<p className='text-xs text-amber-300'>Unsaved task changes. Save before leaving this section.</p>}
  {message&&<Alert tone='info'>{message}</Alert>}
 </div>;
 if(!editable)return <div className='min-w-0 space-y-3'>
   <button type='button' className='text-sm text-emerald-300 underline' onClick={()=>setCurrent(null)}>← All tasks</button>
   <ReviewAssessment tasks={[task]} options={options.data??undefined}/>
 </div>;
 return <Card className='min-w-0 space-y-4'>
   <button type='button' className='text-sm text-emerald-300 underline' onClick={()=>setCurrent(null)}>← All tasks</button>
   <div><p className='text-xs font-semibold uppercase text-emerald-300'>{`Task ${current+1} of ${tasks.length}`}</p>
    <h3 className='mt-1 break-words text-lg font-semibold text-white'>{task.title||'Configure task'}</h3>
    <p className='text-xs text-slate-400'>Complete the five sections, then return to the task list and save the assessment.</p>
   </div>
   <div className='flex gap-1 overflow-x-auto pb-1 sm:grid sm:grid-cols-5'>{sections.map((name,i)=><button type='button' key={name} onClick={()=>setStep(i)} className={'min-h-[40px] shrink-0 rounded-lg px-3 py-2 text-xs '+(step===i?'bg-emerald-800 text-white':'bg-slate-800 text-slate-300')}>{name}</button>)}</div>
   {step===0&&<div className='space-y-3'>
     {library.data?.items.length?<details className='rounded-xl border border-slate-700 p-3'><summary className='text-sm text-slate-200'>Reuse an approved assembly task</summary>
      {library.data.items.map(x=><button type='button' key={x.id} className='mt-2 block w-full rounded-lg border border-slate-700 p-2 text-left text-sm' onClick={()=>{if(tasks.some(t=>t.id===x.id)){setMessage('Task already selected.');return;}setTasks(old=>[...old,{...x.task,id:x.id,templateStatus:'existing'}]);setDirty(true);openTask(tasks.length);}}>{x.task.description}</button>)}
     </details>:null}
     <label className={label}>Task name<input className={input} value={task.title||''} onChange={e=>patch({title:e.target.value})}/></label>
     <label className={label}>Describe the work<textarea className={input} rows={3} value={task.description} onChange={e=>patch({description:e.target.value})} placeholder='What is required?'/></label>
     <label className={label}>Assembly<select data-native-select='true' className={input} value={task.assemblyId||''} onChange={e=>patch({assemblyId:e.target.value,equipmentId:options.data?.equipmentId})}><option value=''>Use the request assembly</option>{options.data?.equipmentOptions.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    </div>}
   {step===1&&<div className='space-y-3'>
     <p className='font-semibold text-white'>Spares for this task</p>
     <p className='text-xs text-slate-400'>Search first. Stock in a warehouse is reserved; registered materials and catalogue items go to procurement; a new material can only be described when nothing suitable exists.</p>
     {task.spares.map((sp,i)=>{const problems=sp.source==='description'?freeTextProblems(sp):[];return <div key={sp.id} className='min-w-0 space-y-2 rounded-xl border border-slate-700 p-3'>
       <div className='flex items-start justify-between gap-2'>
        <p className='min-w-0 text-xs text-slate-400'>{i+1}. {SOURCE_LABEL[sp.source]||sp.source}</p>
        <button type='button' className='shrink-0 text-xs text-red-300 underline' onClick={()=>patch({spares:task.spares.filter((_,j)=>j!==i)})}>Remove</button>
       </div>
       {sp.source==='description'?<>
        <label className={label}>Material name and technical description<input className={input} value={sp.description} onChange={e=>patchSpare(i,{description:e.target.value})}/></label>
        <label className={label}>Intended function<input className={input} value={sp.function||''} placeholder='What the part does on this equipment' onChange={e=>patchSpare(i,{function:e.target.value})}/></label>
        <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
         <label className={label}>Category (if known)<input className={input} value={sp.categoryCode||''} onChange={e=>patchSpare(i,{categoryCode:e.target.value})}/></label>
         <label className={label}>Subcategory (if known)<input className={input} value={sp.subcategoryCode||''} onChange={e=>patchSpare(i,{subcategoryCode:e.target.value})}/></label>
        </div>
        <label className={label}>Detailed specifications and attributes<textarea className={input} rows={3} value={sp.specifications||''} placeholder='Dimensions, material, rating, part or drawing number…' onChange={e=>patchSpare(i,{specifications:e.target.value})}/></label>
       </>:<p className='break-words text-sm font-medium text-white'>{sp.description}<span className='block text-xs font-normal text-slate-400'>{sp.source==='catalog'?'Catalogue '+sp.catalogCode+' · material creation and approval before purchase':sp.source==='material'?'Approved material · purchased for '+(sp.warehouseId||'a warehouse chosen by the planner'):'Warehouse '+sp.warehouseId+' · reserved by the planner'}</span></p>}
       <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
        <label className={label}>Quantity<input type='number' inputMode='decimal' min='0.001' step='any' className={input} value={sp.qty} onChange={e=>patchSpare(i,{qty:Number(e.target.value)})}/></label>
        <label className={label}>Unit<input className={input} value={sp.uom} readOnly={sp.source==='warehouse'||sp.source==='material'} onChange={e=>patchSpare(i,{uom:e.target.value})}/></label>
        <label className={label+' col-span-2 sm:col-span-1'}>Required by<input type='date' className={input} value={sp.requiredDate||''} min={new Date().toISOString().slice(0,10)} onChange={e=>patchSpare(i,{requiredDate:e.target.value})}/></label>
       </div>
       {sp.photoPath&&<a className='text-sm text-emerald-300 underline' href={urls[sp.photoPath]||'#'} target='_blank' rel='noreferrer noopener'>View attached photo</a>}
       <Attachments code={code} files={sp.attachments||[]} urls={urls} onChange={(files,u)=>{patchSpare(i,{attachments:files});setPhotoUrls(old=>({...old,...u}));}}/>
       {problems.length>0&&<p className='text-xs text-amber-300'>Still needed: {problems.join(', ')}.</p>}
     </div>;})}
     {finder?<SpareFinder code={code} onClose={()=>setFinder(false)} onAdd={x=>{addSpare({...newSpare(),...x});setFinder(false);}}/>:<Button onClick={()=>setFinder(true)}>+ Find a spare</Button>}
    </div>}
   {step===2&&<div className='space-y-3'>
     <p className='font-semibold text-white'>External services for this task</p>
     <p className='text-xs text-slate-400'>Each service carries its scope, competencies, deliverables and a supplier category. Vendors come only from the approved vendor registry.</p>
     {task.services.map((sv,i)=>{const problems=serviceProblems(sv);const editing=openService===i;return <div key={sv.id} className='min-w-0 space-y-2 rounded-xl border border-slate-700 p-3'>
       <button type='button' className='flex w-full items-start justify-between gap-2 text-left' onClick={()=>setOpenService(editing?null:i)} aria-expanded={editing}>
        <span className='min-w-0'><span className='block break-words text-sm font-medium text-white'>{sv.description||'New service'}</span>
         <span className='block text-xs text-slate-400'>{problems.length?'Incomplete: '+problems.slice(0,3).join(', '):'Complete · '+(sv.executionDate||'')}</span></span>
        <span className='shrink-0 text-lg text-slate-400' aria-hidden='true'>{editing?'−':'+'}</span>
       </button>
       {editing&&<ServiceEditor code={code} value={sv} hierarchy={options.data?.serviceHierarchy} urls={urls} onUrls={u=>setPhotoUrls(old=>({...old,...u}))} onChange={next=>patch({services:task.services.map((x,j)=>j===i?next as Service:x)})}/>}
       {editing&&<button type='button' className='text-xs text-red-300 underline' onClick={()=>{patch({services:task.services.filter((_,j)=>j!==i)});setOpenService(null);}}>Remove service</button>}
     </div>;})}
     <Button variant='secondary' onClick={()=>{patch({services:[...task.services,newService() as Service]});setOpenService(task.services.length);}}>+ Add external service</Button>
    </div>}
   {step===3&&<div className='space-y-3'>
     <p className='font-semibold text-white'>People and special tools for this task</p>
     <fieldset className='space-y-2'><legend className={label}>Internal resources required</legend>
      <div className='grid grid-cols-2 gap-2'>{roles.map(([code,name])=><label key={code} className='flex items-center gap-2 rounded-lg border border-slate-700 p-3 text-sm'><input type='checkbox' checked={(task.internalRoles||[]).includes(code)} onChange={e=>patch({internalRoles:e.target.checked?[...(task.internalRoles||[]),code]:(task.internalRoles||[]).filter(x=>x!==code)})}/>{name}</label>)}</div>
     </fieldset>
     <label className={label}>Number of internal people<input type='number' inputMode='decimal' min={0} max={50} className={input} value={task.persons} onChange={e=>patch({persons:Number(e.target.value)})}/></label>
     <label className={label}>External resources required<select data-native-select='true' className={input} value={task.externalResource?.type||''} onChange={e=>patch({externalResource:e.target.value?{type:e.target.value,persons:task.externalResource?.persons||1,notes:task.externalResource?.notes||''}:undefined})}>
       <option value=''>None</option>{externals.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label>
     {task.externalResource?.type&&<div className='space-y-2 rounded-xl border border-slate-700 p-3'>
       <label className={label}>How many external people?<input type='number' inputMode='decimal' min={1} max={50} className={input} value={task.externalResource.persons} onChange={e=>patch({externalResource:{...task.externalResource!,persons:Number(e.target.value)}})}/></label>
       <label className={label}>External scope / qualification<textarea className={input} rows={2} value={task.externalResource.notes} onChange={e=>patch({externalResource:{...task.externalResource!,notes:e.target.value}})}/></label>
       <p className='text-xs text-slate-400'>The planner will secure the external resource through the applicable supplier and procurement process.</p>
     </div>}
     <label className={label}>Time required (hours)<input type='number' inputMode='decimal' min={0.25} step={0.25} className={input} value={task.hours} onChange={e=>patch({hours:Number(e.target.value)})}/></label>
     <label className={label}>Special tools required<textarea className={input} rows={2} value={task.tools} onChange={e=>patch({tools:e.target.value})} placeholder='Tools, lifting gear, test instruments, calibration equipment…'/></label>
    </div>}
   {step===4&&<div className='space-y-3'>
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
     <Button variant='secondary' disabled={step===4} onClick={()=>setStep(i=>Math.min(4,i+1))}>Next section →</Button>
   </div>
   <div className='flex flex-col gap-2 sm:flex-row'>
    <Button className='flex-1' onClick={()=>{
      if(!(task.title||task.description).trim()||task.description.trim().length<3){setStep(0);setMessage('Enter the task name and a work description before returning.');return;}
      const problems=taskProblems(task);
      if(problems.length){setMessage('Complete before returning: '+problems.slice(0,4).join('; ')+(problems.length>4?' …':''));return;}
      setMessage('');setCurrent(null);
    }}>Done — back to tasks</Button>
    <Button variant='secondary' onClick={()=>{setDirty(true);setTasks(old=>old.filter((_,i)=>i!==current));setCurrent(null);}}>Remove task</Button>
   </div>
   {message&&<Alert tone='info'>{message}</Alert>}
  </Card>;
}
