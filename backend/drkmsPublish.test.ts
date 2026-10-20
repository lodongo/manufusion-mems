import assert from 'node:assert/strict';
import test from 'node:test';
import {publicationFingerprint,releaseManifest} from './drkmsPublish';

const files=[
 {fileId:'a',sha256:'a'.repeat(64),mime:'application/pdf',bytes:100},
 {fileId:'b',sha256:'b'.repeat(64),mime:'image/png',bytes:200},
];
test('publication manifest is deterministic regardless of attachment order',()=>{
 assert.equal(releaseManifest('a'.repeat(20),'00',files),releaseManifest('a'.repeat(20),'00',[...files].reverse()));
});
test('changing source content invalidates approved publication fingerprint',()=>{
 assert.notEqual(releaseManifest('a'.repeat(20),'00',files),releaseManifest('a'.repeat(20),'00',[{...files[0],sha256:'c'.repeat(64)},files[1]]));
});
test('revision and document identity each change publication fingerprint',()=>{
 const original=releaseManifest('a'.repeat(20),'00',files);
 assert.notEqual(original,releaseManifest('a'.repeat(20),'01',files));
 assert.notEqual(original,releaseManifest('b'.repeat(20),'00',files));
});

test('changed document scope or verifier invalidates the exact CoA fingerprint',()=>{
 const metadata={title:'Filler maintenance instruction',classCode:'WIN',subtypeCode:'WI-MNT',
  scopeNodeId:'site-A',verifiedBy:'engineer-A',verifiedAt:'2026-10-20T10:00:00Z',updatedAt:'2026-10-20T10:00:01Z'};
 const expected=publicationFingerprint('a'.repeat(20),'00',files,metadata);
 assert.notEqual(expected,publicationFingerprint('a'.repeat(20),'00',files,{...metadata,scopeNodeId:'site-B'}));
 assert.notEqual(expected,publicationFingerprint('a'.repeat(20),'00',files,{...metadata,verifiedBy:'engineer-B'}));
 assert.notEqual(expected,publicationFingerprint('a'.repeat(20),'00',files,{...metadata,title:'A changed title'}));
});
