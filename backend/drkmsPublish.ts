/** CoA-bound immutable document publication. Always fail closed without scanned source and reviewed authority. */
import {createHash} from 'node:crypto';
import {HttpError,commitChecked,getDoc,isObj,listDocs,nowIso,str} from './core';
import {orgRoute} from './guards';
import {canAt,nodePath,scopeOf} from './access';
import {validateApprovalEvidence,type ApprovalEvidence} from './unifiedApprovalProof';
import {wiredTransactionInventory} from './transactionRuntime';
import {record} from './org';

const ROOT=(org:string)=>`organizations/${org}/drkms_documents`;
const APPROVAL=(org:string,id:string)=>`organizations/${org}/governance_approvals/${id}`;
const ID=/^[a-f0-9]{20}$/;
const APPROVAL_ID=/^[a-zA-Z0-9_-]{8,128}$/;
export function releaseManifest(documentId:string,revision:string,files:Array<{fileId:string;sha256:string;mime:string;bytes:number}>){
 const normalized=files.map(f=>({fileId:f.fileId,sha256:f.sha256,mime:f.mime,bytes:f.bytes}))
  .sort((a,b)=>a.fileId.localeCompare(b.fileId));
 return createHash('sha256').update(JSON.stringify({documentId,revision,files:normalized})).digest('hex');
}
export function publicationFingerprint(documentId:string,revision:string,
 files:Array<{fileId:string;sha256:string;mime:string;bytes:number}>,
 metadata:{title:string;classCode:string;subtypeCode:string;scopeNodeId:string;verifiedBy:string;verifiedAt:string;updatedAt:string}):string{
 const sources=releaseManifest(documentId,revision,files);
 return createHash('sha256').update(JSON.stringify({documentId,revision,sources,metadata})).digest('hex');
}
export const drkmsPublishRoutes={
 'POST /api/org/drkms/documents/publish':[
  orgRoute('drkms.documents.publish','ADM.document_publish',async ctx=>{
   const documentId=str(ctx.body.documentId),revision=str(ctx.body.revision),
    contentFingerprint=str(ctx.body.contentFingerprint),approvalId=str(ctx.body.governanceApprovalId);
   if(!ID.test(documentId)||!revision||!APPROVAL_ID.test(approvalId)||!/^[a-f0-9]{64}$/.test(contentFingerprint))
    throw new HttpError(400,'Valid revision, approval ID and content fingerprint are mandatory.');
   if(Object.keys(ctx.body).some(k=>!['documentId','revision','contentFingerprint','governanceApprovalId','idToken'].includes(k)))
    throw new HttpError(400,'Unexpected transaction payload fields.');
   const path=`${ROOT(ctx.orgId)}/${documentId}`;
   const doc=await getDoc(path);
   if(!doc||str(doc.data.status)!=='technical_verified'||str(doc.data.revision)!==revision)
    throw new HttpError(409,'An unchanged, independently verified revision is required.');
   if(str(doc.data.createdBy)!==ctx.uid)
    throw new HttpError(403,'Only the original submitter can execute their approved publication.');
   if(!str(doc.data.verifiedBy)||str(doc.data.verifiedBy)===ctx.uid||doc.data.verified!==true)
    throw new HttpError(409,'Independent technical verification is required.');
   const nodeId=isObj(doc.data.scope)?str(doc.data.scope.nodeId):'';
   if(!nodeId||!canAt(ctx,'ADM.document_publish',await nodePath(ctx.orgId,nodeId),await scopeOf(ctx)))
    throw new HttpError(403,'No publication authority at this location.');
   const files=await listDocs(path+'/files');
   if(!files.length||files.length>50)
    throw new HttpError(409,'A controlled source document is required before publication.');
   const sources=files.map(f=>({
    fileId:f.id,sha256:str(f.data.sha256),mime:str(f.data.mime),bytes:Number(f.data.bytes),
    scanStatus:str(f.data.scanStatus),availability:str(f.data.availability),
   }));
   if(sources.some(f=>f.scanStatus!=='clean'||f.availability!=='verified'||!/^[a-f0-9]{64}$/.test(f.sha256)
     ||!Number.isSafeInteger(f.bytes)||f.bytes<=0))
    throw new HttpError(409,'All source files must first pass independent malware scanning and verification.');
   const metadata={
    title:str(doc.data.title),classCode:str(doc.data.classCode),subtypeCode:str(doc.data.subtypeCode),
    scopeNodeId:nodeId,verifiedBy:str(doc.data.verifiedBy),verifiedAt:str(doc.data.verifiedAt),
    updatedAt:str(doc.data.updatedAt),
   };
   const fingerprint=publicationFingerprint(documentId,revision,sources,metadata);
   if(fingerprint!==contentFingerprint)throw new HttpError(409,'Document source changed after approval was requested.');
   const installed=wiredTransactionInventory().filter(r=>r.name==='drkms.documents.publish');
   if(installed.length!==1||!installed[0].code)throw new HttpError(409,'Publication transaction not installed.');
   const code=installed[0].code;
   const [approval,binding,authority]=await Promise.all([
    getDoc(APPROVAL(ctx.orgId,approvalId)),
    getDoc(`organizations/${ctx.orgId}/governance_bindings/${code}`),
    getDoc(`organizations/${ctx.orgId}/governance_authority/${code}`),
   ]);
   const reviewed=(d:typeof binding)=>!!d&&str(d.data.status)==='active'&&
    !!str(d.data.configuredBy)&&!!str(d.data.approvedBy)&&str(d.data.configuredBy)!==str(d.data.approvedBy);
   if(!approval||!reviewed(binding)||!reviewed(authority)||str(binding!.data.classification)!=='approval_required'
      ||str(binding!.data.handlerName)!=='drkms.documents.publish'||
      str(binding!.data.version)!==str(approval.data.bindingVersion)||
      str(authority!.data.version)!==str(approval.data.policyVersion))
    throw new HttpError(403,'Matching independently reviewed publication authority is required.');
   const payload={documentId,revision,contentFingerprint};
   const issues=validateApprovalEvidence(approval.data as unknown as ApprovalEvidence,{
    orgId:ctx.orgId,code,handlerName:'drkms.documents.publish',requesterUid:ctx.uid,payload,
   });
   if(issues.length)throw new HttpError(403,'Approval evidence invalid: '+issues.join('; '));
   for(const vote of (approval.data.votes as Array<{uid?:string}>??[])){
    const user=await getDoc('users/'+str(vote.uid));
    if(!user||str(user.data.orgId)!==ctx.orgId||str(user.data.status)==='disabled')
     throw new HttpError(403,'An approver is no longer eligible.');
   }
   const releasedAt=nowIso();
   const revisionId=createHash('sha256').update(documentId+':'+revision+':'+fingerprint).digest('hex');
   const snapshot={documentId,revisionId,revision,tenantId:ctx.orgId,
    documentFingerprint:fingerprint,sourceFiles:sources.map(({fileId,sha256,mime,bytes})=>({fileId,sha256,mime,bytes})),
    title:str(doc.data.title),classCode:str(doc.data.classCode),subtypeCode:str(doc.data.subtypeCode),
    scope:doc.data.scope,approvedBy:approvalId,verifiedBy:str(doc.data.verifiedBy),
    publishedBy:ctx.uid,publishedAt:releasedAt,status:'effective',immutable:true};
   const saved=await commitChecked([
    {path:path+'/revisions/'+revisionId,data:snapshot,precondition:{exists:false}},
    {path,data:{...doc.data,status:'effective',effectiveRevisionId:revisionId,publishedAt:releasedAt,
      publicationApprovalId:approvalId,updatedAt:releasedAt},precondition:{updateTime:doc.updateTime}},
    {path:APPROVAL(ctx.orgId,approvalId),data:{...approval.data,status:'executed',
      executionBy:ctx.uid,executionCompletedAt:releasedAt},precondition:{updateTime:approval.updateTime}},
   ]);
   if(!saved)throw new HttpError(409,'Document or approval changed. Refresh and obtain a new approval if needed.');
   await record(ctx,'drkms.document.published',documentId,revisionId);
   return {documentId,revisionId,status:'effective'};
  }),
 ],
};
