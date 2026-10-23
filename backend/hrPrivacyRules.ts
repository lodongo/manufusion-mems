/** Fail-closed HR tab policy. Organization rules may narrow defaults, never broaden protected scopes. */
export const HR_TABS=[
 'basic','education','family','skills','deployment','records','roles','payslips',
 'talent','leave','capability','performance','learning','history'
] as const;
export type HrTab=typeof HR_TABS[number];
export type HrScope='self'|'manager'|'hr'|'superadmin';
export type HrRules={selfTabs:HrTab[];managerTabs:HrTab[];hrTabs:HrTab[];managerIndirectReports:boolean};
const immutable:Record<HrScope,readonly HrTab[]>={
 self:['basic','education','family','skills','deployment','roles','payslips','leave','capability','performance','learning'],
 manager:['basic','skills','deployment','roles','leave','capability','performance'],
 hr:['basic','education','skills','deployment','records','roles','talent','leave','capability','performance','learning','history'],
 superadmin:HR_TABS,
};
export const HR_RULE_DEFAULTS:HrRules={
 selfTabs:['basic','education','family','skills','deployment','roles','payslips','leave','capability','performance','learning'],
 managerTabs:['basic','skills','deployment','roles','leave','capability','performance'],
 hrTabs:['basic','education','skills','deployment','records','roles','talent','leave','capability','performance','learning','history'],
 managerIndirectReports:false,
};
export function hrRules(data:unknown):HrRules{
 const d=data&&typeof data==='object'&&!Array.isArray(data)?data as Record<string,unknown>:{};
 const tabs=(key:keyof Pick<HrRules,'selfTabs'|'managerTabs'|'hrTabs'>, scope:HrScope):HrTab[]=>{
   if(!Array.isArray(d[key]))return [...HR_RULE_DEFAULTS[key]];
   const allowed=immutable[scope];
   return [...new Set(d[key].filter((x):x is HrTab=>typeof x==='string'&&allowed.includes(x as HrTab)))];
 };
 return {selfTabs:tabs('selfTabs','self'),managerTabs:tabs('managerTabs','manager'),hrTabs:tabs('hrTabs','hr'),
  managerIndirectReports:d.managerIndirectReports===true};
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
export function hrAssertNotSelfWrite(actorUid:string,targetUid:string,role:string){
 if(role==='org_super_admin'&&actorUid===targetUid)throw new Error('Organization Super Administrators cannot modify or approve their own HR records.');
}
