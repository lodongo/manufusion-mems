import assert from 'node:assert/strict';
import test from 'node:test';
import { documentFileSignatureValid } from './drkmsFiles';
test('accepts PDF signature',()=>assert.equal(documentFileSignatureValid(Buffer.from('%PDF-1.7\n'),'application/pdf'),true));
test('rejects mismatched declared file type',()=>assert.equal(documentFileSignatureValid(Buffer.from('not a pdf'),'application/pdf'),false));
test('recognizes PNG header',()=>assert.equal(documentFileSignatureValid(Buffer.from([137,80,78,71,13,10,26,10,0]),'image/png'),true));
test('rejects disguised openxml content',()=>assert.equal(documentFileSignatureValid(Buffer.from('abc123'),'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),false));
