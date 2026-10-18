/**
 * Independently reviewed configuration publication for every installed
 * transaction. Draft proposals never authorize operations; the second
 * administrator publishes either a binding or a monetary/workflow policy.
 */
import { randomUUID } from 'node:crypto';
import { HttpError, getDoc, isObj, listDocs, nowIso, str, updateFields, writeDoc } from './core';
import { orgRoute } from './guards';
import { wiredTransactionInventory } from './transactionRuntime';
import { quorumCount, type GovernanceRule, type ApprovalQuorum } from './governanceCore';
import { audit } from './audit';

const proposals=(org:string)=>`organizations/${org}/governance_proposals`;
const binding=(org:string,code:string)=>`organizations/${org}/governance_bindings/${code}`;
const authority=(org:string,code:string)=>`organizations/${org}/governance_authority/${code}`;
const identifier=/^[a-zA-Z0-9_-]{8,128}$/;
const nonempty=(value:unknown)=>str(value).trim().length>0;

function registered(code:string) {
  const matches=wiredTransactionInventory().filter(x=>x.code===code);
  if(matches.length!==1||!matches[0].permission||!matches[0].name)
    throw new HttpError(400,'Only uniquely registered, explicitly guarded transaction actions can be configured.');
  return matches[0];
}
async function validateAuthorityPayload(orgId:string,data:Record<string,unknown>) {
  const rules=Array.isArray(data.rules)?data.rules.filter(isObj):[];
  if(!rules.length||rules.length>150||rules.length!==((data.rules as unknown[])??[]).length)
    throw new HttpError(400,'Provide valid authority rules (maximum 150).');
  const approvers=isObj(data.approversByLevel)?data.approversByLevel:null;
  if(!approvers)throw new HttpError(400,'Configure approver groups for all required streams.');
  const quorum=isObj(data.quorumByLevel)?data.quorumByLevel:{};
  const levelKeys=new Set<string>();
  for(const item of rules) {
    const rule=item as unknown as GovernanceRule;
    if(!nonempty(rule.id)||!nonempty(rule.stream)||!Number.isSafeInteger(rule.level)||
      rule.level<1||rule.level>30||!['minimum_level','specialist'].includes(rule.type)||
      rule.enabled!==true||rule.mandatory!==true)
      throw new HttpError(400,'Rules require an identifier, approved stream, valid level and mandatory enforcement.');
    if(rule.type==='specialist'&&!nonempty(rule.specialistKey))
      throw new HttpError(400,'Specialist authority requires a named specialty.');
    if(rule.minAmount!==undefined&&(typeof rule.minAmount!=='number'||rule.minAmount<0))
      throw new HttpError(400,'Invalid authority minimum amount.');
    if(rule.maxAmount!==undefined&&(typeof rule.maxAmount!=='number'||rule.maxAmount<0))
      throw new HttpError(400,'Invalid authority maximum amount.');
    if(rule.currency!==undefined&&!/^[A-Z]{3}$/.test(rule.currency))
      throw new HttpError(400,'Authority currency must use a three-letter code.');
    const levels=rule.type==='minimum_level'?Array.from({length:rule.level},(_,i)=>i+1):[rule.level];
    for(const level of levels)levelKeys.add(rule.stream+':'+level);
  }
  for(const key of levelKeys) {
    const uids=Array.isArray(approvers[key])?(approvers[key] as unknown[]).map(str).filter(Boolean):[];
    if(!uids.length||uids.length!==new Set(uids).size||uids.length>100)
      throw new HttpError(400,'Missing, duplicated or excessive approvers for '+key);
    const configured=isObj(quorum[key])?quorum[key]:null;
    const ruleQuorum:ApprovalQuorum=configured?{
      mode:str(configured.mode) as ApprovalQuorum['mode'],
      value:configured.value===undefined?undefined:Number(configured.value),
    }:{mode:'any'};
    try{quorumCount(ruleQuorum,uids.length)}
    catch{throw new HttpError(400,'Invalid approval quorum for '+key)}
    for(const uid of uids) {
      const user=await getDoc('users/'+uid);
      if(!user||str(user.data.orgId)!==orgId||str(user.data.status)==='disabled')
        throw new HttpError(400,'Assigned approver is not an active member of this organization.');
    }
  }
  return {rules,approversByLevel:approvers,quorumByLevel:quorum};
}
export const governancePolicyRoutes={
  'POST /api/org/governance/config/propose':[
    orgRoute('org.governance.config.propose','ADM.workflows',async(ctx)=>{
      const code=str(ctx.body.code),kind=str(ctx.body.kind);
      const route=registered(code);
      if(!['binding','authority'].includes(kind))
        throw new HttpError(400,'Select transaction binding or authority configuration.');
      let payload:Record<string,unknown>;
      if(kind==='binding') {
        const classification=str(ctx.body.classification);
        if(!['permission_only','approval_required'].includes(classification))
          throw new HttpError(400,'Classify the transaction before publication.');
        const handlerEvidenceId=str(ctx.body.handlerEvidenceId),
          scopeEvidenceId=str(ctx.body.scopeEvidenceId),sodEvidenceId=str(ctx.body.sodEvidenceId);
        if(!handlerEvidenceId||!scopeEvidenceId||!sodEvidenceId)
          throw new HttpError(400,'Independent handler, scope and separation-of-duties evidence is required.');
        payload={classification,handlerEvidenceId,scopeEvidenceId,sodEvidenceId};
      }else payload=await validateAuthorityPayload(ctx.orgId,ctx.body);
      const reason=str(ctx.body.reason).trim();
      if(reason.length<10||reason.length>1000)
        throw new HttpError(400,'Enter a reason for the proposed governance configuration.');
      const id=randomUUID();
      const draft={id,kind,code,routeName:route.name,permission:route.permission,
        module:route.module,area:route.area,configuredBy:ctx.uid,configuredAt:nowIso(),
        approvedBy:'',status:'proposed',reason,payload};
      if(!await writeDoc(proposals(ctx.orgId)+'/'+id,draft,{exists:false}))
        throw new HttpError(409,'Could not create governance proposal.');
      await audit([{category:'governance',action:'governance.config.proposed',actor:ctx.actor,meta:ctx.meta,
        target:{type:'governance_proposal',id,label:code},details:kind+' · '+reason}]);
      return {id,status:'proposed',code,kind};
    }),
  ],
  'POST /api/org/governance/config/review':[
    orgRoute('org.governance.config.review','ADM.workflows',async(ctx)=>{
      const id=str(ctx.body.id);
      if(!identifier.test(id))throw new HttpError(400,'Invalid proposal identifier.');
      const path=proposals(ctx.orgId)+'/'+id,doc=await getDoc(path);
      if(!doc||str(doc.data.status)!=='proposed')throw new HttpError(409,'Proposal not pending independent review.');
      if(str(doc.data.configuredBy)===ctx.uid)
        throw new HttpError(403,'The proposal creator cannot approve their own changes.');
      const code=str(doc.data.code),kind=str(doc.data.kind),route=registered(code);
      if(route.name!==str(doc.data.routeName)||route.permission!==str(doc.data.permission))
        throw new HttpError(409,'Transaction handler changed since proposal.');
      const payload=isObj(doc.data.payload)?doc.data.payload:{};
      if(kind==='authority')await validateAuthorityPayload(ctx.orgId,payload);
      else if(kind==='binding'){
        if(!['permission_only','approval_required'].includes(str(payload.classification))||
          !nonempty(payload.handlerEvidenceId)||!nonempty(payload.scopeEvidenceId)||!nonempty(payload.sodEvidenceId))
          throw new HttpError(409,'Transaction evidence is incomplete.');
      }else throw new HttpError(409,'Invalid proposal kind.');
      // Claim the proposal with Firestore's update-time precondition before
      // publishing. Two reviewers cannot approve the same proposal concurrently.
      const claimed=await writeDoc(path,{...doc.data,status:'reviewing',
        reviewerUid:ctx.uid,reviewStartedAt:nowIso()},{updateTime:doc.updateTime});
      if(!claimed)throw new HttpError(409,'Another reviewer is processing this proposal.');
      const target=kind==='authority'?authority(ctx.orgId,code):binding(ctx.orgId,code);
      const existing=await getDoc(target);
      const version=Number(existing?.data.version)||0;
      const next={
        ...payload,
        code,handlerName:route.name,permission:route.permission,
        module:route.module,area:route.area,
        configuredBy:str(doc.data.configuredBy),approvedBy:ctx.uid,
        status:'active',version:version+1,updatedAt:nowIso(),
      };
      const ok=await writeDoc(target,next,existing?{updateTime:existing.updateTime}:{exists:false});
      if(!ok){
        await updateFields(path,{status:'review_failed',reviewFailureAt:nowIso()});
        throw new HttpError(409,'Configuration changed during review. Submit an updated proposal.');
      }
      await updateFields(path,{status:'approved',approvedBy:ctx.uid,approvedAt:nowIso()});
      await audit([{category:'governance',action:'governance.config.approved',actor:ctx.actor,meta:ctx.meta,
        target:{type:'governance_policy',id:code,label:kind},details:'Version '+(version+1)}]);
      return {code,kind,status:'active',version:version+1};
    }),
  ],
  'POST /api/org/governance/config/list':[
    orgRoute('org.governance.config.list','ADM.workflows',async(ctx)=>{
      const docs=await listDocs(proposals(ctx.orgId));
      return {items:docs.map(d=>({
        id:d.id,code:str(d.data.code),kind:str(d.data.kind),reason:str(d.data.reason),
        status:str(d.data.status),configuredBy:str(d.data.configuredBy),
        configuredAt:str(d.data.configuredAt),approvedBy:str(d.data.approvedBy),
        canReview:str(d.data.status)==='proposed'&&str(d.data.configuredBy)!==ctx.uid,
      }))};
    }),
  ],
};
