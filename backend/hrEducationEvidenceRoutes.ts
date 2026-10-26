
/** Private HR qualification evidence: immutable files, independent reviewer decisions. */
import {createHash} from 'node:crypto';
import {storage} from './platform/sdk';
import {HttpError,commitChecked,getDoc,isObj,listDocs,nowIso,randomId,rateLimit,str} from './core';
import {orgRoute,hasPerm,type OrgContext} from './guards';
import {hrSiteOf} from './hrHierarchy';
import {audit} from './audit';
import {documentFileSignatureValid} from './drkmsFiles';
import {hrMayAccess,hrRules} from './hrPrivacyRules';

const UID=/^[A-Za-z0-9_-]{1,128}$/;
const ID=/^[a-f0-9]{24}$/;
const QUAL_ID=/^[A-Za-z0-9_-]{1,80}$/;
const TYPES=['degree_certificate','transcript','professional_certificate','diploma_certificate','other'];
const FORMATS:Record<string,{ext:string;max:number}>={
 'application/pdf':{ext:'pdf',max:8_000_000},
 'image/png':{ext:'png',max:5_000_000},
 'image/jpeg':{ext:'jpg',max:5_000_000},
};
const dir=(org:string,uid:string)=>'organizations/'+org+'/hr_employee_evidence/'+uid+'/files';
const meta=(org:string,uid:string,id:string)=>dir(org,uid)+'/'+id;
const queue=(org:string)=>'organizations/'+org+'/hr_evidence_queue';
const mapOut=(doc:{id:string;data:Record<string,unknown>})=>({
 id:doc.id,employeeUid:str(doc.data.employeeUid),educationId:str(doc.data.educationId),
 documentType:str(doc.data.documentType),name:str(doc.data.name),qualificationName:str(doc.data.qualificationName),qualificationField:str(doc.data.qualificationField),mime:str(doc.data.mime),
 size:Number(doc.data.size)||0,sha256:str(doc.data.sha256),status:str(doc.data.status)||'pending',
 uploadedAt:str(doc.data.uploadedAt),uploadedBy:str(doc.data.uploadedBy),
 reviewedAt:str(doc.data.reviewedAt),reviewedBy:str(doc.data.reviewedBy),
 reviewNote:str(doc.data.reviewNote),
});
const primary=(data:Record<string,unknown>)=>(Array.isArray(data.assignments)?data.assignments.filter(isObj):[])
 .filter(x=>str(x.type)==='primary').map(x=>str(x.nodeId)).filter(Boolean);
async function person(ctx:OrgContext,uid:string){
 if(!UID.test(uid))throw new HttpError(400,'Select a valid employee.');
 const doc=uid===ctx.uid?ctx.me:await getDoc('users/'+uid);
 if(!doc||str(doc.data.orgId)!==ctx.orgId||str(doc.data.status)==='disabled')
  throw new HttpError(404,'Employee unavailable.');
 return doc;
}
async function mayVerify(ctx:OrgContext,employee:Record<string,unknown>){
 if(ctx.role==='org_super_admin')return true;
 if(!hasPerm(ctx.directPermissions,'HRM.records.verify'))return false;
 const docs=await listDocs('organizations/'+ctx.orgId+'/structure');
 const nodes=new Map(docs.map(x=>[x.id,x.data]));
 const reviewer=primary(ctx.me.data),targets=primary(employee);
 if(!reviewer.length||!targets.length)return false;
 const sites=new Set(reviewer.map(x=>hrSiteOf(x,nodes)).filter(Boolean));
 return targets.some(target=>{
  const site=hrSiteOf(target,nodes);
  if(site&&sites.has(site))return true;
  let id=target;const seen=new Set<string>();
  while(id&&!seen.has(id)){
   if(reviewer.includes(id))return true;
   seen.add(id);const node=nodes.get(id);
   if(!node||str(node.status)==='inactive')return false;
   id=str(node.parentId);
  }
  return false;
 });
}
async function allowed(ctx:OrgContext,uid:string,upload=false){
 const employee=await person(ctx,uid);
 if(uid===ctx.uid){
  if(upload){
   const rules=await getDoc('organizations/'+ctx.orgId+'/hr_access_rules/default');
   if(!hrMayAccess('self','education',hrRules(rules?.data)))
    throw new HttpError(403,'Education self-service is disabled.');
  }
  return employee;
 }
 if(ctx.role==='org_super_admin'||!upload&&await mayVerify(ctx,employee.data))return employee;
 throw new HttpError(403,'Private qualification evidence is restricted to its employee and authorized HR.');
}
async function auditEvidence(ctx:OrgContext,action:string,id:string,details:string){
 await audit([{category:'data',action,actor:ctx.actor,meta:ctx.meta,
  target:{type:'hr_qualification_evidence',id},details}]);
}
export const hrEducationEvidenceRoutes={
 'POST /api/org/hr/evidence/list':[orgRoute('hr.evidence.list','HRM.shell.view',async ctx=>{
  const uid=str(ctx.body.uid)||ctx.uid;await allowed(ctx,uid);
  const docs=await listDocs(dir(ctx.orgId,uid));
  return {files:docs.map(mapOut).sort((a,b)=>b.uploadedAt.localeCompare(a.uploadedAt))};
 })],
 'POST /api/org/hr/evidence/upload':[orgRoute('hr.evidence.upload','HRM.shell.view',async ctx=>{
  await rateLimit('hr-evidence-upload',ctx.uid,40,3600);
  const uid=str(ctx.body.uid)||ctx.uid;await allowed(ctx,uid,true);
  const educationId=str(ctx.body.educationId),mime=str(ctx.body.mime),type=str(ctx.body.documentType);
  const raw=str(ctx.body.data),name=str(ctx.body.name).replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,160)||'Qualification evidence';
  const format=FORMATS[mime];
  if(!QUAL_ID.test(educationId)||!TYPES.includes(type)||!format)
   throw new HttpError(400,'Choose a saved qualification and PDF or image document.');
  if(!raw||raw.length>11_000_000||!/^[A-Za-z0-9+/=]+$/.test(raw))
   throw new HttpError(413,'Document exceeds the upload limit.');
  const bytes=Buffer.from(raw,'base64');
  if(!bytes.length||bytes.length>format.max)
   throw new HttpError(413,'Document exceeds its file-type size limit.');
  if(!documentFileSignatureValid(bytes,mime))
   throw new HttpError(400,'File contents do not match the selected document type.');
  const record=await getDoc('organizations/'+ctx.orgId+'/hr_private/'+uid);
  const qualifications=Array.isArray(record?.data.education)?record.data.education.filter(isObj):[];
  const qualification=qualifications.find(q=>str(q.id)===educationId);
  if(!qualification)
   throw new HttpError(409,'Save the qualification before attaching documents.');
  const existing=await listDocs(dir(ctx.orgId,uid));
  if(existing.length>=150||existing.filter(x=>str(x.data.educationId)===educationId).length>=20)
   throw new HttpError(409,'Document limit reached for this employee or qualification.');
  const id=randomId(12);
  const storagePath='organizations/'+ctx.orgId+'/hr_evidence/'+uid+'/'+id+'.'+format.ext;
  const [saved]=await storage.writeImmutable([{path:storagePath,content:raw,contentType:mime}]);
  if(!saved)throw new HttpError(502,'Could not store the document securely.');
  const info={employeeUid:uid,educationId,documentType:type,name,qualificationName:str(qualification.qualification),qualificationField:str(qualification.field),mime,size:bytes.length,
   sha256:createHash('sha256').update(bytes).digest('hex'),status:'pending',
   uploadedBy:ctx.uid,uploadedAt:nowIso(),storagePath,reviewedBy:'',reviewedAt:'',reviewNote:''};
  const committed=await commitChecked([
   {path:meta(ctx.orgId,uid,id),data:info,precondition:{exists:false}},
   {path:queue(ctx.orgId)+'/'+id,data:{...info,id},precondition:{exists:false}}
  ]);
  if(!committed)throw new HttpError(409,'Evidence registration failed. Retry this upload.');
  await auditEvidence(ctx,'hr.evidence.uploaded',id,uid+' · '+type+' · pending HR verification');
  return {file:mapOut({id,data:info})};
 })],
 'POST /api/org/hr/evidence/open':[orgRoute('hr.evidence.open','HRM.shell.view',async ctx=>{
  await rateLimit('hr-evidence-open',ctx.uid,120,3600);
  const uid=str(ctx.body.uid)||ctx.uid,id=str(ctx.body.id);
  if(!ID.test(id))throw new HttpError(400,'Select an evidence document.');
  await allowed(ctx,uid);
  const doc=await getDoc(meta(ctx.orgId,uid,id));
  if(!doc)throw new HttpError(404,'Document not found.');
  const mime=str(doc.data.mime),format=FORMATS[mime];
  const path=str(doc.data.storagePath);
  if(!format||path!=='organizations/'+ctx.orgId+'/hr_evidence/'+uid+'/'+id+'.'+format.ext)
   throw new HttpError(409,'Document reference is invalid.');
  const [link]=await storage.url([path]);
  if(!link?.url)throw new HttpError(502,'Document is temporarily unavailable.');
  await auditEvidence(ctx,'hr.evidence.opened',id,uid+' · '+str(doc.data.status));
  return {url:link.url,name:str(doc.data.name),expiresWithinSeconds:900};
 })],
 'POST /api/org/hr/evidence/inbox':[orgRoute('hr.evidence.inbox','HRM.shell.view',async ctx=>{
  if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'HRM.records.verify'))
   throw new HttpError(403,'HR records verifier permission required.');
  const entries=(await listDocs(queue(ctx.orgId)))
   .filter(x=>str(x.data.status)==='pending'&&str(x.data.employeeUid)!==ctx.uid&&str(x.data.uploadedBy)!==ctx.uid);
  const uids=[...new Set(entries.map(x=>str(x.data.employeeUid)))];
  const docs=await Promise.all(uids.map(uid=>person(ctx,uid).catch(()=>null)));
  const people=new Map(docs.filter((x):x is NonNullable<typeof x>=>x!==null).map(x=>[x.id,x]));
  const result=[];
  for(const item of entries){
   const uid=str(item.data.employeeUid),user=people.get(uid);
   if(!user||!(await mayVerify(ctx,user.data)))continue;
   result.push({...mapOut(item),employeeName:
    [str(user.data.firstName),str(user.data.lastName)].filter(Boolean).join(' ')||'Employee'});
   if(result.length>=100)break;
  }
  return {files:result};
 })],
 'POST /api/org/hr/evidence/review':[orgRoute('hr.evidence.review','HRM.shell.view',async ctx=>{
  const uid=str(ctx.body.uid),id=str(ctx.body.id),decision=str(ctx.body.decision);
  const reason=str(ctx.body.reason).trim();
  if(!UID.test(uid)||!ID.test(id)||!['verified','rejected'].includes(decision))
   throw new HttpError(400,'Select a record and valid verification decision.');
  if(ctx.uid===uid)throw new HttpError(403,'You cannot verify your own qualification evidence.');
  const user=await person(ctx,uid);
  if(!(await mayVerify(ctx,user.data)))throw new HttpError(403,'HR verifier permission or organizational scope required.');
  if(decision==='rejected'&&(reason.length<8||reason.length>500))
   throw new HttpError(400,'Enter a rejection reason of 8–500 characters.');
  if(reason.length>500)throw new HttpError(400,'Review notes are limited to 500 characters.');
  const path=meta(ctx.orgId,uid,id),idx=queue(ctx.orgId)+'/'+id;
  const existing=await getDoc(path),q=await getDoc(idx);
  if(!existing||!q||str(existing.data.status)!=='pending'||str(q.data.status)!=='pending')
   throw new HttpError(409,'Only pending evidence can be reviewed.');
  if(str(existing.data.uploadedBy)===ctx.uid)
   throw new HttpError(403,'The uploader cannot independently verify their own submission.');
  const record=await getDoc('organizations/'+ctx.orgId+'/hr_private/'+uid);
  const qualifications=Array.isArray(record?.data.education)?record.data.education.filter(isObj):[];
  if(!qualifications.some(x=>str(x.id)===str(existing.data.educationId)))
   throw new HttpError(409,'Cannot verify a document without its linked qualification.');
  const next={...existing.data,status:decision,reviewedBy:ctx.uid,reviewedAt:nowIso(),reviewNote:reason};
  const committed=await commitChecked([
   {path,data:next,precondition:{updateTime:existing.updateTime}},
   {path:idx,data:{...next,id},precondition:{updateTime:q.updateTime}}
  ]);
  if(!committed)throw new HttpError(409,'Verification changed concurrently. Refresh and retry.');
  await auditEvidence(ctx,'hr.evidence.'+decision,id,uid+' · '+decision+' · '+reason);
  return {file:mapOut({id,data:next})};
 })]
};
