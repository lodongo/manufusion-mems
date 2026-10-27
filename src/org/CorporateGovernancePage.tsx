import {useEffect,useMemo,useState} from 'react';
import {Building2,Landmark,Network,Plus,Save,ShieldCheck,Trash2,Users} from 'lucide-react';
import {callBackend} from '../lib/backend';
import CorporateFinancialHomePage from './CorporateFinancialHomePage';
import CorporateStructureMappingPage from './CorporateStructureMappingPage';
import {SelectField} from '../components/ui';
import {Screen,Segmented,useConfirm} from '../components/screen';

type FunctionUnit={code:string;name:string;description:string;enabled:boolean;headRoleCode:string;reportsToCode:string;oversightEntityIds:string[]};
type Body={code:string;name:string;kind:'board'|'committee'|'council'|'forum';description:string;enabled:boolean;chairRoleCode:string;scope:'group'|'entities';entityIds:string[]};
type Config={office:{name:string;description:string;parentGroupNodeId:string;enabled:boolean};functions:FunctionUnit[];bodies:Body[];version:number;updatedAt:string;updatedBy:string};
type Entity={id:string;name:string;code:string};
type Unit={id:string;name:string;code:string};
type Position={code:string;title:string;operatingLevel:string};
const field='min-h-11 min-w-0 w-full rounded-xl border border-line bg-page px-3 text-base text-ink';
const btn='min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
const freshCode=(prefix:string,taken:Set<string>)=>{
 for(let n=1;;n++){const code=prefix+'_'+String(n).padStart(2,'0');if(!taken.has(code))return code;}
};
const CODE=/^[A-Z][A-Z0-9_]{1,19}$/;
type Section='office'|'functions'|'bodies'|'funding'|'mapping';
const SECTIONS:Array<{value:Section;label:string}>=[
 {value:'office',label:'Corporate Office'},{value:'functions',label:'Functions'},{value:'bodies',label:'Governance'},
 {value:'funding',label:'Financial Home'},{value:'mapping',label:'Operating Models'},
];
const OWN=new Set<Section>(['office','functions','bodies']);
/** Client verification mirrors the server rules so problems are fixed before Save, not after a 400. */
function verify(c:Config):string[]{
 const out:string[]=[];
 if(!c.office.name.trim())out.push('Corporate Office name is required.');
 const check=(items:Array<{code:string;name:string}>,kind:string)=>{
  const seen=new Set<string>();
  items.forEach((x,i)=>{
   const label=x.name.trim()||kind+' '+(i+1);
   if(!CODE.test(x.code))out.push(label+': code must start with a letter and use 2–20 capitals, digits or _.');
   if(seen.has(x.code))out.push(label+': code '+x.code+' is used twice.');
   if(!x.name.trim())out.push(kind+' '+(i+1)+': name is required.');
   seen.add(x.code);
  });
 };
 check(c.functions,'Function');check(c.bodies,'Governance body');
 const codes=new Set(c.functions.map(f=>f.code));
 c.functions.forEach(f=>{
  if(f.reportsToCode&&(!codes.has(f.reportsToCode)||f.reportsToCode===f.code))out.push(f.name+': reporting function no longer exists.');
 });
 const parent=new Map(c.functions.map(f=>[f.code,f.reportsToCode]));
 for(const f of c.functions){
  const seen=new Set<string>();let cur=f.code;
  while(cur){if(seen.has(cur)){out.push('Function reporting lines form a loop at '+f.name+'.');break;}seen.add(cur);cur=parent.get(cur)||'';}
 }
 c.bodies.forEach(b=>{if(b.scope==='entities'&&!b.entityIds.length)out.push(b.name+': select at least one legal entity.');});
 return [...new Set(out)];
}


function EntitySelection({entities,selected,onChange,label,disabled}:{entities:Entity[];selected:string[];onChange:(v:string[])=>void;label:string;disabled?:boolean}){
 return <section className="space-y-2">
  <h4 className="text-sm font-semibold">{label}</h4>
  <p className="text-xs text-muted">Select the legal entities this function oversees. None selected = group-wide remit. No legal or payroll ownership is implied.</p>
  <div className="grid gap-2 sm:grid-cols-2">
   {entities.map(e=><label key={e.id} className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg border border-line bg-page px-3 py-2 text-sm">
    <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand" disabled={disabled} checked={selected.includes(e.id)}
     onChange={ev=>onChange(ev.target.checked?[...selected,e.id]:selected.filter(id=>id!==e.id))}/>
    <span className="min-w-0 break-words">{e.name} <span className="text-xs text-muted">({e.code})</span></span>
   </label>)}
   {!entities.length&&<p className="text-xs text-muted">No legal entities exist yet. Corporate defaults can still be saved.</p>}
  </div>
 </section>;
}
export default function CorporateGovernancePage({canEdit}:{canEdit:boolean}){
 const [data,setData]=useState<Config|null>(null),[entities,setEntities]=useState<Entity[]>([]),
 [groups,setGroups]=useState<Unit[]>([]),[roles,setRoles]=useState<Position[]>([]);
 const [section,setSection]=useState<Section>('office');
 const [expanded,setExpanded]=useState(-1),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [saved,setSaved]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [baseline,setBaseline]=useState('');
 const {ask,sheet}=useConfirm();
 const load=async()=>{
  setLoading(true);setError('');
  try{
   const r=await callBackend<{config:Config;entities:Entity[];groups:Unit[];roles:Position[];saved:boolean}>('/api/org/corporate/read');
   setData(r.config);setBaseline(JSON.stringify(r.config));setEntities(r.entities);setGroups(r.groups);setRoles(r.roles);setSaved(r.saved);
  }catch(e){setError(e instanceof Error?e.message:'Cannot load Corporate Governance configuration.')}
  finally{setLoading(false)}
 };
 useEffect(()=>{void load()},[]);
 const dirty=!!data&&JSON.stringify(data)!==baseline;
 const issues=useMemo(()=>data?verify(data):[],[data]);
 useEffect(()=>{
  if(!dirty)return;
  const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
  window.addEventListener('beforeunload',warn);
  return ()=>window.removeEventListener('beforeunload',warn);
 },[dirty]);
 const edit=(fn:(c:Config)=>Config)=>{setNotice('');setData(c=>c?fn(c):c);};
 const editFunction=(index:number,patch:Partial<FunctionUnit>)=>edit(c=>{
  const before=c.functions[index]?.code;
  const renamed=patch.code!==undefined&&patch.code!==before;
  return {...c,functions:c.functions.map((x,i)=>i===index?{...x,...patch}
   :renamed&&x.reportsToCode===before?{...x,reportsToCode:patch.code as string}:x)};
 });
 const editBody=(index:number,patch:Partial<Body>)=>edit(c=>({
  ...c,bodies:c.bodies.map((x,i)=>i===index?{...x,...patch}:x),
 }));
 const removeFunction=(index:number)=>{
  if(!data)return;const f=data.functions[index];
  const dependants=data.functions.filter(x=>x.reportsToCode===f.code).length;
  ask({title:'Remove '+f.name+'?',tone:'danger',confirmLabel:'Remove function',
   message:<>The function is removed from this draft{dependants?<> and {dependants} function(s) reporting into it move to the Corporate Office</>:null}. Nothing changes until you save.</>},
   async()=>{edit(c=>({...c,functions:c.functions.filter((_,i)=>i!==index)
    .map(x=>x.reportsToCode===f.code?{...x,reportsToCode:''}:x)}));setExpanded(-1);});
 };
 const removeBody=(index:number)=>{
  if(!data)return;const b=data.bodies[index];
  ask({title:'Remove '+b.name+'?',tone:'danger',confirmLabel:'Remove body',
   message:'The governance body is removed from this draft. Nothing changes until you save.'},
   async()=>{edit(c=>({...c,bodies:c.bodies.filter((_,i)=>i!==index)}));setExpanded(-1);});
 };
 const save=async()=>{
  if(!data||busy||!canEdit||!dirty||issues.length)return;setBusy(true);setError('');setNotice('');
  try{
   const r=await callBackend<{config:Config}>('/api/org/corporate/save',{config:data,expectedVersion:data.version});
   setData(r.config);setBaseline(JSON.stringify(r.config));setSaved(true);
   setNotice('Corporate Office, functions and governance bodies saved as version '+r.config.version+'. Existing legal entities and job roles were not changed.');
  }catch(e){setError(e instanceof Error?e.message:'Could not save corporate configuration.')}
  finally{setBusy(false)}
 };
 const discard=()=>ask({title:'Discard unsaved changes?',tone:'danger',confirmLabel:'Discard',
  message:'Your edits to the Corporate Office, functions and governance bodies will be lost.'},
  async()=>{setData(JSON.parse(baseline) as Config);setExpanded(-1);});
 const rolesSelector=(id:string,label:string,value:string,update:(x:string)=>void)=><SelectField id={id} label={label} value={value} disabled={!canEdit} onChange={e=>update(e.target.value)}>
  <option value="">Unassigned — configure when a role exists</option>
  {roles.map(r=><option key={r.code} value={r.code}>{r.title} ({r.code} · {r.operatingLevel||'unspecified'})</option>)}
 </SelectField>;
 const own=OWN.has(section);
 const status=!data?'':dirty?'Unsaved changes':saved?'Saved · version '+data.version:'Default template — not yet saved';
 const actions=own&&canEdit&&data?<>
  {dirty&&<button type="button" className={btn} disabled={busy} onClick={discard}>Discard</button>}
  <button type="button" disabled={busy||loading||!dirty||issues.length>0} onClick={()=>void save()}
   aria-label="Save corporate governance configuration"
   className="flex min-h-11 items-center gap-2 rounded-xl bg-brand px-3 text-sm font-semibold text-onbrand disabled:opacity-40">
   <Save className="h-4 w-4"/><span className="hidden sm:inline">Save</span>
  </button>
 </>:undefined;
 const toolbar=data?<Segmented label="Corporate governance sections" value={section} options={SECTIONS}
  onChange={v=>{setSection(v);setExpanded(-1);}}/>:undefined;
 return <Screen title="Corporate Structure & Governance" subtitle={status} actions={actions} toolbar={toolbar}>
  {sheet}
  {loading&&<p role="status" className="text-sm text-muted">Loading corporate defaults…</p>}
  {error&&<p role="alert" className="rounded-xl border border-line bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
  {data&&own&&dirty&&issues.length>0&&<section role="alert" className="rounded-xl border border-line bg-amber-500/10 p-3 text-sm">
   <p className="font-semibold text-ink">Fix {issues.length} item{issues.length===1?'':'s'} before saving</p>
   <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-soft">{issues.slice(0,8).map(x=><li key={x}>{x}</li>)}</ul>
  </section>}
  {data&&<>
   {section==='funding'&&<CorporateFinancialHomePage canEdit={canEdit}/>}
   {section==='mapping'&&<CorporateStructureMappingPage canEdit={canEdit}/>}
   {own&&<section className="grid grid-cols-3 gap-2">
    {[
     ['Office',data.office.enabled?'Enabled':'Disabled'],
     ['Functions',String(data.functions.filter(x=>x.enabled).length)],
     ['Bodies',String(data.bodies.filter(x=>x.enabled).length)],
    ].map(([label,value])=><div key={label} className="min-w-0 rounded-xl border border-line bg-panel p-3">
     <p className="truncate text-xs text-muted">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>)}
   </section>}
   {section==='office'&&<section className="space-y-3 rounded-2xl border border-line bg-panel p-4">
    <div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-brand"/><h3 className="font-semibold">Corporate Office</h3></div>
    <p className="text-xs text-muted">The Corporate Office is a management branch, separate from registered legal entities. It is not a company, employing entity or cost centre.</p>
    <label className="block text-sm text-muted">Office name *<input className={field} disabled={!canEdit} maxLength={120} value={data.office.name}
     aria-invalid={!data.office.name.trim()} onChange={e=>edit(c=>({...c,office:{...c.office,name:e.target.value}}))}/></label>
    <label className="block text-sm text-muted">Purpose / description<textarea className={field+' min-h-24 p-3'} disabled={!canEdit} maxLength={500}
      value={data.office.description} onChange={e=>edit(c=>({...c,office:{...c.office,description:e.target.value}}))}/></label>
    <SelectField id="corporate-parent" label="Link to existing upper-level group unit (optional)"
     disabled={!canEdit} value={data.office.parentGroupNodeId} onChange={e=>edit(c=>({...c,office:{...c.office,parentGroupNodeId:e.target.value}}))}>
     <option value="">Enterprise root — no existing upper-level unit</option>
     {groups.map(g=><option key={g.id} value={g.id}>{g.name} ({g.code})</option>)}
    </SelectField>
    <p className="text-xs text-muted">The link gives context only. It does not change the operational reporting hierarchy.</p>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand" disabled={!canEdit}
     checked={data.office.enabled} onChange={e=>edit(c=>({...c,office:{...c.office,enabled:e.target.checked}}))}/>Corporate Office enabled</label>
    <div className="rounded-xl border border-line bg-page p-3">
     <p className="text-sm font-semibold">Corporate functions</p>
     <div className="mt-2 flex flex-wrap gap-2">{data.functions.filter(x=>x.enabled).map((x,i)=>
      <span key={i} className="rounded-lg border border-line bg-panel px-2 py-1 text-xs">{x.name}</span>)}</div>
    </div>
   </section>}
   {section==='functions'&&<div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
     <h3 className="flex items-center gap-2 font-semibold"><Network className="h-5 w-5 text-brand"/>Corporate Functions</h3>
     {canEdit&&<button type="button" className={btn} disabled={data.functions.length>=60} onClick={()=>{
      const index=data.functions.length;
      edit(c=>({...c,functions:[...c.functions,{code:freshCode('FUN',new Set(c.functions.map(f=>f.code))),name:'New function',description:'',
       enabled:true,headRoleCode:'',reportsToCode:'',oversightEntityIds:[]}]}));setExpanded(index);
     }}><Plus className="mr-1 inline h-4 w-4"/>Add function</button>}
    </div>
    <p className="text-xs text-muted">Defaults cover Group Executive Office, Corporate Secretariat, Finance, HR, Engineering, Procurement, IT, Legal, Strategy and Sustainability. Assign a head and reporting line when positions are ready.</p>
    {canEdit&&(['EXEC','SEC'] as const).some(code=>!data.functions.some(f=>f.code===code))&&
     <button type="button" className="min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-brand"
      onClick={()=>edit(c=>({...c,functions:[
       ...c.functions,
       ...([['EXEC','Group Executive Office','Group CEO, corporate leadership and shared administration'],
            ['SEC','Corporate Secretariat','Board administration, statutory governance and governance records']] as const)
         .filter(([code])=>!c.functions.some(f=>f.code===code))
         .map(([code,name,description])=>({code,name,description,enabled:true,headRoleCode:'',reportsToCode:'',oversightEntityIds:[]})),
      ]}))}>Adopt missing Executive Office and Secretariat defaults</button>}
    {data.functions.map((f,index)=><section key={index} className="min-w-0 rounded-xl border border-line bg-panel">
     <button type="button" className="flex min-h-14 w-full items-center justify-between gap-2 px-3 py-2 text-left"
      onClick={()=>setExpanded(expanded===index?-1:index)} aria-expanded={expanded===index}>
      <span className="min-w-0"><strong className="block break-words text-sm">{f.name||'Unnamed function'}</strong>
       <span className="font-mono text-xs text-muted">{f.code} · {f.enabled?'Enabled':'Disabled'}
        {f.reportsToCode?' · reports to '+f.reportsToCode:''}</span></span>
      <Network className="h-4 w-4 shrink-0 text-muted"/>
     </button>
     {expanded===index&&<div className="space-y-3 border-t border-line p-3">
      <div className="grid gap-3 sm:grid-cols-2">
       <label className="block text-sm text-muted">Function code *<input className={field+' font-mono'} disabled={!canEdit} maxLength={20} value={f.code}
        aria-invalid={!CODE.test(f.code)} autoCapitalize="characters" spellCheck={false}
        onChange={e=>editFunction(index,{code:e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,'')})}/></label>
       <label className="block text-sm text-muted">Name *<input className={field} disabled={!canEdit} maxLength={120} value={f.name}
        aria-invalid={!f.name.trim()} onChange={e=>editFunction(index,{name:e.target.value})}/></label>
      </div>
      <label className="block text-sm text-muted">Description<textarea className={field+' min-h-20 p-3'} disabled={!canEdit} maxLength={500}
       value={f.description} onChange={e=>editFunction(index,{description:e.target.value})}/></label>
      {rolesSelector('cor-function-head-'+index,'Functional head role (optional)',f.headRoleCode,x=>editFunction(index,{headRoleCode:x}))}
      <SelectField id={'cor-function-reports-'+index} label="Reports into corporate function" disabled={!canEdit}
       value={f.reportsToCode} onChange={e=>editFunction(index,{reportsToCode:e.target.value})}>
       <option value="">Corporate Office / top-level function</option>
       {data.functions.filter((x,i)=>i!==index&&x.code).map((x,i)=><option key={i} value={x.code}>{x.name} ({x.code})</option>)}
      </SelectField>
      <EntitySelection entities={entities} selected={f.oversightEntityIds} label="Legal-entity oversight (optional)" disabled={!canEdit}
       onChange={x=>editFunction(index,{oversightEntityIds:x})}/>
      <div className="flex flex-wrap items-center justify-between gap-2">
       <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit} className="h-5 w-5 accent-brand"
        checked={f.enabled} onChange={e=>editFunction(index,{enabled:e.target.checked})}/>Enabled</label>
       {canEdit&&<button type="button" className={btn} onClick={()=>removeFunction(index)}><Trash2 className="mr-1 inline h-4 w-4"/>Remove</button>}
      </div>
     </div>}
    </section>)}
   </div>}
   {section==='bodies'&&<div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
     <h3 className="flex items-center gap-2 font-semibold"><Users className="h-5 w-5 text-brand"/>Governance Bodies</h3>
     {canEdit&&<button type="button" className={btn} disabled={data.bodies.length>=60} onClick={()=>{
      const index=data.bodies.length;
      edit(c=>({...c,bodies:[...c.bodies,{code:freshCode('GOV',new Set(c.bodies.map(b=>b.code))),name:'New governance body',description:'',
       kind:'committee',enabled:true,chairRoleCode:'',scope:'group',entityIds:[]}]}));setExpanded(index);
     }}><Plus className="mr-1 inline h-4 w-4"/>Add body</button>}
    </div>
    <p className="text-xs text-muted">Defaults cover the Group Board, Executive Committee, Audit & Risk, People & Remuneration, Investment & Capital, and SHEQ. These are governance records only: approval rights still come from Workflow and Chart of Authority.</p>
    {data.bodies.map((b,index)=><section key={index} className="min-w-0 rounded-xl border border-line bg-panel">
     <button type="button" className="flex min-h-14 w-full items-center justify-between gap-2 px-3 py-2 text-left"
      onClick={()=>setExpanded(expanded===index?-1:index)} aria-expanded={expanded===index}>
      <span className="min-w-0"><strong className="block break-words text-sm">{b.name||'Unnamed body'}</strong>
       <span className="font-mono text-xs text-muted">{b.code} · {b.scope==='group'?'Group-wide':b.entityIds.length+' legal entit'+(b.entityIds.length===1?'y':'ies')} · {b.enabled?'Enabled':'Disabled'}</span></span>
      <Landmark className="h-4 w-4 shrink-0 text-muted"/>
     </button>
     {expanded===index&&<div className="space-y-3 border-t border-line p-3">
      <div className="grid gap-3 sm:grid-cols-2">
       <label className="block text-sm text-muted">Body code *<input className={field+' font-mono'} disabled={!canEdit} maxLength={20} value={b.code}
        aria-invalid={!CODE.test(b.code)} autoCapitalize="characters" spellCheck={false}
        onChange={e=>editBody(index,{code:e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,'')})}/></label>
       <label className="block text-sm text-muted">Body name *<input className={field} disabled={!canEdit} maxLength={120} value={b.name}
        aria-invalid={!b.name.trim()} onChange={e=>editBody(index,{name:e.target.value})}/></label>
      </div>
      <SelectField id={'cor-body-kind-'+index} label="Governance body type" disabled={!canEdit} value={b.kind}
       onChange={e=>editBody(index,{kind:e.target.value as Body['kind']})}>
       {['board','committee','council','forum'].map(x=><option key={x} value={x}>{x[0].toUpperCase()+x.slice(1)}</option>)}
      </SelectField>
      <label className="block text-sm text-muted">Mandate / responsibilities<textarea className={field+' min-h-20 p-3'} disabled={!canEdit}
       maxLength={500} value={b.description} onChange={e=>editBody(index,{description:e.target.value})}/></label>
      {rolesSelector('cor-body-chair-'+index,'Chairperson role (optional)',b.chairRoleCode,x=>editBody(index,{chairRoleCode:x}))}
      <SelectField id={'cor-body-scope-'+index} label="Governance jurisdiction" disabled={!canEdit} value={b.scope}
       onChange={e=>editBody(index,{scope:e.target.value as Body['scope'],entityIds:[]})}>
       <option value="group">Group-wide (all legal entities)</option>
       <option value="entities">Selected legal entities</option>
      </SelectField>
      {b.scope==='entities'&&<EntitySelection entities={entities} selected={b.entityIds} disabled={!canEdit}
       label="Legal entities covered by this governance body *" onChange={x=>editBody(index,{entityIds:x})}/>}
      <div className="flex flex-wrap items-center justify-between gap-2">
       <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand"
        disabled={!canEdit} checked={b.enabled} onChange={e=>editBody(index,{enabled:e.target.checked})}/>Enabled</label>
       {canEdit&&<button type="button" className={btn} onClick={()=>removeBody(index)}><Trash2 className="mr-1 inline h-4 w-4"/>Remove</button>}
      </div>
     </div>}
    </section>)}
   </div>}
   {own&&<div className="flex items-start gap-2 rounded-xl border border-line bg-panel p-3">
    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand"/>
    <p className="text-xs text-muted">Governance scope is a policy reference only. It grants no user permissions, workflow approvals, employment contracts or cost allocations; each of those has its own governed configuration. Every save is versioned and audited.</p>
   </div>}
  </>}
 </Screen>;
}
