/** Controlled time-limited download of an immutable, effective DRKMS revision. */
import {storage} from './platform/sdk';
import {HttpError,getDoc,isObj,str,rateLimit} from './core';
import {orgRoute} from './guards';
import {canAt,nodePath,scopeOf} from './access';
const ID=/^[a-f0-9]{20}$/;
const REV=/^[a-f0-9]{64}$/;
export const drkmsReadRoutes={
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
   if(str(file.data.scanStatus)!=='clean'||str(file.data.availability)!=='verified')
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
