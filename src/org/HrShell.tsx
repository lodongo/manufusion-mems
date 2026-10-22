import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, BriefcaseBusiness, ChevronRight, ClipboardList, GraduationCap, HeartHandshake, IdCard, LockKeyhole, Network, ShieldCheck, Sparkles, Users, Wallet, CalendarDays, ChartNoAxesCombined, Settings2, UserRoundPlus, UserRoundMinus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import RichTable from '../components/RichTable';

type Person = {uid:string;name:string;employeeNumber:string;status:string;jobRole:string};
type HrSection = { code:string; title:string; short:string; purpose:string; includes:string[]; Icon:LucideIcon; group:string };
const SECTIONS:HrSection[] = [
 {code:'HR01',title:'My HR Portal',short:'Your workplace at a glance',purpose:'A private employee home for your employment profile, self-service requests and HR notifications.',includes:['My employment summary','My requests and approvals','Leave and documents'],Icon:IdCard,group:'My workplace'},
 {code:'HR02',title:'Employee Records & Administration',short:'Trusted employee directory',purpose:'Maintain a single governed employee record across recruitment, employment and separation.',includes:['Employee master profiles','Employment history','Confidentiality and document access'],Icon:Users,group:'People & structure'},
 {code:'HR03',title:'HR Policies & Procedures',short:'Policies people can find',purpose:'Publish controlled HR guidance and confirm access to the latest approved versions.',includes:['Policy library','Procedures and forms','Acknowledgement records'],Icon:BookOpen,group:'My workplace'},
 {code:'HR04',title:'Organization Structure & Design',short:'See how the organization fits',purpose:'Present the approved legal entity, site, department and cost-centre hierarchy from Organization Admin.',includes:['Reporting structure','Departments and sites','Approved organization design'],Icon:Network,group:'People & structure'},
 {code:'HR05',title:'Job Roles & Position Profiles',short:'Clear accountabilities',purpose:'Read approved job roles and position expectations without duplicating the organization role registry.',includes:['Position descriptions','Role requirements','Role-level responsibilities'],Icon:BriefcaseBusiness,group:'People & structure'},
 {code:'HR06',title:'Employment Types & Categories',short:'Consistent employment terms',purpose:'Reference centrally governed HR employment types, contractual categories and definitions.',includes:['Employment categories','Contract types','Applicability by legal entity'],Icon:Settings2,group:'People & structure'},
 {code:'HR07',title:'Job Grading & Classification',short:'Transparent grading structure',purpose:'Show authorized grade definitions and classification criteria without exposing individual compensation.',includes:['Grading framework','Job evaluation principles','Approved grade bands'],Icon:ChartNoAxesCombined,group:'People & structure'},
 {code:'HR08',title:'Workforce Establishment, Deployment & Vacancies',short:'Understand staffing needs',purpose:'Compare approved positions with assigned employees and vacancies within permitted locations.',includes:['Authorized establishment','Occupancy and vacancies','Reporting hierarchy'],Icon:ClipboardList,group:'People & structure'},
 {code:'HR09',title:'Recruitment, Onboarding & Confirmation',short:'From offer to belonging',purpose:'Follow approved hiring, joining, induction and confirmation processes.',includes:['Recruitment stages','Onboarding checklist','Probation and confirmation'],Icon:UserRoundPlus,group:'Employee lifecycle'},
 {code:'HR10',title:'Leave & Absence Management',short:'Time away, clearly managed',purpose:'Help employees understand entitlements and authorized leave and absence processes.',includes:['Leave categories','Entitlement and balances','Requests and approvals'],Icon:CalendarDays,group:'My workplace'},
 {code:'HR11',title:'Compensation, Benefits & Payroll Interface',short:'Private compensation access',purpose:'Display benefits and payroll information only through explicitly protected personal records.',includes:['Pay components','Benefits catalog','Payslip and payroll interface'],Icon:Wallet,group:'My workplace'},
 {code:'HR12',title:'Performance Management',short:'Goals and development',purpose:'Bring together governed goals, check-ins, performance assessments and development plans.',includes:['Performance cycles','Goals and feedback','Review outcomes'],Icon:ChartNoAxesCombined,group:'Growth & engagement'},
 {code:'HR13',title:'Learning, Skills & Career Development',short:'Grow your capability',purpose:'Reuse the MEMS skills catalog and approved role requirements for development planning.',includes:['Skills profile','Learning history','Career pathways'],Icon:GraduationCap,group:'Growth & engagement'},
 {code:'HR14',title:'Employee Relations & Disciplinary Management',short:'Fair, confidential processes',purpose:'Support controlled employee relations and case workflows with strict need-to-know visibility.',includes:['Case types and guidance','Resolution workflows','Restricted records'],Icon:ShieldCheck,group:'Growth & engagement'},
 {code:'HR15',title:'Employee Engagement & Feedback',short:'Listen, learn, improve',purpose:'Provide structured engagement, feedback and workplace improvement channels.',includes:['Employee feedback','Engagement programs','Action follow-up'],Icon:HeartHandshake,group:'Growth & engagement'},
 {code:'HR16',title:'Employee Movements, Separation & Offboarding',short:'Transitions with accountability',purpose:'Manage authorized transfers, changes of assignment, exit clearances and employee offboarding.',includes:['Transfers and movements','Clearance checklist','Separation records'],Icon:UserRoundMinus,group:'Employee lifecycle'},
];
const GROUPS=['My workplace','People & structure','Growth & engagement','Employee lifecycle'];
const personColumns=[{key:'employeeNumber',label:'Employee no.',value:(r:Person)=>r.employeeNumber},{key:'name',label:'Employee',value:(r:Person)=>r.name},{key:'jobRole',label:'Position',value:(r:Person)=>r.jobRole},{key:'status',label:'Status',value:(r:Person)=>r.status}];
const route=(code:string)=>navigate('organization_home/hr/'+code);
function SectionCard({item}: {item:HrSection}){
 const Icon=item.Icon;
 return <button type="button" onClick={()=>route(item.code)} className="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-line bg-panel p-4 text-left transition hover:border-[rgb(var(--c-brand))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">
 <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500"><Icon className="h-6 w-6"/></div>
 <span className="min-w-0 flex-1"><span className="block text-[11px] font-semibold tracking-wider text-muted">{item.code}</span><span className="mt-0.5 block text-sm font-semibold leading-snug text-ink">{item.title}</span><span className="mt-1 block text-xs text-muted">{item.short}</span></span><ChevronRight className="h-5 w-5 shrink-0 text-muted"/></button>;
}
export default function HrShell({sectionCode}: {sectionCode?:string}){
 const selected=SECTIONS.find(s=>s.code===sectionCode);
 const [self,setSelf]=useState<Person|null>(null);
 const [people,setPeople]=useState<Person[]|null>(null);
 const [team,setTeam]=useState<Person[]|null>(null);
 const [busy,setBusy]=useState(true);
 const [notice,setNotice]=useState('');
 useEffect(()=>{
   let active=true;setSelf(null);setPeople(null);setTeam(null);setBusy(true);setNotice('');
   const requests:Promise<unknown>[]=[];
   if(!sectionCode||sectionCode==='HR01') requests.push(callBackend<{employee:Person}>('/api/org/hr/self').then(r=>{if(active)setSelf(r.employee)}).catch(()=>{if(active)setNotice('Your employee summary is not yet available.')}));
   if(!sectionCode||sectionCode==='HR02'||sectionCode==='HR08') requests.push(callBackend<{employees:Person[]}>('/api/org/hr/site-directory').then(r=>{if(active)setPeople(r.employees)}).catch(()=>{}));
   if(!sectionCode||sectionCode==='HR08') requests.push(callBackend<{employees:Person[]}>('/api/org/hr/manager-team').then(r=>{if(active)setTeam(r.employees)}).catch(()=>{}));
   Promise.all(requests).finally(()=>{if(active)setBusy(false)});
   return()=>{active=false};
 },[sectionCode]);
 const viewDirectory=!sectionCode||sectionCode==='HR02'||sectionCode==='HR08';
 const showTeam=!sectionCode||sectionCode==='HR08';
 const showSelf=!sectionCode||sectionCode==='HR01';
 return <div className="flex h-[calc(100dvh-9rem)] min-h-[440px] min-w-0 flex-col overflow-hidden bg-page text-ink">
   <header className="z-10 shrink-0 border-b border-line bg-page px-3 py-3 sm:px-5">
    <div className="flex min-w-0 items-center gap-3">
     {selected&&<button type="button" onClick={()=>navigate('organization_home/module/HRM')} aria-label="All HR submodules" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-panel"><ArrowLeft className="h-5 w-5"/></button>}
     <div className="min-w-0 flex-1"><div className="text-[11px] font-bold uppercase tracking-widest text-blue-500">Human Resources {selected?'· '+selected.code:''}</div><h1 className="truncate text-lg font-bold sm:text-xl">{selected?.title||'Your people, one place'}</h1></div>
     <span className="shrink-0 rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] font-semibold text-muted">Read only</span>
    </div>
   </header>
   <main className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5">
    {!selected&&<section className="overflow-hidden rounded-2xl bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-900 p-5 text-white">
     <div className="flex items-start gap-3"><div className="rounded-xl bg-white/15 p-3"><Sparkles className="h-6 w-6"/></div><div className="min-w-0"><h2 className="text-xl font-bold">Welcome to your HR workspace</h2><p className="mt-2 text-sm leading-relaxed text-blue-100">Explore employee services, workforce information and development resources in one secure space.</p></div></div>
     <div className="mt-4 flex flex-wrap gap-2"><span className="rounded-full bg-white/10 px-3 py-1 text-xs">16 service areas</span><span className="rounded-full bg-white/10 px-3 py-1 text-xs">Mobile first</span><span className="rounded-full bg-white/10 px-3 py-1 text-xs">Permission controlled</span></div>
    </section>}
    {selected&&<section className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex items-start gap-3"><div className="rounded-xl bg-blue-500/10 p-3 text-blue-500"><selected.Icon className="h-6 w-6"/></div><div className="min-w-0 flex-1"><p className="text-[11px] font-bold uppercase tracking-wider text-muted">{selected.group}</p><h2 className="mt-1 text-lg font-bold">{selected.short}</h2><p className="mt-2 text-sm leading-relaxed text-muted">{selected.purpose}</p></div></div>
      <div className="mt-4 border-t border-line pt-4"><h3 className="text-sm font-bold">What we do here</h3><div className="mt-3 grid gap-2 sm:grid-cols-3">{selected.includes.map(t=><div key={t} className="flex gap-2 rounded-xl bg-page p-3 text-xs text-ink"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500"/>{t}</div>)}</div></div>
    </section>}
    {showSelf&&<section className="rounded-2xl border border-line bg-panel p-4"><div className="flex items-center gap-2"><IdCard className="h-5 w-5 text-blue-500"/><h3 className="font-bold">My employee summary</h3></div>{self?<div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div className="col-span-2 rounded-xl bg-page p-3"><p className="text-xs text-muted">Employee</p><p className="mt-1 font-semibold">{self.name||'Not recorded'}</p></div><div className="rounded-xl bg-page p-3"><p className="text-xs text-muted">Employee number</p><p className="mt-1 font-semibold">{self.employeeNumber||'Not recorded'}</p></div><div className="rounded-xl bg-page p-3"><p className="text-xs text-muted">Assigned role</p><p className="mt-1 font-semibold">{self.jobRole||'Not assigned'}</p></div></div>:<p className="mt-3 text-sm text-muted">{busy?'Loading your profile…':notice||'Your employee summary is not available.'}</p>}</section>}
    {viewDirectory&&people&&<section className="min-w-0"><div className="mb-2 flex items-center justify-between"><h3 className="font-bold">Authorized site directory</h3><span className="text-xs text-muted">{people.length} employees</span></div><RichTable id="hr-site-directory" title="Employee directory" columns={personColumns} rows={people} rowKey={r=>r.uid} allowExport={false} height="h-[42dvh]"/></section>}
    {showTeam&&team&&<section className="min-w-0"><div className="mb-2 flex items-center justify-between"><h3 className="font-bold">My reporting hierarchy</h3><span className="text-xs text-muted">{team.length} employees</span></div><RichTable id="hr-manager-team" title="Authorized reporting team" columns={personColumns} rows={team} rowKey={r=>r.uid} allowExport={false} height="h-[42dvh]"/></section>}
    {selected&&(sectionCode==='HR02'||sectionCode==='HR08')&&!busy&&!people&&!team&&<div className="rounded-xl border border-line bg-panel p-4"><LockKeyhole className="mb-2 h-5 w-5 text-muted"/><p className="text-sm font-semibold">Restricted employee records</p><p className="mt-1 text-xs text-muted">Only employees within your verified HR site or reporting hierarchy can be displayed. Contact your organization administrator for access.</p></div>}
    {!selected&&GROUPS.map(group=><section key={group}><div className="mb-3 flex items-center justify-between"><h2 className="text-base font-bold">{group}</h2><span className="text-xs text-muted">{SECTIONS.filter(s=>s.group===group).length} areas</span></div><div className="grid min-w-0 gap-2 md:grid-cols-2 xl:grid-cols-3">{SECTIONS.filter(s=>s.group===group).map(s=><SectionCard item={s} key={s.code}/>)}</div></section>)}
    {selected&&sectionCode!=='HR01'&&sectionCode!=='HR02'&&sectionCode!=='HR08'&&<section className="rounded-2xl border border-dashed border-line bg-panel p-5"><div className="flex items-center gap-2"><LockKeyhole className="h-5 w-5 text-muted"/><h3 className="text-sm font-bold">Protected data workspace</h3></div><p className="mt-2 text-sm leading-relaxed text-muted">This overview is available now. Live records and actions remain unavailable until this area's existing MEMS data source, scoped authorization and audit controls are connected and verified.</p></section>}
    <footer className="border-t border-line py-4 text-center text-xs text-muted"><ShieldCheck className="mr-1 inline h-4 w-4"/> Site-scoped HR · Authorized manager hierarchy · Independent approvals <span className="mt-1 block">Run by Manufusion Africa Limited</span></footer>
   </main>
  </div>;
}
