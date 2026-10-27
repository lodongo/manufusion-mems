import test from 'node:test';
import assert from 'node:assert/strict';
import { classifiedMaterialPrefix } from '../../backend/materialNumbering.ts';

test('integrated stores classification determines stable material code prefix', () => {
  const template = {accounting:{catalogueClassification:{majorBranch:'MRO',
    storesClassCode:'ESP', numberingPattern:'ESP-MEC-BRG-{SEQ:06d}'}}};
  assert.equal(classifiedMaterialPrefix(template),'ESP-MEC-BRG');
  assert.equal(classifiedMaterialPrefix({accounting:{catalogueClassification:{
    majorBranch:'MRO',numberingPattern:'LUB-OIL-HYD-{SEQ:06d}'}}}),'LUB-OIL-HYD');
});

test('legacy and untrusted material code patterns cannot mint numbers', () => {
  assert.equal(classifiedMaterialPrefix({code:'MAT-005-S001-F001-N001'}),null);
  assert.equal(classifiedMaterialPrefix({accounting:{catalogueClassification:{
    numberingPattern:'../ESP-MEC-BRG-{SEQ:06d}'}}}),null);
  assert.equal(classifiedMaterialPrefix({accounting:{catalogueClassification:{
    numberingPattern:'ESP-MEC-BRG-{SEQ:03d}'}}}),null);
  assert.equal(classifiedMaterialPrefix(undefined),null);
});
