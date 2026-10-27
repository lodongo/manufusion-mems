import test from 'node:test';
import assert from 'node:assert/strict';
import {seedMaintenanceStrategyRules} from '../../src/org/mroStrategyRuleSeeds.ts';
const available=[{code:'50203020',statement:'PL'},{code:'50203030',statement:'PL'},{code:'10305020',statement:'BS'},{code:'62004030',statement:'PL'}];
const types=[{code:'MAI-001',label:'Preventive Maintenance'},{code:'MAI-002',label:'Corrective Maintenance'},
 {code:'MAI-003',label:'Predictive Maintenance'},{code:'MAI-006',label:'Breakdown Maintenance'},
 {code:'MAI-007',label:'Emergency Maintenance'},{code:'MAI-010',label:'Major Overhaul'}];
test('One-click maintenance defaults include distinct breakdown, corrective, emergency categories',()=>{
 const result=seedMaintenanceStrategyRules([],types,available,{MAINT_CONSUMPTION:'62004030'});
 assert.equal(result.added,6);
 assert.deepEqual(result.skipped,[]);
 const rule=code=>result.rules.find(r=>r.maintenanceTypeCode===code);
 assert.equal(rule('MAI-001').account,'50203020');
 assert.equal(rule('MAI-002').account,'50203030');
 assert.equal(rule('MAI-006').account,'50203030');
 assert.equal(rule('MAI-007').account,'50203030');
 assert.equal(rule('MAI-003').account,'62004030');
 assert.equal(rule('MAI-006').event,'GI_WO');
 assert.equal(new Set(result.rules.map(x=>x.maintenanceTypeCode)).size,6);
});
test('Never choose an account outside the adopted P&L chart',()=>{
 const result=seedMaintenanceStrategyRules([],types,[{code:'10305020',statement:'BS'}],{MAINT_CONSUMPTION:'10305020'});
 assert.equal(result.added,0);
 assert.deepEqual(result.skipped,types.map(x=>x.code));
});
test('Does not overwrite existing strategy-account configurations or duplicate prior proposed rules',()=>{
 const existing=[{id:'reviewed',event:'GI_WO',role:'MAINT_CONSUMPTION',account:'62004030',
 categoryCode:'',costCenterId:'',priority:100,enabled:true,maintenanceTypeCode:'MAI-006'}];
 const first=seedMaintenanceStrategyRules(existing,types,available,{MAINT_CONSUMPTION:'62004030'});
 assert.equal(first.added,5);
 assert.equal(first.rules.find(x=>x.maintenanceTypeCode==='MAI-006').account,'62004030');
 const second=seedMaintenanceStrategyRules(first.rules,types,available,{MAINT_CONSUMPTION:'62004030'});
 assert.equal(second.added,0);
 assert.deepEqual(second.rules,first.rules);
});
test('Rejects invalid or unknown maintenance codes rather than creating bogus GL rules',()=>{
 const result=seedMaintenanceStrategyRules([],[{code:'CUSTOM',label:'Broken'}],available,{MAINT_CONSUMPTION:'62004030'});
 assert.equal(result.added,0);
 assert.deepEqual(result.skipped,['CUSTOM']);
});
