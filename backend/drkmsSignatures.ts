import {fileReleased} from './drkmsScanPolicy';
/** Authenticated document sign-off, bound to the exact reviewed source fingerprint. */
import {createHash} from 'node:crypto';
import {storage} from './platform/sdk';
import {HttpError,getDoc,listDocs,writeDoc,nowIso,str,commitChecked,rateLimit} from './core';
import {orgRoute} from './guards';
import {canAt,nodePath,scopeOf} from './access';
import {publicationFingerprint} from './drkmsPublish';
import {record} from './org';
const ID=/^[a-f0-9]{20}$/;
const root=(o:string,d:string)=>`organizations/${o}/drkms_documents/${d}`;
const slots=(o:string,d:string)=>root(o,d)+'/signature_slots';
export function validPosition(v:unknown){if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const p=v as Record<string,unknown>;
 return ['page','xPercent','yPercent','widthPercent'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k]))
 &&Number(p.page)>=1&&Number.isInteger(p.page)&&Number(p.page)<=10000
 &&Number(p.xPercent)>=0&&Number(p.xPercent)<=90
 &&Number(p.yPercent)>=0&&Number(p.yPercent)<=90
 &&Number(p.widthPercent)>=10&&Number(p.widthPercent)<=100-Number(p.xPercent);
}
async function fingerprint(orgId:string,documentId:string){
 const path=root(orgId,documentId),doc=await getDoc(path);
 if(!doc||str(doc.data.status)!=='technical_verified'||doc.data.verified!==true)
  throw new HttpError(409,'A technically verified document is required for signing.');
 const files=await listDocs(path+'/files');
 if(!files.length||files.some(f=>!fileReleased(f.data)))
  throw new HttpError(409,'All source files must be released (scanned clean, or released while scanning is off in MEMS Admin).');
 const location=doc.data.scope&&typeof doc.data.scope==='object'?doc.data.scope as Record<string,unknown>:{};
 return {doc,fingerprint:publicationFingerprint(documentId,str(doc.data.revision),files.map(f=>({fileId:f.id,sha256:str(f.data.sha256),mime:str(f.data.mime),bytes:Number(f.data.bytes)})),
 {title:str(doc.data.title),classCode:str(doc.data.classCode),subtypeCode:str(doc.data.subtypeCode),
 scopeNodeId:str(location.nodeId),verifiedBy:str(doc.data.verifiedBy),verifiedAt:str(doc.data.verifiedAt),updatedAt:str(doc.data.updatedAt)})};
}
export const drkmsSignatureRoutes={
 'POST /api/org/drkms/signatures/preview':[
  orgRoute('drkms.signatures.preview',null,async ctx=>{
   await rateLimit('drkms-signer-preview',ctx.uid,50,3600);
   const documentId=str(ctx.body.documentId),slotId=str(ctx.body.slotId);
   if(!ID.test(documentId)||!ID.test(slotId))throw new HttpError(400,'Invalid signing assignment.');
   const slot=await getDoc(slots(ctx.orgId,documentId)+'/'+slotId);
   if(!slot||str(slot.data.signerUid)!==ctx.uid)
    throw new HttpError(403,'Only the assigned document signatory may review this source.');
   const {doc}=await fingerprint(ctx.orgId,documentId);
   const files=await listDocs(root(ctx.orgId,documentId)+'/files');
   const entries=[];
   for(const file of files){
    const stored=str(file.data.storagePath);
    if(!stored.startsWith(`organizations/${ctx.orgId}/drkms_quarantine/${documentId}/${file.id}.`))
     throw new HttpError(409,'Unsafe source file reference.');
    const [signed]=await storage.url([stored]);
    if(!signed?.url)throw new HttpError(502,'Could not open verified source.');
    entries.push({fileId:file.id,name:str(file.data.name),mime:str(file.data.mime),url:signed.url});
   }
   return {documentId,title:str(doc.data.title),revision:str(doc.data.revision),files:entries,expiresWithinSeconds:900};
  }),
 ],
 'POST /api/org/drkms/signatures/my-inbox':[
  orgRoute('drkms.signatures.my_inbox',null,async ctx=>{
   const items=await listDocs(`organizations/${ctx.orgId}/signature_inbox/${ctx.uid}/assignments`);
   const visible=[];
   for(const item of items.slice(0,250)){
    const documentId=str(item.data.documentId),slotId=str(item.data.slotId);
    if(!ID.test(documentId)||!ID.test(slotId))continue;
    const [slot,doc]=await Promise.all([getDoc(slots(ctx.orgId,documentId)+'/'+slotId),getDoc(root(ctx.orgId,documentId))]);
    if(!slot||!doc||str(slot.data.signerUid)!==ctx.uid)continue;
    visible.push({documentId,slotId,label:str(slot.data.label),title:str(doc.data.title),
       documentStatus:str(doc.data.status),signatureStatus:str(slot.data.status),signedAt:str(slot.data.signedAt)});
   }
   return {assignments:visible};
  }),
 ],
 'POST /api/org/drkms/signatures/verify':[
  orgRoute('drkms.signatures.verify',null,async ctx=>{
   const documentId=str(ctx.body.documentId),proof=str(ctx.body.proof);
   if(!ID.test(documentId)||!/^[a-f0-9]{64}$/.test(proof))throw new HttpError(400,'Valid document and verification code required.');
   const path=root(ctx.orgId,documentId),doc=await getDoc(path);
   if(!doc)throw new HttpError(404,'Document not found in your organization.');
   const location=doc.data.scope&&typeof doc.data.scope==='object'?doc.data.scope as Record<string,unknown>:{};
   if(!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,str(location.nodeId)),await scopeOf(ctx)))
    throw new HttpError(403,'Document is outside your organizational access.');
   const revisions=await listDocs(path+'/revisions');
   for(const revision of revisions){
    if(revision.data.immutable!==true||str(revision.data.tenantId)!==ctx.orgId)continue;
    const proofs=Array.isArray(revision.data.signatureProofs)?revision.data.signatureProofs as Array<Record<string,unknown>>:[];
    const match=proofs.find(item=>str(item.proof)===proof);
    if(match)return {authentic:true,documentId,title:str(revision.data.title),revision:str(revision.data.revision),
      revisionId:revision.id,signerUid:str(match.signerUid),label:str(match.label),signedAt:str(match.signedAt),
      currentStatus:str(doc.data.status),isCurrent:str(doc.data.effectiveRevisionId)===revision.id&&str(doc.data.status)==='effective'};
   }
   return {authentic:false,documentId};
  }),
 ],
 'POST /api/org/drkms/signatures/assign':[
  orgRoute('drkms.signatures.assign','ADM.document_registry',async ctx=>{
   const documentId=str(ctx.body.documentId),signerUid=str(ctx.body.signerUid),label=str(ctx.body.label).trim();
   if(!ID.test(documentId)||!/^[a-zA-Z0-9_-]{6,128}$/.test(signerUid)||label.length<3||label.length>80||
    !validPosition(ctx.body.position))throw new HttpError(400,'Specify an authorized signatory, role label and valid page coordinates.');
   const doc=await getDoc(root(ctx.orgId,documentId));
   if(!doc||str(doc.data.status)!=='draft'||str(doc.data.createdBy)!==ctx.uid)
    throw new HttpError(403,'Only the document creator may assign signatures while the document is a draft.');
   const target=await getDoc('users/'+signerUid);
   if(!target||str(target.data.orgId)!==ctx.orgId||str(target.data.status)==='disabled')
    throw new HttpError(403,'Signatory must be an active user of the same organization.');
   const loc=doc.data.scope&&typeof doc.data.scope==='object'?doc.data.scope as Record<string,unknown>:{};
   if(!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,str(loc.nodeId)),await scopeOf(ctx)))
    throw new HttpError(403,'Document is outside your scope.');
   const existing=await listDocs(slots(ctx.orgId,documentId));
   if(existing.length>=20||existing.some(x=>str(x.data.signerUid)===signerUid&&str(x.data.label)===label))
    throw new HttpError(409,'Signatory limit or duplicate signature assignment.');
   const slotId=createHash('sha256').update(signerUid+':'+label).digest('hex').slice(0,20);
   const entry={slotId,signerUid,label,position:ctx.body.position,status:'pending',assignedBy:ctx.uid,assignedAt:nowIso()};
   const inboxPath=`organizations/${ctx.orgId}/signature_inbox/${signerUid}/assignments/${documentId}_${slotId}`;
   if(!(await commitChecked([{path:slots(ctx.orgId,documentId)+'/'+slotId,data:entry,precondition:{exists:false}},
     {path:inboxPath,data:{documentId,slotId,assignedAt:entry.assignedAt},precondition:{exists:false}}])))
    throw new HttpError(409,'Signature assignment already exists or could not be indexed.');
   await record(ctx,'drkms.signatures.assign',documentId,slotId);
   return {slot:entry};
  }),
 ],
 'POST /api/org/drkms/signatures/list':[
  orgRoute('drkms.signatures.list',null,async ctx=>{
   const documentId=str(ctx.body.documentId);
   if(!ID.test(documentId))throw new HttpError(400,'Invalid document.');
   const doc=await getDoc(root(ctx.orgId,documentId));
   if(!doc)throw new HttpError(404,'Document not found.');
   const loc=doc.data.scope&&typeof doc.data.scope==='object'?doc.data.scope as Record<string,unknown>:{};
   const result=await listDocs(slots(ctx.orgId,documentId));
   const authorized=str(doc.data.createdBy)===ctx.uid||result.some(s=>str(s.data.signerUid)===ctx.uid)
     ||canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,str(loc.nodeId)),await scopeOf(ctx));
   if(!authorized)throw new HttpError(403,'Signature assignments are restricted to participants and authorized reviewers.');
   return {slots:result.map(v=>({slotId:v.id,label:v.data.label,signerUid:v.data.signerUid,position:v.data.position,status:v.data.status,signedAt:v.data.signedAt,proof:str(doc.data.status)==='effective'?v.data.proof:undefined}))};
  }),
 ],
 'POST /api/org/drkms/signatures/sign':[
  orgRoute('drkms.signatures.sign',null,async ctx=>{
   const documentId=str(ctx.body.documentId),slotId=str(ctx.body.slotId);
   if(!ID.test(documentId)||!ID.test(slotId)||ctx.body.attest!==true)
    throw new HttpError(400,'Choose assigned signature and explicitly confirm your attestation.');
   const path=slots(ctx.orgId,documentId)+'/'+slotId;
   const slot=await getDoc(path);
   if(!slot||str(slot.data.signerUid)!==ctx.uid||str(slot.data.status)!=='pending')
    throw new HttpError(403,'This signature is not assigned to you or was already completed.');
   const {doc,fingerprint:contentHash}=await fingerprint(ctx.orgId,documentId);
   const signedAt=nowIso();
   const proof=createHash('sha256').update(JSON.stringify({organization:ctx.orgId,documentId,slotId,signer:ctx.uid,contentHash,signedAt})).digest('hex');
   const ok=await commitChecked([{path,data:{...slot.data,status:'signed',signedBy:ctx.uid,signedAt,contentHash,proof,authenticationMethod:'firebase_authenticated_session'},
     precondition:{updateTime:slot.updateTime}}]);
   if(!ok)throw new HttpError(409,'Signature assignment changed. Refresh.');
   await record(ctx,'drkms.signatures.signed',documentId,slotId);
   return {documentId,slotId,signedAt,proof,documentRevision:str(doc.data.revision)};
  }),
 ],
};
