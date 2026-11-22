import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSkuParameter,skuNamingValues,composeSkuNameWithSequence} from '../../backend/mfgSkuModel.ts';
import {SKU_NAME_FIELDS,validateSkuNamingSequence,composeSkuNameFromSequence,DEFAULT_SKU_NAMING_SEQUENCE} from '../../src/shared/mfgSkuNaming.ts';

const params=[
 {id:'PRC_000000001',kind:'processClasses',name:'Carbonated Beverage PET',processCode:'PET_CSD',enabled:true},
 {id:'NME_000000001',kind:'productNames',name:'Example Variant',productCode:'EXAMPLE',enabled:true},
];
const rule={separator:'_',steps:[
 {field:'manufacturingProcess',mode:'CODE',enabled:true},
 {field:'productName',mode:'CODE',enabled:true},
]};
test('Process classifications use organization-owned unique business code independent of generated PRC identifier',()=>{
 const p=normalizeSkuParameter('processClasses',{name:'Carbonated Beverage PET',processCode:'pet_csd'});
 assert.equal(p.processCode,'PET_CSD');
 assert.equal(p.name,'Carbonated Beverage PET');
 assert.throws(()=>normalizeSkuParameter('processClasses',{name:'No code',processCode:''}),/classification code/);
 assert.throws(()=>normalizeSkuParameter('processClasses',{name:'Too short',processCode:'X'}),/classification code/);
 assert.throws(()=>normalizeSkuParameter('processClasses',{name:'Not valid',processCode:'BAD CODE'}),/classification code/);
});
test('Classification business code can be selected and ordered in the saved SKU naming sequence',()=>{
 assert.ok(SKU_NAME_FIELDS.some(field=>field.key==='manufacturingProcess'&&field.modes.includes('CODE')));
 const checked=validateSkuNamingSequence(rule);
 assert.deepEqual(checked,rule);
 const tokens=skuNamingValues({productNameId:'NME_000000001'},params,undefined,'PRC_000000001');
 assert.equal(tokens.manufacturingProcess.code,'PET_CSD');
 assert.equal(tokens.manufacturingProcess.name,'Carbonated Beverage PET');
 assert.equal(composeSkuNameFromSequence(rule,tokens),'PET_CSD_EXAMPLE');
 assert.equal(composeSkuNameWithSequence({productNameId:'NME_000000001'},params,rule,undefined,'PRC_000000001'),'PET_CSD_EXAMPLE');
 assert.equal(composeSkuNameFromSequence({...rule,steps:[
  {field:'manufacturingProcess',mode:'NAME',enabled:true}]},tokens),'Carbonated Beverage PET');
});
test('Legacy naming sequence remains unchanged; historic process classifications do not leak PRC IDs into names',()=>{
 assert.equal(DEFAULT_SKU_NAMING_SEQUENCE.steps.some(x=>x.field==='manufacturingProcess'&&x.enabled),false);
 const old=[{id:'PRC_000000002',kind:'processClasses',name:'Earlier group',enabled:true}];
 const tokens=skuNamingValues({},old,undefined,'PRC_000000002');
 assert.equal(tokens.manufacturingProcess.code,'');
 assert.equal(composeSkuNameFromSequence({separator:'_',steps:[
  {field:'manufacturingProcess',mode:'CODE',enabled:true},
  {field:'literal',mode:'TEXT',enabled:true,text:'OTHER'},
 ]},tokens),'OTHER');
});
test('Backend rejects duplicate process business codes and routes SKU naming through selected classification',()=>{
 const config=readFileSync(new URL('../../backend/mfgSkuConfiguration.ts',import.meta.url),'utf8');
 const foundation=readFileSync(new URL('../../backend/plnMfgFoundation.ts',import.meta.url),'utf8');
 const editor=readFileSync(new URL('../../src/org/MfgSkuSetup.tsx',import.meta.url),'utf8');
 const main=readFileSync(new URL('../../src/org/ProductionFoundation.tsx',import.meta.url),'utf8');
 assert.ok(config.includes("kind==='processClasses'&&all.some"));
 assert.ok(config.includes('The manufacturing process classification code is already in use.'));
 assert.ok(foundation.includes('naming.sequence.steps.some(step=>step.enabled'));
 assert.ok(foundation.includes('composeSkuNameWithSequence(selected,configured,naming.sequence,result,str(raw.processClassId))'));
 assert.ok(editor.includes("title='Classification code'"));
 assert.ok(editor.includes('row.processCode'));
 assert.ok(main.includes('processClassId={str(draft.processClassId)}'));
});
