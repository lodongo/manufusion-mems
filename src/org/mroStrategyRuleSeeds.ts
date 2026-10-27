/** Non-posting proposals for every installed MNT maintenance type.
 * Uses only approved, postable P&L accounts supplied by the legal entity chart.
 * Breakdown (MAI-006) is a distinct strategy but may initially share the approved
 * Corrective account (50203030). Finance maker-checker MUST still approve drafts.
 */
export interface FinanceStrategySeedRule{
 id:string;event:string;role:string;account:string;categoryCode:string;costCenterId:string;
 priority:number;enabled:boolean;maintenanceTypeCode?:string;costNatureCode?:string;
}
export function seedMaintenanceStrategyRules(
 prior:readonly FinanceStrategySeedRule[],
 strategies:readonly {code:string;label:string}[],
 chart:readonly {code:string;statement:string}[],
 mappedRoles:Readonly<Record<string,string>>,
):{rules:FinanceStrategySeedRule[];added:number;skipped:string[]} {
 const accounts=new Set(chart.filter(x=>x.statement==='PL').map(x=>x.code));
 const fallback=[mappedRoles.MAINT_CONSUMPTION,mappedRoles.CONSUMPTION].find(x=>!!x&&accounts.has(x))||'';
 const defaultFor:Record<string,string>={ 'MAI-001':'50203020','MAI-002':'50203030','MAI-006':'50203030','MAI-007':'50203030' };
 const rules=[...prior],skipped:string[]=[];
 let added=0;
 for(const strategy of strategies){
  const code=strategy.code;
  if(!/^MAI-[0-9]{3}$/.test(code)){skipped.push(code);continue;}
  if(rules.some(r=>r.event==='GI_WO'&&r.role==='MAINT_CONSUMPTION'&&r.maintenanceTypeCode===code
    &&!r.categoryCode&&!r.costCenterId&&!r.costNatureCode)){continue;}
  const preferred=defaultFor[code];
  const account=preferred&&accounts.has(preferred)?preferred:fallback;
  if(!account){skipped.push(code);continue;}
  rules.push({id:'mnt-strategy-default-'+code,event:'GI_WO',role:'MAINT_CONSUMPTION',account,
   categoryCode:'',costCenterId:'',priority:100,enabled:true,maintenanceTypeCode:code});
  added++;
 }
 return {rules,added,skipped};
}
