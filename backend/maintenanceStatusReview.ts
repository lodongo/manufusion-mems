import {str,type Obj} from './core';
import {shortWorkOrderStatus} from './maintenanceWorkflowState';
import {object,rows,isRequestClosureOrder} from './maintenanceDomain';
const hours=(ms:number)=>Math.max(0,ms)/3600000;
const numeric=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
const waiting=(code:string)=>/^WO(0|1[0-5]|165|17|18|19|2)/.test(code);
/** State dwell is observed elapsed calendar time, not claimed machine downtime or labour hours. */
export function summarizeWorkOrderReview(d:Obj,now:string,dueAt:string|null){
 const nowMs=Date.parse(now),terminal=['closed','cancelled'].includes(str(d.status)),terminalAt=Date.parse(str(d.status==='closed'?d.closedAt:d.cancelledAt)),finish=terminal&&Number.isFinite(terminalAt)?Math.min(nowMs,terminalAt):nowMs;
 const created=Date.parse(str(d.createdAt)),due=dueAt?Date.parse(dueAt):NaN;
 const transitions=rows(d.workflowTransitions).map(e=>({to:str(e.to),label:str(e.label),ms:Date.parse(str(e.at))})).filter(e=>Number.isFinite(e.ms)&&e.ms<=finish).sort((a,b)=>a.ms-b.ms);
 const byState=new Map<string,{code:string;statusCode:string;label:string;hours:number;overdueHours:number;waiting:boolean}>();
 const add=(code:string,label:string,start:number,end:number)=>{if(end<=start)return;const a=byState.get(code)||{code,statusCode:shortWorkOrderStatus(code),label,hours:0,overdueHours:0,waiting:waiting(code)};a.hours+=hours(end-start);if(Number.isFinite(due))a.overdueHours+=hours(end-Math.max(start,due));byState.set(code,a);};
 if(Number.isFinite(created)&&(!transitions.length||created<transitions[0].ms))add('UNKNOWN','Before recorded state history',created,transitions[0]?.ms??finish);
 transitions.forEach((e,i)=>{const code=str(e.to);if(!['WO900','WO990'].includes(code))add(code,str(e.label)||code,e.ms,Math.min(finish,transitions[i+1]?.ms??finish));});
 const tasks=rows(d.assessmentTasks),executions=object(d.taskExecution),plan=object(d.taskPlanning);
 let plannedTaskHours=0,plannedLabourHours=0,actualHours=0,actualReports=0,recordedLabourCost=0,labourUnvalued=0,reconciledSpareCost=0,sparesUnvalued=0,serviceCommitment=0;
 for(const t of tasks){const e=object(executions[str(t.id)]),p=object(plan[str(t.id)]),feedback=object(e.feedback),planned=numeric(t.hours),persons=numeric(t.persons),actual=numeric(feedback.actualHours);
  if(planned!==null){plannedTaskHours+=planned;plannedLabourHours+=planned*(persons??0);}
  if(actual!==null){actualReports++;actualHours+=actual;const rate=numeric(t.rate);if(rate!==null&&rate>0)recordedLabourCost+=actual*rate;else if(actual>0)labourUnvalued++;}
  for(const c of rows(e.consumption)){const cost=numeric(c.unitCost),qty=numeric(c.consumed)??0;if(cost===null&&qty>0)sparesUnvalued++;else reconciledSpareCost+=qty*(cost??0);}
  for(const s of rows(t.services)){const item=object(p[str(s.id)]);if(item.status==='secured')serviceCommitment+=numeric(item.cost)??0;}
 }
 const retrospective=isRequestClosureOrder(d),reportedMinutes=retrospective?numeric(object(d.directCompletion).durationMinutes):null;
 return {asOf:now,finishAt:new Date(finish).toISOString(),leadHours:Number.isFinite(created)?hours(finish-created):null,overdueHours:Number.isFinite(due)?hours(finish-due):null,dueAt,states:[...byState.values()],plannedTaskHours,plannedLabourHours,actualHours:actualReports?actualHours:reportedMinutes!==null?reportedMinutes/60:null,actualReports,recordedLabourCost,labourUnvalued,reconciledSpareCost,sparesUnvalued,serviceCommitment,taskCount:tasks.length,completedTasks:tasks.filter(t=>object(executions[str(t.id)]).status==='completed').length,reconciledTasks:tasks.filter(t=>object(executions[str(t.id)]).reconciled===true).length};
}
