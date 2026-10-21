import test from 'node:test';
import assert from 'node:assert/strict';
import {RCA_TRIGGER_TYPES,triggerType,validTriggerId} from './docRcaTriggers';
import {RCA_METADATA_LISTS} from './docRcaDefaults';
test('RCA trigger identifiers and native source collections remain codified',()=>{
 assert.equal(triggerType('MNT_BREAKDOWN')?.[2],'work_orders');
 assert.equal(triggerType('MNT_REQUEST')?.[2],'work_requests');
 assert.equal(triggerType('SAF_NEARMISS')?.[2],'safety_incidents');
 assert.equal(triggerType('MFG_QUALITY')?.[2],'');
 assert.equal(validTriggerId('WO00000001'),true);
 assert.equal(validTriggerId('../other-org'),false);
});
test('DOC metadata has exactly one RCA trigger list matching supported codes',()=>{
 const lists=RCA_METADATA_LISTS.filter(x=>x.key==='rcaTriggerTypes');
 assert.equal(lists.length,1);
 const names=lists[0].items.map(x=>x.code);
 assert.deepEqual(names,RCA_TRIGGER_TYPES.map(x=>x[0]));
});
