import {useEffect,useMemo,useState} from 'react';
import {Award,BookOpen,CheckCircle2,ChevronDown,GraduationCap,LockKeyhole,Pencil,Plus,Save,Trash2,X} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {SelectField} from '../components/ui';
import {rankEducation} from './hrEducationSort';
import './hrEducation.css';

type Education={id:string;institution:string;qualification:string;field:string;completionYear:string;levelCode:string;qualificationCode:string;gradingSystemCode:string;gradeCode:string};
type Config={levels:Array<{code:string;name:string;enabled:boolean;rank:number}>;qualifications:Array<{code:string;levelCode:string;name:string;enabled:boolean}>};
type Selection={entity:{id:string;name:string}|null;scope:'legal_entity'|'corporate'|'unassigned';config:Config|null};
const empty:Education={id:'',institution:'',qualification:'',field:'',completionYear:'',levelCode:'',qualificationCode:'',gradingSystemCode:'',gradeCode:''};
export default function HrEducationRecords({employeeUid,readOnly=false,onEducationChange}:{employeeUid:string;readOnly?:boolean;onEducationChange?:(qualification:string)=>void}){
 const [records,setRecords]=useState<Education[]>([]);
 const [selection,setSelection]=useState<Selection|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [editing,setEditing]=useState<number|null>(null);
 const [draft,setDraft]=useState<Education>(empty);
 const [error,setError]=useState('');
 const [catalogueError,setCatalogueError]=useState(false);
 const [notice,setNotice]=useState('');
 useEffect(()=>{
  let live=true;
  setRecords([]);setSelection(null);setEditing(null);setError('');setCatalogueError(false);setNotice('');setLoading(true);
  Promise.allSettled([
   callBackend<{education:Education[]}>('/api/org/hr/private/get',{uid:employeeUid}),
   callBackend<Selection>('/api/org/hr/education/config',{uid:employeeUid}),
  ]).then(([results,config])=>{
   if(!live)return;
   if(results.status==='fulfilled')setRecords(results.value.education||[]);
   else setError(results.reason instanceof Error?results.reason.message:'Education records could not be loaded.');
   if(config.status==='fulfilled')setSelection(config.value);
   else {setCatalogueError(true);setError(config.reason instanceof Error?config.reason.message:'Education configuration is unavailable.');}
  }).finally(()=>{if(live)setLoading(false)});
  return()=>{live=false};
 },[employeeUid]);
 const ordered=useMemo(()=>rankEducation(records,selection?.config?.levels||[]),[records,selection]);
 const canAdd=!readOnly&&Boolean(selection?.config)&&!busy;
 const start=(index:number)=>{
  setEditing(index);setDraft(index===-1?{...empty}:{...records[index]});
  setError('');setNotice('');
 };
 const save=async(next:Education[])=>{
  setBusy(true);setNotice('');setError('');
  try{
   const result=await callBackend<{items:Education[]}>('/api/org/hr/private/save',{
    uid:employeeUid,kind:'education',items:next,
   });
   setRecords(result.items);setEditing(null);
   onEducationChange?.(rankEducation(result.items,selection?.config?.levels||[])[0]?.record.qualification||'');
   setNotice('Education record saved successfully.');
  }catch(e){setError(e instanceof Error?e.message:'Could not save education records.')}
  finally{setBusy(false)}
 };
 const submit=()=>{
  if(editing===null)return;
  void save(editing===-1?[...records,draft]:records.map((item,i)=>i===editing?draft:item));
 };
 const remove=(index:number)=>{
  if(!window.confirm('Delete this education record?'))return;
  void save(records.filter((_,i)=>i!==index));
 };
 const chosenLevel=selection?.config?.levels.find(level=>level.code===draft.levelCode);
 const scope=catalogueError?'Unable to load catalogue':selection?.scope==='corporate'?'Corporate / Group Office':selection?.entity?.name||'Not assigned';
 return <section className="hr-edu" aria-label="Education records">
  <header className="hr-edu__head">
   <div className="hr-edu__head-icon"><GraduationCap size={23} aria-hidden="true"/></div>
   <div className="hr-edu__heading">
    <p className="hr-edu__eyebrow">My learning journey</p>
    <h2>Education & qualifications</h2>
    <p className="hr-edu__subheading">Academic and professional achievements, highest first</p>
   </div>
   {!readOnly&&<button type="button" disabled={!canAdd} onClick={()=>start(-1)} className="hr-edu__add">
    <Plus size={17} aria-hidden="true"/><span>Add</span>
   </button>}
  </header>
  <div className="hr-edu__scope">
   <BookOpen size={16} aria-hidden="true"/>
   <span>Qualification catalogue: <strong>{scope}</strong></span>
   <span className="hr-edu__count">{records.length} {records.length===1?'record':'records'}</span>
  </div>
  {loading&&<div role="status" className="hr-edu__empty">Loading your qualifications…</div>}
  {!loading&&!selection?.config&&!catalogueError&&<div role="status" className="hr-edu__unavailable">
   <LockKeyhole size={19} aria-hidden="true"/>
   <div><strong>Education setup needed</strong>
    <p>An HR administrator must assign an active legal entity or a corporate organizational unit. Education records remain private.</p></div>
  </div>}
  {!loading&&records.length===0&&<div className="hr-edu__empty">
   <div className="hr-edu__empty-icon"><GraduationCap size={29} aria-hidden="true"/></div>
   <h3>Your achievements belong here</h3>
   <p>Add your education, training qualifications and institutions. Your highest qualification will appear first on this page and your employee profile.</p>
   {canAdd&&<button type="button" onClick={()=>start(-1)} className="hr-edu__empty-action">Add first qualification <Plus size={15} aria-hidden="true"/></button>}
  </div>}
  {ordered.length>0&&<div className="hr-edu__records">
   {ordered.map(({record,originalIndex,rank},index)=>{
    const level=selection?.config?.levels.find(x=>x.code===record.levelCode);
    const highest=index===0&&rank>0;
    return <article key={record.id||originalIndex} className={'hr-edu__record '+(highest?'hr-edu__record--highest':'')}>
     <span className="hr-edu__record-icon">{highest?<Award size={21} aria-hidden="true"/>:<GraduationCap size={19} aria-hidden="true"/>}</span>
     <div className="hr-edu__record-main">
      <div className="hr-edu__record-badges">
       {highest&&<span className="hr-edu__highest">Highest qualification</span>}
       {level&&<span className="hr-edu__level">{level.name}</span>}
      </div>
      <h3>{record.qualification||'Qualification not recorded'}</h3>
      <p className="hr-edu__institution">{record.institution||'Institution not recorded'}</p>
      {(record.field||record.completionYear)&&<p className="hr-edu__metadata">
       {[record.field,record.completionYear].filter(Boolean).join(' · ')}
      </p>}
     </div>
     {!readOnly&&<div className="hr-edu__actions">
      <button type="button" onClick={()=>start(originalIndex)} aria-label={'Edit '+record.qualification} className="hr-edu__icon-btn"><Pencil size={16} aria-hidden="true"/></button>
      <button type="button" disabled={busy} onClick={()=>remove(originalIndex)} aria-label={'Delete '+record.qualification} className="hr-edu__icon-btn hr-edu__icon-btn--delete"><Trash2 size={16} aria-hidden="true"/></button>
     </div>}
    </article>;
   })}
  </div>}
  {editing!==null&&<div className="hr-edu__editor">
   <div className="hr-edu__editor-head">
    <div><p className="hr-edu__eyebrow">Qualification details</p><h3>{editing===-1?'Add education':'Edit education'}</h3></div>
    <button type="button" className="hr-edu__icon-btn" onClick={()=>setEditing(null)} aria-label="Close education editor"><X size={18}/></button>
   </div>
   <div className="hr-edu__form">
    <label className="hr-edu__field hr-edu__field--full"><span>Institution <em>*</em></span>
     <input value={draft.institution} maxLength={160} placeholder="University, college or training institution"
      onChange={event=>setDraft(d=>({...d,institution:event.target.value}))}/>
    </label>
    <div className="hr-edu__field">
     <SelectField id="hr-edu-level" label="Education level" required value={draft.levelCode}
      onChange={event=>setDraft(d=>({...d,levelCode:event.target.value,qualificationCode:'',qualification:'',gradingSystemCode:'',gradeCode:''}))}>
      <option value="">Choose level</option>
      {selection?.config?.levels.filter(x=>x.enabled||x.code===draft.levelCode)
       .sort((a,b)=>b.rank-a.rank).map(level=><option key={level.code} value={level.code}>{level.name}</option>)}
     </SelectField>
    </div>
    <div className="hr-edu__field">
     <SelectField id="hr-edu-qualification" label="Qualification" required value={draft.qualificationCode}
      disabled={!draft.levelCode} onChange={event=>{
       const q=selection?.config?.qualifications.find(x=>x.code===event.target.value);
       setDraft(d=>({...d,qualificationCode:event.target.value,qualification:q?.name||''}));
      }}>
      <option value="">Choose qualification</option>
      {selection?.config?.qualifications.filter(q=>q.levelCode===draft.levelCode&&(q.enabled||q.code===draft.qualificationCode))
       .map(q=><option key={q.code} value={q.code}>{q.name}</option>)}
     </SelectField>
    </div>
    <label className="hr-edu__field"><span>Field of study</span>
     <input value={draft.field} maxLength={140} placeholder="e.g. Mechanical engineering"
      onChange={event=>setDraft(d=>({...d,field:event.target.value}))}/>
    </label>
    <label className="hr-edu__field"><span>Completion year</span>
     <input type="number" min={1900} max={2100} value={draft.completionYear} placeholder="YYYY"
      onChange={event=>setDraft(d=>({...d,completionYear:event.target.value}))}/>
    </label>
    {chosenLevel&&<p className="hr-edu__rank-info">Education ranking: {chosenLevel.name} · rank {chosenLevel.rank}. Higher ranks are listed first.</p>}
   </div>
   <div className="hr-edu__editor-actions">
    <button type="button" onClick={()=>setEditing(null)} className="hr-edu__cancel">Cancel</button>
    <button type="button" disabled={busy||!selection?.config||!draft.institution.trim()||!draft.levelCode||!draft.qualificationCode}
     onClick={submit} className="hr-edu__save"><Save size={17} aria-hidden="true"/>{busy?'Saving…':'Save qualification'}</button>
   </div>
  </div>}
  {error&&<div role="alert" className="hr-edu__error">{error}</div>}
  {notice&&<div role="status" className="hr-edu__notice"><CheckCircle2 size={17} aria-hidden="true"/>{notice}</div>}
  <footer className="hr-edu__privacy"><LockKeyhole size={15} aria-hidden="true"/><span>Private employee education records. Visible to the employee and authorized HR super administrator.</span></footer>
 </section>;
}
