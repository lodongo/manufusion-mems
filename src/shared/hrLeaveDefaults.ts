/** Browser- and server-safe leave defaults. Never import a server module into client bundles. */
export type LeaveGradeEntitlement={
 eligible:boolean;daysPerYear:number;accrueMonthly:boolean;
 unit:'working_days'|'calendar_days'|'months';
 carryForwardDays:number;requiresApprovedPlan:boolean;
};
export const defaultLeaveEntitlement=(mandatory:boolean,amount:number,code:string):LeaveGradeEntitlement=>({
 eligible:mandatory,daysPerYear:amount,accrueMonthly:code==='LEAVE_ANNUAL',
 unit:code==='LEAVE_MATERNITY'?'months':code==='LEAVE_ANNUAL'?'working_days':'calendar_days',
 carryForwardDays:0,requiresApprovedPlan:true,
});
