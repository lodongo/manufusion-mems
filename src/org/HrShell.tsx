import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Building2, BriefcaseBusiness, Users, UserRound, Network, ShieldCheck, Search } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import RichTable from '../components/RichTable';

type Person={uid:string;name:string;employeeNumber:string;status:string;jobRole:string};
type Node={id:string;name:string;code:string;level:string;parentId:string;status:string};
type Role={code:string;title:string;description:string;parentCode:string;operatingLevel:string};
const SECTIONS=[
 ['HR01','My HR Portal'],['HR02','Employee Records & Administration'],['HR03','HR Policies & Procedures'],
 ['HR04','Organization Structure & Design'],['HR05','Job Roles & Position Profiles'],['HR06','Employment Types & Categories'],
 ['HR07','Job Grading & Classification'],['HR08','Workforce Establishment, Deployment & Vacancies'],
 ['HR09','Recruitment, Onboarding & Confirmation'],['HR10','Leave & Absence Management'],
 ['HR11','Compensation, Benefits & Payroll Interface'],['HR12','Performance Management'],
 ['HR13','Learning, Skills & Career Development'],['HR14','Employee Relations & Disciplinary Management'],
 ['HR15','Employee Engagement & Feedback'],['HR16','Employee Movements, Separation & Offboarding']
] as const;
const personColumns=[{key:'employeeNumber',label:'Employee number',value:(p:Person)=>p.employeeNumber},{key:'name',label:'Employee',value:(p:Person)=>p.name},{key:'jobRole',label:'Job role',value:(p:Person)=>p.jobRole},{key:'status',label:'Status',value:(p:Person)=>p.status}];
const structureColumns=[{key:'code',label:'Code',value:(n:Node)=>n.code},{key:'name',label:'Name',value:(n:Node)=>n.name},{key:'level',label:'Type',value:(n:Node)=>n.level.replaceAll('_',' ')},{key:'parentId',label:'Parent',value:(n:Node)=>n.parentId},{key:'status',label:'Status',value:(n:Node)=>n.status}];
const roleColumns=[{key:'code',label:'Role code',value:(r:Role)=>r.code},{key:'title',label:'Role title',value:(r:Role)=>r.title},{key:'operatingLevel',label:'Level',value:(r:Role)=>r.operatingLevel},{key:'parentCode',label:'Reports to',value:(r:Role)=>r.parentCode}];
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
 const [nodeId,setNodeId]=useState('');
 const [roleCode,setRoleCode]=useState('');
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
 const chosenNode=nodes?.find(n=>n.id===nodeId);
 const chosenRole=roles?.find(r=>r.code===roleCode);
 const show=(code:string)=>!sectionCode||sectionCode===code;
 const showData=Boolean((show('HR01')&&self)||(show('HR02')&&directory)||(show('HR04')&&nodes)||(show('HR05')&&roles)||(show('HR08')&&(team||directory||nodes||roles)));
 return <div className="flex h-[calc(100dvh-9rem)] min-h-[420px] min-w-0 flex-col overflow-hidden bg-page text-ink">
  <header className="flex shrink-0 items-center gap-3 border-b border-line bg-page px-3 py-3 sm:px-5">
   {selected&&<button onClick={()=>navigate('organization_home/module/HRM')} aria-label="HR home" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line"><ArrowLeft className="h-5 w-5"/></button>}
   <div className="min-w-0 flex-1"><div className="text-xs font-semibold text-blue-500">HUMAN RESOURCES {sectionCode?'· '+sectionCode:''}</div><h1 className="truncate text-lg font-bold">{selected?.[1]||'HR Workspace'}</h1></div>
   {(sectionCode==='HR04'||sectionCode==='HR05')&&<span className="shrink-0 rounded-full border border-line px-2 py-1 text-xs text-muted">Read only</span>}
  </header>
  <main className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 sm:p-5">
   {!sectionCode&&<><div className="relative"><Search className="absolute left-3 top-3 h-5 w-5 text-muted"/><input aria-label="Search HR modules" className="w-full rounded-xl border border-line bg-panel py-3 pl-10 pr-3 text-sm" placeholder="Search HR modules" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="grid gap-2 md:grid-cols-2">{visible.map(([code,title])=><button key={code} onClick={()=>openSection(code)} className="flex min-h-16 items-center gap-3 rounded-xl border border-line bg-panel p-4 text-left"><span className="rounded-lg bg-blue-500/10 px-2 py-2 text-xs font-bold text-blue-500">{code}</span><span className="min-w-0 flex-1 text-sm font-semibold">{title}</span><ChevronRight className="h-5 w-5 shrink-0 text-muted"/></button>)}</div></>}
   {loading&&<div className="rounded-xl bg-panel p-3 text-sm text-muted">Loading authorized records…</div>}
   {error&&<div role="alert" className="rounded-xl border border-line bg-panel p-3 text-sm text-muted">{error}</div>}
   {show('HR01')&&self&&<Panel title="My employee record"><button type="button" onClick={()=>navigate('organization_home/hr/HR01/employee/'+self.uid)} className="mb-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-line bg-page px-3 text-sm font-semibold text-brand">Open full employee portal <ChevronRight className="h-4 w-4"/></button><div className="grid grid-cols-2 gap-3 text-sm"><div className="col-span-2 flex items-center gap-3 rounded-xl bg-page p-4"><UserRound className="h-8 w-8 text-blue-500"/><strong>{self.name}</strong></div>{[['Employee number',self.employeeNumber],['Assigned position',self.jobRole],['Status',self.status]].map(([k,v])=><div className="rounded-xl bg-page p-3" key={k}><div className="text-xs text-muted">{k}</div><div className="mt-1 font-semibold">{v||'Not recorded'}</div></div>)}</div></Panel>}
   {show('HR02')&&directory&&<Panel title="Site employee records"><RichTable id="hr-employees-v2" columns={personColumns} rows={directory} rowKey={r=>r.uid} onRowClick={employee=>navigate("organization_home/hr/HR02/employee/"+employee.uid)} allowExport={false} height="h-[48dvh]" empty="No employee records at your authorized site."/></Panel>}
   {show('HR04')&&nodes&&<Panel title="Approved organization structure"><div className="mb-3 flex flex-wrap gap-2 text-xs text-muted"><Building2 className="h-4 w-4"/>{nodes.filter(n=>n.level==='site').length} sites · {nodes.filter(n=>n.level==='department').length} departments · {nodes.filter(n=>n.level==='cost_center').length} cost centres</div><RichTable id="hr-structure-v2" columns={structureColumns} rows={nodes} rowKey={r=>r.id} onRowClick={n=>setNodeId(n.id)} height="h-[43dvh]"/>{chosenNode&&<div className="mt-3 rounded-xl bg-page p-3 text-sm"><strong>{chosenNode.name}</strong><div className="mt-1 text-muted">{chosenNode.code} · {chosenNode.level.replaceAll('_',' ')} · Parent: {chosenNode.parentId||'Root'}</div><div className="mt-2 font-semibold">Child units</div><div className="mt-1 space-y-1">{nodes.filter(n=>n.parentId===chosenNode.id).map(n=><button key={n.id} className="block w-full rounded-lg border border-line p-2 text-left" onClick={()=>setNodeId(n.id)}>{n.name} ({n.code})</button>)}</div></div>}</Panel>}
   {show('HR05')&&roles&&<Panel title="Approved role catalogue"><div className="mb-3 flex items-center gap-2 text-xs text-muted"><BriefcaseBusiness className="h-4 w-4"/>{roles.length} registered job roles</div><RichTable id="hr-roles-v2" columns={roleColumns} rows={roles} rowKey={r=>r.code} onRowClick={r=>setRoleCode(r.code)} height="h-[45dvh]"/>{chosenRole&&<div className="mt-3 rounded-xl bg-page p-3 text-sm"><strong>{chosenRole.title}</strong><div className="mt-1 text-muted">{chosenRole.code} · {chosenRole.operatingLevel}</div><p className="mt-2">{chosenRole.description||'No description recorded.'}</p><p className="mt-2 text-muted">Reports to: {roles.find(r=>r.code===chosenRole.parentCode)?.title||chosenRole.parentCode||'Not recorded'}</p></div>}</Panel>}
   {show('HR08')&&<><div className="grid grid-cols-2 gap-3">{[['Registered roles',roles?.length],['Organization units',nodes?.length],['Authorized site employees',directory?.length],['Manager team',team?.length]].map(([k,v])=><div key={String(k)} className="rounded-xl border border-line bg-panel p-4"><div className="text-xs text-muted">{k}</div><div className="mt-2 text-2xl font-bold">{v??'—'}</div></div>)}</div>{team&&<Panel title="My management hierarchy"><RichTable id="hr-team-v2" columns={personColumns} rows={team} rowKey={r=>r.uid} onRowClick={employee=>navigate("organization_home/hr/HR08/employee/"+employee.uid)} allowExport={false} height="h-[40dvh]"/></Panel>}</>}
   {sectionCode&&!loading&&!showData&&<Unavailable/>}
  </main>
 </div>;
}
