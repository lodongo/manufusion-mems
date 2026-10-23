import {useEffect,useState} from 'react';
import {BookOpen,GraduationCap,Plus,Save,ShieldCheck,Trash2} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {SelectField} from '../components/ui';

type Level={code:string;name:string;description:string;enabled:boolean};
type Qualification={code:string;levelCode:string;name:string;description:string;enabled:boolean};
type Grade={code:string;name:string};
type System={code:string;name:string;description:string;enabled:boolean;grades:Grade[]};
type Config={levels:Level[];qualifications:Qualification[];gradingSystems:System[]};
type Entity={id:string;name:string};
const input='min-h-11 w-full rounded-xl border border-line bg-page px-3 text-base text-ink';
const button='min-h-11 rounded-xl border border-line px-3 text-sm font-semibold text-ink';
const token=()=>Math.random().toString(36).slice(2,8).toUpperCase();
export default function HrEducationAdmin(){
 const [entities,setEntities]=useState<Entity[]>([]),[entity,setEntity]=useState('');
 const [config,setConfig]=useState<Config|null>(null);
 const [tab,setTab]=useState<'levels'|'qualifications'|'grades'>('levels');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async(id='')=>{
  setLoading(true);setError('');
  try{
   const r=await callBackend<{entities:Entity[];entity:Entity|null;config:Config|null}>('/api/org/hr/education/admin',{legalEntityId:id});
   setEntities(r.entities);setEntity(r.entity?.id||'');setConfig(r.config);
  }catch(e){setError(e instanceof Error?e.message:'Unable to load education configuration.')}
  finally{setLoading(false)}
 };
 useEffect(()=>{void load()},[]);
 const update=(fn:(prev:Config)=>Config)=>setConfig(c=>c?fn(c):c);
 const levelChange=(idx:number,field:keyof Level,value:string|boolean)=>update(c=>({...c,levels:c.levels.map((x,i)=>i===idx?{...x,[field]:value}:x)}));
 const qChange=(idx:number,field:keyof Qualification,value:string|boolean)=>update(c=>({...c,qualifications:c.qualifications.map((x,i)=>i===idx?{...x,[field]:value}:x)}));
 const systemChange=(idx:number,field:keyof System,value:unknown)=>update(c=>({...c,gradingSystems:c.gradingSystems.map((x,i)=>i===idx?{...x,[field]:value}:x)}));
 const save=async()=>{
  if(!config||!entity)return;setBusy(true);setError('');setNotice('');
  try{
   await callBackend('/api/org/hr/education/admin/save',{legalEntityId:entity,config});
   setNotice('Legal-entity education qualifications and grading saved.');
   await load(entity);
  }catch(e){setError(e instanceof Error?e.message:'Unable to save education settings.')}
  finally{setBusy(false)}
 };
 return <div className="min-w-0 space-y-4">
  <header className="rounded-2xl border border-line bg-panel p-4">
   <h2 className="flex items-center gap-2 text-lg font-bold"><GraduationCap className="h-5 w-5 text-brand"/>Education & qualification settings</h2>
   <p className="mt-2 text-sm text-muted">Configure each legal entity's available education levels, qualifications and grading systems. These choices control employee education records.</p>
  </header>
  {loading&&<p className="text-sm text-muted">Loading configuration…</p>}
  {error&&<p role="alert" className="rounded-xl border border-line p-3 text-sm text-red-600">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm">{notice}</p>}
  <SelectField id="admin-education-legal-entity" label="Legal entity" value={entity}
   onChange={e=>void load(e.target.value)}>
   <option value="">Select legal entity</option>
   {entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
  </SelectField>
  {!loading&&!entities.length&&<p className="text-sm text-muted">Create a legal entity in Organization Structure before configuring qualifications.</p>}
  {config&&entity&&<>
   <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-panel p-1">
    {([['levels','Levels'],['qualifications','Qualifications'],['grades','Grading']] as const).map(([key,label])=>
     <button key={key} type="button" onClick={()=>setTab(key)} className={`min-h-11 rounded-lg px-2 text-xs font-semibold ${tab===key?'bg-brand/10 text-brand':'text-muted'}`}>{label}</button>)}
   </div>
   {tab==='levels'&&<section className="space-y-3">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Educational levels</h3>
     <button className={button} type="button" onClick={()=>update(c=>({...c,levels:[...c.levels,{code:'LEVEL_'+token(),name:'',description:'',enabled:true}]}))}><Plus className="mr-1 inline h-4 w-4"/>Add level</button>
    </div>
    {config.levels.map((row,i)=><div key={i} className="space-y-2 rounded-2xl border border-line bg-panel p-3">
     <label className="block text-sm text-muted">Code<input className={input} value={row.code} onChange={e=>levelChange(i,'code',e.target.value)} maxLength={64}/></label>
     <label className="block text-sm text-muted">Educational level<input className={input} value={row.name} onChange={e=>levelChange(i,'name',e.target.value)} maxLength={150}/></label>
     <label className="block text-sm text-muted">Description<input className={input} value={row.description} onChange={e=>levelChange(i,'description',e.target.value)} maxLength={350}/></label>
     <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={row.enabled} onChange={e=>levelChange(i,'enabled',e.target.checked)}/>Enabled</label>
    </div>)}
   </section>}
   {tab==='qualifications'&&<section className="space-y-3">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Legal-entity qualifications</h3>
     <button type="button" className={button} onClick={()=>update(c=>({...c,qualifications:[...c.qualifications,{code:'QUAL_'+token(),name:'',levelCode:c.levels[0]?.code||'',description:'',enabled:true}]}))}><Plus className="mr-1 inline h-4 w-4"/>Add</button>
    </div>
    {config.qualifications.map((row,i)=><div key={i} className="space-y-2 rounded-2xl border border-line bg-panel p-3">
     <label className="block text-sm text-muted">Qualification code<input className={input} value={row.code} onChange={e=>qChange(i,'code',e.target.value)} maxLength={64}/></label>
     <label className="block text-sm text-muted">Qualification name<input className={input} value={row.name} onChange={e=>qChange(i,'name',e.target.value)} maxLength={150}/></label>
     <SelectField id={'admin-education-q-level-'+i} label="Educational level" value={row.levelCode} onChange={e=>qChange(i,'levelCode',e.target.value)}>
      <option value="">Select level</option>{config.levels.filter(x=>x.enabled||x.code===row.levelCode).map(x=><option key={x.code} value={x.code}>{x.name}</option>)}
     </SelectField>
     <label className="block text-sm text-muted">Description<input className={input} value={row.description} onChange={e=>qChange(i,'description',e.target.value)} maxLength={350}/></label>
     <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={row.enabled} onChange={e=>qChange(i,'enabled',e.target.checked)}/>Enabled</label>
    </div>)}
   </section>}
   {tab==='grades'&&<section className="space-y-3">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Grading systems</h3>
     <button type="button" className={button} onClick={()=>update(c=>({...c,gradingSystems:[...c.gradingSystems,{code:'GRADE_'+token(),name:'',description:'',enabled:true,grades:[{code:'PASS',name:'Pass'}]}]}))}><Plus className="mr-1 inline h-4 w-4"/>Add system</button>
    </div>
    {config.gradingSystems.map((sys,i)=><div key={i} className="space-y-3 rounded-2xl border border-line bg-panel p-3">
     <label className="block text-sm text-muted">System code<input className={input} value={sys.code} onChange={e=>systemChange(i,'code',e.target.value)} maxLength={64}/></label>
     <label className="block text-sm text-muted">System name<input className={input} value={sys.name} onChange={e=>systemChange(i,'name',e.target.value)} maxLength={150}/></label>
     <label className="block text-sm text-muted">Description<input className={input} value={sys.description} onChange={e=>systemChange(i,'description',e.target.value)} maxLength={350}/></label>
     <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={sys.enabled} onChange={e=>systemChange(i,'enabled',e.target.checked)}/>Enabled</label>
     <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">Grade options ({sys.grades.length})</h4>
      <button type="button" className={button} onClick={()=>systemChange(i,'grades',[...sys.grades,{code:'NEW_'+token(),name:''}])}><Plus className="mr-1 inline h-4 w-4"/>Grade</button>
     </div>
     <div className="space-y-2">{sys.grades.map((grade,j)=><div key={j} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
      <label className="min-w-0 text-xs text-muted">Code<input className={input} aria-label={'Grade code '+(j+1)} value={grade.code}
        onChange={e=>systemChange(i,'grades',sys.grades.map((x,k)=>k===j?{...x,code:e.target.value}:x))}/></label>
      <label className="min-w-0 text-xs text-muted">Label<input className={input} aria-label={'Grade name '+(j+1)} value={grade.name}
        onChange={e=>systemChange(i,'grades',sys.grades.map((x,k)=>k===j?{...x,name:e.target.value}:x))}/></label>
      <button type="button" aria-label="Delete grade option" disabled={sys.grades.length===1}
       className="mt-4 flex h-11 w-11 items-center justify-center rounded-lg border border-line text-red-600 disabled:opacity-40"
       onClick={()=>systemChange(i,'grades',sys.grades.filter((_,k)=>k!==j))}><Trash2 className="h-4 w-4"/></button>
     </div>)}</div>
    </div>)}
   </section>}
   <button type="button" disabled={busy||loading} onClick={()=>void save()}
    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-onbrand disabled:opacity-40"><Save className="h-5 w-5"/>Save legal-entity education settings</button>
  </>}
  <p className="flex items-center gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4"/>Configuration changes do not erase historical education records.</p>
 </div>;
}
