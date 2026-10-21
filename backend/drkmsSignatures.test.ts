import assert from 'node:assert/strict';
import test from 'node:test';
import {validPosition} from './drkmsSignatures';
test('document signer placement uses bounded page-relative coordinates',()=>{
 assert.equal(validPosition({page:1,xPercent:60,yPercent:75,widthPercent:35}),true);
 assert.equal(validPosition({page:0,xPercent:10,yPercent:50,widthPercent:30}),false);
 assert.equal(validPosition({page:1,xPercent:95,yPercent:50,widthPercent:20}),false);
 assert.equal(validPosition({page:1,xPercent:-5,yPercent:50,widthPercent:30}),false);
 assert.equal(validPosition({page:1,xPercent:10,yPercent:95,widthPercent:30}),false);
 assert.equal(validPosition({page:1,xPercent:10,yPercent:30,widthPercent:5}),false);
});
