import assert from 'node:assert/strict';
import test from 'node:test';
import {scannerSignature,validScannerVerdict,type ScanVerdict} from './drkmsScanner';
const v:ScanVerdict={orgId:'tenant123',documentId:'a'.repeat(20),fileId:'b'.repeat(20),
 sha256:'c'.repeat(64),verdict:'clean',engine:'ClamAV',engineVersion:'1.4.3',scannedAt:new Date().toISOString()};
test('scanner callback verdict authenticates the exact file and engine result',()=>{
 const secret='integration-test-secret-32-characters-minimum';
 assert.equal(scannerSignature(secret,v).length,64);
 assert.notEqual(scannerSignature(secret,v),scannerSignature(secret,{...v,sha256:'d'.repeat(64)}));
 assert.notEqual(scannerSignature(secret,v),scannerSignature(secret,{...v,verdict:'infected'}));
 assert.notEqual(scannerSignature(secret,v),scannerSignature('other-secret',v));
});
test('scanner rejects expired attestations and unsafe identifiers',()=>{
 assert.equal(validScannerVerdict(v),true);
 assert.equal(validScannerVerdict({...v,orgId:'../tenant'}),false);
 assert.equal(validScannerVerdict({...v,scannedAt:'2020-01-01T00:00:00Z'}),false);
 assert.equal(validScannerVerdict({...v,verdict:'trusted'}),false);
});
