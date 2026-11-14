import test from 'node:test';
import assert from 'node:assert/strict';
import {SAF_DEFAULT_LISTS} from '../../backend/safDefaults.ts';
import {fieldsForPermit,normalizePermitFields,SAF_PERMIT_PARAMETER_MASTER} from '../../backend/safPermitTemplates.ts';
import {EXPANDED_PERMIT_REFERENCES} from '../../backend/safPermitExpanded.ts';
const permits=SAF_DEFAULT_LISTS.find(x=>x.key==='permitTypes').items;
test('all existing permit types have expanded specific controls and structured options',()=>{
 assert.equal(permits.length,24);
 for(const p of permits){
  const fields=fieldsForPermit(p.code,p.category,p.label);
  assert.ok(fields.length>=40,p.code);
  assert.ok(fields.some(f=>f.kind==='select'&&f.options?.length>=4),p.code);
  assert.ok(fields.some(f=>f.kind==='table'&&f.columns?.length>=4),p.code);
  assert.ok(EXPANDED_PERMIT_REFERENCES[p.code]?.length,p.code);
  assert.equal(new Set(fields.map(f=>f.code)).size,fields.length);
  for(const f of fields)assert.ok(SAF_PERMIT_PARAMETER_MASTER.some(x=>x.code===f.code),f.code);
 }
});
test('safety minimums are immutable and optional fields stay configurable across schema upgrade',()=>{
 const fields=fieldsForPermit('SAF_08_03_001','Access','Confined space entry');
 const normalized=normalizePermitFields(fields,{entry_gas:{enabled:false,required:false},work_kind:{enabled:false,required:false},environmental_controls:{enabled:true,required:true}});
 assert.ok(normalized.find(x=>x.code==='entry_gas').required);
 assert.ok(normalized.find(x=>x.code==='entry_gas').enabled);
 assert.equal(normalized.find(x=>x.code==='work_kind').enabled,false);
 assert.equal(normalized.find(x=>x.code==='environmental_controls').required,true);
 assert.ok(normalized.find(x=>x.code==='entry_gas').columns.find(c=>c.code==='limit'));
});

test('new live and inching permits include mandatory verified energy dispositions and safeguarding',()=>{
 for(const [code,required] of [['SAF_08_01_006',['live_mechanical_points','live_mechanical_safeguards','live_mechanical_authority']],['SAF_08_01_007',['controlled_motion_limits','controlled_motion_energy','controlled_motion_restore']]]){
  const p=permits.find(x=>x.code===code);assert.ok(p);const fields=fieldsForPermit(p.code,p.category,p.label);
  for(const key of required)assert.equal(fields.find(x=>x.code===key)?.mandatory,true,key);
 }
});
