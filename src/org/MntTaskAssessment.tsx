import {useEffect,useState} from 'react';
import {callBackend} from '../lib/backend';
import {Alert} from '../components/ui';
import {ChevronRight,ClipboardList,Clock,Package,ShieldAlert,Users,Wrench} from 'lucide-react';
import {ChoiceChip,ConfirmBox,OpenItems,StepProgress,StepSection} from './materialCreateUi';
import {Button,Card,useLoad} from '../admin/kit';
import {AddSpare,Attachments,ServiceEditor,SOURCE_LABEL,freeTextProblems,newService,serviceProblems,type ServiceHierarchy} from './mntSourcing';

type Spare={id:string;source:'warehouse'|'material'|'catalog'|'description';materialId:string;warehouseId:string;catalogCode:string;description:string;qty:number;uom:string;unitCost:number|null;photoPath?:string;specifications?:string;attributes?:Record<string,string>;function?:string;categoryCode?:string;subcategoryCode?:string;familyCode?:string;requiredDate?:string;attachments?:string[];searchReceiptId?:string;noMatchConfirmed?:boolean;noMatchReason?:string};
type Service={id:string;categoryCode:string;subcategoryCode:string;classCode:string;catalogCode:string;description:string;attributes:Record<string,string>;proposedVendorIds:string[];scope?:string;deliverables?:string;quantity?:number;qualifications?:string;expectedCost?:number|null;acceptanceCriteria?:string;instructions?:string;certifications?:string;personnel?:number;durationHours?:number;executionDate?:string;supplierCategory?:string;attachments?:string[]};
type Risk={hazard:string;impact:string;controls:string;before:string;after:string;permit:string;energyCode?:string;beforeRatings?:Record<string,number>;afterRatings?:Record<string,number>;exposedPersonnel?:string;responsiblePerson?:string;precautions?:string};
type RiskMatrix={version:number;formula:'multiply'|'add';factors:Array<{code:string;label:string;max:number;enabled:boolean}>;bands:Array<{label:string;min:number;max:number;color:string}>};
type SafetyOption={code:string;label:string;category:string;subcategory:string};
type Options={maintenanceTypes?:Array<{code:string;label:string}>;serviceHierarchy?:ServiceHierarchy;vendors:Array<{id:string;name:string}>;riskMatrix:RiskMatrix;hazardousEnergy:SafetyOption[];safetyPermits:SafetyOption[];photos:Record<string,string>;skills:Array<{code:string;label:string;category:string}>;equipmentId:string;equipmentOptions:Array<{id:string;name:string;code:string}>};
export type TaskAssessment={id:string;code?:string;description:string;disciplineCode:string;resourceTypeCode:string;persons:number;hours:number;rate:number;tools:string;spares:Spare[];services:Service[];risk:Risk[];templateStatus:'pending_validation'|'existing';maintenanceTypeCode?:string;maintenanceTypeLabel?:string;skillCodes?:string[];title?:string;equipmentId?:string;assemblyId?:string;instructions?:string;skills?:string;priority?:string;dependencies?:string[];isolation?:string;completionCriteria?:string;documentation?:string;safetyEquipment?:string;internalRoles?:string[];externalResource?:{type:string;persons:number;notes:string};machineStatus?:MachineStatus;lotoRequired?:boolean;liveEquipment?:boolean;energySourceCodes?:string[];permitCodes?:string[]};
export type MachineStatus='total_shutdown'|'live'|'full_loto'|'partial_isolation';
export const MACHINE_STATUS:Array<[MachineStatus,string,string]>=[
 ['total_shutdown','Total shutdown','The equipment is stopped and shut down for the work.'],
 ['full_loto','Full LOTO','Every hazardous energy source is isolated, locked, tagged and proven at zero.'],
 ['partial_isolation','Partial isolation','Only the listed energy sources are isolated; the rest stays energised.'],
 ['live','Work on live equipment','The equipment stays running or energised during the work.'],
];
export const machineOf=(t:{machineStatus?:MachineStatus;liveEquipment?:boolean;lotoRequired?:boolean}):MachineStatus=>t.machineStatus||(t.liveEquipment?'live':t.lotoRequired?'full_loto':'total_shutdown');
export const machineLabel=(t:{machineStatus?:MachineStatus;liveEquipment?:boolean;lotoRequired?:boolean})=>MACHINE_STATUS.find(x=>x[0]===machineOf(t))?.[1]||'';
const id=()=>Math.random().toString(36).slice(2,10);
const newRisk=():Risk=>({hazard:'',impact:'',controls:'',before:'',after:'',permit:'',beforeRatings:{},afterRatings:{}});
const seed=():TaskAssessment=>({id:'task_'+id(),description:'',disciplineCode:'',resourceTypeCode:'',persons:1,hours:1,rate:0,tools:'',spares:[],services:[],risk:[newRisk()],templateStatus:'pending_validation',internalRoles:[],externalResource:undefined,machineStatus:'total_shutdown',lotoRequired:false,liveEquipment:false,energySourceCodes:[],permitCodes:[]});
const input='mt-1 w-full rounded-xl border border-line bg-page p-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none read-only:opacity-70';
const label='block text-sm text-soft';
const roles=[['operator','Operator'],['technician','Technician'],['specialist','Specialist'],['engineer','Engineer']] as const;
const externals=[['OEM','OEM'],['OCM','OCM'],['verified_supplier','Verified external supplier'],['other','Other external resource']] as const;
const newSpare=():Spare=>({id:'sp_'+id(),source:'warehouse',materialId:'',warehouseId:'',catalogCode:'',description:'',qty:1,uom:'EA',unitCost:null});
export function WarehouseSparePicker({onSelect}:{onSelect:(item:{materialId:string;warehouseId:string;materialNumber:string;name:string;uom:string;available:number|null;stockVerified:boolean;warehouseName:string})=>void}){
 const {data:warehouseData,error:warehouseError}=useLoad(()=>callBackend<{warehouses:Array<{id:string;name:string}>}>('/api/org/mnt/warehouse-spares/search',{mode:'warehouses'}));
 const [warehouse,setWarehouse]=useState(''),[query,setQuery]=useState(''),[items,setItems]=useState<Array<{materialId:string;warehouseId:string;materialNumber:string;name:string;uom:string;available:number|null;stockVerified:boolean;warehouseName:string}>>([]),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!warehouse||query.trim().length<2){setItems([]);return;}
 let alive=true;const timer=setTimeout(async()=>{setBusy(true);
 try{const result=await callBackend<{items:typeof items}>('/api/org/mnt/warehouse-spares/search',{warehouseId:warehouse,q:query.trim()});if(alive)setItems(result.items);}
 catch{if(alive)setItems([]);}finally{if(alive)setBusy(false);}},300);
 return()=>{alive=false;clearTimeout(timer);};},[warehouse,query]);
 return <div className='space-y-2 rounded-xl border border-line p-3'>
  <p className='text-sm font-semibold text-ink'>1. Choose warehouse, then a material</p>
  <label className={label}>Warehouse<select data-native-select='true' className={input} value={warehouse} onChange={e=>{setWarehouse(e.target.value);setQuery('');setItems([]);}}>
   <option value=''>Select warehouse first</option>{warehouseData?.warehouses?.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
  </select></label>
  {warehouseError&&<Alert tone='error'>{warehouseError}</Alert>}
  {warehouse&&<label className={label}>Search the selected warehouse<input type='search' className={input} value={query} placeholder='Material number or name' onChange={e=>setQuery(e.target.value)}/></label>}
  {busy&&<p className='text-xs text-muted'>Checking available stock…</p>}
  <div className='max-h-52 space-y-1 overflow-y-auto'>{items.map(x=><button key={x.materialId+':'+x.warehouseId} type='button'
   className='w-full rounded-lg border border-line p-3 text-left text-sm text-ink' onClick={()=>{onSelect(x);setQuery('');setItems([]);}}>
   <span className='text-xs text-brand'>{x.materialNumber}</span> · {x.name}
   <span className='block text-xs text-muted'>{x.stockVerified?'Available '+x.available+' '+x.uom:'Quantity not verified'} · {x.warehouseName}</span>
  </button>)}</div>
 </div>;
}
export function CatalogPicker({kind,onSelect}:{kind:'materials'|'services';onSelect:(item:{code:string;name:string;family:string})=>void}){
 const [q,setQ]=useState(''),[rows,setRows]=useState<Array<{code:string;name:string;family:string}>>([]),[loading,setLoading]=useState(false);
 useEffect(()=>{if(q.trim().length<2){setRows([]);return;}let active=true;
 const t=setTimeout(async()=>{setLoading(true);try{const result=await callBackend<{items:typeof rows}>('/api/org/mnt/catalog-search',{kind,q:q.trim()});if(active)setRows(result.items||[]);}catch{if(active)setRows([]);}finally{if(active)setLoading(false);}},320);
 return()=>{active=false;clearTimeout(t);};},[q,kind]);
 return <div className='space-y-2 rounded-xl border border-line p-3'><label className={label}>Search MEMS technical catalogue
  <input type='search' className={input} value={q} onChange={e=>setQ(e.target.value)} placeholder='Search name or code'/>
 </label>{loading&&<p className='text-sm text-muted'>Searching…</p>}
 <div className='max-h-52 space-y-1 overflow-y-auto'>{rows.map(x=><button type='button' key={x.code} className='w-full rounded-lg border border-line p-3 text-left text-sm text-ink' onClick={()=>{onSelect(x);setQ('');setRows([]);}}>
  {x.name}<span className='block text-xs text-muted'>{x.code} · {x.family}</span></button>)}</div></div>;
}
const categories=(opts:SafetyOption[])=>[...new Set(opts.map(x=>x.category||'Other'))];
function ReviewAssessment({tasks,options}:{tasks:TaskAssessment[];options?:Options|null}){
 return <Card className='space-y-3'><h3 className='font-semibold text-ink'>Work assessment — read-only review</h3>
  <p className='text-sm text-muted'>Review the submitted details. Approval or return does not alter the assessment.</p>
  {!tasks.length&&<p className='text-sm text-amber-400'>No tasks assessed.</p>}
  {tasks.map((t,i)=><section key={t.id} className='space-y-2 rounded-xl border border-line p-3 text-sm'>
   <h4 className='font-semibold text-ink'>Task {i+1}: {t.title||t.description}</h4>
   <p className='text-soft'>{t.description}</p>
   <p className='text-xs text-brand'>Maintenance strategy: {t.maintenanceTypeCode?((options?.maintenanceTypes||[]).find(m=>m.code===t.maintenanceTypeCode)?.label||t.maintenanceTypeLabel||t.maintenanceTypeCode):'Inherit Work Order type'}</p>
   <p>Internal: {(t.internalRoles||[]).map(c=>roles.find(x=>x[0]===c)?.[1]||c).join(', ')||'None'} · {t.persons} people · {t.hours} hours</p>
   {t.externalResource?.type&&<p>External: {externals.find(x=>x[0]===t.externalResource?.type)?.[1]||t.externalResource.type} · {t.externalResource.persons} people · {t.externalResource.notes}</p>}
   <p>Special tools: {t.tools||'None declared'}</p>
   <p className='font-medium text-ink'>Spares ({t.spares?.length||0})</p>
   {t.spares?.map(sp=><div key={sp.id} className='rounded-lg bg-page p-2'>
    {sp.description} · {sp.qty} {sp.uom} · {SOURCE_LABEL[sp.source]||sp.source}{sp.warehouseId?' · warehouse '+sp.warehouseId:''}
    {sp.source==='description'&&<span className='block text-xs text-muted'>Function: {sp.function||'—'} · {sp.specifications||'No specification'}{sp.requiredDate?' · by '+sp.requiredDate:''}</span>}
    {sp.photoPath&&<div>{options?.photos?.[sp.photoPath]?<a href={options.photos[sp.photoPath]} target='_blank' rel='noreferrer' className='text-brand underline'>View spare photo</a>:<span>Photo attached</span>}</div>}
   </div>)}
   <p className='font-medium text-ink'>External services ({t.services?.length||0})</p>
   {t.services?.map(sv=><div key={sv.id} className='rounded-lg bg-page p-2'>
    {sv.description} · {sv.supplierCategory||'No supplier category'} · execute {sv.executionDate||'—'}
    <span className='block text-xs text-muted'>Scope: {sv.scope} · Acceptance: {sv.acceptanceCriteria}</span>
   </div>)}
   <p>Machine status: {machineLabel(t)}{t.lotoRequired?' · LOTO: '+(t.energySourceCodes||[]).length+' energy source(s)':''}</p>
   {!!t.energySourceCodes?.length&&<p>Hazardous energy: {t.energySourceCodes.map(code=>options?.hazardousEnergy.find(x=>x.code===code)?.label||code).join(', ')}</p>}
   {!!t.permitCodes?.length&&<p>Permits: {t.permitCodes.map(code=>options?.safetyPermits.find(x=>x.code===code)?.label||code).join(', ')}</p>}
   <p className='font-medium text-ink'>Safety and risk assessment</p>
   {t.risk?.map((risk,j)=><div key={j} className='rounded-lg bg-page p-2'>
    <p>Hazard: {risk.hazard} · Impact: {risk.impact}</p><p>Controls: {risk.controls}</p>
    <p>Initial: {risk.before||'Pending'} · Residual: {risk.after||'Pending'}</p>
   </div>)}
  </section>)}
 </Card>;
}
export default function MntTaskAssessment({code,initial,onSaved,editable,recordType='wr',onCancel,onDirtyChange,context}:{context?:{asset:string;assembly:string;equipment:string};code:string;initial:TaskAssessment[];onSaved:()=>void;editable:boolean;recordType?:'wr'|'wo';onCancel?:()=>void;onDirtyChange?:(dirty:boolean)=>void}){
 const [tasks,setTasks]=useState<TaskAssessment[]>(initial);
 const [dirty,setDirty]=useState(false);
 const options=useLoad(()=>callBackend<Options>('/api/org/mnt/assessment/options',{code}),[code]);
 const library=useLoad(()=>callBackend<{items:Array<{id:string;version:number;task:TaskAssessment}>}>('/api/org/mnt/tasks/library',{code}),[code]);
 const [current,setCurrent]=useState<number|null>(null),[step,setStep]=useState(0),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[photoUrls,setPhotoUrls]=useState<Record<string,string>>({});
 const [adding,setAdding]=useState(false),[draft,setDraft]=useState<{title:string;description:string}|null>(null),[spareWarehouse,setSpareWarehouse]=useState(''),[openService,setOpenService]=useState<number|null>(null),[energySearch,setEnergySearch]=useState(''),[permitSearch,setPermitSearch]=useState('');
 useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
 const task=tasks[current??0]||seed();
 const sections=['Task','Spares','Services','People & tools','Safety'];
 const urls={...(options.data?.photos||{}),...photoUrls};
 const taskProblems=(t:TaskAssessment)=>[...t.spares.filter(sp=>sp.source==='description').flatMap(sp=>freeTextProblems(sp).map(x=>(sp.description||'New material')+': '+x)),...t.services.flatMap(sv=>serviceProblems(sv).map(x=>(sv.description||'Service')+': '+x))];
 // Open items per section, shown on the section progress and before leaving the task (verification).
 const sectionIssues=(t:TaskAssessment):string[][]=>[
  [...(!(t.title||'').trim()?['Task name']:[]),...(t.description.trim().length<3?['Work description (at least 3 characters)']:[])],
  [...t.spares.filter(sp=>!(Number(sp.qty)>0)).map(sp=>(sp.description||'Spare')+': quantity above zero'),...t.spares.filter(sp=>sp.source==='description').flatMap(sp=>freeTextProblems(sp).map(x=>(sp.description||'New material')+': '+x))],
  t.services.flatMap(sv=>serviceProblems(sv).map(x=>(sv.description||'Service')+': '+x)),
  [...(!(Number(t.hours)>0)?['Time required (hours)']:[]),...(Number(t.persons)<0?['Number of people']:[])],
  [...(t.lotoRequired&&!(t.energySourceCodes||[]).length?['Choose the hazardous energy sources to isolate']:[]),...t.risk.filter(r=>!r.hazard.trim()||!r.controls.trim()).map((r,i)=>'Hazard '+(i+1)+': hazard and mitigations')],
 ];
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
 /** Machine status during execution decides isolation (LOTO with energy sources) or live work, with their permits and hazards. */
 const setMachine=(ms:MachineStatus)=>{
   const loto=ms==='full_loto'||ms==='partial_isolation',live=ms==='live';
   const lotoPermit=permitFor(/loto|lock.?out|isolation/i),livePermit=permitFor(/live/i);
   const permitCodes=(task.permitCodes||[]).filter(x=>x!==lotoPermit&&x!==livePermit);
   if(loto&&lotoPermit)permitCodes.push(lotoPermit);
   if(live&&livePermit)permitCodes.push(livePermit);
   let risk=task.risk.filter(x=>x.energyCode!=='LIVE_EQUIPMENT');
   if(!loto)risk=risk.filter(x=>!(task.energySourceCodes||[]).includes(x.energyCode||''));
   if(live)risk=[...risk.filter(x=>x.hazard||x.impact||x.controls),newEnergyRisk('LIVE_EQUIPMENT')];
   patch({machineStatus:ms,lotoRequired:loto,liveEquipment:live,permitCodes,risk:risk.length?risk:[newRisk()],...(loto?{}:{energySourceCodes:[]})});
 };
 const save=async()=>{
  const problems=tasks.flatMap((t,i)=>taskProblems(t).map(x=>'Task '+(i+1)+' — '+x));
  if(problems.length){setMessage('Complete before saving: '+problems.slice(0,4).join('; ')+(problems.length>4?' …':''));return;}
  setSaving(true);setMessage('');try{
   await callBackend(recordType==='wo'?'/api/org/mnt/wo/action':'/api/org/mnt/wr/action',{code,action:'save_task_assessment',tasks});
   setDirty(false);setCurrent(null);setMessage('Assessment saved. Independent review is required before conversion.');onSaved();
  }catch(e){setMessage(e instanceof Error?e.message:'Assessment could not be saved.');}finally{setSaving(false);}
 };
 const openTask=(i:number)=>{setCurrent(i);setStep(0);setMessage('');setAdding(false);setOpenService(null);setSpareWarehouse(tasks[i]?.spares.find(sp=>sp.warehouseId)?.warehouseId||'');};
 const warehouses=useLoad(()=>callBackend<{warehouses:Array<{id:string;name:string}>}>('/api/org/mnt/warehouse-spares/search',{mode:'warehouses'}),[]);
 const nextCode=()=>'ASSMTASK_'+(Math.max(0,...tasks.map(t=>Number(/^ASSMTASK_(\d+)$/.exec(t.code||'')?.[1]||0)))+1);
 const codeOf=(t:TaskAssessment,i:number)=>t.code||'ASSMTASK_'+(i+1);
 // A new task starts with only its name and description; it is then opened to configure the five sections.
 const addTask=()=>{
   if(!editable||!draft)return;
   const title=draft.title.trim(),description=draft.description.trim();
   if(title.length<3||description.length<3){setMessage('Enter a task name and a description (at least 3 characters each).');return;}
   setTasks(old=>[...old,{...seed(),code:nextCode(),title,description}]);
   setDraft(null);setDirty(true);setMessage('Task added. Open it to add spares, services, people and safety, then save the assessment.');
 };
 if(current===null)return <div className='min-w-0 space-y-3'>
  <div className='sticky top-0 z-10 -mx-1 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-panel/95 p-3 backdrop-blur'>
   <div className='min-w-0'>
    <h3 className='flex items-center gap-2 text-base font-semibold text-ink'><ClipboardList className='h-4 w-4 text-brand'/>Tasks <span className='text-sm font-normal text-muted'>({tasks.length})</span></h3>
    <p className='mt-0.5 text-xs text-muted'>{editable?'Open a task to set its spares, services, people, time, tools and safety.':'Open a task to inspect the saved assessment (read-only).'}</p>
   </div>
   <div className='flex shrink-0 flex-wrap gap-2'>
    {editable&&!draft&&<Button variant='secondary' onClick={()=>{setDraft({title:'',description:''});setMessage('');}}>+ Add Task</Button>}
    {editable&&tasks.length>0&&<Button busy={saving} disabled={saving||!dirty} onClick={save}>Save assessment for review</Button>}
   </div>
   {dirty&&<p className='w-full text-xs text-amber-400'>Unsaved task changes. Save the assessment before leaving this section.</p>}
  </div>
  {message&&<Alert tone='info'>{message}</Alert>}
  {draft&&<StepSection title={'New task · '+nextCode()} hint='Name the task and describe the work. You then open it to add the details.'>
   <div className='space-y-3'>
    <label className={label}>Task name *<input className={input} autoFocus maxLength={120} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} placeholder='e.g. Replace drive-end bearing'/></label>
    <label className={label}>Description *<textarea className={input} rows={3} maxLength={300} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})} placeholder='What work is required?'/></label>
    <div className='flex gap-2'>
     <Button disabled={draft.title.trim().length<3||draft.description.trim().length<3} onClick={addTask}>Save task</Button>
     <Button variant='secondary' onClick={()=>setDraft(null)}>Cancel</Button>
    </div>
    {library.data?.items.length?<details className='rounded-xl border border-line p-3'><summary className='flex min-h-9 cursor-pointer items-center text-sm text-soft'>Or reuse an approved assembly task ({library.data.items.length})</summary>
     <div className='mt-2 space-y-1'>{library.data.items.map(x=><button type='button' key={x.id} className='flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-line bg-page p-2 text-left text-sm text-ink active:bg-panel' onClick={()=>{if(tasks.some(t=>t.id===x.id)){setMessage('Task already selected.');return;}setTasks(old=>[...old,{...x.task,id:x.id,code:nextCode(),templateStatus:'existing'}]);setDraft(null);setDirty(true);}}><span className='min-w-0 break-words'>{x.task.title||x.task.description}</span><span className='shrink-0 text-xs text-muted'>v{x.version}</span></button>)}</div>
    </details>:null}
   </div>
  </StepSection>}
  {!tasks.length&&!draft&&<div className='rounded-2xl border border-dashed border-line bg-panel px-4 py-8 text-center'>
   <p className='font-semibold text-ink'>No tasks added yet</p>
   <p className='mt-1 text-sm text-muted'>{editable?'Use + Add Task to start the work assessment.':'The assessor has not saved any tasks yet.'}</p>
  </div>}
  <div className='space-y-2'>{tasks.map((t,i)=>{const open=sectionIssues(t).flat().length;return <button key={t.id} type='button' onClick={()=>openTask(i)}
   className='flex w-full min-w-0 items-start gap-3 rounded-2xl border border-line bg-panel p-3 text-left active:bg-page'>
    <span className={'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold '+(open?'bg-amber-400/15 text-amber-400':'bg-brand/15 text-brand')}>{i+1}</span>
    <span className='min-w-0 flex-1'>
     <span className='block font-mono text-[11px] font-semibold tracking-wide text-brand'>{codeOf(t,i)}{t.templateStatus==='existing'?' · approved template':''}</span>
     <strong className='block break-words text-sm text-ink'>{t.title||t.description||'Untitled task'}</strong>
     {t.title&&t.description&&<span className='mt-0.5 block line-clamp-2 text-xs text-muted'>{t.description}</span>}
     <span className='mt-2 flex flex-wrap gap-1 text-[11px] text-soft'>
      <span className='inline-flex items-center gap-1 rounded-lg bg-page px-2 py-1'><Clock className='h-3 w-3'/>{t.hours||0}h</span>
      <span className='inline-flex items-center gap-1 rounded-lg bg-page px-2 py-1'><Users className='h-3 w-3'/>{t.persons||0}</span>
      <span className='inline-flex items-center gap-1 rounded-lg bg-page px-2 py-1'><Package className='h-3 w-3'/>{t.spares?.length||0} spares</span>
      <span className='inline-flex items-center gap-1 rounded-lg bg-page px-2 py-1'><Wrench className='h-3 w-3'/>{t.services?.length||0} services</span>
      {t.maintenanceTypeCode&&<span className='rounded-lg bg-brand/10 px-2 py-1 text-brand'>Strategy {t.maintenanceTypeCode}</span>}
      {t.lotoRequired&&<span className='inline-flex items-center gap-1 rounded-lg bg-amber-400/15 px-2 py-1 text-amber-400'><ShieldAlert className='h-3 w-3'/>LOTO</span>}
      {editable&&open>0&&<span className='rounded-lg bg-amber-400/15 px-2 py-1 text-amber-400'>{open} open</span>}
     </span>
    </span>
    <ChevronRight className='mt-2 h-5 w-5 shrink-0 text-muted' aria-hidden='true'/>
   </button>;})}</div>
 </div>;
 if(!editable)return <div className='min-w-0 space-y-3'>
   <button type='button' className='flex min-h-11 items-center text-sm text-brand' onClick={()=>setCurrent(null)}>← All tasks</button>
   <ReviewAssessment tasks={[task]} options={options.data??undefined}/>
 </div>;
 const issues=sectionIssues(task);
 return <div className='min-w-0 space-y-3'>
   <div className='sticky top-0 z-10 -mx-1 space-y-2 rounded-2xl border border-line bg-panel/95 p-3 backdrop-blur'>
    <div className='flex items-center gap-2'>
     <button type='button' aria-label='All tasks' className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-soft active:bg-page' onClick={()=>setCurrent(null)}>←</button>
     <div className='min-w-0 flex-1'>
      <p className='truncate font-mono text-[11px] font-semibold text-brand'>{codeOf(task,current)} · {`task ${current+1} of ${tasks.length}`} · {sections[step]}</p>
      <h3 className='truncate text-base font-semibold text-ink'>{task.title||'Configure task'}</h3>
     </div>
     <Button className='shrink-0' onClick={()=>{
      if(!(task.title||task.description).trim()||task.description.trim().length<3){setStep(0);setMessage('Enter the task name and a work description before returning.');return;}
      const problems=taskProblems(task);
      if(problems.length){setMessage('Complete before returning: '+problems.slice(0,4).join('; ')+(problems.length>4?' …':''));return;}
      setMessage('');setCurrent(null);
     }}><span className='sm:hidden'>Done</span><span className='hidden sm:inline'>Done — back to tasks</span></Button>
    </div>
    <StepProgress steps={sections.map((name,i)=>({label:name,open:issues[i].length}))} stage={step+1} onStep={n=>setStep(n-1)}/>
    <div className='flex gap-1 overflow-x-auto sm:hidden' role='tablist' aria-label='Task sections'>{sections.map((name,i)=><button type='button' role='tab' aria-selected={step===i} key={name} onClick={()=>setStep(i)} className={'min-h-9 shrink-0 rounded-lg px-3 text-xs '+(step===i?'bg-brand text-onbrand':'bg-page text-soft')}>{name}{issues[i].length?' •':''}</button>)}</div>
   </div>
   {message&&<Alert tone='info'>{message}</Alert>}
   {step===0&&<StepSection title='Task' hint='What is done and which maintenance strategy it follows.'>
    <div className='space-y-3'>
     <label className={label}>Task name<input className={input} value={task.title||''} onChange={e=>patch({title:e.target.value})}/></label>
     <label className={label}>Describe the work<textarea className={input} rows={3} value={task.description} onChange={e=>patch({description:e.target.value})} placeholder='What is required?'/></label>
     <label className={label}>Maintenance strategy for this task (Finance reporting)
       <select data-native-select='true' className={input} value={task.maintenanceTypeCode||''} onChange={e=>{
         const type=options.data?.maintenanceTypes?.find(t=>t.code===e.target.value);
         patch({maintenanceTypeCode:type?.code||'',maintenanceTypeLabel:type?.label||''});
       }}>
         <option value=''>Inherit the Work Order maintenance type</option>
         {options.data?.maintenanceTypes?.map(t=><option key={t.code} value={t.code}>{t.code} · {t.label}</option>)}
       </select>
       <span className='mt-1 block text-xs text-muted'>Override only when this task follows a different maintenance strategy. Changes require the existing assessment review.</span>
     </label>
     {context&&<dl className='grid gap-2 rounded-xl border border-line bg-page p-3 text-sm sm:grid-cols-3'>
      {([['Asset',context.asset],['Assembly',context.assembly],['Equipment',context.equipment]] as const).map(([k,v])=><div key={k} className='min-w-0'><dt className='text-xs text-muted'>{k}</dt><dd className='break-words text-ink'>{v||'—'}</dd></div>)}
      <p className='text-xs text-muted sm:col-span-3'>Adopted from the work assessment.</p>
     </dl>}
    </div>
   </StepSection>}
   {step===1&&<StepSection title='Spares for this task' hint='Choose the warehouse, then add each spare from stock, the material catalogue or as free text, with its quantity.'>
    <div className='space-y-3'>
     <label className={label}>Warehouse (select first) *<select data-native-select='true' className={input} value={spareWarehouse} onChange={e=>{setSpareWarehouse(e.target.value);setAdding(false);}}>
      <option value=''>Choose the warehouse</option>{warehouses.data?.warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
     {task.spares.map((sp,i)=>{const problems=sp.source==='description'?freeTextProblems(sp):[];return <div key={sp.id} className='min-w-0 space-y-2 rounded-xl border border-line bg-page p-3'>
       <div className='flex items-start justify-between gap-2'>
        <p className='min-w-0 text-xs text-muted'><span className='mr-1 rounded bg-panel px-1.5 py-0.5 font-mono text-[10px] text-brand'>{i+1}</span>{SOURCE_LABEL[sp.source]||sp.source}</p>
        <button type='button' className='min-h-9 shrink-0 px-2 text-xs text-red-400' onClick={()=>patch({spares:task.spares.filter((_,j)=>j!==i)})}>Remove</button>
       </div>
       {sp.source==='description'?<>
        <label className={label}>Material name and technical description<input className={input} value={sp.description} onChange={e=>patchSpare(i,{description:e.target.value})}/></label>
        <label className={label}>Intended function<input className={input} value={sp.function||''} placeholder='What the part does on this equipment' onChange={e=>patchSpare(i,{function:e.target.value})}/></label>
        <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
         <label className={label}>Category (if known)<input className={input} value={sp.categoryCode||''} onChange={e=>patchSpare(i,{categoryCode:e.target.value})}/></label>
         <label className={label}>Subcategory (if known)<input className={input} value={sp.subcategoryCode||''} onChange={e=>patchSpare(i,{subcategoryCode:e.target.value})}/></label>
        </div>
        <label className={label}>Detailed specifications and attributes<textarea className={input} rows={3} value={sp.specifications||''} placeholder='Dimensions, material, rating, part or drawing number…' onChange={e=>patchSpare(i,{specifications:e.target.value})}/></label>
       </>:<p className='break-words text-sm font-medium text-ink'>{sp.description}{sp.source==='catalog'&&sp.attributes&&Object.keys(sp.attributes).length>0&&<span className='block text-xs font-normal text-muted'>{Object.entries(sp.attributes).map(([k,v])=>k+': '+v).join(' · ')}</span>}<span className='block text-xs font-normal text-muted'>{(()=>{const wh=warehouses.data?.warehouses.find(w=>w.id===sp.warehouseId)?.name||sp.warehouseId;return sp.source==='catalog'?'Catalogue '+sp.catalogCode+' · new material, approved before purchase'+(wh?' · for '+wh:''):sp.source==='material'?'Registered material · purchased for '+(wh||'a warehouse the planner chooses'):(wh||'Warehouse')+' · reserved by the planner';})()}</span></p>}
       <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
        <label className={label}>Quantity<input type='number' inputMode='decimal' min='0.001' step='any' className={input} value={sp.qty} onChange={e=>patchSpare(i,{qty:Number(e.target.value)})}/></label>
        <label className={label}>Unit<input className={input} value={sp.uom} readOnly={sp.source==='warehouse'||sp.source==='material'} onChange={e=>patchSpare(i,{uom:e.target.value})}/></label>
        <label className={label+' col-span-2 sm:col-span-1'}>Required by<input type='date' className={input} value={sp.requiredDate||''} min={new Date().toISOString().slice(0,10)} onChange={e=>patchSpare(i,{requiredDate:e.target.value})}/></label>
       </div>
       {sp.photoPath&&<a className='text-sm text-brand underline' href={urls[sp.photoPath]||'#'} target='_blank' rel='noreferrer noopener'>View attached photo</a>}
       <Attachments code={code} files={sp.attachments||[]} urls={urls} onChange={(files,u)=>{patchSpare(i,{attachments:files});setPhotoUrls(old=>({...old,...u}));}}/>
       {problems.length>0&&<p className='text-xs text-amber-400'>Still needed: {problems.join(', ')}.</p>}
     </div>;})}
     {adding&&spareWarehouse?<AddSpare code={code} warehouseId={spareWarehouse} warehouseName={warehouses.data?.warehouses.find(w=>w.id===spareWarehouse)?.name||spareWarehouse} onClose={()=>setAdding(false)} onAdd={x=>{addSpare({...newSpare(),...x});setAdding(false);setMessage('Spare added. Add more from the warehouse, the catalogue or free text.');}}/>
      :<Button variant='secondary' disabled={!spareWarehouse} onClick={()=>{setAdding(true);setMessage('');}}>+ Add spare</Button>}
    </div>
   </StepSection>}
   {step===2&&<StepSection title='External services for this task' hint='Each service carries its scope, competencies, deliverables and a supplier category. Vendors come only from the approved vendor registry.'>
    <div className='space-y-2'>
     {task.services.map((sv,i)=>{const problems=serviceProblems(sv);const editing=openService===i;return <div key={sv.id} className='min-w-0 space-y-2 rounded-xl border border-line bg-page p-3'>
       <button type='button' className='flex min-h-11 w-full items-start justify-between gap-2 text-left' onClick={()=>setOpenService(editing?null:i)} aria-expanded={editing}>
        <span className='min-w-0'><span className='block break-words text-sm font-medium text-ink'>{sv.description||'New service'}</span>
         <span className={'block text-xs '+(problems.length?'text-amber-400':'text-muted')}>{problems.length?'Incomplete: '+problems.slice(0,3).join(', '):'Complete · '+(sv.executionDate||'')}</span></span>
        <span className='shrink-0 text-lg text-muted' aria-hidden='true'>{editing?'−':'+'}</span>
       </button>
       {editing&&<ServiceEditor code={code} value={sv} hierarchy={options.data?.serviceHierarchy} urls={urls} onUrls={u=>setPhotoUrls(old=>({...old,...u}))} onChange={next=>patch({services:task.services.map((x,j)=>j===i?next as Service:x)})}/>}
       {editing&&<button type='button' className='min-h-9 text-xs text-red-400' onClick={()=>{patch({services:task.services.filter((_,j)=>j!==i)});setOpenService(null);}}>Remove service</button>}
     </div>;})}
     <Button variant='secondary' onClick={()=>{patch({services:[...task.services,newService() as Service]});setOpenService(task.services.length);}}>+ Add external service</Button>
    </div>
   </StepSection>}
   {step===3&&<>
    <StepSection title='People' hint='Internal roles and any external resource the planner must secure.'>
     <div className='space-y-3'>
      <fieldset><legend className={label}>Internal resources required</legend>
       <div className='mt-1 grid grid-cols-2 gap-2'>{roles.map(([code,name])=><ChoiceChip key={code} checked={(task.internalRoles||[]).includes(code)} onToggle={()=>{const on=(task.internalRoles||[]).includes(code);patch({internalRoles:on?(task.internalRoles||[]).filter(x=>x!==code):[...(task.internalRoles||[]),code]});}}>{name}</ChoiceChip>)}</div>
      </fieldset>
      <div className='grid grid-cols-2 gap-2'>
       <label className={label}>Number of internal people<input type='number' inputMode='decimal' min={0} max={50} className={input} value={task.persons} onChange={e=>patch({persons:Number(e.target.value)})}/></label>
       <label className={label}>Time required (hours)<input type='number' inputMode='decimal' min={0.25} step={0.25} className={input} value={task.hours} onChange={e=>patch({hours:Number(e.target.value)})}/></label>
      </div>
      <label className={label}>External resources required<select data-native-select='true' className={input} value={task.externalResource?.type||''} onChange={e=>patch({externalResource:e.target.value?{type:e.target.value,persons:task.externalResource?.persons||1,notes:task.externalResource?.notes||''}:undefined})}>
        <option value=''>None</option>{externals.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label>
      {task.externalResource?.type&&<div className='space-y-2 rounded-xl border border-line bg-page p-3'>
        <label className={label}>How many external people?<input type='number' inputMode='decimal' min={1} max={50} className={input} value={task.externalResource.persons} onChange={e=>patch({externalResource:{...task.externalResource!,persons:Number(e.target.value)}})}/></label>
        <label className={label}>External scope / qualification<textarea className={input} rows={2} value={task.externalResource.notes} onChange={e=>patch({externalResource:{...task.externalResource!,notes:e.target.value}})}/></label>
        <p className='text-xs text-muted'>The planner will secure the external resource through the applicable supplier and procurement process.</p>
      </div>}
     </div>
    </StepSection>
    <StepSection title='Special tools'>
     <label className={label}><span className='sr-only'>Special tools required</span><textarea className={input} rows={2} value={task.tools} onChange={e=>patch({tools:e.target.value})} placeholder='Tools, lifting gear, test instruments, calibration equipment…'/></label>
    </StepSection>
   </>}
   {step===4&&<>
    <StepSection title='Machine status during execution' hint='Sets isolation or live work, and adds the required permits and hazards automatically.'>
     <div role='radiogroup' aria-label='Machine status during execution' className='grid gap-2 sm:grid-cols-2'>
      {MACHINE_STATUS.map(([value,title,detail])=>{const on=machineOf(task)===value;return <button key={value} type='button' role='radio' aria-checked={on} onClick={()=>setMachine(value)}
        className={'min-h-16 rounded-xl border p-3 text-left '+(on?'border-brand bg-brand/10':'border-line bg-page')}>
        <span className='block text-sm font-semibold text-ink'>{title}</span><span className='mt-0.5 block text-xs text-soft'>{detail}</span></button>;})}
     </div>
     <div className='mt-2 space-y-2'>
      {task.lotoRequired&&<div className='space-y-2 rounded-xl border border-amber-400/40 bg-amber-400/5 p-3'>
        <p className='text-sm font-semibold text-ink'>LOTO: hazardous energy sources to isolate (SAF master)</p>
        <input type='search' className={input} placeholder='Filter SAF energy sources (optional)' value={energySearch} onChange={e=>setEnergySearch(e.target.value)}/>
        {categories(options.data?.hazardousEnergy||[]).map(cat=><div key={cat}>
         <p className='mt-3 text-xs font-semibold uppercase tracking-wide text-brand'>{cat}</p>
         <div className='mt-1 grid gap-1.5 sm:grid-cols-2'>{options.data?.hazardousEnergy.filter(x=>(x.category||'Other')===cat&&(x.label.toLowerCase().includes(energySearch.toLowerCase())||x.code.toLowerCase().includes(energySearch.toLowerCase()))).map(x=><ChoiceChip key={x.code} checked={(task.energySourceCodes||[]).includes(x.code)} onToggle={()=>toggleEnergy(x.code,!(task.energySourceCodes||[]).includes(x.code))}>{x.label}</ChoiceChip>)}</div>
        </div>)}
        {options.data?.hazardousEnergy.length===0&&<Alert tone='error'>No hazardous energy sources configured in the SAF master. Contact MEMS Admin.</Alert>}
       </div>}
      {task.liveEquipment&&<p className='rounded-xl border border-amber-400/40 bg-amber-400/5 p-3 text-sm text-amber-400'>Live work requires an independent hazard assessment and SAF-authorized live-work permit. Confirm controls before execution.</p>}
     </div>
    </StepSection>
    <StepSection title={'Permits ('+(task.permitCodes?.length||0)+' selected)'} hint='From the SAF permit master. Permits required by LOTO or live work are locked on.'>
     <input type='search' className={input} placeholder='Filter permits' value={permitSearch} onChange={e=>setPermitSearch(e.target.value)}/>
     <div className='mt-2 max-h-64 space-y-1.5 overflow-y-auto overscroll-contain'>{options.data?.safetyPermits.filter(x=>x.label.toLowerCase().includes(permitSearch.toLowerCase())||x.category.toLowerCase().includes(permitSearch.toLowerCase())).map(x=>{
      const locked=(task.lotoRequired&&x.code===permitFor(/loto|lock.?out|isolation/i))||(task.liveEquipment&&x.code===permitFor(/live/i));
      const on=(task.permitCodes||[]).includes(x.code);
      return <ChoiceChip key={x.code} checked={on} onToggle={()=>{if(locked)return;patch({permitCodes:on?(task.permitCodes||[]).filter(code=>code!==x.code):[...(task.permitCodes||[]),x.code]});}}>{x.label}{locked?' (required)':''}</ChoiceChip>;
     })}</div>
    </StepSection>
    <StepSection title='Task hazards and mitigation (SAF risk matrix)' hint='Hazards from selected energy sources and live work are added automatically. Complete impact, controls and risk ratings before saving.'>
     <div className='space-y-2'>
      {task.risk.map((risk,i)=><div key={i} className='space-y-2 rounded-xl border border-line bg-page p-3'>
        <label className={label}>Hazard<input className={input} value={risk.hazard} readOnly={!!risk.energyCode} onChange={e=>patch({risk:task.risk.map((x,j)=>i===j?{...x,hazard:e.target.value}:x)})}/></label>
        <label className={label}>Potential impact<input className={input} value={risk.impact} onChange={e=>patch({risk:task.risk.map((x,j)=>i===j?{...x,impact:e.target.value}:x)})}/></label>
        <label className={label}>Mitigations<textarea rows={2} className={input} value={risk.controls} onChange={e=>patch({risk:task.risk.map((x,j)=>i===j?{...x,controls:e.target.value}:x)})}/></label>
        {(['beforeRatings','afterRatings'] as const).map(kind=><div key={kind}>
         <p className='text-xs font-semibold text-ink'>{kind==='beforeRatings'?'Before mitigation':'After mitigation'}</p>
         <div className='grid grid-cols-2 gap-2'>{options.data?.riskMatrix?.factors.filter(x=>x.enabled).map(f=><label key={f.code} className={label}>{f.label}
          <select data-native-select='true' className={input} value={risk[kind]?.[f.code]||''} onChange={e=>patch({risk:task.risk.map((x,j)=>i===j?{...x,[kind]:{...(x[kind]||{}),[f.code]:Number(e.target.value)||0}}:x)})}>
           <option value=''>Choose</option>{Array.from({length:f.max},(_,n)=><option key={n+1} value={n+1}>{n+1}</option>)}</select></label>)}</div></div>)}
        {!risk.energyCode&&task.risk.length>1&&<button type='button' className='min-h-9 text-xs text-red-400' onClick={()=>patch({risk:task.risk.filter((_,j)=>j!==i)})}>Remove hazard</button>}
       </div>)}
      <Button variant='secondary' onClick={()=>patch({risk:[...task.risk,newRisk()]})}>+ Add activity hazard</Button>
     </div>
    </StepSection>
   </>}
   <OpenItems issues={issues[step]}/>
   <div className='flex flex-wrap gap-2'>
     <Button variant='secondary' disabled={step===0} onClick={()=>setStep(i=>Math.max(0,i-1))}>← Previous section</Button>
     <Button variant='secondary' disabled={step===4} onClick={()=>setStep(i=>Math.min(4,i+1))}>Next section →</Button>
     <Button variant='danger' className='ml-auto' onClick={()=>{setDirty(true);setTasks(old=>old.filter((_,i)=>i!==current));setCurrent(null);}}>Remove task</Button>
   </div>
  </div>;
}
