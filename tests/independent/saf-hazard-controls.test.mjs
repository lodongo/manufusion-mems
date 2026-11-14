import test from 'node:test';
import assert from 'node:assert/strict';
import {SAF_DEFAULT_LISTS} from '../../backend/safDefaults.ts';
import {AST_UTILITY_ITEMS} from '../../backend/astUtilityDefaults.ts';
import {buildSafetyHazardMaster} from '../../backend/safHazardMaster.ts';
import {hazardControlProfile,MITIGATION_MEASURE_MASTER,INJURY_NATURE_MASTER,CONTROL_HIERARCHY,profileAdoption} from '../../backend/safHazardControlLibrary.ts';
const master=buildSafetyHazardMaster(SAF_DEFAULT_LISTS.find(x=>x.key==='hazards').items,SAF_DEFAULT_LISTS.find(x=>x.key==='hazardousEnergy').items,AST_UTILITY_ITEMS);
const controls=new Set(MITIGATION_MEASURE_MASTER.map(x=>x.code)),injuries=new Set(INJURY_NATURE_MASTER.map(x=>x.code));
test('all synchronized hazard codes have five ordered layers and linked candidate injuries and controls',()=>{
 assert.ok(master.hazards.length>=1200);
 assert.equal(controls.size,MITIGATION_MEASURE_MASTER.length);assert.equal(injuries.size,INJURY_NATURE_MASTER.length);
 for(const h of master.hazards){const p=hazardControlProfile(h);assert.equal(p.hazardCode,h.code);assert.deepEqual(p.layers.map(x=>x.rank),[1,2,3,4,5]);assert.ok(p.injuries.length>=4,h.code);for(const layer of p.layers){assert.ok(layer.measures.length>0,h.code);assert.ok(layer.measures.every(x=>controls.has(x.code)),h.code);}assert.ok(p.injuries.every(x=>injuries.has(x.code)),h.code);}
});
test('source mechanisms distinguish electrical, pressure, chemical and rotating hazards',()=>{
 const get=code=>hazardControlProfile(master.hazards.find(h=>h.code===code));
 assert.ok(get('UTL-01-002').mechanisms.some(m=>m.code==='ELE'));
 assert.ok(get('UTL-08-001').mechanisms.some(m=>m.code==='PNE'));
 assert.ok(get('UTL-17-001').mechanisms.some(m=>m.code==='ACID'));
 assert.ok(get('SAF_01_01_001').mechanisms.some(m=>m.code==='ROT'));
 assert.ok(get('SAF_01_01_001').layers[4].measures.some(x=>/entanglement risk/i.test(x.label)));
});
test('whole-layer and individual adoption intersect organization-wide settings',()=>{
 const p=hazardControlProfile(master.hazards.find(h=>h.code==='UTL-01-002'));
 const global={hierarchy:CONTROL_HIERARCHY.map(x=>x.code),measures:[...controls],injuries:[...injuries]};
 const x=p.layers[2].measures[0].code,i=p.injuries[0].code;
 const a=profileAdoption(p,{disabledLayers:['HC01'],disabledMeasures:[x],disabledInjuries:[i]},global,true);
 assert.ok(a.layers[0].measures.every(m=>!m.effective));assert.equal(a.layers[2].measures[0].effective,false);assert.equal(a.injuries[0].effective,false);
 assert.ok(a.layers[2].measures.some(m=>m.effective));
 assert.ok(profileAdoption(p,{disabledLayers:[],disabledMeasures:[],disabledInjuries:[]},global,false).layers.every(l=>l.measures.every(m=>!m.effective)));
});
