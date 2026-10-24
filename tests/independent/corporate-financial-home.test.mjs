import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultCorporateFinancialHome,validateCorporateFinancialHome}
 from '../../backend/corporateFinance.ts';

const node=(id,level,parentId,status='active')=>({id,level,parentId,status,name:id,code:id});
const refs={
 legalEntities:[node('LE_HQ','legal_entity','root'),node('LE_PLANT','legal_entity','root')],
 sites:[node('HQ','site','LE_HQ'),node('PLANT','site','LE_PLANT')],
 departments:[node('CORP_FIN','department','HQ'),node('OPS','department','PLANT')],
 costCenters:[node('HQ_FIN','cost_center','CORP_FIN'),node('PLANT_CC','cost_center','OPS')],
 functions:[{code:'FIN',name:'Group Finance',enabled:true},{code:'ENG',name:'Group Engineering',enabled:true}],
};
const entry=()=>({
 functionCode:'FIN',homeDepartmentId:'CORP_FIN',homeCostCenterId:'HQ_FIN',
 costClass:'shared_service',fundingMethod:'corporate_budget',allocationBasis:'fixed_percent',
 allocations:[{legalEntityId:'LE_HQ',costCenterId:'HQ_FIN',percentage:100}],
 rationale:'Corporate oversight and accounting',serviceAgreementRef:'',allocationEvidence:'',
 budgetReference:'HQ-2027-FIN',effectiveFrom:'2027-01-01',
});
const config=()=>({...defaultCorporateFinancialHome(),legalEntityId:'LE_HQ',headquartersSiteId:'HQ',functions:[entry()]});
test('financial home must be a legal entity and HQ site, never an abstract corporate branch',()=>{
 const result=validateCorporateFinancialHome(config(),refs);
 assert.equal(result.legalEntityId,'LE_HQ');
 assert.equal(result.functions[0].homeCostCenterId,'HQ_FIN');
 assert.throws(()=>validateCorporateFinancialHome({...config(),legalEntityId:'LE_MISSING'},refs),/registered legal entity/);
 assert.throws(()=>validateCorporateFinancialHome({...config(),headquartersSiteId:'PLANT'},refs),/headquarters site/);
});
test('mapped cost centre must belong to actual HQ department and site',()=>{
 const wrong=config();wrong.functions[0].homeCostCenterId='PLANT_CC';
 assert.throws(()=>validateCorporateFinancialHome(wrong,refs),/real Department and Cost Centre/);
});
test('corporate funded cost remains with owning company',()=>{
 const c=config();c.functions[0].allocations=[
  {legalEntityId:'LE_HQ',costCenterId:'HQ_FIN',percentage:50},
  {legalEntityId:'LE_PLANT',costCenterId:'PLANT_CC',percentage:50},
 ];
 assert.throws(()=>validateCorporateFinancialHome(c,refs),/service agreement|Corporate-budget-funded/);
 c.functions[0].serviceAgreementRef='AGR-001';c.functions[0].allocationEvidence='Verified FTE service usage';
 assert.throws(()=>validateCorporateFinancialHome(c,refs),/Corporate-budget-funded/);
});
test('chargeable corporate service requires benefit evidence and a 100 percent allocation',()=>{
 const c=config();c.functions[0].fundingMethod='service_recharge';
 c.functions[0].allocations=[
  {legalEntityId:'LE_HQ',costCenterId:'HQ_FIN',percentage:35},
  {legalEntityId:'LE_PLANT',costCenterId:'PLANT_CC',percentage:65},
 ];
 assert.throws(()=>validateCorporateFinancialHome(c,refs),/service agreement/);
 c.functions[0].serviceAgreementRef='AGR-001';
 c.functions[0].allocationEvidence='Verified FTE service usage';
 const valid=validateCorporateFinancialHome(c,refs);
 assert.equal(valid.functions[0].allocations.reduce((n,x)=>n+x.percentage,0),100);
 assert.equal(valid.status,'draft');
 c.functions[0].allocations[1].percentage=64;
 assert.throws(()=>validateCorporateFinancialHome(c,refs),/total 100%/);
});
test('shareholder activity does not get invoiced to subsidiaries',()=>{
 const c=config();c.functions[0].costClass='shareholder';
 c.functions[0].fundingMethod='service_recharge';
 assert.throws(()=>validateCorporateFinancialHome(c,refs),/Shareholder-only/);
 c.functions[0].fundingMethod='hybrid';
 c.functions[0].allocations=[
  {legalEntityId:'LE_HQ',costCenterId:'HQ_FIN',percentage:50},
  {legalEntityId:'LE_PLANT',costCenterId:'PLANT_CC',percentage:50},
 ];
 c.functions[0].serviceAgreementRef='AGR-001';c.functions[0].allocationEvidence='FTE';
 assert.throws(()=>validateCorporateFinancialHome(c,refs),/Shareholder-only/);
});
test('reject duplicate function mappings and benefiting cost centre ownership mismatch',()=>{
 const c=config();c.functions.push(entry());
 assert.throws(()=>validateCorporateFinancialHome(c,refs),/one current financial home/);
 c.functions.pop();c.functions[0].allocations[0].legalEntityId='LE_PLANT';
 assert.throws(()=>validateCorporateFinancialHome(c,refs),/beneficiary Cost Centre/);
});
