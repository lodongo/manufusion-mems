import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {routingStageGates,applyRoutingStageAction} from '../../backend/mfgStageDependencies.ts';

const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const stages=[
 {code:'PREP',name:'Product preparation',dependsOn:[]},
 {code:'BLOW',name:'Bottle blowing',dependsOn:[]},
 {code:'FILL',name:'Filling & capping',dependsOn:['PREP','BLOW']},
 {code:'PACK',name:'Packing',dependsOn:['FILL']},
];
const gate=(gates,code)=>gates.find(x=>x.code===code);

test('all required predecessors are hard gates; parallel branches may start independently',()=>{
 const initial=routingStageGates(stages);
 assert.equal(gate(initial,'PREP').displayState,'READY');
 assert.equal(gate(initial,'BLOW').canStart,true);
 assert.equal(gate(initial,'FILL').displayState,'BLOCKED');
 assert.deepEqual(gate(initial,'FILL').unmetPredecessors,['PREP','BLOW']);
 assert.equal(gate(initial,'PACK').canStart,false);
 const prepStart=applyRoutingStageAction(stages,{},'PREP','START');
 assert.equal(gate(prepStart.gates,'BLOW').canStart,true);
 assert.deepEqual(gate(prepStart.gates,'FILL').unmetPredecessors,['PREP','BLOW']);
 const prepDone=applyRoutingStageAction(stages,prepStart.states,'PREP','COMPLETE');
 assert.deepEqual(gate(prepDone.gates,'FILL').unmetPredecessors,['BLOW']);
 assert.throws(()=>applyRoutingStageAction(stages,prepDone.states,'FILL','START'),
  /blocked until BLOW is completed/);
 const blowStarted=applyRoutingStageAction(stages,prepDone.states,'BLOW','START');
 const blowDone=applyRoutingStageAction(stages,blowStarted.states,'BLOW','COMPLETE');
 assert.equal(gate(blowDone.gates,'FILL').displayState,'READY');
 assert.equal(gate(blowDone.gates,'FILL').canStart,true);
 assert.equal(gate(blowDone.gates,'PACK').displayState,'BLOCKED');
 const fillStarted=applyRoutingStageAction(stages,blowDone.states,'FILL','START');
 assert.equal(gate(fillStarted.gates,'FILL').canComplete,true);
 assert.equal(gate(fillStarted.gates,'PACK').canStart,false);
 const fillDone=applyRoutingStageAction(stages,fillStarted.states,'FILL','COMPLETE');
 assert.equal(gate(fillDone.gates,'PACK').canStart,true);
 assert.equal(gate(fillDone.gates,'FILL').displayState,'COMPLETED');
});
test('a stage cannot jump to completed, restart, or complete before its predecessors',()=>{
 assert.throws(()=>applyRoutingStageAction(stages,{},'PREP','COMPLETE'),/must be IN_PROGRESS/);
 assert.throws(()=>applyRoutingStageAction(stages,{},'FILL','COMPLETE'),/cannot complete until PREP, BLOW/);
 const a=applyRoutingStageAction(stages,{},'PREP','START');
 assert.throws(()=>applyRoutingStageAction(stages,a.states,'PREP','START'),/cannot start from IN_PROGRESS/);
 const b=applyRoutingStageAction(stages,a.states,'PREP','COMPLETE');
 assert.throws(()=>applyRoutingStageAction(stages,b.states,'PREP','START'),/cannot start from COMPLETED/);
 assert.throws(()=>applyRoutingStageAction(stages,b.states,'PREP','COMPLETE'),/must be IN_PROGRESS/);
 assert.throws(()=>applyRoutingStageAction(stages,b.states,'MISSING','START'),/not part of the selected process route/);
 assert.throws(()=>applyRoutingStageAction(stages,b.states,'BLOW','SKIP'),/Unsupported manufacturing stage action/);
});
test('invalid dependency graphs and spoofed states fail closed',()=>{
 assert.throws(()=>routingStageGates([{code:'A-1',dependsOn:['B-1']},{code:'B-1'}]),
  /distinct, earlier/);
 assert.throws(()=>routingStageGates([{code:'A-1',dependsOn:['A-1']}]),/distinct, earlier/);
 assert.throws(()=>routingStageGates([{code:'A-1'},{code:'A-1'}]),/Duplicate/);
 assert.throws(()=>routingStageGates([{code:'A-1',dependsOn:['UNKNOWN']}]),/distinct, earlier/);
 assert.throws(()=>routingStageGates([{code:'A-1',dependsOn:['X','X']}]),/distinct, earlier/);
 assert.throws(()=>routingStageGates(stages,{OTHER:'COMPLETED'}),/Unknown process stage/);
 assert.throws(()=>routingStageGates(stages,{PREP:'APPROVED'}),/Invalid process completion status/);
 assert.throws(()=>routingStageGates(stages,{FILL:'COMPLETED'}),/Inconsistent process state/);
 assert.throws(()=>routingStageGates(stages,{PREP:'IN_PROGRESS',BLOW:'COMPLETED',FILL:'IN_PROGRESS'}),
  /Inconsistent process state/);
});
test('only an explicitly completed predecessor counts — in progress is insufficient',()=>{
 const a=routingStageGates(stages,{PREP:'IN_PROGRESS',BLOW:'IN_PROGRESS'});
 assert.equal(gate(a,'FILL').displayState,'BLOCKED');
 assert.equal(gate(a,'FILL').canStart,false);
 assert.equal(gate(a,'FILL').canComplete,false);
});
test('backend preview is explicitly non-posting, scoped, and cannot claim actual completion',()=>{
 const foundation=read('backend/plnMfgFoundation.ts');
 assert.ok(foundation.includes("'POST /api/org/pln-mfg/foundation/routing-dependency-preview'"));
 assert.ok(foundation.includes("recordAccess(ctx,'MFG.view',siteId)"));
 assert.ok(foundation.includes('applyRoutingStageAction(steps,states,code,action)'));
 assert.ok(foundation.includes('routingStageGates(steps,states)'));
 assert.ok(foundation.includes('previewOnly:true,productionEvidence:false'));
 const module=read('backend/mfgStageDependencies.ts');
 assert.ok(module.includes('SAME atomic production-order transaction'));
 assert.ok(!module.includes('writeDoc('));
 assert.ok(!module.includes('commitChecked('));
});
test('mobile routing review displays blocked stages and requires both start and complete transitions',()=>{
 const ui=read('src/org/PlnProcessRoutingEditor.tsx');
 assert.ok(ui.includes("aria-label='Stage dependency completion simulation'"));
 assert.ok(ui.includes("'/api/org/pln-mfg/foundation/routing-dependency-preview'"));
 assert.ok(ui.includes("type:'START'"));
 assert.ok(ui.includes("type:'COMPLETE'"));
 assert.ok(ui.includes('disabled={!gate.canStart||dependencyBusy}'));
 assert.ok(ui.includes('disabled={!gate.canComplete||dependencyBusy}'));
 assert.ok(ui.includes("gate.unmetPredecessors.map("));
 assert.ok(ui.includes('Reset simulation'));
 assert.ok(ui.includes('does not record actual production or equipment completion'));
 assert.ok(ui.includes('setDependencyStates({});setDependencyPreview(null);'));
});
