import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRuleDraft,resolveAccountRule} from '../../backend/finAccountRules.ts';
import {mroFinancialContext,originalMroIssueAccounts} from '../../backend/mroGlDetermination.ts';

const base={event:'GI_WO',role:'MAINT_CONSUMPTION',categoryCode:'MAT-005',costCenterId:'',
 account:'50203030',priority:100,enabled:true};
test('Approved WO maintenance type rules choose different GL accounts for same spare',()=>{
 const rules=validateRuleDraft([
  {...base,id:'generic'},
  {...base,id:'preventive',maintenanceTypeCode:'MAI-001',account:'50203020'},
  {...base,id:'corrective',maintenanceTypeCode:'MAI-002',account:'50203030'},
 ]);
 const ctx={event:'GI_WO',categoryCode:'MAT-005',costCenterId:'CC-03'};
 assert.equal(resolveAccountRule(rules,'MAINT_CONSUMPTION',{...ctx,maintenanceTypeCode:'MAI-001'})?.account,'50203020');
 assert.equal(resolveAccountRule(rules,'MAINT_CONSUMPTION',{...ctx,maintenanceTypeCode:'MAI-002'})?.account,'50203030');
 assert.equal(resolveAccountRule(rules,'MAINT_CONSUMPTION',{...ctx,maintenanceTypeCode:'MAI-003'})?.id,'generic');
 assert.equal(resolveAccountRule(rules,'MAINT_CONSUMPTION',ctx)?.id,'generic');
});
test('Stores class refines WO account independently from technical item identity',()=>{
 const rules=validateRuleDraft([
  {...base,id:'pm-spare',maintenanceTypeCode:'MAI-001',costNatureCode:'ESP',account:'50203020'},
  {...base,id:'pm-lubricant',maintenanceTypeCode:'MAI-001',costNatureCode:'LUB',account:'62004030'},
 ]);
 const ctx={event:'GI_WO',categoryCode:'MAT-005',maintenanceTypeCode:'MAI-001'};
 assert.equal(resolveAccountRule(rules,'MAINT_CONSUMPTION',{...ctx,costNatureCode:'ESP'})?.id,'pm-spare');
 assert.equal(resolveAccountRule(rules,'MAINT_CONSUMPTION',{...ctx,costNatureCode:'LUB'})?.id,'pm-lubricant');
 assert.equal(resolveAccountRule(rules,'MAINT_CONSUMPTION',ctx),null);
});
test('A maintenance-only rule cannot leak into non-maintenance events or roles',()=>{
 assert.throws(()=>validateRuleDraft([{...base,event:'GI_CC',role:'CONSUMPTION',maintenanceTypeCode:'MAI-001'}]),/only allowed for work-order consumption/);
 assert.throws(()=>validateRuleDraft([{...base,role:'INVENTORY',maintenanceTypeCode:'MAI-001'}]),/only allowed for work-order consumption/);
});
test('Rule specificity and scope accept optional cost nature and preserve category rules',()=>{
 const rules=validateRuleDraft([
 {...base,id:'global',categoryCode:'',priority:1},
 {...base,id:'pm',maintenanceTypeCode:'MAI-001',account:'50203020',priority:999},
 ]);
 assert.equal(resolveAccountRule(rules,'MAINT_CONSUMPTION',{event:'GI_WO',categoryCode:'MAT-005',maintenanceTypeCode:'MAI-001'})?.id,'pm');
 assert.equal(resolveAccountRule(rules,'MAINT_CONSUMPTION',{event:'GI_WO',categoryCode:'MAT-005',maintenanceTypeCode:'MAI-002'})?.id,'global');
});
test('Task strategy overrides WO default, otherwise strategy inherits, Stores class is explicit',()=>{
 const wo={maintenanceTypeCode:'MAI-001',maintenanceTypeLabel:'Preventive Maintenance',
  assessmentTasks:[{id:'t1',maintenanceTypeCode:'MAI-002',maintenanceTypeLabel:'Corrective Maintenance'},{id:'t2'}]};
 const material={storesClassCode:'ESP',name:'Ball bearing'};
 const first=mroFinancialContext(wo,'t1',material);
 assert.deepEqual([first.maintenanceTypeCode,first.costNatureCode,first.source],['MAI-002','ESP','TASK']);
 const second=mroFinancialContext(wo,'t2',material);
 assert.deepEqual([second.maintenanceTypeCode,second.source],['MAI-001','WORK_ORDER']);
 assert.equal(mroFinancialContext(wo,'t2',{name:'Bearing but classification not provided'}).costNatureCode,'');
});
test('Maintenance returns reverse original accounts; legacy issue uses explicit fallback',()=>{
 const original=originalMroIssueAccounts({expenseGlCode:'50203020',inventoryGlCode:'10305020'},'50203030','10305080');
 assert.equal(original.expenseGlCode,'50203020');
 assert.equal(original.inventoryGlCode,'10305020');
 assert.equal(original.historicalExpenseAccount,true);
 const legacy=originalMroIssueAccounts({materialId:'m'},'50203030','10305080');
 assert.equal(legacy.expenseGlCode,'50203030');
 assert.equal(legacy.historicalExpenseAccount,false);
});
test('Actual finance issue and return handlers preserve source GL selection and strategy in trace',async()=>{
 const fs=await import('node:fs');
 const src=fs.readFileSync('backend/finOps.ts','utf8');
 assert.match(src,/mroFinancialContext\(wo\.data,taskId,m\.data\)/);
 assert.match(src,/roleAccount\(map, woId \? 'MAINT_CONSUMPTION' : 'CONSUMPTION'/);
 assert.match(src,/accountDeterminationRuleId/);
 assert.match(src,/originalMroIssueAccounts\(line,defaults\.expenseGlCode,defaults\.inventoryGlCode\)/);
 assert.match(src,/usedOriginalIssueAccount/);
});

test('Work Assessment persists task strategy from the controlled registry, without bypassing review',async()=>{
 const fs=await import('node:fs');
 const ui=fs.readFileSync('src/org/MntTaskAssessment.tsx','utf8');
 const assessment=fs.readFileSync('backend/maintenanceTaskAssessment.ts','utf8');
 const routes=fs.readFileSync('backend/maintenance.ts','utf8');
 assert.match(ui,/Maintenance strategy for this task/);
 assert.match(ui,/Inherit the Work Order maintenance type/);
 assert.match(ui,/options\.data\?\.maintenanceTypes/);
 assert.match(assessment,/maintenanceTypeCode\?:string/);
 assert.match(routes,/verifiedTaskMaintenanceTypes/);
 assert.match(routes,/not enabled in the maintenance reference registry/);
});
test('Finance rules share an approval workflow rather than writing directly into the GL',async()=>{
 const fs=await import('node:fs');
 const finance=fs.readFileSync('backend/finRoutes.ts','utf8');
 assert.match(finance,/maintenanceFinancialTypes/);
 assert.match(finance,/FIN\.mapping\.approve/);
 assert.match(finance,/type: 'mapping\.save'/);
 const ui=fs.readFileSync('src/org/FinAccountRuleManager.tsx','utf8');
 assert.match(ui,/Stores cost-nature code/);
 assert.match(ui,/Maintenance strategy \(optional\)/);
});
test('Tenant Materials Master inherits the Stores class from its controlled catalogue template',async()=>{
 const fs=await import('node:fs');
 const source=fs.readFileSync('backend/procurement.ts','utf8');
 assert.match(source,/const storesClassCode=str\(catalogueClassification\.storesClassCode\)/);
 assert.match(source,/const majorMaterialBranch=str\(catalogueClassification\.majorBranch\)/);
});
