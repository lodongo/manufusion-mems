/** DRKMS upload quarantine: preserve originals, never expose pending files as approved documents. */
import { createHash } from 'node:crypto';
import { storage } from './platform/sdk';
import { HttpError, getDoc, nowIso, randomId, rateLimit, str, writeDoc } from './core';
import { orgRoute } from './guards';
import { record } from './org';
import {canAt,nodePath,scopeOf} from './access';
import {bypassFields,fileReleased,scanPolicy} from './drkmsScanPolicy';
import {listDocs,deleteDoc} from './core';

const MAX_FILES=50;
const docPath=(org:string,id:string)=>`organizations/${org}/drkms_documents/${id}`;
const scopeNode=(d:Record<string,unknown>)=>d.scope&&typeof d.scope==='object'&&!Array.isArray(d.scope)?str((d.scope as Record<string,unknown>).nodeId):'';
/** Author of a draft at a location where they still hold the registry right. */
async function authorDraft(ctx:Parameters<typeof canAt>[0]&{orgId:string;uid:string;role:string},docId:string,what:string){
  if(!ID.test(docId))throw new HttpError(400,'Invalid document identifier.');
  const doc=await getDoc(docPath(ctx.orgId,docId));
  if(!doc||str(doc.data.status)!=='draft')throw new HttpError(409,`Only draft documents can ${what}.`);
  if(str(doc.data.createdBy)!==ctx.uid&&ctx.role!=='org_super_admin')throw new HttpError(403,'Only the document author can do this.');
  const node=scopeNode(doc.data);
  if(!node||!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,node),await scopeOf(ctx)))throw new HttpError(403,'This document is outside your current organizational permissions.');
  return doc;
}

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
      const existing=await listDocs(`organizations/${ctx.orgId}/drkms_documents/${docId}/files`);
      if(existing.length>=MAX_FILES)throw new HttpError(409,`A document can hold at most ${MAX_FILES} source files.`);
      const policy=await scanPolicy();
      const fileId=randomId(10);
      const path=`organizations/${ctx.orgId}/drkms_quarantine/${docId}/${fileId}.${spec.ext}`;
      const sha256=createHash('sha256').update(bytes).digest('hex');
      const [written]=await storage.writeImmutable([{path,content:raw,contentType:mime}]);
      if(!written)throw new HttpError(502,'Could not preserve the source file.');
      const metadata={fileId,documentId:docId,tenantId:ctx.orgId,storagePath:path,
        name:name.replace(/[<>\\\u0000-\u001f]/g,'').trim(),mime,bytes:bytes.length,sha256,
        uploadedBy:ctx.uid,uploadedAt:nowIso(),
        // Scanning on (MEMS Admin): quarantined until the trusted scanner signs a clean verdict.
        // Scanning off: released at once; header check, size limit, hash and immutable private storage still apply.
        ...(policy.enabled?{scanStatus:'pending',availability:'quarantined'}:bypassFields(ctx.uid))};
      await writeDoc(`organizations/${ctx.orgId}/drkms_documents/${docId}/files/${fileId}`,metadata,{exists:false});
      await record(ctx,policy.enabled?'drkms.file.quarantined':'drkms.file.staged_scan_off',docId,policy.enabled?`${metadata.name}: waiting for the malware scan`:`${metadata.name}: released without a malware scan (scanning is off in MEMS Admin) · sha256 ${sha256}`);
      return {fileId,documentId:docId,name:metadata.name,sha256,scanStatus:metadata.scanStatus};
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
      const entries=await listDocs(`organizations/${ctx.orgId}/drkms_documents/${docId}/files`);
      return {files:entries.map(f=>({id:f.id,name:f.data.name,mime:f.data.mime,bytes:f.data.bytes,scanStatus:f.data.scanStatus,uploadedAt:f.data.uploadedAt}))};
    }),
  ],
  // While scanning is off in MEMS Admin, the author may release files that were uploaded while it was on.
  'POST /api/org/drkms/files/release':[
    orgRoute('drkms.files.release','ADM.document_registry',async ctx=>{
      const docId=str(ctx.body.documentId),fileId=str(ctx.body.fileId);
      if(!ID.test(fileId))throw new HttpError(400,'Choose a file of this document.');
      await authorDraft(ctx,docId,'release files');
      if((await scanPolicy()).enabled)throw new HttpError(409,'Malware scanning is on in MEMS Admin: this file is released only by a clean scan.');
      const path=`${docPath(ctx.orgId,docId)}/files/${fileId}`;
      const file=await getDoc(path);
      if(!file||str(file.data.scanStatus)!=='pending'||str(file.data.availability)!=='quarantined')throw new HttpError(409,'Only a file waiting for a scan can be released.');
      if(!(await writeDoc(path,{...file.data,...bypassFields(ctx.uid)},{updateTime:file.updateTime})))throw new HttpError(409,'The file changed at the same time. Refresh and try again.');
      await record(ctx,'drkms.file.released_scan_off',docId,`${str(file.data.name)}: released without a malware scan (scanning is off in MEMS Admin)`);
      return {ok:true};
    }),
  ],
  // The author may take a wrong file off a draft; the stored original stays (immutable) and the removal is kept.
  'POST /api/org/drkms/files/remove':[
    orgRoute('drkms.files.remove','ADM.document_registry',async ctx=>{
      const docId=str(ctx.body.documentId),fileId=str(ctx.body.fileId),reason=str(ctx.body.reason).trim();
      if(!ID.test(fileId))throw new HttpError(400,'Choose a file of this document.');
      if(reason.length<5||reason.length>300)throw new HttpError(400,'Give a reason of 5 to 300 characters.');
      await authorDraft(ctx,docId,'have files removed');
      const path=`${docPath(ctx.orgId,docId)}/files/${fileId}`;
      const file=await getDoc(path);
      if(!file)throw new HttpError(404,'That file is no longer on this document.');
      if(!(await writeDoc(`${docPath(ctx.orgId,docId)}/removed_files/${fileId}`,{...file.data,removedBy:ctx.uid,removedAt:nowIso(),reason},{exists:false})))throw new HttpError(409,'The file was already removed.');
      await deleteDoc(path);
      await record(ctx,'drkms.file.removed',docId,`${str(file.data.name)}: ${reason}`);
      return {ok:true};
    }),
  ],
  // Opening a released source: the author, a reviewer of the submitted document at its location, or an assigned
  // signatory. A short-lived private link only; every opening is audited.
  'POST /api/org/drkms/files/open':[
    orgRoute('drkms.files.open','ADM.document_registry',async ctx=>{
      await rateLimit('drkms-file-open',ctx.uid,120,3600);
      const docId=str(ctx.body.documentId),fileId=str(ctx.body.fileId);
      if(!ID.test(docId)||!ID.test(fileId))throw new HttpError(400,'Choose a file of this document.');
      const doc=await getDoc(docPath(ctx.orgId,docId));
      if(!doc)throw new HttpError(404,'Document not found.');
      const node=scopeNode(doc.data),path=node?await nodePath(ctx.orgId,node):[],scope=await scopeOf(ctx);
      if(!node||!canAt(ctx,'ADM.document_registry',path,scope))throw new HttpError(403,'This document is outside your organizational permissions.');
      const status=str(doc.data.status);
      const author=str(doc.data.createdBy)===ctx.uid;
      const reviewer=['in_review','technical_verified'].includes(status)&&str(doc.data.createdBy)!==ctx.uid&&canAt(ctx,'ADM.document_review',path,scope);
      const signer=(await listDocs(`${docPath(ctx.orgId,docId)}/signature_slots`)).some(s=>str(s.data.signerUid)===ctx.uid);
      if(!author&&!reviewer&&!signer&&ctx.role!=='org_super_admin')throw new HttpError(403,'Only the author, an assigned reviewer or a signatory can open the sources of an unpublished document.');
      const file=await getDoc(`${docPath(ctx.orgId,docId)}/files/${fileId}`);
      if(!file)throw new HttpError(404,'That file is no longer on this document.');
      if(!fileReleased(file.data))throw new HttpError(409,'This file is not released: it is waiting for, or failed, the malware scan.');
      const stored=str(file.data.storagePath);
      if(!stored.startsWith(`organizations/${ctx.orgId}/drkms_quarantine/${docId}/${fileId}.`))throw new HttpError(409,'Unsafe source file reference.');
      const [signed]=await storage.url([stored]);
      if(!signed?.url)throw new HttpError(502,'The file could not be opened. Try again.');
      await record(ctx,'drkms.file.opened',docId,str(file.data.name));
      return {url:signed.url,name:str(file.data.name),mime:str(file.data.mime),expiresWithinSeconds:900};
    }),
  ],
};
