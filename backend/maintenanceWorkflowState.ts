/** Operational state derived from facts; coarse transaction flags remain internal authorization gates. */
import {str,type Obj} from './core';
import {object,rows,texts,isRequestClosureOrder} from './maintenanceDomain';
import {reviewAssessmentPrerequisites} from './maintenanceAssessmentReview';
export const WO_STATES=[
 ['WO010','Awaiting assessment'],['WO020','Awaiting assessment approval'],
 ['WO030','Awaiting spares'],['WO040','Awaiting external services'],['WO050','Awaiting external specialist'],
 ['WO060','Awaiting internal labour'],['WO070','Awaiting tools / competency confirmation'],
 ['WO080','Awaiting risk review'],['WO090','Awaiting planning dates'],
 ['WO100','Awaiting cost submission'],['WO110','Awaiting cost approval'],['WO120','Awaiting readiness confirmation'],
 ['WO130','Awaiting scheduling'],['WO140','Awaiting window authorization / safety prerequisites'],
 ['WO150','Awaiting execution'],['WO160','Execution in progress'],['WO165','Execution blocked'],
 ['WO170','Awaiting execution feedback'],['WO180','Awaiting spares reconciliation'],
 ['WO186','Awaiting outstanding spare receipt / posting'],['WO185','Awaiting service feedback / report'],['WO187','Awaiting service acceptance'],
 ['WO190','Awaiting incident clearance'],['WO200','Awaiting safety sign-off'],['WO210','Awaiting operations handover'],['WO220','Awaiting technical closure'],['WO900','Technically closed'],['WO990','Cancelled']
] as const;
export const WO_STATUS_SHORT:Record<string,string>={WO010:'DWA',WO020:'DAA',WO030:'DWS',WO040:'DSE',WO050:'DXS',WO060:'DIL',WO070:'DTC',WO080:'DRR',WO090:'DPD',WO100:'DCS',WO110:'DCA',WO120:'DRC',WO130:'DSH',WO140:'DWP',WO150:'DWE',WO160:'EXE',WO165:'DEB',WO170:'DWF',WO180:'DSR',WO185:'DSF',WO186:'DGR',WO187:'DSA',WO190:'DIC',WO200:'DSS',WO210:'DOH',WO220:'DWC',WO900:'CLSD',WO990:'CANC'};
export const shortWorkOrderStatus=(code:string)=>WO_STATUS_SHORT[code]||code;
export type StateCode=typeof WO_STATES[number][0];
export type FactSet={approved?:boolean;items?:Obj[];checklist?:Obj[];costStatus?:string;windowStatus?:'missing'|'blocked'|'ready';openIncident?:boolean;closureResource?:{code:'WO185'|'WO186'|'WO187'|'WO180';reason:string}};
export function stateOf(d:Obj,f:FactSet):{code:StateCode;label:string;reason:string}{
 const make=(code:StateCode,reason='')=>({code,label:WO_STATES.find(x=>x[0]===code)![1],reason});
 const status=str(d.status),tasks=rows(d.assessmentTasks),exec=object(d.taskExecution),plan=object(d.taskPlanning);
 if(status==='closed')return make('WO900',d.closureMode==='early'?'Closed early; unfinished work was not certified complete':'');if(status==='cancelled')return make('WO990');
 const retrospective=isRequestClosureOrder(d);
 if(!retrospective&&['planning','plan_ready','released','scheduled'].includes(status)){
  if(!f.approved){if(!tasks.length||reviewAssessmentPrerequisites(d,'__workflow__')||object(d.assessmentReview).status==='changes_requested')return make('WO010','Complete or correct assessment');return make('WO020','Independent approval of current assessment');}
  const items=f.items||[],openSpare=items.find(i=>i.spareId&&i.status!=='reserved'),openService=items.find(i=>i.kind==='service'&&i.status!=='secured');
  if(openSpare)return make('WO030',str(openSpare.description)||str(openSpare.status));
  if(openService)return make('WO040',str(openService.description)||str(openService.status));
  if(tasks.some(t=>object(t.externalResource).type&&!object(object(plan[str(t.id)]).externalSpecialist).at))return make('WO050','Secure each assessed external specialist requirement');
  if(tasks.some(t=>texts(object(object(plan[str(t.id)]).allocation).personnel).length<Number(t.persons)))return make('WO060','Allocate qualified internal personnel');
  if(tasks.some(t=>{const a=object(object(plan[str(t.id)]).allocation);return a.toolsReady!==true||a.competenciesConfirmed!==true;}))return make('WO070','Confirm tools and competency coverage');
  const done=(key:string)=>f.checklist?.some(x=>x.key===key&&x.done===true);
  if(!done('risk'))return make('WO080');if(!done('schedule'))return make('WO090');
  if(!done('cost'))return make(f.costStatus==='pending'?'WO110':'WO100',f.costStatus||'');
  if(['planning','plan_ready'].includes(status))return make('WO120');
  if(status==='released'||f.windowStatus==='missing')return make('WO130');
  if(f.windowStatus==='blocked')return make('WO140');
  return make('WO150');
 }
 const pending=tasks.filter(t=>object(exec[str(t.id)]).status!=='completed');
 if(retrospective&&pending.length)return make('WO170','Named performer confirms completed work');
 if(pending.length){
  if(pending.some(t=>object(exec[str(t.id)]).status==='in_progress'))return make('WO160');
  if(pending.some(t=>object(exec[str(t.id)]).status==='blocked'))return make('WO165','Resolve recorded task block');
  if(pending.some(t=>object(exec[str(t.id)]).status==='awaiting_feedback'&&rows(t.services).some(s=>!str(object(object(object(d.serviceReports)[str(t.id)])[str(s.id)]).path))))return make('WO185','Attach outstanding external service reports');
  if(pending.some(t=>object(exec[str(t.id)]).status==='awaiting_feedback'))return make('WO170','Record completed work feedback');
  if(f.windowStatus==='missing')return make('WO130','Schedule remaining tasks');
  if(f.windowStatus==='blocked')return make('WO140');
  return make('WO150');
 }
 if(tasks.some(t=>object(exec[str(t.id)]).reconciled!==true))return make('WO180');
 if(f.openIncident)return make('WO190');
 if(f.closureResource)return make(f.closureResource.code,f.closureResource.reason);
 if(tasks.some(t=>rows(t.services).some(s=>!rows(object(object(exec[str(t.id)]).feedback).services).some(v=>v.id===s.id&&v.accepted===true)||!str(object(object(object(d.serviceReports)[str(t.id)])[str(s.id)]).path))))return make('WO185','Complete service feedback and attach reports');
 if(!object(d.safetySignoff).at)return make('WO200');
 return make('WO200','Finalize closure from recorded safety sign-off');
}
export function transitionPatch(d:Obj,state:ReturnType<typeof stateOf>,at:string,by:string,byName:string,source:string):Obj{
 const previous=str(d.workflowCode);
 if(previous===state.code)return {workflowCode:state.code,workflowStatusCode:shortWorkOrderStatus(state.code),workflowLabel:state.label,workflowSince:str(d.workflowSince)||at,workflowReason:state.reason,workflowTransitions:rows(d.workflowTransitions)};
 return {workflowCode:state.code,workflowStatusCode:shortWorkOrderStatus(state.code),workflowLabel:state.label,workflowReason:state.reason,workflowSince:at,workflowTransitions:[...rows(d.workflowTransitions),{from:previous,to:state.code,fromStatusCode:shortWorkOrderStatus(previous),toStatusCode:shortWorkOrderStatus(state.code),label:state.label,reason:state.reason,at,by,byName,source}]};
}
