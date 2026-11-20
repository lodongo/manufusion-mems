/** Organization-managed defaults for new Production Planning & MRP forms only.
 * Saved masters, commissioned capacities, approvals and manual edits are not rewritten.
 */
export type FormDefaults={
 defaultSiteId:string;
 skuCategory:'FINISHED'|'INTERMEDIATE'|'RAW'|'PACKAGING';
 bomOutputQty:number;
 resourceType:'LINE'|'WORK_CENTER'|'MACHINE'|'BATCH_VESSEL'|'ASSEMBLY_CELL'|'OTHER';
 resourceRate:number;
 resourceEfficiency:number;
 routingAlternativeCode:string;
 demandType:'FORECAST'|'FIRM_ORDER';
 demandQuantity:number;
 demandLeadDays:number;
};
export const DEFAULT_FORM_DEFAULTS:FormDefaults={
 defaultSiteId:'',skuCategory:'FINISHED',bomOutputQty:1,
 resourceType:'LINE',resourceRate:1000,resourceEfficiency:100,
 routingAlternativeCode:'STANDARD',demandType:'FORECAST',demandQuantity:1,demandLeadDays:7,
};
export function formDefaultsFor(value?:Partial<FormDefaults>|null):FormDefaults{
 return {...DEFAULT_FORM_DEFAULTS,...(value||{})};
}
export function preferredSiteId(preferred:string,sites:ReadonlyArray<{id:string}>):string{
 if(preferred&&sites.some(s=>s.id===preferred))return preferred;
 return sites.length===1?sites[0].id:'';
}
export function localRequiredDate(leadDays:number,reference=new Date()):string{
 const days=Number.isInteger(leadDays)&&leadDays>=0?leadDays:7;
 const date=new Date(reference.getFullYear(),reference.getMonth(),reference.getDate()+days);
 const pad=(n:number)=>String(n).padStart(2,'0');
 return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());
}
