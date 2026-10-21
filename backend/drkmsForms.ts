import {HttpError,getDoc,listDocs,nowIso,randomId,str,writeDoc,commitChecked,isObj} from './core';
import {createHash} from 'node:crypto';
import {transactionPayloadHash} from './unifiedApprovalProof';
import {validPosition} from './drkmsSignatures';
import {orgRoute} from './guards';
import {orgUsers,record as recordAudit} from './org';
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
  if(!formFieldVisible(f,out)){out[f.code]=null;continue;}
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
export function formRecordFingerprint(record:Record<string,unknown>):string{
 return transactionPayloadHash({
  templateId:str(record.templateId),templateRevision:str(record.templateRevision),
  scopeNodeId:str(record.scopeNodeId),values:record.values,operationalReference:record.operationalReference,
  attachments:record.attachments,
  createdBy:str(record.createdBy),recordId:str(record.id)
 });
}
const templatePath=(o:string)=>`organizations/${o}/drkms_form_templates`;
const recordPath=(o:string)=>`organizations/${o}/drkms_form_records`;
export const drkmsFormRoutes={
 'POST /api/org/drkms/forms/signers/list':[orgRoute('drkms.forms.signers_list','ADM.document_registry',async ctx=>{
  const rows=await orgUsers(ctx.orgId);
  const users=rows.filter(u=>str(u.data.status)!=='disabled'&&str(u.data.status)!=='deleted')
   .slice(0,1000).map(u=>({uid:u.id,firstName:str(u.data.firstName),lastName:str(u.data.lastName),
      role:str(u.data.role)})).sort((a,b)=>`${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
  return {users};
 })],
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
  const signOffPlan:Array<{signerUid:string;label:string;position:{page:number;xPercent:number;yPercent:number;widthPercent:number}}>=[];
  for(const raw of Array.isArray(signers)?signers:[]){
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new HttpError(400,'Invalid signatory.');
   const row=raw as Record<string,unknown>,signerUid=str(row.signerUid),label=str(row.label).trim();
   if(!/^[a-zA-Z0-9_-]{6,128}$/.test(signerUid)||label.length<3||label.length>80||!validPosition(row.position)||signOffPlan.some(s=>s.signerUid===signerUid))
    throw new HttpError(400,'Duplicate or invalid signatory.');
   const user=await getDoc('users/'+signerUid);
   if(!user||signerUid===ctx.uid||str(user.data.orgId)!==ctx.orgId||str(user.data.status)==='disabled')
    throw new HttpError(403,'Signatories must be distinct active MEMS organization users.');
   signOffPlan.push({signerUid,label,position:row.position as {page:number;xPercent:number;yPercent:number;widthPercent:number}});
  }
  const id=randomId(10),date=nowIso(),template={id,title,scopeNodeId,fields,signOffPlan,revision:'00',status:'draft',createdBy:ctx.uid,createdAt:date,updatedAt:date};
  if(!(await writeDoc(templatePath(ctx.orgId)+'/'+id,template,{exists:false})))throw new HttpError(409,'Template conflict.');
  return {template};
 })],
 'POST /api/org/drkms/forms/templates/retire-draft':[orgRoute('drkms.forms.templates_retire_draft','ADM.document_registry',async ctx=>{
  const id=str(ctx.body.templateId),reason=str(ctx.body.reason).trim();
  if(!ID.test(id)||reason.length<12||reason.length>2000)
   throw new HttpError(400,'A valid template and documented retirement justification are required.');
  const path=templatePath(ctx.orgId)+'/'+id,template=await getDoc(path);
  if(!template||str(template.data.status)!=='draft'||str(template.data.createdBy)!==ctx.uid)
   throw new HttpError(403,'Only the creator may retire an unpublished draft template.');
  const nodeId=str(template.data.scopeNodeId);
  if(!nodeId||!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,nodeId),await scopeOf(ctx)))
   throw new HttpError(403,'Template is outside your authorized organizational scope.');
  const records=await listDocs(recordPath(ctx.orgId));
  if(records.some(r=>str(r.data.templateId)===id))
   throw new HttpError(409,'This template has records. Retain its revision history and do not retire it.');
  const now=nowIso();
  if(!(await writeDoc(path,{...template.data,status:'retired_draft',retiredAt:now,retiredBy:ctx.uid,
    retirementReason:reason,updatedAt:now},{updateTime:template.updateTime})))
   throw new HttpError(409,'Template changed during retirement.');
  await recordAudit(ctx,'drkms.form.template_retired',id,reason);
  return {templateId:id,status:'retired_draft',published:false};
 })],
 'POST /api/org/drkms/forms/templates/revise':[orgRoute('drkms.forms.templates_revise','ADM.document_registry',async ctx=>{
  const sourceId=str(ctx.body.sourceTemplateId),reason=str(ctx.body.reason).trim(),title=str(ctx.body.title).trim();
  if(!ID.test(sourceId)||reason.length<12||reason.length>2000||title.length<3||title.length>180)
   throw new HttpError(400,'Choose an existing template and provide a meaningful revision reason.');
  const path=templatePath(ctx.orgId)+'/'+sourceId,source=await getDoc(path);
  if(!source||str(source.data.status)!=='draft'||str(source.data.createdBy)!==ctx.uid||
    str(source.data.successorId))
   throw new HttpError(409,'Template is not an editable original or already has a newer revision.');
  const scopeNodeId=str(source.data.scopeNodeId);
  if(!scopeNodeId||!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,scopeNodeId),await scopeOf(ctx)))
   throw new HttpError(403,'Template is outside your authorized location.');
  const revision=Number(str(source.data.revision));
  if(!Number.isSafeInteger(revision)||revision<0||revision>=999)
   throw new HttpError(409,'Template revision numbering requires administrative review.');
  const fields=validateFormFields(ctx.body.fields),signers=ctx.body.signers;
  if(!Array.isArray(signers)||signers.length>12)throw new HttpError(400,'Invalid revised sign-off plan.');
  const signOffPlan:Array<{signerUid:string;label:string;position:{page:number;xPercent:number;yPercent:number;widthPercent:number}}>=[];
  for(const item of signers){
   if(!item||typeof item!=='object'||Array.isArray(item))throw new HttpError(400,'Invalid signer.');
   const row=item as Record<string,unknown>,uid=str(row.signerUid),label=str(row.label).trim();
   if(!/^[a-zA-Z0-9_-]{6,128}$/.test(uid)||uid===ctx.uid||label.length<3||label.length>80||!validPosition(row.position)||
      signOffPlan.some(s=>s.signerUid===uid))throw new HttpError(400,'Invalid or duplicate revised signer.');
   const user=await getDoc('users/'+uid);
   if(!user||str(user.data.orgId)!==ctx.orgId||str(user.data.status)==='disabled')
    throw new HttpError(403,'Revised signatory must be active in the same organization.');
   signOffPlan.push({signerUid:uid,label,position:row.position as {page:number;xPercent:number;yPercent:number;widthPercent:number}});
  }
  const id=randomId(10),now=nowIso(),next={id,title,scopeNodeId,fields,signOffPlan,
   revision:String(revision+1).padStart(2,'0'),status:'draft',createdBy:ctx.uid,createdAt:now,
   updatedAt:now,previousTemplateId:sourceId,revisionReason:reason};
  if(!(await commitChecked([
   {path,data:{...source.data,successorId:id,updatedAt:now},precondition:{updateTime:source.updateTime}},
   {path:templatePath(ctx.orgId)+'/'+id,data:next,precondition:{exists:false}}
  ])))throw new HttpError(409,'Template changed while creating the revision.');
  return {template:next,previousTemplateId:sourceId,approvalStatus:'not_published'};
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
 'POST /api/org/drkms/forms/signatures/inbox':[orgRoute('drkms.forms.signature_inbox',null,async ctx=>{
  const rows=await listDocs(`organizations/${ctx.orgId}/form_signature_inbox/${ctx.uid}/assignments`);
  const items=[],signerScope=await scopeOf(ctx);
  for(const row of rows.slice(0,250)){
   const recordId=str(row.data.recordId),slotId=str(row.data.slotId);
   if(!ID.test(recordId)||!ID.test(slotId))continue;
   const [record,slot]=await Promise.all([getDoc(recordPath(ctx.orgId)+'/'+recordId),
    getDoc(recordPath(ctx.orgId)+'/'+recordId+'/signatures/'+slotId)]);
   if(!record||!slot||str(slot.data.signerUid)!==ctx.uid||str(slot.data.recordId)!==recordId)continue;
   const nodeId=str(record.data.scopeNodeId);
   if(!nodeId||(signerScope!=='all'&&!signerScope.has(nodeId)))continue;
   items.push({recordId,slotId,templateTitle:str(record.data.templateTitle),status:str(record.data.status),
    signerStatus:str(slot.data.status),label:str(slot.data.label),signedAt:str(slot.data.signedAt),
    recordFingerprint:str(slot.data.recordFingerprint),values:record.data.values,
    submittedAt:str(record.data.submittedAt)});
  }
  return {assignments:items};
 })],
 'POST /api/org/drkms/forms/signatures/sign':[orgRoute('drkms.forms.sign',null,async ctx=>{
  const recordId=str(ctx.body.recordId),slotId=str(ctx.body.slotId);
  if(!ID.test(recordId)||!ID.test(slotId)||ctx.body.attest!==true)
   throw new HttpError(400,'Assigned record, signature and explicit attestation required.');
  const path=recordPath(ctx.orgId)+'/'+recordId;
  const [record,slot]=await Promise.all([getDoc(path),getDoc(path+'/signatures/'+slotId)]);
  if(!record||!slot||str(record.data.status)!=='technical_reviewed'||
    str(slot.data.signerUid)!==ctx.uid||str(slot.data.status)!=='pending')
   throw new HttpError(403,'Signature is not available for your account.');
  const signerScope=await scopeOf(ctx),scopeNodeId=str(record.data.scopeNodeId);
  if(!scopeNodeId||(signerScope!=='all'&&!signerScope.has(scopeNodeId)))
   throw new HttpError(403,'Assigned signer no longer has access to the document location.');
  if(!str(record.data.reviewedBy)||str(record.data.reviewedBy)===ctx.uid||
    str(record.data.createdBy)===ctx.uid)
   throw new HttpError(403,'Form creator or technical reviewer cannot sign in a separate authority stream.');
  const hash=formRecordFingerprint(record.data);
  if(hash!==str(record.data.reviewedFingerprint)||hash!==str(slot.data.recordFingerprint)||
    str(record.data.reviewId)!==str(slot.data.reviewId))
   throw new HttpError(409,'Record contents or review have changed; signing blocked.');
  const signer=await getDoc('users/'+ctx.uid);
  if(!signer||str(signer.data.orgId)!==ctx.orgId||str(signer.data.status)==='disabled')
   throw new HttpError(403,'Signer is no longer an eligible organization user.');
  const signedAt=nowIso(),proof=createHash('sha256').update(JSON.stringify({
   orgId:ctx.orgId,recordId,slotId,uid:ctx.uid,fingerprint:hash,signedAt,reviewId:str(record.data.reviewId)
  })).digest('hex');
  if(!(await commitChecked([{path:path+'/signatures/'+slotId,data:{...slot.data,
   status:'signed',signedAt,signedBy:ctx.uid,proof,authMethod:'firebase_authenticated_session'},
   precondition:{updateTime:slot.updateTime}}])))
   throw new HttpError(409,'This signing assignment changed; refresh.');
  await recordAudit(ctx,'drkms.form.signed',recordId,slotId);
  return {recordId,slotId,proof,signedAt,approved:false,published:false};
 })],
 'POST /api/org/drkms/forms/records/history':[orgRoute('drkms.forms.record_history',null,async ctx=>{
  const id=str(ctx.body.recordId);
  if(!ID.test(id))throw new HttpError(400,'Choose a valid form record.');
  const path=recordPath(ctx.orgId)+'/'+id,form=await getDoc(path);
  if(!form)throw new HttpError(404,'Record not found.');
  const nodeId=str(form.data.scopeNodeId),scope=await scopeOf(ctx);
  if(!nodeId||(str(form.data.createdBy)!==ctx.uid&&
    !canAt(ctx,'ADM.document_review',await nodePath(ctx.orgId,nodeId),scope)))
   throw new HttpError(403,'History is restricted to the author and authorized reviewers.');
  if(scope!=='all'&&!scope.has(nodeId)&&!canAt(ctx,'ADM.document_review',await nodePath(ctx.orgId,nodeId),scope))
   throw new HttpError(403,'Record is outside your current scope.');
  const [reviewRows,signatureRows]=await Promise.all([listDocs(path+'/review_history'),listDocs(path+'/signatures')]);
  return {recordId:id,status:str(form.data.status),unapproved:form.data.unapproved!==false,
   reviews:reviewRows.map(r=>({reviewId:r.id,decision:str(r.data.decision),reviewerUid:str(r.data.reviewerUid),
     reviewedAt:str(r.data.reviewedAt),reason:str(r.data.reason),fingerprint:str(r.data.fingerprint)})),
   signatures:signatureRows.map(s=>({slotId:s.id,signerUid:str(s.data.signerUid),label:str(s.data.label),
     status:str(s.data.status),signedAt:str(s.data.signedAt),fingerprint:str(s.data.recordFingerprint)}))};
 })],
 'POST /api/org/drkms/forms/records/evidence/link':[orgRoute('drkms.forms.evidence_link','ADM.document_registry',async ctx=>{
  const id=str(ctx.body.recordId),documentId=str(ctx.body.documentId),fileId=str(ctx.body.fileId);
  if(!ID.test(id)||!ID.test(documentId)||!ID.test(fileId))
   throw new HttpError(400,'Valid draft, document and source file are required.');
  const recordPathKey=recordPath(ctx.orgId)+'/'+id,record=await getDoc(recordPathKey);
  if(!record||str(record.data.status)!=='draft'||str(record.data.createdBy)!==ctx.uid)
   throw new HttpError(403,'Only the draft creator may link controlled evidence.');
  const scope=await scopeOf(ctx),nodeId=str(record.data.scopeNodeId);
  if(!nodeId||!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,nodeId),scope))
   throw new HttpError(403,'Draft is outside your current organizational scope.');
  const docPath=`organizations/${ctx.orgId}/drkms_documents/${documentId}`,doc=await getDoc(docPath);
  if(!doc||str(doc.data.status)!=='effective')throw new HttpError(409,'Evidence must be an effective controlled document.');
  const sourceNodeId=isObj(doc.data.scope)?str(doc.data.scope.nodeId):'';
  if(!sourceNodeId||!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,sourceNodeId),scope))
   throw new HttpError(403,'Evidence document is outside your current scope.');
  const revisionId=str(doc.data.effectiveRevisionId),rev=await getDoc(docPath+'/revisions/'+revisionId),file=await getDoc(docPath+'/files/'+fileId);
  if(!rev||rev.data.immutable!==true||str(rev.data.tenantId)!==ctx.orgId||
     str(rev.data.documentId)!==documentId||!file||
     str(file.data.scanStatus)!=='clean'||str(file.data.availability)!=='verified')
   throw new HttpError(409,'Controlled evidence source is not verified.');
  const manifest=Array.isArray(rev.data.sourceFiles)?rev.data.sourceFiles.filter(isObj):[];
  const item=manifest.find(v=>str(v.fileId)===fileId);
  if(!item||str(item.sha256)!==str(file.data.sha256)||Number(item.bytes)!==Number(file.data.bytes)||
     str(item.mime)!==str(file.data.mime))throw new HttpError(409,'Evidence source differs from the published manifest.');
  const existing=Array.isArray(record.data.attachments)?record.data.attachments.filter(isObj):[];
  if(existing.length>=20||existing.some(a=>str(a.documentId)===documentId&&str(a.fileId)===fileId))
   throw new HttpError(409,'Evidence limit reached or document already linked.');
  const evidence={documentId,revisionId,fileId,sha256:str(item.sha256),mime:str(item.mime),
    bytes:Number(item.bytes),name:str(file.data.name),linkedBy:ctx.uid,linkedAt:nowIso(),verification:'effective_snapshot'};
  if(!(await writeDoc(recordPathKey,{...record.data,attachments:[...existing,evidence],updatedAt:nowIso()},
    {updateTime:record.updateTime})))throw new HttpError(409,'Draft changed while linking evidence.');
  return {evidence,unapproved:true};
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
  const date=nowIso(),reviewId=randomId(10),hash=formRecordFingerprint(record.data);
  const next={...record.data,status:decision==='return'?'draft':'technical_reviewed',
   unapproved:true,reviewedBy:ctx.uid,reviewedAt:date,reviewReason:reason,reviewId,
   reviewedFingerprint:decision==='return'?'':hash,updatedAt:date};
  const evidencePath=path+'/review_history/'+reviewId;
  const writes:[{path:string;data:Record<string,unknown>;precondition:{updateTime:string}}|{path:string;data:Record<string,unknown>;precondition:{exists:false}},...Array<{path:string;data:Record<string,unknown>;precondition:{exists:false}}>] = [
   {path,data:next,precondition:{updateTime:record.updateTime}},
   {path:evidencePath,data:{decision,reviewerUid:ctx.uid,reviewedAt:date,reason,recordId:id,fingerprint:hash},precondition:{exists:false}}
  ];
  if(decision==='technical_reviewed'){
   const template=await getDoc(templatePath(ctx.orgId)+'/'+str(record.data.templateId));
   if(!template||str(template.data.revision)!==str(record.data.templateRevision))throw new HttpError(409,'Template revision no longer matches the reviewed record.');
   const signers=Array.isArray(template.data.signOffPlan)?template.data.signOffPlan:[];
   if(signers.length>12)throw new HttpError(409,'Signatory plan exceeds supported capacity.');
   for(const s of signers){
    if(!s||typeof s!=='object')throw new HttpError(409,'Invalid configured signer.');
    const signer=s as Record<string,unknown>,uid=str(signer.signerUid);
    if(!/^[a-zA-Z0-9_-]{6,128}$/.test(uid)||uid===str(record.data.createdBy))
     throw new HttpError(409,'Invalid or self-assigned signatory.');
    const user=await getDoc('users/'+uid);
    if(!user||str(user.data.orgId)!==ctx.orgId||str(user.data.status)==='disabled')throw new HttpError(409,'An assigned signatory is no longer eligible.');
    const slotId=createHash('sha256').update(uid+':'+reviewId).digest('hex').slice(0,20);
    const slot={slotId,recordId:id,reviewId,recordFingerprint:hash,signerUid:uid,label:str(signer.label),position:signer.position,
      assignedBy:str(record.data.createdBy),assignedAt:date,status:'pending'};
    writes.push({path:path+'/signatures/'+slotId,data:slot,precondition:{exists:false}});
    writes.push({path:`organizations/${ctx.orgId}/form_signature_inbox/${uid}/assignments/${id}_${slotId}`,
     data:{recordId:id,slotId,assignedAt:date},precondition:{exists:false}});
   }
  }
  if(!(await commitChecked(writes)))
    throw new HttpError(409,'Form changed during review. Refresh.');
  await recordAudit(ctx,'drkms.form.review',id,decision);
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
  if(!recordId&&str(template.data.successorId))throw new HttpError(409,'Use the newer template revision for new draft records.');
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
  const record={id,templateId,templateRevision:str(template.data.revision),templateTitle:str(template.data.title),scopeNodeId:nodeId,values,operationalReference:resolvedReference,attachments:existing?.data.attachments??[],
    status:'draft',createdBy:ctx.uid,createdAt:existing?.data.createdAt??date,updatedAt:date,unapproved:true};
  if(!(await writeDoc(recordPath(ctx.orgId)+'/'+id,record,existing?{updateTime:existing.updateTime}:{exists:false})))throw new HttpError(409,'Draft was modified. Refresh.');
  return {record};
 })],
};
