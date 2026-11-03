import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Building2, BriefcaseBusiness, Users, UserRound, Network, ShieldCheck, Search, MoreVertical, UserPlus, Hash, Gauge } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { firebaseAuth } from '../firebase';
import RichTable from '../components/RichTable';
import HrSkillsWorkspace from './HrSkillsWorkspace';
import HrLeavePanel from './HrLeavePanel';
import HrCompensationApprovals from './HrCompensationApprovals';
import HrStructureExplorer from './HrStructureExplorer';
import HrRoleExplorer from './HrRoleExplorer';
import type {HrRoleCardData} from './hrRoleHierarchy';
import type {HrStructureNode} from './hrStructureTree';
import {fitLabel,type SkillFit} from './HrRoleSkillFit';
import {HrAssignNumbersSheet,useEmployeeAdmin} from './HrEmployeeAdmin';
import Sheet from '../components/Sheet';

type Person={uid:string;name:string;employeeNumber:string;status:string;jobRole:string;jobRoleTitle?:string;photoUrl?:string;skillFit?:SkillFit};
type Node=HrStructureNode;
type Role=HrRoleCardData;
const SECTIONS=[
 ['HR01','My HR Portal'],['HR02','Employee Records & Administration'],['HR03','HR Policies & Procedures'],
 ['HR04','Organization Structure & Design'],['HR05','Job Roles & Position Profiles'],['HR06','Employment Types & Categories'],
 ['HR07','Job Grading & Classification'],['HR08','Workforce Establishment, Deployment & Vacancies'],
 ['HR09','Recruitment, Onboarding & Confirmation'],['HR10','Leave & Absence Management'],
 ['HR11','Compensation, Benefits & Payroll Interface'],['HR12','Performance Management'],
 ['HR13','Learning, Skills & Career Development'],['HR14','Employee Relations & Disciplinary Management'],
 ['HR15','Employee Engagement & Feedback'],['HR16','Employee Movements, Separation & Offboarding']
] as const;
const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]?.toUpperCase()).join('')||'?';
function Avatar({person,size=48}:{person:Person;size?:number}){
 const [bad,setBad]=useState(false);
 useEffect(()=>setBad(false),[person.photoUrl]);
 const box={width:size,height:size} as const;
 return person.photoUrl&&!bad
  ?<img src={person.photoUrl} alt={'Photo of '+person.name} style={box} className="shrink-0 rounded-full border border-line object-cover" referrerPolicy="no-referrer" loading="lazy" onError={()=>setBad(true)}/>
  :<span style={box} aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-full bg-brand/15 text-sm font-bold text-brand">{initials(person.name)}</span>;
}
const STATUS_TONE:Record<string,string>={active:'bg-emerald-500/15 text-emerald-500',suspended:'bg-amber-500/15 text-amber-500',invited:'bg-sky-500/15 text-sky-500'};
const fitPct=(p:Person)=>p.skillFit?.percentage;
const personColumns=[
 {key:'employee',label:'Employee',value:(p:Person)=>p.name+' '+p.employeeNumber,className:'min-w-[15rem]',render:(p:Person)=><span className="flex items-center gap-3 py-1"><Avatar person={p}/><span className="min-w-0"><span className="block truncate text-base font-semibold text-ink">{p.name||'Unnamed'}</span><span className="block font-mono text-xs text-muted">{p.employeeNumber||'No number yet'}</span></span></span>},
 {key:'jobRole',label:'Job role',value:(p:Person)=>p.jobRoleTitle||p.jobRole,className:'min-w-[11rem]',render:(p:Person)=><span className="block text-sm text-ink">{p.jobRoleTitle||p.jobRole||'—'}{p.jobRoleTitle&&p.jobRole?<span className="block font-mono text-xs text-muted">{p.jobRole}</span>:null}</span>},
 {key:'status',label:'Status',value:(p:Person)=>p.status,render:(p:Person)=><span className={'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize '+(STATUS_TONE[p.status]||'bg-page text-muted')}>{p.status||'—'}</span>},
 {key:'skillFit',label:'Role skill fit',type:'number' as const,value:(p:Person)=>fitPct(p)??null,className:'min-w-[8rem]',render:(p:Person)=>{const v=fitPct(p);return v===null||v===undefined?<span className="text-xs text-muted">{fitLabel(p.skillFit)}</span>:<span className="block"><span className="text-sm font-semibold text-ink">{v}%</span><span className="mt-1 block h-1.5 w-24 overflow-hidden rounded-full bg-page"><span className="block h-full rounded-full bg-brand" style={{width:Math.min(100,v)+'%'}}/></span></span>}},
];
type SectionCode=typeof SECTIONS[number][0];
const openSection=(code:SectionCode)=>navigate('organization_home/hr/'+code);
function Panel({title,children}:{title:string;children:React.ReactNode}){return <section className="min-w-0 rounded-2xl border border-line bg-panel p-3 sm:p-4"><h2 className="mb-3 font-semibold text-ink">{title}</h2>{children}</section>}
function Unavailable(){return <Panel title="No accessible records"><div className="flex items-center gap-3 rounded-xl bg-page p-4"><ShieldCheck className="h-6 w-6 shrink-0 text-muted"/><p className="text-sm text-muted">No verified read-only data source is connected to this module yet. Existing MEMS records will be displayed here once an authorized endpoint is available.</p></div></Panel>}
export default function HrShell({sectionCode}:{sectionCode?:string}){
 const selected=SECTIONS.find(s=>s[0]===sectionCode);
 const [self,setSelf]=useState<Person|null>(null);
 const [directory,setDirectory]=useState<Person[]|null>(null);
 const [team,setTeam]=useState<Person[]|null>(null);
 const [nodes,setNodes]=useState<Node[]|null>(null);
 const [roles,setRoles]=useState<Role[]|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [query,setQuery]=useState('');
 const [menu,setMenu]=useState(false);
 const [numbers,setNumbers]=useState(false);
 const admin=useEmployeeAdmin();
 useEffect(()=>{
  let alive=true;setLoading(true);setError('');setSelf(null);setDirectory(null);setTeam(null);setNodes(null);setRoles(null);
  const promises:Promise<unknown>[]=[];
  const request=<T,>(url:string,setter:(d:T)=>void)=>{promises.push(callBackend<T>(url).then(r=>{if(alive)setter(r)}).catch(e=>{if(alive&&/\/structure|\/roles|\/self/.test(url))setError(e instanceof Error?e.message:'Data unavailable')}))};
  if(!sectionCode||sectionCode==='HR01')request<{employee:Person}>('/api/org/hr/self',r=>setSelf(r.employee));
  if(!sectionCode||sectionCode==='HR02'||sectionCode==='HR08')request<{employees:Person[]}>('/api/org/hr/site-directory',r=>setDirectory(r.employees));
  if(!sectionCode||sectionCode==='HR08')request<{employees:Person[]}>('/api/org/hr/manager-team',r=>setTeam(r.employees));
  if(!sectionCode||sectionCode==='HR04'||sectionCode==='HR08')request<{nodes:Node[]}>('/api/org/hr/structure',r=>setNodes(r.nodes));
  if(!sectionCode||sectionCode==='HR05'||sectionCode==='HR08')request<{roles:Role[]}>('/api/org/hr/roles',r=>setRoles(r.roles));
  Promise.all(promises).finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[sectionCode]);
 const visible=useMemo(()=>SECTIONS.filter(s=>(s[1]+' '+s[0]).toLowerCase().includes(query.toLowerCase())),[query]);
 const show=(code:string)=>!sectionCode||sectionCode===code;
 const showData=Boolean((show('HR01')&&self)||(show('HR02')&&directory)||(show('HR04')&&nodes)||(show('HR05')&&roles)||(show('HR08')&&(team||directory||nodes||roles)));
 return <div className="flex h-[calc(100dvh-9rem)] min-h-[420px] min-w-0 flex-col overflow-hidden bg-page text-ink">
  <header className="flex shrink-0 items-center gap-3 border-b border-line bg-page px-3 py-3 sm:px-5">
   {selected&&<button onClick={()=>navigate('organization_home/module/HRM')} aria-label="HR home" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line"><ArrowLeft className="h-5 w-5"/></button>}
   <div className="min-w-0 flex-1"><div className="text-xs font-semibold text-brand">HUMAN RESOURCES {sectionCode?'· '+sectionCode:''}</div><h1 className="truncate text-lg font-bold">{selected?.[1]||'HR Workspace'}</h1></div>
   {(sectionCode==='HR04'||sectionCode==='HR05')&&<span className="shrink-0 rounded-full border border-line px-2 py-1 text-xs text-muted">Read only</span>}
  </header>
  <main className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 sm:p-5">
   {!sectionCode&&<><div className="relative"><Search className="absolute left-3 top-3 h-5 w-5 text-muted"/><input aria-label="Search HR modules" className="w-full rounded-xl border border-line bg-panel py-3 pl-10 pr-3 text-sm" placeholder="Search HR modules" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="grid gap-2 md:grid-cols-2">{visible.map(([code,title])=><button key={code} onClick={()=>openSection(code)} className="flex min-h-16 items-center gap-3 rounded-xl border border-line bg-panel p-4 text-left"><span className="rounded-lg bg-brand/10 px-2 py-2 text-xs font-bold text-brand">{code}</span><span className="min-w-0 flex-1 text-sm font-semibold">{title}</span><ChevronRight className="h-5 w-5 shrink-0 text-muted"/></button>)}</div></>}
   {loading&&<div className="rounded-xl bg-panel p-3 text-sm text-muted">Loading authorized records…</div>}
   {error&&<div role="alert" className="rounded-xl border border-line bg-panel p-3 text-sm text-muted">{error}</div>}
   {show('HR01')&&self&&<Panel title="My employee record"><button type="button" onClick={()=>navigate('organization_home/hr/HR01/employee/'+self.uid)} className="mb-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-line bg-page px-3 text-sm font-semibold text-brand">Open full employee portal <ChevronRight className="h-4 w-4"/></button><div className="grid grid-cols-2 gap-3 text-sm"><div className="col-span-2 flex items-center gap-3 rounded-xl bg-page p-4"><UserRound className="h-8 w-8 text-brand"/><strong>{self.name}</strong></div>{[['Employee number',self.employeeNumber],['Assigned position',self.jobRole],['Status',self.status]].map(([k,v])=><div className="rounded-xl bg-page p-3" key={k}><div className="text-xs text-muted">{k}</div><div className="mt-1 font-semibold">{v||'Not recorded'}</div></div>)}</div></Panel>}
   {show('HR02')&&directory&&(()=>{
     const withFit=directory.filter(x=>fitPct(x)!==null&&fitPct(x)!==undefined);
     const avg=withFit.length?Math.round(withFit.reduce((t,x)=>t+(fitPct(x)||0),0)/withFit.length)+'%':'Not configured';
     const missing=admin.setup?.missingNumbers||0;
     const maximised=sectionCode==='HR02';
     return <section className="min-w-0 rounded-2xl border border-line bg-panel p-3 sm:p-4">
       <div className="mb-3 flex items-center gap-2">
         <div className="min-w-0 flex-1"><h2 className="font-semibold text-ink">Employees</h2><p className="text-xs text-muted">{directory.length} at your authorized site{missing>0?' · '+missing+' without a number':''}</p></div>
         {admin.setup&&<button type="button" onClick={()=>navigate('organization_home/hr/HR02/new')} className="flex min-h-11 items-center gap-2 rounded-xl bg-brand px-3 text-sm font-semibold text-onbrand"><UserPlus className="h-4 w-4"/><span className="hidden sm:inline">Add employee</span><span className="sm:hidden">Add</span></button>}
         <button type="button" aria-label="Employee menu" aria-haspopup="dialog" onClick={()=>setMenu(true)} className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-line text-ink"><MoreVertical className="h-5 w-5"/>{missing>0&&<span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-amber-500"/>}</button>
       </div>
       <RichTable id="hr-employees-v3" title="Employees" columns={personColumns} rows={directory} rowKey={r=>r.uid} onRowClick={employee=>navigate("organization_home/hr/HR02/employee/"+employee.uid)} allowExport={false} height={maximised?"h-[calc(100dvh-15rem)]":"h-[48dvh]"} empty="No employee records at your authorized site." rowClassName={()=>'min-h-[4.5rem]'}/>
       {menu&&<Sheet title="Employees" onClose={()=>setMenu(false)}>
         <div className="grid grid-cols-2 gap-2">
           <div className="rounded-xl bg-page p-3"><p className="text-xs text-muted">Employees with role skills</p><p className="mt-1 text-xl font-bold">{withFit.length}/{directory.length}</p></div>
           <div className="rounded-xl bg-page p-3"><p className="text-xs text-muted">Average confirmed fit</p><p className="mt-1 text-xl font-bold text-brand">{avg}</p></div>
         </div>
         {admin.setup?<>
           <p className="text-xs text-muted">Employees get a sign-in account and an employee number ({admin.setup.format.replace(/0/g,'n')}).</p>
           <button type="button" onClick={()=>{setMenu(false);navigate('organization_home/hr/HR02/new');}} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line px-3 text-left text-sm font-semibold text-ink"><UserPlus className="h-5 w-5 text-brand"/>Add employee</button>
           {missing>0&&<button type="button" onClick={()=>{setMenu(false);setNumbers(true);}} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line px-3 text-left text-sm font-semibold text-ink"><Hash className="h-5 w-5 text-amber-500"/>Update employee numbers ({missing})</button>}
         </>:<p className="text-xs text-muted">Adding employees needs the employee administration right.</p>}
         <button type="button" onClick={()=>{setMenu(false);openSection('HR13');}} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line px-3 text-left text-sm font-semibold text-ink"><Gauge className="h-5 w-5 text-brand"/>Skills and role fit</button>
       </Sheet>}
       {numbers&&<HrAssignNumbersSheet onClose={()=>setNumbers(false)} onDone={()=>{setNumbers(false);admin.reload();}}/>}
     </section>;
   })()}
   {show('HR04')&&nodes&&<HrStructureExplorer nodes={nodes}/>}
   {show('HR05')&&roles&&<HrRoleExplorer roles={roles}/>}
   {show('HR08')&&<><div className="grid grid-cols-2 gap-3">{[['Registered roles',roles?.length],['Organization units',nodes?.length],['Authorized site employees',directory?.length],['Manager team',team?.length]].map(([k,v])=><div key={String(k)} className="rounded-xl border border-line bg-panel p-4"><div className="text-xs text-muted">{k}</div><div className="mt-2 text-2xl font-bold">{v??'—'}</div></div>)}</div>{team&&<Panel title="My management hierarchy"><RichTable id="hr-team-v2" columns={personColumns} rows={team} rowKey={r=>r.uid} onRowClick={employee=>navigate("organization_home/hr/HR08/employee/"+employee.uid)} allowExport={false} height="h-[40dvh]"/></Panel>}</>}
   {show('HR10')&&<HrLeavePanel employeeUid={firebaseAuth.currentUser?.uid||''} showInbox />}
   {show('HR13')&&<HrSkillsWorkspace ownUid={firebaseAuth.currentUser?.uid||''} />}
   {sectionCode==='HR11'&&<HrCompensationApprovals/>}
   {sectionCode!=='HR13'&&sectionCode!=='HR10'&&sectionCode!=='HR11'&&sectionCode&&!loading&&!showData&&<Unavailable/>}
  </main>
 </div>;
}
