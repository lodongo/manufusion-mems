/** Operational maintenance permissions, independent of route initialization. */
import {RETIRED_MAINTENANCE_KEYS} from './maintenanceWorkflowConfig';
export const MNT_ACTIVITIES: Array<{ key: string; label: string }> = [
    { key: 'MNT.view', label: 'View work requests and work orders' },
    { key: 'MNT.WR.create', label: 'Work request: raise' },
    { key: 'MNT.WR.edit', label: 'Work request: edit own (before saved assessment) and resubmit' },
    { key: 'MNT.WR.cancel', label: 'Work request: cancel own (before saved assessment)' },
    { key: 'MNT.WR.review', label: 'Work request: review and confirm into a Work Order' },
    { key: 'MNT.WR.return', label: 'Work request: return to requester for information' },
    { key: 'MNT.WR.decline', label: 'Work request: decline' },
    { key: 'MNT.WR.close', label: 'Work request: close at review when no planning is needed (cause, solution, type)' },
    { key: 'MNT.WR.closeConfirm', label: 'Work request: confirm or reject a closure made at review' },
    { key: 'MNT.assessment.review', label: 'Work assessment: approve or return independently' },
    { key: 'MNT.assessment.edit', label: 'Work assessment: create and edit individual task requirements' },
    { key: 'MNT.WR.convert', label: 'Legacy assessment: convert historical request to work order' },
    { key: 'MNT.WO.plan', label: 'Work order: plan tasks, people, spares and services' },
    { key: 'MNT.WO.safety', label: 'Work order: safety sign-off and automatic closure' },
    { key: 'MNT.WO.release', label: 'Work order: release for execution' },
    { key: 'MNT.WO.schedule', label: 'Work order: schedule and assign' },
    { key: 'MNT.WO.execute', label: 'Work order: execute (start, book time and spares, complete)' },
    { key: 'MNT.WO.verify', label: 'Work order: verify completed work' },
    { key: 'MNT.WO.close', label: 'Work order: early closure and break-in sub-order creation' },
    { key: 'MNT.WO.cancel', label: 'Work order: cancel' },
    { key: 'MNT.WO.reopen', label: 'Work order: reopen' },
    { key: 'MNT.WO.costApprove', label: 'Work order: approve the estimated cost under the Chart of Authority' },
    { key: 'MNT.budget.manage', label: 'Maintenance budget: propose period budgets for cost centers' },
    { key: 'MNT.activities.view', label: 'Assembly activities: view PM/AM activities' },
    { key: 'MNT.activities.edit', label: 'Assembly activities: define PM/AM activities' },
    { key: 'MNT.admin', label: 'Administer maintenance settings' },
];

export const CURRENT_MNT_ACTIVITIES=MNT_ACTIVITIES.filter(a=>!RETIRED_MAINTENANCE_KEYS.has(a.key));
