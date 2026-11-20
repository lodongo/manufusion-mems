import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {configurationProgress,SETUP_REQUIREMENTS,SETUP_ORDER} from '../../src/org/plnSetupDependencies.ts';
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const empty=()=>({
 materialPolicyRevision:0,parameters:[],
 items:[],boms:[],resources:[],capacityMappings:[],capacityLoaded:false,
 routings:[],planningConfigurationRevision:0,
});
const configuredParams=[
 {kind:'productNames',enabled:true},{kind:'productionForms',enabled:true},
 {kind:'containers',enabled:true},{kind:'containerSizes',enabled:true},
];
const fg={id:'SKU-FG-01',category:'FINISHED',status:'draft'};
const bom={id:'BOM-01',status:'active'};
const resource={id:'RSC-01',status:'draft'};
const mapping={costCenterId:'CC-MFG-01',skuCapacities:[{skuId:'SKU-FG-01',ratingQuantity:24000}]};
const route={id:'RTG-01',status:'active'};
test('PLN configuration dependency graph models independent prerequisites and keeps documentation open',()=>{
 assert.deepEqual(SETUP_REQUIREMENTS.routings,['boms','resources','costCenterSku']);
 assert.deepEqual(SETUP_REQUIREMENTS.resources,['materialPolicy']);
 assert.deepEqual(SETUP_REQUIREMENTS.costCenterSku,['items']);
 assert.deepEqual(SETUP_REQUIREMENTS.config,['routings']);
 assert.deepEqual(SETUP_REQUIREMENTS.demand,['config']);
 assert.equal(SETUP_ORDER.at(-1),'documentation');
 assert.equal(SETUP_ORDER[1],'formDefaults');
 assert.deepEqual(SETUP_REQUIREMENTS.formDefaults,[]);
 const state=configurationProgress(empty());
 assert.equal(state.materialPolicy.accessible,true);
 assert.equal(state.documentation.accessible,true);
 assert.equal(state.skuSetup.accessible,false);
 assert.deepEqual(state.skuSetup.missing,['materialPolicy']);
 assert.equal(state.routings.accessible,false);
});
test('visiting a tab or seeing default policy does not count as saved configuration',()=>{
 const state=configurationProgress({...empty(),parameters:configuredParams,items:[fg],
  boms:[bom],resources:[resource],capacityMappings:[mapping],capacityLoaded:true,
  routings:[route],planningConfigurationRevision:1});
 assert.equal(state.materialPolicy.complete,false);
 assert.equal(state.skuSetup.complete,true);
 assert.equal(state.skuSetup.accessible,false);
 assert.equal(state.items.accessible,false);
 assert.equal(state.routings.accessible,false); // transitive blocking
 assert.equal(state.config.accessible,false);
 assert.equal(state.documentation.accessible,true);
});
test('resources may be configured independently of BOMs, while unfinished BOMs block routing',()=>{
 const baseline={...empty(),materialPolicyRevision:1,parameters:configuredParams,
  items:[fg],resources:[resource],capacityMappings:[mapping],capacityLoaded:true};
 const state=configurationProgress(baseline);
 assert.equal(state.resources.accessible,true);
 assert.equal(state.resources.complete,true);
 assert.equal(state.costCenterSku.accessible,true);
 assert.equal(state.costCenterSku.complete,true);
 assert.equal(state.boms.accessible,true);
 assert.equal(state.boms.complete,false);
 assert.deepEqual(state.routings.missing,['boms']);
 const draft=configurationProgress({...baseline,boms:[{...bom,status:'draft'}]});
 assert.equal(draft.boms.complete,false);
 assert.equal(draft.routings.accessible,false);
 const approved=configurationProgress({...baseline,boms:[bom]});
 assert.equal(approved.routings.accessible,true);
 assert.equal(approved.config.accessible,false);
});
test('cost-centre readiness uses authoritative costCenterId mapping and positive commissioned speeds',()=>{
 const base={...empty(),materialPolicyRevision:1,parameters:configuredParams,
  items:[fg],boms:[bom],resources:[resource],capacityLoaded:true};
 assert.equal(configurationProgress({...base,capacityMappings:[mapping]}).costCenterSku.complete,true);
 assert.equal(configurationProgress({...base,capacityMappings:[{...mapping,skuCapacities:[]}]}).costCenterSku.complete,false);
 assert.equal(configurationProgress({...base,capacityMappings:[{...mapping,skuCapacities:[{skuId:'SKU-FG-01',ratingQuantity:0}]}]}).costCenterSku.complete,false);
 assert.equal(configurationProgress({...base,capacityMappings:[mapping],capacityLoaded:false}).costCenterSku.complete,false);
});
test('approved route unlocks Planning Configuration; saved planning rules unlock Demand',()=>{
 const base={...empty(),materialPolicyRevision:1,parameters:configuredParams,
  items:[fg],boms:[bom],resources:[resource],capacityMappings:[mapping],capacityLoaded:true};
 const draft=configurationProgress({...base,routings:[{...route,status:'draft'}]});
 assert.equal(draft.routings.complete,false);
 assert.equal(draft.config.accessible,false);
 const approved=configurationProgress({...base,routings:[route]});
 assert.equal(approved.routings.complete,true);
 assert.equal(approved.config.accessible,true);
 assert.equal(approved.demand.accessible,false);
 const planned=configurationProgress({...base,routings:[route],planningConfigurationRevision:1});
 assert.equal(planned.demand.accessible,true);
});
test('PLN navigation gates configurations rather than manufacturing stage execution',()=>{
 const ui=read('src/org/ProductionFoundation.tsx');
 const rules=read('src/org/plnSetupDependencies.ts');
 const costCenter=read('src/org/PlnCostCenterSkuSetup.tsx');
 assert.ok(ui.includes('configurationProgress({'));
 assert.ok(ui.includes("const enforceSetup=module==='PLN'&&canViewMasters&&canViewPlanning"));
 assert.ok(ui.includes('const missing=prerequisiteNames(tab)'));
 assert.ok(ui.includes('if(missing.length)'));
 assert.ok(ui.includes('setSetupBlocked('));
 assert.ok(ui.includes('Next step requires:'));
 assert.ok(ui.includes('nextMissing.length>0'));
 assert.ok(ui.includes('configuration dependencies before continuing'));
 assert.ok(ui.includes('<PlnCostCenterSetup onMappingsChanged={refreshCapacitySetup} defaultSiteId={formDefaults.defaultSiteId}/>'));
 assert.ok(costCenter.includes('onMappingsChanged?.()'));
 assert.ok(rules.includes("SETUP_REQUIREMENTS"));
 const backend=read('backend/plnMfgFoundation.ts');
 const editor=read('src/org/PlnProcessRoutingEditor.tsx');
 assert.ok(!backend.includes('/routing-dependency-preview'));
 assert.ok(!editor.includes('Stage dependency completion simulation'));
 assert.ok(!editor.includes('Simulate completion'));
});
