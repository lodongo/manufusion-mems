import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft, Award, BookOpen, BriefcaseBusiness, Building2, CalendarDays, ChartNoAxesCombined,
  CheckCircle2, ChevronRight, ClipboardList, FileText, GraduationCap, HeartHandshake, IdCard,
  Layers, LockKeyhole, MapPin, Network, ShieldCheck, Target, UserRound, Users, Wallet
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { firebaseAuth } from '../firebase';
import HrSelfRecords from './HrSelfRecords';
import { EmployeeSkillPanel } from './HrSkillsWorkspace';
import HrLeavePanel from './HrLeavePanel';
import HrRoleSkillFit, {type SkillFit} from './HrRoleSkillFit';
import HrRoleSkillRequirements from './HrRoleSkillRequirements';
import HrProfileOverview from './HrProfileOverview';
import {rankEducation} from './hrEducationSort';
import type {EducationHeadline,OperatingUnit} from './hrProfileSummary';

type Deployment = {nodeId:string;location:string;level:string;positionCode:string;positionTitle:string;startDate:string;endDate:string;siteId:string};
type EmployeeRole = {code:string;title:string;description:string;reportsToCode:string;operatingLevel:string;requiredSkillCodes:string[]};
type Profile = {uid:string;name:string;employeeNumber:string;status:string;primaryRole:string;primaryLocation:string;department:string;site:string;operatingScope?:OperatingUnit;photoUrl?:string;directManager?:{name:string;role:string;status:"resolved"|"unassigned"|"ambiguous"};};
type PortalData = {profile:Profile;deployments:Deployment[];roles:EmployeeRole[];requiredSkills:string[];skillFit:SkillFit;access:{scope:string;readOnlyTabs:string[];allowedTabs:string[];selfServiceTabs:string[];isOwnRecord:boolean}};
type TabKey = 'basic'|'education'|'family'|'skills'|'roleSkills'|'deployment'|'records'|'roles'|'payslips'|'talent'|'leave'|'capability'|'performance'|'learning'|'history';
const TABS:{key:TabKey;label:string;Icon:LucideIcon}[]=[
  {key:'basic',label:'Profile',Icon:IdCard},
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
 const [qualification,setQualification]=useState<EducationHeadline>({qualification:'',field:''});
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
  setQualification({qualification:'',field:''});
  setReportees(0);
  callBackend<{employees:Array<{uid:string}>}>('/api/org/hr/reportees').then(r=>{if(active)setReportees(r.employees.length)}).catch(()=>{});
  Promise.all([
   callBackend<{education:Array<{id:string;qualification:string;field:string;levelCode?:string;completionYear?:string}>}>('/api/org/hr/private/get',{uid}),
   callBackend<{config:{levels:Array<{code:string;rank:number}>}|null}>('/api/org/hr/education/config',{uid}),
  ]).then(([records,settings])=>{
   if(!active)return;
   const highest=rankEducation(records.education||[],settings.config?.levels||[])[0]?.record;
   setQualification({qualification:highest?.qualification||'',field:highest?.field||''});
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
 const visibleTabs=TABS.filter(item=>data?.access.allowedTabs?.includes(item.key));
 const active=TABS.find(item=>item.key===tab)||TABS[0];
 const ActiveIcon=active.Icon;
 return <div className="flex h-[calc(100dvh-9rem)] min-h-[420px] min-w-0 flex-col overflow-hidden bg-page text-ink">
  <header className="flex shrink-0 items-center gap-3 border-b border-line bg-page px-3 py-3 sm:px-5">
   {!selfView&&<button type="button" onClick={back} aria-label="Back to employee list" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-panel"><ArrowLeft className="h-5 w-5"/></button>}
   <div className="min-w-0 flex-1"><p className="text-[11px] font-semibold uppercase tracking-wider text-blue-500">Human Resources · Employee portal</p><h1 className="truncate text-base font-bold sm:text-xl">{selfView?'My HR Portal':data?.profile.name||'Employee HR portal'}</h1></div>

  </header>
  <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5">
   {loading&&<div role="status" className="rounded-xl border border-line bg-panel p-4 text-sm text-muted">Loading the authorized employee record…</div>}
   {error&&<div role="alert" className="rounded-xl border border-line bg-panel p-4 text-sm text-red-600">{error}<button type="button" className="mt-3 block text-sm font-semibold text-brand underline" onClick={back}>Return to employees</button></div>}
   {data&&<>
    <div ref={detailsRef} className="min-w-0 space-y-3">
     <nav role="tablist" aria-label="Employee HR sections" className="hr-portal-tabs">
      {visibleTabs.map(({key,label,Icon})=><button key={key} type="button" role="tab"
       id={'employee-hr-tab-'+key} aria-controls="employee-hr-tab-content" aria-selected={tab===key} tabIndex={tab===key?0:-1}
       onClick={event=>{setTab(key);event.currentTarget.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'});}}
       className="hr-portal-tabs__tab">
        <Icon size={15} aria-hidden="true"/><span>{label}</span>
       </button>)}
     </nav>
     <div id="employee-hr-tab-content" role="tabpanel" aria-labelledby={'employee-hr-tab-'+tab} className="min-w-0 space-y-3">
      {tab==='basic'&&<HrProfileOverview
       profile={data.profile} selfView={selfView} qualification={qualification} reportees={reportees}
       fit={data.skillFit} canSeeSkills={canSeeSkills} canOpenRequiredSkills={canOpenRequiredSkills}
       onRequiredSkills={()=>openDetails('roleSkills')}
       onReportees={()=>navigate('organization_home/hr/HR01/reportees')}/>}
      {tab!=='basic'&&<div className="flex items-center gap-2"><ActiveIcon className="h-5 w-5 text-blue-500"/><h2 className="min-w-0 flex-1 text-lg font-bold">{active.label}</h2>{tab==='roles'&&<span className="rounded-full border border-line px-2 py-1 text-xs text-muted">Read only</span>}</div>}
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

      {(tab==='education'||tab==='family')&&(firebaseAuth.currentUser?.uid===data.profile.uid||data.access.scope==='superadmin'?<HrSelfRecords kind={tab} employeeUid={data.profile.uid} readOnly={data.access.isOwnRecord&&!data.access.selfServiceTabs.includes(tab)} onEducationChange={setQualification}/>:<div className="rounded-2xl border border-line bg-panel p-5 text-sm text-muted"><LockKeyhole className="mb-2 h-6 w-6"/>Private employee record · only the employee can access this section.</div>)}
      {tab==='leave'&&<HrLeavePanel employeeUid={data.profile.uid} showInbox={selfView}/>}
      {RESTRICTED.has(tab)&&tab!=='education'&&tab!=='family'&&tab!=='leave'&&<EmptyRecords label={active.label}/>}
     </div>
    </div>
    <div className="mt-5 flex items-center gap-2 border-t border-line py-3 text-xs text-muted"><ShieldCheck className="h-4 w-4"/> Employee record access is verified for this session.</div>
   </>}
  </main>
 </div>;
}
