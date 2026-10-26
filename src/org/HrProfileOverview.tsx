import {useEffect,useState} from 'react';
import {BriefcaseBusiness, Building2, CheckCircle2, ChevronRight, GraduationCap, HeartHandshake, IdCard, MapPin, ShieldCheck, Target, UserRound, Users} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import type {SkillFit} from './HrRoleSkillFit';
import './hrEmployeePortal.css';

export type HrOverviewProfile={
 uid:string;name:string;employeeNumber:string;status:string;primaryRole:string;primaryLocation:string;
 department:string;site:string;photoUrl?:string;
};
type Tone='rose'|'blue'|'violet'|'amber'|'teal'|'green';
function Detail({label,value,Icon,tone}:{label:string;value?:string;Icon:LucideIcon;tone:Tone}){
 return <div className={'hr-card__detail hr-card__detail--'+tone}>
  <span className="hr-card__detail-icon"><Icon size={17} aria-hidden="true"/></span>
  <div className="hr-card__detail-body">
   <span className="hr-card__detail-label">{label}</span>
   <strong className="hr-card__detail-value">{value?.trim()||'Not recorded'}</strong>
  </div>
 </div>;
}

export default function HrProfileOverview({
 profile,selfView,qualification,reportees,fit,canSeeSkills,canOpenRequiredSkills,onRequiredSkills,onReportees,
}:{
 profile:HrOverviewProfile;selfView:boolean;qualification:string;reportees:number;fit?:SkillFit|null;
 canSeeSkills:boolean;canOpenRequiredSkills:boolean;onRequiredSkills:()=>void;onReportees:()=>void;
}){
 const [photoError,setPhotoError]=useState(false);
 useEffect(()=>setPhotoError(false),[profile.photoUrl]);
 const rawFit=fit?.percentage;
 const percentage=typeof rawFit==='number'&&Number.isFinite(rawFit)?Math.max(0,Math.min(100,rawFit)):null;
 const status=profile.status?.trim()||'Not recorded';
 const isActive=status.toLowerCase()==='active';
 const department=profile.department||profile.primaryLocation;
 const role=profile.primaryRole||'Position not assigned';
 return <section aria-label="Employee overview" className="hr-card">
  <div className="hr-card__hero">
   <div className="hr-card__identity">
    <div className="hr-card__photo">
     {profile.photoUrl&&!photoError?
      <img src={profile.photoUrl} alt={'Profile photo of '+(profile.name||'employee')} className="hr-card__photo-img" referrerPolicy="no-referrer" onError={()=>setPhotoError(true)}/>:
      <UserRound size={36} aria-hidden="true"/>}
    </div>
    <div className="hr-card__identity-copy">
     <span className="hr-card__eyebrow">{selfView?'My employee profile':'Employee profile'}</span>
     <h2 className="hr-card__name">{profile.name||'Unnamed employee'}</h2>
     <div className="hr-card__identity-row"><BriefcaseBusiness size={15} aria-hidden="true"/><span>{role}</span></div>
     <div className="hr-card__identity-row"><Building2 size={15} aria-hidden="true"/><span>{department||'Department not recorded'}</span></div>
    </div>
   </div>
   <div className="hr-card__badges">
    <span className="hr-card__number"><IdCard size={15} aria-hidden="true"/>No. {profile.employeeNumber||'Not recorded'}</span>
    <span className={'hr-card__status '+(isActive?'hr-card__status--active':'')}><span className="hr-card__status-dot"/>{status}</span>
   </div>
  </div>
  <div className="hr-card__content">
   <div className="hr-card__grid">
    <Detail label="Role / title" value={role} Icon={BriefcaseBusiness} tone="rose"/>
    <Detail label="Office / department" value={department} Icon={Building2} tone="blue"/>
    <Detail label="Employee number" value={profile.employeeNumber} Icon={IdCard} tone="violet"/>
    {selfView?<Detail label="Highest qualification" value={qualification} Icon={GraduationCap} tone="amber"/>:
      <Detail label="Assigned location" value={profile.primaryLocation} Icon={MapPin} tone="amber"/>}
    <Detail label="Site" value={profile.site} Icon={MapPin} tone="teal"/>
    <Detail label="Employment status" value={status} Icon={ShieldCheck} tone="green"/>
   </div>
   {canSeeSkills&&<div className="hr-card__skills">
    <div className="hr-card__skills-main">
     <span className="hr-card__skills-icon"><Target size={21} aria-hidden="true"/></span>
     <div className="hr-card__skills-body">
      <h3 className="hr-card__skills-title">Required skills for my role</h3>
      <strong className="hr-card__skills-result">{percentage===null?'Not configured':percentage+'% fit'}</strong>
      <p className="hr-card__skills-copy">{percentage===null?
       'No required skills have been configured for this role. Fit percentage unavailable.':
       (fit?.confirmed||0)+' of '+(fit?.required||0)+' skills confirmed · '+(fit?.pending||0)+' pending'}</p>
      <p className="hr-card__verified"><CheckCircle2 size={13} aria-hidden="true"/>Fit uses manager-confirmed skills only</p>
     </div>
     <div className="hr-card__fit-area">
      <div role={percentage===null?undefined:'progressbar'} aria-label="Confirmed role skill fit"
       aria-valuenow={percentage===null?undefined:percentage} aria-valuemin={percentage===null?undefined:0} aria-valuemax={percentage===null?undefined:100}
       className="hr-card__fit-ring"
       style={{background:percentage===null?'#d9dde5':'conic-gradient(#be123c '+percentage+'%, #d9dde5 0)'}}>
       <div className="hr-card__fit-middle">{percentage===null?'N/A':percentage+'%'}</div>
      </div>
      <span className="hr-card__fit-caption">Skill fit</span>
     </div>
    </div>
    {canOpenRequiredSkills&&<button type="button" onClick={onRequiredSkills} className="hr-card__skills-action">View required skills <ChevronRight size={17} aria-hidden="true"/></button>}
   </div>}
   {selfView&&<button type="button" className="hr-card__team" onClick={onReportees}>
    <span className="hr-card__team-icon"><Users size={21} aria-hidden="true"/></span>
    <span className="hr-card__team-copy"><span>My team</span><strong>Manage My Reportees</strong></span>
    <span className="hr-card__team-count"><strong>{reportees}</strong><span>Reportees</span></span>
    <ChevronRight size={19} className="hr-card__team-arrow" aria-hidden="true"/>
   </button>}
  </div>
  <div className="hr-card__footer"><HeartHandshake size={21} aria-hidden="true"/><div><strong>Together for a better workplace</strong><span>People · Growth · Opportunity</span></div></div>
 </section>;
}
