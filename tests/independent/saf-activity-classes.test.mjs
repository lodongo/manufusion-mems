import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ACTIVITY_CLASSES,categoryColor,HAZARD_COLORS,meetsClassPermitMinimum} from '../../backend/safActivityClasses.ts';
import {SAF_DEFAULT_LISTS} from '../../backend/safDefaults.ts';
test('activity classes have stable unique codes and valid mandatory permits',()=>{
 const permits=SAF_DEFAULT_LISTS.find(x=>x.key==='permitTypes').items;
 assert.equal(new Set(ACTIVITY_CLASSES.map(x=>x.code)).size,ACTIVITY_CLASSES.length);
 assert.equal(ACTIVITY_CLASSES.find(x=>x.label==='No Risk').assessmentKind,'screening');
 assert.equal(ACTIVITY_CLASSES.find(x=>x.label==='Short Intervention Control').assessmentKind,'short');
 for(const cl of ACTIVITY_CLASSES)for(const p of cl.requiredPermits)assert.ok(permits.some(x=>x.code===p),p);
});
test('every hazard category has a valid color and a valid custom color takes precedence',()=>{
 const hazards=SAF_DEFAULT_LISTS.find(x=>x.key==='hazards').items;
 for(const h of hazards)assert.match(HAZARD_COLORS[h.category],/^#[0-9A-F]{6}$/);
 assert.equal(categoryColor('Electrical',{'Electrical':'#123abc'}),'#123ABC');
 assert.equal(categoryColor('Electrical',{'Electrical':'blue'}),HAZARD_COLORS.Electrical);
});
test('equipment energy and activity class screens enforce adopted codes and maintain separate records',()=>{
 const api=readFileSync('backend/safEquipment.ts','utf8');
 const ui=readFileSync('src/org/StructurePage.tsx','utf8');
 assert.ok(api.includes("effectiveSafetyItems(ctx.orgId,'activityClasses')"));
 assert.ok(api.includes("effectiveSafetyItems(ctx.orgId,'hazardousEnergy')"));
 assert.ok(api.includes('Add a photo for each energy point'));
 assert.ok(api.includes('No Risk requires documented screening'));
 assert.ok(api.includes('equipment_activity_class_risks'));
 assert.ok(ui.includes('Activity Class Risk Assessment'));
 assert.ok(ui.indexOf('Hazardous Energy Sources')<ui.lastIndexOf('LOTO Program'));
});

test('hot work and ground disturbance require an applicable permit instead of welding or excavation for every task',()=>{
 assert.equal(meetsClassPermitMinimum('AC09',['SAF_08_02_002']),true);
 assert.equal(meetsClassPermitMinimum('AC09',['SAF_08_01_003']),false);
 assert.equal(meetsClassPermitMinimum('AC13',['SAF_08_04_006']),true);
 assert.equal(meetsClassPermitMinimum('AC21',[]),false);
});
