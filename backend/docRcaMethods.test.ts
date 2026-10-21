import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSteps,validMethodAnalysis} from './docRcaMethods';
test('Five Whys requires all five sequential prompts before completing DMAIC Analyze',()=>{
 const steps=analyzeSteps('5WHY','5M1W',[]);
 assert.deepEqual(steps,['WHY-1','WHY-2','WHY-3','WHY-4','WHY-5']);
 assert.equal(validMethodAnalysis('5WHY','5M1W',[],steps.slice(0,2).map(key=>({key,text:'Evidence-backed cause'})),true),false);
 assert.equal(validMethodAnalysis('5WHY','5M1W',[],steps.map(key=>({key,text:'Evidence-backed cause'})),true),true);
});
test('Ishikawa uses central active categories and rejects disabled or unexpected factors',()=>{
 const factors=['MAN','MACHINE','METHOD','MATERIAL','MEASUREMENT','WORKPLACE'];
 assert.deepEqual(analyzeSteps('ISH','5M1W',factors),factors);
 assert.equal(validMethodAnalysis('ISH','5M1W',factors,[{key:'ENVIRONMENT',text:'Cause example evidence'}],false),false);
 assert.equal(validMethodAnalysis('ISH','5M1W',factors,factors.map(key=>({key,text:'Causal observation'})),true),true);
});
test('other supported RCA methods cannot bypass their selected analysis model',()=>{
 assert.equal(validMethodAnalysis('FTA','5M1W',[],[{key:'WHY-1',text:'Evidence-based cause'}],false),false);
 assert.equal(validMethodAnalysis('FTA','5M1W',[],[{key:'TOP-EVENT',text:'Failure top event'}],true),false);
});
