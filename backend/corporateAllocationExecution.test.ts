import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allocationRunId} from './corporateAllocationExecution';
test('P6 allocation source claim key is deterministic and different for distinct expense lines',()=>{
 const a=allocationRunId('pool','journal001',1);
 assert.equal(a,allocationRunId('pool','journal001',1));
 assert.notEqual(a,allocationRunId('pool','journal001',2));
 assert.notEqual(a,allocationRunId('poolB','journal001',1));
});
