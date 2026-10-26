import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft, Award, BookOpen, BriefcaseBusiness, Building2, CalendarDays, ChartNoAxesCombined,
  CheckCircle2, ChevronRight, ClipboardList, FileText, GraduationCap, HeartHandshake, IdCard,
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
  {key:'roleSkills',label:'Required Skills',Icon:Target},
  {key:'skills',label:'Other Skills',Icon:Award},
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
type ProfileTone = 'rose' | 'blue' | 'violet' | 'amber' | 'teal' | 'green';
const detailTones:Record<ProfileTone,string>={
 rose:'border-rose-100 bg-rose-50 text-rose-600',
 blue:'border-blue-100 bg-blue-50 text-blue-600',
 violet:'border-violet-100 bg-violet-50 text-violet-600',
 amber:'border-amber-100 bg-amber-50 text-amber-600',
 teal:'border-teal-100 bg-teal-50 text-teal-600',
 green:'border-green-100 bg-green-50 text-green-600',
};
function ProfileDetail({label,value,Icon,tone}:{label:string;value?:string;Icon:LucideIcon;tone:ProfileTone}) {
 return <div className={'flex min-w-0 items-start gap-2 rounded-xl border p-2.5 sm:p-3 '+detailTones[tone]}>
  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/75"><Icon className="h-4 w-4"/></span>
  <div className="min-w-0 flex-1">
   <p className="text-[10px] font-bold uppercase leading-4 tracking-wide opacity-85 sm:text-[11px]">{label}</p>
   <p className="mt-0.5 break-words text-xs font-bold leading-5 text-slate-900 sm:text-sm">{value?.trim()||'Not recorded'}</p>
  </div>
 </div>;
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
  Promise.all([
   callBackend<{education:Array<{qualification?:string;levelCode?:string;completionYear?:string}>}>('/api/org/hr/private/get',{uid}),
   callBackend<{config:{levels:Array<{code:string;rank:number}>}|null}>('/api/org/hr/education/config',{uid}),
  ]).then(([records,settings])=>{
   if(!active)return;
   const ranks=new Map((settings.config?.levels||[]).map(level=>[level.code,level.rank]));
   const highest=(records.education||[]).slice().sort((a,b)=>
    (ranks.get(b.levelCode||'')||0)-(ranks.get(a.levelCode||'')||0)||
    (b.completionYear||'').localeCompare(a.completionYear||''))[0];
   setQualification(highest?.qualification||'');
  }).catch(()=>{});
  return()=>{active=false};
 },[uid,selfView]);
 const detailsRef=useRef<HTMLDivElement>(null);
 const openDetails=(key:TabKey)=>{
  setTab(key);
  detailsRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'});
 };
 const status=data?.profile.status?.trim()||'Not recorded';
 const isActive=status.toLowerCase()==='active';
 const fitNumber=data?.skillFit?.percentage;
 const fitValue=typeof fitNumber==='number'&&Number.isFinite(fitNumber)?Math.max(0,Math.min(100,fitNumber)):null;
 const canSeeSkills=Boolean(data?.access.allowedTabs?.includes('skills'));
 const canOpenRequiredSkills=Boolean(data?.access.allowedTabs?.includes('roleSkills'));
 const photo=selfView?firebaseAuth.currentUser?.photoURL:null;
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
    <section aria-label="Employee overview" className="mb-4 min-w-0 overflow-hidden rounded-[1.5rem] border border-rose-200 bg-white shadow-lg shadow-rose-950/10">
     <div className="relative overflow-hidden bg-gradient-to-br from-red-600 via-red-600 to-red-800 p-4 text-white sm:p-5">
      <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full border-[28px] border-white/10"/>
      <div className="relative flex min-w-0 items-start gap-3">
       <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/30 bg-white/15 sm:h-20 sm:w-20">
        {photo?<img src={photo} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer"/>:<UserRound className="h-9 w-9 sm:h-11 sm:w-11"/>}
       </div>
       <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/80">{selfView?'My employee profile':'Employee profile'}</p>
        <h2 className="mt-0.5 break-words text-lg font-extrabold leading-tight sm:text-2xl">{data.profile.name||'Unnamed employee'}</h2>
        <p className="mt-1 flex min-w-0 items-start gap-1.5 text-xs leading-5 text-white/95 sm:text-sm"><BriefcaseBusiness className="mt-0.5 h-3.5 w-3.5 shrink-0"/><span className="break-words">{data.profile.primaryRole||'Position not assigned'}</span></p>
        <p className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-white/90 sm:text-sm"><Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0"/><span className="break-words">{data.profile.department||data.profile.primaryLocation||'Department not recorded'}</span></p>
       </div>
      </div>
      <div className="relative mt-3 flex flex-wrap items-center gap-2 text-[11px] sm:text-xs">
       <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1.5"><IdCard className="h-3.5 w-3.5 shrink-0"/><span className="break-all">No. {data.profile.employeeNumber||'Not recorded'}</span></span>
       <span className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-semibold '+(isActive?'bg-emerald-50 text-emerald-800':'bg-white/20 text-white')}>
        <span className={'h-2 w-2 rounded-full '+(isActive?'bg-emerald-500':'bg-white/70')}/><span className="capitalize">{status}</span>
       </span>
      </div>
     </div>
     <div className="space-y-3 p-3 sm:p-4">
      <div className="grid min-w-0 grid-cols-2 gap-2">
       <ProfileDetail Icon={BriefcaseBusiness} label="Role / title" value={data.profile.primaryRole} tone="rose"/>
       <ProfileDetail Icon={Building2} label="Office / department" value={data.profile.department||data.profile.primaryLocation} tone="blue"/>
       <ProfileDetail Icon={IdCard} label="Employee number" value={data.profile.employeeNumber} tone="violet"/>
       {selfView?<ProfileDetail Icon={GraduationCap} label="Highest qualification" value={qualification} tone="amber"/>:<ProfileDetail Icon={MapPin} label="Assigned location" value={data.profile.primaryLocation} tone="amber"/>}
       <ProfileDetail Icon={MapPin} label="Site" value={data.profile.site} tone="teal"/>
       <ProfileDetail Icon={ShieldCheck} label="Employment status" value={status} tone="green"/>
      </div>
      {canSeeSkills&&<div className="min-w-0 rounded-xl border border-rose-100 bg-rose-50/60 p-3">
       <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-red-600"><Target className="h-5 w-5"/></span>
        <div className="min-w-0 flex-1">
         <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">Required skills for my role</p>
         <p className="mt-1 text-lg font-extrabold leading-tight text-red-600">{fitValue===null?'Not configured':fitValue+'% fit'}</p>
         {fitValue===null?
          <p className="mt-1 text-xs leading-relaxed text-slate-600">No required skills are configured for the assigned role. Fit percentage unavailable.</p>:
          <p className="mt-1 text-xs leading-relaxed text-slate-600">{data.skillFit.confirmed} of {data.skillFit.required} skills confirmed by manager · {data.skillFit.pending} pending</p>}
         <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500"><CheckCircle2 className="h-3 w-3"/>Fit uses manager-confirmed skills only</p>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
         <div role={fitValue===null?undefined:'progressbar'} aria-label="Confirmed role skill fit" aria-valuenow={fitValue===null?undefined:fitValue} aria-valuemin={fitValue===null?undefined:0} aria-valuemax={fitValue===null?undefined:100}
          className="flex h-14 w-14 items-center justify-center rounded-full p-1"
          style={{background:fitValue===null?'#e5e7eb':'conic-gradient(#dc2626 '+fitValue+'%, #e5e7eb 0)'}}>
          <span className="flex h-full w-full items-center justify-center rounded-full bg-white text-xs font-bold text-slate-900">{fitValue===null?'N/A':fitValue+'%'}</span>
         </div>
         <span className="text-[10px] font-semibold text-slate-600">Skill fit</span>
        </div>
       </div>
       {canOpenRequiredSkills&&<button type="button" onClick={()=>openDetails('roleSkills')} className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-red-700 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600">View required skills <ChevronRight className="h-4 w-4"/></button>}
      </div>}
      {selfView&&<button type="button" onClick={()=>navigate('organization_home/hr/HR01/reportees')} className="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-left hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
       <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700"><Users className="h-5 w-5"/></span>
       <span className="min-w-0 flex-1"><span className="block text-[10px] font-bold uppercase tracking-wide text-blue-600">My team</span><span className="block text-sm font-bold text-slate-900">Manage My Reportees</span></span>
       <span className="rounded-lg bg-white px-2 py-1 text-center text-sm font-extrabold text-red-600">{reportees}<span className="block text-[9px] font-medium text-slate-500">Reportees</span></span>
       <ChevronRight className="h-4 w-4 shrink-0 text-red-600"/>
      </button>}
     </div>
     <div className="flex items-center gap-2 border-t border-rose-100 bg-gradient-to-r from-rose-50 to-rose-100 px-4 py-2.5">
      <HeartHandshake className="h-5 w-5 shrink-0 text-red-600"/>
      <div className="min-w-0"><p className="text-xs font-semibold text-slate-800">Together for a better workplace</p><p className="text-[10px] text-slate-500">People · Growth · Opportunity</p></div>
     </div>
    </section>
    <div ref={detailsRef} className="grid min-w-0 scroll-mt-4 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
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
      {tab==='skills'&&<EmployeeSkillPanel
        employeeUid={data.profile.uid} ownUid={firebaseAuth.currentUser?.uid||''}
        requiredCodes={data.requiredSkills}/>}

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
