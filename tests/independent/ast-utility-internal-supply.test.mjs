import test from 'node:test';
import assert from 'node:assert/strict';
import {isInternalUtilitySupply,utilityLinkIssue} from '../../backend/astUtilities.ts';
import {AST_UTILITY_ITEMS} from '../../backend/astUtilityDefaults.ts';
import {mergeUtilityEnergy} from '../../backend/safStatutoryInspections.ts';
import {utilityOptionLabel} from '../../src/lib/iso8573Labels.ts';
test('internal equipment supply waives asset linkage; old link requirement is retained',async()=>{
 assert.equal(isInternalUtilitySupply({}),false);assert.equal(isInternalUtilitySupply({isInternalSupply:false}),true);assert.equal(isInternalUtilitySupply({isInternalSupply:true,supplyLinkRule:2}),true);assert.equal(isInternalUtilitySupply({isInternalSupply:false,supplyLinkRule:2}),false);
 assert.equal(await utilityLinkIssue('org',{}, {isInternalSupply:true,supplyLinkRule:2},undefined),'');
 assert.match(await utilityLinkIssue('org',{}, {isInternalSupply:false,supplyLinkRule:2},undefined),/supply asset/);
});
test('ISO class definitions preserve codes and include full class ranges',()=>{
 const a=AST_UTILITY_ITEMS.find(x=>x.code==='UTL-08-001');
 assert.ok(a.attributes.find(x=>x.key==='particle').options.includes('7'));
 assert.ok(a.attributes.find(x=>x.key==='water').options.includes('9'));
 assert.match(utilityOptionLabel('ISO 8573 water class','4'),/\+3 °C/);
 assert.match(utilityOptionLabel('ISO 8573 oil class','1'),/0.01 mg/);
 assert.equal(utilityOptionLabel('Frequency','50'),'50');
});
test('external classification changes safety fingerprint without changing point identity',()=>{
 const a={code:'UTL-08-001',connectionId:'A',sourceAssetTag:'AST-000001',isInternalSupply:true,values:{flow:40}};
 const old={...mergeUtilityEnergy([a],[])[0],status:'documented'};
 const next=mergeUtilityEnergy([{...a,isInternalSupply:false,sourceAssetTag:''}],[old])[0];
 assert.equal(next.pointId,old.pointId);assert.equal(next.status,'draft');assert.equal(next.isInternalSupply,true);
});
