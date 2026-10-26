import {useEffect,useState} from 'react';
import {BriefcaseBusiness, Building2, ChevronRight, GraduationCap, IdCard, MapPin, Target, UserRound, UserRoundCheck, Users} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import type {SkillFit} from './HrRoleSkillFit';
import {profileQualification,profileWorkplace,showReporteesCard,type EducationHeadline,type OperatingUnit} from './hrProfileSummary';
import './hrEmployeePortal.css';

export type HrDeployment={nodeId:string;location:string;level:string;positionCode:string;positionTitle:string;startDate:string;endDate:string;siteId:string};
export type HrOverviewProfile={
 uid:string;name:string;employeeNumber:string;status:string;primaryRole:string;primaryLocation:string;
 department:string;site:string;operatingScope?:OperatingUnit;photoUrl?:string;
 directManager?:{name:string;role:string;status:'resolved'|'role_only'|'unconfigured'|'vacant'|'ambiguous'|'unassigned'};
};
type Tone='rose'|'blue'|'violet'|'amber'|'teal'|'green';
function Detail({label,value,subtitle,Icon,tone}:{label:string;value?:string;subtitle?:string;Icon:LucideIcon;tone:Tone}){
 return <div className={'hr-card__detail hr-card__detail--'+tone}>
  <span className="hr-card__detail-icon"><Icon size={17} aria-hidden="true"/></span>
  <div className="hr-card__detail-body">
   <span className="hr-card__detail-label">{label}</span>
   <strong className="hr-card__detail-value">{value?.trim()||'Not recorded'}</strong>
   {subtitle?.trim()&&<span className="hr-card__detail-subtitle">{subtitle.trim()}</span>}
  </div>
 </div>;
}

export default function HrProfileOverview({
 profile,selfView,qualification,reportees,deployments,fit,canSeeSkills,canOpenRequiredSkills,onRequiredSkills,onReportees,
}:{
 profile:HrOverviewProfile;selfView:boolean;qualification:EducationHeadline;reportees:number;deployments:HrDeployment[];fit?:SkillFit|null;
 canSeeSkills:boolean;canOpenRequiredSkills:boolean;onRequiredSkills:()=>void;onReportees:()=>void;
}){
 const [photoError,setPhotoError]=useState(false);
 useEffect(()=>setPhotoError(false),[profile.photoUrl]);
 const rawFit=fit?.percentage;
 const percentage=typeof rawFit==='number'&&Number.isFinite(rawFit)&&Number(fit?.required)>0?Math.max(0,Math.min(100,rawFit)):null;
 const status=profile.status?.trim()||'Not recorded';
 const isActive=status.toLowerCase()==='active';
 const department=profile.department||profile.primaryLocation;
 const role=profile.primaryRole||'Position not assigned';
 const highest=profileQualification(qualification);
 const workplace=profileWorkplace(profile.site,profile.operatingScope);
 return <section aria-label="Employee overview" className="hr-card hr-card--compact">
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
    {selfView?<Detail label="Highest qualification" value={highest.name} subtitle={highest.specialization} Icon={GraduationCap} tone="amber"/>:
      <Detail label="Assigned location" value={profile.primaryLocation} Icon={MapPin} tone="amber"/>}
    <Detail label={workplace.label} value={workplace.name} Icon={MapPin} tone="teal"/>
   </div>
   <details className="hr-card__assignment">
    <summary className="hr-card__assignment-summary"><MapPin size={16} aria-hidden="true"/>
     <span>Deployment details</span><span className="hr-card__assignment-hint">{deployments.length} assignment{deployments.length===1?'':'s'}</span>
    </summary>
    {deployments.length===0?<p className="hr-card__assignment-empty">No verified deployment is configured.</p>:
     <div className="hr-card__assignment-list">
      {deployments.map((dep,index)=><div key={dep.nodeId+dep.positionCode+index} className="hr-card__assignment-item">
       {index>0&&<strong className="hr-card__assignment-extra">{dep.positionTitle||'Additional assignment'} · {dep.location}</strong>}
       <span><b>Level</b> {dep.level?dep.level.replaceAll('_',' '):'Not recorded'}</span>
       <span><b>Position code</b> {dep.positionCode||'Not recorded'}</span>
       <span><b>Effective</b> {dep.startDate||'Not recorded'}{dep.endDate?' – '+dep.endDate:' · Current'}</span>
      </div>)}
     </div>}
   </details>
   <div className="hr-card__manager" aria-label="Direct manager">
    <span className="hr-card__manager-icon"><UserRoundCheck size={18} aria-hidden="true"/></span>
    <div className="hr-card__manager-info">
     <span className="hr-card__manager-label">Direct manager</span>
     <strong className="hr-card__manager-name">{profile.directManager?.status==='resolved'?
       profile.directManager.name:
       profile.directManager?.status==='role_only'?'Employee identity not recorded':
       profile.directManager?.status==='vacant'?'No assigned reporting manager':
       profile.directManager?.status==='ambiguous'?'Reporting assignment needs review':
       'Reporting role not configured'}</strong>
     {profile.directManager?.role&&<span className="hr-card__manager-role">Reports to role: {profile.directManager.role}</span>}
     {profile.directManager?.status==='unconfigured'&&<span className="hr-card__manager-role">Configure the reporting role in HR05</span>}
    </div>
   </div>
   {canSeeSkills&&<div className="hr-card__skills hr-card__skills--compact">
    <span className="hr-card__skills-icon"><Target size={19} aria-hidden="true"/></span>
    <div className="hr-card__skills-body">
     <h3 className="hr-card__skills-title">Required skills</h3>
     <p className="hr-card__skills-copy"><strong className="hr-card__skills-result">{percentage===null?'Not configured':percentage+'% fit'}</strong>
      <span className="hr-card__skills-note">{percentage===null?' · Role skills not set':
       ' · '+(fit?.confirmed||0)+'/'+(fit?.required||0)+' manager verified'}</span>
     </p>
    </div>
    {canOpenRequiredSkills&&<button type="button" onClick={onRequiredSkills}
     aria-label="View required skills" className="hr-card__skills-open"><ChevronRight size={19} aria-hidden="true"/></button>}
   </div>}
   {selfView&&showReporteesCard(reportees)&&<button type="button" className="hr-card__team" onClick={onReportees}>
    <span className="hr-card__team-icon"><Users size={19} aria-hidden="true"/></span>
    <span className="hr-card__team-copy"><span>My team</span><strong>Manage My Reportees</strong></span>
    <span className="hr-card__team-count"><strong>{reportees}</strong><span>Reportees</span></span>
    <ChevronRight size={18} className="hr-card__team-arrow" aria-hidden="true"/>
   </button>}
  </div>
 </section>;
}
