import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFormFields,validateFormValues,formFieldVisible,validIsoDate,formRecordFingerprint} from './drkmsForms';
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

test('conditional required fields apply only when visible and partial drafts are allowed',()=>{
 const fields=validateFormFields([
  {code:'needs_followup',label:'Follow-up required',type:'yes_no',required:true,section:'Initial'},
  {code:'followup_reason',label:'Explain follow-up',type:'long_text',required:true,section:'Details',
   visibleWhen:{fieldCode:'needs_followup',equals:true}}
 ]);
 assert.equal(formFieldVisible(fields[1],{needs_followup:false}),false);
 assert.deepEqual(validateFormValues(fields,{needs_followup:false,followup_reason:'stale'}),{needs_followup:false,followup_reason:null});
 assert.throws(()=>validateFormValues(fields,{needs_followup:true}));
 assert.deepEqual(validateFormValues(fields,{needs_followup:true},true),{needs_followup:true,followup_reason:null});
 assert.throws(()=>validateFormFields([
  {code:'child',label:'Child',type:'text',required:true,visibleWhen:{fieldCode:'parent',equals:true}},
  {code:'parent',label:'Parent',type:'yes_no',required:false}
 ]));
});

test('calendar dates reject impossible days and accept leap day',()=>{
 assert.equal(validIsoDate('2024-02-29'),true);
 assert.equal(validIsoDate('2025-02-29'),false);
 assert.equal(validIsoDate('2026-13-01'),false);
 assert.equal(validIsoDate('2026-10-21'),true);
});

test('strict submission rejects an incomplete required answer',()=>{
 const fields=validateFormFields([{code:'inspection_result',label:'Inspection result',type:'select',required:true,options:['Pass','Fail']}]);
 assert.throws(()=>validateFormValues(fields,{},false));
 assert.deepEqual(validateFormValues(fields,{},true),{inspection_result:null});
});

test('nested conditional questions cannot remain required after their parent is hidden',()=>{
 const fields=validateFormFields([
  {code:'gate',label:'First condition',type:'yes_no',required:true},
  {code:'decision',label:'Nested choice',type:'select',required:true,options:['A','B'],visibleWhen:{fieldCode:'gate',equals:true}},
  {code:'detail',label:'Detail',type:'text',required:true,visibleWhen:{fieldCode:'decision',equals:'A'}}
 ]);
 assert.deepEqual(validateFormValues(fields,{gate:false,decision:'A',detail:'stale'},false),{gate:false,decision:null,detail:null});
 assert.throws(()=>validateFormValues(fields,{gate:true,decision:'A'},false));
});
test('reviewed form fingerprint is canonical and binds source evidence',()=>{
 const base={id:'f'.repeat(20),templateId:'a'.repeat(20),templateRevision:'00',scopeNodeId:'site1',
  createdBy:'author1',values:{alpha:'yes',beta:false},operationalReference:null,
  attachments:[{documentId:'b'.repeat(20),revisionId:'c'.repeat(64),sha256:'d'.repeat(64)}]};
 const hash=formRecordFingerprint(base);
 assert.equal(hash.length,64);
 assert.equal(hash,formRecordFingerprint({...base,values:{beta:false,alpha:'yes'}}));
 assert.notEqual(hash,formRecordFingerprint({...base,values:{alpha:'no',beta:false}}));
 assert.notEqual(hash,formRecordFingerprint({...base,attachments:[]}));
});
