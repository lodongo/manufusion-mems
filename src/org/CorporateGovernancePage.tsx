import {useEffect,useState} from 'react';
import {Building2,Landmark,Network,Plus,Save,ShieldCheck,Trash2,Users} from 'lucide-react';
import {callBackend} from '../lib/backend';
import CorporateFinancialHomePage from './CorporateFinancialHomePage';
import CorporateStructureMappingPage from './CorporateStructureMappingPage';
import CorporateBudgetPage from './CorporateBudgetPage';
import CorporateAllocationPage from './CorporateAllocationPage';
import {SelectField} from '../components/ui';

type FunctionUnit={code:string;name:string;description:string;enabled:boolean;headRoleCode:string;reportsToCode:string;oversightEntityIds:string[]};
type Body={code:string;name:string;kind:'board'|'committee'|'council'|'forum';description:string;enabled:boolean;chairRoleCode:string;scope:'group'|'entities';entityIds:string[]};
type Config={office:{name:string;description:string;parentGroupNodeId:string;enabled:boolean};functions:FunctionUnit[];bodies:Body[];version:number;updatedAt:string;updatedBy:string};
type Entity={id:string;name:string;code:string};
type Unit={id:string;name:string;code:string};
type Position={code:string;title:string;operatingLevel:string};
const field='min-h-11 min-w-0 w-full rounded-xl border border-line bg-page px-3 text-base text-ink';
const btn='min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
const freshCode=(prefix:string)=>prefix+'_'+Math.random().toString(36).slice(2,7).toUpperCase();

function EntitySelection({entities,selected,onChange,label}:{entities:Entity[];selected:string[];onChange:(v:string[])=>void;label:string}){
 return <section className="space-y-2">
  <h4 className="text-sm font-semibold">{label}</h4>
  <p className="text-xs text-muted">Select the legal entities this function oversees. None selected = group-wide remit. No legal or payroll ownership is implied.</p>
  <div className="grid gap-2 sm:grid-cols-2">
   {entities.map(e=><label key={e.id} className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg border border-line bg-page px-3 py-2 text-sm">
    <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand" checked={selected.includes(e.id)}
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
 const [section,setSection]=useState<'office'|'functions'|'bodies'|'funding'|'mapping'|'budget'|'allocation'>('office');
 const [expanded,setExpanded]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [saved,setSaved]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{
  setLoading(true);setError('');
  try{
   const r=await callBackend<{config:Config;entities:Entity[];groups:Unit[];roles:Position[];saved:boolean}>('/api/org/corporate/read');
   setData(r.config);setEntities(r.entities);setGroups(r.groups);setRoles(r.roles);setSaved(r.saved);
  }catch(e){setError(e instanceof Error?e.message:'Cannot load Corporate Governance configuration.')}
  finally{setLoading(false)}
 };
 useEffect(()=>{void load()},[]);
 const edit=(fn:(c:Config)=>Config)=>setData(c=>c?fn(c):c);
 const editFunction=(index:number,patch:Partial<FunctionUnit>)=>edit(c=>({
  ...c,functions:c.functions.map((x,i)=>i===index?{...x,...patch}:x),
 }));
 const editBody=(index:number,patch:Partial<Body>)=>edit(c=>({
  ...c,bodies:c.bodies.map((x,i)=>i===index?{...x,...patch}:x),
 }));
 const save=async()=>{
  if(!data||busy||!canEdit)return;setBusy(true);setError('');setNotice('');
  try{
   const r=await callBackend<{config:Config}>('/api/org/corporate/save',{config:data,expectedVersion:data.version});
   setData(r.config);setSaved(true);setNotice('Corporate Office, functions and governance bodies saved. Existing legal entities and job roles were not changed.');
  }catch(e){setError(e instanceof Error?e.message:'Could not save corporate configuration.')}
  finally{setBusy(false)}
 };
 const rolesSelector=(id:string,label:string,value:string,update:(x:string)=>void)=><SelectField id={id} label={label} value={value} onChange={e=>update(e.target.value)}>
  <option value="">Unassigned — configure when a role exists</option>
  {roles.map(r=><option key={r.code} value={r.code}>{r.title} ({r.code} · {r.operatingLevel||'unspecified'})</option>)}
 </SelectField>;
 return <div className="min-w-0 space-y-4">
  <header className="rounded-2xl border border-line bg-panel p-4">
   <h2 className="flex items-center gap-2 text-lg font-bold"><Landmark className="h-5 w-5 text-brand"/>Corporate Structure & Governance</h2>
   <p className="mt-2 text-sm text-muted">Corporate Office and its group functions are separate from registered legal entities. Governance bodies record oversight and accountability, not transaction-approval authority.</p>
   <p className="mt-2 text-xs text-muted">Phase 1 foundation: existing legal entities, sites, departments, cost centres, role assignments and payroll stay unchanged.</p>
  </header>
  {loading&&<p role="status" className="text-sm text-muted">Loading corporate defaults…</p>}
  {error&&<p role="alert" className="rounded-xl border border-line p-3 text-sm text-red-600">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
  {data&&<>
   <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {[
     ['Office',data.office.enabled?'Configured':'Disabled'],
     ['Functions',String(data.functions.filter(x=>x.enabled).length)],
     ['Governance bodies',String(data.bodies.filter(x=>x.enabled).length)],
     ['Configuration',saved?'Saved · v'+data.version:'Default template'],
    ].map(([label,value])=><div key={label} className="min-w-0 rounded-xl border border-line bg-panel p-3">
     <p className="text-xs text-muted">{label}</p><p className="mt-1 break-words text-sm font-semibold">{value}</p>
    </div>)}
   </section>
   <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-panel p-1 sm:grid-cols-7">
    {([['office','Corporate Office'],['functions','Functions'],['bodies','Governance'],['funding','Financial Home'],['mapping','Operating Models & Homes'],['budget','Budgets & Funding'],['allocation','Cost Allocation']] as const).map(([key,title])=>
     <button key={key} type="button" onClick={()=>{setSection(key);setExpanded('')}}
      className={`min-h-11 rounded-lg px-2 text-xs font-semibold ${section===key?'bg-brand/10 text-brand':'text-muted'}`}>{title}</button>)}
   </div>
   {section==='funding'&&<CorporateFinancialHomePage canEdit={canEdit}/>}
   {section==='mapping'&&<CorporateStructureMappingPage canEdit={canEdit}/>}
   {section==='budget'&&<CorporateBudgetPage canEdit={canEdit}/>}
   {section==='allocation'&&<CorporateAllocationPage canEdit={canEdit}/>}
   {section==='office'&&<section className="space-y-3 rounded-2xl border border-line bg-panel p-4">
    <div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-brand"/><h3 className="font-semibold">Corporate Office</h3></div>
    <p className="text-xs text-muted">The Corporate Office is a management branch. It is not itself a new company, employing legal entity, or financial cost centre.</p>
    <label className="block text-sm text-muted">Office name<input className={field} disabled={!canEdit} maxLength={120} value={data.office.name}
     onChange={e=>edit(c=>({...c,office:{...c.office,name:e.target.value}}))}/></label>
    <label className="block text-sm text-muted">Purpose / description<textarea className={field+' min-h-24 p-3'} disabled={!canEdit} maxLength={500}
      value={data.office.description} onChange={e=>edit(c=>({...c,office:{...c.office,description:e.target.value}}))}/></label>
    <SelectField id="corporate-parent" label="Link to existing upper-level group unit (optional)"
     disabled={!canEdit} value={data.office.parentGroupNodeId} onChange={e=>edit(c=>({...c,office:{...c.office,parentGroupNodeId:e.target.value}}))}>
     <option value="">Enterprise root — no existing upper-level unit</option>
     {groups.map(g=><option key={g.id} value={g.id}>{g.name} ({g.code})</option>)}
    </SelectField>
    <p className="text-xs text-muted">An optional link provides context without changing the current operational reporting hierarchy.</p>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand" disabled={!canEdit}
     checked={data.office.enabled} onChange={e=>edit(c=>({...c,office:{...c.office,enabled:e.target.checked}}))}/>Corporate Office enabled</label>
    <div className="rounded-xl border border-line bg-page p-3">
     <p className="text-sm font-semibold">Corporate functions</p>
     <div className="mt-2 flex flex-wrap gap-2">{data.functions.filter(x=>x.enabled).map(x=>
      <span key={x.code} className="rounded-lg border border-line bg-panel px-2 py-1 text-xs">{x.name}</span>)}</div>
    </div>
   </section>}
   {section==='functions'&&<div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
     <h3 className="flex items-center gap-2 font-semibold"><Network className="h-5 w-5 text-brand"/>Corporate Functions</h3>
     {canEdit&&<button type="button" className={btn} disabled={data.functions.length>=60} onClick={()=>{
      const code=freshCode('FUN');edit(c=>({...c,functions:[...c.functions,{code,name:'New function',description:'',
       enabled:true,headRoleCode:'',reportsToCode:'',oversightEntityIds:[]}]}));setExpanded(code);
     }}><Plus className="mr-1 inline h-4 w-4"/>Add function</button>}
    </div>
    <p className="text-xs text-muted">Defaults cover Group Executive Office, Corporate Secretariat, Finance, HR, Engineering, Procurement, IT, Legal, Strategy and Sustainability. Assign a functional head and reporting function when positions are ready.</p>
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
      onClick={()=>setExpanded(expanded===f.code?'':f.code)} aria-expanded={expanded===f.code}>
      <span className="min-w-0"><strong className="block break-words text-sm">{f.name}</strong>
       <span className="font-mono text-xs text-muted">{f.code} · {f.enabled?'Enabled':'Disabled'}</span></span>
      <Network className="h-4 w-4 shrink-0 text-muted"/>
     </button>
     {expanded===f.code&&<div className="space-y-3 border-t border-line p-3">
      <div className="grid gap-3 sm:grid-cols-2">
       <label className="block text-sm text-muted">Function code<input className={field} disabled={!canEdit} maxLength={20} value={f.code}
        onChange={e=>editFunction(index,{code:e.target.value.toUpperCase()})}/></label>
       <label className="block text-sm text-muted">Name<input className={field} disabled={!canEdit} maxLength={120} value={f.name}
        onChange={e=>editFunction(index,{name:e.target.value})}/></label>
      </div>
      <label className="block text-sm text-muted">Description<textarea className={field+' min-h-20 p-3'} disabled={!canEdit} maxLength={500}
       value={f.description} onChange={e=>editFunction(index,{description:e.target.value})}/></label>
      {rolesSelector('cor-function-head-'+index,'Functional head role (optional)',f.headRoleCode,x=>editFunction(index,{headRoleCode:x}))}
      <SelectField id={'cor-function-reports-'+index} label="Reports into corporate function" disabled={!canEdit}
       value={f.reportsToCode} onChange={e=>editFunction(index,{reportsToCode:e.target.value})}>
       <option value="">Corporate Office / top-level function</option>
       {data.functions.filter(x=>x.code!==f.code).map(x=><option key={x.code} value={x.code}>{x.name}</option>)}
      </SelectField>
      <EntitySelection entities={entities} selected={f.oversightEntityIds} label="Legal-entity oversight (optional)"
       onChange={x=>editFunction(index,{oversightEntityIds:x})}/>
      <div className="flex flex-wrap items-center justify-between gap-2">
       <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit} className="h-5 w-5 accent-brand"
        checked={f.enabled} onChange={e=>editFunction(index,{enabled:e.target.checked})}/>Enabled</label>
       {canEdit&&<button type="button" className={btn} onClick={()=>edit(c=>({...c,functions:c.functions.filter((_,i)=>i!==index)}))}><Trash2 className="mr-1 inline h-4 w-4"/>Remove</button>}
      </div>
     </div>}
    </section>)}
   </div>}
   {section==='bodies'&&<div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
     <h3 className="flex items-center gap-2 font-semibold"><Users className="h-5 w-5 text-brand"/>Governance Bodies</h3>
     {canEdit&&<button type="button" className={btn} disabled={data.bodies.length>=60} onClick={()=>{
      const code=freshCode('GOV');edit(c=>({...c,bodies:[...c.bodies,{code,name:'New governance body',description:'',
       kind:'committee',enabled:true,chairRoleCode:'',scope:'group',entityIds:[]}]}));setExpanded(code);
     }}><Plus className="mr-1 inline h-4 w-4"/>Add body</button>}
    </div>
    <p className="text-xs text-muted">Default bodies cover the Group Board, Executive Committee, Audit & Risk, People & Remuneration, Investment & Capital, and SHEQ. These are governance records only: actual approval rights still require separate Workflow/CoA configuration.</p>
    {data.bodies.map((b,index)=><section key={index} className="min-w-0 rounded-xl border border-line bg-panel">
     <button type="button" className="flex min-h-14 w-full items-center justify-between gap-2 px-3 py-2 text-left"
      onClick={()=>setExpanded(expanded===b.code?'':b.code)} aria-expanded={expanded===b.code}>
      <span className="min-w-0"><strong className="block break-words text-sm">{b.name}</strong>
       <span className="font-mono text-xs text-muted">{b.code} · {b.scope==='group'?'Group-wide':'Selected legal entities'} · {b.enabled?'Enabled':'Disabled'}</span></span>
      <Landmark className="h-4 w-4 shrink-0 text-muted"/>
     </button>
     {expanded===b.code&&<div className="space-y-3 border-t border-line p-3">
      <div className="grid gap-3 sm:grid-cols-2">
       <label className="block text-sm text-muted">Body code<input className={field} disabled={!canEdit} maxLength={20} value={b.code}
        onChange={e=>editBody(index,{code:e.target.value.toUpperCase()})}/></label>
       <label className="block text-sm text-muted">Body name<input className={field} disabled={!canEdit} maxLength={120} value={b.name}
        onChange={e=>editBody(index,{name:e.target.value})}/></label>
      </div>
      <SelectField id={'cor-body-kind-'+index} label="Governance body type" disabled={!canEdit} value={b.kind}
       onChange={e=>editBody(index,{kind:e.target.value as Body['kind']})}>
       {['board','committee','council','forum'].map(x=><option key={x} value={x}>{x}</option>)}
      </SelectField>
      <label className="block text-sm text-muted">Mandate / responsibilities<textarea className={field+' min-h-20 p-3'} disabled={!canEdit}
       value={b.description} onChange={e=>editBody(index,{description:e.target.value})}/></label>
      {rolesSelector('cor-body-chair-'+index,'Chairperson role (optional)',b.chairRoleCode,x=>editBody(index,{chairRoleCode:x}))}
      <SelectField id={'cor-body-scope-'+index} label="Governance jurisdiction" disabled={!canEdit} value={b.scope}
       onChange={e=>editBody(index,{scope:e.target.value as Body['scope'],entityIds:[]})}>
       <option value="group">Group-wide (all legal entities)</option>
       <option value="entities">Selected legal entities</option>
      </SelectField>
      {b.scope==='entities'&&<EntitySelection entities={entities} selected={b.entityIds}
       label="Legal entities covered by this governance body" onChange={x=>editBody(index,{entityIds:x})}/>}
      <div className="flex flex-wrap items-center justify-between gap-2">
       <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand"
        disabled={!canEdit} checked={b.enabled} onChange={e=>editBody(index,{enabled:e.target.checked})}/>Enabled</label>
       {canEdit&&<button type="button" className={btn} onClick={()=>edit(c=>({...c,bodies:c.bodies.filter((_,i)=>i!==index)}))}><Trash2 className="mr-1 inline h-4 w-4"/>Remove</button>}
      </div>
     </div>}
    </section>)}
   </div>}
   {section!=='funding'&&section!=='mapping'&&section!=='budget'&&section!=='allocation'&&<section className="space-y-2 rounded-xl border border-line bg-panel p-3">
    <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand"/>
     <p className="text-xs text-muted">Governance scope is a policy reference only. It grants no new user permissions, workflow approvals, employment contracts or cost allocations. Those require their own governed configuration.</p></div>
    {canEdit&&<button type="button" disabled={busy||loading} onClick={()=>void save()}
     className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-onbrand disabled:opacity-40">
     <Save className="h-5 w-5"/>Save Corporate Governance configuration
    </button>}
   </section>}
  </>}
 </div>;
}
