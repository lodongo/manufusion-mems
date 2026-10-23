import {HttpError,getDoc,isObj,listDocs,nowIso,str,writeDoc} from './core';
import {orgRoute,hasPerm,type OrgContext} from './guards';

export type EducationLevel={code:string;name:string;description:string;enabled:boolean};
export type Qualification={code:string;levelCode:string;name:string;description:string;enabled:boolean};
export type GradeOption={code:string;name:string};
export type GradingSystem={code:string;name:string;description:string;enabled:boolean;grades:GradeOption[]};
export type EducationConfig={levels:EducationLevel[];qualifications:Qualification[];gradingSystems:GradingSystem[]};
const clean=(x:unknown,n=150)=>str(x).trim().slice(0,n);
const configPath=(org:string,entity:string)=>`organizations/${org}/hr_education_config/${entity}`;
export const DEFAULT_EDUCATION:EducationConfig={
 levels:[
  ['PRIMARY','Primary education'],['SECONDARY','Secondary education'],['CERTIFICATE','Certificate / Technical education'],
  ['DIPLOMA','Diploma / Higher diploma'],['BACHELOR','Bachelor degree'],['MASTER','Master degree'],
  ['DOCTORATE','Doctorate'],['PROFESSIONAL','Professional certification / qualification'],
 ].map(([code,name])=>({code,name,description:'',enabled:true})),
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
 gradingSystems:[
  {code:'LETTER',name:'Letter grades (A–E)',description:'Letter grade classification',enabled:true,
   grades:['A','B','C','D','E'].map(code=>({code,name:code}))},
  {code:'DEGREE_CLASS',name:'Degree classifications',description:'Honours degree classifications',enabled:true,
   grades:[['FIRST','First class'],['UPPER_SECOND','Upper second class'],['LOWER_SECOND','Lower second class'],['PASS','Pass']].map(([code,name])=>({code,name}))},
  {code:'PASS_FAIL',name:'Pass / Fail',description:'Binary completion',enabled:true,
   grades:[['PASS','Pass'],['FAIL','Fail']].map(([code,name])=>({code,name}))},
  {code:'GPA4',name:'GPA out of 4.0',description:'Select the applicable grade point',enabled:true,
   grades:Array.from({length:41},(_,i)=>{const code=(i/10).toFixed(1);return {code,name:code+' / 4.0'}})},
 ],
};
const idOk=(x:string)=>/^[A-Za-z0-9_-]{2,64}$/.test(x);
const entityNodes=async(org:string)=>listDocs(`organizations/${org}/structure`);
export async function legalEntityForEmployee(org:string,employee:Record<string,unknown>){
 const nodes=new Map((await entityNodes(org)).map(d=>[d.id,d.data]));
 const assignments=Array.isArray(employee.assignments)?employee.assignments.filter(isObj).filter(a=>str(a.type)==='primary'):[];
 for(const a of assignments){
  let id=str(a.nodeId);const seen=new Set<string>();
  while(id&&!seen.has(id)){
   seen.add(id);const node=nodes.get(id);
   if(!node||str(node.status)==='inactive')break;
   if(str(node.level)==='legal_entity')return {id,name:str(node.name)};
   id=str(node.parentId);
  }
 }
 // In a single-entity organization, own records can be configured before
 // deployment is finished, but never guess for a multi-entity organization.
 const entities=[...nodes].filter(([,d])=>str(d.level)==='legal_entity'&&str(d.status)!=='inactive');
 return entities.length===1?{id:entities[0][0],name:str(entities[0][1].name)}:null;
}
export async function getEducationConfig(org:string,entity:string):Promise<EducationConfig>{
 const doc=await getDoc(configPath(org,entity));
 const d=doc?.data;
 return {
  levels:Array.isArray(d?.levels)?d.levels as EducationLevel[]:DEFAULT_EDUCATION.levels,
  qualifications:Array.isArray(d?.qualifications)?d.qualifications as Qualification[]:DEFAULT_EDUCATION.qualifications,
  gradingSystems:Array.isArray(d?.gradingSystems)?d.gradingSystems as GradingSystem[]:DEFAULT_EDUCATION.gradingSystems,
 };
}
export async function checkEducationEntry(org:string,uid:string,entry:Record<string,unknown>){
 const employee=await getDoc('users/'+uid);
 if(!employee||str(employee.data.orgId)!==org)throw new HttpError(404,'Employee unavailable.');
 const entity=await legalEntityForEmployee(org,employee.data);
 if(!entity)throw new HttpError(409,'Assign the employee to a legal entity before recording education.');
 const config=await getEducationConfig(org,entity.id);
 const level=clean(entry.levelCode,64),qual=clean(entry.qualificationCode,64);
 const gradeSystem=clean(entry.gradingSystemCode,64),grade=clean(entry.gradeCode,64);
 if(!config.levels.some(x=>x.enabled&&x.code===level))
  throw new HttpError(400,'Select an enabled educational level configured for this legal entity.');
 if(!config.qualifications.some(x=>x.enabled&&x.levelCode===level&&x.code===qual))
  throw new HttpError(400,'Select a qualification valid for the selected level.');
 if(gradeSystem||grade){
  const system=config.gradingSystems.find(x=>x.code===gradeSystem&&x.enabled);
  if(!system||!system.grades.some(x=>x.code===grade))
   throw new HttpError(400,'Select a grade from the configured grading system.');
 }
}
function normalizeConfig(raw:unknown):EducationConfig{
 if(!isObj(raw))throw new HttpError(400,'Submit education configuration.');
 const levels=raw.levels,qualifications=raw.qualifications,gradingSystems=raw.gradingSystems;
 if(!Array.isArray(levels)||!Array.isArray(qualifications)||!Array.isArray(gradingSystems)||
  levels.length>100||qualifications.length>500||gradingSystems.length>50)
  throw new HttpError(400,'Invalid qualifications or grading limits.');
 const codes=(items:unknown[],kind:string)=>{
  const result=items.map((x,i)=>{
   if(!isObj(x))throw new HttpError(400,'Invalid '+kind+' entry '+(i+1));
   const code=clean(x.code,64),name=clean(x.name,150);
   if(!idOk(code)||!name)throw new HttpError(400,'Each '+kind+' needs a valid code and name.');
   return {...x,code,name,description:clean(x.description,350),enabled:x.enabled!==false};
  });
  if(new Set(result.map(x=>x.code)).size!==result.length)throw new HttpError(400,'Duplicate '+kind+' codes.');
  return result;
 };
 const levelRows=codes(levels,'educational level').map(x=>({code:x.code,name:x.name,description:x.description,enabled:x.enabled}));
 const qualifierRows=codes(qualifications,'qualification').map(x=>({
  code:x.code,name:x.name,levelCode:clean(x.levelCode,64),description:x.description,enabled:x.enabled,
 }));
 for(const q of qualifierRows)if(!levelRows.some(l=>l.code===q.levelCode))
  throw new HttpError(400,'Qualification '+q.code+' must reference a configured level.');
 const systems=codes(gradingSystems,'grading system').map(x=>{
  const grades=x.grades;
  if(!Array.isArray(grades)||!grades.length||grades.length>150)throw new HttpError(400,'Grading systems must have 1–150 grade options.');
  const unique=grades.map(y=>{
   if(!isObj(y))throw new HttpError(400,'Invalid grade option.');
   const code=clean(y.code,64),name=clean(y.name,100);
   if(!idOk(code)||!name)throw new HttpError(400,'Grade codes and labels are required.');
   return {code,name};
  });
  if(new Set(unique.map(y=>y.code)).size!==unique.length)throw new HttpError(400,'Duplicate grade codes.');
  return {code:x.code,name:x.name,description:x.description,enabled:x.enabled,grades:unique};
 });
 return {levels:levelRows,qualifications:qualifierRows,gradingSystems:systems};
}
export const hrEducationConfigRoutes={
 'POST /api/org/hr/education/config':[orgRoute('org.hr.education.config','HRM.shell.view',async ctx=>{
  const uid=clean(ctx.body.uid,128)||ctx.uid;
  const employee=uid===ctx.uid?ctx.me:await getDoc('users/'+uid);
  if(!employee||str(employee.data.orgId)!==ctx.orgId)throw new HttpError(404,'Employee unavailable.');
  if(uid!==ctx.uid&&ctx.role!=='org_super_admin')
    throw new HttpError(403,'Education configuration for employee records is private.');
  const entity=await legalEntityForEmployee(ctx.orgId,employee.data);
  return {entity,config:entity?await getEducationConfig(ctx.orgId,entity.id):null};
 })],
 'POST /api/org/hr/education/admin':[orgRoute('org.hr.education.admin','ADM.settings',async ctx=>{
  const nodes=await entityNodes(ctx.orgId);
  const entities=nodes.filter(d=>str(d.data.level)==='legal_entity'&&str(d.data.status)!=='inactive')
   .map(d=>({id:d.id,name:str(d.data.name)})).sort((a,b)=>a.name.localeCompare(b.name));
  const requested=clean(ctx.body.legalEntityId,128);
  const entity=entities.find(e=>e.id===requested)||(!requested?entities[0]:undefined);
  return {entities,entity:entity||null,config:entity?await getEducationConfig(ctx.orgId,entity.id):null};
 })],
 'POST /api/org/hr/education/admin/save':[orgRoute('org.hr.education.admin.save','ADM.settings',async ctx=>{
  if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'ADM.settings'))
   throw new HttpError(403,'Organization settings administrator required.');
  const id=clean(ctx.body.legalEntityId,128);
  const entity=(await entityNodes(ctx.orgId)).find(d=>d.id===id&&str(d.data.level)==='legal_entity'&&str(d.data.status)!=='inactive');
  if(!entity)throw new HttpError(404,'Select an active legal entity.');
  const config=normalizeConfig(ctx.body.config);
  await writeDoc(configPath(ctx.orgId,id),{...config,updatedAt:nowIso(),updatedBy:ctx.uid});
  return {ok:true,config};
 })],
};
