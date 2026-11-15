import test from 'node:test';
import assert from 'node:assert/strict';
import {MAINTENANCE_GATES,maintenanceGateReadiness} from '../../backend/maintenanceWorkflowConfig.ts';
test('maintenance workflow manifest has unique codes and complete stage coverage',()=>{
 assert.equal(new Set(MAINTENANCE_GATES.map(g=>g.code)).size,MAINTENANCE_GATES.length);
 for(const stage of ['request','assessment','conversion','planning','scheduling','execution','closure'])
  assert.ok(MAINTENANCE_GATES.some(g=>g.stage===stage),stage);
});
test('implemented maintenance gates become ready only with their required organizational roles',()=>{
 const roles=Object.fromEntries(MAINTENANCE_GATES.map(g=>[g.code,'ROL_000001']));
 const configured=maintenanceGateReadiness(roles);
 assert.ok(configured.every(g=>g.status==='existing'));
 assert.ok(configured.every(g=>g.ready));
 for(const gate of maintenanceGateReadiness({}).filter(g=>g.roleRequired))assert.equal(gate.ready,gate.optionalPolicy===true,gate.code);
});
test('assessment author is open but independent reviewer must be configured',()=>{
 const assess=maintenanceGateReadiness({}).find(g=>g.code==='MNT.WR.ASSESS');
 assert.equal(assess?.roleRequired,false);
 assert.equal(assess?.ready,true);
});
test('independent assessment review gate is assignable and permission-linked',()=>{
 const gate=maintenanceGateReadiness({}).find(g=>g.code==='MNT.ASSESS.REVIEW');
 assert.equal(gate?.permission,'MNT.assessment.review');
 assert.equal(gate?.mode,'approval');
 assert.equal(gate?.roleRequired,true);
 assert.equal(gate?.ready,false);
 assert.ok(gate?.requires.includes('current_assessment_version'));
});
test('closure requires only configured safety signatory, not handover or Technical Manager',()=>{
 const gates=maintenanceGateReadiness({});
 assert.ok(!gates.some(g=>['MNT.HANDOVER','MNT.WO.TECHNICAL_CLOSE'].includes(g.code)));
 const gate=gates.find(g=>g.code==='MNT.SAFETY.SIGNOFF');assert.equal(gate.roleRequired,true);assert.equal(gate.ready,false);
});
test('safety near-miss gate requires explicit declaration and incident record where applicable',()=>{
 const gate=MAINTENANCE_GATES.find(g=>g.code==='MNT.SAFETY.SIGNOFF');
 assert.ok(gate);
 assert.ok(gate.requires.includes('incident_declaration_explicit'));
 assert.ok(gate.requires.includes('incident_record_if_reported'));
});
test('maintenance windows are scheduled by the planner after readiness and Chart of Authority cost approval',()=>{
 const keys=MAINTENANCE_GATES.filter(g=>g.stage==='scheduling').map(g=>g.code);
 assert.ok(!keys.includes('MNT.WINDOW.ENGINEERING'));
 assert.ok(!keys.includes('MNT.WINDOW.SAFETY'));
 const lock=MAINTENANCE_GATES.find(g=>g.code==='MNT.WINDOW.LOCK');
 assert.deepEqual(lock?.requires,['readiness_confirmed','same_equipment','work_fits_duration']);
 const release=MAINTENANCE_GATES.find(g=>g.code==='MNT.WO.RELEASE');
 assert.ok(release?.requires.includes('cost_approved_chart_of_authority'));
 const cost=MAINTENANCE_GATES.find(g=>g.code==='MNT.WO.COST');
 assert.equal(cost?.permission,'MNT.WO.costApprove');
 const close=MAINTENANCE_GATES.find(g=>g.code==='MNT.WR.CLOSE');
 assert.equal(close?.permission,'MNT.WR.close');
});


test('initial request review is assigned by the operational workflow and security role',()=>{
 const gate=maintenanceGateReadiness({}).find(g=>g.code==='MNT.WR.REVIEW');
 assert.equal(gate?.permission,'MNT.WR.review');
 assert.equal(gate?.roleRequired,true);
 assert.equal(gate?.ready,false);
 assert.equal(maintenanceGateReadiness({'MNT.WR.REVIEW':'ASSESS'}).find(g=>g.code==='MNT.WR.REVIEW')?.ready,true);
});

test('obsolete role mappings can be removed without deleting active or legacy conversion configuration',async()=>{const {currentMaintenanceMappings}=await import('../../backend/maintenanceWorkflowConfig.ts');assert.deepEqual(currentMaintenanceMappings({'MNT.HANDOVER':'O','MNT.WO.TECHNICAL_CLOSE':'T','MNT.SAFETY.SIGNOFF':'S','MNT.WR.CONVERT':'P'}),{'MNT.SAFETY.SIGNOFF':'S','MNT.WR.CONVERT':'P'});});
