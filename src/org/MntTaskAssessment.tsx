import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Alert} from '../components/ui';
import {Button,Card} from '../admin/kit';
type Spare={id:string;source:'warehouse'|'catalog'|'description';materialId:string;catalogCode:string;description:string;qty:number;uom:string;unitCost:number|null};
type Service={id:string;categoryCode:string;subcategoryCode:string;classCode:string;catalogCode:string;description:string;attributes:Record<string,string>;proposedVendorIds:string[]};
type Risk={hazard:string;impact:string;controls:string;before:string;after:string;permit:string};
export type TaskAssessment={id:string;description:string;disciplineCode:string;resourceTypeCode:string;persons:number;hours:number;rate:number;tools:string;spares:Spare[];services:Service[];risk:Risk[];templateStatus:'pending_validation'|'existing'};
const seed=():TaskAssessment=>({id:'task_'+Math.random().toString(36).slice(2,10),description:'',disciplineCode:'',resourceTypeCode:'',persons:1,hours:1,rate:0,tools:'',spares:[],services:[],risk:[{hazard:'',impact:'',controls:'',before:'',after:'',permit:''}],templateStatus:'pending_validation'});
const input='mt-1 w-full rounded-xl border border-slate-600 bg-slate-900 p-3 text-base text-white';
const label='block text-sm text-slate-300';
export default function MntTaskAssessment({code,initial,onSaved,editable}:{code:string;initial:TaskAssessment[];onSaved:()=>void;editable:boolean}){
 const [tasks,setTasks]=useState<TaskAssessment[]>(initial.length?initial:[seed()]);
 const [current,setCurrent]=useState(0);
 const [saving,setSaving]=useState(false),[message,setMessage]=useState('');
 const task=tasks[current];
 const patch=(next:Partial<TaskAssessment>)=>setTasks(old=>old.map((t,i)=>i===current?{...t,...next}:t));
 const add=()=>{setTasks(old=>[...old,seed()]);setCurrent(tasks.length);};
 const save=async()=>{setSaving(true);setMessage('');
  try{await callBackend('/api/org/mnt/wr/action',{code,action:'save_task_assessment',tasks});setMessage('Task assessments saved to the work request.');onSaved();}
  catch(e){setMessage(e instanceof Error?e.message:'Unable to save task assessments.');}finally{setSaving(false);}
 };
 if(!editable)return <Card><h3 className='font-semibold text-white'>Task work assessment</h3>
   {initial.map((t,i)=><div key={t.id||i} className='border-b border-slate-700 py-3 text-sm'>
    <p className='font-medium text-white'>{i+1}. {t.description}</p><p className='text-slate-400'>{t.spares?.length||0} spares · {t.services?.length||0} services · {t.risk?.length||0} risks</p>
   </div>)}{!initial.length&&<p className='text-sm text-amber-300'>No task assessments recorded.</p>}</Card>;
 return <Card className='space-y-4'>
  <div><h3 className='font-semibold text-white'>Task-by-task work assessment</h3>
   <p className='mt-1 text-sm text-slate-400'>For each task, define spares, services, tools and its risk assessment here. Planning will secure these resources later.</p>
   <p className='mt-2 text-xs text-emerald-300'>Task {current+1} of {tasks.length}</p>
  </div>
  <div className='flex gap-2 overflow-x-auto pb-1'>{tasks.map((t,i)=><button key={t.id||i} type='button' onClick={()=>setCurrent(i)}
   className={`shrink-0 rounded-full border px-3 py-2 text-sm ${i===current?'border-emerald-500 bg-emerald-950 text-white':'border-slate-600 text-slate-300'}`}>Task {i+1}</button>)}</div>
  <label className={label}>What needs to be done?<textarea className={input} rows={3} value={task.description} onChange={e=>patch({description:e.target.value})} placeholder='Describe the task clearly'/></label>
  <div className='grid grid-cols-2 gap-3'>
   <label className={label}>Number of people<input type='number' min={1} className={input} value={task.persons} onChange={e=>patch({persons:Number(e.target.value)})}/></label>
   <label className={label}>Estimated hours<input type='number' min={0.25} step={0.25} className={input} value={task.hours} onChange={e=>patch({hours:Number(e.target.value)})}/></label>
  </div>
  <label className={label}>Tools required<textarea rows={2} className={input} value={task.tools} onChange={e=>patch({tools:e.target.value})} placeholder='Tools and equipment required'/></label>
  <section className='space-y-3 rounded-xl border border-slate-700 p-3'>
   <h4 className='font-semibold text-white'>Spares for this task</h4>
   {task.spares.map((s,i)=><div key={s.id} className='space-y-2 rounded-xl border border-slate-700 p-3'>
    <label className={label}>Spare source<select data-native-select='true' value={s.source} className={input} onChange={e=>patch({spares:task.spares.map((x,j)=>j===i?{...x,source:e.target.value as Spare['source']}:x)})}>
     <option value='warehouse'>Warehouse / stock</option><option value='catalog'>Technical catalogue</option><option value='description'>Description only</option>
    </select></label>
    <label className={label}>Description<input className={input} value={s.description} onChange={e=>patch({spares:task.spares.map((x,j)=>j===i?{...x,description:e.target.value}:x)})}/></label>
    {s.source!=='description'&&<label className={label}>{s.source==='warehouse'?'Warehouse material ID':'Catalogue item code'}<input className={input} value={s.source==='warehouse'?s.materialId:s.catalogCode} onChange={e=>patch({spares:task.spares.map((x,j)=>j===i?{...x,[s.source==='warehouse'?'materialId':'catalogCode']:e.target.value}:x)})}/></label>}
    <div className='grid grid-cols-2 gap-2'><label className={label}>Quantity<input type='number' step='any' min={0.001} className={input} value={s.qty} onChange={e=>patch({spares:task.spares.map((x,j)=>j===i?{...x,qty:Number(e.target.value)}:x)})}/></label>
    <label className={label}>Unit<input className={input} value={s.uom} onChange={e=>patch({spares:task.spares.map((x,j)=>j===i?{...x,uom:e.target.value}:x)})}/></label></div>
    <button type='button' className='text-xs text-red-300 underline' onClick={()=>patch({spares:task.spares.filter((_,j)=>j!==i)})}>Remove spare</button>
   </div>)}
   <Button variant='secondary' onClick={()=>patch({spares:[...task.spares,{id:'sp_'+Math.random().toString(36).slice(2,10),source:'description',materialId:'',catalogCode:'',description:'',qty:1,uom:'EA',unitCost:null}]})}>+ Add spare</Button>
  </section>
  <section className='space-y-3 rounded-xl border border-slate-700 p-3'><h4 className='font-semibold text-white'>Services for this task</h4>
   {task.services.map((s,i)=><div key={s.id} className='space-y-2 rounded-xl border border-slate-700 p-3'>
    {(['description','categoryCode','subcategoryCode','classCode','catalogCode'] as const).map(k=><label key={k} className={label}>{({description:'Service required',categoryCode:'Service category',subcategoryCode:'Subcategory',classCode:'Service class',catalogCode:'Catalogue code (optional)'})[k]}
     <input className={input} value={s[k]} onChange={e=>patch({services:task.services.map((x,j)=>j===i?{...x,[k]:e.target.value}:x)})}/></label>)}
    <label className={label}>Proposed vendor IDs (up to 3, comma-separated)<input className={input} value={s.proposedVendorIds.join(', ')} onChange={e=>patch({services:task.services.map((x,j)=>j===i?{...x,proposedVendorIds:e.target.value.split(',').map(z=>z.trim()).filter(Boolean)}:x)})}/></label>
    <button type='button' className='text-xs text-red-300 underline' onClick={()=>patch({services:task.services.filter((_,j)=>j!==i)})}>Remove service</button>
   </div>)}
   <Button variant='secondary' onClick={()=>patch({services:[...task.services,{id:'svc_'+Math.random().toString(36).slice(2,10),description:'',categoryCode:'',subcategoryCode:'',classCode:'',catalogCode:'',attributes:{},proposedVendorIds:[]}]})}>+ Add service</Button>
  </section>
  <section className='space-y-3 rounded-xl border border-slate-700 p-3'><h4 className='font-semibold text-white'>Risk assessment — this task</h4>
   {task.risk.map((r,i)=><div key={i} className='space-y-2 rounded-xl border border-slate-700 p-3'>
    {(['hazard','impact','before','controls','after','permit'] as const).map(k=><label key={k} className={label}>{({hazard:'Hazard',impact:'Impact',before:'Initial risk rating',controls:'Mitigation and safety controls',after:'Residual risk rating',permit:'Permit / isolation (if required)'})[k]}
     <input className={input} value={r[k]} onChange={e=>patch({risk:task.risk.map((x,j)=>j===i?{...x,[k]:e.target.value}:x)})}/></label>)}
    {task.risk.length>1&&<button type='button' className='text-xs text-red-300 underline' onClick={()=>patch({risk:task.risk.filter((_,j)=>j!==i)})}>Remove hazard</button>}
   </div>)}
   <Button variant='secondary' onClick={()=>patch({risk:[...task.risk,{hazard:'',impact:'',before:'',controls:'',after:'',permit:''}]})}>+ Add hazard</Button>
  </section>
  <div className='flex flex-wrap gap-2'>
   <Button variant='secondary' disabled={current===0} onClick={()=>setCurrent(i=>Math.max(i-1,0))}>← Previous task</Button>
   <Button variant='secondary' onClick={()=>current===tasks.length-1?add():setCurrent(i=>i+1)}>{current===tasks.length-1?'+ Add next task':'Next task →'}</Button>
   {tasks.length>1&&<Button variant='secondary' onClick={()=>{setTasks(tasks.filter((_,i)=>i!==current));setCurrent(Math.max(0,current-1));}}>Remove current task</Button>}
  </div>
  <Button busy={saving} disabled={saving} onClick={save}>Save complete task assessments</Button>
  {message&&<p className='text-sm text-amber-200'>{message}</p>}
 </Card>;
}
