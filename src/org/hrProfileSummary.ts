/** A profile card never invents a site or a qualification specialization. */
export type EducationHeadline={qualification:string;field:string};
export type OperatingUnit={name:string;level:string};
export function profileQualification(value?:EducationHeadline|null){
 return {name:value?.qualification?.trim()||'',specialization:value?.field?.trim()||''};
}
export function profileWorkplace(site:string|undefined,unit?:OperatingUnit|null){
 const siteName=site?.trim()||'';
 if(siteName)return {label:'Site',name:siteName};
 const name=unit?.name?.trim()||'';
 const level=unit?.level||'';
 if(!name)return {label:'Site',name:''};
 if(level==='group'||level==='root')return {label:'Corporate scope',name};
 if(level==='legal_entity')return {label:'Legal entity',name};
 if(level==='site')return {label:'Site',name};
 return {label:'Operating unit',name};
}
export const showReporteesCard=(reportees:number)=>Number.isFinite(reportees)&&reportees>0;
