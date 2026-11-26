import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getDoc,writeDoc,nowIso,HttpError} from './core';
import {staff} from './guards';
import {audit} from './audit';

const path='module_masters/PRC_supplier_relationship_evaluation';
const raw=()=>readFileSync(new URL('./supplierRelationshipTemplate.json',import.meta.url),'utf8');
const checksum=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
type Question={question_id:string;question:string;accountability:string;weight_percent:number};
type Category={category_id:string;name:string;weight_percent:number;questions:Question[]};
type Profile={profile_id:string;name:string;categories:Category[]};
export function validateSupplierRelationshipTemplate(json:string){
 const t=JSON.parse(json) as {template_id:string;schema_version:string;evaluation_profiles:Profile[]};
 if(t.template_id!=='SRM-RELATIONSHIP-EVALUATION'||!t.schema_version||!Array.isArray(t.evaluation_profiles))throw new Error('Invalid SRM template');
 const ids=new Set<string>(), profiles=new Set<string>();
 const stats=t.evaluation_profiles.map(p=>{
  if(!p.profile_id||profiles.has(p.profile_id)||!p.name||!Array.isArray(p.categories))throw new Error('Invalid profile');
  profiles.add(p.profile_id);
  let weight=0,count=0;const categories=new Set<string>();
  for(const c of p.categories){
   if(!c.category_id||categories.has(c.category_id)||!c.name||!Array.isArray(c.questions)||!Number.isFinite(c.weight_percent)||c.weight_percent<=0)throw new Error('Invalid category');
   categories.add(c.category_id);let total=0;
   for(const q of c.questions){
    if(!q.question_id||ids.has(q.question_id)||!q.question||!['SUPPLIER','ORGANIZATION','BOTH'].includes(q.accountability)||!Number.isFinite(q.weight_percent)||q.weight_percent<=0)throw new Error('Invalid question');
    ids.add(q.question_id);total+=q.weight_percent;count++;
   }
   if(Math.abs(total-c.weight_percent)>1e-8)throw new Error('Category weights do not reconcile: '+c.category_id);
   weight+=total;
  }
  if(Math.abs(weight-100)>1e-8)throw new Error('Profile does not total 100: '+p.profile_id);
  return {id:p.profile_id,name:p.name,categoryCount:p.categories.length,questionCount:count,weight};
 });
 if(profiles.size!==3||!['PRJ','MAT','SVC'].every(id=>profiles.has(id)))throw new Error('Expected project, material and service profiles');
 return {version:t.schema_version,profiles:stats,questionCount:ids.size,sha256:checksum(json)};
}
async function status(){
 const doc=await getDoc(path);
 if(!doc)return {loaded:false,version:'',profiles:[],questionCount:0,sha256:'',loadedAt:''};
 const json=doc.data.json;
 if(typeof json!=='string')throw new Error('Stored SRM data is missing');
 const stats=validateSupplierRelationshipTemplate(json);
 if(stats.sha256!==doc.data.sha256)throw new Error('Stored SRM checksum mismatch');
 return {loaded:true,...stats,loadedAt:String(doc.data.loadedAt||'')};
}
export async function ensureSupplierRelationshipTemplate(actor='SYSTEM_DEVELOPMENT_SEED'){
 const json=raw(), stats=validateSupplierRelationshipTemplate(json);
 const old=await getDoc(path);
 if(old){
  // Never replace an existing master automatically.
  return status();
 }
 const created=await writeDoc(path,{json,...stats,loadedAt:nowIso(),loadedBy:actor},{exists:false});
 const result=await status();
 if(!result.loaded||(!created&&result.sha256!==stats.sha256)||result.sha256!==stats.sha256)throw new Error('SRM database publication could not be verified');
 return result;
}
export const supplierRelationshipRoutes={
 'POST /api/admin/procurement/srm-template/status':[staff('admin.procurement.srm_template.status','read',async()=>status())],
 'POST /api/admin/procurement/srm-template/publish':[staff('admin.procurement.srm_template.publish','write',async ctx=>{
  const result=await ensureSupplierRelationshipTemplate(ctx.uid);
  await audit([{category:'procurement',action:'srm_template.publish',actor:ctx.actor,meta:ctx.meta,target:{label:result.version},details:String(result.questionCount)+' questions; SHA-256 '+result.sha256}]);
  return result;
 })],
 'POST /api/admin/procurement/srm-template/export':[staff('admin.procurement.srm_template.export','read',async()=>{
  const verified=await status();
  if(!verified.loaded)throw new HttpError(404,'SRM template has not been published.');
  const doc=await getDoc(path);
  if(typeof doc?.data.json!=='string'||checksum(doc.data.json)!==verified.sha256)throw new HttpError(409,'Template changed; retry export.');
  return {json:doc.data.json};
 })]
};
