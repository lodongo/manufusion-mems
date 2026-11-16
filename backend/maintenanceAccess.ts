import { HttpError, getDoc, isObj, nowIso, str, type Doc } from './core';
import { canAt, scopeOf } from './access';
import type { OrgContext } from './guards';
import { object, rows, texts } from './maintenanceDomain';
import { bypass } from './testModeCore';
import {groupAt,groupGateRole,workGroupGateAllowed} from './maintenanceWorkGroupPolicy';
export function configuredMaintenanceRole(ctx:OrgContext,gate:string,path:string[],legacy:unknown):string {
 const group=groupGateRole(ctx.workGroupPolicy,gate,path,ctx.role==='org_super_admin'&&ctx.testMode===true);return group===null?str(object(legacy)[gate]):group;
}

export async function requireMaintenanceRole(ctx: OrgContext, gate: string, path: string[]) {
    const groupRole=groupGateRole(ctx.workGroupPolicy,gate,path);
    const testing=ctx.role==='org_super_admin'&&ctx.testMode===true;
    if(groupRole!==null&&testing){
      const token=groupGateRole(ctx.workGroupPolicy,gate,path,true);
      if(token&&!workGroupGateAllowed(ctx.workGroupPolicy,gate,path)&&bypass(ctx,'mnt.work_group.gate.'+gate))return {role:token,version:ctx.workGroupPolicy!.config.version};
    }
    if(groupRole!==null){
      if(!groupRole)throw new HttpError(409,'Configure '+gate+' in active Work Groups master setup.');
      if(!workGroupGateAllowed(ctx.workGroupPolicy,gate,path))throw new HttpError(403,'The named Work Group employee assigned to '+gate+' is required at this location.');
      return {role:groupRole,version:ctx.workGroupPolicy!.config.version};
    }
    const settings = await getDoc(`organizations/${ctx.orgId}/maintenance_workflow_settings/default`);
    const role = str(object(settings?.data.approverRoles)[gate]);
    // Configuration is never relaxed. The platform testing override only relaxes HOLDING the configured job role.
    if (!role) throw new HttpError(409, `Configure ${gate} in Maintenance Workflows before proceeding.`);
    const today = nowIso().slice(0, 10);
    if (
        !rows(ctx.me.data.assignments).some(
            (a) =>
                a.positionCode === role &&
                path.includes(str(a.nodeId)) &&
                (!str(a.startsOn) || str(a.startsOn) <= today) &&
                (!str(a.endsOn) || str(a.endsOn) >= today),
        ) &&
        !bypass(ctx, `mnt.gate.${gate}`)
    )
    {
        // Name the job role so the person knows what to ask for. Super admins are not exempt (maker-checker).
        const position = await getDoc(`organizations/${ctx.orgId}/positions/${role}`);
        const title = str(position?.data.title) || str(position?.data.name);
        const label = title ? `${title} (${role})` : role;
        const admin = ctx.role === 'org_super_admin'
            ? ' Organization super admins are not exempt: assign yourself this job role at the equipment\'s location (Users › Job roles and scope), or use the platform testing override in development.'
            : '';
        throw new HttpError(403, `The configured ${gate} organizational job role ${label} is required at this location.${admin}`);
    }
    return { role, version: Number(settings?.data.version) || 0 };
}
export async function maintenancePermission(ctx: OrgContext, permission: string, path: string[]) {
    if (!isObj(ctx.org.data.modules) || ctx.org.data.modules.MNT !== true)
        throw new HttpError(403, 'Maintenance Management is not enabled.');
    if (!canAt(ctx, permission, path, await scopeOf(ctx))) throw new HttpError(403, `${permission} is required at this location.`);
}
export const maintenancePath = (d: { path?: unknown }) => texts(d.path);

import {maintenanceAssessmentApprovalRequired} from './maintenanceGovernancePolicy';
import {stageApprovalPending} from './maintenanceStageApproval';
/** One edit-authority check for the work order screen, draft and final submission. No saved assessment is required. */
export async function requireWorkOrderAssessor(ctx:OrgContext,wo:Doc){
 const d=wo.data,path=maintenancePath(d);
 if(str(d.status)!=='planning'||d.executionMode==='request_closure')throw new HttpError(409,'This work order is not in the assessment/planning stage.');
 if(object(d.earlyClosureRequest).at)throw new HttpError(409,'Early closure is already in progress.');
 if(stageApprovalPending(d,'before_assessment'))throw new HttpError(409,'Work order approval is required before assessment.');
 if(['approved','pending'].includes(str(object(d.assessmentReview).status)))throw new HttpError(409,'Assessment has been submitted for approval or approved. Use controlled reassessment where applicable.');
 if(Object.keys(object(d.taskPlanning)).length)throw new HttpError(409,'Task planning has already been recorded. Open controlled reassessment before editing.');
 await maintenancePermission(ctx,'MNT.assessment.edit',path);
 if(groupAt(ctx.workGroupPolicy,path))await requireMaintenanceRole(ctx,'MNT.WR.ASSESS',path);
 if(maintenanceAssessmentApprovalRequired(d)&&workGroupGateAllowed(ctx.workGroupPolicy,'MNT.ASSESS.REVIEW',path)===true&&!(ctx.role==='org_super_admin'&&bypass(ctx,'mnt.assessment.assessor_reviewer_separation')))throw new HttpError(403,'The independent assessment reviewer cannot also assess this work order.');
}
