import {createHash} from 'node:crypto';
import {getDoc,listDocs,writeDoc,HttpError,nowIso,str,isObj,type Obj} from './core';
import type {OrgContext} from './guards';
import {audit} from './audit';
import {genericTaskForSite,verifyCatalogueReferences} from './maintenanceTaskCatalogue';
import {taskRequirementDefaults} from './maintenanceTaskDeliverables';
import type {CatalogueReference} from './maintenanceTaskAssessment';
const norm=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
async function context(ctx:OrgContext,siteId:string,b:Record<string,unknown>){
 const r=isObj(b.reference)?b.reference:undefined,cls=str(b.classCode).trim();let base:Obj|undefined;
 if(r){const ref={releaseId:str(r.releaseId),taskCode:str(r.taskCode),familyCode:str(r.familyCode),categoryCode:str(r.categoryCode),subcategoryCode:str(r.subcategoryCode),version:Number(r.version)} as CatalogueReference;await verifyCatalogueReferences(ctx,siteId,[ref],[]);if(ref.taskCode)base=await genericTaskForSite(ctx,siteId,ref.releaseId,ref.taskCode);}
 const family=str(r?.familyCode);if(!family&&!/^[A-Za-z0-9_.-]{1,120}$/.test(cls))throw new HttpError(400,'Select a generic task family or service class.');
 const group=family?'task-family:'+family:'service-class:'+cls,col='organizations/'+ctx.orgId+'/service_requirement_library/'+digest(group)+'/items';
 const defaults=base?taskRequirementDefaults(base):{expectedOutcomes:[],requiredCertifications:['Evidence of minimum qualification and competency for the assigned trade or role']};
 return {group,col,defaults:{deliverables:defaults.expectedOutcomes,certifications:defaults.requiredCertifications}};
}
export async function serviceRequirementLibrary(ctx:OrgContext,siteId:string,b:Record<string,unknown>){
 const c=await context(ctx,siteId,b),docs=await listDocs(c.col),suggestions={deliverables:[] as string[],certifications:[] as string[]};
 for(const d of docs){const kind=str(d.data.kind),value=str(d.data.value);if((kind==='deliverables'||kind==='certifications')&&value)suggestions[kind].push(value);}
 for(const kind of ['deliverables','certifications'] as const)suggestions[kind]=[...new Set([...c.defaults[kind],...suggestions[kind]])].sort((a,b)=>a.localeCompare(b));
 return {defaults:c.defaults,suggestions};
}
export async function addServiceRequirement(ctx:OrgContext,siteId:string,b:Record<string,unknown>){
 const c=await context(ctx,siteId,b),kind=str(b.kind),value=str(b.value).trim();
 if(!['deliverables','certifications'].includes(kind)||!value||value.length>500)throw new HttpError(400,'Enter an individual deliverable or certification (1–500 characters).');
 const path=c.col+'/'+digest(kind+'|'+norm(value));
 if(!await getDoc(path)){const created=await writeDoc(path,{group:c.group,kind,value,createdAt:nowIso(),createdBy:ctx.uid},{exists:false});if(created)await audit([{category:'maintenance',action:'service_requirement_library.add',actor:ctx.actor,meta:ctx.meta,target:{label:c.group},details:kind+': '+value,orgId:ctx.orgId}]);else if(!await getDoc(path))throw new HttpError(409,'Unable to save requirement. Retry.');}
 return {ok:true};
}
