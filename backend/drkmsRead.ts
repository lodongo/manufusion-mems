import {fileReleased} from './drkmsScanPolicy';
/** Controlled time-limited download of an immutable, effective DRKMS revision. */
import {storage} from './platform/sdk';
import {HttpError,getDoc,isObj,str,rateLimit,listDocs} from './core';
import {orgRoute} from './guards';
import {canAt,nodePath,scopeOf} from './access';
const ID=/^[a-f0-9]{20}$/;
const REV=/^[a-f0-9]{64}$/;
export const drkmsReadRoutes={
 'POST /api/org/drkms/documents/revision-history':[
  orgRoute('drkms.revision_history','ADM.document_registry',async ctx=>{
   const documentId=str(ctx.body.documentId);
   if(!ID.test(documentId))throw new HttpError(400,'Choose a valid document.');
   const root=`organizations/${ctx.orgId}/drkms_documents/${documentId}`;
   const doc=await getDoc(root);
   if(!doc)throw new HttpError(404,'Document not found.');
   const nodeId=isObj(doc.data.scope)?str(doc.data.scope.nodeId):'';
   if(!nodeId||!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,nodeId),await scopeOf(ctx)))
    throw new HttpError(403,'Document is outside your authorized scope.');
   if(!['effective','superseded','withdrawn','archived'].includes(str(doc.data.status)) &&
     str(doc.data.createdBy)!==ctx.uid && ctx.role!=='org_super_admin')
    throw new HttpError(403,'Unpublished revision history is author-restricted.');
   const revisions=await listDocs(root+'/revisions');
   return {documentId,currentStatus:str(doc.data.status),predecessorId:str(doc.data.supersedesDocumentId),
    successorId:str(doc.data.supersededByDocumentId),revisions:revisions.filter(r=>r.data.immutable===true&&str(r.data.tenantId)===ctx.orgId
     &&str(r.data.documentId)===documentId).map(r=>({revisionId:r.id,revision:str(r.data.revision),
      status:str(r.data.status),publishedAt:str(r.data.publishedAt),verifiedBy:str(r.data.verifiedBy),
      publishedBy:str(r.data.publishedBy),fingerprint:str(r.data.documentFingerprint)}))};
  }),
 ],
 'POST /api/org/drkms/documents/effective-files':[
  orgRoute('drkms.effective_files','ADM.document_registry',async ctx=>{
   const documentId=str(ctx.body.documentId);
   if(!ID.test(documentId))throw new HttpError(400,'Select a registered document.');
   const root=`organizations/${ctx.orgId}/drkms_documents/${documentId}`;
   const doc=await getDoc(root);
   const revisionId=str(doc?.data.effectiveRevisionId);
   if(!doc||str(doc.data.status)!=='effective'||!REV.test(revisionId))
    throw new HttpError(404,'No effective document revision.');
   const rev=await getDoc(root+'/revisions/'+revisionId);
   if(!rev||str(rev.data.tenantId)!==ctx.orgId||str(rev.data.documentId)!==documentId||
      str(rev.data.status)!=='effective'||rev.data.immutable!==true)
    throw new HttpError(409,'Controlled revision not verified.');
   const nodeId=isObj(rev.data.scope)?str(rev.data.scope.nodeId):'';
   if(!nodeId||!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,nodeId),await scopeOf(ctx)))
    throw new HttpError(403,'Document is outside your organizational access.');
   const manifest=Array.isArray(rev.data.sourceFiles)?rev.data.sourceFiles.filter(isObj):[];
   const entries=[];
   for(const item of manifest){
    const fileId=str(item.fileId);
    if(!ID.test(fileId))throw new HttpError(409,'Invalid file in controlled revision.');
    const file=await getDoc(root+'/files/'+fileId);
    if(!file||!fileReleased(file.data)
       ||str(file.data.sha256)!==str(item.sha256)||Number(file.data.bytes)!==Number(item.bytes))
      throw new HttpError(409,'A published file has failed validation.');
    entries.push({fileId,name:str(file.data.name),mime:str(item.mime),bytes:Number(item.bytes)});
   }
   return {documentId,revisionId,files:entries};
  }),
 ],

 'POST /api/org/drkms/documents/revision-download':[
  orgRoute('drkms.revision_download','ADM.document_registry',async ctx=>{
   await rateLimit('drkms-revision-read',ctx.uid,90,3600);
   const documentId=str(ctx.body.documentId),revisionId=str(ctx.body.revisionId),fileId=str(ctx.body.fileId);
   if(!ID.test(documentId)||!REV.test(revisionId)||!ID.test(fileId))
    throw new HttpError(400,'Valid controlled revision and file identifiers are required.');
   const root=`organizations/${ctx.orgId}/drkms_documents/${documentId}`;
   const [doc,rev,file]=await Promise.all([
    getDoc(root),getDoc(root+'/revisions/'+revisionId),getDoc(root+'/files/'+fileId),
   ]);
   if(!doc||!rev||!file)throw new HttpError(404,'Approved revision or file not found.');
   if(str(doc.data.status)!=='effective'||str(doc.data.effectiveRevisionId)!==revisionId
     ||str(rev.data.status)!=='effective'||rev.data.immutable!==true)
    throw new HttpError(403,'Only the currently effective controlled revision may be downloaded.');
   if(str(rev.data.tenantId)!==ctx.orgId||str(rev.data.documentId)!==documentId)
    throw new HttpError(403,'Revision tenant or document identity mismatch.');
   const nodeId=isObj(rev.data.scope)?str(rev.data.scope.nodeId):'';
   if(!nodeId||!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,nodeId),await scopeOf(ctx)))
    throw new HttpError(403,'Document is outside your authorized organizational scope.');
   const listed=Array.isArray(rev.data.sourceFiles)?rev.data.sourceFiles.filter(isObj):[];
   const manifest=listed.find(x=>str(x.fileId)===fileId);
   if(!manifest||str(manifest.sha256)!==str(file.data.sha256)
      ||str(manifest.mime)!==str(file.data.mime)||Number(manifest.bytes)!==Number(file.data.bytes))
    throw new HttpError(409,'Source content no longer matches the approved revision.');
   if(!fileReleased(file.data))
    throw new HttpError(403,'Source file has not passed the controlled safety verification.');
   const expectedPrefix=`organizations/${ctx.orgId}/drkms_quarantine/${documentId}/${fileId}.`;
   const sourcePath=str(file.data.storagePath);
   if(!sourcePath.startsWith(expectedPrefix)||!/^[-\w./]+$/.test(sourcePath))
    throw new HttpError(409,'The stored source path is not valid for this document.');
   const [signed]=await storage.url([sourcePath]);
   if(!signed?.url)throw new HttpError(502,'Approved document could not be opened securely.');
   return {url:signed.url,expiresWithinSeconds:900,name:str(file.data.name),
    mime:str(file.data.mime),revisionId,documentId};
  }),
 ],
};
