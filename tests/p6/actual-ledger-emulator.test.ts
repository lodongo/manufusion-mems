import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {getDoc} from '../../backend/core';
import {commit,preparePosting,P,HANDLERS,type Write} from '../../backend/finCore';
import {nowIso} from '../../backend/core';
import '../../backend/corporateIntercompanyRoutes';
import {postingInput} from '../../backend/corporateIntercompanyPosting';
import type {IcAgreement,IcVoucher} from '../../backend/corporateIntercompany';
const name=()=> 'P6_PREP_'+randomBytes(5).toString('hex');
const x=(path:string,fields:Record<string,unknown>):Write=>({path,exists:false,fields});
const agreement=():IcAgreement=>({id:'AGREE01',code:'SHAREDIT',name:'Shared IT',
 provider:{legalEntityId:'LEA',accounts:{IC_RECEIVABLE:'A120',SERVICE_RECOVERY:'A410'}},
 beneficiary:{legalEntityId:'LEB',accounts:{SERVICE_EXPENSE:'B510',IC_PAYABLE:'B220'}},
 allowedTypes:['SERVICE_RECHARGE'],invoiceCurrency:'KES',ceilingMinor:100000,
 startDate:'2026-01-01',endDate:'2026-12-31',settlementPolicy:'MONTHLY',pricingPolicy:'AT_COST',
 taxPolicyReference:'TAX-EXEMPT-REVIEW',transferPricingReference:'',
 supportingAgreementReference:'SLA01',purpose:'Approved service charge',status:'approved_policy',
 version:1,approvedAt:'2026-10-24',approvedBy:'A',providerApprovalRef:'FCR00000001',
 counterpartyApprovalRef:'FCR00000002',counterpartyApprovedAt:'2026-10-24',counterpartyApprovedBy:'B'});
const voucher=():IcVoucher=>({id:'VABC',agreementId:'AGREE01',sourceReference:'SOURCE01',type:'SERVICE_RECHARGE',
 currency:'KES',amountMinor:20000,valueDate:'2026-10-24',providerLegalEntityId:'LEA',beneficiaryLegalEntityId:'LEB',
 taxReviewReference:'TAX-EXEMPT-REVIEW',transferPricingEvidence:'',supportingDocumentReferences:['DOC01'],
 description:'Internal IT service',status:'matched_ready',createdAt:'',createdBy:'maker',
 providerApprovedAt:'',providerApprovalRef:'FCR00000003',beneficiaryApprovedAt:'',
 beneficiaryApprovedBy:'approverB',beneficiaryApprovalRef:'FCR00000004',
 providerFunctionalCurrency:'KES',beneficiaryFunctionalCurrency:'KES',providerFxRate:1,beneficiaryFxRate:1,
 providerCostCenterId:'CCA',beneficiaryCostCenterId:'CCB'});
async function fixture(tenant:string){
 const root='organizations/'+tenant;
 const writes:Write[]=[];
 for(const [le,cc,accounts] of [
  ['LEA','CCA',[['A120','BS'],['A410','PL']]],
  ['LEB','CCB',[['B510','PL'],['B220','BS']]],
 ] as Array<[string,string,string[][]]>){
  writes.push(x(root+'/structure/'+le,{id:le,code:le,name:le,level:'legal_entity',parentId:'',status:'active'}));
  writes.push(x(root+'/structure/'+cc,{id:cc,code:cc,name:cc,level:'cost_center',parentId:le,status:'active'}));
  writes.push(x(root+'/fin_entities/'+le,{leId:le,status:'active',functionalCurrency:'KES'}));
  writes.push(x(root+'/fin_years/'+le+'_2026',{leId:le,fy:2026,label:'2026',start:'2026-01-01',end:'2026-12-31',status:'active',periods:[{no:10,name:'October',start:'2026-10-01',end:'2026-10-31',special:false,status:'open',history:[]}]}));
  for(const [code,statement] of accounts){
   writes.push(x(root+'/fin_accounts/'+le+'__'+code,{leId:le,code,name:code,status:'active',statement,postable:true,classCode:statement==='PL'?'5':'1',normalBalance:'debit'}));
  }
 }
 await commit(writes);
 return root;
}
test('P6 actual Finance journal preparation commits both LE journal preconditions and balances',async()=>{
 const orgId=name(),root=await fixture(orgId),ctx={orgId,uid:'finController',me:null} as never;
 const v=voucher(),a=agreement();
 const [provider,beneficiary]=await Promise.all([
  preparePosting(ctx,postingInput(v,a,'provider','FCR00000005')),
  preparePosting(ctx,postingInput(v,a,'beneficiary','FCR00000005'))
 ]);
 assert.equal(provider.dr,20000);assert.equal(beneficiary.dr,20000);
 const pairPath=root+'/corp_ic_pairs/VABC';
 await commit([...provider.writes,...beneficiary.writes,x(pairPath,{id:'VABC',providerJournalId:provider.id,beneficiaryJournalId:beneficiary.id})]);
 assert.ok(await getDoc(root+'/fin_journal/'+provider.id));
 assert.ok(await getDoc(root+'/fin_journal/'+beneficiary.id));
 assert.ok(await getDoc(pairPath));
 assert.equal((await getDoc(root+'/fin_journal/'+provider.id))?.data.totalDebit,200);
 assert.equal((await getDoc(root+'/fin_journal/'+beneficiary.id))?.data.totalCredit,200);
});

test('P6 actual approved Finance handler atomically finalizes the FCR with two GL journals, with no replay',async()=>{
 const orgId=name(),root=await fixture(orgId),v=voucher(),a=agreement();
 const approval='FCR00000005',at=nowIso();
 const fcr=(id:string,leId:string,type:string,payload:Record<string,unknown>,result:Record<string,unknown>)=>
  x(P(orgId).request(id),{id,leId,type,status:'approved',payload,result,makerUid:'maker',
   decidedBy:id==='FCR00000003'?'providerApprover':'beneficiaryApprover'});
 const final=x(P(orgId).request(approval),{id:approval,leId:'LEA',type:'corp.ic.post',
  status:'pending',makerUid:'postingMaker',payload:{voucherId:v.id},
  steps:[{level:'L1',status:'pending',by:'',at:'',note:''}],history:[]});
 await commit([
  x(root+'/corp_ic_agreements/'+a.id,a as unknown as Record<string,unknown>),
  x(root+'/corp_ic_vouchers/'+v.id,v as unknown as Record<string,unknown>),
  fcr('FCR00000003','LEA','corp.ic.voucher',{voucher:v},{voucherId:v.id}),
  fcr('FCR00000004','LEB','corp.ic.voucher.accept',{voucherId:v.id},{voucherId:v.id}),
  final,
 ]);
 const ctx={orgId,uid:'controller',role:'org_super_admin',me:null} as never;
 const finalApproval={at,note:'Approved independent bilateral GL reconciliation',
  steps:[{level:'L1',status:'approved',by:'controller',at,note:'Reviewed'}],
  history:[{by:'controller',at,action:'approved L1',note:'Reviewed'}]};
 const handler=HANDLERS['corp.ic.post'];
 assert.equal(handler.atomicFinalization,true);
 const outcome=await handler.apply(ctx,{payload:{voucherId:v.id},_finalApproval:finalApproval},approval);
 assert.equal(outcome.pairId,v.id);
 const doc=await getDoc(P(orgId).request(approval));
 assert.equal(doc?.data.status,'approved');
 assert.equal(doc?.data.decidedBy,'controller');
 assert.deepEqual(doc?.data.history,finalApproval.history);
 assert.equal((doc?.data.steps as Array<Record<string,unknown>>)[0].note,'Reviewed');
 const pair=await getDoc(root+'/corp_ic_pairs/'+v.id);
 assert.ok(pair);
 assert.ok(await getDoc(root+'/fin_journal/'+String(outcome.providerJournal)));
 assert.ok(await getDoc(root+'/fin_journal/'+String(outcome.beneficiaryJournal)));
 assert.equal((await getDoc(root+'/corp_ic_vouchers/'+v.id))?.data.status,'posted');
 await assert.rejects(()=>handler.apply(ctx,{payload:{voucherId:v.id},_finalApproval:finalApproval},approval));
});
test('P6 final approval must be source-bound: an unrelated approved provider FCR cannot post a voucher',async()=>{
 const orgId=name(),root=await fixture(orgId),v=voucher(),a=agreement(),at=nowIso();
 await commit([
  x(root+'/corp_ic_agreements/'+a.id,a as unknown as Record<string,unknown>),
  x(root+'/corp_ic_vouchers/'+v.id,v as unknown as Record<string,unknown>),
  x(P(orgId).request('FCR00000003'),{id:'FCR00000003',leId:'LEA',type:'corp.ic.voucher',
   status:'approved',payload:{voucher:{id:'UNRELATED'}},result:{voucherId:'UNRELATED'},decidedBy:'approverA'}),
  x(P(orgId).request('FCR00000004'),{id:'FCR00000004',leId:'LEB',type:'corp.ic.voucher.accept',
   status:'approved',payload:{voucherId:v.id},result:{voucherId:v.id},decidedBy:'approverB'}),
  x(P(orgId).request('FCR00000005'),{id:'FCR00000005',leId:'LEA',type:'corp.ic.post',
   status:'pending',makerUid:'other',payload:{voucherId:v.id},steps:[{status:'pending'}]}),
 ]);
 const ctx={orgId,uid:'controller',role:'org_super_admin',me:null} as never;
 const meta={at,note:'Reviewed',history:[{by:'controller',at}],
  steps:[{status:'approved',by:'controller'}]};
 await assert.rejects(()=>HANDLERS['corp.ic.post'].apply(ctx,{payload:{voucherId:v.id},_finalApproval:meta},'FCR00000005'),
  /Provider approval proof/);
 assert.equal(await getDoc(root+'/corp_ic_pairs/'+v.id),null);
 assert.equal((await getDoc(P(orgId).request('FCR00000005')))?.data.status,'pending');
});
