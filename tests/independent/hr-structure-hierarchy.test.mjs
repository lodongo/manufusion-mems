import test from 'node:test';
import assert from 'node:assert/strict';
import {structureIndex,structurePath,subtreeCount,levelLabel} from '../../src/org/hrStructureTree.ts';
const nodes=[
 {id:'l',name:'Company',code:'LE',level:'legal_entity',parentId:'',status:'active'},
 {id:'s',name:'Nairobi',code:'NBO',level:'site',parentId:'l',status:'active'},
 {id:'d',name:'Manufacturing',code:'MFG',level:'department',parentId:'s',status:'active'},
 {id:'c',name:'Engineering Stores',code:'ST',level:'cost_center',parentId:'d',status:'active'},
 {id:'w',name:'Filler',code:'F1',level:'work_center',parentId:'c',status:'active'},
 {id:'o',name:'External visible site',code:'OUT',level:'site',parentId:'hidden-parent',status:'active'},
];
test('highest accessible level opens first, then immediate children',()=>{
 const index=structureIndex([...nodes].reverse());
 assert.deepEqual(index.roots.map(n=>n.id),['l','o']);
 assert.deepEqual(index.children.get('l').map(n=>n.id),['s']);
 assert.deepEqual(index.children.get('s').map(n=>n.id),['d']);
 assert.equal(subtreeCount('l',index),4);
 assert.deepEqual(structurePath('w',index),['l','s','d','c','w']);
});
test('orphaned authorized site remains accessible and level labels are readable',()=>{
 const index=structureIndex([nodes[5]]);
 assert.equal(index.roots[0].id,'o');
 assert.deepEqual(structurePath('o',index),['o']);
 assert.equal(levelLabel('cost_center'),'Cost centre');
});
test('cycles do not hang hierarchy or hide authorized nodes',()=>{
 const cyc=[
 {id:'a',name:'A',code:'A',level:'site',parentId:'b',status:'active'},
 {id:'b',name:'B',code:'B',level:'department',parentId:'a',status:'active'},
 ];
 const index=structureIndex(cyc);
 assert.ok(index.roots.length>0);
 assert.equal(subtreeCount('a',index),1);
 assert.equal(new Set(structurePath('a',index)).size,2);
});
