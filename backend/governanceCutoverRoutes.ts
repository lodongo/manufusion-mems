/**
 * Dry-run/activation handshake for the unified enforcement boundary.
 * Never trusts browser-provided route inventories or readiness flags.
 */
import { randomUUID } from 'node:crypto';
import { HttpError,getDoc,listDocs,nowIso,str,writeDoc } from './core';
import { orgRoute } from './guards';
import { audit } from './audit';
import { wiredTransactionInventory } from './transactionRuntime';
import {
  evaluateCutoverCoverage,type CoverageReport,
  type ReviewedAuthority,type ReviewedBinding,
} from './governanceCutoverCoverage';
const ROOT=(org:string)=>`organizations/${org}`;
const CONFIG=(org:string)=>`${ROOT(org)}/governance/runtime`;
const PROPOSAL=(org:string,id:string)=>`${ROOT(org)}/governance_cutovers/${id}`;
const ID=/^[0-9a-f-]{36}$/;
const MAX_LIST=3000;

export async function loadCutoverCoverage(orgId:string):Promise<CoverageReport>{
  const root=ROOT(orgId);
  const [bindingDocs,authorityDocs]=await Promise.all([
    listDocs(root+'/governance_bindings'),
    listDocs(root+'/governance_authority'),
  ]);
  // listDocs has a bounded pagination limit; reaching it cannot be treated
  // as proof of full inventory coverage.
  if(bindingDocs.length>=MAX_LIST||authorityDocs.length>=MAX_LIST)
    throw new HttpError(409,'Policy collection is too large for complete release verification.');
  const bindings=new Map(bindingDocs.map(d=>[d.id,d.data as ReviewedBinding]));
  const authorities=new Map(authorityDocs.map(d=>[d.id,d.data as ReviewedAuthority]));
  return evaluateCutoverCoverage(wiredTransactionInventory(),bindings,authorities);
}
function reasons(value:unknown):string{
  const reason=str(value).trim();
  if(reason.length<15||reason.length>1000)throw new HttpError(400,'Enter a meaningful reason (15–1000 characters).');
  return reason;
}

export const governanceCutoverRoutes={
  'POST /api/org/governance/cutover/status':[
    orgRoute('org.governance.cutover.status','ADM.workflows',async ctx=>{
      const [report,config]=await Promise.all([loadCutoverCoverage(ctx.orgId),getDoc(CONFIG(ctx.orgId))]);
      return {mode:str(config?.data.mode)||'inactive',report:{
        inspected:report.inspected,ready:report.ready,blocked:report.blocked,
        coveragePercent:report.coveragePercent,digest:report.digest,canActivate:report.canActivate,
        items:report.items.filter(i=>i.issues.length>0).slice(0,250),
        truncated:report.blocked>250,
      }};
    }),
  ],
  'POST /api/org/governance/cutover/propose':[
    orgRoute('org.governance.cutover.propose','ADM.workflows',async ctx=>{
      const reason=reasons(ctx.body.reason);
      const [report,current]=await Promise.all([loadCutoverCoverage(ctx.orgId),getDoc(CONFIG(ctx.orgId))]);
      if(!report.canActivate)throw new HttpError(409,
        'Unified governance is not ready: '+report.blocked+' of '+report.inspected+' handlers are not certified.');
      if(str(current?.data.mode)==='enforce')throw new HttpError(409,'Unified governance already active.');
      const id=randomUUID();
      const proposal={id,reason,status:'proposed',coverageDigest:report.digest,
        handlerCount:report.inspected,configuredBy:ctx.uid,configuredAt:nowIso()};
      if(!await writeDoc(PROPOSAL(ctx.orgId,id),proposal,{exists:false}))
        throw new HttpError(409,'Could not create a cutover proposal.');
      await audit([{category:'governance',action:'governance.cutover.proposed',actor:ctx.actor,
        meta:ctx.meta,target:{type:'governance_cutover',id},details:reason}]);
      return {id,status:'proposed',inspected:report.inspected};
    }),
  ],
  'POST /api/org/governance/cutover/approve':[
    orgRoute('org.governance.cutover.approve','ADM.workflows',async ctx=>{
      const id=str(ctx.body.id);
      if(!ID.test(id))throw new HttpError(400,'Invalid cutover proposal ID.');
      const path=PROPOSAL(ctx.orgId,id),proposal=await getDoc(path);
      if(!proposal||str(proposal.data.status)!=='proposed')
        throw new HttpError(409,'Cutover approval is unavailable.');
      if(str(proposal.data.configuredBy)===ctx.uid)
        throw new HttpError(403,'The cutover proposer cannot authorize activation.');
      const report=await loadCutoverCoverage(ctx.orgId);
      if(!report.canActivate || report.digest!==str(proposal.data.coverageDigest) ||
        report.inspected!==Number(proposal.data.handlerCount))
        throw new HttpError(409,'Live handler/policy coverage has changed; propose cutover again.');
      const claimed=await writeDoc(path,{...proposal.data,status:'reviewing',
        approvedBy:ctx.uid,reviewedAt:nowIso()},{updateTime:proposal.updateTime});
      if(!claimed)throw new HttpError(409,'Cutover proposal already under review.');
      const current=await getDoc(CONFIG(ctx.orgId));
      if(str(current?.data.mode)==='enforce')throw new HttpError(409,'Governance already activated.');
      const active={mode:'enforce',configuredBy:str(proposal.data.configuredBy),
        approvedBy:ctx.uid,approvedAt:nowIso(),coverageDigest:report.digest,
        handlerCount:report.inspected,proposalId:id};
      const created=await writeDoc(CONFIG(ctx.orgId),active,
        current?{updateTime:current.updateTime}:{exists:false});
      if(!created)throw new HttpError(409,'Runtime state changed; cutover was not activated.');
      await writeDoc(path,{...proposal.data,status:'approved',approvedBy:ctx.uid,
        approvedAt:nowIso()});
      await audit([{category:'governance',action:'governance.cutover.activated',actor:ctx.actor,
        meta:ctx.meta,target:{type:'governance_cutover',id},
        details:'Verified '+report.inspected+' endpoints; digest '+report.digest}]);
      return {mode:'enforce',handlerCount:report.inspected,coverageDigest:report.digest};
    }),
  ],
  'POST /api/org/governance/cutover/disable':[
    orgRoute('org.governance.cutover.disable','ADM.workflows',async ctx=>{
      if(ctx.role!=='org_super_admin')throw new HttpError(403,'Only the organization super administrator can use emergency recovery.');
      const reason=reasons(ctx.body.reason);
      const path=CONFIG(ctx.orgId),current=await getDoc(path);
      if(!current||str(current.data.mode)!=='enforce')
        throw new HttpError(409,'Unified governance is not active.');
      const disabled=await writeDoc(path,{...current.data,mode:'inactive',
        disabledAt:nowIso(),disabledBy:ctx.uid,disableReason:reason},
        {updateTime:current.updateTime});
      if(!disabled)throw new HttpError(409,'Runtime changed; retry recovery.');
      await audit([{category:'governance',action:'governance.cutover.emergency_disabled',actor:ctx.actor,
        meta:ctx.meta,target:{type:'governance_runtime',id:ctx.orgId},details:reason}]);
      return {mode:'inactive'};
    }),
  ],
};
