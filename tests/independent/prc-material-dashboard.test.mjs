import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeMaterialWarehouseStock} from '../../backend/materialMasterDashboard.ts';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('material availability is unknown without a reconciled stock ledger',()=>{
    const noLedger=summarizeMaterialWarehouseStock([],true,true,true);
    assert.equal(noLedger.ledgerState,'Not tracked');
    assert.equal(noLedger.availableStock,null);
    const pending=summarizeMaterialWarehouseStock([],false,true,true);
    assert.equal(pending.ledgerState,'Unavailable');
    assert.equal(pending.physicalStock,null);
    const scope=summarizeMaterialWarehouseStock([],true,false,true);
    assert.equal(scope.ledgerState,'Restricted');
    assert.equal(scope.reservedStock,null);
});
test('available quantity subtracts reserved, quarantine and other unusable stock',()=>{
    const rows=[
        {data:{status:'posted',reconciled:true,balancesDelta:{
            physicalStock:100,reservedStock:20,quarantinedStock:5,damagedStock:3,expiredStock:2,other:1,onOrder:40,inTransit:12,
        }}},
        {data:{status:'posted',reconciled:true,balancesDelta:{physicalStock:50,reservedStock:10,quarantinedStock:2}}},
    ];
    const result=summarizeMaterialWarehouseStock(rows,true,true,true);
    assert.equal(result.ledgerState,'Tracked');
    assert.equal(result.physicalStock,150);
    assert.equal(result.reservedStock,30);
    assert.equal(result.availableStock,107);
    assert.equal(result.onOrder,40);
    assert.equal(result.inTransit,12);
});
test('unreconciled or incomplete journals never claim availability',()=>{
    const partial=[{data:{status:'pending',reconciled:false,balancesDelta:{physicalStock:123}}}];
    assert.equal(summarizeMaterialWarehouseStock(partial,true,true,true).ledgerState,'Unreconciled');
    assert.equal(summarizeMaterialWarehouseStock(partial,true,true,true).availableStock,null);
    assert.equal(summarizeMaterialWarehouseStock(partial,true,true,false).ledgerState,'Unreconciled');
});
test('master list opens the six-tab dashboard with Approvals first and no list action column',()=>{
    const master=read('src/org/MaterialsMaster.tsx');
    const dash=read('src/org/MaterialMasterDashboard.tsx');
    const backend=read('backend/procurement.ts');
    const readModel=read('backend/materialMasterDashboard.ts');
    assert.ok(master.includes('onRowClick={setReviewMaterial}'));
    assert.ok(master.includes('<MaterialMasterDashboard'));
    assert.equal(master.includes("key:'actions',label:'Actions'"),false);
    // Rebuilt material record: Overview first (linked numbers, lifecycle), then Approvals, Warehouses (stock merged), Attributes, History.
    for(const name of ['overview','approvals','warehouses','attributes','history']){
        assert.ok(dash.includes("key: '"+name+"'"),'missing tab: '+name);
    }
    assert.ok(dash.includes("useState<Tab>('overview')"));
    assert.ok(dash.includes('testOverride={m.testOverride}'));
    assert.ok(dash.includes('More actions'));
    assert.ok(dash.includes('<MaterialIdentity m={m} />'));
    assert.ok(dash.includes('Approve extension'));
    assert.ok(backend.includes("'POST /api/org/procurement/materials/dashboard'"));
    assert.ok(backend.includes('materialApproverCanAct(ctx,extension,snapshot)'));
    assert.ok(readModel.includes("relation:'Created here'"));
    assert.ok(readModel.includes("relation:'Extended'"));
    assert.ok(readModel.includes("listDocs(base+'/material_extensions')"));
    assert.ok(readModel.includes("collectionId:'audit_events'"));
    assert.ok(readModel.includes("collectionId:'material_journal'"));
    assert.ok(readModel.includes('allowedNodeIds(ctx.orgId,user,true)'));
    assert.ok(readModel.includes('historyNote:'));
});
