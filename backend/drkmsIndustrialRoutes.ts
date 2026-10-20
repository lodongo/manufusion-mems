/** Controlled asset-to-automation knowledge bindings; no direct OT connections. */
import {HttpError,getDoc,isObj,listDocs,nowIso,randomId,str,writeDoc} from './core';
import {orgRoute} from './guards';
import {canAt,nodePath,scopeOf} from './access';
import {validIndustrialKnowledge,type IndustrialKnowledgeRecord} from './drkmsIndustrialKnowledge';
import {record} from './org';
const assets=(org:string,id:string)=>`organizations/${org}/assets/${id}`;
const docs=(org:string,id:string)=>`organizations/${org}/drkms_documents/${id}`;
const ROOT=(org:string)=>`organizations/${org}/drkms_industrial_knowledge`;
export const drkmsIndustrialRoutes={
 'POST /api/org/drkms/industrial/link':[
  orgRoute('drkms.industrial.link','ADM.document_config',async ctx=>{
   const input=ctx.body.record as IndustrialKnowledgeRecord;
   if(!validIndustrialKnowledge(input))throw new HttpError(400,'Invalid industrial knowledge metadata or read-only safety boundary.');
   const [asset,doc,revision]=await Promise.all([
    getDoc(assets(ctx.orgId,input.assetTag)),
    getDoc(docs(ctx.orgId,input.sourceDocumentId)),
    getDoc(docs(ctx.orgId,input.sourceDocumentId)+'/revisions/'+input.sourceRevisionId),
   ]);
   if(!asset||str(asset.data.status)==='disposed')throw new HttpError(404,'Equipment asset not found.');
   const nodeId=str(asset.data.nodeId);
   if(!nodeId||!canAt(ctx,'ADM.document_config',await nodePath(ctx.orgId,nodeId),await scopeOf(ctx)))
    throw new HttpError(403,'No industrial document mapping authority for this equipment.');
   if(!doc||str(doc.data.status)!=='effective'||str(doc.data.effectiveRevisionId)!==input.sourceRevisionId||
      !revision||revision.data.immutable!==true||str(revision.data.status)!=='effective'||
      str(revision.data.tenantId)!==ctx.orgId||str(revision.data.documentId)!==input.sourceDocumentId)
    throw new HttpError(409,'Only a currently effective, immutable source document can be linked.');
   const docNode=isObj(revision.data.scope)?str(revision.data.scope.nodeId):'';
   if(!docNode||!(await nodePath(ctx.orgId,nodeId)).includes(docNode)||
      !canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,docNode),await scopeOf(ctx)))
    throw new HttpError(403,'Source documentation does not apply to this equipment or user.');
   const id=randomId(10),createdAt=nowIso();
   const entry={...input,id,tenantId:ctx.orgId,createdAt,createdBy:ctx.uid,reviewStatus:'awaiting_technical_review'};
   if(!(await writeDoc(ROOT(ctx.orgId)+'/'+id,entry,{exists:false})))
    throw new HttpError(409,'Could not register the documentation link.');
   await record(ctx,'drkms.industrial.link',id,input.kind);
   return {id,status:'awaiting_technical_review',aiControlEnabled:false};
  }),
 ],
 'POST /api/org/drkms/industrial/list':[
  orgRoute('drkms.industrial.list','MNT.view',async ctx=>{
   const assetTag=str(ctx.body.assetTag);
   if(!/^AST-[0-9]{6}$/.test(assetTag))throw new HttpError(400,'Choose a valid asset.');
   const asset=await getDoc(assets(ctx.orgId,assetTag));
   if(!asset||str(asset.data.status)==='disposed')throw new HttpError(404,'Asset not found.');
   const nodeId=str(asset.data.nodeId),access=await scopeOf(ctx);
   if(!nodeId||!canAt(ctx,'MNT.view',await nodePath(ctx.orgId,nodeId),access))
    throw new HttpError(403,'Equipment access denied.');
   const rows=await listDocs(ROOT(ctx.orgId)),results=[];
   for(const row of rows){
    if(str(row.data.assetTag)!==assetTag||str(row.data.reviewStatus)!=='approved')continue;
    const documentId=str(row.data.sourceDocumentId),revisionId=str(row.data.sourceRevisionId);
    const doc=await getDoc(docs(ctx.orgId,documentId));
    if(!doc||str(doc.data.status)!=='effective'||str(doc.data.effectiveRevisionId)!==revisionId)continue;
    const revision=await getDoc(docs(ctx.orgId,documentId)+'/revisions/'+revisionId);
    const applied=isObj(revision?.data.scope)?str(revision.data.scope.nodeId):'';
    if(!revision||revision.data.immutable!==true||str(revision.data.tenantId)!==ctx.orgId||
       !applied||!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,applied),access))continue;
    results.push({id:row.id,kind:str(row.data.kind),title:str(row.data.title),
      technology:str(row.data.technology),utilityKind:str(row.data.utilityKind),
      sourceDocumentId:documentId,sourceRevisionId:revisionId,accessMode:'read_only'});
   }
   return {assetTag,records:results,aiControlEnabled:false,liveTelemetryConnected:false};
  }),
 ],
};
