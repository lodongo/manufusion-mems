import test from 'node:test';
import assert from 'node:assert/strict';
import {rankEducation} from '../../src/org/hrEducationSort.ts';
test('education cards show highest ranked attainment before recency',()=>{
 const levels=[{code:'SECONDARY',rank:2},{code:'BACHELOR',rank:5},{code:'MASTER',rank:6},{code:'DOCTORATE',rank:7}];
 const education=[
  {id:'s',levelCode:'SECONDARY',completionYear:'2025'},
  {id:'b',levelCode:'BACHELOR',completionYear:'2024'},
  {id:'p',levelCode:'DOCTORATE',completionYear:'2009'},
  {id:'m',levelCode:'MASTER',completionYear:'2020'},
  {id:'legacy',levelCode:'',completionYear:'2026'},
 ];
 const sorted=rankEducation(education,levels);
 assert.deepEqual(sorted.map(r=>r.record.id),['p','m','b','s','legacy']);
 assert.deepEqual(sorted.map(r=>r.originalIndex),[2,3,1,0,4]);
 assert.deepEqual(education.map(r=>r.id),['s','b','p','m','legacy'],'display sorting must not mutate saved array');
});
test('same rank sorts by newest completion year; ties preserve saved order',()=>{
 const rows=[{id:'a',levelCode:'MASTER',completionYear:'2020'},{id:'b',levelCode:'MASTER',completionYear:'2025'},{id:'c',levelCode:'MASTER',completionYear:'2025'}];
 assert.deepEqual(rankEducation(rows,[{code:'MASTER',rank:6}]).map(r=>r.record.id),['b','c','a']);
});
