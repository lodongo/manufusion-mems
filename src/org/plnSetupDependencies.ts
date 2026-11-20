/**
 * Production Planning & MRP CONFIGURATION dependencies.
 * These reflect persisted setup/master records; they are NOT production stage
 * completion states and do not change manufacturing execution.
 */
export type SetupStep='materialPolicy'|'skuSetup'|'items'|'boms'|'resources'|
 'costCenterSku'|'routings'|'config'|'demand'|'documentation';
export type SetupRow={id:string;status?:unknown;category?:unknown;skuCapacities?:unknown;[key:string]:unknown};
export type SetupParameter={kind:string;enabled?:boolean};
export type SetupInputs={
 materialPolicyRevision:number;parameters:SetupParameter[];
 items:SetupRow[];boms:SetupRow[];resources:SetupRow[];
 capacityMappings:SetupRow[];capacityLoaded:boolean;
 routings:SetupRow[];planningConfigurationRevision:number;
};
export type SetupProgress={step:SetupStep;complete:boolean;detail:string;
 required:SetupStep[];missing:SetupStep[];accessible:boolean};
export const SETUP_ORDER:SetupStep[]=[
 'materialPolicy','skuSetup','items','boms','resources','costCenterSku',
 'routings','config','demand','documentation',
];
/** Prerequisites are deliberately a graph rather than simply the prior tab:
 * resource setup can occur independently of BOM creation; commissioned SKU
 * capacity needs SKU identity but not a recipe; routing needs all three. */
export const SETUP_REQUIREMENTS:Record<SetupStep,SetupStep[]>={
 materialPolicy:[],
 skuSetup:['materialPolicy'],
 items:['skuSetup'],
 boms:['items'],
 resources:['materialPolicy'],
 costCenterSku:['items'],
 routings:['boms','resources','costCenterSku'],
 config:['routings'],
 demand:['config'],
 documentation:[],
};
const text=(v:unknown)=>typeof v==='string'?v:'';
const saved=(r:SetupRow)=>!!r.id&&text(r.status).toLowerCase()!=='deleted';
export function configurationProgress(input:SetupInputs):Record<SetupStep,SetupProgress>{
 const active=(kind:string)=>input.parameters.some(p=>p.kind===kind&&p.enabled!==false);
 const required=['productNames','productionForms','containers','containerSizes'];
 const missingParams=required.filter(kind=>!active(kind));
 const completed:Record<SetupStep,{complete:boolean;detail:string}>={
  materialPolicy:{complete:input.materialPolicyRevision>0,
   detail:input.materialPolicyRevision>0?'Manufacturing rules saved.':'Save Manufacturing Setup, including material and BOM policies.'},
  skuSetup:{complete:missingParams.length===0,
   detail:missingParams.length===0?'Product parameters configured.':
    'Configure active '+missingParams.join(', ')+'.'},
  items:{complete:input.items.some(row=>saved(row)&&['FINISHED','INTERMEDIATE'].includes(text(row.category))),
   detail:'Save at least one manufactured finished or intermediate SKU.'},
  boms:{complete:input.boms.some(row=>saved(row)&&text(row.status)==='active'),
   detail:'Release at least one approved manufacturing BOM through the existing approval workflow.'},
  resources:{complete:input.resources.some(saved),
   detail:'Save at least one manufacturing resource; resources do not depend on BOM approval.'},
  costCenterSku:{complete:input.capacityLoaded&&input.capacityMappings.some(m=>
   !!(text(m.costCenterId)||m.id)&&Array.isArray(m.skuCapacities)&&m.skuCapacities.some(x=>{
    if(!x||typeof x!=='object')return false;
    const row=x as Record<string,unknown>;
    return !!text(row.skuId)&&typeof row.ratingQuantity==='number'&&
     Number.isFinite(row.ratingQuantity)&&row.ratingQuantity>0;
   })),
   detail:input.capacityLoaded?'Save at least one valid commissioned manufacturing cost-centre/SKU rating.':
    'Cannot verify manufacturing cost-centre mappings. Refresh setup status.'},
  routings:{complete:input.routings.some(row=>saved(row)&&text(row.status)==='active'),
   detail:'Release at least one approved process routing, after its BOM, resource and cost-centre dependencies are valid.'},
  config:{complete:input.planningConfigurationRevision>0,
   detail:'Save the planning horizon, frozen-period and lot-sizing configuration.'},
  demand:{complete:false,detail:'Demand is an ongoing planning activity, not a mandatory setup prerequisite.'},
  documentation:{complete:true,detail:'Documentation is always accessible.'},
 };
 if(completed.items.complete)completed.items.detail='Manufactured SKU master saved.';
 if(completed.boms.complete)completed.boms.detail='Approved manufacturing BOM available.';
 if(completed.resources.complete)completed.resources.detail='Manufacturing resource master saved.';
 if(completed.costCenterSku.complete)completed.costCenterSku.detail='Commissioned cost-centre/SKU rating saved.';
 if(completed.routings.complete)completed.routings.detail='Approved process routing available.';
 if(completed.config.complete)completed.config.detail='Planning rules saved.';
 const result={} as Record<SetupStep,SetupProgress>;
 for(const step of SETUP_ORDER){
  const required=SETUP_REQUIREMENTS[step];
  const missing=required.filter(prev=>!completed[prev].complete);
  result[step]={step,...completed[step],required,missing,accessible:missing.length===0};
 }
 return result;
}
