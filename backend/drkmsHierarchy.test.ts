import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDocumentLocation } from './drkmsHierarchy';

const nodes = [
 {id:'le',level:'legal_entity',parentId:'root',status:'active'},
 {id:'site',level:'site',parentId:'le',status:'active'},
 {id:'dep',level:'department',parentId:'site',status:'active'},
 {id:'cc',level:'cost_center',parentId:'dep',status:'active'},
];
test('valid document scope inherits hierarchy',()=>assert.deepEqual(validateDocumentLocation('cc',nodes),['le','site','dep','cc']));
test('reject wrong parent hierarchy',()=>assert.throws(()=>validateDocumentLocation('cc',[...nodes.filter(x=>x.id!=='dep'),{id:'dep',level:'department',parentId:'le',status:'active'}])));
test('reject disabled ancestors',()=>assert.throws(()=>validateDocumentLocation('site',nodes.map(n=>n.id==='le'?{...n,status:'inactive'}:n))));
test('reject cycles',()=>assert.throws(()=>validateDocumentLocation('cc',nodes.map(n=>n.id==='le'?{...n,parentId:'cc'}:n))));
