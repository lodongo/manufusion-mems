/** Development-only maintenance record purge. The tombstone is committed with the physical deletion. */
import {createHash,randomUUID} from 'node:crypto';
import {HttpError,getDoc,listDocs,runQuery,fieldEq,nowIso,str,isObj,type Obj,type Doc} from './core';
import {commit,withLock,type Write} from './finCore';
import {cleanupEligible,requireCleanupAuthorization,cleanupUseWrite} from './maintenanceCleanupAuthorization';
import type {OrgContext} from './guards';

export const TEST_MAINTENANCE_COLLECTIONS={order:'work_orders',assessment:'work_assessments',request:'work_requests'} as const;
type Kind=keyof typeof TEST_MAINTENANCE_COLLECTIONS;
const patterns:Record<Kind,RegExp>={order:/^WO\d{8}(?:_[1-9]\d{0,8})?$/,assessment:/^ASSM_\d{8}$/,request:/^WR\d{8}$/};
const row=(v:unknown):Obj=>isObj(v)?v:{};
const asRows=(v:unknown):Obj[]=>Array.isArray(v)?v.filter(isObj):[];
const root=(ctx:OrgContext)=>'organizations/'+ctx.orgId;
export function testDeletionEnabled(ctx:Pick<OrgContext,'role'|'testMode'>){return cleanupEligible(ctx);}
export function deletionKind(v:unknown):Kind {if(v==='order'||v==='assessment'||v==='request')return v;throw new HttpError(400,'Choose a maintenance record type.');}
export function deletionCode(kind:Kind,v:unknown){const code=str(v);if(!patterns[kind].test(code))throw new HttpError(400,'Choose a valid maintenance record number.');return code;}
/** Exact reference matching, not substring matching; audit text and attachments are excluded. */
export function hasMaintenanceReference(v:unknown,code:string):boolean{
 if(typeof v==='string')return v===code;
 if(Array.isArray(v))return v.some(x=>hasMaintenanceReference(x,code));
 if(isObj(v))return Object.entries(v).some(([k,x])=>!['history','workflowTransitions','description','note','reason','title','narrative','photos','attachments'].includes(k)&&(k===code||hasMaintenanceReference(x,code)));
 return false;
}
async function requireMode(ctx:OrgContext){return requireCleanupAuthorization(ctx);}
const assertVersion=(doc:Doc)=>{if(!doc.updateTime)throw new HttpError(409,'Record version is missing. Refresh and try again.');return doc.updateTime;};
const minimal=(d:Doc,kind:Kind)=>({kind,code:d.id,title:str(d.data.title)||str(row(d.data.sourceRequest).title),status:str(d.data.status),wrCode:str(d.data.wrCode)||str(d.data.workRequestCode),parentWoCode:str(d.data.parentWoCode),rootWoCode:str(d.data.rootWoCode),createdAt:str(d.data.createdAt),unitCode:str(d.data.unitCode)||str(row(d.data.sourceRequest).unitCode)});
export async function listTestMaintenanceDeletion(ctx:OrgContext){
 await requireMode(ctx);
 const [orders,assessments,requests,trail,batches]=await Promise.all([...Object.values(TEST_MAINTENANCE_COLLECTIONS).map(c=>listDocs(root(ctx)+'/'+c)),listDocs(root(ctx)+'/maintenance_deletion_audit'),listDocs(root(ctx)+'/maintenance_cleanup_batches')]);
 return {batches:batches.map(d=>({id:d.id,...d.data})),records:[...orders.filter(d=>patterns.order.test(d.id)).map(d=>minimal(d,'order')),...assessments.filter(d=>patterns.assessment.test(d.id)).map(d=>minimal(d,'assessment')),...requests.filter(d=>patterns.request.test(d.id)).map(d=>minimal(d,'request'))],trail:trail.map(d=>({id:d.id,...d.data})).sort((a,b)=>str((b as Obj).deletedAt).localeCompare(str((a as Obj).deletedAt)))};
}
const dependentCollections=['maintenance_windows','goods_issues','inventory_reservations','material_journal','mnt_supply_links','procurement_requirements','procurement_requisitions','procurement_quotations','procurement_orders','fin_requests','fin_journal','safety_incidents','maintenance_material_reconciliations','maintenance_assessment_revisions','bom_revisions','asset_task_proposals','asset_task_template_revisions','material_creation_candidates','vendor_onboarding_requests','stores_issue_vouchers'];
export async function purgeTestMaintenance(ctx:OrgContext){
 await requireMode(ctx);
 const kind=deletionKind(ctx.body.kind),code=deletionCode(kind,ctx.body.code),reason=str(ctx.body.reason).trim();
 if(ctx.body.confirm!==code||reason.length<10||reason.length>500)throw new HttpError(400,'Type the exact record number and enter a reason of 10–500 characters.');
 // Same lock order as early closure and financial stock issue; no mutation may bypass these guards.
 return withLock(ctx.orgId,'maintenance_operations',()=>withLock(ctx.orgId,'maintenance_po_commitment',()=>withLock(ctx.orgId,'inventory_movements',async()=>{
  await requireMode(ctx);
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
  writes.push(cleanupUseWrite(ctx,await requireMode(ctx)));
  await commit(writes);
  return {ok:true,auditId,code,kind,unlinked};
 })));
}


// Bulk cleanup expands only explicit maintenance ownership and dependencies.
// It never silently deletes shared master data or a posted financial/physical movement.
type BulkDoc={collection:string;doc:Doc;kind?:Kind};
const rootCollections=Object.entries(TEST_MAINTENANCE_COLLECTIONS) as [Kind,string][];
const casualCollections=['maintenance_time_bookings','maintenance_windows','asset_task_proposals','maintenance_assessment_revisions','maintenance_material_reconciliations','inventory_reservations','mnt_supply_links','procurement_requirements','procurement_requisitions','procurement_quotations','procurement_orders','fin_requests','safety_incidents','material_creation_candidates','vendor_onboarding_requests','stores_issue_vouchers','material_journal','asset_task_template_revisions','asset_task_templates','bom_revisions','goods_issues','fin_journal'];
const keyOf=(r:BulkDoc)=>r.collection+'/'+r.doc.id;
const refs=(d:Obj,ids:Set<string>)=>[...ids].some(id=>hasMaintenanceReference(d,id));
const hasForeign=(d:Obj,all:Set<string>,selected:Set<string>)=>[...all].some(id=>!selected.has(id)&&hasMaintenanceReference(d,id));
const isReservation=(d:Obj)=>['MAINTENANCE_RESERVATION','MAINTENANCE_RESERVATION_RELEASE'].includes(str(d.type));
function procurementDraft(d:Obj){return ['draft','validated','cancelled','rejected','returned','pending_approval'].includes(str(d.status))&&!d.postedAt&&!d.journalId&&!d.openedAt&&!d.approvedAt&&!asRows(d.lines).some(l=>Number(l.receivedQty)>0||Number(l.acceptedQty)>0)&&!asRows(d.deliveries).length&&!asRows(d.receipts).length;}
function ownedKind(d:Obj){return str(d.source)==='maintenance'||!!str(row(d.maintenanceSource).woCode);}
async function bulkPlan(ctx:OrgContext){
 const grant=await requireMode(ctx);
 const base=root(ctx),body=ctx.body;
 const selected=Array.isArray(body.records)?body.records.map(row):[];
 if(!selected.length||selected.length>400)throw new HttpError(400,'Choose 1–400 maintenance records.');
 const requested=new Set(selected.map(s=>deletionCode(deletionKind(s.kind),s.code)));
 const primary=(await Promise.all(rootCollections.map(async ([kind,collection])=>(await listDocs(base+'/'+collection)).filter(d=>patterns[kind].test(d.id)).map(doc=>({collection,doc,kind}))))).flat();
 const allPrimary=new Set(primary.map(x=>x.doc.id));
 for(const id of requested)if(!allPrimary.has(id))throw new HttpError(409,'Record no longer exists: '+id+'. Refresh the selection.');
 const family=new Set(requested);
 // Parent, child, original request and assessment comprise a single test case.
 let changed=true;
 while(changed){changed=false;for(const x of primary){
   const d=x.doc.data,linked=[str(d.wrCode),str(d.workRequestCode),str(d.woCode),str(d.assessmentCode),str(d.parentWoCode),str(d.rootWoCode),str(row(d.closure).woCode),x.kind==='order'&&x.doc.id.includes('_')?x.doc.id.split('_')[0]:''].filter(id=>allPrimary.has(id));
   if(family.has(x.doc.id)||linked.some(id=>family.has(id)))for(const id of [x.doc.id,...linked])if(!family.has(id)){family.add(id);changed=true;}
 }}
 const chosen=primary.filter(x=>family.has(x.doc.id)), remove=new Map<string,BulkDoc>(chosen.map(x=>[keyOf(x),x]));
 const blockers=new Set<string>(),retained=new Set<string>();
 for(const x of chosen)if(x.kind==='request'&&(x.doc.data.gembaId||x.doc.data.gembaObservationId))blockers.add('Gemba origin: '+x.doc.id);
 const secondary=(await Promise.all(casualCollections.map(async collection=>(await listDocs(base+'/'+collection)).map(doc=>({collection,doc}))))).flat();
 const ids=new Set(family),allReq=new Set(secondary.filter(x=>x.collection==='procurement_requirements').map(x=>x.doc.id));
 // Forward traversal: only related records are considered; a shared replenishment's requirement is never followed backwards.
 for(let pass=0;pass<12;pass++){
   let added=false;
   for(const x of secondary){
     const k=keyOf(x),d=x.doc.data,c=x.collection;
     if(remove.has(k)||!refs(d,ids))continue;
     if(hasForeign(d,allPrimary,family)){blockers.add('Shared maintenance record: '+k);continue;}
     if(['goods_issues','fin_journal','bom_revisions'].includes(c)||c==='material_journal'&&!isReservation(d)){blockers.add('Posted inventory, BOM or accounting record: '+k);continue;}
     if(c==='asset_task_templates'||c==='asset_task_template_revisions'){
       // Approved reusable master data may have been consumed by a different job.
       retained.add(k);continue;
     }
     if(c==='asset_task_proposals'&&str(d.status)==='approved'&&secondary.some(y=>['asset_task_templates','asset_task_template_revisions'].includes(y.collection)&&hasMaintenanceReference(y.doc.data,x.doc.id))){retained.add(k);continue;}
     if(c==='procurement_requirements'&&!ownedKind(d)){retained.add(k);continue;}
     if(c==='procurement_orders'&&!procurementDraft(d)){blockers.add('Committed/posted purchase order: '+k);continue;}
     if(['procurement_orders','procurement_requisitions','procurement_quotations'].includes(c)&&hasForeign(d,allReq,ids))continue;
     if(c==='fin_requests'&&str(d.type)!=='mnt.wo.cost'){blockers.add('Financial transaction: '+k);continue;}
     if(c==='stores_issue_vouchers'&&(['partial','issued'].includes(str(d.status))||asRows(d.lines).some(l=>Number(l.issuedQty)>0))){blockers.add('Posted stores issue voucher: '+k);continue;}
     if(c==='maintenance_material_reconciliations'&&asRows(d.consumption).length){blockers.add('Material consumption reconciliation: '+k);continue;}
     if(['material_creation_candidates','vendor_onboarding_requests'].includes(c)&&!['draft','created','pending','pending_validation','rejected','cancelled','submitted','open'].includes(str(d.status))){retained.add(k);continue;}
     // A window may have historical safety records; all its work orders must be included.
     // Open or closed isolated development incident records are included in this test cleanup.
     remove.set(k,x);ids.add(x.doc.id);added=true;
   }
   if(!added)break;
   if(pass===11)blockers.add('Dependency chain is too deep; choose a smaller test case.');
 }
 for(const x of secondary.filter(x=>['procurement_orders','procurement_requisitions','procurement_quotations'].includes(x.collection)))if(!remove.has(keyOf(x))&&refs(x.doc.data,ids)&&hasForeign(x.doc.data,allReq,ids))blockers.add('Shared procurement record: '+keyOf(x));
 // Shared requirements cannot be erased if an outside supply link uses them.
 for(const x of secondary.filter(x=>x.collection==='mnt_supply_links'))if(!remove.has(keyOf(x))&&ids.has(str(x.doc.data.requirementId)))blockers.add('Shared replenishment or requirement: '+x.doc.id);
 // A retained approved task proposal is intentionally preserved as provenance for the task master.
 // Remove ordinary record-specific audit copies, not authentication, security or permanent-cleanup receipts.
 const [tenantAudit,platformAudit]=await Promise.all([listDocs(base+'/audit_events'),runQuery({from:[{collectionId:'audit_events'}],where:fieldEq('orgId',ctx.orgId)})]);
 const isOrdinary=(d:Obj)=>d.orgId===ctx.orgId&&d.category==='maintenance'&&!/permanent_delete|test_deletion|bulk_cleanup|testmode/i.test(str(d.action))&&(ids.has(str(d.targetId))||ids.has(str(d.targetLabel)));
 const auditDocs=[...tenantAudit.filter(x=>isOrdinary(x.data)).map(doc=>({collection:'audit_events',doc})),...platformAudit.filter(x=>isOrdinary(x.data)).map(doc=>({collection:'@platform/audit_events',doc}))];
 for(const x of auditDocs)remove.set(keyOf(x),x);
 const entries=[...remove.values()].sort((a,b)=>keyOf(a).localeCompare(keyOf(b)));
 const counts:Record<string,number>={};for(const x of entries)counts[x.collection]=(counts[x.collection]||0)+1;
 // Single atomic commit: documents plus numbered tombstones, one batch receipt.
 const writeCount=entries.length+chosen.length+1;if(writeCount>470)blockers.add('Cleanup requires '+writeCount+' database writes. Select a smaller group (maximum 470 writes per batch).');
 // Avoid throwing away attached service reports separately; they are private storage objects.
 const fingerprint=createHash('sha256').update(JSON.stringify({authorization:str(grant.data.tokenHash),entries:entries.map(x=>[keyOf(x),x.doc.updateTime]),blockers:[...blockers].sort(),retained:[...retained].sort()})).digest('hex');
 return {entries,chosen,counts,fingerprint,blockers:[...blockers].sort(),retained:[...retained].sort(),requestedCount:requested.size};
}
const bulkView=(p:Awaited<ReturnType<typeof bulkPlan>>)=>({fingerprint:p.fingerprint,counts:p.counts,records:p.chosen.map(x=>minimal(x.doc,x.kind!)),total:p.entries.length,blockers:p.blockers,retained:p.retained,requestedCount:p.requestedCount});
export async function previewBulkTestMaintenance(ctx:OrgContext){return bulkView(await bulkPlan(ctx));}
export async function purgeBulkTestMaintenance(ctx:OrgContext){
 await requireMode(ctx);
 const reason=str(ctx.body.reason).trim();if(ctx.body.confirm!=='DELETE TEST DATA'||reason.length<10||reason.length>500)throw new HttpError(400,'Type DELETE TEST DATA and enter a reason of 10–500 characters.');
 return withLock(ctx.orgId,'maintenance_operations',()=>withLock(ctx.orgId,'maintenance_po_commitment',()=>withLock(ctx.orgId,'inventory_movements',async()=>{
  const plan=await bulkPlan(ctx);if(plan.fingerprint!==ctx.body.fingerprint)throw new HttpError(409,'Records changed since preview. Preview the cleanup again.');
  if(plan.blockers.length)throw new HttpError(409,'Cleanup blocked: '+plan.blockers.slice(0,12).join('; '));
  const base=root(ctx),at=nowIso(),batchId='BULK_'+randomUUID(),name=[str(ctx.me.data.firstName),str(ctx.me.data.lastName)].filter(Boolean).join(' ')||ctx.actor.email;
  const tombstones:Write[]=plan.chosen.map(x=>({path:base+'/maintenance_deletion_audit/'+x.kind+'_'+x.doc.id,fields:{...minimal(x.doc,x.kind!),action:'permanent_delete',deletedAt:at,deletedBy:ctx.uid,deletedByName:name,reason,orgId:ctx.orgId,testMode:true,environment:'development',batchId,subOrderSequence:Number(x.doc.data.subOrderSequence)||0,recordVersion:assertVersion(x.doc),unlinked:[]},exists:false}));
  const writes:Write[]=plan.entries.map(x=>({path:x.collection==='@platform/audit_events'?'audit_events/'+x.doc.id:base+'/'+keyOf(x),delete:true,updateTime:assertVersion(x.doc)}));
  writes.push(...tombstones,{path:base+'/maintenance_cleanup_batches/'+batchId,fields:{batchId,action:'bulk_cleanup',orgId:ctx.orgId,testMode:true,environment:'development',deletedAt:at,deletedBy:ctx.uid,deletedByName:name,reason,counts:plan.counts,deleted:plan.entries.map(x=>keyOf(x)),retained:plan.retained},exists:false});
  writes.push(cleanupUseWrite(ctx,await requireMode(ctx)));
  await commit(writes);return {ok:true,batchId,...bulkView(plan)};
 })));
}
