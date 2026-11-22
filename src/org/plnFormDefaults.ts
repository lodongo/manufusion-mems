/** Organization-managed defaults for new Production Planning & MRP forms only.
 * Saved masters, commissioned capacities, approvals and manual edits are not rewritten.
 */
export type FormDefaults={
 defaultSiteId:string;
 skuCategory:'FINISHED'|'INTERMEDIATE'|'RAW'|'PACKAGING';
 bomOutputQty:number;
 /** Optional adoption filters; classification belongs to each cost centre. */
 resourceCostCenterCategory:string;
 resourceCostCenterSubcategory:string;
 routingAlternativeCode:string;
 demandType:'FORECAST'|'FIRM_ORDER';
 demandQuantity:number;
 demandLeadDays:number;
};
export const DEFAULT_FORM_DEFAULTS:FormDefaults={
 defaultSiteId:'',skuCategory:'FINISHED',bomOutputQty:1,
 resourceCostCenterCategory:'MFG',resourceCostCenterSubcategory:'',
 routingAlternativeCode:'STANDARD',demandType:'FORECAST',demandQuantity:1,demandLeadDays:7,
};
export function formDefaultsFor(value?:Partial<FormDefaults>|null):FormDefaults{
 // Ignore deprecated generic resource-class fields in existing saved defaults.
 const source=(value||{}) as Record<string,unknown>;
 const result={...DEFAULT_FORM_DEFAULTS} as Record<string,unknown>;
 for(const key of Object.keys(DEFAULT_FORM_DEFAULTS)){
  if(source[key]!==undefined&&source[key]!==null)result[key]=source[key];
 }
 return result as FormDefaults;
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
