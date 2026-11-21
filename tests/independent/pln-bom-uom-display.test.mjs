import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bomUomName} from '../../src/org/plnBomUomDisplay.ts';
import {PROCUREMENT_UNITS} from '../../backend/procurementUnits.ts';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('BOM output and material UoMs use actual master-data names and symbols',()=>{
    assert.equal(bomUomName('UOM-04-001',PROCUREMENT_UNITS),'Litre (L)');
    assert.equal(bomUomName('UOM-01-003',PROCUREMENT_UNITS),'Metric tonne (t)');
    assert.equal(bomUomName('UOM-01-002',PROCUREMENT_UNITS),'Kilogram (kg)');
});
test('older saved UoM symbols resolve by the same master without rewriting stored codes',()=>{
    assert.equal(bomUomName('L',PROCUREMENT_UNITS),'Litre (L)');
    assert.equal(bomUomName('KG',PROCUREMENT_UNITS),'Kilogram (kg)');
    assert.equal(bomUomName('',PROCUREMENT_UNITS),'Select a material');
    assert.equal(bomUomName('UOM-99-999',PROCUREMENT_UNITS),'Unit not found in UoM master data');
});
test('BOM create and edit show names across output, input, quantity descriptions and alternatives',()=>{
    const ui=read('src/org/ProductionFoundation.tsx');
    assert.ok(ui.includes("import { bomUomName } from './plnBomUomDisplay'"));
    assert.ok(ui.includes('Base unit: {bomUomName(str(output.uom),skuSetup.units)}'));
    assert.ok(ui.includes('<p className=\'mt-1 text-sm font-semibold\'>{bomUomName(outputUom,skuSetup.units)}</p>'));
    assert.ok(ui.includes('Quantities for {quantity} {bomUomName(outputUom,skuSetup.units)}'));
    assert.ok(ui.includes('>{bomUomName(c.uom,skuSetup.units)}</p>'));
    assert.ok(ui.includes('[current,bomUomName(current,skuSetup.units)]'));
    assert.ok(ui.includes('[u.code,bomUomName(u.code,skuSetup.units)]'));
    assert.ok(ui.includes("onChange={v=>updateComponent(i,{uom:v})}"));
    assert.ok(ui.includes("onChange={v=>update('outputUom',v)}"));
    assert.equal(ui.includes("{c.uom||'Select a material'}"),false);
    assert.equal(ui.includes(">{outputUom}</p>"),false);
});
