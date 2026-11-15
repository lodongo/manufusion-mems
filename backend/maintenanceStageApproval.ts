/** Stage-specific maintenance approval uses the existing role and scope controls, not a new role registry. */
import {HttpError,str,nowIso,type Obj,type Doc} from './core';
import {object,texts} from './maintenanceDomain';
import {configuredOrderApprovalStage,readMaintenancePolicySnapshot} from './maintenanceGovernancePolicy';
import {approvalInput,stageApprovalFingerprint} from './maintenanceApprovalFlowCore';
export {stageApprovalFingerprint} from './maintenanceApprovalFlowCore';
import {decideMaintenanceFlow,flowPlain} from './maintenanceApprovalFlow';
import {maintenancePermission,requireMaintenanceRole} from './maintenanceAccess';
import {bypass} from './testModeCore';
import type {OrgContext} from './guards';

export type Stage=NonNullable<ReturnType<typeof configuredOrderApprovalStage>>;
export const STAGE_LABELS:Record<Stage,string>={before_assessment:'Before assessment',after_readiness:'After resource readiness',before_execution:'Before execution'};
export const STAGE_CODES:Record<Stage,string>={before_assessment:'WO015',after_readiness:'WO125',before_execution:'WO145'};
export function stageApprovalCurrent(d:Obj,stage:Stage):boolean{
 const a=object(d.stageApproval);
 return a.status==='approved'&&a.stage===stage&&!!str(a.by)&&!!str(a.jobRole)&&a.fingerprint===stageApprovalFingerprint(d,stage,Number(a.fingerprintSchema)||1);
}
export function stageApprovalPending(d:Obj,stage:Stage):boolean{
 return configuredOrderApprovalStage(d)===stage&&!stageApprovalCurrent(d,stage);
}
export function stageReached(d:Obj,stage:Stage):boolean{
 if(['closed','cancelled'].includes(str(d.status)))return false;
 if(stage==='before_assessment')return d.status==='planning'&&!object(d.earlyClosureRequest).at;
 if(stage==='after_readiness')return ['released','scheduled','in_progress'].includes(str(d.status))&&!!object(d.readiness).at;
 return ['scheduled','in_progress'].includes(str(d.status))&&!!object(d.readiness).at&&(!!str(d.windowId)||Object.keys(object(d.taskWindows)).length>0);
}
export async function requireStageApproval(ctx:OrgContext,wo:Doc,stage:Stage){
 if(configuredOrderApprovalStage(wo.data)!==stage)return;
 // Authority is verified at the time of approval; valid historical decisions are preserved.
 if(!stageApprovalCurrent(wo.data,stage))throw new HttpError(409,'Work order approval required: '+STAGE_LABELS[stage]+'.');
}
export async function approveStage(ctx:OrgContext,wo:Doc):Promise<Obj>{
 const d=wo.data,stage=configuredOrderApprovalStage(d);
 if(!stage||!stageReached(d,stage))throw new HttpError(409,'This approval stage is not currently available.');
 if(stageApprovalCurrent(d,stage))throw new HttpError(409,'The current work order stage is already approved.');
 const path=texts(d.path);await maintenancePermission(ctx,'MNT.assessment.review',path);
 const role=await requireMaintenanceRole(ctx,'MNT.ASSESS.REVIEW',path);
 const excluded=[d.requestedBy,d.createdBy,...(stage==='before_assessment'?[]:[d.assessedBy,d.assessmentTasksBy,d.plannedBy,object(d.readiness).by])].map(str).filter(Boolean);
 if(excluded.includes(ctx.uid)&&!bypass(ctx,'mnt.wo.stage_approval.independence'))throw new HttpError(403,'An independent authorized approver is required.');
 const note=str(ctx.body.note).trim().slice(0,500);
 if(note.length<10)throw new HttpError(400,'Enter approval notes (at least 10 characters).');
 const input=approvalInput(d,'workOrder'),flow=await decideMaintenanceFlow(ctx,wo,'workOrder',input.payload,input.startedAt,input.previous,input.exclude,'approve',note);
 return {status:flow?flow.status:'approved',...(flow?{flow:flowPlain(flow)}:{}),stage,by:ctx.uid,name:[str(ctx.me.data.firstName),str(ctx.me.data.lastName)].filter(Boolean).join(' ')||ctx.uid,jobRole:role.role,at:nowIso(),note,fingerprint:stageApprovalFingerprint(d,stage),fingerprintSchema:2,policyVersion:readMaintenancePolicySnapshot(d.maintenanceGovernance)!.version};
}
