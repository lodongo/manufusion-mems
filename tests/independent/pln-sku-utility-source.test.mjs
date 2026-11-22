import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeMaster} from '../../backend/plnMfgFoundation.ts';
import {costCenterSubcategories,selectedCostCenterSubcategories} from '../../src/shared/costCenterTaxonomy.ts';
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const sku={id:'SKU_WATER_01',name:'Treated Water',category:'RAW',sourceMode:'UTILITY',uom:'L',packQty:1};
test('raw metered source stores a Utilities cost centre and activated source classification, without equipment link',()=>{
    const row=normalizeMaster('items',{...sku,utilitySourceCostCenterId:'CC_UTL_01',
        utilitySourceSubcategoryCode:costCenterSubcategories('UTL')[0].code});
    assert.equal(row.utilitySourceCostCenterId,'CC_UTL_01');
    assert.equal(row.utilitySourceSubcategoryCode,costCenterSubcategories('UTL')[0].code);
    assert.equal(row.utilityWorkCenterId,'');
    assert.equal(row.utilityCode,'');
    assert.equal(row.stockPolicy,'METERED');
    assert.throws(()=>normalizeMaster('items',{...sku,utilitySourceCostCenterId:'CC_UTL_01'}),/activated utility source subcategory/i);
    assert.throws(()=>normalizeMaster('items',sku),/Utilities cost centre/i);
});
test('activated subcategories include each selected UTL activity, not arbitrary manufacturing categories',()=>{
    const choices=costCenterSubcategories('UTL');
    const selected=[choices[0].code,choices[3].code,choices[10].code];
    assert.deepEqual(selectedCostCenterSubcategories({costSubcategories:selected}),selected);
    assert.ok(choices.some(x=>/water/i.test(x.label)));
});
test('UI and API only offer authorized Utilities cost centres and activated source subcategories',()=>{
    const ui=read('src/org/ProductionFoundation.tsx');
    const be=read('backend/plnMfgFoundation.ts');
    assert.ok(ui.includes("title='Utilities cost centre'"));
    assert.ok(ui.includes("title='Source (activated cost-centre subcategory)'"));
    assert.ok(ui.includes('disabled={!selected||!selected.sources.length}'));
    assert.ok(ui.includes("utilitySourceSubcategoryCode:''"));
    assert.ok(be.includes("org.mfg.foundation.utility_source_options"));
    assert.ok(be.includes("str(attrs.costType)!=='UTL'"));
    assert.ok(be.includes("selectedCostCenterSubcategories(attrs)"));
    assert.ok(be.includes("await allowedAt(ctx,['MFG.view',...PERMS.utilitiesView],utilityCentreId,'read')"));
    assert.ok(be.includes("Choose a source from the selected Utilities cost centre activated subcategories."));
});
