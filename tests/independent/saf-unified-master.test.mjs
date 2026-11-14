import test from 'node:test';
import assert from 'node:assert/strict';
import {SAF_DEFAULT_LISTS} from '../../backend/safDefaults.ts';
import {AST_UTILITY_ITEMS} from '../../backend/astUtilityDefaults.ts';
import {buildSafetyHazardMaster} from '../../backend/safHazardMaster.ts';
import {HAZARD_COLORS} from '../../backend/safActivityClasses.ts';
import {appendCatalogue} from '../../backend/safHazardExpansion.ts';
const hazards=SAF_DEFAULT_LISTS.find(x=>x.key==='hazards').items,energy=SAF_DEFAULT_LISTS.find(x=>x.key==='hazardousEnergy').items;
test('every source has exact stable-code counterpart, shared color, and valid hazard links',()=>{
 const all=buildSafetyHazardMaster(hazards,energy,AST_UTILITY_ITEMS,{Electrical:'#123456'});
 assert.ok(hazards.length>=700);assert.ok(energy.length>=340);
 const map=new Map(all.hazards.map(x=>[x.code,x]));assert.equal(map.size,all.hazards.length);
 for(const s of [...all.internal,...all.external]){const h=map.get(s.code);assert.ok(h,s.code);assert.equal(h.label,s.label);assert.equal(h.color,s.color);assert.equal(h.category,s.hazardCategory);assert.ok(HAZARD_COLORS[h.category],h.category);for(const c of s.hazardCodes)assert.ok(map.has(c),c);}
 assert.equal(map.get('UTL-01-002').color,'#123456');assert.equal(map.get('SAF_03_01_001').color,'#123456');
});
test('catalogue expansion retains existing rows and disabled status',()=>{
 const a={code:energy[0].code,label:'Tenant custom',active:false};
 const rows=appendCatalogue([a],energy);assert.equal(rows[0],a);assert.equal(rows.length,energy.length);
});
