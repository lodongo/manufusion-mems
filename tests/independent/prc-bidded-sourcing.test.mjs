import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

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
    assert.ok(ui.includes("supply!=='BIDDED'&&mode==='registered'&&!registration.vendorId"));
    assert.ok(ui.includes("supply!=='BIDDED'&&mode==='manual'"));
    assert.ok(ui.includes("supply!=='BIDDED'&&!registration[partKey]?.trim()"));
    assert.ok(ui.includes("t.code!=='BIDDED'&&detail?.guidance?.supply?.usual.includes(t.code)"));
    assert.ok(ui.includes("vendorId:'',partyName:'',generalPartNumber:''"));
    assert.ok(ui.includes("Supplier','Not nominated — competitive bidding"));
});

test('server normalizes older GENERAL records and strips nominated suppliers for BIDDED',()=>{
    assert.ok(server.includes("if(relationship!=='BIDDED'&&relationship!=='GENERAL')return data;"));
    assert.ok(server.includes("supplyType:'BIDDED',partyEntryMode:'none',vendorId:'',partyName:'',generalPartNumber:''"));
    assert.ok(server.includes("await synchronizeMaterialCluster(ctx,materialSourcingPolicy({"));
    assert.ok(server.includes("const d=await synchronizeMaterialCluster(ctx,materialSourcingPolicy(doc.data));await validatePublishedMaterialSelection(d);"));
    assert.ok(server.includes("['OEM','OCM','BIDDED'].includes(str(d.supplyType))"));
    assert.ok(server.includes("if(partField&&!str(d[partField]))"));
    assert.ok(server.includes("str(d.supplyType)!=='BIDDED'&&str(d.partyEntryMode)==='manual'"));
    assert.ok(server.includes("const peerSource=str(p.supplyType)==='GENERAL'?'BIDDED':str(p.supplyType)"));
});

test('OEM and OCM still have their vendor identity and part number requirements',()=>{
    assert.ok(ui.includes("['OEM', 'OCM'].includes(supply)"));
    assert.ok(server.includes("str(d.supplyType)==='OEM'?'oemPartNumber':str(d.supplyType)==='OCM'?'ocmPartNumber':''"));
    assert.ok(server.includes("else if(['OEM','OCM'].includes(str(d.supplyType)))"));
});
