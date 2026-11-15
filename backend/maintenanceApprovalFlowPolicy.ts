/** Configuration for the shared enterprise approval proof engine. No independent decision engine. */
import {quorumCount,type ApprovalQuorum} from './governanceCore';
export type FlowStep={stream:string;level:number;quorum:ApprovalQuorum;approverUids:string[]};
export type Alternate={principalUid:string;alternateUid:string;mode:'delegation'|'escalation';startsAt:string;endsAt:string;afterHours:number};
export type ApprovalFlow={steps:FlowStep[];alternates:Alternate[]};
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const uid=(v:unknown):string=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(v))throw Error('Choose a valid employee.');return v;};
export function validateApprovalFlow(v:unknown):ApprovalFlow{
 const d=obj(v);
 if(!Array.isArray(d.steps)||!d.steps.length||d.steps.length>12||!Array.isArray(d.alternates)||d.alternates.length>30)throw Error('Configure 1–12 approval levels and at most 30 alternate assignments.');
 const seen=new Set<string>(),steps:FlowStep[]=d.steps.map(raw=>{
  const s=obj(raw),stream=typeof s.stream==='string'?s.stream.trim():'',level=Number(s.level),q=obj(s.quorum);
  if(!/^[A-Za-z0-9_-]{1,30}$/.test(stream)||!Number.isSafeInteger(level)||level<1||level>12||seen.has(stream+':'+level))throw Error('Use distinct stream names and contiguous numbered levels.');
  seen.add(stream+':'+level);
  if(!['any','all','count','percent'].includes(String(q.mode)))throw Error('Choose an approval threshold.');
  const quorum:ApprovalQuorum={mode:q.mode as ApprovalQuorum['mode'],...(['count','percent'].includes(String(q.mode))?{value:Number(q.value)}:{})};
  if(!Array.isArray(s.approverUids)||s.approverUids.length>100)throw Error('Choose up to 100 named approvers or use all scoped role holders.');
  const approverUids=[...new Set(s.approverUids.map(uid))];
  quorumCount(quorum,approverUids.length||100);
  return {stream,level,quorum,approverUids};
 });
 for(const step of steps)for(let i=1;i<step.level;i++)if(!seen.has(step.stream+':'+i))throw Error('Approval levels must start at 1 with no gaps in each stream.');
 const assigned=new Set<string>(),principals=new Set(steps.flatMap(s=>s.approverUids));
 const alternates:Alternate[]=d.alternates.map(raw=>{
  const a=obj(raw),principalUid=uid(a.principalUid),alternateUid=uid(a.alternateUid),mode=a.mode;
  if(principalUid===alternateUid||assigned.has(alternateUid)||principals.has(alternateUid)||!['delegation','escalation'].includes(String(mode)))throw Error('An alternate must be a distinct employee, not a named principal or another alternate assignment.');
  assigned.add(alternateUid);
  const startsAt=typeof a.startsAt==='string'?a.startsAt:'',endsAt=typeof a.endsAt==='string'?a.endsAt:'',afterHours=Number(a.afterHours)||0;
  if(mode==='delegation'&&(!Number.isFinite(Date.parse(startsAt))||!Number.isFinite(Date.parse(endsAt))||Date.parse(endsAt)<=Date.parse(startsAt)))throw Error('Delegation requires a valid start and end.');
  if(mode==='escalation'&&(!Number.isFinite(afterHours)||afterHours<1||afterHours>8760))throw Error('Escalation requires 1–8760 elapsed hours.');
  return {principalUid,alternateUid,mode:mode as Alternate['mode'],startsAt:mode==='delegation'?new Date(startsAt).toISOString():'',endsAt:mode==='delegation'?new Date(endsAt).toISOString():'',afterHours:mode==='escalation'?afterHours:0};
 });
 if(alternates.some(a=>assigned.has(a.principalUid)))throw Error('Nested or chained alternate assignments are not supported.');
 return {steps,alternates};
}
