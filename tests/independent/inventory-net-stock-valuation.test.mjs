import test from 'node:test';
import assert from 'node:assert/strict';
import { unitPricePerStockUnit, convertStockCurrency } from '../../backend/inventoryValuation.ts';

// Executed by the independent CI suite (node --import tsx --test tests/independent/*.test.mjs).
test('inventory: supplier tonnes normalize to stock kilograms before multiplication',()=>{
    const cost=unitPricePerStockUnit(50000,'UOM-01-003','UOM-01-002');
    assert.equal(cost,50);
    assert.equal(1600*cost,80000);
    assert.equal(unitPricePerStockUnit(50000,'Metric tonne','Kilogram'),50);
});
test('inventory: no value is invented for missing, inactive, or incompatible unit definitions',()=>{
    assert.equal(unitPricePerStockUnit(100,'UOM-01-003','UOM-03-001'),null);
    assert.equal(unitPricePerStockUnit(100,'','UOM-01-002'),null);
    assert.equal(unitPricePerStockUnit(100,'UOM-X','UOM-Y',[
        {code:'UOM-X',baseUnit:'g',multiplier:1000,active:false},
        {code:'UOM-Y',baseUnit:'g',multiplier:1},
    ]),null);
    assert.equal(unitPricePerStockUnit(100,'UOM-X','UOM-Y',[
        {code:'UOM-X',baseUnit:'L',multiplier:1},
        {code:'UOM-Y',baseUnit:'g',multiplier:1},
    ]),null);
});
test('inventory: configured currency rates convert local values without altering source prices',()=>{
    const fx={USD:1,KES:130,EUR:0.9};
    assert.equal(convertStockCurrency(50000,'KES','KES',fx),50000);
    assert.equal(convertStockCurrency(50,'USD','KES',fx),6500);
    assert.equal(convertStockCurrency(50000,'KES','USD',fx),50000/130);
    assert.equal(convertStockCurrency(50,'USD','EUR',{}),null);
});

test('admin UoM records without multipliers use matching canonical PRC conversion only',()=>{
    const old=[
        {code:'UOM-01-003',label:'Metric tonne',active:true},
        {code:'UOM-01-002',label:'Kilogram',active:true},
    ];
    assert.equal(unitPricePerStockUnit(50000,'UOM-01-003','UOM-01-002',old),50);
    assert.equal(unitPricePerStockUnit(50000,'UOM-01-003','UOM-01-002',[
        {...old[0],active:false},old[1],
    ]),null);
});
