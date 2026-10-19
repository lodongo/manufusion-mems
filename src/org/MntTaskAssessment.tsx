import {useEffect,useState} from 'react';
import {callBackend} from '../lib/backend';
import {Alert} from '../components/ui';
import {Button,Card,useLoad} from '../admin/kit';
type Spare={id:string;source:'warehouse'|'catalog'|'description';materialId:string;warehouseId:string;catalogCode:string;description:string;qty:number;uom:string;unitCost:number|null};
type Service={id:string;categoryCode:string;subcategoryCode:string;classCode:string;catalogCode:string;description:string;attributes:Record<string,string>;proposedVendorIds:string[]};
type Risk={hazard:string;impact:string;controls:string;before:string;after:string;permit:string;beforeRatings?:Record<string,number>;afterRatings?:Record<string,number>};
type RiskMatrix={version:number;formula:'multiply'|'add';factors:Array<{code:string;label:string;max:number;enabled:boolean}>;bands:Array<{label:string;min:number;max:number;color:string}>};
type ServiceHierarchy={categories:Array<{code:string;name:string}>;subcategories:Array<{code:string;name:string;categoryCode:string}>;families:Array<{code:string;name:string;subcategoryCode:string}>};
export type TaskAssessment={id:string;description:string;disciplineCode:string;resourceTypeCode:string;persons:number;hours:number;rate:number;tools:string;spares:Spare[];services:Service[];risk:Risk[];templateStatus:'pending_validation'|'existing'};
const seed=():TaskAssessment=>({id:'task_'+Math.random().toString(36).slice(2,10),description:'',disciplineCode:'',resourceTypeCode:'',persons:1,hours:1,rate:0,tools:'',spares:[],services:[],risk:[{hazard:'',impact:'',controls:'',before:'',after:'',permit:'',beforeRatings:{},afterRatings:{}}],templateStatus:'pending_validation'});
const input='mt-1 w-full rounded-xl border border-slate-600 bg-slate-900 p-3 text-base text-white';
const label='block text-sm text-slate-300';
function WarehouseSparePicker({onSelect}:{onSelect:(item:{materialId:string;warehouseId:string;materialNumber:string;name:string;uom:string;available:number|null;stockVerified:boolean;warehouseName:string})=>void}){
 const [query,setQuery]=useState(''),[items,setItems]=useState<Array<{materialId:string;warehouseId:string;materialNumber:string;name:string;uom:string;available:number|null;stockVerified:boolean;warehouseName:string}>>([]);
 const [busy,setBusy]=useState(false);
 useEffect(()=>{if(query.trim().length<2){setItems([]);return;}
  let live=true;const timer=setTimeout(async()=>{setBusy(true);
   try{const response=await callBackend<{items:typeof items}>('/api/org/mnt/warehouse-spares/search',{q:query.trim()});
    if(live)setItems(response.items);
   }catch{if(live)setItems([]);}finally{if(live)setBusy(false);}
  },350);
  return()=>{live=false;clearTimeout(timer);};
 },[query]);
 return <div className='space-y-2 rounded-xl border border-emerald-700 p-3'>
  <label className={label}>Choose a spare from your warehouse
    <input type='search' className={input} value={query} onChange={e=>setQuery(e.target.value)} placeholder='Material number or name'/>
  </label>
  {busy&&<p className='text-xs text-slate-400'>Checking approved warehouse materials…</p>}
  <div className='max-h-60 space-y-2 overflow-auto'>{items.map(item=><button type='button' key={item.materialId+':'+item.warehouseId}
    className='w-full rounded-lg border border-slate-700 p-3 text-left text-sm text-white'
    onClick={()=>{onSelect(item);setQuery('');setItems([]);}}>
    <span className='font-mono text-xs text-emerald-300'>{item.materialNumber}</span> · {item.name}
    <span className='block text-xs text-slate-400'>{item.warehouseName} · {item.stockVerified?'Available: '+item.available+' '+item.uom:'Stock ledger not verified — availability pending'}</span>
  </button>)}</div>
 </div>;
}
function CatalogPicker({kind,onSelect}:{kind:'materials'|'services';onSelect:(item:{code:string;name:string;family:string})=>void}){
 const [q,setQ]=useState(''),[rows,setRows]=useState<Array<{code:string;name:string;family:string}>>([]);
 const [loading,setLoading]=useState(false);
 useEffect(()=>{if(q.trim().length<2){setRows([]);return;}
   let alive=true;const handle=setTimeout(async()=>{setLoading(true);
    try{const result=await callBackend<{items:Array<{code:string;name:string;family:string}>}>('/api/org/mnt/catalog-search',{kind,q:q.trim()});
      if(alive)setRows(result.items||[]);
    }catch{if(alive)setRows([]);}finally{if(alive)setLoading(false);}
   },320);
   return()=>{alive=false;clearTimeout(handle);};
 },[q,kind]);
 return <div className='space-y-2 rounded-xl border border-emerald-700 p-3'>
  <label className={label}>Find an approved catalogue specification
   <input type='search' className={input} placeholder='Search by material or service name / code' value={q} onChange={e=>setQ(e.target.value)}/>
  </label>
  {loading&&<p className='text-xs text-slate-400'>Searching catalogue…</p>}
  <div className='max-h-52 space-y-1 overflow-auto'>{rows.map(r=><button key={r.code} type='button' onClick={()=>{onSelect(r);setQ('');setRows([]);}}
    className='w-full rounded-lg border border-slate-700 p-2 text-left text-sm text-white'>
    <span className='font-mono text-xs text-emerald-300'>{r.code}</span> · {r.name}
    {r.family&&<span className='block text-xs text-slate-400'>{r.family}</span>}
  </button>)}</div>
 </div>;
}
export default function MntTaskAssessment({code,initial,onSaved,editable}:{code:string;initial:TaskAssessment[];onSaved:()=>void;editable:boolean}){
 const [tasks,setTasks]=useState<TaskAssessment[]>(initial.length?initial:[seed()]);
 const vendorOptions=useLoad(()=>callBackend<{vendors:Array<{id:string;name:string}>;riskMatrix:RiskMatrix;serviceHierarchy:ServiceHierarchy}>('/api/org/mnt/assessment/options'));
 const library=useLoad(()=>callBackend<{items:Array<{id:string;version:number;task:TaskAssessment}>}>('/api/org/mnt/tasks/library',{code}),[code]);
 const [current,setCurrent]=useState(0);
 const [section,setSection]=useState(0);
 const [gestureStart,setGestureStart]=useState<number|null>(null);
 const sections=['Task','Spares','Services','Safety','Review'];
 const [saving,setSaving]=useState(false),[message,setMessage]=useState('');
 const task=tasks[current];
 const patch=(next:Partial<TaskAssessment>)=>setTasks(old=>old.map((t,i)=>i===current?{...t,...next}:t));
 const add=()=>{setTasks(old=>[...old,seed()]);setCurrent(tasks.length);setSection(0);};
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
  <nav aria-label='Assessment sections' className='flex gap-1 overflow-x-auto'>
    {sections.map((name,i)=><button key={name} type='button' onClick={()=>setSection(i)}
      className={`shrink-0 rounded-xl px-3 py-2 text-sm ${section===i?'bg-emerald-800 font-semibold text-white':'bg-slate-800 text-slate-300'}`}>{i+1}. {name}</button>)}
  </nav>
  <div onTouchStart={e=>setGestureStart(e.touches[0]?.clientX??null)}
    onTouchEnd={e=>{const end=e.changedTouches[0]?.clientX??null;if(gestureStart!==null&&end!==null&&Math.abs(end-gestureStart)>90)setSection(n=>Math.max(0,Math.min(4,n+(end<gestureStart?1:-1))));setGestureStart(null);}}
    className='space-y-3'>
  {section===0&&<>
  {library.data?.items.length? <div className='rounded-xl border border-slate-700 p-3'>
   <p className='text-sm font-semibold text-white'>Reuse an approved task for this assembly</p>
   <div className='mt-2 max-h-40 space-y-2 overflow-y-auto'>{library.data.items.map(item=><button key={item.id}
      className='w-full rounded-lg border border-slate-700 p-3 text-left text-sm text-slate-200' type='button'
      onClick={()=>{if(tasks.some(t=>t.id===item.id)){setMessage('This task is already selected.');return;}
        setTasks(old=>[...old,{...item.task,id:item.id,templateStatus:'existing'}]);
        setCurrent(tasks.length);setSection(0);}}>
      {item.task.description} · approved v{item.version}
   </button>)}</div>
  </div>:null}
  <label className={label}>What needs to be done?<textarea className={input} rows={3} value={task.description} onChange={e=>patch({description:e.target.value})} placeholder='Describe the task clearly'/></label>
  <div className='grid grid-cols-2 gap-3'>
   <label className={label}>Number of people<input type='number' min={1} className={input} value={task.persons} onChange={e=>patch({persons:Number(e.target.value)})}/></label>
   <label className={label}>Estimated hours<input type='number' min={0.25} step={0.25} className={input} value={task.hours} onChange={e=>patch({hours:Number(e.target.value)})}/></label>
  </div>
  <label className={label}>Tools required<textarea rows={2} className={input} value={task.tools} onChange={e=>patch({tools:e.target.value})} placeholder='Tools and equipment required'/></label>
  </>}
  {section===1&&<section className='space-y-3 rounded-xl border border-slate-700 p-3'>
   <h4 className='font-semibold text-white'>Spares for this task</h4>
   {task.spares.map((s,i)=><div key={s.id} className='space-y-2 rounded-xl border border-slate-700 p-3'>
    <label className={label}>Spare source<select data-native-select='true' value={s.source} className={input} onChange={e=>patch({spares:task.spares.map((x,j)=>j===i?{...x,source:e.target.value as Spare['source']}:x)})}>
     <option value='warehouse'>Warehouse / stock</option><option value='catalog'>Technical catalogue</option><option value='description'>Description only</option>
    </select></label>
    <label className={label}>Description<input className={input} value={s.description} onChange={e=>patch({spares:task.spares.map((x,j)=>j===i?{...x,description:e.target.value}:x)})}/></label>
    {s.source!=='description'&&<label className={label}>{s.source==='warehouse'?'Warehouse material / warehouse IDs':'Technical catalogue code'}<input className={input} readOnly={s.source==='warehouse'} value={s.source==='warehouse'?s.materialId+' / '+s.warehouseId:s.catalogCode} onChange={e=>patch({spares:task.spares.map((x,j)=>j===i?{...x,catalogCode:e.target.value}:x)})}/></label>}
    <div className='grid grid-cols-2 gap-2'><label className={label}>Quantity<input type='number' step='any' min={0.001} className={input} value={s.qty} onChange={e=>patch({spares:task.spares.map((x,j)=>j===i?{...x,qty:Number(e.target.value)}:x)})}/></label>
    <label className={label}>Unit<input className={input} value={s.uom} onChange={e=>patch({spares:task.spares.map((x,j)=>j===i?{...x,uom:e.target.value}:x)})}/></label></div>
    <button type='button' className='text-xs text-red-300 underline' onClick={()=>patch({spares:task.spares.filter((_,j)=>j!==i)})}>Remove spare</button>
   </div>)}
   <WarehouseSparePicker onSelect={item=>patch({spares:[...task.spares,{
      id:'sp_'+Math.random().toString(36).slice(2,10),source:'warehouse',materialId:item.materialId,
      warehouseId:item.warehouseId,catalogCode:'',description:item.name,qty:1,uom:item.uom,unitCost:null
   }]})}/>
   <CatalogPicker kind='materials' onSelect={item=>patch({spares:[...task.spares,{id:'sp_'+Math.random().toString(36).slice(2,10),source:'catalog',materialId:'',warehouseId:'',catalogCode:item.code,description:item.name,qty:1,uom:'EA',unitCost:null}]})}/>
   <Button variant='secondary' onClick={()=>patch({spares:[...task.spares,{id:'sp_'+Math.random().toString(36).slice(2,10),source:'description',materialId:'',warehouseId:'',catalogCode:'',description:'',qty:1,uom:'EA',unitCost:null}]})}>+ Add spare</Button>
  </section>}
  {section===2&&<section className='space-y-3 rounded-xl border border-slate-700 p-3'><h4 className='font-semibold text-white'>Services for this task</h4>
   {task.services.map((s,i)=><div key={s.id} className='space-y-2 rounded-xl border border-slate-700 p-3'>
    <label className={label}>Service required<input className={input} value={s.description} onChange={e=>patch({services:task.services.map((x,j)=>j===i?{...x,description:e.target.value}:x)})}/></label>
    <label className={label}>Service category
      <select data-native-select='true' className={input} value={s.categoryCode}
        onChange={e=>patch({services:task.services.map((x,j)=>j===i?{...x,categoryCode:e.target.value,subcategoryCode:'',classCode:''}:x)})}>
        <option value=''>Choose category</option>
        {(vendorOptions.data?.serviceHierarchy.categories||[]).map(c=><option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
      </select>
    </label>
    <label className={label}>Service subcategory
      <select data-native-select='true' className={input} value={s.subcategoryCode}
        onChange={e=>patch({services:task.services.map((x,j)=>j===i?{...x,subcategoryCode:e.target.value,classCode:''}:x)})}>
        <option value=''>Choose subcategory</option>
        {(vendorOptions.data?.serviceHierarchy.subcategories||[]).filter(c=>c.categoryCode===s.categoryCode).map(c=><option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
      </select>
    </label>
    <label className={label}>Service family / class
      <select data-native-select='true' className={input} value={s.classCode}
        onChange={e=>patch({services:task.services.map((x,j)=>j===i?{...x,classCode:e.target.value}:x)})}>
        <option value=''>Choose service class</option>
        {(vendorOptions.data?.serviceHierarchy.families||[]).filter(c=>c.subcategoryCode===s.subcategoryCode).map(c=><option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
      </select>
    </label>
    <label className={label}>Catalogue service code (if selected)<input readOnly className={input} value={s.catalogCode||''}/></label>
    <label className={label}>Technical service attributes (key: value, one per line)
      <textarea rows={3} className={input} value={Object.entries(s.attributes).map(([k,v])=>k+': '+v).join('\n')}
        onChange={e=>patch({services:task.services.map((x,j)=>j===i?{...x,attributes:Object.fromEntries(e.target.value.split('\n').filter(x=>x.includes(':')).map(x=>{const at=x.indexOf(':');return [x.slice(0,at).trim(),x.slice(at+1).trim()]}).filter(x=>x[0]))}:x)})}/>
    </label>
    {!vendorOptions.data?.serviceHierarchy.categories.length&&<p className='text-xs text-amber-300'>Service hierarchy not loaded in the MEMS catalogue. An administrator must adopt it before classification can be completed.</p>}

    <fieldset className='space-y-2'><legend className={label}>Proposed service vendors (up to 3; Procurement makes final selection)</legend>
      {vendorOptions.error&&<p className='text-xs text-amber-300'>Approved vendor list unavailable: {vendorOptions.error}</p>}
      {vendorOptions.data?.vendors.map(v=><label key={v.id} className='flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-sm text-white'>
        <input type='checkbox' checked={s.proposedVendorIds.includes(v.id)}
          disabled={!s.proposedVendorIds.includes(v.id)&&s.proposedVendorIds.length>=3}
          onChange={e=>patch({services:task.services.map((x,j)=>j===i?{...x,proposedVendorIds:e.target.checked?[...x.proposedVendorIds,v.id]:x.proposedVendorIds.filter(id=>id!==v.id)}:x)})}/>
        {v.name}
      </label>)}
      {vendorOptions.data?.vendors.length===0&&<p className='text-xs text-slate-400'>No approved service vendors available.</p>}
    </fieldset>
    <button type='button' className='text-xs text-red-300 underline' onClick={()=>patch({services:task.services.filter((_,j)=>j!==i)})}>Remove service</button>
   </div>)}
   <CatalogPicker kind='services' onSelect={item=>patch({services:[...task.services,{id:'svc_'+Math.random().toString(36).slice(2,10),description:item.name,categoryCode:'',subcategoryCode:'',classCode:'',catalogCode:item.code,attributes:{},proposedVendorIds:[]}]})}/>
   <Button variant='secondary' onClick={()=>patch({services:[...task.services,{id:'svc_'+Math.random().toString(36).slice(2,10),description:'',categoryCode:'',subcategoryCode:'',classCode:'',catalogCode:'',attributes:{},proposedVendorIds:[]}]})}>+ Add service</Button>
  </section>}
  {section===3&&<section className='space-y-3 rounded-xl border border-slate-700 p-3'><h4 className='font-semibold text-white'>Risk assessment — this task</h4>
   {task.risk.map((r,i)=><div key={i} className='space-y-2 rounded-xl border border-slate-700 p-3'>
    {(['hazard','impact','controls','permit'] as const).map(k=><label key={k} className={label}>{({hazard:'Hazard / unsafe condition',impact:'Potential impact',controls:'Mitigation and preventive controls',permit:'Required permit / LOTO (if applicable)'})[k]}
     <input className={input} value={r[k]} onChange={e=>patch({risk:task.risk.map((x,j)=>j===i?{...x,[k]:e.target.value}:x)})}/></label>)}
    {(['beforeRatings','afterRatings'] as const).map(key=><div key={key} className='space-y-2 rounded-lg border border-slate-600 p-3'>
      <h5 className='text-sm font-semibold text-white'>{key==='beforeRatings'?'Initial risk rating':'Residual risk after controls'}</h5>
      <div className='grid grid-cols-2 gap-2'>
       {(vendorOptions.data?.riskMatrix.factors||[]).filter(f=>f.enabled).map(f=><label key={f.code} className={label}>{f.label}
         <select data-native-select='true' className={input} value={r[key]?.[f.code]||''}
           onChange={e=>patch({risk:task.risk.map((x,j)=>j===i?{...x,[key]:{...(x[key]||{}),[f.code]:Number(e.target.value)||0}}:x)})}>
           <option value=''>Select rating</option>
           {Array.from({length:f.max},(_,n)=><option key={n+1} value={n+1}>{n+1}</option>)}
         </select>
       </label>)}
      </div>
      <p className='text-xs text-slate-400'>Scored automatically using organization SAF matrix v{vendorOptions.data?.riskMatrix.version||'—'}.</p>
    </div>)}

    {task.risk.length>1&&<button type='button' className='text-xs text-red-300 underline' onClick={()=>patch({risk:task.risk.filter((_,j)=>j!==i)})}>Remove hazard</button>}
   </div>)}
   <Button variant='secondary' onClick={()=>patch({risk:[...task.risk,{hazard:'',impact:'',before:'',controls:'',after:'',permit:'',beforeRatings:{},afterRatings:{}}]})}>+ Add hazard</Button>
  </section>}
  {section===4&&<div className='space-y-2 rounded-xl border border-emerald-700 p-3 text-sm'>
    <p className='font-semibold text-white'>{task.description||'Unnamed task'}</p>
    <p>{task.spares.length} spares · {task.services.length} services · {task.risk.length} hazard assessments</p>
    <p className='text-slate-400'>People: {task.persons} · Duration: {task.hours} hours</p>
    <p className='text-xs text-amber-300'>New task templates await validation before reuse. Risk assessment is mandatory but does not require a separate approval.</p>
   </div>}
  </div>
  <div className='flex flex-wrap gap-2'>
   <Button variant='secondary' disabled={section===0} onClick={()=>setSection(i=>Math.max(i-1,0))}>← Back</Button>
   <Button variant='secondary' disabled={section===4} onClick={()=>setSection(i=>Math.min(i+1,4))}>Next section →</Button>
  </div>
  <div className='flex flex-wrap gap-2'>
   <Button variant='secondary' disabled={current===0} onClick={()=>{setCurrent(i=>Math.max(i-1,0));setSection(0);}}>← Previous task</Button>
   <Button variant='secondary' onClick={()=>current===tasks.length-1?add():(setCurrent(i=>i+1),setSection(0))}>{current===tasks.length-1?'+ Add next task':'Next task →'}</Button>
   {tasks.length>1&&<Button variant='secondary' onClick={()=>{setTasks(tasks.filter((_,i)=>i!==current));setCurrent(Math.max(0,current-1));}}>Remove current task</Button>}
  </div>
  <Button busy={saving} disabled={saving} onClick={save}>Save complete task assessments</Button>
  {message&&<p className='text-sm text-amber-200'>{message}</p>}
 </Card>;
}
