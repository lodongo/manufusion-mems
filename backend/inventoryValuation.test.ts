import test from 'node:test';
import assert from 'node:assert/strict';
import { unitPricePerStockUnit, convertStockCurrency } from './inventoryValuation';

test('supplier price is converted from metric tonnes to stock kilograms',()=>{
    assert.equal(unitPricePerStockUnit(50000,'UOM-01-003','UOM-01-002'),50);
    assert.equal(unitPricePerStockUnit(50000,'Metric tonne','Kilogram'),50);
    assert.equal(1600*unitPricePerStockUnit(50000,'UOM-01-003','UOM-01-002')!,80000);
});
test('same UOM uses entered cost even when the master is missing',()=>{
    assert.equal(unitPricePerStockUnit(50,'UOM-01-002','UOM-01-002',[]),50);
});
test('incompatible, ambiguous, missing, inactive, or invalid units cannot be valued',()=>{
    assert.equal(unitPricePerStockUnit(50000,'UOM-01-003','UOM-03-001'),null);
    assert.equal(unitPricePerStockUnit(100,'','UOM-01-002'),null);
    assert.equal(unitPricePerStockUnit(-1,'UOM-01-003','UOM-01-002'),null);
    assert.equal(unitPricePerStockUnit(100,'UOM-A','UOM-B',[
        {code:'UOM-A',baseUnit:'g',multiplier:1000,active:false},
        {code:'UOM-B',baseUnit:'g',multiplier:1},
    ]),null);
    assert.equal(unitPricePerStockUnit(100,'UOM-A','UOM-B',[
        {code:'UOM-A',baseUnit:'g',multiplier:0},
        {code:'UOM-B',baseUnit:'g',multiplier:1},
    ]),null);
    assert.equal(unitPricePerStockUnit(100,'UOM-A','UOM-B',[
        {code:'UOM-A',baseUnit:'L',multiplier:1},
        {code:'UOM-B',baseUnit:'g',multiplier:1},
    ]),null);
});
test('local and selected currency conversion uses configured USD-base quotations',()=>{
    const rates={KES:130,USD:1,EUR:0.9};
    assert.equal(convertStockCurrency(50000,'KES','KES',rates),50000);
    assert.equal(convertStockCurrency(50000,'KES','USD',rates),50000/130);
    assert.equal(convertStockCurrency(50,'USD','KES',rates),6500);
    assert.equal(convertStockCurrency(50,'USD','EUR',rates),45);
    assert.equal(convertStockCurrency(50,'USD','EUR',{}),null);
    assert.equal(convertStockCurrency(50,'','EUR',rates),null);
});
