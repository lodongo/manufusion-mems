/** Evidence manifest for equipment troubleshooting. Retrieval only: no AI inference or work execution. */
import {HttpError,getDoc,isObj,listDocs,str} from './core';
import {orgRoute} from './guards';
import {canAt,nodePath,scopeOf} from './access';
import {rankEvidence,type EvidenceHit} from './drkmsEvidenceSearch';

const MAX=75;
export const drkmsTroubleshootingRoutes={
 'POST /api/org/drkms/troubleshoot/search':[
  orgRoute('drkms.troubleshoot.search','MNT.view',async ctx=>{
   const assetTag=str(ctx.body.assetTag),query=str(ctx.body.query).trim();
   if(!/^AST-[0-9]{6}$/.test(assetTag)||query.length<2||query.length>200)
    throw new HttpError(400,'Choose an asset and a search of 2–200 characters.');
   const asset=await getDoc(`organizations/${ctx.orgId}/assets/${assetTag}`);
   if(!asset||str(asset.data.status)==='disposed')throw new HttpError(404,'Equipment asset not found.');
   const location=str(asset.data.nodeId),scope=await scopeOf(ctx);
   if(!location||!canAt(ctx,'MNT.view',await nodePath(ctx.orgId,location),scope))
    throw new HttpError(403,'Maintenance access to this equipment is required.');
   const [orders,requests,docs]=await Promise.all([
    listDocs(`organizations/${ctx.orgId}/work_orders`),
    listDocs(`organizations/${ctx.orgId}/work_requests`),
    listDocs(`organizations/${ctx.orgId}/drkms_documents`),
   ]);
   const matching=(d:{data:Record<string,unknown>})=>str(d.data.assetTag)===assetTag||
     (!!str(asset.data.workCenterId)&&str(d.data.unitId)===str(asset.data.workCenterId));
   const entries:Omit<EvidenceHit,'score'>[]=[];
   for(const [collection,kind] of [[orders,'work_order'],[requests,'work_request']] as const){
    for(const d of collection.filter(matching).slice(0,250)){
     entries.push({sourceType:kind,sourceId:d.id,title:str(d.data.title),
       excerpt:[str(d.data.description),str(d.data.failureModeLabel),str(d.data.status)].join(' ').slice(0,900),
       reference:kind+':'+d.id});
    }
   }
   const assetAncestry=await nodePath(ctx.orgId,location);
   for(const d of docs){
    if(str(d.data.status)!=='effective'||!str(d.data.effectiveRevisionId))continue;
    const applied=isObj(d.data.scope)?str(d.data.scope.nodeId):'';
    if(!applied||!assetAncestry.includes(applied)||
       !canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,applied),scope))continue;
    const rev=await getDoc(`organizations/${ctx.orgId}/drkms_documents/${d.id}/revisions/${str(d.data.effectiveRevisionId)}`);
    if(!rev||rev.data.immutable!==true||str(rev.data.status)!=='effective')continue;
    const links=await listDocs(`organizations/${ctx.orgId}/drkms_documents/${d.id}/technical_links`);
    if(!links.some(l=>str(l.data.targetType)==='asset'&&str(l.data.targetId)===assetTag||
      str(l.data.targetType)==='work_center'&&str(l.data.targetId)===str(asset.data.workCenterId)))continue;
    entries.push({sourceType:'controlled_document',sourceId:d.id,title:str(d.data.title),
      excerpt:[str(d.data.classCode),str(d.data.subtypeCode)].join(' '),
      revisionId:rev.id,reference:'document:'+d.id+':'+rev.id});
   }
   return {assetTag,query,hits:rankEvidence(query,entries),
     searchMode:'verified_metadata_and_history',semanticSearchEnabled:false,ocrEnabled:false,
     limitations:['Manual page content is not yet extracted or indexed.','Search results are source references, not AI diagnoses.']};
  }),
 ],

 'POST /api/org/drkms/troubleshoot/context':[
  orgRoute('drkms.troubleshoot.context','MNT.view',async ctx=>{
   const assetTag=str(ctx.body.assetTag);
   if(!/^AST-[0-9]{6}$/.test(assetTag))throw new HttpError(400,'Choose a registered equipment asset.');
   const asset=await getDoc(`organizations/${ctx.orgId}/assets/${assetTag}`);
   if(!asset||str(asset.data.status)==='disposed')throw new HttpError(404,'Equipment asset not found.');
   const location=str(asset.data.nodeId);
   if(!location||!canAt(ctx,'MNT.view',await nodePath(ctx.orgId,location),await scopeOf(ctx)))
     throw new HttpError(403,'You cannot troubleshoot this asset at this location.');
   const [orders,requests,documents]=await Promise.all([
    listDocs(`organizations/${ctx.orgId}/work_orders`),
    listDocs(`organizations/${ctx.orgId}/work_requests`),
    listDocs(`organizations/${ctx.orgId}/drkms_documents`),
   ]);
   const history=[...orders.map(d=>({d,kind:'work_order'})),...requests.map(d=>({d,kind:'work_request'}))]
    .filter(x=>str(x.d.data.assetTag)===assetTag||!!str(asset.data.workCenterId)&&str(x.d.data.unitId)===str(asset.data.workCenterId))
    .sort((a,b)=>str(b.d.data.updatedAt).localeCompare(str(a.d.data.updatedAt))).slice(0,MAX)
    .map(x=>({sourceType:x.kind,sourceId:x.d.id,title:str(x.d.data.title),
      status:str(x.d.data.status),failureModeCode:str(x.d.data.failureModeCode),
      updatedAt:str(x.d.data.updatedAt),evidenceRef:x.kind+':'+x.d.id}));
   const references=[] as Array<{sourceType:string;sourceId:string;title:string;subtypeCode:string;revision:string;evidenceRef:string}>;
   const assetPath=await nodePath(ctx.orgId,location);
   for(const d of documents){
    if(str(d.data.status)!=='effective'||!str(d.data.effectiveRevisionId))continue;
    const applied=isObj(d.data.scope)?str(d.data.scope.nodeId):'';
    if(!applied||!assetPath.includes(applied)||!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,applied),await scopeOf(ctx)))continue;
    const links=await listDocs(`organizations/${ctx.orgId}/drkms_documents/${d.id}/technical_links`);
    if(!links.some(l=>str(l.data.targetType)==='asset'&&str(l.data.targetId)===assetTag||
      str(l.data.targetType)==='work_center'&&str(l.data.targetId)===str(asset.data.workCenterId)))continue;
    references.push({sourceType:'controlled_document',sourceId:d.id,title:str(d.data.title),
      subtypeCode:str(d.data.subtypeCode),revision:str(d.data.effectiveRevisionId),evidenceRef:'document:'+d.id});
    if(references.length>=MAX)break;
   }
   return {asset:{tag:assetTag,name:str(asset.data.name),classCode:str(asset.data.classCode),
      equipmentId:str(asset.data.workCenterId)},history,references,
      retrievalStatus:'metadata_only',aiAdviceEnabled:false,
      limitations:['No manual page extraction or semantic search is connected.',
        'Only directly linked effective document metadata is included; model inheritance and assembly/BOM data require indexed expansion.',
        'Maintenance history is a bounded listing, not a full evidence or trend analysis.']};
  }),
 ],
};
