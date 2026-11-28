import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceCoreRecord} from '../../backend/plnManufacturingResources.ts';
import {validateNewResourceSku} from '../../backend/plnCostCenterCapacity.ts';
import {PROCUREMENT_UNITS} from '../../backend/procurementUnits.ts';
const each=PROCUREMENT_UNITS.find(u=>u.label==='Each'&&u.active&&u.selectable);
const hour=PROCUREMENT_UNITS.find(u=>u.label==='Hour'&&u.active&&u.selectable);
const minute=PROCUREMENT_UNITS.find(u=>u.label==='Minute'&&u.active&&u.selectable);
test('resource stores a classification and explicit time denominator without changing the numerator',()=>{
 const core=resourceCoreRecord({name:'Line 3',rateUom:each.code,rateTimeUom:minute.code,productClassification:'FINISHED'},'CC_003','SITE_001','USER_1');
 assert.equal(core.rateUom,each.code);assert.equal(core.rateTimeUom,minute.code);assert.equal(core.productClassification,'FINISHED');
 const updated=resourceCoreRecord({name:'Line 3',rateUom:each.code,rateTimeUom:hour.code,productClassification:'INTERMEDIATE'},'CC_003','SITE_001','USER_1',core);
 assert.equal(updated.rateTimeUom,hour.code);assert.equal(updated.productClassification,'INTERMEDIATE');
 assert.throws(()=>resourceCoreRecord({name:'Line 3',rateUom:each.code,rateTimeUom:each.code},'CC_003','SITE_001','USER_1'),/time unit/);
 assert.throws(()=>resourceCoreRecord({name:'Line 3',rateUom:each.code,productClassification:'BOTH'},'CC_003','SITE_001','USER_1'),/finished products/);
});
test('classification prevents incompatible new allocations while retaining legacy ones',()=>{
 assert.doesNotThrow(()=>validateNewResourceSku('FINISHED','FINISHED',false));
 assert.doesNotThrow(()=>validateNewResourceSku('INTERMEDIATE','INTERMEDIATE',false));
 assert.throws(()=>validateNewResourceSku('FINISHED','INTERMEDIATE',false),/does not match/);
 assert.throws(()=>validateNewResourceSku('','FINISHED',false),/classification/);
 assert.doesNotThrow(()=>validateNewResourceSku('FINISHED','INTERMEDIATE',true));
 assert.doesNotThrow(()=>validateNewResourceSku(null,'INTERMEDIATE',false));
});
