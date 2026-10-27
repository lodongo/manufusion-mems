import {useEffect,useMemo,useRef,useState} from 'react';
import {
 ArrowLeft, BriefcaseBusiness, ChevronRight, CircleAlert, GitBranch,
 Search, ShieldCheck, Target, Users, UserRoundCheck
} from 'lucide-react';
import {roleHierarchy,roleTrail,vacancyOutlook,type HrRoleCardData} from './hrRoleHierarchy';

const levelLabel=(value:string)=>{
 if(!value)return 'Level not configured';
 if(value.startsWith('upper:'))return 'Corporate tier '+value.split(':')[1];
 return value.replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());
};
const metric=(value:number|null|undefined)=>value===null||value===undefined?'—':String(value);

function RoleCard({role,childCount,onOpen}:{
 role:HrRoleCardData;childCount:number;onOpen:()=>void;
}){
 const status=vacancyOutlook(role);
 const statusColor=status.tone==='good'?'text-green-700':status.tone==='alert'?'text-danger':status.tone==='warn'?'text-amber-700':'text-muted';
 return <button type="button" onClick={onOpen}
  aria-label={'Open role '+role.title}
  className="group flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-panel p-3 text-left shadow-sm hover:border-brand/50 hover:bg-brand/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:p-4">
   <div className="flex min-w-0 items-start gap-3">
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"><BriefcaseBusiness className="h-5 w-5" aria-hidden="true"/></span>
    <span className="min-w-0 flex-1">
     <span className="block break-words text-base font-bold leading-snug text-ink">{role.title||role.code}</span>
     <span className="mt-1 block text-xs text-muted">{role.code} · {levelLabel(role.operatingLevel)}</span>
     <span className="mt-1 block text-xs text-muted">{childCount} direct reporting {childCount===1?'role':'roles'}</span>
    </span>
    <ChevronRight className="mt-2 h-5 w-5 shrink-0 text-brand" aria-hidden="true"/>
   </div>
   <div className="grid min-w-0 grid-cols-3 gap-2">
    <div className="min-w-0 rounded-xl bg-page px-2 py-2">
     <span className="block text-[10px] text-muted">Employees</span>
     <strong className="mt-0.5 block text-base text-ink">{metric(role.staffing?.mappedEmployees)}</strong>
    </div>
    <div className="min-w-0 rounded-xl bg-page px-2 py-2">
     <span className="block text-[10px] text-muted">Approved</span>
     <strong className="mt-0.5 block text-base text-ink">{metric(role.staffing?.approved)}</strong>
    </div>
    <div className="min-w-0 rounded-xl bg-page px-2 py-2">
     <span className="block text-[10px] text-muted">Vacancies</span>
     <strong className="mt-0.5 block text-base text-ink">{metric(role.staffing?.vacant)}</strong>
    </div>
   </div>
   <div className="flex min-w-0 items-center justify-between gap-2">
    <span className={'min-w-0 break-words rounded-lg bg-page px-2.5 py-1.5 text-xs font-semibold '+statusColor}>{status.label}</span>
    <span className="shrink-0 text-[11px] text-muted">{role.requiredSkillCount} required skills</span>
   </div>
 </button>;
}
function SummaryTile({label,value}:{label:string;value:string|number}){
 return <div className="min-w-0 rounded-xl border border-line bg-panel p-3">
  <span className="block text-[11px] text-muted">{label}</span>
  <strong className="mt-1 block break-words text-lg text-ink">{value}</strong>
 </div>;
}
export default function HrRoleExplorer({roles}:{roles:HrRoleCardData[]}){
 const [trail,setTrail]=useState<string[]>([]);
 const [search,setSearch]=useState('');
 const topRef=useRef<HTMLDivElement>(null);
 const index=useMemo(()=>roleHierarchy(roles),[roles]);
 const current=index.byCode.get(trail[trail.length-1]||'');
 useEffect(()=>{setTrail([]);setSearch('');},[roles]);
 const children=current?(index.children.get(current.code)||[]).filter(r=>!trail.includes(r.code)):index.roots;
 const matches=useMemo(()=>{
  const q=search.trim().toLowerCase();
  return q?roles.filter(r=>[r.title,r.code,r.operatingLevel,r.description].some(v=>v.toLowerCase().includes(q)))
   .sort((a,b)=>a.title.localeCompare(b.title)):null;
 },[roles,search]);
 const open=(code:string)=>{
  setTrail(roleTrail(code,index));setSearch('');
  topRef.current?.scrollIntoView({block:'nearest',behavior:'smooth'});
 };
 const staffingVisible=roles.some(r=>r.staffing!==null);
 return <section aria-label="Approved job role catalogue" className="min-w-0 space-y-3">
  <div className="flex min-w-0 items-start gap-3">
   <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"><BriefcaseBusiness className="h-6 w-6" aria-hidden="true"/></span>
   <div className="min-w-0 flex-1">
    <h2 className="text-base font-bold text-ink">Approved role catalogue</h2>
    <p className="mt-1 text-xs text-muted">Open top-level roles to explore reporting positions, staffing and vacancies.</p>
   </div>
  </div>
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
   <SummaryTile label="Registered roles" value={roles.length}/>
   <SummaryTile label="Mapped employees" value={staffingVisible?roles.reduce((n,r)=>n+(r.staffing?.mappedEmployees||0),0):'Restricted'}/>
   <SummaryTile label="Approved positions" value={!staffingVisible?'Restricted':roles.some(r=>typeof r.staffing?.approved==='number')?roles.reduce((n,r)=>n+(r.staffing?.approved||0),0):'Not configured'}/>
   <SummaryTile label="Open vacancies" value={!staffingVisible?'Restricted':roles.some(r=>typeof r.staffing?.vacant==='number')?roles.reduce((n,r)=>n+(r.staffing?.vacant||0),0):'Not configured'}/>
  </div>
  <div className="relative">
   <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted" aria-hidden="true"/>
   <input type="search" value={search} onChange={event=>setSearch(event.target.value)}
    aria-label="Search job roles" placeholder="Search role title, code or level"
    className="h-11 w-full rounded-xl border border-line bg-panel pl-10 pr-3 text-sm text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"/>
  </div>
  <div ref={topRef} className="scroll-mt-3"/>
  {!matches&&<nav aria-label="Role hierarchy" className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
   <button type="button" onClick={()=>setTrail([])} aria-current={!current?'location':undefined}
    className={'min-h-9 rounded-lg border px-2.5 py-1.5 font-semibold '+(!current?'border-brand bg-brand/10 text-brand':'border-line bg-panel text-ink')}>
    Top roles
   </button>
   {trail.map((code,i)=>{
    const role=index.byCode.get(code);
    if(!role)return null;
    return <span key={code} className="inline-flex min-w-0 items-center gap-1">
     <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true"/>
     <button type="button" onClick={()=>setTrail(trail.slice(0,i+1))}
      aria-current={i===trail.length-1?'location':undefined}
      className={'min-h-9 max-w-[12rem] break-words rounded-lg border px-2.5 py-1.5 text-left font-semibold '+(i===trail.length-1?'border-brand bg-brand/10 text-brand':'border-line bg-panel text-ink')}>
      {role.title||role.code}
     </button>
    </span>;
   })}
  </nav>}
  {matches?<div className="space-y-2">
   <p className="text-xs text-muted">{matches.length} matching {matches.length===1?'role':'roles'}</p>
   <div className="grid min-w-0 gap-2 md:grid-cols-2">
    {matches.map(r=><RoleCard key={r.code} role={r}
     childCount={(index.children.get(r.code)||[]).filter(c=>c.code!==r.code).length} onOpen={()=>open(r.code)}/>)}
   </div>
   {!matches.length&&<p className="rounded-xl border border-line bg-panel p-4 text-sm text-muted">No matching job roles.</p>}
  </div>:<div className="space-y-3">
   {current&&<article className="min-w-0 rounded-2xl border border-brand/25 bg-brand/5 p-3 sm:p-4">
    <div className="flex items-start gap-3">
     <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
      <BriefcaseBusiness className="h-5 w-5" aria-hidden="true"/>
     </span>
     <div className="min-w-0 flex-1">
      <h3 className="break-words text-lg font-bold text-ink">{current.title||current.code}</h3>
      <p className="mt-1 break-all text-xs text-muted">{current.code} · {levelLabel(current.operatingLevel)}</p>
      <p className="mt-1 text-xs text-muted">Reports to: {index.byCode.get(current.parentCode)?.title||current.parentCode||'Top-level role'}</p>
     </div>
    </div>
    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{current.description||'No role description is recorded.'}</p>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
     <SummaryTile label="Employees mapped" value={metric(current.staffing?.mappedEmployees)}/>
     <SummaryTile label="Approved headcount" value={metric(current.staffing?.approved)}/>
     <SummaryTile label="Open vacancies" value={metric(current.staffing?.vacant)}/>
     <SummaryTile label="Surplus" value={metric(current.staffing?.surplus)}/>
    </div>
    <div className="mt-3 flex flex-wrap gap-2 text-xs">
     <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-2 text-ink"><Target className="h-4 w-4 text-brand"/>{current.requiredSkillCount} required skills</span>
     <span className="rounded-lg border border-line bg-panel px-2.5 py-2 text-ink">{current.gradeMappings} legal-entity grade mappings</span>
     {current.staffing&&<span className="rounded-lg border border-line bg-panel px-2.5 py-2 text-ink">{current.staffing.temporaryAssignments} temporary assignments</span>}
    </div>
    {current.staffing===null?<p className="mt-3 text-xs text-muted">Detailed staffing requires organization establishment access.</p>:
     current.staffing.approved===null?<p className="mt-3 rounded-xl bg-panel p-3 text-sm text-muted">No approved role establishment is configured. Vacancies cannot be calculated.</p>:
     <div className="mt-3 space-y-2">
      <h4 className="font-bold text-ink">Staffing by organizational unit</h4>
      {current.staffing.units.map(unit=><div key={unit.nodeId} className="rounded-xl border border-line bg-panel p-3">
       <p className="break-words text-sm font-semibold text-ink">{unit.name}</p>
       <div className="mt-2 grid grid-cols-4 gap-1.5 text-center text-xs">
        {([['Approved',unit.approved],['Filled',unit.filled],['Vacant',unit.vacant],['Surplus',unit.surplus]] as const).map(([label,val])=>
         <div key={label} className="min-w-0 rounded-lg bg-page p-2"><span className="block text-[10px] text-muted">{label}</span><strong className="text-base text-ink">{val}</strong></div>)}
       </div>
       {!!unit.temporary&&<p className="mt-2 text-xs text-muted">{unit.temporary} temporary assignment(s) provide additional cover</p>}
      </div>)}
     </div>}
    {!!current.staffing?.unplanned&&<p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-ink">
     <CircleAlert className="h-4 w-4 shrink-0 text-amber-600"/>
     {current.staffing.unplanned} employee assignment(s) are outside enabled establishment units and are not counted as filled planned positions.
    </p>}
    <p className="mt-3 flex items-start gap-1.5 text-xs text-muted"><UserRoundCheck className="h-4 w-4 shrink-0"/>Filled roles count primary assignments only; acting or secondments are reported separately. Snapshot: {current.staffing?.asOf||'Unavailable'}.</p>
   </article>}
   <div className="flex min-w-0 items-center justify-between gap-2">
    <div className="min-w-0"><h3 className="break-words text-sm font-bold text-ink">{current?'Direct reporting roles':'Highest-level job roles'}</h3><p className="text-xs text-muted">{children.length} {children.length===1?'role':'roles'} · tap to explore</p></div>
    {current&&<button type="button" onClick={()=>setTrail(trail.slice(0,-1))} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-xl border border-line bg-panel px-3 text-xs font-semibold text-ink hover:bg-brand/10">
     <ArrowLeft className="h-4 w-4" aria-hidden="true"/>Back
    </button>}
   </div>
   <div className="grid min-w-0 gap-2 md:grid-cols-2">
    {children.map(role=><RoleCard key={role.code} role={role}
     childCount={(index.children.get(role.code)||[]).filter(r=>r.code!==role.code&&!trail.includes(r.code)).length}
     onOpen={()=>open(role.code)}/>)}
   </div>
   {!roles.length&&<p className="rounded-xl border border-dashed border-line bg-panel p-4 text-sm text-muted">No approved job roles are available.</p>}
   {current&&!children.length&&<p className="rounded-xl border border-line bg-panel p-4 text-sm text-muted">No subordinate job roles are currently configured for this role.</p>}
  </div>}
  <div className="flex items-start gap-2 border-t border-line pt-3 text-xs text-muted">
   <ShieldCheck className="h-4 w-4 shrink-0 text-brand" aria-hidden="true"/>
   <span>Read-only organizational role catalogue. Staffing figures are permission-controlled and based on current employee assignments and approved establishment.</span>
  </div>
 </section>;
}
