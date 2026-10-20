import assert from 'node:assert/strict';
import test from 'node:test';
import {safeSdsUrl,validateAiProposal,DRKMS_SPECIAL_TYPES,FORM_FIELD_TYPES} from './drkmsKnowledgeContracts';
const docId='a'.repeat(20);
test('SHEQ SDS entry remains uniquely codified',()=>assert.equal(DRKMS_SPECIAL_TYPES.find(t=>t.code==='SDS')?.owner,'SHEQ'));
test('manufacturer SDS source must be secure',()=>{
 assert.equal(safeSdsUrl('https://example.org/sds/current.pdf'),true);
 for(const url of ['http://example.org/sds.pdf','file:///etc/hosts','http://127.0.0.1/sds','https://localhost/sds','https://admin:secret@example.org/sds'])
  assert.equal(safeSdsUrl(url),false,url);
});
test('AI dynamic form proposals demand source traceability and human review',()=>{
 const proposal={kind:'form' as const,sourceDocumentIds:[docId],humanReviewStatus:'pending' as const,automatedExecution:false as const,
 fields:[{code:'HAZARD_1',label:'Hazard observed',type:'text' as const,required:true}]};
 assert.equal(validateAiProposal(proposal),true);
 assert.equal(validateAiProposal({...proposal,sourceDocumentIds:[]}),false);
 assert.equal(validateAiProposal({...proposal,humanReviewStatus:'approved' as 'pending'}),false);
});
test('dynamic forms include technical and safety field types',()=>{
 for(const type of ['risk_score','photo','signature','asset','material','table'])assert.ok(FORM_FIELD_TYPES.includes(type as typeof FORM_FIELD_TYPES[number]));
});
