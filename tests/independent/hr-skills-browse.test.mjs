import test from 'node:test';
import assert from 'node:assert/strict';
import {skillCategories,skillSubcategories,browseSkills} from '../../src/org/hrSkillBrowse.ts';

const entries=[
 {code:'HR_SK_001',name:'Pump inspection',category:'Engineering',subcategory:'Mechanical',description:'Inspect pump seals and alignment.',enabled:true},
 {code:'HR_SK_002',name:'PLC fault diagnosis',category:'Engineering',subcategory:'Automation',description:'Fault finding in PLC controls.',enabled:true},
 {code:'HR_NSK_019_008',name:'360-degree feedback improvement',category:'People',subcategory:'Development',description:'Apply 360-degree feedback.',enabled:true},
 {code:'HR_LOCAL_003',name:'Hydraulic diagnosis',category:'Engineering',subcategory:'Mechanical',description:'Troubleshooting of hydraulic pressure.',enabled:false},
 {code:'HR_OTHER',name:'Field repair',category:'',subcategory:'',description:'',enabled:true},
];
test('skills browser groups categories and subcategories using actual catalogue metadata',()=>{
 assert.deepEqual(skillCategories(entries).map(c=>[c.name,c.count]),[
  ['Engineering',3],['People',1],['Uncategorized',1]]);
 assert.deepEqual(skillSubcategories(entries,'Engineering').map(c=>[c.name,c.count]),[
  ['Automation',1],['Mechanical',2]]);
 assert.equal(skillSubcategories(entries,'Uncategorized')[0].name,'Uncategorized');
});
test('skill browser searches code, name, category, subcategory and description',()=>{
 assert.deepEqual(browseSkills(entries,'Engineering','Mechanical','').map(x=>x.code),['HR_LOCAL_003','HR_SK_001']);
 assert.deepEqual(browseSkills(entries,'','','HR_NSK_019_008').map(x=>x.name),['360-degree feedback improvement']);
 assert.deepEqual(browseSkills(entries,'','','alignment').map(x=>x.code),['HR_SK_001']);
 assert.deepEqual(browseSkills(entries,'Engineering','','automation').map(x=>x.code),['HR_SK_002']);
 assert.deepEqual(browseSkills(entries,'People','','HYDRAULIC'),[]);
 assert.equal(browseSkills(entries,'Uncategorized','','').length,1);
});
test('disabled skills keep codes and descriptions for HR detail review',()=>{
 const selected=browseSkills(entries,'Engineering','Mechanical','hydraulic');
 assert.equal(selected.length,1);
 assert.equal(selected[0].enabled,false);
 assert.equal(selected[0].description,'Troubleshooting of hydraulic pressure.');
});
