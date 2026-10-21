import assert from 'node:assert/strict';
import test from 'node:test';
import {rcaDmaicComplete,RCA_PHASES} from './drkmsRcaGate';
const valid=()=>{
 const phases=Object.fromEntries(RCA_PHASES.map(p=>[p,{
  problem:'A recurring equipment failure',impact:'Recurring production loss',scope:'Affected site and line',
  baseline:'Failure count exceeds reference',evidence:'Trend and linked WO observations',
  causalAnalysis:'Evidence confirmed failure mechanism',validatedCauses:'Independent causal analysis evidence',
  correctiveActions:'Permanent corrective work defined',actionOwners:'Responsible owner and deadline',
  effectivenessCriteria:'Repeat failure threshold below target',monitoringPlan:'Weekly review for defined duration',
  methodAnalysis:[{key:'WHY-1',text:'Observed component failure'},{key:'WHY-2',text:'Verified lubrication deficit'}]
 }]));
 return {subtypeCode:'RCA',rcaMethodCode:'5WHY',rcaDmaic:{completedPhases:[...RCA_PHASES],phases}};
};
test('non-RCA documents are unchanged',()=>assert.equal(rcaDmaicComplete({subtypeCode:'MAN'}),true));
test('completed evidence-backed DMAIC is ready for external review',()=>assert.equal(rcaDmaicComplete(valid()),true));
test('incomplete DMAIC cannot be submitted',()=>{for(const p of RCA_PHASES){const doc=valid();doc.rcaDmaic.completedPhases=doc.rcaDmaic.completedPhases.filter(x=>x!==p);assert.equal(rcaDmaicComplete(doc),false)}});
test('method and analysis evidence cannot be bypassed',()=>{
 const a=valid();a.rcaMethodCode='';assert.equal(rcaDmaicComplete(a),false);
 const b=valid();b.rcaDmaic.phases.ANALYZE.methodAnalysis=[];assert.equal(rcaDmaicComplete(b),false);
});
