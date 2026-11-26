import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSupplierRelationshipTemplate} from './supplierRelationshipTemplate';
const json=readFileSync(new URL('./supplierRelationshipTemplate.json',import.meta.url),'utf8');
test('SRM default master has 130 questions and 100-point profiles',()=>{
 const result=validateSupplierRelationshipTemplate(json);
 assert.equal(result.questionCount,130);
 assert.equal(result.profiles.length,3);
 assert.ok(result.profiles.every(p=>p.weight===100&&p.categoryCount===10));
});
test('SRM rejects incorrect weights and accountability',()=>{
 const t=JSON.parse(json);t.evaluation_profiles[0].categories[0].questions[0].weight_percent+=1;
 assert.throws(()=>validateSupplierRelationshipTemplate(JSON.stringify(t)));
 const u=JSON.parse(json);u.evaluation_profiles[0].categories[0].questions[0].accountability='OTHER';
 assert.throws(()=>validateSupplierRelationshipTemplate(JSON.stringify(u)));
});
