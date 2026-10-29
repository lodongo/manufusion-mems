/**
 * Controlled maintenance workflow configuration defaults.
 * Gates are enforced by the task assessment, shared inventory/procurement and
 * maintenance operations handlers. Required roles fail closed until configured.
 */
export type MntStage = 'request'|'assessment'|'conversion'|'planning'|'scheduling'|'execution'|'closure';
export interface MntGate {
 code:string;stage:MntStage;label:string;mode:'permission'|'approval'|'verification'|'automated';
 permission:string|null;status:'existing'|'pending_implementation';
 requires:string[];owner:string;separation:string;
}
export const MAINTENANCE_GATES:readonly MntGate[] = [
 {code:'MNT.WO.PLAN',stage:'planning',label:'Secure assessed task resources and schedule work',mode:'permission',permission:'MNT.WO.plan',status:'existing',requires:['work_assessment_completed'],owner:'Configured maintenance planner',separation:'Technical scope changes require controlled reassessment'},
 {code:'MNT.WR.CREATE',stage:'request',label:'Create a work request',mode:'permission',permission:'MNT.WR.create',status:'existing',requires:[],owner:'Any permitted employee',separation:'No maker/checker'},
 {code:'MNT.WR.CLOSE',stage:'request',label:'Close a request at review when no planning is needed (cause, solution, maintenance type)',mode:'approval',permission:'MNT.WR.close',status:'existing',requires:['cause','solution','maintenance_type','description'],owner:'Artisan reviewer; confirmed by a supervisor (MNT.WR.closeConfirm)',separation:'The person who closes cannot confirm the closure'},
 {code:'MNT.WR.ASSESS',stage:'assessment',label:'Complete open work assessment',mode:'permission',permission:'MNT.assessment.edit',status:'existing',requires:['request_present','tasks_and_resources_captured','task_risk_assessment_completed'],owner:'Any authenticated organization employee with work-request access at the equipment',separation:'No separate assessor authorization or second-person approval'},
 {code:'MNT.ASSESS.REVIEW',stage:'assessment',label:'Independently approve completed task work assessment',mode:'approval',permission:'MNT.assessment.review',status:'existing',requires:['assessment_details_complete','all_tasks_risk_assessed','independent_reviewer','current_assessment_version'],owner:'Configured Maintenance Supervisor or Engineer reviewer',separation:'Reviewer must not be requester, creator or assessor; changes invalidate approval'},
 {code:'MNT.TASK.VALIDATE',stage:'assessment',label:'Validate new reusable asset task',mode:'approval',permission:null,status:'existing',requires:['task_risk_assessment_completed'],owner:'Configured asset-task validator',separation:'Cannot validate an unassessed task'},
 {code:'MNT.WR.CONVERT',stage:'conversion',label:'Convert assessed work request to work order',mode:'permission',permission:'MNT.WR.convert',status:'existing',requires:['work_assessment_completed'],owner:'Configured conversion role',separation:'Creator cannot convert own request under legacy policy'},
 {code:'MNT.MAT.CREATE',stage:'planning',label:'Approve newly specified material',mode:'approval',permission:'PRC.materials.manage',status:'existing',requires:['material_creation_workflow_completed'],owner:'Configured material master approver',separation:'Creator does not approve own material'},
 {code:'MNT.SPARES.RESERVE',stage:'planning',label:'Reserve approved work-order spares',mode:'automated',permission:null,status:'existing',requires:['warehouse_stock_confirmed','quantity_available'],owner:'Inventory / Stores',separation:'Reservation is not stock consumption'},
 {code:'MNT.SHORTAGE.SOURCE',stage:'planning',label:'Raise purchase requirement for stock shortage',mode:'permission',permission:'PRC.create',status:'existing',requires:['shortage_exists','approved_material'],owner:'Stores and Procurement',separation:'Procurement approval chain applies'},
 {code:'MNT.WO.RELEASE',stage:'planning',label:'Confirm work order readiness (spares, services, people, schedule, risk review, cost)',mode:'verification',permission:'MNT.WO.plan',status:'existing',requires:['spares_reserved','services_secured','people_and_tools_allocated','schedule_locked','risk_reviewed','cost_approved_chart_of_authority'],owner:'Configured maintenance planner (MNT.WO.PLAN)',separation:'The estimated cost is approved under the Chart of Authority by someone other than the planner'},
 {code:'MNT.WO.COST',stage:'planning',label:'Approve the work order estimated cost against the period maintenance budget',mode:'approval',permission:'MNT.WO.costApprove',status:'existing',requires:['estimate_complete','budget_or_justification'],owner:'Chart of Authority levels of the legal entity (job roles)',separation:'Never the planner who estimated it; a person approves only one level'},
 {code:'MNT.WINDOW.LOCK',stage:'scheduling',label:'Schedule an equipment maintenance window (date, start time, duration)',mode:'verification',permission:'MNT.WO.schedule',status:'existing',requires:['readiness_confirmed','same_equipment','work_fits_duration'],owner:'Configured maintenance planner (MNT.WO.PLAN)',separation:'No separate approval: readiness and cost approval come first; changes after scheduling require the planner to save the window again'},
 {code:'MNT.TASK.FEEDBACK',stage:'execution',label:'Record feedback for every work-order task and service',mode:'permission',permission:'MNT.WO.execute',status:'existing',requires:['all_tasks_accounted_for','service_delivery_feedback'],owner:'Work executor',separation:'Cannot complete without task feedback'},
 {code:'MNT.SPARES.RECONCILE',stage:'closure',label:'Reconcile actual spares and update applicable equipment BOM',mode:'verification',permission:null,status:'existing',requires:['stock_issues_reconciled','returns_recorded','installed_items_identified'],owner:'Maintenance / Stores',separation:'Only confirmed installed parts are BOM candidates'},
 {code:'MNT.SAFETY.SIGNOFF',stage:'closure',label:'Safety sign-off with explicit incident/near-miss declaration',mode:'approval',permission:null,status:'existing',requires:['tasks_completed','incident_declaration_explicit','incident_record_if_reported','safety_clearance'],owner:'Configured safety signatory',separation:'Cannot be assumed from silence'},
 {code:'MNT.HANDOVER',stage:'closure',label:'Equipment handover',mode:'verification',permission:null,status:'existing',requires:['safety_signed_off','functional_checks','accepting_party'],owner:'Configured operations receiving role',separation:'Handover follows safety sign-off'},
 {code:'MNT.WO.TECHNICAL_CLOSE',stage:'closure',label:'Technical Manager final work-order closure',mode:'approval',permission:'MNT.WO.close',status:'existing',requires:['all_task_feedback','spares_reconciled','safety_signed_off','equipment_handed_over'],owner:'Configured Technical Manager',separation:'Permission and configured technical-manager role both required'}
] as const;

export function maintenanceGateReadiness(configuredRoles:Readonly<Record<string,string>>,gates:readonly MntGate[]=MAINTENANCE_GATES){
 const ownerRoles=['MNT.ASSESS.REVIEW','MNT.SPARES.RECONCILE','MNT.WO.PLAN','MNT.TASK.FEEDBACK','MNT.WR.CONVERT','MNT.TASK.VALIDATE','MNT.SAFETY.SIGNOFF','MNT.HANDOVER','MNT.WO.TECHNICAL_CLOSE'];
 return gates.map(g=>({
  ...g,
  configuredRole:configuredRoles[g.code]||'',
  roleRequired:ownerRoles.includes(g.code),
  ready:g.status==='existing'&&(!ownerRoles.includes(g.code)||!!configuredRoles[g.code])
 }));
}

