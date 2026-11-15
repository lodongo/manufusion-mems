/** Development-only maintenance record purge. The tombstone is committed with the physical deletion. */
import {HttpError,getDoc,listDocs,nowIso,str,isObj,type Obj,type Doc} from './core';
import {commit,withLock,type Write} from './finCore';
import {testModeEnvironmentAllowed,testModeActiveFor,clearTestModeCache} from './testModeCore';
import type {OrgContext} from './guards';

export const TEST_MAINTENANCE_COLLECTIONS={order:'work_orders',assessment:'work_assessments',request:'work_requests'} as const;
type Kind=keyof typeof TEST_MAINTENANCE_COLLECTIONS;
const patterns:Record<Kind,RegExp>={order:/^WO\d{8}(?:_[1-9]\d{0,8})?$/,assessment:/^ASSM_\d{8}$/,request:/^WR\d{8}$/};
const row=(v:unknown):Obj=>isObj(v)?v:{};
const asRows=(v:unknown):Obj[]=>Array.isArray(v)?v.filter(isObj):[];
const root=(ctx:OrgContext)=>'organizations/'+ctx.orgId;
export function testDeletionEnabled(ctx:Pick<OrgContext,'role'|'testMode'>){return ctx.role==='org_super_admin'&&ctx.testMode===true&&testModeEnvironmentAllowed();}
export function deletionKind(v:unknown):Kind {if(v==='order'||v==='assessment'||v==='request')return v;throw new HttpError(400,'Choose a maintenance record type.');}
export function deletionCode(kind:Kind,v:unknown){const code=str(v);if(!patterns[kind].test(code))throw new HttpError(400,'Choose a valid maintenance record number.');return code;}
/** Exact reference matching, not substring matching; audit text and attachments are excluded. */
export function hasMaintenanceReference(v:unknown,code:string):boolean{
 if(typeof v==='string')return v===code;
 if(Array.isArray(v))return v.some(x=>hasMaintenanceReference(x,code));
 if(isObj(v))return Object.entries(v).some(([k,x])=>!['history','workflowTransitions','description','note','reason','title','narrative','photos','attachments'].includes(k)&&(k===code||hasMaintenanceReference(x,code)));
 return false;
}
function requireMode(ctx:OrgContext){if(!testDeletionEnabled(ctx))throw new HttpError(403,'Permanent deletion requires active development Test Mode and Organization Super Admin access.');}
const assertVersion=(doc:Doc)=>{if(!doc.updateTime)throw new HttpError(409,'Record version is missing. Refresh and try again.');return doc.updateTime;};
const minimal=(d:Doc,kind:Kind)=>({kind,code:d.id,title:str(d.data.title)||str(row(d.data.sourceRequest).title),status:str(d.data.status),wrCode:str(d.data.wrCode)||str(d.data.workRequestCode),parentWoCode:str(d.data.parentWoCode),rootWoCode:str(d.data.rootWoCode),createdAt:str(d.data.createdAt),unitCode:str(d.data.unitCode)||str(row(d.data.sourceRequest).unitCode)});
export async function listTestMaintenanceDeletion(ctx:OrgContext){
 requireMode(ctx);
 const [orders,assessments,requests,trail]=await Promise.all([...Object.values(TEST_MAINTENANCE_COLLECTIONS).map(c=>listDocs(root(ctx)+'/'+c)),listDocs(root(ctx)+'/maintenance_deletion_audit')]);
 return {records:[...orders.filter(d=>patterns.order.test(d.id)).map(d=>minimal(d,'order')),...assessments.filter(d=>patterns.assessment.test(d.id)).map(d=>minimal(d,'assessment')),...requests.filter(d=>patterns.request.test(d.id)).map(d=>minimal(d,'request'))],trail:trail.map(d=>({id:d.id,...d.data})).sort((a,b)=>str((b as Obj).deletedAt).localeCompare(str((a as Obj).deletedAt)))};
}
const dependentCollections=['maintenance_windows','goods_issues','inventory_reservations','material_journal','mnt_supply_links','procurement_requirements','procurement_requisitions','procurement_quotations','procurement_orders','fin_requests','fin_journal','safety_incidents','maintenance_material_reconciliations','maintenance_assessment_revisions','bom_revisions','asset_task_proposals','asset_task_template_revisions','material_creation_candidates','vendor_onboarding_requests','stores_issue_vouchers'];
export async function purgeTestMaintenance(ctx:OrgContext){
 requireMode(ctx);
 const kind=deletionKind(ctx.body.kind),code=deletionCode(kind,ctx.body.code),reason=str(ctx.body.reason).trim();
 if(ctx.body.confirm!==code||reason.length<10||reason.length>500)throw new HttpError(400,'Type the exact record number and enter a reason of 10–500 characters.');
 // Same lock order as early closure and financial stock issue; no mutation may bypass these guards.
 return withLock(ctx.orgId,'maintenance_operations',()=>withLock(ctx.orgId,'maintenance_po_commitment',()=>withLock(ctx.orgId,'inventory_movements',async()=>{
  clearTestModeCache();
  if(!await testModeActiveFor(ctx.orgId))throw new HttpError(403,'Test Mode is no longer active.');
  const base=root(ctx),collection=TEST_MAINTENANCE_COLLECTIONS[kind],path=base+'/'+collection+'/'+code;
  const [target,orders,assessments,requests]=await Promise.all([getDoc(path),listDocs(base+'/work_orders'),listDocs(base+'/work_assessments'),listDocs(base+'/work_requests')]);
  if(!target)throw new HttpError(404,'The maintenance record does not exist.');
  const d=target.data,blockers:string[]=[],writes:Write[]=[],unlinked:string[]=[];
  const recordRef=(doc:Doc)=>hasMaintenanceReference(doc.data,code);
  if(kind==='order'){
   for(const other of orders)if(other.id!==code&&(other.data.parentWoCode===code||other.data.rootWoCode===code||other.id.startsWith(code+'_')||recordRef(other)))blockers.push('Work order '+other.id);
   for(const wr of requests){
    if(wr.data.woCode===code){
     if(orders.some(o=>o.id!==code&&o.data.wrCode===wr.id)){blockers.push('Other work orders linked to '+wr.id);continue;}
     const linked=assessments.find(a=>a.id===wr.data.assessmentCode);
     const patch:Obj={woCode:'',status:linked?'to_be_assessed':'returned',reviewDecision:linked?'to_be_assessed':'',closedAt:'',closure:null,convertedBy:'',convertedByName:'',convertedAt:'',returnNote:'Test work order permanently deleted; review again if required.'};
     patch.updatedAt=nowIso();patch.history=[...asRows(wr.data.history),{at:patch.updatedAt,uid:ctx.uid,name:ctx.actor.email,action:'Test work order permanently deleted',note:code+' · '+reason}];
     writes.push({path:base+'/work_requests/'+wr.id,fields:patch,mask:Object.keys(patch),updateTime:assertVersion(wr)});unlinked.push(wr.id);
    }else if(recordRef(wr))blockers.push('Work request '+wr.id);
   }
   for(const a of assessments){
    if(a.data.woCode===code){
     const patch:Obj={woCode:'',status:row(a.data.assessmentReview).status==='approved'?'approved':'created',convertedBy:'',convertedByName:'',convertedAt:'',updatedAt:nowIso(),lastAction:'Test work order deleted',lastActionBy:ctx.uid};
     writes.push({path:base+'/work_assessments/'+a.id,fields:patch,mask:Object.keys(patch),updateTime:assertVersion(a)});unlinked.push(a.id);
    }else if(recordRef(a))blockers.push('Work assessment '+a.id);
   }
  }else if(kind==='assessment'){
   for(const o of orders)if(recordRef(o)||o.data.wrCode===d.workRequestCode&&str(d.workRequestCode))blockers.push('Work order '+o.id);
   for(const a of assessments)if(a.id!==code&&recordRef(a))blockers.push('Work assessment '+a.id);
   for(const wr of requests){
    if(wr.data.assessmentCode===code){
     if(str(wr.data.woCode)||orders.some(o=>o.data.wrCode===wr.id)){blockers.push('Work order linked to '+wr.id);continue;}
     const patch:Obj={assessmentCode:'',status:'returned',reviewDecision:'',assessmentTasks:[],assessmentTasksVersion:0,assessmentTasksAt:'',assessmentTasksBy:'',assessmentReview:null,assessedAt:'',assessedBy:'',assessmentNote:'',technicalEvaluation:'',natureCode:'',natureLabel:'',severitySetBy:'',solutions:[],maintenanceTypeCode:'',maintenanceTypeLabel:'',workTypeCode:'',workTypeLabel:'',returnNote:'Test assessment permanently deleted; submit again if required.',updatedAt:nowIso(),history:[...asRows(wr.data.history),{at:nowIso(),uid:ctx.uid,name:ctx.actor.email,action:'Test assessment permanently deleted',note:code+' · '+reason}]};
     writes.push({path:base+'/work_requests/'+wr.id,fields:patch,mask:Object.keys(patch),updateTime:assertVersion(wr)});unlinked.push(wr.id);
    }else if(recordRef(wr))blockers.push('Work request '+wr.id);
   }
  }else{
   for(const o of orders)if(recordRef(o)||o.id===d.woCode)blockers.push('Work order '+o.id);
   for(const a of assessments)if(recordRef(a)||a.id===d.assessmentCode)blockers.push('Work assessment '+a.id);
   for(const wr of requests)if(wr.id!==code&&recordRef(wr))blockers.push('Work request '+wr.id);
   if(str(d.gembaId)||str(d.gembaObservationId))blockers.push('Gemba origin; retain the linked observation history');
  }
  // Protect downstream accounting, procurement, safety and scheduling records, even when historical.
  const groups=await Promise.all(dependentCollections.map(async c=>({c,docs:await listDocs(base+'/'+c)})));
  for(const {c,docs} of groups)for(const doc of docs)if(recordRef(doc)||c==='fin_requests'&&doc.id===row(d.costApproval).requestId)blockers.push(c+' / '+doc.id);
  if(blockers.length)throw new HttpError(409,'Permanent deletion blocked by linked records. Resolve or retain those records first: '+[...new Set(blockers)].slice(0,12).join('; '));
  const at=nowIso(),auditId=kind+'_'+code;
  const trail={...minimal(target,kind),action:'permanent_delete',deletedAt:at,deletedBy:ctx.uid,deletedByName:[str(ctx.me.data.firstName),str(ctx.me.data.lastName)].filter(Boolean).join(' ')||ctx.actor.email,reason,orgId:ctx.orgId,testMode:true,environment:'development',unlinked,subOrderSequence:Number(d.subOrderSequence)||0,recordVersion:assertVersion(target)};
  writes.push({path:base+'/maintenance_deletion_audit/'+auditId,fields:trail,exists:false},{path,delete:true,updateTime:assertVersion(target)});
  clearTestModeCache();
  if(!await testModeActiveFor(ctx.orgId))throw new HttpError(403,'Test Mode expired before deletion.');
  await commit(writes);
  return {ok:true,auditId,code,kind,unlinked};
 })));
}
