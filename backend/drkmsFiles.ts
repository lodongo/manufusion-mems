/** DRKMS upload quarantine: preserve originals, never expose pending files as approved documents. */
import { createHash } from 'node:crypto';
import { storage } from './platform/sdk';
import { HttpError, getDoc, nowIso, randomId, rateLimit, str, writeDoc } from './core';
import { orgRoute } from './guards';
import { record } from './org';
import {canAt,nodePath,scopeOf} from './access';

const ALLOWED: Record<string,{ext:string,max:number}> = {
  'application/pdf':{ext:'pdf',max:8_000_000},
  'image/png':{ext:'png',max:8_000_000},
  'image/jpeg':{ext:'jpg',max:8_000_000},
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':{ext:'docx',max:8_000_000},
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':{ext:'xlsx',max:8_000_000},
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':{ext:'pptx',max:8_000_000},
};
const ID=/^[a-f0-9]{20}$/;
export function documentFileSignatureValid(bytes:Buffer,mime:string):boolean{
  if(mime==='application/pdf')return bytes.length>4&&bytes.toString('latin1',0,5)==='%PDF-';
  if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(mime==='image/jpeg')return bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(mime.includes('openxmlformats-officedocument'))return bytes.length>4&&bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4;
  return false;
}
export const drkmsFileRoutes={
  'POST /api/org/drkms/files/stage':[
    orgRoute('drkms.files.stage','ADM.document_registry',async ctx=>{
      await rateLimit('drkms-file-stage',ctx.uid,30,3600);
      const docId=str(ctx.body.documentId),mime=str(ctx.body.mime),name=str(ctx.body.name);
      const spec=ALLOWED[mime];
      if(!ID.test(docId)||!spec||!name||name.length>180)throw new HttpError(400,'Invalid document or file type.');
      const doc=await getDoc(`organizations/${ctx.orgId}/drkms_documents/${docId}`);
      if(!doc||str(doc.data.status)!=='draft')throw new HttpError(409,'Only existing draft documents can receive staging uploads.');
      if(str(doc.data.createdBy)!==ctx.uid&&ctx.role!=='org_super_admin')throw new HttpError(403,'Only the document owner may stage source files.');
      const stageLocation=doc.data.scope&&typeof doc.data.scope==='object'&&!Array.isArray(doc.data.scope)
        ?str((doc.data.scope as Record<string,unknown>).nodeId):'';
      if(!stageLocation||!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,stageLocation),await scopeOf(ctx)))
        throw new HttpError(403,'Source staging is outside your current organizational permissions.');
      const raw=str(ctx.body.data);
      if(!raw||raw.length>11_000_000||!/^[A-Za-z0-9+/=]+$/.test(raw))throw new HttpError(413,'File exceeds the upload limit.');
      const bytes=Buffer.from(raw,'base64');
      if(!bytes.length||bytes.length>spec.max)throw new HttpError(413,'File exceeds its type limit.');
      if(!documentFileSignatureValid(bytes,mime))throw new HttpError(400,'File does not match its declared format.');
      const fileId=randomId(10);
      const path=`organizations/${ctx.orgId}/drkms_quarantine/${docId}/${fileId}.${spec.ext}`;
      const sha256=createHash('sha256').update(bytes).digest('hex');
      const [written]=await storage.write([{path,content:raw,contentType:mime}]);
      if(!written)throw new HttpError(502,'Could not preserve the source file.');
      const metadata={fileId,documentId:docId,tenantId:ctx.orgId,storagePath:path,
        name:name.replace(/[<>\\\u0000-\u001f]/g,'').trim(),mime,bytes:bytes.length,sha256,
        uploadedBy:ctx.uid,uploadedAt:nowIso(),scanStatus:'pending',availability:'quarantined'};
      await writeDoc(`organizations/${ctx.orgId}/drkms_documents/${docId}/files/${fileId}`,metadata,{exists:false});
      await record(ctx,'drkms.file.quarantined',docId,'Unscanned original staged');
      return {fileId,documentId:docId,name:metadata.name,sha256,scanStatus:'pending'};
    }),
  ],
  'POST /api/org/drkms/files/list':[
    orgRoute('drkms.files.list','ADM.document_registry',async ctx=>{
      const docId=str(ctx.body.documentId);
      if(!ID.test(docId))throw new HttpError(400,'Invalid document identifier.');
      const doc=await getDoc(`organizations/${ctx.orgId}/drkms_documents/${docId}`);
      if(!doc)throw new HttpError(404,'Document not found.');
      if(str(doc.data.createdBy)!==ctx.uid&&ctx.role!=='org_super_admin')throw new HttpError(403,'Only the document owner may inspect staged files.');
      const fileLocation=doc.data.scope&&typeof doc.data.scope==='object'&&!Array.isArray(doc.data.scope)
        ?str((doc.data.scope as Record<string,unknown>).nodeId):'';
      if(!fileLocation||!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,fileLocation),await scopeOf(ctx)))
        throw new HttpError(403,'Source file metadata is outside your current organizational permissions.');
      const {listDocs}=await import('./core');
      const entries=await listDocs(`organizations/${ctx.orgId}/drkms_documents/${docId}/files`);
      return {files:entries.map(f=>({id:f.id,name:f.data.name,mime:f.data.mime,bytes:f.data.bytes,scanStatus:f.data.scanStatus,uploadedAt:f.data.uploadedAt}))};
    }),
  ],
};
