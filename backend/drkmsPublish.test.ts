import assert from 'node:assert/strict';
import test from 'node:test';
import {releaseManifest} from './drkmsPublish';

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
