import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
test('Safety mirrors exactly the six existing equipment configuration screens and original equipment IDs',()=>{
 const ui=read('src/org/SafetyRiskAssessments.tsx');
 const home=read('src/org/OrgHomePage.tsx');
 const shell=read('src/org/OrgShell.tsx');
 for(const label of ['Hazardous Energy Sources','Short Intervention Program','LOTO Program','Equipment Interlocks and Safety Devices','Task Class Risk Assessment','Tasks'])assert.ok(ui.includes("label:'"+label+"'"));
 for(const name of ['EquipmentEnergySources','EquipmentLoto','EquipmentSafetyDevices','ActivityClassRisks','EquipmentTasks'])assert.ok(ui.includes('<'+name+' workCenterId={workCenterId}'));
 assert.ok(!ui.includes('WorkCenterAsset'));
 assert.ok(!ui.includes('EquipmentUtilities'));
 assert.ok(ui.includes("'/api/org/structure/node',{id,safetyOnly:true}"));
 assert.ok(home.includes("path:'saf_risk_assessments'"));
 assert.ok(shell.includes("case 'saf_risk_assessments'"));
});
test('Safety hierarchy includes only paths to scoped equipment and tasks cannot be created from the Safety mirror',()=>{
 const api=read('backend/safEquipment.ts'),structure=read('backend/structure.ts'),mirror=read('src/org/SafetyRiskAssessments.tsx'),tasks=read('src/org/EquipmentTasks.tsx');
 assert.ok(structure.includes('ctx.body.safetyOnly===true'));
 assert.ok(structure.includes('canAt(ctx,p,path,scope)'));
 assert.ok(structure.includes("id!=='root'&&!visible.has(id)"));
 assert.ok(mirror.includes('allowCreate={false}'));
 assert.ok(tasks.includes('allowCreate&&data.canCreate'));
 // Never from the Safety mirror; otherwise only Organization Design rights or the assigned assessor of a work order on this equipment.
 assert.ok(api.includes("!requested&&(ctx.body.source==='safety'||!await equipmentTaskCreationAllowed(ctx,id))"));
 assert.ok(api.includes("if(holdsDirect(ctx,['ADM.structure']))return true;"));
 assert.ok(api.includes("if(!wo||str(wo.data.unitId)!==id)return false;"));
 assert.ok(api.includes("await requireWorkOrderAssessor(ctx,wo);return true;}catch{return false;}"));
 assert.ok(api.includes("'/equipment_task_register/'+id+'/tasks'"));
});
