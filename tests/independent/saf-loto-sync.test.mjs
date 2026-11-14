import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AST_UTILITY_ITEMS} from '../../backend/astUtilityDefaults.ts';
import {SAF_DEFAULT_LISTS} from '../../backend/safDefaults.ts';
import {energyColor} from '../../backend/safEnergyColors.ts';
import {mergeUtilityEnergy} from '../../backend/safStatutoryInspections.ts';
test('every catalogue energy source and utility has a common display colour',()=>{
 const energy=SAF_DEFAULT_LISTS.find(x=>x.key==='hazardousEnergy').items;
 for(const d of [...energy,...AST_UTILITY_ITEMS])assert.match(energyColor(d),/^#[0-9a-f]{6}$/i,d.code);
 assert.equal(energyColor({code:'UTL-01-002'},{Electrical:'#123456'}),'#123456');
 assert.equal(energyColor({code:'SAF_03_01_001'},{Electrical:'#123456'}),'#123456');
 assert.equal(energyColor({code:'UTL-08-001',color:'#ABCDEF'}),'#ABCDEF');
});
test('legacy identity can be recovered but a newly created connection never inherits an old physical tag',()=>{
 const a={code:'UTL-08-001',connectionId:'A',values:{flow:40}};
 const rows=mergeUtilityEnergy([a],[{code:a.code,pointId:'previous',utilityConnectionId:'A',tag:'PA-7'}]);
 assert.equal(rows[0].tag,'PA-7');assert.equal(rows[0].utilityValues.flow,40);
 assert.equal(mergeUtilityEnergy([{...a,connectionId:'B'}],rows)[0].tag,'');
});
test('LOTO setup reachable from both organization navigation paths and energy table uses projected colours',()=>{
 const home=readFileSync('src/org/OrgHomePage.tsx','utf8'),admin=readFileSync('src/org/OrgShell.tsx','utf8'),table=readFileSync('src/org/EquipmentLoto.tsx','utf8');
 assert.ok(home.includes("path:'saf_loto'")&&home.includes("section==='saf_loto'"));
 assert.ok(admin.includes("case 'saf_loto'"));
 assert.ok(table.includes('p.color')&&table.includes('Configure energy sources & tags'));
});
