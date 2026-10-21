import {HttpError,getDoc,listDocs,nowIso,randomId,str,writeDoc} from './core';
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
  else {if(typeof v!=='string'||v.length>(f.type==='long_text'?5000:500)|| (f.type==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(v))||(f.type==='select'&&!f.options?.includes(v)))throw new HttpError(400,'Invalid value: '+f.label);out[f.code]=v;}
 }
 return out;
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
  const rows=await listDocs(recordPath(ctx.orgId));
  return {records:rows.filter(r=>str(r.data.createdBy)===ctx.uid).map(r=>({id:r.id,...r.data}))};
 })],
 'POST /api/org/drkms/forms/records/save':[orgRoute('drkms.forms.records_save','ADM.document_registry',async ctx=>{
  const templateId=str(ctx.body.templateId),recordId=str(ctx.body.recordId);
  if(!ID.test(templateId)||(recordId&&!ID.test(recordId)))throw new HttpError(400,'Invalid form record identifier.');
  const template=await getDoc(templatePath(ctx.orgId)+'/'+templateId);
  if(!template||str(template.data.status)!=='draft')throw new HttpError(409,'This form template is not available for draft records.');
  const nodeId=str(template.data.scopeNodeId);
  if(!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,nodeId),await scopeOf(ctx)))throw new HttpError(403,'Form out of scope.');
  const fields=validateFormFields(template.data.fields),values=validateFormValues(fields,ctx.body.values,true);
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
  const id=recordId||randomId(10),date=nowIso();
  const record={id,templateId,templateRevision:str(template.data.revision),templateTitle:str(template.data.title),scopeNodeId:nodeId,values,operationalReference:reference,
    status:'draft',createdBy:ctx.uid,createdAt:existing?.data.createdAt??date,updatedAt:date,unapproved:true};
  if(!(await writeDoc(recordPath(ctx.orgId)+'/'+id,record,existing?{updateTime:existing.updateTime}:{exists:false})))throw new HttpError(409,'Draft was modified. Refresh.');
  return {record};
 })],
};
