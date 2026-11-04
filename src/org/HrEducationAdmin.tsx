import {useEffect,useMemo,useState} from 'react';
import {ArrowRightLeft,BriefcaseBusiness,GraduationCap,Plus,Save,ShieldCheck} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {navigate} from '../lib/route';
import {SelectField} from '../components/ui';
import {Segmented,useConfirm} from '../components/screen';

type Level={code:string;name:string;description:string;enabled:boolean;rank:number};
type Qualification={code:string;levelCode:string;name:string;description:string;enabled:boolean};
type Config={levels:Level[];qualifications:Qualification[]};
type Entity={id:string;name:string};
const input='min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink';
const button='flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
const token=()=>Math.random().toString(36).slice(2,8).toUpperCase();
export default function HrEducationAdmin(){
 const [entities,setEntities]=useState<Entity[]>([]),[entity,setEntity]=useState('');
 const [config,setConfig]=useState<Config|null>(null);
 const [tab,setTab]=useState<'levels'|'qualifications'|'copy'>('levels');
 const [sourceEntity,setSourceEntity]=useState(''),[sourcePreview,setSourcePreview]=useState<Config|null>(null);
 const [sourceConfigured,setSourceConfigured]=useState(false);
 const [confirmAdoption,setConfirmAdoption]=useState(false);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 // Codes already saved are referenced by employee records and qualifications, so they are read-only.
 const [baseline,setBaseline]=useState('');
 const savedConfig=useMemo(()=>{try{return JSON.parse(baseline||'null') as Config|null}catch{return null}},[baseline]);
 // Rows are only ever appended, so an index below the saved length is a saved row.
 const savedRow=(kind:'levels'|'qualifications',index:number)=>index<(savedConfig?.[kind]?.length||0);
 const {ask,sheet}=useConfirm();
 const dirty=!!config&&JSON.stringify(config)!==baseline;
 const issues=useMemo(()=>{
  if(!config)return [] as string[];
  const out:string[]=[];
  const check=(rows:Array<{code:string}>,kind:string,named:(x:never)=>string)=>{
   const seen=new Set<string>();
   rows.forEach((x,i)=>{
    if(!/^[A-Za-z0-9_-]{2,64}$/.test(x.code))out.push(kind+' '+(i+1)+': code must be 2–64 letters, digits, _ or -.');
    if(seen.has(x.code))out.push(kind+' code '+x.code+' is used twice.');
    if(!named(x as never).trim())out.push(kind+' '+x.code+': name is required.');
    seen.add(x.code);
   });
  };
  check(config.levels,'Education level',(x:Level)=>x.name);
  check(config.qualifications,'Qualification',(x:Qualification)=>x.name);
  config.levels.forEach(x=>{if(!(x.rank>=1))out.push('Education level '+x.code+': rank must be 1 or more.');});
  const levels=new Set(config.levels.map(x=>x.code));
  config.qualifications.forEach(x=>{if(!levels.has(x.levelCode))out.push('Qualification '+x.code+': choose an educational level.');});
  return [...new Set(out)];
 },[config]);
 useEffect(()=>{
  if(!dirty)return;
  const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[dirty]);
 const load=async(id='')=>{
  setLoading(true);setError('');
  try{
   const r=await callBackend<{entities:Entity[];entity:Entity|null;config:Config|null}>('/api/org/hr/education/admin',{legalEntityId:id});
   setEntities(r.entities);setEntity(r.entity?.id||'');setConfig(r.config);setBaseline(JSON.stringify(r.config));
   setSourceEntity('');setSourcePreview(null);setSourceConfigured(false);setConfirmAdoption(false);
  }catch(e){setError(e instanceof Error?e.message:'Unable to load the education configuration.')}
  finally{setLoading(false)}
 };
 useEffect(()=>{void load()},[]);
 const update=(fn:(prev:Config)=>Config)=>setConfig(c=>c?fn(c):c);
 const levelChange=(idx:number,field:keyof Level,value:string|number|boolean)=>update(c=>({...c,levels:c.levels.map((x,i)=>i===idx?{...x,[field]:value}:x)}));
 const qChange=(idx:number,field:keyof Qualification,value:string|boolean)=>update(c=>({...c,qualifications:c.qualifications.map((x,i)=>i===idx?{...x,[field]:value}:x)}));
 const save=async()=>{
  if(!config||!entity||issues.length||!dirty)return;setBusy(true);setError('');setNotice('');
  try{
   await callBackend('/api/org/hr/education/admin/save',{legalEntityId:entity,config:{levels:config.levels,qualifications:config.qualifications}});
   await load(entity);setNotice('Education hierarchy and qualifications saved for this legal entity.');
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
 const discard=()=>ask({title:'Discard unsaved changes?',tone:'danger',confirmLabel:'Discard changes',
  message:'Your unsaved education changes are lost. The saved configuration is not affected.'},
  async()=>{setConfig(savedConfig);setNotice('Unsaved changes discarded.')});
 const actions=config&&entity?<>
  {tab==='levels'&&<button type="button" className={button} aria-label="Add an education rank" onClick={()=>update(c=>({...c,levels:[...c.levels,{code:'LEVEL_'+token(),name:'',rank:Math.max(0,...c.levels.map(x=>x.rank))+1,description:'',enabled:true}]}))}><Plus className="h-4 w-4"/><span className="hidden sm:inline">Add rank</span></button>}
  {tab==='qualifications'&&<button type="button" className={button} aria-label="Add a qualification" onClick={()=>update(c=>({...c,qualifications:[...c.qualifications,{code:'QUAL_'+token(),name:'',levelCode:c.levels[0]?.code||'',description:'',enabled:true}]}))}><Plus className="h-4 w-4"/><span className="hidden sm:inline">Add qualification</span></button>}
  <button type="button" disabled={busy||loading||!dirty||issues.length>0} onClick={()=>void save()}
   aria-label="Save this legal entity's education settings"
   className="flex min-h-11 items-center gap-2 rounded-xl bg-brand px-3 text-sm font-semibold text-onbrand disabled:opacity-40">
   <Save className="h-4 w-4"/><span className="hidden sm:inline">Save</span></button>
 </>:undefined;
 const entityName=entities.find(e=>e.id===entity)?.name||'';
 return <div className="flex h-full min-h-0 flex-col">
  {sheet}
  <div className="shrink-0 space-y-2 border-b border-line bg-page pb-3">
   <div className="flex items-center gap-2">
    <div className="min-w-0 flex-1">
     <h2 className="flex items-center gap-2 truncate text-base font-semibold text-ink"><GraduationCap className="h-5 w-5 shrink-0 text-brand"/>Education{entityName?' · '+entityName:''}</h2>
     <p className="truncate text-xs text-muted">{!config?'':dirty?'Unsaved changes':'Saved'}</p>
    </div>
    {actions&&<div className="flex shrink-0 items-center gap-2">{actions}</div>}
   </div>
   {entities.length>1&&<SelectField id="admin-education-legal-entity" label="Legal entity" hideLabel value={entity} disabled={busy||loading||dirty}
    hint={dirty?'Save or discard your changes before switching legal entity.':undefined}
    onChange={e=>void load(e.target.value)}>
    {entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
   </SelectField>}
   {dirty&&<button type="button" className="text-xs font-semibold text-danger underline" onClick={discard}>Discard unsaved changes</button>}
   {config&&entity&&<Segmented label="Education view" value={tab} onChange={setTab} options={[
    {value:'levels',label:'Ranks',count:config.levels.length},{value:'qualifications',label:'Qualifications',count:config.qualifications.length},{value:'copy',label:'Copy'}]}/>}
  </div>
  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3">
  {dirty&&issues.length>0&&<section role="alert" className="rounded-xl border border-line bg-amber-500/10 p-3 text-sm">
   <p className="font-semibold text-ink">Fix {issues.length} item{issues.length===1?'':'s'} before saving</p>
   <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-soft">{issues.slice(0,8).map(x=><li key={x}>{x}</li>)}</ul>
  </section>}
  <section className="rounded-2xl border border-line bg-panel p-3 text-xs text-muted">
   Educational ranks and qualifications are set separately for each legal entity. A higher rank is a higher typical attainment. A job role's minimum level of education is chosen from the ranks under Organization → Job roles, and it applies to the role in every legal entity.
  </section>
  {loading&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">Loading configuration…</p>}
  {error&&<p role="alert" className="rounded-xl border border-line bg-danger/10 p-3 text-sm text-danger">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
  {!loading&&!entities.length&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">Create a legal entity in Organization Structure before configuring its education settings.</p>}
  {config&&entity&&<>
   {tab==='copy'&&<section className="space-y-3 rounded-2xl border border-line bg-panel p-3 sm:p-4">
    <div className="flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-brand"/><h3 className="font-semibold">Adopt from another legal entity</h3></div>
    <p className="text-xs text-muted">Copy the saved education ranks and qualifications from a different legal entity in this organization. The current configuration of this legal entity is replaced. Employee education records are not copied or changed.</p>
    <SelectField id="education-adopt-source" label="Source legal entity" value={sourceEntity} disabled={dirty} onChange={e=>void selectSource(e.target.value)}
     hint={dirty?'Save or discard your changes first.':undefined}>
     <option value="">Select source entity</option>{entities.filter(e=>e.id!==entity).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
    </SelectField>
    {sourceEntity&&!sourceConfigured&&sourcePreview&&<p className="rounded-xl bg-page p-3 text-xs text-amber-700">The source entity has not saved its configuration yet. Save it first before adopting.</p>}
    {sourceConfigured&&sourcePreview&&<p className="rounded-xl bg-page p-3 text-xs text-muted">Source preview: {sourcePreview.levels.length} education ranks and {sourcePreview.qualifications.length} qualifications.</p>}
    {sourceEntity&&<label className="flex min-h-11 items-start gap-3 rounded-xl border border-line p-3 text-sm">
     <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand" checked={confirmAdoption} onChange={e=>setConfirmAdoption(e.target.checked)}/>
     <span>I confirm: replace this legal entity's current configuration with the saved source configuration.</span>
    </label>}
    <button type="button" disabled={busy||dirty||!sourcePreview||!sourceConfigured||!confirmAdoption} onClick={()=>void adopt()}
     className="min-h-11 w-full rounded-xl border border-line px-4 font-semibold text-brand disabled:opacity-40">
     <ArrowRightLeft className="mr-2 inline h-4 w-4"/>Adopt configuration
    </button>
   </section>}
   {tab==='levels'&&<section className="space-y-3">
    <p className="text-xs text-muted">Rank 1 is the lowest typical attainment. Equivalent levels may share a rank.</p>
    {config.levels.slice().sort((a,b)=>a.rank-b.rank).map(row=>{
     const i=config.levels.indexOf(row);
     return <div key={i} className="grid min-w-0 gap-3 rounded-2xl border border-line bg-panel p-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm text-muted">Code<input className={input+' font-mono disabled:opacity-60'} value={row.code} disabled={savedRow('levels',i)} onChange={e=>levelChange(i,'code',e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g,''))} maxLength={64}/></label>
      <label className="min-w-0 text-sm text-muted">Education rank<input className={input} type="number" min={1} max={9999} value={row.rank} onChange={e=>levelChange(i,'rank',Number(e.target.value))}/></label>
      <label className="min-w-0 text-sm text-muted">Educational level<input className={input} value={row.name} onChange={e=>levelChange(i,'name',e.target.value)} maxLength={150}/></label>
      <label className="min-w-0 text-sm text-muted">Description<input className={input} value={row.description} onChange={e=>levelChange(i,'description',e.target.value)} maxLength={350}/></label>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand" checked={row.enabled} onChange={e=>levelChange(i,'enabled',e.target.checked)}/>Enabled</label>
     </div>;
    })}
    {!config.levels.length&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">No education ranks yet. Add the first one.</p>}
   </section>}
   {tab==='qualifications'&&<section className="space-y-3">
    {config.qualifications.map((row,i)=><div key={i} className="space-y-2 rounded-2xl border border-line bg-panel p-3">
     <label className="block text-sm text-muted">Qualification code<input className={input+' font-mono disabled:opacity-60'} value={row.code} disabled={savedRow('qualifications',i)} onChange={e=>qChange(i,'code',e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g,''))} maxLength={64}/></label>
     <label className="block text-sm text-muted">Qualification name<input className={input} value={row.name} onChange={e=>qChange(i,'name',e.target.value)} maxLength={150}/></label>
     <SelectField id={'admin-education-q-level-'+i} label="Educational level" value={row.levelCode} onChange={e=>qChange(i,'levelCode',e.target.value)}>
      <option value="">Select level</option>{config.levels.filter(x=>x.enabled||x.code===row.levelCode).sort((a,b)=>a.rank-b.rank).map(x=><option key={x.code} value={x.code}>{x.name} · Rank {x.rank}</option>)}
     </SelectField>
     <label className="block text-sm text-muted">Description<input className={input} value={row.description} onChange={e=>qChange(i,'description',e.target.value)} maxLength={350}/></label>
     <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand" checked={row.enabled} onChange={e=>qChange(i,'enabled',e.target.checked)}/>Enabled</label>
    </div>)}
    {!config.qualifications.length&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">No qualifications yet. Add the first one.</p>}
   </section>}
   <section className="flex items-start gap-3 rounded-2xl border border-line bg-panel p-3 sm:p-4">
    <BriefcaseBusiness className="mt-0.5 h-5 w-5 shrink-0 text-brand"/>
    <div className="min-w-0 flex-1 space-y-2">
     <h3 className="font-semibold">Job grades</h3>
     <p className="text-xs text-muted">Job grades, their minimum salaries, benefits, taxes and deductions are prepared and approved under HR → Job Grades.</p>
     <button type="button" onClick={()=>navigate('organization_home/hr/HR07')} className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold text-brand">Open Job Grades</button>
    </div>
   </section>
  </>}
  <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0"/>Saved codes are locked because employee records refer to them; disable an item instead. Adoption copies configuration only. Every save is versioned and audited.</p>
  </div>
 </div>;
}
