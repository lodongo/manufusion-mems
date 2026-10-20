/** SHEQ-owned SDS index: metadata and authoritative HTTPS link, never an unverified proxy download. */
import {HttpError,getDoc,listDocs,nowIso,randomId,str,writeDoc} from './core';
import {orgRoute} from './guards';
import {record} from './org';
import {safeSdsUrl} from './drkmsKnowledgeContracts';

const root=(org:string)=>`organizations/${org}/sheq_sds`;
const idPattern=/^[a-f0-9]{20}$/;
export const drkmsSdsRoutes={
 'POST /api/org/drkms/sds/list':[
  orgRoute('drkms.sds.list','ADM.document_registry',async ctx=>{
   const items=await listDocs(root(ctx.orgId));
   return {items:items.map(d=>({id:d.id,materialCode:d.data.materialCode,chemicalName:d.data.chemicalName,
     manufacturer:d.data.manufacturer,revisionDate:d.data.revisionDate,sourceUrl:d.data.sourceUrl,
     validationStatus:d.data.validationStatus,reviewDue:d.data.reviewDue,siteId:d.data.siteId,
     createdAt:d.data.createdAt}))};
  }),
 ],
 'POST /api/org/drkms/sds/register':[
  orgRoute('drkms.sds.register','ADM.document_config',async ctx=>{
   const materialCode=str(ctx.body.materialCode).trim(),name=str(ctx.body.chemicalName).trim(),
    manufacturer=str(ctx.body.manufacturer).trim(),sourceUrl=str(ctx.body.sourceUrl).trim(),
    revisionDate=str(ctx.body.revisionDate).trim(),reviewDue=str(ctx.body.reviewDue).trim(),
    siteId=str(ctx.body.siteId).trim();
   if(!/^[a-zA-Z0-9_.-]{2,60}$/.test(materialCode)||name.length<3||name.length>180||
     !manufacturer||manufacturer.length>160)throw new HttpError(400,'Material code, chemical and manufacturer required.');
   if(!safeSdsUrl(sourceUrl)||sourceUrl.length>1900)throw new HttpError(400,'Provide an authoritative HTTPS SDS URL.');
   if(!/^\d{4}-\d\d-\d\d$/.test(revisionDate)||!Number.isFinite(Date.parse(revisionDate))||
     (reviewDue&&!/^\d{4}-\d\d-\d\d$/.test(reviewDue)))throw new HttpError(400,'Valid revision and review dates required.');
   if(siteId){
     const location=await getDoc(`organizations/${ctx.orgId}/structure/${siteId}`);
     if(!location||str(location.data.level)!=='site'||str(location.data.status)==='inactive')
       throw new HttpError(400,'Select an active registered site.');
   }
   const id=randomId(10),entry={id,tenantId:ctx.orgId,materialCode,chemicalName:name,manufacturer,
    sourceUrl,revisionDate,reviewDue,siteId,validationStatus:'awaiting_sheq_verification',
    ownerDepartment:'SHEQ',createdBy:ctx.uid,createdAt:nowIso()};
   if(!(await writeDoc(`${root(ctx.orgId)}/${id}`,entry,{exists:false})))throw new HttpError(409,'Identifier conflict.');
   await record(ctx,'drkms.sds.register',id,materialCode);
   return {entry};
  }),
 ],
};
