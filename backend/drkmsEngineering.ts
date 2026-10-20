/** Controlled links from DRKMS documents to the canonical AST register and organization structure. */
import { HttpError, getDoc, isObj, listDocs, nowIso, str, writeDoc } from './core';
import { orgRoute } from './guards';
import { scopeOf, canAt, nodePath } from './access';
import { record } from './org';
import { ENGINEERING_DOC_TYPES, ENGINEERING_DOC_TYPE_CODES } from './drkmsEngineeringTypes';

const docPath=(orgId:string,id:string)=>`organizations/${orgId}/drkms_documents/${id}`;
const DOC=/^[a-f0-9]{20}$/;
const ASSET=/^AST-[0-9]{6}$/;
const STRUCT_LEVELS=new Set(['work_center','assembly','subassembly']);
const targetPath=(orgId:string,type:string,id:string)=>type==='asset'
 ?`organizations/${orgId}/assets/${id}`
 :`organizations/${orgId}/structure/${id}`;
async function resolveTechnicalTarget(orgId:string,type:string,id:string){
 if(type!=='asset'&&!STRUCT_LEVELS.has(type))throw new HttpError(400,'Unsupported technical target.');
 if(type==='asset'&&!ASSET.test(id))throw new HttpError(400,'Invalid asset identifier.');
 if(type!=='asset'&&!/^[A-Za-z0-9_-]{2,180}$/.test(id))throw new HttpError(400,'Invalid structure identifier.');
 const target=await getDoc(targetPath(orgId,type,id));
 if(!target||str(target.data.status)==='inactive'||str(target.data.status)==='disposed')throw new HttpError(404,'Active technical target not found.');
 if(type!=='asset'&&str(target.data.level)!==type)throw new HttpError(400,'Location is not the selected technical level.');
 const nodeId=type==='asset'?str(target.data.nodeId):target.id;
 if(!nodeId)throw new HttpError(409,'Technical target has no organization location.');
 return {target,nodeId};
}
export const drkmsEngineeringRoutes={
 'POST /api/org/drkms/engineering/types':[
  orgRoute('drkms.engineering.types','ADM.document_registry',async()=>({types:ENGINEERING_DOC_TYPES})),
 ],
 'POST /api/org/drkms/engineering/targets':[
  orgRoute('drkms.engineering.targets','ADM.document_registry',async ctx=>{
    const scope=await scopeOf(ctx);
    const [assets,nodes]=await Promise.all([
      listDocs(`organizations/${ctx.orgId}/assets`),
      listDocs(`organizations/${ctx.orgId}/structure`),
    ]);
    const results=[] as Array<{type:string;id:string;name:string;code:string;level:string}>;
    for(const item of nodes){
      const level=str(item.data.level);
      if(!STRUCT_LEVELS.has(level)||str(item.data.status)==='inactive')continue;
      const path=await nodePath(ctx.orgId,item.id);
      if(canAt(ctx,'ADM.document_registry',path,scope)) results.push({type:level,id:item.id,name:str(item.data.name),code:str(item.data.code),level});
    }
    for(const asset of assets){
      const nodeId=str(asset.data.nodeId);
      if(!ASSET.test(asset.id)||!nodeId||str(asset.data.status)==='disposed')continue;
      if(canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,nodeId),scope))
        results.push({type:'asset',id:asset.id,name:str(asset.data.name),code:asset.id,level:'asset'});
    }
    return {targets:results};
  }),
 ],
 'POST /api/org/drkms/engineering/link':[
  orgRoute('drkms.engineering.link','ADM.document_registry',async ctx=>{
    const id=str(ctx.body.documentId),type=str(ctx.body.targetType),targetId=str(ctx.body.targetId),subtype=str(ctx.body.subtypeCode);
    if(!DOC.test(id)||!ENGINEERING_DOC_TYPE_CODES.has(subtype))throw new HttpError(400,'Invalid document or technical classification.');
    const doc=await getDoc(docPath(ctx.orgId,id));
    if(!doc)throw new HttpError(404,'Document not found.');
    if(str(doc.data.status)!=='draft')throw new HttpError(409,'Technical links can currently be created only for drafts.');
    if(str(doc.data.createdBy)!==ctx.uid&&ctx.role!=='org_super_admin')throw new HttpError(403,'Only the document author can link a draft.');
    const typeDef=ENGINEERING_DOC_TYPES.find(t=>t.code===subtype)!;
    if(str(doc.data.classCode)!==typeDef.parentClass)throw new HttpError(409,'Technical subtype does not match the document class.');
    const {target,nodeId}=await resolveTechnicalTarget(ctx.orgId,type,targetId);
    const scope=await scopeOf(ctx);
    const path=await nodePath(ctx.orgId,nodeId);
    if(!canAt(ctx,'ADM.document_registry',path,scope))throw new HttpError(403,'No document access at the technical target location.');
    const documentScope=isObj(doc.data.scope)?doc.data.scope:{};
    const ancestors=Array.isArray(documentScope.ancestorIds)?documentScope.ancestorIds.map(str):[];
    if(!path.includes(str(documentScope.nodeId)))throw new HttpError(403,'Equipment is outside this document’s applicable organizational hierarchy.');
    const key=`${type}_${targetId}`;
    const link={documentId:id,subtypeCode:subtype,targetType:type,targetId,orgId:ctx.orgId,
       targetName:str(target.data.name),linkedBy:ctx.uid,linkedAt:nowIso(),status:'draft'};
    const created=await writeDoc(`${docPath(ctx.orgId,id)}/technical_links/${key}`,link,{exists:false});
    if(!created)throw new HttpError(409,'This document is already linked to the selected technical target.');
    await record(ctx,'drkms.engineering.link',id,`${subtype} -> ${type}:${targetId}`);
    return {link};
  }),
 ],
 'POST /api/org/drkms/engineering/dossier':[
  orgRoute('drkms.engineering.dossier','ADM.document_registry',async ctx=>{
    const type=str(ctx.body.targetType),targetId=str(ctx.body.targetId);
    const {nodeId}=await resolveTechnicalTarget(ctx.orgId,type,targetId);
    if(!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,nodeId),await scopeOf(ctx)))
      throw new HttpError(403,'No access to this technical dossier.');
    // A tenant-scoped scan of document metadata; limits avoid unbounded materialization.
    const docs=await listDocs(`organizations/${ctx.orgId}/drkms_documents`);
    const visible=[] as Array<{documentId:string;title:string;classCode:string;subtypeCode:string;status:string}>;
    for(const doc of docs){
      const links=await listDocs(`${docPath(ctx.orgId,doc.id)}/technical_links`);
      for(const link of links){
        if(str(link.data.targetType)===type&&str(link.data.targetId)===targetId){
          visible.push({documentId:doc.id,title:str(doc.data.title),classCode:str(doc.data.classCode),
            subtypeCode:str(link.data.subtypeCode),status:str(doc.data.status)});
        }
      }
    }
    return {documents:visible,publicationEnabled:false};
  }),
 ],
};
