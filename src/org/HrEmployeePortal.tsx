import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft, Award, BookOpen, BriefcaseBusiness, CalendarDays, ChartNoAxesCombined,
  ChevronRight, ClipboardList, FileText, GraduationCap, HeartHandshake, IdCard,
  Layers, LockKeyhole, MapPin, Network, ShieldCheck, Target, UserRound, Users, Wallet
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { SelectField } from '../components/ui';
import { navigate } from '../lib/route';
import { firebaseAuth } from '../firebase';
import HrSelfRecords from './HrSelfRecords';
import { EmployeeSkillPanel } from './HrSkillsWorkspace';
import HrLeavePanel from './HrLeavePanel';
import HrRoleSkillFit, {type SkillFit} from './HrRoleSkillFit';
import HrRoleSkillRequirements from './HrRoleSkillRequirements';

type Deployment = {nodeId:string;location:string;level:string;positionCode:string;positionTitle:string;startDate:string;endDate:string;siteId:string};
type EmployeeRole = {code:string;title:string;description:string;reportsToCode:string;operatingLevel:string;requiredSkillCodes:string[]};
type Profile = {uid:string;name:string;employeeNumber:string;status:string;primaryRole:string;primaryLocation:string;department:string;site:string};
type PortalData = {profile:Profile;deployments:Deployment[];roles:EmployeeRole[];requiredSkills:string[];skillFit:SkillFit;access:{scope:string;readOnlyTabs:string[];allowedTabs:string[];selfServiceTabs:string[];isOwnRecord:boolean}};
type TabKey = 'basic'|'education'|'family'|'skills'|'roleSkills'|'deployment'|'records'|'roles'|'payslips'|'talent'|'leave'|'capability'|'performance'|'learning'|'history';
const TABS:{key:TabKey;label:string;Icon:LucideIcon}[]=[
  {key:'basic',label:'Basic Information',Icon:IdCard},
  {key:'education',label:'Education',Icon:GraduationCap},
  {key:'family',label:'Family',Icon:Users},
  {key:'skills',label:'Skills',Icon:Award},
  {key:'roleSkills',label:'Role Skill Requirements',Icon:Target},
  {key:'deployment',label:'Deployment',Icon:MapPin},
  {key:'records',label:'Records',Icon:FileText},
  {key:'roles',label:'Roles & Responsibilities',Icon:BriefcaseBusiness},
  {key:'payslips',label:'Payslips',Icon:Wallet},
  {key:'talent',label:'Talent Pipeline',Icon:Network},
  {key:'leave',label:'Leave Management',Icon:CalendarDays},
  {key:'capability',label:'Capability Assessment',Icon:ClipboardList},
  {key:'performance',label:'Performance Management',Icon:ChartNoAxesCombined},
  {key:'learning',label:'Learning & Development',Icon:BookOpen},
  {key:'history',label:'Employment History',Icon:Layers},
];
const RESTRICTED=new Set<TabKey>(['payslips','records','talent','leave','capability','performance','learning','history']);
function Info({label,value}:{label:string;value?:string}) {
 return <div className="min-w-0 rounded-xl border border-line bg-page p-3"><div className="text-xs text-muted">{label}</div><div className="mt-1 break-words text-sm font-semibold text-ink">{value||'Not recorded'}</div></div>;
}
function Panel({title,children}:{title:string;children:ReactNode}) {
 return <section className="min-w-0 rounded-2xl border border-line bg-panel p-3 sm:p-5"><h2 className="mb-3 text-base font-bold text-ink">{title}</h2>{children}</section>;
}
function EmptyRecords({label}:{label:string}) {
 return <section className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-panel p-5 text-center">
  <LockKeyhole className="h-7 w-7 text-muted"/>
  <h2 className="text-sm font-bold">No accessible {label.toLowerCase()} records</h2>
  <p className="max-w-md text-xs leading-relaxed text-muted">No verified records are connected to this tab.</p>
 </section>;
}
export default function HrEmployeePortal({uid,origin='HR02',selfView=false,reporteeView=false}:{uid:string;origin?:'HR01'|'HR02'|'HR08';selfView?:boolean;reporteeView?:boolean}) {
 const [data,setData]=useState<PortalData|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [tab,setTab]=useState<TabKey>('basic');
 const [reportees,setReportees]=useState<number>(0);
 const [qualification,setQualification]=useState('');
 const back=()=>navigate(reporteeView?'organization_home/hr/HR01/reportees':'organization_home/hr/'+origin);
 const refreshFit=async()=>{
  const updated=await callBackend<PortalData>('/api/org/hr/employee/portal',{uid});
  setData(updated);
 };
 useEffect(()=>{
  let alive=true;setLoading(true);setData(null);setError('');setTab('basic');
  callBackend<PortalData>('/api/org/hr/employee/portal',{uid})
    .then(result=>{if(alive)setData(result)})
    .catch(err=>{if(alive)setError(err instanceof Error?err.message:'The employee record could not be opened.')})
    .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[uid]);
 useEffect(()=>{
  if(!selfView)return;
  let active=true;
  callBackend<{employees:Array<{uid:string}>}>('/api/org/hr/reportees').then(r=>{if(active)setReportees(r.employees.length)}).catch(()=>{});
  callBackend<{education:Array<{qualification?:string;completionYear?:string}>}>('/api/org/hr/private/get',{uid})
    .then(r=>{if(active)setQualification(r.education?.slice().sort((a,b)=>(b.completionYear||'').localeCompare(a.completionYear||''))[0]?.qualification||'')}).catch(()=>{});
  return()=>{active=false};
 },[uid,selfView]);
 const visibleTabs=TABS.filter(item=>data?.access.allowedTabs?.includes(item.key));
 const active=TABS.find(item=>item.key===tab)||TABS[0];
 const ActiveIcon=active.Icon;
 return <div className="flex h-[calc(100dvh-9rem)] min-h-[420px] min-w-0 flex-col overflow-hidden bg-page text-ink">
  <header className="flex shrink-0 items-center gap-3 border-b border-line bg-page px-3 py-3 sm:px-5">
   {!selfView&&<button type="button" onClick={back} aria-label="Back to employee list" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-panel"><ArrowLeft className="h-5 w-5"/></button>}
   <div className="min-w-0 flex-1"><p className="text-[11px] font-semibold uppercase tracking-wider text-blue-500">Human Resources · Employee portal</p><h1 className="truncate text-base font-bold sm:text-xl">{selfView?'My HR Portal':data?.profile.name||'Employee HR portal'}</h1></div>

  </header>
  <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5">
   {loading&&<div role="status" className="rounded-xl border border-line bg-panel p-4 text-sm text-muted">Loading the authorized employee record…</div>}
   {error&&<div role="alert" className="rounded-xl border border-line bg-panel p-4 text-sm text-red-600">{error}<button type="button" className="mt-3 block text-sm font-semibold text-brand underline" onClick={back}>Return to employees</button></div>}
   {data&&<>
    <section className={`relative mb-4 overflow-hidden rounded-2xl ${selfView?'bg-brand text-onbrand shadow-lg':'border border-line bg-panel p-4'}`}>
      {selfView&&<div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 h-52 w-52 rounded-full border-[28px] border-white/10"/>}
      <div className="relative flex min-w-0 items-center gap-3 p-4 sm:p-5">
       <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${selfView?'bg-white/20':'bg-brand/10 text-brand'}`}><UserRound className="h-9 w-9"/></div>
       <div className="min-w-0 flex-1"><p className="text-[11px] font-semibold uppercase tracking-widest opacity-80">{selfView?'My employee card':'Employee record'}</p>
        <h2 className="truncate text-xl font-bold">{data.profile.name||'Unnamed employee'}</h2>
        <p className="truncate text-xs opacity-90">{data.profile.employeeNumber||'Employee number not recorded'} · {data.profile.primaryRole||'Position not assigned'}</p>
        <p className="truncate text-xs opacity-80">{data.profile.department||data.profile.primaryLocation||'Department not recorded'}</p>
       </div>
      </div>
      {selfView&&<div className="relative grid grid-cols-2 gap-2 border-t border-white/20 bg-black/10 p-3 sm:grid-cols-3">
       {[[ 'Highest qualification',qualification||'Not recorded'],['Site',data.profile.site||'Not recorded'],['Status',data.profile.status||'Not recorded']].map(([label,value])=>
        <div key={label} className="min-w-0 rounded-xl bg-white/15 p-3"><p className="text-[11px] opacity-80">{label}</p><p className="mt-1 break-words text-sm font-semibold">{value}</p></div>)}
      </div>}
    </section>
    {data.access.allowedTabs?.includes('skills')&&<div className="mb-4"><HrRoleSkillFit fit={data.skillFit}/></div>}
    {selfView&&reportees>0&&<button type="button" onClick={()=>navigate('organization_home/hr/HR01/reportees')} className="mb-4 flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-panel px-4 text-left text-brand">
      <Network className="h-5 w-5"/><span className="flex-1 font-semibold">My Reportees <span className="ml-1 text-sm font-normal text-muted">({reportees})</span></span><ChevronRight className="h-5 w-5"/></button>}
    <div className="grid min-w-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
     <nav aria-label="Employee HR portal tabs" className="min-w-0 lg:sticky lg:top-0 lg:self-start">
      <div className="lg:hidden">
       <SelectField id="employee-hr-portal-section" label="Employee HR section" value={tab}
        onChange={e=>setTab(e.target.value as TabKey)}>
        {visibleTabs.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}
       </SelectField>
      </div>
      <div className="hidden max-h-[65dvh] space-y-1 overflow-y-auto rounded-2xl border border-line bg-panel p-2 lg:block">
       {visibleTabs.map(({key,label,Icon})=><button key={key} type="button" onClick={()=>setTab(key)} aria-current={tab===key?'page':undefined}
        className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm ${tab===key?'bg-blue-500/10 font-semibold text-blue-600':'text-ink hover:bg-page'}`}>
         <Icon className="h-4 w-4 shrink-0"/><span className="min-w-0 flex-1">{label}</span>{tab===key&&<ChevronRight className="h-4 w-4"/>}
       </button>)}
      </div>
     </nav>
     <div className="min-w-0 space-y-3">
      <div className="flex items-center gap-2"><ActiveIcon className="h-5 w-5 text-blue-500"/><h2 className="min-w-0 flex-1 text-lg font-bold">{active.label}</h2>{tab==='roles'&&<span className="rounded-full border border-line px-2 py-1 text-xs text-muted">Read only</span>}</div>
      {tab==='basic'&&<Panel title="Employee profile">
       <div className="grid gap-2 sm:grid-cols-2">
        <Info label="Full name" value={data.profile.name}/>
        <Info label="Employee number" value={data.profile.employeeNumber}/>
        <Info label="Employment status" value={data.profile.status}/>
        <Info label="Primary position" value={data.profile.primaryRole}/>
        <Info label="Assigned location" value={data.profile.primaryLocation}/>
        <Info label="Employee ID" value={data.profile.uid}/>
       </div>

      </Panel>}
      {tab==='deployment'&&<Panel title="Organization deployments">
       {data.deployments.length? <div className="space-y-3">{data.deployments.map((dep,i)=><div key={dep.nodeId+dep.positionCode+i} className="rounded-xl border border-line bg-page p-3">
        <div className="flex items-start gap-2"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-blue-500"/><div className="min-w-0 flex-1"><h3 className="font-semibold">{dep.location}</h3><p className="text-xs text-muted">{dep.level.replaceAll('_',' ')} · {dep.siteId||'Site not recorded'}</p></div></div>
        <div className="mt-3 grid grid-cols-2 gap-2"><Info label="Position" value={dep.positionTitle}/><Info label="Position code" value={dep.positionCode}/><Info label="Assigned from" value={dep.startDate}/><Info label="Assigned until" value={dep.endDate||'Current'}/></div>
       </div>)}</div>:<p className="text-sm text-muted">No primary organizational deployment is recorded.</p>}
      </Panel>}
      {tab==='roles'&&<Panel title="Job roles and responsibilities">
       {data.roles.length?<div className="space-y-3">{data.roles.map(role=><article key={role.code} className="rounded-xl border border-line bg-page p-4"><h3 className="font-semibold">{role.title}</h3><p className="mt-1 text-xs text-muted">{role.code} · {role.operatingLevel||'Level not recorded'} · Reports to: {role.reportsToCode||'Not recorded'}</p><p className="mt-3 whitespace-pre-wrap text-sm">{role.description||'No responsibilities description is recorded for this role.'}</p></article>)}</div>:<p className="text-sm text-muted">No assigned job role is recorded.</p>}
      </Panel>}
      {tab==='roleSkills'&&<HrRoleSkillRequirements
        employeeUid={data.profile.uid} roles={data.roles} fit={data.skillFit}
        canSubmit={data.access.isOwnRecord&&data.access.selfServiceTabs.includes('roleSkills')&&firebaseAuth.currentUser?.uid===data.profile.uid}
        onRefresh={refreshFit}/>}
      {tab==='skills'&&<>
        <HrRoleSkillFit fit={data.skillFit} detailed/>
        <EmployeeSkillPanel employeeUid={data.profile.uid} ownUid={firebaseAuth.currentUser?.uid||''}/>
      </>}
      {(tab==='education'||tab==='family')&&(firebaseAuth.currentUser?.uid===data.profile.uid||data.access.scope==='superadmin'?<HrSelfRecords kind={tab} employeeUid={data.profile.uid} readOnly={data.access.isOwnRecord&&!data.access.selfServiceTabs.includes(tab)}/>:<div className="rounded-2xl border border-line bg-panel p-5 text-sm text-muted"><LockKeyhole className="mb-2 h-6 w-6"/>Private employee record · only the employee can access this section.</div>)}
      {tab==='leave'&&<HrLeavePanel employeeUid={data.profile.uid} showInbox={selfView}/>}
      {RESTRICTED.has(tab)&&tab!=='education'&&tab!=='family'&&tab!=='leave'&&<EmptyRecords label={active.label}/>}
     </div>
    </div>
    <div className="mt-5 flex items-center gap-2 border-t border-line py-3 text-xs text-muted"><ShieldCheck className="h-4 w-4"/> Employee record access is verified for this session.</div>
   </>}
  </main>
 </div>;
}
