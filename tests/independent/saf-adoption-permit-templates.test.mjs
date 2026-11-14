import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SAF_MACHINE_STATES,fieldsForPermit,normalizePermitFields,SAF_PERMIT_PARAMETER_MASTER} from '../../backend/safPermitTemplates.ts';
import {SAF_DEFAULT_LISTS} from '../../backend/safDefaults.ts';
test('controlled SAF machine statuses preserve the existing maintenance codes',()=>{
 assert.deepEqual(new Set(SAF_MACHINE_STATES.map(x=>x.code)),new Set(['total_shutdown','full_loto','partial_isolation','live']));
 assert.ok(SAF_MACHINE_STATES[0].description.includes('not proof of isolation'));
 assert.ok(SAF_DEFAULT_LISTS.some(x=>x.key==='permitParameters'));
});
test('every existing permit type receives a distinct configurable form and core controls',()=>{
 const permits=SAF_DEFAULT_LISTS.find(x=>x.key==='permitTypes').items;
 assert.ok(permits.length>=22);
 for(const p of permits){
  const fields=fieldsForPermit(p.code,p.category,p.label);
  assert.equal(fields.length,new Set(fields.map(x=>x.code)).size,p.code);
  assert.ok(fields.length>=24,p.code);
  for(const code of ['risk_ref','issuer','valid_until','site_check','closure'])assert.ok(fields.some(f=>f.code===code&&f.mandatory));
  assert.ok(fields.some(x=>x.section==='Permit-specific controls'),p.code);
 }
 assert.equal(SAF_PERMIT_PARAMETER_MASTER.length,new Set(SAF_PERMIT_PARAMETER_MASTER.map(x=>x.code)).size);
});
test('mandatory controls cannot be removed while optional parameters can be disabled or required',()=>{
 const defs=fieldsForPermit('SAF_08_01_003','Energy','LOTO isolation');
 const actual=normalizePermitFields(defs,{zero_energy:{enabled:false,required:false},contractor:{enabled:false,required:true},attachments:{enabled:true,required:true}});
 assert.ok(actual.find(f=>f.code==='zero_energy').required);
 assert.ok(!actual.find(f=>f.code==='contractor').enabled);
 assert.ok(!actual.find(f=>f.code==='contractor').required);
 assert.ok(actual.find(f=>f.code==='attachments').required);
});
test('the organization SAF adoption is scoped and enforced for new maintenance task selections',()=>{
 const api=readFileSync('backend/safConfiguration.ts','utf8');
 const mnt=readFileSync('backend/maintenance.ts','utf8');
 assert.ok(api.includes('holdsDirect(ctx,PERMS.matrixConfigure)'));
 assert.ok(api.includes('adoption_'));
 assert.ok(api.includes('updateTime'));
 assert.ok(mnt.includes("effectiveSafetyItems(ctx.orgId,'machineStatuses')"));
 assert.ok(mnt.includes('if(!lotoPermit)throw'));
 assert.ok(mnt.includes('if(!livePermit)throw'));
 assert.ok(api.includes('Core safety parameter cannot be disabled'));
});
