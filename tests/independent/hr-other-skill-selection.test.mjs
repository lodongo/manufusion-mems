import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_SKILL_NOMINATIONS,otherSkillOptions,toggleSelectedSkill,selectVisibleSkills}
  from '../../src/org/hrSkillSelection.ts';

const skills=[
 {code:'REQ1',name:'Required machine maintenance',category:'Engineering',subcategory:'Mechanical',description:'Required role skill',enabled:true},
 {code:'OTHER1',name:'Welding',category:'Engineering',subcategory:'Mechanical',description:'Welding procedures',enabled:true},
 {code:'OTHER2',name:'Mechanical design',category:'Engineering',subcategory:'Mechanical',description:'Equipment design',enabled:true},
 {code:'OTHER3',name:'PLC programming',category:'Engineering',subcategory:'Automation',description:'PLC fundamentals',enabled:true},
 {code:'OFF',name:'Legacy welding',category:'Engineering',subcategory:'Mechanical',description:'Retired',enabled:false},
];
test('other skills selector filters selected category and subcategory, excluding role requirements',()=>{
 const options=otherSkillOptions(skills,'Engineering','Mechanical','',['REQ1']);
 assert.deepEqual(options.map(s=>s.code),['OTHER2','OTHER1']);
 assert.equal(otherSkillOptions(skills,'Engineering','Mechanical','welding',['REQ1']).length,1);
 assert.equal(otherSkillOptions(skills,'Engineering','Mechanical','OTHER2',['REQ1'])[0].description,'Equipment design');
 assert.equal(otherSkillOptions(skills,'Engineering','Automation','',['REQ1'])[0].code,'OTHER3');
 assert.deepEqual(otherSkillOptions(skills,'Engineering','','',['REQ1']),[]);
});
test('selection retains skills when user changes category and supports removing individual skills',()=>{
 let selected=[];
 selected=selectVisibleSkills(selected,['OTHER1','OTHER2']);
 selected=toggleSelectedSkill(selected,'OTHER3',true);
 assert.deepEqual(selected,['OTHER1','OTHER2','OTHER3']);
 selected=toggleSelectedSkill(selected,'OTHER1',false);
 assert.deepEqual(selected,['OTHER2','OTHER3']);
 selected=toggleSelectedSkill(selected,'OTHER2',true);
 assert.deepEqual(selected,['OTHER2','OTHER3']);
});
test('select-all never exceeds backend 25-skill limit and does not duplicate choices',()=>{
 const codes=Array.from({length:50},(_,i)=>'SK'+i);
 const selected=selectVisibleSkills([],codes);
 assert.equal(selected.length,MAX_SKILL_NOMINATIONS);
 assert.deepEqual(selectVisibleSkills(selected,codes),selected);
 assert.deepEqual(toggleSelectedSkill(selected,'NEW',true),selected);
});
