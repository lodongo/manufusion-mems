/**
 * P5 Finance-controlled service purchase-order budget pilot activation.
 * A two-person Finance FCR is required for ON and OFF. No direct toggle route.
 * Activation is additionally locked behind a dedicated development server flag.
 */
import {HttpError,getDoc,nowIso,str,writeDoc,type Fields} from './core';
import {orgRoute,type OrgContext} from './guards';
import {
 createRequest,entityOf,leOf,needEntity,permAt,periodAt,
 reasonOf,registerHandler,scopeOf,unitsOf,withLock,yearsOf,
 type Obj,
} from './finCore';
import {type BudgetClass,currencyDigits,validDate} from './corporateBudget';
import {
 PO_GATE_PATH,parsePoGatePolicy,poBudgetServerEnabled,type PoGatePolicy,
} from './corporatePoBudget';

type GateMode='off'|'service_pilot';
type GateIntent={mode:GateMode;legalEntityId:string;category:'OPEX';
 activationDate:string;reason:string;expectedVersion:number};
const root=(orgId:string)=>'organizations/'+orgId;
const clean=(value:unknown,max=250)=>str(value).trim().slice(0,max);
const validId=(s:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(s);
export function validateGateIntent(raw:unknown):GateIntent{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))
  throw Error('Budget gate proposal must be an object.');
 const x=raw as Record<string,unknown>;
 const leId=clean(x.legalEntityId,128);
 const mode=clean(x.mode,30) as GateMode;
 const activationDate=clean(x.activationDate,10);
 const reason=clean(x.reason,500);
 if(!validId(leId)||!['off','service_pilot'].includes(mode))
  throw Error('Select a legal entity and an allowed pilot mode.');
 if(x.category!=='OPEX')throw Error('Only the OPEX service pilot is supported.');
 if(!validDate(activationDate))throw Error('Select a valid activation date.');
 if(reason.length<10)throw Error('Provide at least ten characters of business justification.');
 const expectedVersion=Number(x.expectedVersion);
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)
  throw Error('The configuration revision has changed; reload before proposing.');
 return {mode,legalEntityId:leId,category:'OPEX',activationDate,reason,expectedVersion};
}
async function scopedFinance(ctx:OrgContext,legalEntityId:string,permission:string){
 const [units,scope]=await Promise.all([unitsOf(ctx.orgId),scopeOf(ctx)]);
 const le=needEntity(units,scope,legalEntityId);
 if(!permAt(ctx,permission,le.id,units,scope))
  throw new HttpError(403,permission+' required for legal entity '+le.code+'.');
 return {units,le};
}
async function readyForActivation(ctx:OrgContext,leId:string,at:string,category:BudgetClass){
 const {units}=await scopedFinance(ctx,leId,'FIN.setup.approve');
 const fin=await entityOf(ctx.orgId,leId);
 if(fin.status!=='active'||!fin.functionalCurrency||currencyDigits(fin.functionalCurrency)!==2)
  throw new HttpError(409,'Pilot requires an active Finance entity and two-decimal functional currency.');
 const years=await yearsOf(ctx.orgId,leId);
 const opened=periodAt(years,at);
 if(!opened||opened.period.status!=='open')
  throw new HttpError(409,'An open financial period must cover the pilot activation date.');
 const bp=await getDoc(root(ctx.orgId)+'/corp_budgets/'+leId+'_'+opened.year.fy);
 if(!bp||bp.data.status!=='approved'||!Array.isArray(bp.data.lines)||
  !bp.data.lines.some(x=>typeof x==='object'&&x!==null&&(x as Record<string,unknown>).category===category))
  throw new HttpError(409,'An approved annual OPEX budget is required for this legal entity and fiscal year.');
 const leUnits=Array.from(units.values()).filter(u=>u.level==='cost_center'&&u.status!=='inactive'&&leOf(units,u.id)?.id===leId);
 if(!leUnits.length)throw new HttpError(409,'Configure at least one active finance cost centre before activating the pilot.');
 return {fy:opened.year.fy,currency:fin.functionalCurrency};
}
registerHandler('corp.po.budget.gate',{
 label:'Activate or disable controlled service purchase-order budget pilot',
 approvePerm:'FIN.setup.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const raw=req.payload;
  let intent:GateIntent;
  try{intent=validateGateIntent(raw);}catch(e){throw new HttpError(409,(e as Error).message);}
  if(clean(req.leId,128)!==intent.legalEntityId)
   throw new HttpError(409,'Finance request legal entity no longer matches the pilot target.');
  await scopedFinance(ctx,intent.legalEntityId,'FIN.setup.approve');
  if(intent.mode==='service_pilot'&&!poBudgetServerEnabled())
   throw new HttpError(409,'This pilot cannot be approved outside an explicitly opted-in isolated development deployment.');
  return withLock(ctx.orgId,'corp_po_budget_gate',async()=>{
   const path=PO_GATE_PATH(ctx.orgId),current=await getDoc(path);
   const prevVersion=Number(current?.data.version)||0;
   if(prevVersion!==intent.expectedVersion)
    throw new HttpError(409,'The pilot configuration has changed since submission. Review and resubmit.');
   const former=clean(current?.data.legalEntityId,128);
   if(clean(current?.data.mode)==='service_pilot'&&former&&former!==intent.legalEntityId)
    throw new HttpError(409,'Disable the previous legal-entity pilot through Finance approval before changing its scope.');
   const ready=intent.mode==='service_pilot'?
    await readyForActivation(ctx,intent.legalEntityId,intent.activationDate,intent.category):null;
   const policy:PoGatePolicy&{version:number;reason:string;activatedAt:string;
    fiscalYear:number|null;currency:string}={
    mode:intent.mode,legalEntityId:intent.legalEntityId,
    scope:'service_purchase_orders',category:'OPEX',
    valuation:'po_line_net',activationDate:intent.activationDate,
    effectiveVersion:1,approvalRef:id,signedOffBy:ctx.uid,version:prevVersion+1,
    reason:intent.reason,activatedAt:nowIso(),fiscalYear:ready?.fy||null,currency:ready?.currency||'',
   };
   const precondition=current?{updateTime:current.updateTime}:{exists:false};
   if(!await writeDoc(path,policy as unknown as Fields,precondition))
    throw new HttpError(409,'The service budget policy was changed by another user.');
   return {mode:intent.mode,legalEntityId:intent.legalEntityId,
    version:policy.version,approvalRef:id,currency:policy.currency,fy:policy.fiscalYear,
    note:intent.mode==='off'?
     'Pilot disabled for future service POs. Existing controlled PO reservations remain enforceable.':
     'Development-only service PO budget pilot approved; no purchase order or journal was posted.'};
  });
 },
});
export const corporatePoBudgetRoutes={
 'POST /api/org/corporate/po-budget/status':[
  orgRoute('org.corporate.po-budget.status','FIN.view',async ctx=>{
   const leId=clean(ctx.body.legalEntityId,128);
   await scopedFinance(ctx,leId,'FIN.view');
   const d=await getDoc(PO_GATE_PATH(ctx.orgId));
   const current=d?.data||{};
   return {mode:clean(current.mode)||'off',legalEntityId:clean(current.legalEntityId,128),
    version:Number(current.version)||0,category:clean(current.category)||'OPEX',
    scope:clean(current.scope)||'service_purchase_orders',activationDate:clean(current.activationDate),
    approvalRef:clean(current.approvalRef),signedOffBy:clean(current.signedOffBy),
    developmentServerEnabled:poBudgetServerEnabled(),
    affectsSelectedLegalEntity:clean(current.legalEntityId)===leId,
    note:'The budget pilot is not general-purpose spend control. Only explicitly approved service orders in one legal entity may be gated.'};
  })
 ],
 'POST /api/org/corporate/po-budget/propose':[
  orgRoute('org.corporate.po-budget.propose','FIN.setup.manage',async ctx=>{
   const path=PO_GATE_PATH(ctx.orgId),doc=await getDoc(path);
   const input={...ctx.body,expectedVersion:Number(ctx.body.expectedVersion)};
   let intent:GateIntent;
   try{intent=validateGateIntent(input);}catch(e){throw new HttpError(400,(e as Error).message);}
   await scopedFinance(ctx,intent.legalEntityId,'FIN.setup.manage');
   if(Number(doc?.data.version||0)!==intent.expectedVersion)
    throw new HttpError(409,'Pilot settings have changed. Reload their current version.');
   if(intent.mode==='service_pilot'){
    if(!poBudgetServerEnabled())
     throw new HttpError(409,'Pilot activation is blocked until the isolated development server is explicitly opted in.');
    await readyForProposal(ctx,intent.legalEntityId,intent.activationDate);
   }
   if(doc?.data.mode==='service_pilot'&&clean(doc.data.legalEntityId)!==intent.legalEntityId)
    throw new HttpError(409,'Disable the other legal entity pilot first.');
   if(clean(doc?.data.mode||'off')===intent.mode&&
      (intent.mode==='off'||clean(doc?.data.legalEntityId)===intent.legalEntityId))
    throw new HttpError(409,'There is no requested mode change to approve.');
   return createRequest(ctx,{leId:intent.legalEntityId,type:'corp.po.budget.gate',
    scopeKey:'corp.po.budget.gate',
    title:(intent.mode==='off'?'Disable':'Activate')+' service-PO budget pilot',
    summary:'Legal entity '+intent.legalEntityId+' · OPEX service orders · effective '+intent.activationDate+
     ' · revision '+intent.expectedVersion+' → '+(intent.expectedVersion+1),
    payload:intent as unknown as Obj,reason:intent.reason,amount:0});
  })
 ],
};
async function readyForProposal(ctx:OrgContext,leId:string,date:string){
 const fin=await entityOf(ctx.orgId,leId);
 if(fin.status!=='active'||!fin.functionalCurrency||currencyDigits(fin.functionalCurrency)!==2)
  throw new HttpError(409,'Pilot legal entity must have active Finance and two-decimal functional currency.');
 const at=periodAt(await yearsOf(ctx.orgId,leId),date);
 if(!at||at.period.status!=='open')throw new HttpError(409,'Pilot date needs an open financial period.');
}
