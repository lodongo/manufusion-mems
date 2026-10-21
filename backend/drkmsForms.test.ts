import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFormFields,validateFormValues} from './drkmsForms';
const fields=validateFormFields([{code:'description',label:'Observation',type:'text',required:true},{code:'safe',label:'Safe condition',type:'yes_no',required:true},{code:'result',label:'Decision',type:'select',required:true,options:['Pass','Fail']}]);
test('form schema enforces codified unique fields',()=>{
 assert.equal(fields.length,3);
 assert.throws(()=>validateFormFields([{code:'bad field',label:'Invalid',type:'text',required:true}]));
 assert.throws(()=>validateFormFields([...fields,fields[0]]));
});
test('draft submission validates required typed values without extra fields',()=>{
 assert.deepEqual(validateFormValues(fields,{description:'Observed',safe:false,result:'Fail'}),{description:'Observed',safe:false,result:'Fail'});
 assert.throws(()=>validateFormValues(fields,{description:'Observed',safe:'false',result:'Fail'}));
 assert.throws(()=>validateFormValues(fields,{description:'Observed',safe:true,result:'Unknown'}));
 assert.throws(()=>validateFormValues(fields,{description:'Observed',safe:true,result:'Pass',injected:'value'}));
});
