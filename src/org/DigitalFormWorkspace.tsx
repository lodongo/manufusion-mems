import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Card,useLoad} from '../admin/kit';
type Field={code:string;label:string;type:string;required:boolean;options?:string[];section?:string;visibleWhen?:{fieldCode:string;equals:string|boolean}};
type Template={id:string;title:string;status:string;fields:Field[];revision:string};
type RecordRow={id:string;templateId:string;values:Record<string,string|number|boolean|null>;status:string;operationalReference?:{module:string;recordId:string}};
const choices=['text','long_text','number','date','yes_no','select'];
export default function DigitalFormWorkspace({locations}:{locations:Array<{id:string;name:string}>}){
 const templates=useLoad(()=>callBackend<{templates:Template[]}>('/api/org/drkms/forms/templates/list',{}),[]);
 const records=useLoad(()=>callBackend<{records:RecordRow[]}>('/api/org/drkms/forms/records/list',{}),[]);
 const [title,setTitle]=useState(''),[location,setLocation]=useState(''),[fields,setFields]=useState<Field[]>([{code:'observation',label:'Observation',type:'long_text',required:true}]);
 const [selected,setSelected]=useState(''),[recordId,setRecordId]=useState(''),[values,setValues]=useState<Record<string,string|number|boolean|null>>({});
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [referenceModule,setReferenceModule]=useState(''),[referenceId,setReferenceId]=useState('');
 const add=()=>setFields(v=>[...v,{code:'field_'+(v.length+1),label:'New field',type:'text',required:false}]);
 const patch=(i:number,part:Partial<Field>)=>setFields(v=>v.map((f,j)=>i===j?{...f,...part}:f));
 const create=async()=>{setBusy(true);setNotice('');
  try{await callBackend('/api/org/drkms/forms/templates/create',{title,scopeNodeId:location,fields});
   setNotice('Draft form template created. It is not an approved or published form.');templates.reload();
  }catch(e){setNotice(e instanceof Error?e.message:'Unable to create template.')}finally{setBusy(false)}
 };
 const template=templates.data?.templates.find(t=>t.id===selected);
 const save=async()=>{if(!template)return;setBusy(true);setNotice('');
  try{const result=await callBackend<{record:RecordRow}>('/api/org/drkms/forms/records/save',{templateId:selected,recordId,values,operationalReference:referenceModule&&referenceId.trim()?{module:referenceModule,recordId:referenceId.trim()}:null});
   setRecordId(result.record.id);records.reload();setNotice('Unapproved draft record saved.');
  }catch(e){setNotice(e instanceof Error?e.message:'Could not save form.')}finally{setBusy(false)}
 };
 const entry=(f:Field)=>{const value=values[f.code];const set=(v:string|number|boolean|null)=>setValues(old=>({...old,[f.code]:v}));
  if(f.type==='yes_no')return <select aria-label={f.label} value={value===true?'true':value===false?'false':''} onChange={e=>set(e.target.value===''?null:e.target.value==='true')} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'><option value=''>Select</option><option value='true'>Yes</option><option value='false'>No</option></select>;
  if(f.type==='select')return <select aria-label={f.label} value={String(value??'')} onChange={e=>set(e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'><option value=''>Select</option>{(f.options??[]).map(x=><option key={x} value={x}>{x}</option>)}</select>;
  if(f.type==='long_text')return <textarea rows={3} value={String(value??'')} onChange={e=>set(e.target.value)} className='mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-white'/>;
  return <input type={f.type==='number'?'number':f.type==='date'?'date':'text'} value={value===null||value===undefined?'':String(value)} onChange={e=>set(f.type==='number'?(e.target.value===''?null:Number(e.target.value)):e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'/>;
 };
 return <div className='space-y-3'>
  <Card><h2 className='font-semibold text-white'>Draft form template designer</h2><p className='my-2 text-xs text-amber-300'>Draft-only foundation. These forms cannot be published or represented as approved signed records.</p>
   <label className='block text-sm text-slate-200'>Template name<input value={title} onChange={e=>setTitle(e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'/></label>
   <label className='mt-2 block text-sm text-slate-200'>Applicable organization location<select value={location} onChange={e=>setLocation(e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'><option value=''>Select location</option>{locations.map(l=><option value={l.id} key={l.id}>{l.name}</option>)}</select></label>
   {fields.map((f,i)=><div key={i} className='my-2 space-y-2 rounded-lg border border-slate-700 p-3'>
    <div className='grid grid-cols-2 gap-2'><label className='text-xs text-slate-200'>Field code<input value={f.code} onChange={e=>patch(i,{code:e.target.value})} className='mt-1 min-h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 text-white'/></label><label className='text-xs text-slate-200'>Label<input value={f.label} onChange={e=>patch(i,{label:e.target.value})} className='mt-1 min-h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 text-white'/></label></div>
    <select aria-label={'Type for '+f.label} value={f.type} onChange={e=>patch(i,{type:e.target.value})} className='min-h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 text-white'>{choices.map(v=><option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}</select>
    {f.type==='select'&&<input placeholder='Choices separated by commas' value={f.options?.join(', ')??''} onChange={e=>patch(i,{options:e.target.value.split(',').map(x=>x.trim())})} className='min-h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 text-white'/>}
    <label className='block text-xs text-slate-200'>Section<input value={f.section??'General'} onChange={e=>patch(i,{section:e.target.value})} className='mt-1 min-h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 text-white'/></label>
    <label className='block text-xs text-slate-200'>Show only if preceding field<select aria-label={'Condition field for '+f.label} value={f.visibleWhen?.fieldCode??''} onChange={e=>{const p=fields.find(x=>x.code===e.target.value);patch(i,{visibleWhen:p?{fieldCode:p.code,equals:p.type==='yes_no'?true:p.options?.[0]??''}:undefined})}} className='mt-1 min-h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 text-white'><option value=''>Always visible</option>{fields.slice(0,i).filter(x=>x.type==='yes_no'||x.type==='select').map(x=><option key={x.code} value={x.code}>{x.label}</option>)}</select></label>
    {f.visibleWhen&&<label className='block text-xs text-slate-200'>Equals<select aria-label={'Condition value for '+f.label} value={String(f.visibleWhen.equals)} onChange={e=>{const p=fields.find(x=>x.code===f.visibleWhen?.fieldCode);patch(i,{visibleWhen:{fieldCode:f.visibleWhen!.fieldCode,equals:p?.type==='yes_no'?e.target.value==='true':e.target.value}})}} className='mt-1 min-h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 text-white'>{(fields.find(x=>x.code===f.visibleWhen?.fieldCode)?.type==='yes_no'?['true','false']:fields.find(x=>x.code===f.visibleWhen?.fieldCode)?.options??[]).map(x=><option key={x} value={x}>{x}</option>)}</select></label>}
    <label className='flex gap-2 text-xs text-slate-200'><input type='checkbox' checked={f.required} onChange={e=>patch(i,{required:e.target.checked})}/>Required</label>
    <button type='button' onClick={()=>setFields(v=>v.filter((_,j)=>j!==i))} className='text-xs text-red-300'>Remove field</button>
   </div>)}
   <button type='button' onClick={add} disabled={fields.length>=60} className='min-h-10 rounded-lg border border-slate-600 px-3 text-sm text-white'>Add field</button>
   <button type='button' onClick={()=>void create()} disabled={busy||title.trim().length<3||!location||!fields.length} className='ml-2 min-h-10 rounded-lg bg-blue-600 px-3 text-sm text-white disabled:opacity-50'>Save draft template</button>
  </Card>
  <Card><h2 className='font-semibold text-white'>Complete a draft form</h2>
   <select value={selected} onChange={e=>{setSelected(e.target.value);setRecordId('');setValues({})}} className='my-2 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'><option value=''>Select a draft template</option>{templates.data?.templates.filter(t=>t.status==='draft').map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select>
   {template?.fields.map((f,i)=>{const visible=!f.visibleWhen||values[f.visibleWhen.fieldCode]===f.visibleWhen.equals;
    if(!visible)return null;
    const preceding=template.fields[i-1],showHeading=!preceding||preceding.section!==f.section;
    return <div key={f.code}>{showHeading&&<h3 className='mb-2 mt-4 border-b border-slate-700 pb-2 text-sm font-semibold text-white'>{f.section??'General'}</h3>}
     <label className='mb-3 block text-sm text-slate-200'>{f.label}{f.required?' *':''}{entry(f)}</label>
    </div>})}
   {template&&<div className='mb-3 space-y-2 rounded-lg border border-slate-700 p-3'>
    <p className='text-xs text-slate-300'>Optional operational source reference (draft; not independently verified)</p>
    <select aria-label='Operational module' value={referenceModule} onChange={e=>setReferenceModule(e.target.value)} className='min-h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 text-white'>
     <option value=''>No linked record</option>{[['MNT','Maintenance'],['SAF','Safety'],['MFG','Manufacturing'],['QLT','Quality'],['AST','Asset']].map(([code,label])=><option key={code} value={code}>{label}</option>)}
    </select>
    {referenceModule&&<input aria-label='Source record identifier' value={referenceId} onChange={e=>setReferenceId(e.target.value)} placeholder='Existing event or asset record ID' className='min-h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 text-white'/>}
   </div>}
   {template&&<button type='button' disabled={busy} onClick={()=>void save()} className='min-h-11 rounded-lg bg-blue-600 px-3 text-sm text-white'>Save unapproved draft</button>}
   <h3 className='mt-4 text-sm font-medium text-white'>My draft records</h3>
   {records.data?.records.map(r=><button key={r.id} type='button' onClick={()=>{setSelected(r.templateId);setValues(r.values);setRecordId(r.id);setReferenceModule(r.operationalReference?.module??'');setReferenceId(r.operationalReference?.recordId??'')}} className='mt-2 block min-h-10 w-full rounded-lg border border-slate-700 px-3 text-left text-sm text-slate-200'>{r.id} · Draft (unapproved)</button>)}
  </Card>
  {notice&&<p role='status' className='text-sm text-slate-200'>{notice}</p>}
 </div>;
}
