import {HttpError,getDoc,isObj,listDocs,nowIso,str,writeDoc} from './core';
import {orgRoute,hasPerm,type OrgContext} from './guards';
import {withLock} from './finCore';
import {hrAudit} from './hrAudit';
import {DEFAULT_JOB_GRADES,activeJobGrades,toLegacy} from './hrJobGradeStore';

/** Larger Education Rank means higher typical academic attainment.
 * Professional credentials may span multiple ranks; tenant admins can adjust.
 * Job Grades describe employment, not academic examination marks, and are governed in HR → Job Grades.
 */
export type EducationLevel={code:string;name:string;description:string;enabled:boolean;rank:number};
export type Qualification={code:string;levelCode:string;name:string;description:string;enabled:boolean};
export type JobGrade={code:string;rank:number;title:string;description:string;enabled:boolean};
export type GradeOption={code:string;name:string};
export type GradingSystem={code:string;name:string;description:string;enabled:boolean;grades:GradeOption[]};
export type EducationConfig={
 levels:EducationLevel[];
 qualifications:Qualification[];
 jobGrades:JobGrade[];
 /** Historical education examination grading, retained only for older records. */
 gradingSystems:GradingSystem[];
};
const clean=(x:unknown,n=150)=>str(x).trim().slice(0,n);
/** Firestore reserves document IDs matching __.*__; keep corporate scope ID ordinary.
 * The corporate catalogue never inherits a legal entity's private master. */
export const CORPORATE_EDUCATION_CONFIG_ID='corporate_default';
const configPath=(org:string,entity:string)=>`organizations/${org}/hr_education_config/${entity}`;
const idOk=(x:string)=>/^[A-Za-z0-9_-]{2,64}$/.test(x);
export const DEFAULT_EDUCATION:EducationConfig={
 levels:[
 ['PRIMARY','Primary education',1],['SECONDARY','Secondary education',2],
 ['CERTIFICATE','Certificate / vocational education',3],['DIPLOMA','Diploma / higher diploma',4],
 ['BACHELOR','Bachelor degree',5],['MASTER','Master degree',6],
 ['DOCTORATE','Doctorate',7],['PROFESSIONAL','Professional qualification',5],
 ].map(([code,name,rank])=>({code:String(code),name:String(name),rank:Number(rank),description:'',enabled:true})),
 qualifications:[
 ['PRIMARY_GENERAL','PRIMARY','Primary school qualification'],
 ['SECONDARY_GENERAL','SECONDARY','Secondary school qualification'],
 ['TECHNICAL_CERT','CERTIFICATE','Technical or vocational certificate'],
 ['CERT_OTHER','CERTIFICATE','Professional or academic certificate'],
 ['DIPLOMA_GENERAL','DIPLOMA','Diploma'],['HIGHER_DIPLOMA','DIPLOMA','Higher diploma'],
 ['BACHELOR_GENERAL','BACHELOR','Bachelor degree'],['MASTER_GENERAL','MASTER','Master degree'],
 ['DOCTORATE_GENERAL','DOCTORATE','Doctorate / PhD'],
 ['PROFESSIONAL_GENERAL','PROFESSIONAL','Professional certification'],
 ].map(([code,levelCode,name])=>({code,levelCode,name,description:'',enabled:true})),
 jobGrades:DEFAULT_JOB_GRADES,
 gradingSystems:[],
};
const entityNodes=async(org:string)=>listDocs(`organizations/${org}/structure`);
export async function legalEntityForEmployee(org:string,employee:Record<string,unknown>){
 const nodes=new Map((await entityNodes(org)).map(d=>[d.id,d.data]));
 const assignments=Array.isArray(employee.assignments)
  ?employee.assignments.filter(isObj).filter(a=>str(a.type)==='primary'):[];
 const found=new Map<string,{id:string;name:string}>();
 for(const a of assignments){
  let id=str(a.nodeId);const seen=new Set<string>();
  while(id&&!seen.has(id)){
   seen.add(id);const node=nodes.get(id);
   if(!node||str(node.status)==='inactive')break;
   if(str(node.level)==='legal_entity'){
    found.set(id,{id,name:str(node.name)});break;
   }
   id=str(node.parentId);
  }
 }
 // No single-legal-entity fallback, no guessing, no implicit cross-entity access.
 // Conflicting primary deployments require correction before education access.
 return found.size===1?[...found.values()][0]:null;
}
/** Company-level roles sit above legal entities and cannot be forced into a fictional
 * legal entity solely to record personal qualifications. Do not permit ordinary
 * unassigned/site users or conflicting cross-entity deployments through this path. */
export async function corporateEducationEligible(org:string,employee:Record<string,unknown>):Promise<boolean>{
 const all=await entityNodes(org);
 const nodes=new Map(all.map(d=>[d.id,d.data]));
 const assignments=Array.isArray(employee.assignments)
  ?employee.assignments.filter(isObj).filter(a=>str(a.type)==='primary'): [];
 if(!assignments.length)return false;
 return assignments.every(assignment=>{
  let id=str(assignment.nodeId);
  const seen=new Set<string>();
  let corporate=false;
  while(id&&!seen.has(id)){
   seen.add(id);
   const node=nodes.get(id);
   // Some tenants omit the implicit root document; a verified group node is
   // sufficient, but inactive recorded ancestors still deny access.
   if(!node)return corporate;
   if(str(node.status)==='inactive')return false;
   const level=str(node.level);
   if(level==='legal_entity'||level==='site'||level==='department'||level==='cost_center'||level==='work_center')return false;
   if(level==='group'||level==='root')corporate=true;
   id=str(node.parentId);
  }
  return corporate;
 });
}
/** Select a single governed education catalogue. The corporate fallback never
 * adopts any legal entity's restricted catalogue. */
export async function educationScopeForEmployee(org:string,employee:Record<string,unknown>,allowAdminSelf=false){
 const entity=await legalEntityForEmployee(org,employee);
 if(entity)return {entity,scope:'legal_entity' as const};
 if(await corporateEducationEligible(org,employee)||allowAdminSelf&&(!Array.isArray(employee.assignments)||!employee.assignments.length))
  return {entity:{id:CORPORATE_EDUCATION_CONFIG_ID,name:'Corporate / Group Office'},scope:'corporate' as const};
 return {entity:null,scope:'unassigned' as const};
}
export function resolveEducationConfig(data?:Record<string,unknown>):EducationConfig{
 const d=data||{};
 const levels=Array.isArray(d.levels)?d.levels.filter(isObj).map((level,i)=>({
  code:clean(level.code,64),name:clean(level.name,150),description:clean(level.description,350),
  enabled:level.enabled!==false,
  rank:Number.isInteger(level.rank)&&Number(level.rank)>0?Number(level.rank):DEFAULT_EDUCATION.levels.find(x=>x.code===str(level.code))?.rank||i+1,
 })):DEFAULT_EDUCATION.levels;
 return {
  levels:levels.sort((a,b)=>a.rank-b.rank||a.name.localeCompare(b.name)),
  qualifications:Array.isArray(d.qualifications)?d.qualifications as Qualification[]:DEFAULT_EDUCATION.qualifications,
  jobGrades:Array.isArray(d.jobGrades)?(d.jobGrades as JobGrade[]).map((x,i)=>({
   code:clean(x.code,64),rank:Number.isInteger(x.rank)&&x.rank>0?x.rank:i+1,
   title:clean(x.title,150),description:clean(x.description,350),enabled:x.enabled!==false,
  })).sort((a,b)=>a.rank-b.rank):DEFAULT_EDUCATION.jobGrades,
  gradingSystems:Array.isArray(d.gradingSystems)?d.gradingSystems as GradingSystem[]:[],
 };
}
/** Job grades are governed in HR → Job Grades (draft → approval → active). Once a legal entity has an
 * active policy, that policy is the only grade list every reader sees (leave eligibility, role mapping,
 * compensation applicability). Before that, the older list below keeps working unchanged. */
export async function getEducationConfig(org:string,entity:string):Promise<EducationConfig>{
 const [doc,governed]=await Promise.all([getDoc(configPath(org,entity)),activeJobGrades(org,entity)]);
 const config=resolveEducationConfig(doc?.data);
 return governed?{...config,jobGrades:governed.map(toLegacy)}:config;
}
export async function checkEducationEntry(org:string,uid:string,entry:Record<string,unknown>,allowAdminSelf=false){
 const employee=await getDoc('users/'+uid);
 if(!employee||str(employee.data.orgId)!==org)throw new HttpError(404,'Employee unavailable.');
 const selection=await educationScopeForEmployee(org,employee.data,allowAdminSelf);
 if(!selection.entity)throw new HttpError(409,'An active, unambiguous primary legal-entity assignment or verified corporate Group Office assignment is required for education.');
 const config=await getEducationConfig(org,selection.entity.id);
 const level=clean(entry.levelCode,64),qual=clean(entry.qualificationCode,64);
 const gradeSystem=clean(entry.gradingSystemCode,64),grade=clean(entry.gradeCode,64);
 if(!config.levels.some(x=>x.enabled&&x.code===level))
  throw new HttpError(400,'Select an enabled educational level from this employee’s assigned legal entity.');
 if(!config.qualifications.some(x=>x.enabled&&x.levelCode===level&&x.code===qual))
  throw new HttpError(400,'Select a qualification belonging to this employee’s assigned legal entity and level.');
 // Preserve historical academic grading records without confusing them with job grades.
 if(gradeSystem||grade){
  const system=config.gradingSystems.find(x=>x.code===gradeSystem&&x.enabled);
  if(!system||!system.grades.some(x=>x.code===grade))
   throw new HttpError(400,'The legacy academic grade is invalid for the employee’s legal entity.');
 }
}
/** Education levels and qualifications only. Job grades are governed in HR → Job Grades, so whatever a
 * client sends for them is ignored and the grades already stored for the entity are kept untouched. */
function normalizeConfig(raw:unknown,keepJobGrades:JobGrade[]):EducationConfig{
 if(!isObj(raw))throw new HttpError(400,'Submit an education configuration.');
 const levelRows=raw.levels,qualRows=raw.qualifications;
 if(!Array.isArray(levelRows)||!levelRows.length||levelRows.length>100||
    !Array.isArray(qualRows)||qualRows.length>500)
   throw new HttpError(400,'Configure up to 100 levels and 500 qualifications.');
 const codes=(items:unknown[],kind:string)=>{
  const mapped=items.map(item=>{
   if(!isObj(item))throw new HttpError(400,'Invalid '+kind+' entry.');
   const code=clean(item.code,64);
   if(!idOk(code))throw new HttpError(400,'Invalid '+kind+' code.');
   return {code,entry:item};
  });
  if(new Set(mapped.map(x=>x.code)).size!==mapped.length)
   throw new HttpError(400,'Duplicate '+kind+' codes.');
  return mapped;
 };
 const levels=codes(levelRows,'education level').map(({code,entry})=>{
  const rank=Number(entry.rank),name=clean(entry.name);
  if(!name||!Number.isInteger(rank)||rank<1||rank>9999)
   throw new HttpError(400,'Educational levels require a name and Education Rank from 1 to 9999.');
  return {code,name,rank,description:clean(entry.description,350),enabled:entry.enabled!==false};
 });
 const qualifications=codes(qualRows,'qualification').map(({code,entry})=>{
  const levelCode=clean(entry.levelCode,64),name=clean(entry.name);
  if(!name||!levels.some(l=>l.code===levelCode))
   throw new HttpError(400,'Each qualification requires a name and existing education level.');
  return {code,levelCode,name,description:clean(entry.description,350),enabled:entry.enabled!==false};
 });
 // Older academic grading settings are read-only compatibility data.
 const gradingSystems=Array.isArray(raw.gradingSystems)
  ?(raw.gradingSystems as GradingSystem[]).filter(x=>isObj(x)).slice(0,50):[];
 return {levels:levels.sort((a,b)=>a.rank-b.rank),qualifications,
         jobGrades:keepJobGrades,gradingSystems};
}
const activeEntities=async(org:string)=>(await entityNodes(org))
 .filter(d=>str(d.data.level)==='legal_entity'&&str(d.data.status)!=='inactive')
 .map(d=>({id:d.id,name:str(d.data.name)})).sort((a,b)=>a.name.localeCompare(b.name));
export const hrEducationConfigRoutes={
 'POST /api/org/hr/education/config':[orgRoute('org.hr.education.config','HRM.shell.view',async ctx=>{
  const uid=clean(ctx.body.uid,128)||ctx.uid;
  const employee=uid===ctx.uid?ctx.me:await getDoc('users/'+uid);
  if(!employee||str(employee.data.orgId)!==ctx.orgId)throw new HttpError(404,'Employee unavailable.');
  if(uid!==ctx.uid&&ctx.role!=='org_super_admin')
   throw new HttpError(403,'Education options are restricted to the employee and authorized Super Administrator.');
  const selection=await educationScopeForEmployee(ctx.orgId,employee.data,ctx.role==='org_super_admin'&&uid===ctx.uid);
  return {...selection,config:selection.entity?await getEducationConfig(ctx.orgId,selection.entity.id):null};
 })],
 'POST /api/org/hr/education/admin':[orgRoute('org.hr.education.admin','ADM.settings',async ctx=>{
  if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'ADM.settings'))
   throw new HttpError(403,'Organization settings administrator required.');
  const entities=await activeEntities(ctx.orgId);
  const requested=clean(ctx.body.legalEntityId,128);
  const entity=entities.find(e=>e.id===requested)||(!requested?entities[0]:undefined);
  const saved=entity?await getDoc(configPath(ctx.orgId,entity.id)):null;
  return {entities,entity:entity||null,configured:!!saved,
   // Job grades shown here are the effective ones (active policy when approved, otherwise the older list).
   config:entity?await getEducationConfig(ctx.orgId,entity.id):null};
 })],
 'POST /api/org/hr/education/admin/save':[orgRoute('org.hr.education.admin.save','ADM.settings',async ctx=>{
  if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'ADM.settings'))
   throw new HttpError(403,'Organization settings administrator required.');
  const id=clean(ctx.body.legalEntityId,128);
  const entity=(await activeEntities(ctx.orgId)).find(e=>e.id===id);
  if(!entity)throw new HttpError(404,'Select an active legal entity.');
  // Validate the shape first so a malformed request never takes the lock.
  normalizeConfig(ctx.body.config,[]);
  const config=await withLock(ctx.orgId,'hr_education_config_'+id,async()=>{
   const prior=await getDoc(configPath(ctx.orgId,id));
   // Job grades are governed in HR → Job Grades; keep exactly what is stored for this entity.
   const data=normalizeConfig(ctx.body.config,resolveEducationConfig(prior?.data).jobGrades);
   const version=Number(prior?.data.version||0)+1;
   if(!await writeDoc(configPath(ctx.orgId,id),{...data,updatedAt:nowIso(),updatedBy:ctx.uid,
    version,adoptedFromEntityId:str(prior?.data.adoptedFromEntityId)||''},
    prior?{updateTime:prior.updateTime}:{exists:false}))
    throw new HttpError(409,'Education settings changed while saving. Reload and try again.');
   await hrAudit(ctx,'education.config.save',{type:'legal_entity',id},'version='+version);
   return data;
  });
  return {ok:true,config:{...config,jobGrades:(await getEducationConfig(ctx.orgId,id)).jobGrades}};
 })],
 'POST /api/org/hr/education/admin/adopt':[orgRoute('org.hr.education.admin.adopt','ADM.settings',async ctx=>{
  if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'ADM.settings'))
   throw new HttpError(403,'Organization settings administrator required.');
  const source=clean(ctx.body.sourceLegalEntityId,128);
  const target=clean(ctx.body.targetLegalEntityId,128);
  const entities=await activeEntities(ctx.orgId);
  if(!source||!target||source===target||!entities.some(e=>e.id===source)||!entities.some(e=>e.id===target))
   throw new HttpError(400,'Select two different active legal entities in your organization.');
  if(ctx.body.confirmAdoption!==true)
   throw new HttpError(400,'Confirm copying the source education levels and qualifications to the target legal entity. Job grades are never copied.');
  return withLock(ctx.orgId,'hr_education_config_'+target,async()=>{
   const from=await getDoc(configPath(ctx.orgId,source));
   if(!from)throw new HttpError(409,'Configure and save the source legal entity before adopting.');
   const previous=await getDoc(configPath(ctx.orgId,target));
   // Education levels and qualifications only: the target keeps its own job grades.
   const data=normalizeConfig(resolveEducationConfig(from.data),resolveEducationConfig(previous?.data).jobGrades);
   if(!await writeDoc(configPath(ctx.orgId,target),{
    ...data,version:Number(previous?.data.version||0)+1,
    updatedBy:ctx.uid,updatedAt:nowIso(),
    adoptedFromEntityId:source,adoptedAt:nowIso(),
   },previous?{updateTime:previous.updateTime}:{exists:false}))
    throw new HttpError(409,'Target settings changed while adopting. Reload and try again.');
   await hrAudit(ctx,'education.config.adopt',{type:'legal_entity',id:target},'source='+source);
   return {ok:true,config:{...data,jobGrades:(await getEducationConfig(ctx.orgId,target)).jobGrades},sourceLegalEntityId:source,targetLegalEntityId:target};
  });
 })],
};