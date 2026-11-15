import assert from 'node:assert/strict';
import { seed, snapshot } from './maintenance-fixture.ts';
import { TEST_MODE_DOC, bypass, clearTestModeCache, overrideActiveFor, readTestMode, testModeEnvironmentAllowed } from '../../backend/testModeCore.ts';
import { requireMaintenanceRole } from '../../backend/maintenanceAccess.ts';
import { approverCheck } from '../../backend/purchaseOrders.ts';

const org = 'test_mode_fixture';
const future = new Date(Date.now() + 3600_000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();
const state = (over = {}) => ({ enabled: true, orgIds: [org], expiresAt: future, reason: 'Development end-to-end testing', enabledBy: 'S', enabledByEmail: 's@x', enabledAt: '', version: 1, ...over });

// ----- Environment gate: fail closed -----
delete process.env.MEMS_ENVIRONMENT;
delete process.env.MEMS_ALLOW_LIVE_DATA;
assert.equal(testModeEnvironmentAllowed(), false, 'no environment flag: test mode impossible');
assert.equal(overrideActiveFor(state(), org), false, 'a stored override has no effect outside development');
process.env.MEMS_ENVIRONMENT = 'production';
assert.equal(overrideActiveFor(state(), org), false);
process.env.MEMS_ENVIRONMENT = 'development';
assert.equal(overrideActiveFor(state(), org), true);
process.env.MEMS_ALLOW_LIVE_DATA = 'true';
assert.equal(overrideActiveFor(state(), org), false, 'live data flag disables test mode');
delete process.env.MEMS_ALLOW_LIVE_DATA;
assert.equal(overrideActiveFor(state({ expiresAt: past }), org), false, 'expired override is off');
assert.equal(overrideActiveFor(state({ enabled: false }), org), false);
assert.equal(overrideActiveFor(state({ orgIds: ['other_org'] }), org), false, 'only named tenants');
assert.equal(overrideActiveFor(state({ expiresAt: 'not-a-date' }), org), false);

seed(TEST_MODE_DOC, state());
clearTestModeCache();
assert.equal((await readTestMode()).enabled, true);

// ----- bypass(): only with ctx.testMode, records each rule once -----
const plain = { bypassed: [] };
assert.equal(bypass(plain, 'x.rule'), false);
assert.deepEqual(plain.bypassed, []);
const tm = { testMode: true, bypassed: [] };
assert.equal(bypass(tm, 'x.rule'), true);
assert.equal(bypass(tm, 'x.rule'), true);
assert.deepEqual(tm.bypassed, ['x.rule']);

// ----- Maintenance job-role gate: holding is relaxed, configuration is not -----
seed(`organizations/${org}/maintenance_workflow_settings/default`, { version: 3, approverRoles: { 'MNT.WO.TECHNICAL_CLOSE': 'TM' } });
seed('users/ADMIN_01', { orgId: org, status: 'active', assignments: [] });
const admin = (testMode) => ({ uid: 'ADMIN_01', orgId: org, role: 'org_super_admin', me: snapshot('users/ADMIN_01'), permissions: ['*'], directPermissions: ['*'], grants: [], testMode, bypassed: [] });
await assert.rejects(() => requireMaintenanceRole(admin(false), 'MNT.WO.TECHNICAL_CLOSE', ['SITE']), /job role TM is required at this location\. Organization super admins are not exempt/);
const relaxed = admin(true);
const gate = await requireMaintenanceRole(relaxed, 'MNT.WO.TECHNICAL_CLOSE', ['SITE']);
assert.equal(gate.role, 'TM');
assert.deepEqual(relaxed.bypassed, ['mnt.gate.MNT.WO.TECHNICAL_CLOSE']);
await assert.rejects(() => requireMaintenanceRole(admin(true), 'MNT.HANDOVER', ['SITE']), /Configure MNT.HANDOVER/, 'unconfigured gates still block');

// ----- PO chart of authority: identity checks relaxed, status checks kept -----
const po = { status: 'pending_approval', createdBy: 'ADMIN_01', approval: { steps: [{ level: 'L1', title: 'Manager', positionCode: 'MGR', positionTitle: 'Manager', status: 'pending', by: '' }] } };
assert.equal(approverCheck(admin(false), po).ok, false, 'preparer cannot approve without test mode');
const poCtx = admin(true);
const check = approverCheck(poCtx, po);
assert.equal(check.ok, true);
assert.equal(check.testMode, true);
assert.equal(approverCheck(admin(true), { ...po, status: 'open' }).ok, false, 'status is never relaxed');

console.log('test mode scenario passed: fail-closed environment gate, expiry, tenant scope, audited bypass, job-role gates and chart-of-authority identity checks');


// Permanent maintenance deletions: production, tenant, role, typed ID, linked records and durable audit.
const {purgeTestMaintenance,listTestMaintenanceDeletion}=await import('../../backend/maintenanceTestDeletion.ts');
const base='organizations/'+org,order='WO00000801',request='WR00000801',assessment='ASSM_00000801';
const actor={uid:'ADMIN_01',email:'admin@example.test'};
const {setCleanupAuthorization}=await import('../../backend/maintenanceCleanupAuthorization.ts');
let cleanupToken='';const authTime=Math.floor(Date.now()/1000);
const ctx=(kind,code,extra={})=>({...admin(true),actor,claims:{authTime},...extra,body:{kind,code,confirm:code,reason:'Remove end-to-end test fixture',cleanupToken,...extra.body}});
await assert.rejects(()=>setCleanupAuthorization(ctx('order','',{body:{enabled:true,confirm:'wrong'}})),/ENABLE CLEANUP/);
await assert.rejects(()=>purgeTestMaintenance(ctx('order','WO00000001')),/Enable Database Cleanup separately/);
cleanupToken=(await setCleanupAuthorization(ctx('order','',{body:{enabled:true,confirm:'ENABLE CLEANUP'}}))).cleanupToken;
assert.match(cleanupToken,/^[a-f0-9]{64}$/);
await assert.rejects(()=>purgeTestMaintenance(ctx('order','WO00000001',{claims:{authTime:authTime+1}})),/Enable Database Cleanup separately/);
seed(base+'/work_orders/'+order,{code:order,title:'Test WO',status:'closed',wrCode:request});
seed(base+'/work_requests/'+request,{code:request,title:'Test WR',status:'closed',woCode:order,assessmentCode:assessment});
seed(base+'/work_assessments/'+assessment,{code:assessment,workRequestCode:request,status:'converted',woCode:order});
await assert.rejects(()=>purgeTestMaintenance(ctx('order',order,{testMode:false})),/active development Test Mode/i);
await assert.rejects(()=>purgeTestMaintenance(ctx('order',order,{role:'org_user'})),/Super Admin/i);
process.env.MEMS_ENVIRONMENT='production';
await assert.rejects(()=>purgeTestMaintenance(ctx('order',order)),/active development Test Mode/i);
process.env.MEMS_ENVIRONMENT='development';
await assert.rejects(()=>purgeTestMaintenance(ctx('order',order,{orgId:'wrong_org'})),/Enable Database Cleanup separately/i);
await assert.rejects(()=>purgeTestMaintenance(ctx('order',order,{body:{kind:'order',code:order,confirm:'wrong',reason:'Remove test record'}})),/exact record number/i);
await assert.rejects(()=>purgeTestMaintenance(ctx('request',request)),/linked records/i);
const child=order+'_1';
seed(base+'/work_orders/'+child,{code:child,parentWoCode:order,rootWoCode:order,status:'planning'});
await assert.rejects(()=>purgeTestMaintenance(ctx('order',order)),/linked records/i);
await purgeTestMaintenance(ctx('order',child));
assert.equal(snapshot(base+'/work_orders/'+child),null);
seed(base+'/goods_issues/GI00000001',{workOrderId:order});
await assert.rejects(()=>purgeTestMaintenance(ctx('order',order)),/goods_issues/i);
assert.ok(snapshot(base+'/work_orders/'+order));
assert.equal(snapshot(base+'/maintenance_deletion_audit/order_'+order),null);
const {deleteDoc}=await import('./maintenance-fixture.ts');await deleteDoc(base+'/goods_issues/GI00000001');
await purgeTestMaintenance(ctx('order',order));
assert.equal(snapshot(base+'/work_orders/'+order),null);
assert.equal(snapshot(base+'/work_requests/'+request).data.woCode,'');
assert.equal(snapshot(base+'/work_assessments/'+assessment).data.woCode,'');
const audit=snapshot(base+'/maintenance_deletion_audit/order_'+order).data;
assert.equal(audit.deletedBy,'ADMIN_01');assert.equal(audit.reason,'Remove end-to-end test fixture');assert.equal(audit.status,'closed');assert.equal(audit.testMode,true);
await purgeTestMaintenance(ctx('assessment',assessment));
assert.equal(snapshot(base+'/work_assessments/'+assessment),null);
assert.equal(snapshot(base+'/work_requests/'+request).data.assessmentCode,'');
await purgeTestMaintenance(ctx('request',request));
assert.equal(snapshot(base+'/work_requests/'+request),null);
assert.equal((await listTestMaintenanceDeletion(ctx('request',request))).trail.length,4);
await assert.rejects(()=>purgeTestMaintenance(ctx('request',request)),/does not exist/i);
console.log('permanent maintenance deletion scenario passed');


// Select multiple test cases, expand dependencies and remove ordinary tenant/platform audit copies atomically.
const {previewBulkTestMaintenance,purgeBulkTestMaintenance}=await import('../../backend/maintenanceTestDeletion.ts');
const w1='WO00000820',w2='WO00000821',w3='WO00000822',q1='WR00000820',a1='ASSM_00000820';
seed(base+'/work_orders/'+w1,{code:w1,status:'closed',wrCode:q1});
seed(base+'/work_orders/'+w1+'_1',{code:w1+'_1',rootWoCode:w1,parentWoCode:w1,wrCode:q1,status:'closed'});
seed(base+'/work_orders/'+w2,{code:w2,status:'planning'});
seed(base+'/work_orders/'+w3,{code:w3,status:'planning'});
seed(base+'/work_requests/'+q1,{code:q1,woCode:w1,assessmentCode:a1,status:'closed'});
seed(base+'/work_assessments/'+a1,{code:a1,woCode:w1,workRequestCode:q1,status:'converted'});
seed(base+'/asset_task_proposals/P1',{woCode:w1,status:'pending_validation'});
seed(base+'/asset_task_proposals/P2',{woCode:w1,status:'approved'});
seed(base+'/asset_task_templates/template',{validatedFrom:'P2',status:'approved'});
seed(base+'/inventory_reservations/R1',{workOrderId:w1,qty:2,status:'active'});
seed(base+'/material_journal/MR_R1_1',{workOrderId:w1,type:'MAINTENANCE_RESERVATION',balancesDelta:{reservedStock:2}});
seed(base+'/safety_incidents/INC1',{woCode:w1,status:'open'});
seed(base+'/maintenance_windows/WIN1',{workOrderIds:[w1,w2],tasks:[{woCode:w1},{woCode:w2}]});
seed(base+'/audit_events/A1',{category:'maintenance',action:'mnt.wo.created',orgId:org,targetLabel:w1});
seed('audit_events/A2',{category:'maintenance',action:'mnt.wo.created',orgId:org,targetLabel:w1});
seed('audit_events/A3',{category:'maintenance',action:'mnt.wo.created',orgId:'different_org',targetLabel:w1});
seed(base+'/audit_events/A4',{category:'maintenance',action:'mnt.test.permanent_delete',orgId:org,targetLabel:w1});
seed(base+'/audit_events/A5',{category:'auth',action:'login',orgId:org,targetLabel:w1});
const bulkCtx=(records,extra={})=>({...admin(true),actor,claims:{authTime},body:{records,reason:'Clean up end to end test cases',confirm:'DELETE TEST DATA',cleanupToken,...extra}});
const roots=[{kind:'order',code:w1},{kind:'order',code:w2}];
const shared=await previewBulkTestMaintenance(bulkCtx([roots[0]]));assert.ok(shared.blockers.some(x=>x.includes('Shared maintenance record')));
seed(base+'/goods_issues/GI_TEST',{workOrderId:w1});
let blocked=await previewBulkTestMaintenance(bulkCtx(roots));assert.ok(blocked.blockers.some(x=>x.includes('goods_issues')));
await assert.rejects(()=>purgeBulkTestMaintenance(bulkCtx(roots,{fingerprint:blocked.fingerprint})),/Cleanup blocked/);
await deleteDoc(base+'/goods_issues/GI_TEST');
let preview=await previewBulkTestMaintenance(bulkCtx(roots));
assert.equal(preview.records.length,5);assert.deepEqual(preview.blockers,[]);assert.ok(preview.retained.includes('asset_task_proposals/P2'));
assert.ok(preview.counts.audit_events===1&&preview.counts['@platform/audit_events']===1);
seed(base+'/asset_task_proposals/P3',{woCode:w1,status:'pending_validation'});
await assert.rejects(()=>purgeBulkTestMaintenance(bulkCtx(roots,{fingerprint:preview.fingerprint})),/changed since preview/);
preview=await previewBulkTestMaintenance(bulkCtx(roots));
const result=await purgeBulkTestMaintenance(bulkCtx(roots,{fingerprint:preview.fingerprint}));
for(const path of ['work_orders/'+w1,'work_orders/'+w1+'_1','work_orders/'+w2,'work_requests/'+q1,'work_assessments/'+a1,'asset_task_proposals/P1','asset_task_proposals/P3','inventory_reservations/R1','material_journal/MR_R1_1','safety_incidents/INC1','maintenance_windows/WIN1','audit_events/A1'])assert.equal(snapshot(base+'/'+path),null,path);
assert.equal(snapshot('audit_events/A2'),null);
for(const path of [base+'/work_orders/'+w3,base+'/asset_task_proposals/P2',base+'/asset_task_templates/template','audit_events/A3',base+'/audit_events/A4',base+'/audit_events/A5'])assert.ok(snapshot(path),path);
assert.equal(snapshot(base+'/maintenance_deletion_audit/order_'+w1).data.batchId,result.batchId);
assert.ok(snapshot(base+'/maintenance_cleanup_batches/'+result.batchId).data.deleted.includes('asset_task_proposals/P1'));
console.log('bulk test cleanup scenario passed');
