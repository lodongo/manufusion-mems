/**
 * Deterministic GL account determination for an approved legal entity.
 * Rules override role defaults only where an event/context matches. No AI, implicit wildcard
 * or unsigned configuration is permitted at posting time.
 */
export const DETERMINATION_EVENTS = [
  {code:'GR_STOCK',label:'Stock goods receipt',roles:['INVENTORY','GRIR'],implemented:true},
  {code:'GR_DIRECT',label:'Direct goods receipt',roles:['GRIR'],implemented:true},
  {code:'GR_ASSET',label:'Asset receipt',roles:['ASSET_CLEARING','GRIR'],implemented:true},
  {code:'SVC_ACCEPT',label:'Service acceptance',roles:['GRIR'],implemented:true},
  {code:'GI_CC',label:'Goods issue to cost center',roles:['INVENTORY','CONSUMPTION'],implemented:true},
  {code:'GI_WO',label:'Goods issue to maintenance work order',roles:['INVENTORY','MAINT_CONSUMPTION'],implemented:true},
  {code:'ST_ADJ',label:'Inventory count adjustment',roles:['INVENTORY','STOCK_DIFF'],implemented:true},
  {code:'STK_OPEN',label:'Stock opening valuation',roles:['INVENTORY','OPENING_BALANCE'],implemented:true},
  {code:'INV_RECON',label:'Inventory reconciliation',roles:['INVENTORY','RECON_DIFF'],implemented:true},
  {code:'REALLOC',label:'Cost-center reallocation',roles:[],implemented:true},
  {code:'YE_CLOSE',label:'Year-end profit transfer',roles:['RETAINED_EARNINGS'],implemented:true},
  {code:'AP_INVOICE',label:'Supplier invoice',roles:['GRIR','VAT_INPUT'],implemented:false},
  {code:'AR_INVOICE',label:'Customer invoice',roles:['VAT_OUTPUT'],implemented:false},
] as const;

export type AccountRule = {
  id:string; event:string; role:string; account:string; categoryCode:string;
  costCenterId:string; priority:number; enabled:boolean;
};
export type DeterminationContext = { event?:string; categoryCode?:string; costCenterId?:string };
const token=(s:unknown)=>typeof s==='string'?s.trim():'';
const EVENT_ROLES=new Map<string,ReadonlyArray<string>>(DETERMINATION_EVENTS.map(e=>[e.code,e.roles]));
export function validateRuleDraft(raw:unknown): AccountRule[] {
  if(!Array.isArray(raw)||raw.length>500)throw Error('Maximum 500 accounting determination rules.');
  const seen=new Set<string>();
  return raw.map((value,i)=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`Rule ${i+1}: invalid row.`);
    const r=value as Record<string,unknown>;
    const event=token(r.event),role=token(r.role),account=token(r.account);
    const categoryCode=token(r.categoryCode),costCenterId=token(r.costCenterId);
    const priority=Number(r.priority??100);
    const roles=EVENT_ROLES.get(event);
    if(!roles||!roles.includes(role))throw Error(`Rule ${i+1}: unsupported event/role combination.`);
    if(!account)throw Error(`Rule ${i+1}: an approved GL account is required.`);
    if(!Number.isInteger(priority)||priority<1||priority>999)throw Error(`Rule ${i+1}: priority must be 1–999.`);
    if([categoryCode,costCenterId].some(v=>v.length>100))throw Error(`Rule ${i+1}: context value is too long.`);
    const key=[event,role,categoryCode,costCenterId,priority].join('|');
    if(seen.has(key))throw Error(`Rule ${i+1}: duplicated decision priority and scope.`);
    seen.add(key);
    return {id:token(r.id)||`rule-${i+1}`,event,role,account,categoryCode,costCenterId,priority,enabled:r.enabled!==false};
  });
}
export function resolveAccountRule(rules:ReadonlyArray<AccountRule>,role:string,ctx:DeterminationContext):AccountRule|null {
  if(!ctx.event)return null;
  const matches=rules.filter(r=>r.enabled&&r.event===ctx.event&&r.role===role
    &&(!r.categoryCode||r.categoryCode===ctx.categoryCode)
    &&(!r.costCenterId||r.costCenterId===ctx.costCenterId));
  matches.sort((a,b)=>{
    const specificity=(r:AccountRule)=>Number(!!r.categoryCode)+Number(!!r.costCenterId);
    return specificity(b)-specificity(a)||a.priority-b.priority||a.id.localeCompare(b.id);
  });
  return matches[0]??null;
}
