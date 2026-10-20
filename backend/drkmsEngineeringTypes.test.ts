import assert from 'node:assert/strict';
import test from 'node:test';
import {ENGINEERING_DOC_TYPES} from './drkmsEngineeringTypes';

test('engineering type codes and class parents are valid',()=>{
 const codes=new Set(ENGINEERING_DOC_TYPES.map(x=>x.code));
 assert.equal(codes.size,ENGINEERING_DOC_TYPES.length);
 for(const x of ENGINEERING_DOC_TYPES){
  assert.ok(/^[A-Z][A-Z0-9-]{1,20}$/.test(x.code));
  assert.ok(x.label);
  assert.ok(x.parentClass);
 }
});
test('local and OEM engineering knowledge categories exist',()=>{
 for(const code of ['WI-MNT','WI-OPS','QFX','RCA','OEM-SRV','OEM-INS','ENG-PID','ENG-BOM','SAF-LOTO','MNT-PM']){
  assert.ok(ENGINEERING_DOC_TYPES.some(x=>x.code===code),code);
 }
});
