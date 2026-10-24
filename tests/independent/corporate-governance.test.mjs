import test from 'node:test';
import assert from 'node:assert/strict';
import {corporateDefaults,validateCorporateDesign} from '../../backend/corporateGovernance.ts';

const entities=new Set(['KE','UG','TZ']);
const groups=new Set(['G_HEADQUARTERS']);
const roles=new Set(['ROL_GROUP_CEO','ROL_GROUP_CFO','ROL_BOARD_CHAIR']);
const normalize=(c)=>validateCorporateDesign(c,entities,groups,roles);
test('corporate defaults include corporate functions and governance bodies, not new legal entities',()=>{
 const defaults=corporateDefaults();
 assert.equal(defaults.office.name,'Corporate Office');
 assert.deepEqual(defaults.functions.map(x=>x.code),['FIN','HR','ENG','PRC','IT','LEG','STR','SUS']);
 assert.ok(defaults.bodies.some(x=>x.code==='BOARD'&&x.scope==='group'));
 assert.ok(defaults.bodies.some(x=>x.code==='AUDIT'));
 assert.equal(defaults.version,0);
 assert.equal(normalize(defaults).functions.length,8);
});
test('group office links to existing upper level, functions can govern several active entities',()=>{
 const defaults=corporateDefaults();
 defaults.office.parentGroupNodeId='G_HEADQUARTERS';
 defaults.functions[0].headRoleCode='ROL_GROUP_CFO';
 defaults.functions[0].oversightEntityIds=['KE','UG'];
 defaults.functions[1].reportsToCode='FIN';
 defaults.bodies[0].chairRoleCode='ROL_BOARD_CHAIR';
 defaults.bodies[0].scope='entities';
 defaults.bodies[0].entityIds=['KE','TZ'];
 const config=normalize(defaults);
 assert.deepEqual(config.functions[0].oversightEntityIds,['KE','UG']);
 assert.deepEqual(config.bodies[0].entityIds,['KE','TZ']);
 assert.equal(config.office.parentGroupNodeId,'G_HEADQUARTERS');
});
test('invalid legal-entity scope, position, or group does not pass',()=>{
 const missing=corporateDefaults();missing.functions[0].oversightEntityIds=['EXTERNAL'];
 assert.throws(()=>normalize(missing),/legal entities/i);
 const dupe=corporateDefaults();dupe.functions[0].oversightEntityIds=['KE','KE'];
 assert.throws(()=>normalize(dupe),/distinct active legal entities/i);
 const role=corporateDefaults();role.bodies[0].chairRoleCode='OUTSIDE';
 assert.throws(()=>normalize(role),/job role/i);
 const office=corporateDefaults();office.office.parentGroupNodeId='FAKE';
 assert.throws(()=>normalize(office),/upper-level/i);
 const body=corporateDefaults();body.bodies[0].scope='entities';
 assert.throws(()=>normalize(body),/one or more/i);
});
test('corporate function reporting loops are prohibited, and duplicate codes are rejected',()=>{
 const self=corporateDefaults();self.functions[0].reportsToCode='FIN';
 assert.throws(()=>normalize(self),/another configured function/i);
 const cycle=corporateDefaults();cycle.functions[0].reportsToCode='HR';cycle.functions[1].reportsToCode='FIN';
 assert.throws(()=>normalize(cycle),/cycle/i);
 const dup=corporateDefaults();dup.bodies[1].code='BOARD';
 assert.throws(()=>normalize(dup),/Duplicate governance body/i);
});
