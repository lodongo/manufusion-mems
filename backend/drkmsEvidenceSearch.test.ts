import assert from 'node:assert/strict';
import test from 'node:test';
import {rankEvidence} from './drkmsEvidenceSearch';
const entries=[
 {sourceType:'work_order' as const,sourceId:'WO1',title:'Bottle jam at filler',excerpt:'Repeated jam after changeover',reference:'work_order:WO1'},
 {sourceType:'controlled_document' as const,sourceId:'a'.repeat(20),title:'Filler OEM guide',excerpt:'Maintenance instruction',reference:'document:'+ 'a'.repeat(20),revisionId:'b'.repeat(64)},
];
test('equipment evidence search ranks title hits with original source reference',()=>{
 const hits=rankEvidence('bottle jam',entries);
 assert.equal(hits[0].reference,'work_order:WO1');
 assert.ok(hits[0].score>0);
});
test('search cannot hallucinate unmatched evidence',()=>assert.deepEqual(rankEvidence('transformer',entries),[]));
test('empty query does not reveal entire evidence corpus',()=>assert.deepEqual(rankEvidence('',entries),[]));
test('result counts are bounded',()=>assert.equal(rankEvidence('filler',[...entries,...entries],1).length,1));
