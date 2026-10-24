/** Read-only P6 financial readiness: no posting, approval, policy mutation, or cash movement. */
import {getDoc,nowIso,HttpError,str} from './core';
import {chartOf,entityOf,periodAt,yearsOf,P} from './finCore';
import {agreementPath,voucherPath,icPostingEnabled,validatePostablePair,pairPath} from './corporateIntercompanyPosting';
import {IC_ROLES,type IcRole,type IcAgreement,type IcVoucher} from './corporateIntercompany';
export type ReadinessCheck={code:string;passed:boolean;detail:string};
export type P6Readiness={voucherId:string;providerLegalEntityId:string;beneficiaryLegalEntityId:string;postingEnabled:boolean;readyForApplicationTest:boolean;operationallyAuthorized:false;checks:ReadinessCheck[];manualReleaseGates:string[];};
const test=(code:string,passed:boolean,detail:string):ReadinessCheck=>({code,passed,detail});
export function assessP6Readiness(input:{voucher:IcVoucher;agreement:IcAgreement|null;providerApproval:Record<string,unknown>|null;beneficiaryApproval:Record<string,unknown>|null;providerReady:boolean;beneficiaryReady:boolean;alreadyPosted:boolean;postingEnabled:boolean;}):P6Readiness{
 const {voucher:v,agreement:a,providerApproval:p,beneficiaryApproval:b}=input;
 let postable=false;
 try{if(a){validatePostablePair(v,a);postable=true;}}catch{postable=false;}
 const proofVoucher=(p?.payload as Record<string,unknown>|undefined)?.voucher as Record<string,unknown>|undefined;
 const proofProvider=(p?.result as Record<string,unknown>|undefined)?.voucherId===v.id&&proofVoucher?.id===v.id;
 const approvalProvider=!!p&&p.status==='approved'&&p.type==='corp.ic.voucher'&&p.leId===v.providerLegalEntityId&&proofProvider;
 const approvalBeneficiary=!!b&&b.status==='approved'&&b.type==='corp.ic.voucher.accept'&&b.leId===v.beneficiaryLegalEntityId&&
   (b.payload as Record<string,unknown>|undefined)?.voucherId===v.id&&(b.result as Record<string,unknown>|undefined)?.voucherId===v.id;
 const checks=[
  test('signed-agreement-and-matched-source',postable,'Agreement, supported transaction class, cost centres, tax reference and both matching references must be valid'),
  test('provider-independent-approval',approvalProvider,'Approved provider FCR must be bound to the exact voucher and legal entity'),
  test('beneficiary-independent-approval',approvalBeneficiary,'Approved beneficiary FCR must be bound to the exact voucher and legal entity'),
  test('provider-finance-chart-period',input.providerReady,'Provider must have open fiscal period, active legal entity, approved accounting roles and valid currency'),
  test('beneficiary-finance-chart-period',input.beneficiaryReady,'Beneficiary must have open fiscal period, active legal entity, approved accounting roles and valid currency'),
  test('source-not-yet-posted',!input.alreadyPosted,'Existing paired posting proof prevents another journal pair'),
  test('explicit-isolated-development-activation',input.postingEnabled,'Server is opted in for the P6 posting pilot on an isolated development project'),
 ];
 return {voucherId:v.id,providerLegalEntityId:v.providerLegalEntityId,beneficiaryLegalEntityId:v.beneficiaryLegalEntityId,
  postingEnabled:input.postingEnabled,readyForApplicationTest:checks.every(x=>x.passed),operationallyAuthorized:false,checks,
  manualReleaseGates:[
   'Independent Finance and Tax sign-off of actual transaction treatment and source invoices (a text reference is not verification)',
   'Authenticated maker, provider approver, beneficiary approver and separate dual-entity Finance controller UAT',
   'Actual deployed-application failure, retry and cross-tenant access testing with controlled user accounts',
   'Written approval before enabling development posting; production is not authorized',
  ]};
}
async function financeReady(orgId:string,v:IcVoucher,a:IcAgreement,side:'provider'|'beneficiary'):Promise<boolean>{
 const party=side==='provider'?a.provider:a.beneficiary;
 try{
  const [entity,years,chart]=await Promise.all([entityOf(orgId,party.legalEntityId),yearsOf(orgId,party.legalEntityId),chartOf(orgId,party.legalEntityId)]);
  if(entity.status!=='active'||entity.functionalCurrency!==(side==='provider'?v.providerFunctionalCurrency:v.beneficiaryFunctionalCurrency))return false;
  const period=periodAt(years,v.valueDate);
  if(!period||period.period.status!=='open'||v.valueDate>nowIso().slice(0,10))return false;
  for(const [role,code] of Object.entries(party.accounts)){
   const acc=chart.get(code);
   if(!acc||acc.status!=='active'||!acc.postable||acc.statement!==IC_ROLES[role as IcRole])return false;
   if(entity.doc?.data.glScopeConfigured===true&&
    !(Array.isArray(entity.doc.data.allowedGl)&&entity.doc.data.allowedGl.includes(code)))return false;
  }
  return true;
 }catch{return false;}
}
export async function inspectP6Readiness(orgId:string,voucherId:string):Promise<P6Readiness>{
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(voucherId))throw new HttpError(400,'Invalid voucher reference.');
 const d=await getDoc(voucherPath(orgId,voucherId));
 if(!d)throw new HttpError(404,'Intercompany voucher not found.');
 const v=d.data as unknown as IcVoucher;
 const [ad,provider,beneficiary,paired]=await Promise.all([
  getDoc(agreementPath(orgId,v.agreementId)),getDoc(P(orgId).request(v.providerApprovalRef)),
  getDoc(P(orgId).request(v.beneficiaryApprovalRef)),getDoc(pairPath(orgId,v.id)),
 ]);
 const a=ad?.data as unknown as IcAgreement|null;
 const [pReady,bReady]=a?await Promise.all([financeReady(orgId,v,a,'provider'),financeReady(orgId,v,a,'beneficiary')]):[false,false];
 return assessP6Readiness({voucher:v,agreement:a,providerApproval:provider?.data||null,
  beneficiaryApproval:beneficiary?.data||null,providerReady:pReady,beneficiaryReady:bReady,
  alreadyPosted:!!paired,postingEnabled:icPostingEnabled()});
}
