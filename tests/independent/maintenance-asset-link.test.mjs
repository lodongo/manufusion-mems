import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveMaintenanceEquipmentAsset } from '../../backend/maintenanceAssetLink.ts';

const assets=[
  {id:'AST-000001',status:'active',workCenterId:'FILLER'},
  {id:'AST-000004',status:'active',workCenterId:'BLOWMOLDER'},
  {id:'AST-000005',status:'active',workCenterId:'PASTEURIZER'}
];
test('linked asset is resolved from the equipment, not other nearby assets',()=>{
 assert.equal(resolveMaintenanceEquipmentAsset('FILLER','AST-000001',assets),'AST-000001');
 assert.equal(resolveMaintenanceEquipmentAsset('FILLER','',assets),'AST-000001');
 assert.equal(resolveMaintenanceEquipmentAsset('BLOWMOLDER','AST-000004',assets),'AST-000004');
});
test('missing, disagreeing and duplicate mappings fail instead of offering unrelated assets',()=>{
 assert.throws(()=>resolveMaintenanceEquipmentAsset('UNKNOWN','',assets),/no linked asset/);
 assert.throws(()=>resolveMaintenanceEquipmentAsset('FILLER','AST-000004',assets),/links disagree/);
 assert.throws(()=>resolveMaintenanceEquipmentAsset('FILLER','AST-999999',assets),/missing/);
 assert.throws(()=>resolveMaintenanceEquipmentAsset('FILLER','AST-000001',[...assets,{id:'AST-000006',status:'active',workCenterId:'FILLER'}]),/Multiple assets/);
 assert.throws(()=>resolveMaintenanceEquipmentAsset('FILLER','AST-000001',[{id:'AST-000001',status:'disposed',workCenterId:'FILLER'}]),/not active/);
});
test('Work Request wizard has four steps, only the place is required, and backend is authoritative',()=>{
 const ui=readFileSync(new URL('../../src/org/WorkRequests.tsx',import.meta.url),'utf8');
 const backend=readFileSync(new URL('../../backend/maintenance.ts',import.meta.url),'utf8');
 assert.match(ui,/STEPS = \['Where', 'Details', 'Photos', 'Review'\]/);
 assert.match(ui,/AssemblyPicker allowEquipment/,'A request can be placed on the equipment when the assembly is not known');
 assert.match(backend,/assemblyContext\(ctx, str\(b.assemblyId\) \|\| str\(b.equipmentId\), P.WR_create, true\)/);
 assert.doesNotMatch(ui,/Failure mode \(optional\)/,'The requester no longer chooses a failure mode');
 assert.match(ui,/MAX_IMPACTS = 5/);
 assert.match(ui,/useFullScreen\(!created\)/,'Raising a request runs full screen on phones');
 assert.doesNotMatch(ui,/\{step === 1 && place &&/);
 assert.match(ui,/setAssetTag\(p.defaultAssetTag\)/);
 assert.match(backend,/resolveMaintenanceEquipmentAsset/);
 assert.match(backend,/if\(assetTag&&assetTag!==mappedTag\)/);
});
