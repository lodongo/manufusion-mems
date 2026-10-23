import {useEffect,useState} from 'react';
import {ArrowRightLeft,BriefcaseBusiness,GraduationCap,Plus,Save,ShieldCheck,Trash2} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {SelectField} from '../components/ui';

type Level={code:string;name:string;description:string;enabled:boolean;rank:number};
type Qualification={code:string;levelCode:string;name:string;description:string;enabled:boolean};
type JobGrade={code:string;rank:number;title:string;description:string;enabled:boolean};
type Config={levels:Level[];qualifications:Qualification[];jobGrades:JobGrade[];
 gradingSystems?:Array<{code:string;name:string;description:string;enabled:boolean;grades:Array<{code:string;name:string}>}>};
type Entity={id:string;name:string};
const input='min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink';
const button='min-h-11 rounded-xl border border-line px-3 text-sm font-semibold text-ink disabled:opacity-40';
const token=()=>Math.random().toString(36).slice(2,8).toUpperCase();
export default function HrEducationAdmin(){
 const [entities,setEntities]=useState<Entity[]>([]),[entity,setEntity]=useState('');
 const [config,setConfig]=useState<Config|null>(null);
 const [tab,setTab]=useState<'levels'|'qualifications'|'jobGrades'>('levels');
 const [sourceEntity,setSourceEntity]=useState(''),[sourcePreview,setSourcePreview]=useState<Config|null>(null);
 const [sourceConfigured,setSourceConfigured]=useState(false);
 const [confirmAdoption,setConfirmAdoption]=useState(false);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async(id='')=>{
  setLoading(true);setError('');
  try{
   const r=await callBackend<{entities:Entity[];entity:Entity|null;config:Config|null}>('/api/org/hr/education/admin',{legalEntityId:id});
   setEntities(r.entities);setEntity(r.entity?.id||'');setConfig(r.config);
   setSourceEntity('');setSourcePreview(null);setSourceConfigured(false);setConfirmAdoption(false);
  }catch(e){setError(e instanceof Error?e.message:'Unable to load education and job grade configuration.')}
  finally{setLoading(false)}
 };
 useEffect(()=>{void load()},[]);
 const update=(fn:(prev:Config)=>Config)=>setConfig(c=>c?fn(c):c);
 const levelChange=(idx:number,field:keyof Level,value:string|number|boolean)=>update(c=>({...c,levels:c.levels.map((x,i)=>i===idx?{...x,[field]:value}:x)}));
 const qChange=(idx:number,field:keyof Qualification,value:string|boolean)=>update(c=>({...c,qualifications:c.qualifications.map((x,i)=>i===idx?{...x,[field]:value}:x)}));
 const gradeChange=(idx:number,field:keyof JobGrade,value:string|number|boolean)=>update(c=>({...c,jobGrades:c.jobGrades.map((x,i)=>i===idx?{...x,[field]:value}:x)}));
 const save=async()=>{
  if(!config||!entity)return;setBusy(true);setError('');setNotice('');
  try{
   await callBackend('/api/org/hr/education/admin/save',{legalEntityId:entity,config});
   await load(entity);setNotice('Education hierarchy, qualifications and job grades saved for this legal entity.');
  }catch(e){setError(e instanceof Error?e.message:'Unable to save HR settings.')}
  finally{setBusy(false)}
 };
 const selectSource=async(id:string)=>{
  setSourceEntity(id);setSourcePreview(null);setSourceConfigured(false);setConfirmAdoption(false);setError('');
  if(!id)return;
  try{
   const r=await callBackend<{config:Config|null;configured:boolean}>('/api/org/hr/education/admin',{legalEntityId:id});
   setSourcePreview(r.config);setSourceConfigured(r.configured);
  }catch(e){setError(e instanceof Error?e.message:'Unable to inspect source legal entity.')}
 };
 const adopt=async()=>{
  if(!entity||!sourceEntity||sourceEntity===entity||!confirmAdoption||busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   await callBackend('/api/org/hr/education/admin/adopt',{
     sourceLegalEntityId:sourceEntity,targetLegalEntityId:entity,confirmAdoption:true,
   });
   await load(entity);
   setNotice('Configuration adopted from the selected legal entity. Source records were not changed.');
  }catch(e){setError(e instanceof Error?e.message:'Unable to adopt legal-entity settings.')}
  finally{setBusy(false)}
 };
 return <div className="min-w-0 space-y-4">
  <header className="rounded-2xl border border-line bg-panel p-4">
   <h2 className="flex items-center gap-2 text-lg font-bold"><GraduationCap className="h-5 w-5 text-brand"/>Education hierarchy & job grading</h2>
   <p className="mt-2 text-sm text-muted">Configure educational attainment ranks, qualifications and employment job grades separately for each legal entity. Higher Education Rank numbers represent higher typical attainment; job grades are not examination marks.</p>
  </header>
  {loading&&<p className="text-sm text-muted">Loading configuration…</p>}
  {error&&<p role="alert" className="rounded-xl border border-line p-3 text-sm text-red-600">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm">{notice}</p>}
  <SelectField id="admin-education-legal-entity" label="Legal entity" value={entity}
   onChange={e=>void load(e.target.value)}>
   <option value="">Select legal entity</option>
   {entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
  </SelectField>
  {!loading&&!entities.length&&<p className="text-sm text-muted">Create a legal entity in Organization Structure before configuring its HR settings.</p>}
  {config&&entity&&<>
   <section className="space-y-3 rounded-2xl border border-line bg-panel p-3 sm:p-4">
    <div className="flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-brand"/><h3 className="font-semibold">Adopt from another legal entity</h3></div>
    <p className="text-xs text-muted">Copy the saved education levels, qualification lists and job grades from a different legal entity in this same organization. Existing target configuration will be replaced. Employee education records will not be copied or changed.</p>
    <SelectField id="education-adopt-source" label="Source legal entity" value={sourceEntity} onChange={e=>void selectSource(e.target.value)}>
     <option value="">Select source entity</option>{entities.filter(e=>e.id!==entity).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
    </SelectField>
    {sourceEntity&&!sourceConfigured&&sourcePreview&&<p className="rounded-xl bg-page p-3 text-xs text-amber-700">The source entity has not saved its configuration yet. Save it first before adopting.</p>}
    {sourceConfigured&&sourcePreview&&<p className="rounded-xl bg-page p-3 text-xs text-muted">Source preview: {sourcePreview.levels.length} education levels, {sourcePreview.qualifications.length} qualifications and {sourcePreview.jobGrades.length} job grades.</p>}
    {sourceEntity&&<label className="flex min-h-11 items-start gap-3 rounded-xl border border-line p-3 text-sm">
     <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand" checked={confirmAdoption} onChange={e=>setConfirmAdoption(e.target.checked)}/>
     <span>I confirm: replace the target legal entity's current configuration with the saved source configuration.</span>
    </label>}
    <button type="button" disabled={busy||!sourcePreview||!sourceConfigured||!confirmAdoption} onClick={()=>void adopt()}
     className="min-h-11 w-full rounded-xl border border-line px-4 font-semibold text-brand disabled:opacity-40">
     <ArrowRightLeft className="mr-2 inline h-4 w-4"/>Adopt configuration
    </button>
   </section>
   <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-panel p-1">
    {([['levels','Education ranks'],['qualifications','Qualifications'],['jobGrades','Job grades']] as const).map(([key,label])=>
     <button key={key} type="button" onClick={()=>setTab(key)} className={`min-h-11 rounded-lg px-2 text-xs font-semibold ${tab===key?'bg-brand/10 text-brand':'text-muted'}`}>{label}</button>)}
   </div>
   {tab==='levels'&&<section className="space-y-3">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Education Rank</h3>
     <button className={button} type="button" onClick={()=>update(c=>({...c,levels:[...c.levels,{code:'LEVEL_'+token(),name:'',rank:Math.max(0,...c.levels.map(x=>x.rank))+1,description:'',enabled:true}]}))}><Plus className="mr-1 inline h-4 w-4"/>Add</button>
    </div>
    <p className="text-xs text-muted">Rank 1 is the lowest typical attainment. Higher numbers represent higher qualifications. Rankings may be shared by equivalent levels; adjust professional qualifications as appropriate.</p>
    {config.levels.slice().sort((a,b)=>a.rank-b.rank).map(row=>{
     const i=config.levels.indexOf(row);
     return <div key={row.code+i} className="grid min-w-0 gap-3 rounded-2xl border border-line bg-panel p-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm text-muted">Code<input className={input} value={row.code} onChange={e=>levelChange(i,'code',e.target.value)} maxLength={64}/></label>
      <label className="min-w-0 text-sm text-muted">Education Rank<input className={input} type="number" min={1} max={9999} value={row.rank} onChange={e=>levelChange(i,'rank',Number(e.target.value))}/></label>
      <label className="min-w-0 text-sm text-muted">Educational level<input className={input} value={row.name} onChange={e=>levelChange(i,'name',e.target.value)} maxLength={150}/></label>
      <label className="min-w-0 text-sm text-muted">Description<input className={input} value={row.description} onChange={e=>levelChange(i,'description',e.target.value)} maxLength={350}/></label>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={row.enabled} onChange={e=>levelChange(i,'enabled',e.target.checked)}/>Enabled</label>
     </div>;
    })}
   </section>}
   {tab==='qualifications'&&<section className="space-y-3">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Legal-entity qualifications</h3>
     <button type="button" className={button} onClick={()=>update(c=>({...c,qualifications:[...c.qualifications,{code:'QUAL_'+token(),name:'',levelCode:c.levels[0]?.code||'',description:'',enabled:true}]}))}><Plus className="mr-1 inline h-4 w-4"/>Add</button>
    </div>
    {config.qualifications.map((row,i)=><div key={i} className="space-y-2 rounded-2xl border border-line bg-panel p-3">
     <label className="block text-sm text-muted">Qualification code<input className={input} value={row.code} onChange={e=>qChange(i,'code',e.target.value)} maxLength={64}/></label>
     <label className="block text-sm text-muted">Qualification name<input className={input} value={row.name} onChange={e=>qChange(i,'name',e.target.value)} maxLength={150}/></label>
     <SelectField id={'admin-education-q-level-'+i} label="Educational level" value={row.levelCode} onChange={e=>qChange(i,'levelCode',e.target.value)}>
      <option value="">Select level</option>{config.levels.filter(x=>x.enabled||x.code===row.levelCode).sort((a,b)=>a.rank-b.rank).map(x=><option key={x.code} value={x.code}>{x.name} · Rank {x.rank}</option>)}
     </SelectField>
     <label className="block text-sm text-muted">Description<input className={input} value={row.description} onChange={e=>qChange(i,'description',e.target.value)} maxLength={350}/></label>
     <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={row.enabled} onChange={e=>qChange(i,'enabled',e.target.checked)}/>Enabled</label>
    </div>)}
   </section>}
   {tab==='jobGrades'&&<section className="space-y-3">
    <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><BriefcaseBusiness className="h-5 w-5 text-brand"/>Employment job grades</h3>
     <button type="button" className={button} onClick={()=>update(c=>({...c,jobGrades:[...c.jobGrades,{
      code:'JG_'+token(),rank:Math.max(0,...c.jobGrades.map(g=>g.rank))+1,title:'',description:'',enabled:true,
     }]}))}><Plus className="mr-1 inline h-4 w-4"/>Add</button>
    </div>
    <p className="text-xs text-muted">Example: Grade 1 — Unskilled / Casual. These are configurable occupational grades; they are not educational grades, pay rates or automatic entitlements.</p>
    {config.jobGrades.slice().sort((a,b)=>a.rank-b.rank).map(row=>{
     const i=config.jobGrades.indexOf(row);
     return <div key={row.code+i} className="grid min-w-0 gap-3 rounded-2xl border border-line bg-panel p-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm text-muted">Grade code<input className={input} value={row.code} onChange={e=>gradeChange(i,'code',e.target.value)} maxLength={64}/></label>
      <label className="min-w-0 text-sm text-muted">Grade number<input className={input} type="number" min={1} max={9999} value={row.rank} onChange={e=>gradeChange(i,'rank',Number(e.target.value))}/></label>
      <label className="min-w-0 text-sm text-muted">Job grade title<input className={input} value={row.title} onChange={e=>gradeChange(i,'title',e.target.value)} maxLength={150}/></label>
      <label className="min-w-0 text-sm text-muted">Description<input className={input} value={row.description} onChange={e=>gradeChange(i,'description',e.target.value)} maxLength={350}/></label>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={row.enabled} onChange={e=>gradeChange(i,'enabled',e.target.checked)}/>Enabled</label>
     </div>;
    })}
   </section>}
   <button type="button" disabled={busy||loading} onClick={()=>void save()}
    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-onbrand disabled:opacity-40"><Save className="h-5 w-5"/>Save this legal entity's HR settings</button>
  </>}
  <p className="flex items-center gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4"/>Adoption copies configuration only; it does not copy employee records or change another entity's master.</p>
 </div>;
}