import test from 'node:test';
import assert from 'node:assert/strict';
import {kenyaCompensationTemplate,validatePayConfig} from '../../backend/hrCompensationConfig.ts';
import {defaultLeaveEntitlement} from '../../src/shared/hrLeaveDefaults.ts';
import {leaveDays} from '../../backend/hrLeaveEligibility.ts';

test('leave per-grade eligibility, annual days and monthly accrual survive compensation validation',()=>{
 const conf=kenyaCompensationTemplate();
 const annual=conf.items.find(x=>x.code==='LEAVE_ANNUAL');
 annual.leaveEntitlements={
  JG01:{...defaultLeaveEntitlement(true,21,annual.code),daysPerYear:24,accrueMonthly:true},
  JG05:{...defaultLeaveEntitlement(true,21,annual.code),daysPerYear:30,accrueMonthly:false},
 };
 const result=validatePayConfig(conf,new Set(['JG01','JG05']),'KE','KES');
 const leave=result.items.find(x=>x.code==='LEAVE_ANNUAL');
 assert.equal(leave.leaveEntitlements.JG01.daysPerYear,24);
 assert.equal(leave.leaveEntitlements.JG01.accrueMonthly,true);
 assert.equal(leave.leaveEntitlements.JG05.daysPerYear,30);
 assert.equal(leave.leaveEntitlements.JG05.accrueMonthly,false);
 assert.equal(leave.leaveEntitlements.JG01.requiresApprovedPlan,true);
});
test('Kenya mandatory annual leave cannot be disallowed or reduced for a job grade',()=>{
 const conf=kenyaCompensationTemplate();
 const annual=conf.items.find(x=>x.code==='LEAVE_ANNUAL');
 annual.leaveEntitlements={JG01:{...defaultLeaveEntitlement(true,21,annual.code),eligible:false}};
 assert.throws(()=>validatePayConfig(conf,new Set(['JG01']),'KE','KES'),/Mandatory Kenya leave/);
 annual.leaveEntitlements.JG01.eligible=true;
 annual.leaveEntitlements.JG01.daysPerYear=15;
 assert.throws(()=>validatePayConfig(conf,new Set(['JG01']),'KE','KES'),/21 working days/);
});
test('other leave types may vary by grade but cannot bypass approved plan prerequisite',()=>{
 const conf=kenyaCompensationTemplate();
 const item=conf.items.find(x=>x.code==='LEAVE_STUDY');
 item.enabled=true;
 item.leaveEntitlements={
  JG01:{...defaultLeaveEntitlement(false,0,item.code),eligible:false},
  JG05:{...defaultLeaveEntitlement(false,6,item.code),eligible:true,daysPerYear:6,requiresApprovedPlan:false},
 };
 const validated=validatePayConfig(conf,new Set(['JG01','JG05']),'KE','KES');
 const study=validated.items.find(x=>x.code==='LEAVE_STUDY');
 assert.equal(study.leaveEntitlements.JG01.eligible,false);
 assert.equal(study.leaveEntitlements.JG05.daysPerYear,6);
 assert.equal(study.leaveEntitlements.JG05.requiresApprovedPlan,true);
});
test('annual working-day leave counts Monday–Friday rather than all calendar days',()=>{
 assert.equal(leaveDays('2026-11-09','2026-11-13','working_days'),5);
 assert.equal(leaveDays('2026-11-09','2026-11-15','working_days'),5);
 assert.equal(leaveDays('2026-11-09','2026-11-15','calendar_days'),7);
});
