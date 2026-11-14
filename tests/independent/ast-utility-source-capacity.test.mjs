import test from 'node:test';
import assert from 'node:assert/strict';
import {capacityDeterminant,capacityStatus} from '../../backend/astUtilities.ts';
import {AST_UTILITY_ITEMS} from '../../backend/astUtilityDefaults.ts';
test('capacity determinants use correct additive units',()=>{
  const by=code=>capacityDeterminant(AST_UTILITY_ITEMS.find(x=>x.code===code));
  assert.equal(by('UTL-01-002').key,'current');
  assert.equal(by('UTL-08-001').unit,'Nm³/h');
  assert.equal(by('UTL-06-003').unit,'kg/h');
  assert.equal(by('UTL-25-001'),null);
});
test('strict 84 percent warning and overcapacity',()=>{
  assert.equal(capacityStatus(1000,840,0).status,'normal');
  assert.equal(capacityStatus(1000,850,0).status,'warning');
  assert.equal(capacityStatus(1000,1001,0).status,'overload');
  assert.equal(capacityStatus(1000,600,1).status,'unknown');
  assert.equal(capacityStatus(null,600,0).status,'unknown');
});
