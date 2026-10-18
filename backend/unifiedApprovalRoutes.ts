/**
 * Generic enterprise approval execution, shared by all registered transaction
 * handlers. Policy/eligibility are read from tenant-scoped, independently
 * reviewed server documents; submitters cannot nominate their own approvers.
 * Requests are bound to a payload hash. Business execution is performed only
 * by the original guarded handler after consuming the approved evidence.
 */
import { randomUUID } from 'node:crypto';
import {
  HttpError, getDoc, isObj, listDocs, nowIso, str, writeDoc,
} from './core';
import { orgRoute, hasPerm } from './guards';
import { audit } from './audit';
import { evaluateAuthority, quorumCount, type GovernanceRule, type ApprovalQuorum } from './governanceCore';
import {
  transactionPayloadHash,applyApprovalDecision,nextEligibleApprovalStep,
  type ApprovalEvidence,type ApprovalStep,type ApprovalVote,
} from './unifiedApprovalProof';
import { wiredTransactionInventory } from './transactionRuntime';

const ROOT=(orgId:string)=>`organizations/${orgId}/governance_approvals`;
const POLICY=(orgId:string,code:string)=>`organizations/${orgId}/governance_authority/${code}`;
const BINDING=(orgId:string,code:string)=>`organizations/${orgId}/governance_bindings/${code}`;
const ID=/^[a-zA-Z0-9_-]{8,128}$/;
const LIMIT=200;

type StoredRequest=ApprovalEvidence&{
  id:string;createdAt:string;updatedAt:string;reason:string;policyVersion:string;
};

function exactRoute(code:string) {
  const matches=wiredTransactionInventory().filter(r=>r.code===code);
  if(matches.length!==1||matches[0].guard!=='organization'||!matches[0].permission)
    throw new HttpError(400,'Select an installed transaction with an explicit permission.');
  return matches[0];
}
function reviewed(doc:Record<string,unknown>|undefined):boolean {
  return !!doc && str(doc.status)==='active' &&
    !!str(doc.configuredBy)&&!!str(doc.approvedBy)&&str(doc.configuredBy)!==str(doc.approvedBy);
}
function rawSteps(raw:unknown):ApprovalStep[] {
  if(!Array.isArray(raw))return [];
  return raw.filter(isObj).map(s=>({
    stream:str(s.stream),level:Number(s.level),
    eligibleUserIds:Array.isArray(s.eligibleUserIds)?s.eligibleUserIds.map(str):[],
    quorum:isObj(s.quorum)?{mode:str(s.quorum.mode) as ApprovalQuorum['mode'],value:s.quorum.value===undefined?undefined:Number(s.quorum.value)}:{mode:'any' as const},
  }));
}
function rawVotes(raw:unknown):ApprovalVote[] {
  if(!Array.isArray(raw))return [];
  return raw.filter(isObj).map(v=>({
    uid:str(v.uid),stream:str(v.stream),level:Number(v.level),
    decision:str(v.decision) as ApprovalVote['decision'],decidedAt:str(v.decidedAt),
  }));
}
function readRequest(data:Record<string,unknown>):StoredRequest{
  return {
    id:str(data.id),orgId:str(data.orgId),code:str(data.code),
    handlerName:str(data.handlerName),requestedBy:str(data.requestedBy),
    payloadHash:str(data.payloadHash),status:str(data.status),
    steps:rawSteps(data.steps),votes:rawVotes(data.votes),
    createdAt:str(data.createdAt),updatedAt:str(data.updatedAt),
    reason:str(data.reason),policyVersion:str(data.policyVersion),
  };
}

export const unifiedApprovalRoutes = {
  'POST /api/org/governance/approvals/request':[
    orgRoute('org.governance.approvals.request',null,async(ctx)=>{
      const code=str(ctx.body.code);
      const route=exactRoute(code);
      if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.permissions,route.permission!))
        throw new HttpError(403,'You do not hold the transaction permission.');
      const modules=isObj(ctx.org.data.modules)?ctx.org.data.modules:{};
      if(modules[route.module]===false)throw new HttpError(403,'Module disabled.');
      const payload=ctx.body.payload;
      if(!isObj(payload)||!Object.keys(payload).length||Object.keys(payload).length>200)
        throw new HttpError(400,'Transaction payload required.');
      if('idToken' in payload||'governanceApprovalId' in payload)
        throw new HttpError(400,'Do not include authentication or approval tokens in the business payload.');
      const [binding,policy]=await Promise.all([getDoc(BINDING(ctx.orgId,code)),getDoc(POLICY(ctx.orgId,code))]);
      if(!reviewed(binding?.data)||str(binding?.data.classification)!=='approval_required'||
        str(binding?.data.handlerName)!==route.name||str(binding?.data.permission)!==route.permission)
        throw new HttpError(409,'Transaction is not configured for independently reviewed approvals.');
      if(!reviewed(policy?.data))throw new HttpError(409,'An independently reviewed authority policy is required.');
      const rules=Array.isArray(policy?.data.rules)?policy!.data.rules as GovernanceRule[]:[];
      const amount=typeof payload.amount==='number'?payload.amount:undefined;
      const currency=str(payload.currency);
      const facts=Object.fromEntries(Object.entries(payload).filter(([,v])=>
        typeof v==='string'||typeof v==='number'||typeof v==='boolean')) as Record<string,string|number|boolean>;
      const evaluation=evaluateAuthority(rules,{amount,currency,facts});
      if(!evaluation.allowed)throw new HttpError(409,'Authority rule cannot be satisfied: '+evaluation.problems.join('; '));
      const mapping=isObj(policy?.data.approversByLevel)?policy!.data.approversByLevel:{};
      const quorumMapping=isObj(policy?.data.quorumByLevel)?policy!.data.quorumByLevel:{};
      const steps:ApprovalStep[]=[];
      for(const requirement of evaluation.requirements){
        const key=requirement.stream+':'+requirement.level;
        const uids=Array.isArray(mapping[key])?(mapping[key] as unknown[]).map(str).filter(Boolean):[];
        const eligible=[...new Set(uids.filter(uid=>uid!==ctx.uid))];
        const configured=isObj(quorumMapping[key])?quorumMapping[key]:null;
        const quorum:ApprovalQuorum=configured?{
          mode:str(configured.mode) as ApprovalQuorum['mode'],
          value:configured.value===undefined?undefined:Number(configured.value),
        }:requirement.quorum;
        try{quorumCount(quorum,eligible.length)}catch{throw new HttpError(409,'Missing or impossible approval quorum: '+key)}
        for(const uid of eligible){
          const user=await getDoc('users/'+uid);
          if(!user||str(user.data.orgId)!==ctx.orgId||str(user.data.status)==='disabled')
            throw new HttpError(409,'Approver is outside the organization or inactive: '+key);
        }
        steps.push({stream:requirement.stream,level:requirement.level,quorum,eligibleUserIds:eligible});
      }
      if(!steps.length)throw new HttpError(409,'Authority policy returned no approval levels.');
      const id=randomUUID(),now=nowIso();
      const request:StoredRequest={
        id,orgId:ctx.orgId,code,handlerName:route.name,requestedBy:ctx.uid,
        payloadHash:transactionPayloadHash(payload),status:'pending',steps,votes:[],
        reason:str(ctx.body.reason).trim().slice(0,1000),
        policyVersion:str(policy?.data.version)||'1',createdAt:now,updatedAt:now,
      };
      if(!await writeDoc(ROOT(ctx.orgId)+'/'+id,request,{exists:false}))
        throw new HttpError(409,'Approval could not be registered.');
      await audit([{category:'workflow',action:'governance.request.submitted',actor:ctx.actor,meta:ctx.meta,
        target:{type:'transaction_approval',id,label:code},details:'Requested approval for '+route.name}]);
      return {id,code,status:'pending',steps:steps.map(({stream,level,quorum})=>({stream,level,quorum}))};
    }),
  ],
  'POST /api/org/governance/approvals/decide':[
    orgRoute('org.governance.approvals.decide',null,async(ctx)=>{
      const id=str(ctx.body.id),decision=str(ctx.body.decision);
      if(!ID.test(id)||!['approve','reject','return'].includes(decision))
        throw new HttpError(400,'Invalid approval request or decision.');
      const path=ROOT(ctx.orgId)+'/'+id,doc=await getDoc(path);
      if(!doc)throw new HttpError(404,'Approval request not found.');
      const request=readRequest(doc.data);
      if(request.orgId!==ctx.orgId||request.status!=='pending')
        throw new HttpError(409,'Approval request is no longer pending.');
      if(request.requestedBy===ctx.uid)throw new HttpError(403,'Creator cannot approve their own transaction.');
      const reason=str(ctx.body.reason).trim().slice(0,1000);
      if(decision!=='approve'&&!reason)throw new HttpError(400,'A reason is required to reject or return.');
      let next:ReturnType<typeof applyApprovalDecision>;
      try{next=applyApprovalDecision(request,ctx.uid,decision as ApprovalVote['decision'],nowIso());}
      catch{throw new HttpError(403,'You are not eligible to decide at this level.');}
      const {votes,status,step}=next;
      const updated={...doc.data,votes,status,updatedAt:nowIso(),
        ...(reason?{decisionReason:reason}:{})};
      if(!await writeDoc(path,updated,{updateTime:doc.updateTime}))
        throw new HttpError(409,'Approval changed during your decision. Refresh and try again.');
      await audit([{category:'workflow',action:'governance.request.'+decision,actor:ctx.actor,meta:ctx.meta,
        target:{type:'transaction_approval',id,label:request.code},details:'Status: '+status+'; stream: '+step.stream+'; level: '+step.level}]);
      return {id,status,stream:step.stream,level:step.level};
    }),
  ],
  'POST /api/org/governance/approvals/my':[
    orgRoute('org.governance.approvals.my',null,async(ctx)=>{
      const records=(await listDocs(ROOT(ctx.orgId))).slice(0,LIMIT)
        .map(d=>readRequest(d.data))
        .filter(r=>r.requestedBy===ctx.uid||r.steps.some(s=>s.eligibleUserIds.includes(ctx.uid)));
      return {items:records.map(r=>({
        id:r.id,code:r.code,handlerName:r.handlerName,status:r.status,
        createdAt:r.createdAt,requestedBy:r.requestedBy,
        canDecide:r.status==='pending'&&r.requestedBy!==ctx.uid&&!!nextEligibleApprovalStep(r,ctx.uid),
      })),truncated:records.length>=LIMIT};
    }),
  ],
};
