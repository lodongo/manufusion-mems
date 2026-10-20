import assert from 'node:assert/strict';
import test from 'node:test';
import {validateRcaAnalysis} from './drkmsRcaAi';

const valid={documentId:'d'.repeat(20),mode:'five_whys' as const,sourceIds:['EV-001'],hypotheses:[{id:'H-001',statement:'A possible bearing failure mechanism requires verification.',category:'mechanical',sourceIds:['EV-001'],confidence:0.62,status:'candidate' as const}],limitations:['Requires condition monitoring records'],humanValidated:false as const,publishable:false as const};
test('evidence-bound AI root cause hypothesis remains candidate only',()=>assert.equal(validateRcaAnalysis(valid),true));
test('candidate without source evidence rejected',()=>assert.equal(validateRcaAnalysis({...valid,sourceIds:[]}),false));
test('invented evidence reference rejected',()=>assert.equal(validateRcaAnalysis({...valid,hypotheses:[{...valid.hypotheses[0],sourceIds:['EV-MISSING']}]}),false));
test('confidence outside probability interval rejected',()=>assert.equal(validateRcaAnalysis({...valid,hypotheses:[{...valid.hypotheses[0],confidence:1.5}]}),false));
test('non-candidate conclusions rejected',()=>assert.equal(validateRcaAnalysis({...valid,hypotheses:[{...valid.hypotheses[0],status:'investigator_confirmed' as 'candidate'}]}),false));
