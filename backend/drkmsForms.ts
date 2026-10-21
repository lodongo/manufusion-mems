import {HttpError,getDoc,listDocs,nowIso,randomId,str,writeDoc,commitChecked} from './core';
import {orgRoute} from './guards';
import {canAt,nodePath,scopeOf} from './access';
const ID=/^[a-f0-9]{20}$/;
const types=new Set(['text','long_text','number','date','yes_no','select']);
export type FormField={code:string;label:string;type:string;required:boolean;options?:string[];section?:string;visibleWhen?:{fieldCode:string;equals:string|boolean}};
export function validateFormFields(raw:unknown):FormField[]{
 if(!Array.isArray(raw)||!raw.length||raw.length>60)throw new HttpError(400,'Form needs 1–60 fields.');
 const seen=new Set<string>();
 const normalized=raw.map(entry=>{
  if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new HttpError(400,'Invalid field.');
  const e=entry as Record<string,unknown>,code=str(e.code).trim(),label=str(e.label).trim(),type=str(e.type);
  if(!/^[a-z][a-z0-9_]{1,39}$/.test(code)||seen.has(code)||label.length<2||label.length>120||!types.has(type))
   throw new HttpError(400,'Invalid field code, label or type.');
  seen.add(code);
  const options=type==='select'&&Array.isArray(e.options)?e.options.map(x=>str(x).trim()):[];
  if(type==='select'&&(!options.length||options.length>30||options.some(x=>!x||x.length>80)||new Set(options).size!==options.length))
   throw new HttpError(400,'Select fields require distinct options.');
  const section=str(e.section||'General').trim();
  if(section.length<2||section.length>80)throw new HttpError(400,'Invalid form section.');
  let visibleWhen:FormField['visibleWhen'];
  if(e.visibleWhen!==undefined){
   if(!e.visibleWhen||typeof e.visibleWhen!=='object'||Array.isArray(e.visibleWhen))throw new HttpError(400,'Invalid condition.');
   const w=e.visibleWhen as Record<string,unknown>;
   if(typeof w.fieldCode!=='string'||(typeof w.equals!=='string'&&typeof w.equals!=='boolean'))throw new HttpError(400,'Invalid conditional field.');
   visibleWhen={fieldCode:w.fieldCode,equals:w.equals};
  }
  return {code,label,type,required:e.required===true,section,...(visibleWhen?{visibleWhen}:{}),...(type==='select'?{options}:{})};
 });
 normalized.forEach((f,i)=>{if(!f.visibleWhen)return;
  const parent=normalized.findIndex(x=>x.code===f.visibleWhen?.fieldCode);
  if(parent<0||parent>=i||!['select','yes_no'].includes(normalized[parent].type))throw new HttpError(400,'Condition must reference an earlier selection or yes/no field.');
  const p=normalized[parent];if(p.type==='yes_no'&&typeof f.visibleWhen.equals!=='boolean'||p.type==='select'&&!p.options?.includes(String(f.visibleWhen.equals)))throw new HttpError(400,'Condition is not valid for its parent field.');
 });
 return normalized;
}
export function formFieldVisible(f:FormField,values:Record<string,unknown>):boolean{
 return !f.visibleWhen||values[f.visibleWhen.fieldCode]===f.visibleWhen.equals;
}
export function validIsoDate(value:string):boolean{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const d=new Date(value+'T00:00:00.000Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}
export function validateFormValues(fields:FormField[],raw:unknown,allowIncomplete=false){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new HttpError(400,'Form values are required.');
 const values=raw as Record<string,unknown>,out:Record<string,string|number|boolean|null>={};
 if(Object.keys(values).some(k=>!fields.some(f=>f.code===k)))throw new HttpError(400,'Unexpected form field.');
 for(const f of fields){
  if(!formFieldVisible(f,values)){out[f.code]=null;continue;}
  const v=values[f.code];
  if(v===null||v===undefined||v===''){if(f.required&&!allowIncomplete)throw new HttpError(400,'Required field: '+f.label);out[f.code]=null;continue;}
  if(f.type==='number'){if(typeof v!=='number'||!Number.isFinite(v))throw new HttpError(400,'Invalid number: '+f.label);out[f.code]=v;}
  else if(f.type==='yes_no'){if(typeof v!=='boolean')throw new HttpError(400,'Invalid yes/no: '+f.label);out[f.code]=v;}
  else {if(typeof v!=='string'||v.length>(f.type==='long_text'?5000:500)|| (f.type==='date'&&!validIsoDate(v))||(f.type==='select'&&!f.options?.includes(v)))throw new HttpError(400,'Invalid value: '+f.label);out[f.code]=v;}
 }
 return out;
}
const VERIFIED_SOURCES:Record<string,string>={
 MNT:'work_orders',SAF:'safety_incidents',AST:'assets'
};
export async function resolveFormReference(orgId:string,reference:{module:string;recordId:string}|null,allowedNodeId=''){
 if(!reference)return null;
 const collection=VERIFIED_SOURCES[reference.module];
 if(!collection)return {...reference,verification:'unsupported_connector'};
 const doc=await getDoc(`organizations/${orgId}/${collection}/${reference.recordId}`);
 if(!doc||str(doc.data.orgId)&&str(doc.data.orgId)!==orgId)
  throw new HttpError(404,'Operational source record not found in this organization.');
 const sourceScope=doc.data.scope&&typeof doc.data.scope==='object'&&!Array.isArray(doc.data.scope)
  ?str((doc.data.scope as Record<string,unknown>).nodeId):str(doc.data.scopeNodeId);
 if(!sourceScope||!allowedNodeId||sourceScope!==allowedNodeId)
  return {...reference,verification:'pending_scope_validation'};
 return {...reference,verification:'linked',sourceTitle:str(doc.data.title)||str(doc.data.name)||reference.recordId};
}
const templatePath=(o:string)=>`organizations/${o}/drkms_form_templates`;
const recordPath=(o:string)=>`organizations/${o}/drkms_form_records`;
export const drkmsFormRoutes={
 'POST /api/org/drkms/forms/templates/list':[orgRoute('drkms.forms.templates_list','ADM.document_registry',async ctx=>{
  const data=await listDocs(templatePath(ctx.orgId)),scope=await scopeOf(ctx),templates=[];
  for(const t of data){const nodeId=str(t.data.scopeNodeId);if(nodeId&&canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,nodeId),scope))templates.push({id:t.id,...t.data});}
  return {templates};
 })],
 'POST /api/org/drkms/forms/templates/create':[orgRoute('drkms.forms.templates_create','ADM.document_registry',async ctx=>{
  const title=str(ctx.body.title).trim(),scopeNodeId=str(ctx.body.scopeNodeId),fields=validateFormFields(ctx.body.fields);
  if(title.length<3||title.length>180||!scopeNodeId||!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,scopeNodeId),await scopeOf(ctx)))throw new HttpError(403,'Invalid title or organizational access.');
  const signers=ctx.body.signers;
  if(signers!==undefined&&(!Array.isArray(signers)||signers.length>12))throw new HttpError(400,'Invalid sign-off plan.');
  const signOffPlan:Array<{signerUid:string;label:string}>=[];
  for(const raw of Array.isArray(signers)?signers:[]){
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new HttpError(400,'Invalid signatory.');
   const row=raw as Record<string,unknown>,signerUid=str(row.signerUid),label=str(row.label).trim();
   if(!/^[a-zA-Z0-9_-]{6,128}$/.test(signerUid)||label.length<3||label.length>80||signOffPlan.some(s=>s.signerUid===signerUid))
    throw new HttpError(400,'Duplicate or invalid signatory.');
   const user=await getDoc('users/'+signerUid);
   if(!user||str(user.data.orgId)!==ctx.orgId||str(user.data.status)==='disabled')
    throw new HttpError(403,'Signatories must be active MEMS organization users.');
   signOffPlan.push({signerUid,label});
  }
  const id=randomId(10),date=nowIso(),template={id,title,scopeNodeId,fields,signOffPlan,revision:'00',status:'draft',createdBy:ctx.uid,createdAt:date,updatedAt:date};
  if(!(await writeDoc(templatePath(ctx.orgId)+'/'+id,template,{exists:false})))throw new HttpError(409,'Template conflict.');
  return {template};
 })],
 'POST /api/org/drkms/forms/records/list':[orgRoute('drkms.forms.records_list','ADM.document_registry',async ctx=>{
  const rows=await listDocs(recordPath(ctx.orgId)),scope=await scopeOf(ctx),visible=[];
  for(const r of rows){
   if(str(r.data.createdBy)!==ctx.uid)continue;
   const nodeId=str(r.data.scopeNodeId);
   if(nodeId&&canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,nodeId),scope))visible.push({id:r.id,...r.data});
  }
  return {records:visible};
 })],
 'POST /api/org/drkms/forms/review/inbox':[orgRoute('drkms.forms.review_inbox','ADM.document_review',async ctx=>{
  const records=await listDocs(recordPath(ctx.orgId)),scope=await scopeOf(ctx),results=[];
  for(const row of records){
   if(str(row.data.status)!=='submitted_for_review')continue;
   const nodeId=str(row.data.scopeNodeId);
   if(str(row.data.createdBy)===ctx.uid||!nodeId||!canAt(ctx,'ADM.document_review',await nodePath(ctx.orgId,nodeId),scope))continue;
   results.push({id:row.id,templateTitle:str(row.data.templateTitle),submittedAt:str(row.data.submittedAt),createdBy:str(row.data.createdBy),values:row.data.values,scopeNodeId:nodeId});
  }
  return {records:results};
 })],
 'POST /api/org/drkms/forms/review/decision':[orgRoute('drkms.forms.review_decision','ADM.document_review',async ctx=>{
  const id=str(ctx.body.recordId),decision=str(ctx.body.decision),reason=str(ctx.body.reason).trim();
  if(!ID.test(id)||!['return','technical_reviewed'].includes(decision)||reason.length<12||reason.length>2000)
   throw new HttpError(400,'Review decision and 12–2000 character justification required.');
  const path=recordPath(ctx.orgId)+'/'+id,record=await getDoc(path);
  if(!record||str(record.data.status)!=='submitted_for_review')throw new HttpError(409,'No submitted record to review.');
  if(str(record.data.createdBy)===ctx.uid)throw new HttpError(403,'Document creator cannot independently review their own record.');
  const nodeId=str(record.data.scopeNodeId);
  if(!nodeId||!canAt(ctx,'ADM.document_review',await nodePath(ctx.orgId,nodeId),await scopeOf(ctx)))
   throw new HttpError(403,'Review is outside your scope.');
  const date=nowIso(),next={...record.data,status:decision==='return'?'draft':'technical_reviewed',
   unapproved:true,reviewedBy:ctx.uid,reviewedAt:date,reviewReason:reason,updatedAt:date};
  const evidencePath=path+'/review_history/'+randomId(10);
  if(!(await commitChecked([{path,data:next,precondition:{updateTime:record.updateTime}},
   {path:evidencePath,data:{decision,reviewerUid:ctx.uid,reviewedAt:date,reason,recordId:id},precondition:{exists:false}}])))
    throw new HttpError(409,'Form changed during review. Refresh.');
  return {record:{id,...next},approved:false,published:false};
 })],
 'POST /api/org/drkms/forms/records/submit':[
  orgRoute('drkms.forms.records_submit','ADM.document_registry',async ctx=>{
   const id=str(ctx.body.recordId);
   if(!ID.test(id))throw new HttpError(400,'Invalid form record identifier.');
   const path=recordPath(ctx.orgId)+'/'+id,record=await getDoc(path);
   if(!record||str(record.data.createdBy)!==ctx.uid||str(record.data.status)!=='draft')
    throw new HttpError(403,'Only the owner may submit an editable draft.');
   const template=await getDoc(templatePath(ctx.orgId)+'/'+str(record.data.templateId));
   if(!template||str(template.data.revision)!==str(record.data.templateRevision))
    throw new HttpError(409,'Form template revision changed. Reconcile this draft.');
   const nodeId=str(record.data.scopeNodeId);
   if(!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,nodeId),await scopeOf(ctx)))
    throw new HttpError(403,'Form is outside authorized scope.');
   const fields=validateFormFields(template.data.fields);
   const values=validateFormValues(fields,record.data.values,false);
   const source=record.data.operationalReference as {module:string;recordId:string}|null;
   if(source?.module){
    const resolved=await resolveFormReference(ctx.orgId,source,nodeId);
    if(resolved?.verification!=='linked')throw new HttpError(409,'Operational source requires a verified connector before submission.');
   }
   const date=nowIso();
   const next={...record.data,values,status:'submitted_for_review',unapproved:true,submittedAt:date,submittedBy:ctx.uid,updatedAt:date};
   if(!(await writeDoc(path,next,{updateTime:record.updateTime})))throw new HttpError(409,'Draft changed while submitting.');
   return {record:{id,...next},publicationEnabled:false};
  }),
 ],
 'POST /api/org/drkms/forms/records/save':[orgRoute('drkms.forms.records_save','ADM.document_registry',async ctx=>{
  const templateId=str(ctx.body.templateId),recordId=str(ctx.body.recordId);
  if(!ID.test(templateId)||(recordId&&!ID.test(recordId)))throw new HttpError(400,'Invalid form record identifier.');
  const template=await getDoc(templatePath(ctx.orgId)+'/'+templateId);
  if(!template||str(template.data.status)!=='draft')throw new HttpError(409,'This form template is not available for draft records.');
  const nodeId=str(template.data.scopeNodeId);
  if(!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,nodeId),await scopeOf(ctx)))throw new HttpError(403,'Form out of scope.');
  const fields=validateFormFields(template.data.fields),values=validateFormValues(fields,ctx.body.values,true);
  if(str(template.data.status)!=='draft')throw new HttpError(409,'Template is not editable.');
  const existing=recordId?await getDoc(recordPath(ctx.orgId)+'/'+recordId):null;
  if(recordId&&(!existing||str(existing.data.createdBy)!==ctx.uid||str(existing.data.status)!=='draft'||str(existing.data.templateId)!==templateId))throw new HttpError(403,'Draft record is not editable.');
  const operationalReference=ctx.body.operationalReference;
  let reference:null|{module:string;recordId:string}=null;
  if(operationalReference!==undefined&&operationalReference!==null){
   if(typeof operationalReference!=='object'||Array.isArray(operationalReference))throw new HttpError(400,'Invalid record reference.');
   const r=operationalReference as Record<string,unknown>,module=str(r.module),sourceId=str(r.recordId);
   if(!['MNT','SAF','MFG','QLT','AST'].includes(module)||!/^[a-zA-Z0-9_-]{3,100}$/.test(sourceId))throw new HttpError(400,'Invalid operational reference.');
   reference={module,recordId:sourceId};
  }
  const resolvedReference=await resolveFormReference(ctx.orgId,reference,nodeId);
  const id=recordId||randomId(10),date=nowIso();
  const record={id,templateId,templateRevision:str(template.data.revision),templateTitle:str(template.data.title),scopeNodeId:nodeId,values,operationalReference:resolvedReference,
    status:'draft',createdBy:ctx.uid,createdAt:existing?.data.createdAt??date,updatedAt:date,unapproved:true};
  if(!(await writeDoc(recordPath(ctx.orgId)+'/'+id,record,existing?{updateTime:existing.updateTime}:{exists:false})))throw new HttpError(409,'Draft was modified. Refresh.');
  return {record};
 })],
};
