import test from 'node:test';
import assert from 'node:assert/strict';
import {profileQualification,profileWorkplace,showReporteesCard} from '../../src/org/hrProfileSummary.ts';
test('education shows qualification plus field of study, but does not invent a specialization',()=>{
 assert.deepEqual(profileQualification({qualification:'Bachelor degree',field:'Mechanical Engineering'}),
  {name:'Bachelor degree',specialization:'Mechanical Engineering'});
 assert.deepEqual(profileQualification({qualification:'Master degree',field:''}),{name:'Master degree',specialization:''});
});
test('corporate assignment is displayed as corporate scope instead of an imaginary site',()=>{
 assert.deepEqual(profileWorkplace('',{name:'Group Office',level:'group'}),{label:'Corporate scope',name:'Group Office'});
 assert.deepEqual(profileWorkplace('',{name:'Regional HQ',level:'legal_entity'}),{label:'Legal entity',name:'Regional HQ'});
 assert.deepEqual(profileWorkplace('Embakasi',{name:'Packaging',level:'department'}),{label:'Site',name:'Embakasi'});
 assert.deepEqual(profileWorkplace('',{name:'Technical Services',level:'department'}),{label:'Operating unit',name:'Technical Services'});
 assert.deepEqual(profileWorkplace('',null),{label:'Site',name:''});
});
test('reportees action is hidden for zero counts, shown only when reporting employees exist',()=>{
 assert.equal(showReporteesCard(0),false);
 assert.equal(showReporteesCard(1),true);
 assert.equal(showReporteesCard(5),true);
 assert.equal(showReporteesCard(-1),false);
});
