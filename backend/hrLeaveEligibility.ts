import {HttpError,getDoc,isObj,str} from './core';
import {legalEntityForEmployee} from './hrEducationConfig';
import {defaultLeaveEntitlement, type LeaveGradeEntitlement, type PayConfig, type PayItem} from './hrCompensationConfig';

export type LeaveOption={
 code:string;name:string;gradeCode:string;daysPerYear:number;accrueMonthly:boolean;
 monthlyAccrual:number;unit:LeaveGradeEntitlement['unit'];carryForwardDays:number;
 requiredPlan:true;mandatory:boolean;description:string;
};
export type LeaveEligibility={
 legalEntityId:string;jobRoleCode:string;jobRoleTitle:string;gradeCode:string;
 legalEntityName:string;options:LeaveOption[];payConfigVersion:number;
};
const collection=(org:string,entity:string)=>`organizations/${org}/hr_compensation_config/${entity}`;
export const leaveDays=(start:string,end:string,unit:LeaveGradeEntitlement['unit'])=>{
 const from=Date.parse(start+'T00:00:00Z'),to=Date.parse(end+'T00:00:00Z');
 if(!Number.isFinite(from)||!Number.isFinite(to)||start>end)
   throw new HttpError(400,'Select valid leave dates.');
 let count=0;
 for(let ms=from;ms<=to;ms+=86400000){
  const day=new Date(ms).getUTCDay();
  if(unit==='calendar_days'||unit==='months'||(day!==0&&day!==6))count++;
 }
 // Month-valued entitlements cannot be converted from days to legal months
 // without a complete period-specific country rule, so use days only for
 // capacity displays and rely on explicit plan dates for those entitlements.
 return count;
};
export async function leaveEligibility(org:string,employee:Record<string,unknown>):Promise<LeaveEligibility>{
 const legal=await legalEntityForEmployee(org,employee);
 if(!legal)throw new HttpError(409,'Assign exactly one primary legal entity before requesting leave.');
 const assignments=Array.isArray(employee.assignments)?employee.assignments.filter(isObj):[];
 const primary=assignments.filter(a=>str(a.type)==='primary'&&str(a.positionCode));
 if(primary.length!==1)throw new HttpError(409,'Assign one primary job role to calculate leave eligibility.');
 const roleCode=str(primary[0].positionCode);
 const role=await getDoc(`organizations/${org}/positions/${roleCode}`);
 if(!role)throw new HttpError(409,'The employee’s primary job role is not configured.');
 const map=isObj(role.data.jobGradeByLegalEntity)?role.data.jobGradeByLegalEntity:{};
 const gradeCode=str(map[legal.id]);
 if(!gradeCode)throw new HttpError(409,'Assign a job grade to the employee’s role for this legal entity under Organization Admin → Roles.');
 const cfg=await getDoc(collection(org,legal.id));
 if(!cfg)throw new HttpError(409,'Configure and save leave entitlements for the employee’s legal entity before planning leave.');
 const payroll=cfg.data as unknown as PayConfig;
 const leaves=Array.isArray(payroll.items)?payroll.items.filter(x=>x.category==='leave'&&x.enabled):[];
 const options:LeaveOption[]=[];
 for(const item of leaves){
  const record=item.leaveEntitlements?.[gradeCode];
  if(!record?.eligible)continue; // No grade entitlement means no leave eligibility.
  if(!record.requiresApprovedPlan)continue; // Never allow an override of the plan prerequisite.
  options.push({code:item.code,name:item.name,gradeCode,daysPerYear:record.daysPerYear,
   accrueMonthly:record.accrueMonthly,monthlyAccrual:record.accrueMonthly?Number((record.daysPerYear/12).toFixed(4)):0,
   unit:record.unit,carryForwardDays:record.carryForwardDays,requiredPlan:true,
   mandatory:item.mandatory,description:item.description});
 }
 if(!leaves.length)throw new HttpError(409,'The legal entity has no enabled leave types.');
 return {legalEntityId:legal.id,legalEntityName:legal.name,jobRoleCode:roleCode,
  jobRoleTitle:str(role.data.title),gradeCode,options,payConfigVersion:Number(payroll.version||0)};
}
export function requireLeaveType(eligibility:LeaveEligibility,code:string):LeaveOption{
 const selected=eligibility.options.find(x=>x.code===code);
 if(!selected)throw new HttpError(403,'This leave type is not configured or the employee’s job grade is not eligible.');
 return selected;
}
