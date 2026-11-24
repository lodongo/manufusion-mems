import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {materialSourcingPolicy} from '../../backend/procurement.ts';

const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const ui=read('src/org/MaterialsMaster.tsx');
const server=read('backend/procurement.ts');

test('material sourcing presents Bidded instead of General supplier',()=>{
    assert.ok(ui.includes("code: 'BIDDED', title: 'Bidded'"));
    assert.ok(!ui.includes("title: 'General supplier'"));
    assert.ok(ui.includes("supplyType:'BIDDED',partyEntryMode:'none'"));
    assert.ok(ui.includes("registration.supplyType==='GENERAL'?'BIDDED'"));
});

test('Bidded requires no nominated or recommended vendor or supplier part number',()=>{
    assert.ok(ui.includes("supply==='BIDDED'?<Alert tone='info'>"));
    assert.ok(ui.includes('No supplier is nominated or recommended for a bidded material.'));
    // Bidded and Proprietary supplier are "supplierless": no vendor, manual party or supplier part number is asked for.
    assert.ok(ui.includes("const supplierless=['BIDDED','PROPRIETARY_SUPPLIER'].includes(supply);"));
    assert.ok(ui.includes("const mode=supplierless?'none':registration.partyEntryMode??'registered';"));
    assert.ok(ui.includes("!supplierless&&!registration[partKey]?.trim()?'Enter the '+supply+' part number.'"));
    assert.ok(ui.includes("partyEntryMode: ['BIDDED','PROPRIETARY_SUPPLIER'].includes(t.code) ? 'none' : 'registered', vendorId: '', partyName: ''"));
    assert.ok(ui.includes("Supplier','Not nominated — competitive bidding"));
});

test('server normalizes older GENERAL records and strips nominated suppliers for BIDDED',()=>{
    const nominated={vendorId:'VEN_1',partyName:'Acme',partyEntryMode:'registered',generalPartNumber:'G-1',proprietaryPartNumber:'P-1'};
    for(const supplyType of ['BIDDED','GENERAL']){
        const out=materialSourcingPolicy({...nominated,supplyType});
        assert.equal(out.supplyType,'BIDDED','older GENERAL records become BIDDED');
        assert.equal(out.partyEntryMode,'none');
        for(const k of ['vendorId','partyName','generalPartNumber','proprietaryPartNumber'])assert.equal(out[k],'',k+' is stripped');
    }
    const proprietary=materialSourcingPolicy({...nominated,supplyType:'PROPRIETARY_SUPPLIER',oemPartNumber:'O-1',assetId:'A1'});
    assert.equal(proprietary.vendorId,'');assert.equal(proprietary.partyName,'');assert.equal(proprietary.oemPartNumber,'');assert.equal(proprietary.assetId,'');
    assert.equal(proprietary.proprietaryPartNumber,'P-1','only the optional proprietary part number is kept');
    assert.ok(server.includes("await synchronizeMaterialCluster(ctx,materialSourcingPolicy({"));
    assert.ok(server.includes("const d=await synchronizeMaterialCluster(ctx,materialSourcingPolicy(doc.data));await validatePublishedMaterialSelection(d);"));
    assert.ok(server.includes("if(!['OEM','OCM','BIDDED','PROPRIETARY_SUPPLIER'].includes(str(d.supplyType)))throw new HttpError(400,'Select a valid supply relationship.');"));
    assert.ok(server.includes("const peerSource=str(p.supplyType)==='GENERAL'?'BIDDED':str(p.supplyType)"));
});

test('OEM and OCM still have their vendor identity and part number requirements',()=>{
    assert.ok(ui.includes("['OEM', 'OCM'].includes(supply)"));
    const oem=materialSourcingPolicy({supplyType:'OEM',vendorId:'VEN_1',oemPartNumber:'O-1',proprietaryPartNumber:'P-1'});
    assert.equal(oem.vendorId,'VEN_1');assert.equal(oem.oemPartNumber,'O-1');assert.equal(oem.proprietaryPartNumber,'');
    assert.ok(server.includes("if(['OEM','OCM'].includes(str(d.supplyType))&&!str(d[partField]))throw new HttpError(400,'Enter the applicable part number.');"));
    assert.ok(server.includes("else if(['OEM','OCM'].includes(str(d.supplyType))){if(!str(d.vendorId)||!(await getDoc('organizations/'+ctx.orgId+'/vendors/'+str(d.vendorId))))throw new HttpError(400,'Select an existing registered vendor or enter the name manually.');}"));
    assert.ok(server.includes("if(str(d.supplyType)==='OEM'){if(!str(d.oemPartNumber)||!str(d.costCenterId)||!str(d.assetId))"));
});
