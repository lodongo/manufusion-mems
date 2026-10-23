/** Fail-closed HR tab policy. Organization rules may narrow defaults, never broaden protected scopes. */
export const HR_TABS=[
 'basic','education','family','skills','roleSkills','deployment','records','roles','payslips',
 'talent','leave','capability','performance','learning','history'
] as const;
export type HrTab=typeof HR_TABS[number];
export type HrScope='self'|'manager'|'hr'|'superadmin';
export type HrRules={selfTabs:HrTab[];managerTabs:HrTab[];hrTabs:HrTab[];managerIndirectReports:boolean;schemaVersion:2};
const immutable:Record<HrScope,readonly HrTab[]>={
 self:['basic','education','family','skills','roleSkills','deployment','roles','payslips','leave','capability','performance','learning'],
 manager:['basic','skills','roleSkills','deployment','roles','leave','capability','performance'],
 hr:['basic','education','skills','roleSkills','deployment','records','roles','talent','leave','capability','performance','learning','history'],
 superadmin:HR_TABS,
};
export const HR_RULE_DEFAULTS:HrRules={
 selfTabs:['basic','education','family','skills','roleSkills','deployment','roles','payslips','leave','capability','performance','learning'],
 managerTabs:['basic','skills','roleSkills','deployment','roles','leave','capability','performance'],
 hrTabs:['basic','education','skills','roleSkills','deployment','records','roles','talent','leave','capability','performance','learning','history'],
 managerIndirectReports:false,schemaVersion:2,
};
export function hrRules(data:unknown):HrRules{
 const d=data&&typeof data==='object'&&!Array.isArray(data)?data as Record<string,unknown>:{};
 const tabs=(key:keyof Pick<HrRules,'selfTabs'|'managerTabs'|'hrTabs'>, scope:HrScope):HrTab[]=>{
   if(!Array.isArray(d[key]))return [...HR_RULE_DEFAULTS[key]];
   const allowed=immutable[scope];
   const chosen=[...new Set(d[key].filter((x):x is HrTab=>typeof x==='string'&&allowed.includes(x as HrTab)))];
   // Preserve access for existing tenants with Skills enabled, until a schema-2
   // privacy policy independently approves the explicit new-tab selection.
   if(Number(d.schemaVersion||0)<2&&chosen.includes('skills')&&!chosen.includes('roleSkills'))
     chosen.splice(chosen.indexOf('skills')+1,0,'roleSkills');
   return chosen;
 };
 return {selfTabs:tabs('selfTabs','self'),managerTabs:tabs('managerTabs','manager'),hrTabs:tabs('hrTabs','hr'),
  managerIndirectReports:d.managerIndirectReports===true,schemaVersion:2};
}
export function hrVisibleTabs(scope:HrScope,rules:HrRules):HrTab[]{
 if(scope==='superadmin')return [...HR_TABS];
 if(scope==='self')return rules.selfTabs.filter(x=>immutable.self.includes(x));
 if(scope==='manager')return rules.managerTabs.filter(x=>immutable.manager.includes(x));
 return rules.hrTabs.filter(x=>immutable.hr.includes(x));
}
export function hrMayAccess(scope:HrScope,tab:HrTab,rules:HrRules):boolean{
 return hrVisibleTabs(scope,rules).includes(tab);
}
/** Employee self-service is role-neutral: Super Administrators have the same
 * personal update rights as every employee. Protected records and approvals
 * never become self-editable through administrative permissions.
 */
export type HrOwnRecordAction=
 'education'|'family'|'skillProposal'|'roleSkillProposal'|'leavePlan'|'leaveApplication'|
 'basic'|'deployment'|'roleAssignment'|'roleDefinition'|'payslip'|'managerApproval'|'privacyApproval';
const selfServiceWrites=new Set<HrOwnRecordAction>([
 'education','family','skillProposal','roleSkillProposal','leavePlan','leaveApplication',
]);
export function hrMayChangeOwnRecord(action:HrOwnRecordAction):boolean{
 return selfServiceWrites.has(action);
}
export function hrMayChangeRecord(actorUid:string,targetUid:string,action:HrOwnRecordAction):boolean{
 // This helper only assesses self-edit restrictions; all other edits must also
 // pass their separate tenant, role, purpose, scope and workflow checks.
 return actorUid!==targetUid||hrMayChangeOwnRecord(action);
}
