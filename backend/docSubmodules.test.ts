import assert from 'node:assert/strict';
import test from 'node:test';
import {docAreaForTransaction,enabledDocAreas,DOC_AREAS} from './docSubmodules';
test('default DOC areas are all enabled for existing tenants',()=>assert.deepEqual(enabledDocAreas(undefined),[...DOC_AREAS]));
test('disabled areas do not regain availability',()=>assert.deepEqual(enabledDocAreas(['register','sds','unexpected']),['register','sds']));
test('DOC routes map to their operational areas',()=>{
 assert.equal(docAreaForTransaction('drkms.rca.ai_analysis'),'rca');
 assert.equal(docAreaForTransaction('drkms.documents.review_decision'),'review');
 assert.equal(docAreaForTransaction('drkms.documents.publish'),'review');
 assert.equal(docAreaForTransaction('drkms.industrial.link'),'engineering');
 assert.equal(docAreaForTransaction('drkms.sds.register'),'sds');
 assert.equal(docAreaForTransaction('drkms.troubleshoot.search'),'knowledge');
 assert.equal(docAreaForTransaction('drkms.files.stage'),'register');
 assert.equal(docAreaForTransaction('drkms.configure'),null);
 assert.equal(docAreaForTransaction('drkms.submodules.status'),null);
});
