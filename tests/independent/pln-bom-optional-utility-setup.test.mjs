import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bomUtilityHasVerifiedConflict} from '../../backend/plnMfgFoundation.ts';

const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('incomplete asset, rating, equipment demand and unknown utility parameters are advisory for BOMs',()=>{
    assert.equal(bomUtilityHasVerifiedConflict({status:'incomplete',gaps:[]}),false);
    assert.equal(bomUtilityHasVerifiedConflict({status:'incompatible',gaps:[{
        expected:'6 bar',actual:undefined,
    }]}),false);
    assert.equal(bomUtilityHasVerifiedConflict({status:'incomplete',gaps:[{
        expected:undefined,actual:undefined,
    }]}),false);
    assert.equal(bomUtilityHasVerifiedConflict({status:'warning',gaps:[]}),false);
});

test('verified overload or known incompatibility remains blocked',()=>{
    assert.equal(bomUtilityHasVerifiedConflict({status:'overload',gaps:[]}),true);
    assert.equal(bomUtilityHasVerifiedConflict({status:'incompatible',gaps:[{
        expected:'6 bar',actual:'2 bar',
    }]}),true);
    assert.equal(bomUtilityHasVerifiedConflict({status:'incompatible',gaps:[{
        expected:10,actual:0,
    }]}),true);
});

test('BOM save/submit use advisory instead of mandatory capacity setup',()=>{
    const b=read('backend/plnMfgFoundation.ts');
    const ui=read('src/org/ProductionFoundation.tsx');
    assert.ok(b.includes('if(bomUtilityHasVerifiedConflict(cap.review))'));
    assert.ok(b.includes("if(!cap)throw new HttpError(409,'Utility missing at cost centre."));
    assert.ok(!b.includes("Complete the asset, rated capacity and equipment demand setup on this cost-centre utility before using it in a BOM."));
    assert.ok(ui.includes('<strong>Highly recommended · Optional:</strong>'));
    assert.ok(ui.includes('You can save and submit this BOM without completing those details.'));
    assert.ok(ui.includes("capacity configuration recommended"));
});
