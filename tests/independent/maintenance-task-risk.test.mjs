import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultMaintenanceRiskMatrix,scoreMaintenanceRisk,finalizeAssessedTaskRisks} from '../../backend/maintenanceTaskRisk.ts';
const m=defaultMaintenanceRiskMatrix;
test('uses organization four-factor risk calculation and bands',()=>{
 const s=scoreMaintenanceRisk(m,{P:2,S:3,E:2,A:1});
 assert.equal(s.score,12);assert.equal(s.band,'Low');assert.equal(s.matrixVersion,1);
});
test('rejects risk ratings outside configured factor bounds',()=>{
 assert.throws(()=>scoreMaintenanceRisk(m,{P:6,S:3,E:2,A:1}),/valid Probability/);
 assert.throws(()=>scoreMaintenanceRisk(m,{P:2,S:3,E:2}),/People affected/);
});
test('requires complete risk ratings before an assessed task can be saved',()=>{
 assert.throws(()=>finalizeAssessedTaskRisks([{risk:[{before:'manual',after:'manual'}]}],m),/Select initial/);
});
test('intolerable residual risk blocks completion of assessment',()=>{
 assert.throws(()=>finalizeAssessedTaskRisks([{risk:[{before:'',after:'',beforeRatings:{P:5,S:5,E:5,A:2},afterRatings:{P:4,S:4,E:4,A:2}}]}],m),/intolerable/);
});
