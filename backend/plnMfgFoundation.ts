/**
 * PLN/MFG Phase 1 foundation: shared product, versioned BOM/recipe, resources and routings.
 * The module does not create stock, purchase requisitions or accounting entries.
 * Firestore is tenant-scoped through orgRoute; mutations use optimistic concurrency.
 */
import { HttpError, commitChecked, getDoc, isObj, listDocs, nowIso, num, str, writeDoc, type Obj, type Plain } from './core';
import { orgRoute, hasPerm, type OrgContext } from './guards';
import { canAt, nodePath, scopeOf } from './access';
import { audit } from './audit';
import { getNode } from './structure';
import { calculateSkuConversion, composeConfiguredSkuName, composeSkuNameWithSequence, skuUnitConversion, masterPrefix, type SkuComponents } from './mfgSkuModel';
import { commitGeneratedCode, skuParametersForOrg, namingSequenceForOrg } from './mfgSkuConfiguration';
import { mfgMaterialPolicyForOrg, mfgMaterialPolicyPath, normalizeMfgMaterialPolicy, bomClassificationCode } from './mfgMaterialPolicy';
import {eligibleManufacturingHierarchy,routingManufacturingCostCenter,routingCommissionedCapacity} from './plnCostCenterCapacity';
import {physicalRatingUnits} from './plnPhysicalCapacity';
import { allowedNodeIds } from './positions';
import {reviewManufacturingRouting} from './mfgRoutingReadiness';
import {analyzeFlowCapacity} from '../src/shared/mfgFlowCapacity';
import {PROCUREMENT_UNITS} from './procurementUnits';
import {normalizeMaterialSupplyProfile} from './mfgMaterialSupplyProfile';
import {routingSkuIds,routingForSku} from './mfgRoutingSkuMappings';

export const MASTER_KINDS = ['items', 'boms', 'resources', 'routings'] as const;
export type MasterKind = typeof MASTER_KINDS[number];
const COLLECTION: Record<MasterKind,string> = {
    items: 'mfg_items', boms: 'mfg_boms', resources: 'mfg_resources', routings: 'mfg_routings',
};
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,59}$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/; // Unit codes may be one character (L, g).
const ROOT = (orgId:string, kind:MasterKind) => 'organizations/'+orgId+'/'+COLLECTION[kind];
const DOC = (orgId:string, kind:MasterKind, id:string) => ROOT(orgId,kind)+'/'+id;
const ARR = (v:unknown): Obj[] => Array.isArray(v) ? v.filter(isObj) : [];
const REQUIRED = (v:unknown,label:string,max=120):string => {
    const x=str(v).trim(); if(!x||x.length>max) throw new HttpError(400,label+' is required (up to '+max+' characters).'); return x;
};
const POSITIVE = (v:unknown,label:string):number => {
    const x=typeof v==='number'?v:Number(v);if(!Number.isFinite(x)||x<=0||x>1e12)throw new HttpError(400,label+' must be greater than zero.');return x;
};
const NONNEGATIVE = (v:unknown,label:string,max=1e12):number => {
    const x=typeof v==='number'?v:Number(v);if(!Number.isFinite(x)||x<0||x>max)throw new HttpError(400,label+' must be a valid nonnegative number.');return x;
};
const VALID_ID = (v:unknown,label='Code') => {const x=REQUIRED(v,label,60);if(!ID.test(x))throw new HttpError(400,label+' must contain letters, numbers, underscores or hyphens.');return x;};
const UOM=(v:unknown)=>{const x=REQUIRED(v,'Unit of measure',20);if(!CODE.test(x))throw new HttpError(400,'Invalid unit code.');return x;};
const effectiveDate=(value:unknown):string=>{
    const date=str(value).trim();
    if(!date)return '';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||
        new Date(date).toISOString().slice(0,10)!==date)
        throw new HttpError(400,'Effective date must be a valid YYYY-MM-DD calendar date.');
    return date;
};
const ENUM=<T extends string>(v:unknown, options:readonly T[],label:string):T=>{
    if(!options.includes(v as T))throw new HttpError(400,'Invalid '+label+'.');return v as T;
};
const STAGES=['RAW','INTERMEDIATE','FINISHED','PACKAGING'] as const;
const RESOURCE_TYPES=['LINE','WORK_CENTER','MACHINE','BATCH_VESSEL','ASSEMBLY_CELL','OTHER'] as const;
const INTERMEDIATE_POLICIES=['STOCKED','NON_STOCKED'] as const;
const SOURCE_MODES=['INVENTORY','UTILITY','DIRECT'] as const;
/** Published Procurement mapping is not the same as stock on hand. */
export function mappedProcurementMaterialToWarehouse(materialId:string,material:Obj,warehouseId:string,
    extensions:Array<{data:Obj}>):boolean {
    const ids=Array.isArray(material.warehouseIds)?material.warehouseIds.map(str):[];
    return ids.includes(warehouseId)||
        (!!str(material.pushedAt)&&str(material.warehouseId)===warehouseId)||
        extensions.some(e=>str(e.data.sourceId)===materialId&&str(e.data.warehouseId)===warehouseId&&str(e.data.status)==='approved');
}
const publishedProcurementMaterial=(m:Obj)=>
    ['approved','active'].includes(str(m.status).toLowerCase())&&!!str(m.materialNumber);
const storageCostCentre=(data:Obj)=>
    str(data.level)==='cost_center'&&str(data.status)!=='inactive'&&
    isObj(data.attributes)&&['INV','WHS'].includes(str(data.attributes.costType));
const ALT_CODE=/^[A-Z0-9][A-Z0-9_-]{0,31}$/;
/** Alternative code distinguishes approved routes for the same output/date. */
export function bomAlternative(value:unknown):string {
    const code=str(value).trim().toUpperCase()||'STANDARD';
    if(!ALT_CODE.test(code))throw new HttpError(400,'BOM alternative must be 1–32 uppercase letters, digits, underscores or hyphens.');
    return code;
}
/** Conversions only use dimensional equivalents from the published MEMS unit registry. */

/** Organization-managed defaults for new Production Planning & MRP forms only. */
const BASE_PLN_FORM_DEFAULTS={
 defaultSiteId:'',skuCategory:'FINISHED',bomOutputQty:1,
 resourceType:'LINE',resourceRate:1000,resourceEfficiency:100,
 routingAlternativeCode:'STANDARD',demandType:'FORECAST',demandQuantity:1,demandLeadDays:7,
} as const;
function normalizePlanningFormDefaults(raw:unknown){
 const value=isObj(raw)?raw:{};
 const defaultSiteId=str(value.defaultSiteId??BASE_PLN_FORM_DEFAULTS.defaultSiteId).trim();
 if(defaultSiteId&&!ID.test(defaultSiteId))throw new HttpError(400,'Invalid default planning site.');
 const skuCategory=ENUM(value.skuCategory??BASE_PLN_FORM_DEFAULTS.skuCategory,STAGES,'default SKU category');
 const bomOutputQty=POSITIVE(value.bomOutputQty??BASE_PLN_FORM_DEFAULTS.bomOutputQty,'Default BOM output quantity');
 const resourceType=ENUM(value.resourceType??BASE_PLN_FORM_DEFAULTS.resourceType,RESOURCE_TYPES,'default resource class');
 const resourceRate=POSITIVE(value.resourceRate??BASE_PLN_FORM_DEFAULTS.resourceRate,'Default resource rate');
 const resourceEfficiency=POSITIVE(value.resourceEfficiency??BASE_PLN_FORM_DEFAULTS.resourceEfficiency,'Default resource efficiency');
 if(resourceEfficiency>100)throw new HttpError(400,'Default resource efficiency cannot exceed 100%.');
 const routingAlternativeCode=bomAlternative(value.routingAlternativeCode??BASE_PLN_FORM_DEFAULTS.routingAlternativeCode);
 const demandType=ENUM(value.demandType??BASE_PLN_FORM_DEFAULTS.demandType,['FORECAST','FIRM_ORDER'] as const,'default demand type');
 const demandQuantity=POSITIVE(value.demandQuantity??BASE_PLN_FORM_DEFAULTS.demandQuantity,'Default demand quantity');
 const demandLeadDays=NONNEGATIVE(value.demandLeadDays??BASE_PLN_FORM_DEFAULTS.demandLeadDays,'Default demand lead days',3650);
 if(!Number.isInteger(demandLeadDays))throw new HttpError(400,'Default demand lead days must be a whole number.');
 return {defaultSiteId,skuCategory,bomOutputQty,resourceType,resourceRate,resourceEfficiency,
  routingAlternativeCode,demandType,demandQuantity,demandLeadDays};
}

export function materialUnitFactor(from:string,to:string):number {
    if(from===to)return 1;
    const factor=skuUnitConversion(from,to);
    if(factor===null)throw new HttpError(400,'Incompatible material units: '+from+' and '+to+'. Configure approved unit conversion first.');
    return factor;
}

/** Validation is shared with executable tests; rejects malformed graphs before persistence. */
export function normalizeMaster(kind:MasterKind, raw:unknown): Obj {
    if(!isObj(raw))throw new HttpError(400,'A master-data object is required.');
    const id=VALID_ID(raw.id,'Master code'), name=REQUIRED(raw.name,'Name',160);
    // SKU master data is organization-wide. Site is attached to routings, resources and BOMs instead.
    const siteId=kind==='items'?'':str(raw.siteId).trim();
    if(siteId&&!ID.test(siteId))throw new HttpError(400,'Invalid site code.');
    const base:Obj={id,name,siteId,description:str(raw.description).slice(0,600)};
    if(kind==='items'){
        const category=ENUM(raw.category,STAGES,'item category');
        const inventoryMaterialId=str(raw.inventoryMaterialId).trim();
        if(inventoryMaterialId&&!ID.test(inventoryMaterialId))throw new HttpError(400,'Invalid Inventory material reference.');
        const sourceMode=category==='RAW'||category==='PACKAGING'
            ?ENUM(raw.sourceMode??'INVENTORY',SOURCE_MODES,'material source'):'INVENTORY';
        if(category==='PACKAGING'&&sourceMode==='UTILITY')
            throw new HttpError(400,'Packaging components cannot use a metered utility source.');
        const stockPolicy=category==='INTERMEDIATE'
            ?ENUM(raw.stockPolicy??'NON_STOCKED',INTERMEDIATE_POLICIES,'intermediate stock policy')
            :sourceMode==='UTILITY'?'METERED':sourceMode==='DIRECT'?'DIRECT':'STOCKED';
        const utilityCode=sourceMode==='UTILITY'?VALID_ID(raw.utilityCode,'Registered utility code'):'';
        const utilityWorkCenterId=sourceMode==='UTILITY'?VALID_ID(raw.utilityWorkCenterId,'Utility work center'):'';
        if((category==='RAW'||category==='PACKAGING')&&sourceMode==='INVENTORY'&&!inventoryMaterialId)
            throw new HttpError(400,'Inventory-sourced raw and packaging materials require an approved Inventory material reference.');
        if(sourceMode==='UTILITY'&&inventoryMaterialId)
            throw new HttpError(400,'A metered utility input cannot simultaneously be an Inventory issue. Select one source.');
        if(category==='INTERMEDIATE'&&stockPolicy==='STOCKED'&&!inventoryMaterialId)
            throw new HttpError(400,'A stock-managed intermediate needs an Inventory material reference.');
        const processClassId=str(raw.processClassId).trim();
        if(processClassId)VALID_ID(processClassId,'Manufacturing process classification');
        return {...base,category,sourceMode,stockPolicy,utilityCode,utilityWorkCenterId,
            processClassId,family:str(raw.family).slice(0,100),uom:UOM(raw.uom),inventoryMaterialId,
            supplyProfile:normalizeMaterialSupplyProfile(raw.supplyProfile, UOM(raw.uom)),
            packQty:POSITIVE(raw.packQty??1,'Pack quantity'),skuComponents:isObj(raw.skuComponents)?raw.skuComponents:{},
            skuConversion:isObj(raw.skuConversion)?raw.skuConversion:{},skuNamingSnapshot:isObj(raw.skuNamingSnapshot)?raw.skuNamingSnapshot:{}};
    }
    if(kind==='resources'){
        return {...base,type:ENUM(raw.type,RESOURCE_TYPES,'resource type'),rate:POSITIVE(raw.rate,'Rated units per hour'),rateUom:UOM(raw.rateUom),assetId:str(raw.assetId).slice(0,60),efficiency:NONNEGATIVE(raw.efficiency??100,'Efficiency percentage',100)};
    }
    if(kind==='boms'){
        const classificationCode=bomClassificationCode(raw);
        const productVariantId=str(raw.productVariantId??raw.flavorVariantId).trim();
        if(productVariantId)VALID_ID(productVariantId,'Product/Variant');
        // Shared manufacturing intermediates do not require product-specific identity.
        const alternativeCode=bomAlternative(raw.alternativeCode);
        const routingId=str(raw.routingId).trim();
        if(routingId)VALID_ID(routingId,'Optional process routing');
        const parentSkuId=VALID_ID(raw.parentSkuId,'Parent SKU');
        const components=ARR(raw.components);
        if(!components.length||components.length>150)throw new HttpError(400,'A BOM must have 1–150 components.');
        const seen=new Set<string>();
        const lines=components.map((c,i)=>{
            const source=str(c.source);
            if(source&&!['INTERMEDIATE','WAREHOUSE'].includes(source))
                throw new HttpError(400,'Component '+(i+1)+': choose an intermediate or a warehouse procurement material.');
            const quantity=POSITIVE(c.quantity,'Component quantity'),uom=UOM(c.uom);
            const scrapPct=NONNEGATIVE(c.scrapPct??0,'Scrap percentage',100);
            if(source==='WAREHOUSE'){
                const warehouseId=VALID_ID(c.warehouseId,'Warehouse');
                const materialId=VALID_ID(c.materialId,'Procurement material');
                const key='WAREHOUSE:'+warehouseId+':'+materialId;
                if(seen.has(key))throw new HttpError(400,'Duplicate material in the same warehouse. Combine its quantities.');
                seen.add(key);
                return {line:i+1,source:'WAREHOUSE',skuId:'',warehouseId,materialId,quantity,uom,scrapPct};
            }
            const skuId=VALID_ID(c.skuId,'Component SKU');
            if(skuId===parentSkuId)throw new HttpError(400,'A SKU cannot consume itself.');
            const key='SKU:'+skuId;
            if(seen.has(key))throw new HttpError(400,'Duplicate component SKU '+skuId+'. Combine quantities in one line.');
            seen.add(key);
            return {line:i+1,...(source?{source:'INTERMEDIATE'}:{}),skuId,quantity,uom,scrapPct};
        });
        return {...base,classificationCode,productVariantId,alternativeCode,routingId,parentSkuId,outputQty:POSITIVE(raw.outputQty??1,'Output basis'),outputUom:UOM(raw.outputUom),components:lines as unknown as Plain,effectiveFrom:effectiveDate(raw.effectiveFrom),versionNote:str(raw.versionNote).slice(0,300)};
    }
    const processClassId=str(raw.processClassId).trim();
    if(processClassId)VALID_ID(processClassId,'Manufacturing process classification');
    const routingModelVersion=raw.routingModelVersion===2?2:1;
    // A new stage-based route can be owned by its process classification.
    // Previously created SKU-anchored routing records retain their original SKU.
    const skuId=str(raw.skuId).trim()
        ?VALID_ID(raw.skuId,'Routed SKU')
        :routingModelVersion===2&&processClassId?'':VALID_ID(raw.skuId,'Routed SKU');
    const advanced=routingModelVersion===2;
    const operations=ARR(raw.operations);
    if(!operations.length||operations.length>60)throw new HttpError(400,'A routing must have 1–60 operations.');
    const codes=new Set<string>();
    const steps=operations.map((o,i)=>{
        const code=VALID_ID(o.code,'Operation code');
        if(codes.has(code))throw new HttpError(400,'Duplicate operation '+code+'.');
        codes.add(code);
        const producesSkuId=str(o.producesSkuId).trim();
        if(producesSkuId)VALID_ID(producesSkuId,'Stage output SKU');
        const dependsOn=Array.isArray(o.dependsOn)?o.dependsOn.map(str):(i>0?[str(operations[i-1].code)]:[]);
        if(dependsOn.some(x=>!codes.has(x)||x===code)||new Set(dependsOn).size!==dependsOn.length)
            throw new HttpError(400,'Stage dependencies must reference unique earlier stages.');
        const stageName=advanced?str(o.name).trim().slice(0,120):REQUIRED(o.name,'Operation name',120);
        const resourceId=advanced?str(o.resourceId).trim():VALID_ID(o.resourceId,'Resource code');
        if(resourceId)VALID_ID(resourceId,'Resource code');
        const core={code,sequence:i+1,name:stageName,resourceId,producesSkuId,dependsOn,
            setupMinutes:NONNEGATIVE(o.setupMinutes??0,'Setup minutes',100000),
            runMinutesPerUnit:NONNEGATIVE(o.runMinutesPerUnit??0,'Minutes per output unit',100000)};
        if(!advanced)return core;
        const costCenterId=str(o.costCenterId).trim(),bomId=str(o.bomId).trim();
        if(costCenterId)VALID_ID(costCenterId,'Manufacturing cost centre');
        if(bomId)VALID_ID(bomId,'Stage BOM');
        const processClass=str(o.processClass||'GENERAL').trim().toUpperCase();
        if(!/^[A-Z0-9][A-Z0-9_-]{0,59}$/.test(processClass))
            throw new HttpError(400,'Stage process class must be a valid classification code.');
        return {...core,costCenterId,bomId,processClass,
            stageType:ENUM(o.stageType||'PRODUCE',['PRODUCE','INSPECT','TRANSFER','OTHER'] as const,'stage type'),
            capacityBasis:ENUM(o.capacityBasis||'RESOURCE_RATE',
                ['PHYSICAL_CONTAINER','RESOURCE_RATE','BATCH_CYCLE','TIME_PER_UNIT','CONTINUOUS_FLOW'] as const,'capacity basis'),
            batchSize:NONNEGATIVE(o.batchSize??0,'Batch size'),
            cycleMinutes:NONNEGATIVE(o.cycleMinutes??0,'Batch cycle minutes',100000),
            flowRatePerHour:NONNEGATIVE(o.flowRatePerHour??0,'Continuous hourly output rate',1e12),
            flowRateUom:str(o.flowRateUom).trim()?UOM(o.flowRateUom):'',
            flowInputFactor:POSITIVE(o.flowInputFactor??1,'Upstream input required per downstream output unit'),
            flowBufferAvailable:o.flowBufferAvailable===null||o.flowBufferAvailable===undefined||o.flowBufferAvailable===''?
                null:NONNEGATIVE(o.flowBufferAvailable,'Usable upstream buffer quantity',1e12)};
    });
    // A shared route keeps one master process while SKU-specific records supply
    // their own BOM/output identities and optional stage timings.
    const mappings=ARR(raw.skuMappings);
    if(!advanced&&mappings.length)throw new HttpError(400,'Shared SKU routing requires the current stage-based routing model.');
    if(mappings.length>100)throw new HttpError(400,'A routing may be assigned to at most 100 additional SKUs.');
    const mapped=new Set<string>(),stageCodes=new Set(steps.map(o=>str(o.code)));
    const skuMappings=mappings.map((mapping,i)=>{
        const mappedSkuId=VALID_ID(mapping.skuId,'Mapped SKU');
        if(mappedSkuId===skuId||mapped.has(mappedSkuId))
            throw new HttpError(400,'The same SKU cannot be mapped to a routing more than once.');
        mapped.add(mappedSkuId);
        const overrides=ARR(mapping.stages);
        if(overrides.length>steps.length)throw new HttpError(400,'Too many stage settings for mapped SKU '+mappedSkuId+'.');
        const used=new Set<string>();
        const stages=overrides.map(o=>{
            const code=VALID_ID(o.code,'Mapped stage');
            if(!stageCodes.has(code)||used.has(code))
                throw new HttpError(400,'Mapped SKU '+mappedSkuId+' must reference distinct existing routing stages.');
            used.add(code);
            const result:Obj={code};
            if(Object.hasOwn(o,'producesSkuId')){
                const outputId=str(o.producesSkuId).trim();
                result.producesSkuId=outputId?VALID_ID(outputId,'Mapped stage output'):'';
            }
            if(Object.hasOwn(o,'bomId')){
                const bomId=str(o.bomId).trim();
                result.bomId=bomId?VALID_ID(bomId,'Mapped stage BOM'):'';
            }
            for(const [field,label,max] of [
                ['setupMinutes','Setup minutes',100000],
                ['runMinutesPerUnit','Minutes per unit',100000],
                ['batchSize','Batch size',1e12],
                ['cycleMinutes','Cycle minutes',100000],
                ['flowRatePerHour','Continuous output units per hour',1e12],
                ['flowBufferAvailable','Usable flow buffer',1e12],
            ] as const)if(Object.hasOwn(o,field)&&o[field]!==null&&o[field]!=='')
                result[field]=NONNEGATIVE(o[field],label,max);
            if(Object.hasOwn(o,'capacityBasis'))
                result.capacityBasis=ENUM(o.capacityBasis,
                    ['PHYSICAL_CONTAINER','RESOURCE_RATE','BATCH_CYCLE','TIME_PER_UNIT','CONTINUOUS_FLOW'] as const,'capacity basis');
            if(Object.hasOwn(o,'flowRateUom'))result.flowRateUom=str(o.flowRateUom).trim()?UOM(o.flowRateUom):'';
            if(Object.hasOwn(o,'flowInputFactor'))result.flowInputFactor=POSITIVE(o.flowInputFactor,'Upstream input per output');
            return result;
        });
        return {skuId:mappedSkuId,stages};
    });
    return {...base,skuId,processClassId,skuMappings:skuMappings as unknown as Plain,operations:steps as unknown as Plain,
        routingModelVersion,alternativeCode:advanced?bomAlternative(raw.alternativeCode):'STANDARD',
        effectiveFrom:effectiveDate(raw.effectiveFrom)};
}

export function detectBomCycle(boms:Array<{parentSkuId:string;components:Array<{skuId:string}>}>,parentSkuId:string,components:Array<{skuId:string}>):boolean {
    // A parent may have both BOM types or several effective revisions.
    const byParent=new Map<string,Set<string>>();
    const add=(parent:string,children:Array<{skuId:string}>)=>{
        const list=byParent.get(parent)??new Set<string>();
        children.forEach(c=>{if(c.skuId)list.add(c.skuId);});byParent.set(parent,list);
    };
    boms.forEach(b=>add(b.parentSkuId,b.components));
    add(parentSkuId,components);
    const active=new Set<string>(), visited=new Set<string>();
    const visit=(node:string):boolean=>{
        if(active.has(node))return true;
        if(visited.has(node))return false;
        active.add(node);
        for(const child of byParent.get(node)??[])if(visit(child))return true;
        active.delete(node);visited.add(node);return false;
    };
    return visit(parentSkuId);
}

export async function referenceChecks(ctx:OrgContext,kind:MasterKind,item:Obj,existingId:string) {
    const siteId=str(item.siteId);
    if(siteId){
        const site=await getNode(ctx,siteId);
        if(str(site.data.level)!=='site'||str(site.data.status)==='inactive')throw new HttpError(400,'Choose an active organization site.');
    }
    if(kind==='items'){
        const sourceRecords=ARR(isObj(item.supplyProfile)?item.supplyProfile.sources:null);
        for(const source of sourceRecords){
            const sourceSite=str(source.siteId);
            if(!sourceSite)continue;
            const node=await getNode(ctx,sourceSite);
            if(str(node.data.level)!=='site'||str(node.data.status)==='inactive')
                throw new HttpError(400,'Material supply source must reference an active organization site.');
            if(!await recordAccess(ctx,'MFG.view',sourceSite))
                throw new HttpError(403,'A material supply source references a site outside your permitted scope.');
        }
        const processClassId=str(item.processClassId);
        if(processClassId){
            if(!['FINISHED','INTERMEDIATE'].includes(str(item.category)))
                throw new HttpError(400,'Manufacturing process classification applies only to produced SKUs.');
            const processClass=await getDoc('organizations/'+ctx.orgId+'/mfg_sku_parameters/'+processClassId);
            if(!processClass||str(processClass.data.kind)!=='processClasses'||processClass.data.enabled===false)
                throw new HttpError(400,'Choose an active manufacturing process classification from Product Configuration.');
        }
        const {policy}=await mfgMaterialPolicyForOrg(ctx.orgId);
        if(str(item.sourceMode)==='DIRECT'&&
            (str(item.category)==='RAW'?!policy.allowRawDirect:!policy.allowPackagingDirect))
            throw new HttpError(400,'Direct-consumption tracking is disabled for this material category in organization Manufacturing Setup.');
        if(str(item.sourceMode)==='UTILITY'&&!policy.allowRawUtility)
            throw new HttpError(400,'Metered utility inputs are disabled in organization Manufacturing Setup.');
        if(str(item.sourceMode)==='UTILITY'){
            const utility=await getDoc('organizations/'+ctx.orgId+'/equipment_utilities/'+str(item.utilityWorkCenterId));
            if(!utility||!ARR(utility.data.items).some(x=>str(x.code)===str(item.utilityCode)))
                throw new HttpError(400,'The metered utility input must reference a configured equipment utility supply.');
            const utilityNodePath=await nodePath(ctx.orgId,str(item.utilityWorkCenterId));
            if(!utilityNodePath.length||(siteId&&!utilityNodePath.includes(siteId)))
                throw new HttpError(400,'The metered utility supply must belong to this production site.');
            if(!canAt(ctx,'MFG.view',utilityNodePath,await scopeOf(ctx)))
                throw new HttpError(403,'The selected utility is outside your authorized scope.');
        }
        const materialId=str(item.inventoryMaterialId);
        if(materialId){
            const material=await getDoc('organizations/'+ctx.orgId+'/materials/'+materialId);
            if(!material||!['approved','active'].includes(str(material.data.status))||!str(material.data.materialNumber))
                throw new HttpError(400,'Choose an approved, numbered Inventory material from the existing Material Master.');
            const inventoryUom=str(material.data.uom);
            if(inventoryUom)materialUnitFactor(str(item.uom),inventoryUom);
        }
    }
    if(kind==='resources'){
        const assetId=str(item.assetId);
        if(assetId){
            if(!ID.test(assetId))throw new HttpError(400,'Invalid Asset ID.');
            const asset=await getDoc('organizations/'+ctx.orgId+'/assets/'+assetId);
            if(!asset||str(asset.data.status)!=='active')
                throw new HttpError(400,'Manufacturing equipment must reference an active Asset Register record.');
            if(str(asset.data.siteId)&&str(item.siteId)!==str(asset.data.siteId))
                throw new HttpError(400,'The resource must belong to the same site as the linked asset.');
        }
    }
    if(kind==='boms'){
        const code=bomClassificationCode(item);
        const configured=(await mfgMaterialPolicyForOrg(ctx.orgId)).policy.bomClassifications.find(c=>c.code===code);
        // Older records may retain a historical code; new records must adopt a configured classification.
        const historical=!str(item.classificationCode)&&!!str(item.type);
        if(!configured&&!historical)
            throw new HttpError(400,'BOM classification must be configured in Manufacturing Setup.');
        if(configured&&!configured.enabled&&!historical)
            throw new HttpError(400,'BOM classification is disabled in Manufacturing Setup.');
        const productVariantId=str(item.productVariantId??item.flavorVariantId);
        if(productVariantId){
            const variant=await getDoc('organizations/'+ctx.orgId+'/mfg_sku_parameters/'+productVariantId);
            if(!variant||str(variant.data.kind)!=='productNames'||variant.data.enabled===false)
                throw new HttpError(400,'Select an active Product/Variant from SKU Configuration.');
        }
        const parent=await getDoc(DOC(ctx.orgId,'items',str(item.parentSkuId)));
        if(!parent)throw new HttpError(400,'Parent SKU does not exist in Manufacturing master data.');
        // Output material is global; BOM site applicability is controlled by the BOM itself.
        materialUnitFactor(str(item.outputUom),str(parent.data.uom));
        // Upstream intermediate BOMs are not prerequisites for saving or releasing this BOM.
        // The referenced material records must exist; a later planning-readiness check
        // reports missing approved upstream formulations without blocking authoring.
        if(productVariantId&&isObj(parent.data.skuComponents)){
            const assigned=str((parent.data.skuComponents as Obj).productNameId);
            if(assigned&&assigned!==productVariantId)
                throw new HttpError(400,'BOM Product/Variant conflicts with the output material identity.');
        }
        const routingId=str(item.routingId);
        if(routingId){
            const route=await getDoc(DOC(ctx.orgId,'routings',routingId));
            if(!route||!routingSkuIds(route.data).includes(str(item.parentSkuId)))
                throw new HttpError(400,'The optional routing must include this BOM output SKU in its assigned SKUs.');
        }
        const components=ARR(item.components);
        const warehouseLines=components.filter(c=>str(c.source)==='WAREHOUSE');
        if(warehouseLines.length){
            const allowed=ctx.role==='org_super_admin'?'all':await allowedNodeIds(ctx.orgId,ctx.me,true);
            const extensions=await listDocs('organizations/'+ctx.orgId+'/material_extensions');
            for(const c of warehouseLines){
                const warehouseId=str(c.warehouseId),materialId=str(c.materialId);
                if(allowed!=='all'&&!allowed.has(warehouseId))
                    throw new HttpError(403,'Warehouse '+warehouseId+' is outside your visible organization scope.');
                const [node,warehouse,material]=await Promise.all([
                    getDoc('organizations/'+ctx.orgId+'/structure/'+warehouseId),
                    getDoc('organizations/'+ctx.orgId+'/warehouses/'+warehouseId),
                    getDoc('organizations/'+ctx.orgId+'/materials/'+materialId),
                ]);
                if(!node||!storageCostCentre(node.data)||!warehouse)
                    throw new HttpError(400,'Choose a configured accessible Inventory/Warehousing cost centre.');
                if(!material||!publishedProcurementMaterial(material.data)||
                    !mappedProcurementMaterialToWarehouse(materialId,material.data,warehouseId,extensions))
                    throw new HttpError(400,'The Procurement material is not approved and mapped to the selected warehouse.');
                materialUnitFactor(str(c.uom),str(material.data.uom));
            }
        }
        for(const component of components.filter(c=>str(c.source)!=='WAREHOUSE')){
            const child=await getDoc(DOC(ctx.orgId,'items',str(component.skuId)));
            if(!child)throw new HttpError(400,'Component '+str(component.skuId)+' is missing from SKU master.');
            if(str(component.source)==='INTERMEDIATE'&&str(child.data.category)!=='INTERMEDIATE')
                throw new HttpError(400,'Only intermediate/WIP SKUs can use the intermediate material source.');
            materialUnitFactor(str(component.uom),str(child.data.uom));
        }
        const others=(await listDocs(ROOT(ctx.orgId,'boms')))
            .filter(d=>d.id!==existingId)
            .map(d=>({parentSkuId:str(d.data.parentSkuId),components:ARR(d.data.components).map(c=>({skuId:str(c.skuId)}))}));
        if(detectBomCycle(others,str(item.parentSkuId),components.map(c=>({skuId:str(c.skuId)}))))
            throw new HttpError(400,'The BOM introduces a circular manufacturing dependency.');
    }
    if(kind==='routings'){
        const processClassId=str(item.processClassId);
        if(processClassId){
            const processClass=await getDoc('organizations/'+ctx.orgId+'/mfg_sku_parameters/'+processClassId);
            if(!processClass||str(processClass.data.kind)!=='processClasses'||processClass.data.enabled===false)
                throw new HttpError(400,'Routing process classification must exist and be active in Product Configuration.');
        }
        for(const skuId of routingSkuIds(item)){
         const routed=await getDoc(DOC(ctx.orgId,'items',skuId));
         if(!routed||!['FINISHED','INTERMEDIATE'].includes(str(routed.data.category)))
             throw new HttpError(400,'Routing SKU '+skuId+' is not an eligible manufactured SKU.');
         if(processClassId&&str(routed.data.processClassId)!==processClassId)
             throw new HttpError(400,'SKU '+skuId+' does not belong to the routing manufacturing process classification.');
         const variant=routingForSku(item,skuId);
         if(!variant)throw new HttpError(400,'Cannot resolve the SKU allocation '+skuId+'.');
         for(const o of ARR(variant.operations)){
            const stage='SKU '+skuId+' / Stage '+(num(o.sequence)??0)+' ('+(str(o.name)||str(o.code))+'): ';
            if(!str(o.resourceId)&&item.routingModelVersion!==2)
                throw new HttpError(400,stage+'a manufacturing resource is required.');
            if(str(o.resourceId)){
                const resource=await getDoc(DOC(ctx.orgId,'resources',str(o.resourceId)));
                if(!resource)throw new HttpError(400,stage+'routing resource not found: '+str(o.resourceId));
                if(str(resource.data.status)==='removed'||str(resource.data.status)==='deleted')
                    throw new HttpError(409,stage+'routing resource is no longer active. Select a configured manufacturing resource.');
                if(str(resource.data.siteId)&&str(resource.data.siteId)!==str(item.siteId))
                    throw new HttpError(400,stage+'routing resource belongs to another site.');
            }
            if(str(o.costCenterId))
                await routingManufacturingCostCenter(ctx,str(o.costCenterId),str(item.siteId));
            if(str(o.producesSkuId)){
                const product=await getDoc(DOC(ctx.orgId,'items',str(o.producesSkuId)));
                if(!product||['RAW','PACKAGING'].includes(str(product.data.category)))
                    throw new HttpError(400,stage+'output must be a manufactured SKU or intermediate product.');
            }
            if(str(o.bomId)){
                const bom=await getDoc(DOC(ctx.orgId,'boms',str(o.bomId)));
                if(!bom)throw new HttpError(400,stage+'selected stage BOM was not found.');
                if(str(bom.data.parentSkuId)!==str(o.producesSkuId))
                    throw new HttpError(400,stage+'BOM output does not match the stage output SKU.');
                if(str(bom.data.siteId)&&str(bom.data.siteId)!==str(item.siteId))
                    throw new HttpError(400,stage+'BOM belongs to another production site.');
            }
         }
        }
    }
}

const track=(ctx:OrgContext,action:string,target:string)=>
    audit([{category:'data',action,actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:target},details:'Production master data; approval and release remain separate from draft editing.'}]);
const out=(d:{id:string;data:Obj;updateTime?:string})=>{
    const data={...d.data};
    if(Object.prototype.hasOwnProperty.call(data,'flavorVariantId')){
        data.productVariantId=str(data.productVariantId)||str(data.flavorVariantId);
        delete data.flavorVariantId;
    }
    if(Object.prototype.hasOwnProperty.call(data,'parentSkuId')){
        data.classificationCode=bomClassificationCode(data);
        delete data.type;
    }
    return {id:d.id,...data,updatedAt:str(d.data.updatedAt),revision:num(d.data.revision)??1};
};
const readKind=(v:unknown):MasterKind=>ENUM(v,MASTER_KINDS,'master-data kind');
async function recordAccess(ctx:OrgContext,permission:string,siteId:string):Promise<boolean>{
    // Shared company masters are readable to authorized MFG viewers, but only direct role holders may edit them.
    if(!siteId)return permission==='MFG.view'||ctx.role==='org_super_admin'||hasPerm(ctx.directPermissions,permission);
    const scope=await scopeOf(ctx);
    return canAt(ctx,permission,await nodePath(ctx.orgId,siteId),scope);
}

/** Demo data is read-only and never writes to live stock/finance/procurement. */
export function fictionalLine11Demo(){
    // Read-only reference scenario, never written to an organization or Inventory ledger.
    const items=[
        {id:'DEMO-RAW-WATER',name:'Fictional untreated water',category:'RAW',uom:'L'},
        {id:'DEMO-MINERAL',name:'Fictional beverage treatment mineral',category:'RAW',uom:'KG'},
        {id:'DEMO-PREFORM-500',name:'Fictional 500 mL PET preform',category:'PACKAGING',uom:'EA'},
        {id:'DEMO-PREFORM-1000',name:'Fictional 1 L PET preform',category:'PACKAGING',uom:'EA'},
        {id:'DEMO-CAP',name:'Fictional 2622 cap',category:'PACKAGING',uom:'EA'},
        {id:'DEMO-LABEL-500',name:'Fictional 500 mL label',category:'PACKAGING',uom:'EA'},
        {id:'DEMO-LABEL-1000',name:'Fictional 1 L label',category:'PACKAGING',uom:'EA'},
        {id:'DEMO-CASE',name:'Fictional 12-bottle case material',category:'PACKAGING',uom:'EA'},
        {id:'DEMO-PREPARED-WATER',name:'Fictional prepared beverage water',category:'INTERMEDIATE',uom:'L'},
        {id:'DEMO-BOTTLE-500',name:'Fictional 500 mL blown PET bottle',category:'INTERMEDIATE',uom:'EA'},
        {id:'DEMO-BOTTLE-1000',name:'Fictional 1 L blown PET bottle',category:'INTERMEDIATE',uom:'EA'},
        {id:'DEMO-FILLED-500',name:'Fictional filled 500 mL bottle',category:'INTERMEDIATE',uom:'EA'},
        {id:'DEMO-FILLED-1000',name:'Fictional filled 1 L bottle',category:'INTERMEDIATE',uom:'EA'},
        {id:'DEMO-FG-500',name:'Fictional PET water 500 mL x 12',category:'FINISHED',uom:'CASE'},
        {id:'DEMO-FG-1000',name:'Fictional PET water 1 L x 12',category:'FINISHED',uom:'CASE'},
    ];
    const c=(skuId:string,quantity:number,uom:string,scrapPct=0)=>({skuId,quantity,uom,scrapPct});
    const boms=[
        {id:'DEMO-RECIPE-WATER',type:'RECIPE',name:'Prepare fictional beverage water',parentSkuId:'DEMO-PREPARED-WATER',outputQty:1000,outputUom:'L',components:[c('DEMO-RAW-WATER',1000,'L',1),c('DEMO-MINERAL',0.3,'KG')]},
        {id:'DEMO-BOM-BLOW-500',type:'BOM',name:'Blow 500 mL PET bottle',parentSkuId:'DEMO-BOTTLE-500',outputQty:1,outputUom:'EA',components:[c('DEMO-PREFORM-500',1,'EA',1)]},
        {id:'DEMO-BOM-BLOW-1000',type:'BOM',name:'Blow 1 L PET bottle',parentSkuId:'DEMO-BOTTLE-1000',outputQty:1,outputUom:'EA',components:[c('DEMO-PREFORM-1000',1,'EA',1)]},
        {id:'DEMO-BOM-FILL-500',type:'BOM',name:'Fill and cap 500 mL',parentSkuId:'DEMO-FILLED-500',outputQty:1,outputUom:'EA',components:[c('DEMO-BOTTLE-500',1,'EA',0.5),c('DEMO-CAP',1,'EA',1),c('DEMO-PREPARED-WATER',0.5,'L',1)]},
        {id:'DEMO-BOM-FILL-1000',type:'BOM',name:'Fill and cap 1 L',parentSkuId:'DEMO-FILLED-1000',outputQty:1,outputUom:'EA',components:[c('DEMO-BOTTLE-1000',1,'EA',0.5),c('DEMO-CAP',1,'EA',1),c('DEMO-PREPARED-WATER',1,'L',1)]},
        {id:'DEMO-BOM-PACK-500',type:'BOM',name:'Label and case pack 500 mL',parentSkuId:'DEMO-FG-500',outputQty:1,outputUom:'CASE',components:[c('DEMO-FILLED-500',12,'EA',0.5),c('DEMO-LABEL-500',12,'EA',1),c('DEMO-CASE',1,'EA',0.5)]},
        {id:'DEMO-BOM-PACK-1000',type:'BOM',name:'Label and case pack 1 L',parentSkuId:'DEMO-FG-1000',outputQty:1,outputUom:'CASE',components:[c('DEMO-FILLED-1000',12,'EA',0.5),c('DEMO-LABEL-1000',12,'EA',1),c('DEMO-CASE',1,'EA',0.5)]},
    ];
    const resources=[
        {id:'DEMO-PREP',name:'Fictional water preparation',type:'BATCH_VESSEL',rate:4000,rateUom:'L',efficiency:90},
        {id:'DEMO-BLOW',name:'Fictional Line 11 bottle blowing',type:'MACHINE',rate:28000,rateUom:'EA',efficiency:85},
        {id:'DEMO-FILL',name:'Fictional KHS PET Line 11 filling',type:'LINE',rate:28000,rateUom:'EA',efficiency:80},
        {id:'DEMO-PACK',name:'Fictional Line 11 case packing',type:'WORK_CENTER',rate:2000,rateUom:'CASE',efficiency:80},
    ];
    const route=(id:string,name:string,skuId:string,size:'500'|'1000')=>({id,name,skuId,operations:[
        {code:'PREP',name:'Water preparation',resourceId:'DEMO-PREP',producesSkuId:'DEMO-PREPARED-WATER',dependsOn:[]},
        {code:'BLOW',name:'PET bottle blowing',resourceId:'DEMO-BLOW',producesSkuId:'DEMO-BOTTLE-'+size,dependsOn:[]},
        {code:'FILL',name:'Fill and cap',resourceId:'DEMO-FILL',producesSkuId:'DEMO-FILLED-'+size,dependsOn:['PREP','BLOW']},
        {code:'PACK',name:'Label, pack and palletize',resourceId:'DEMO-PACK',producesSkuId:skuId,dependsOn:['FILL']},
    ]});
    const routings=[route('DEMO-ROUTE-500','Fictional 500 mL multi-stage process','DEMO-FG-500','500'),route('DEMO-ROUTE-1000','Fictional 1 L multi-stage process','DEMO-FG-1000','1000')];
    return {demo:true,persisted:false,isolated:true,label:'READ-ONLY FICTIONAL DATA — no purchasing, inventory or finance postings',items,boms,resources,routings};
}

export const plnMfgFoundationRoutes={
    'POST /api/org/pln-mfg/foundation/references':[
        orgRoute('org.mfg.foundation.references','MFG.view',async ctx=>{
            const orgRoot='organizations/'+ctx.orgId;
            const [materials,assets,structure,utilityRegisters,warehouseDocs,extensions]=await Promise.all([
                listDocs(orgRoot+'/materials'),listDocs(orgRoot+'/assets'),listDocs(orgRoot+'/structure'),
                listDocs(orgRoot+'/equipment_utilities'),listDocs(orgRoot+'/warehouses'),
                listDocs(orgRoot+'/material_extensions'),
            ]);
            const allowedWarehouses=ctx.role==='org_super_admin'?'all':await allowedNodeIds(ctx.orgId,ctx.me,true);
            const warehouseIds=new Set(warehouseDocs.map(w=>w.id));
            const warehouseMaterials=[] as Array<{warehouseId:string;id:string;name:string;materialNumber:string;uom:string}>;
            const warehouses=[] as Array<{id:string;name:string;code:string}>;
            for(const node of structure.filter(n=>storageCostCentre(n.data)&&warehouseIds.has(n.id)&&
                (allowedWarehouses==='all'||allowedWarehouses.has(n.id)))){
                const linked=materials.filter(m=>publishedProcurementMaterial(m.data)&&
                    mappedProcurementMaterialToWarehouse(m.id,m.data,node.id,extensions));
                if(!linked.length)continue;
                warehouses.push({id:node.id,name:str(node.data.name)||node.id,code:str(node.data.code)});
                linked.forEach(m=>warehouseMaterials.push({
                    warehouseId:node.id,id:m.id,name:str(m.data.shortText)||str(m.data.name)||m.id,
                    materialNumber:str(m.data.materialNumber),uom:str(m.data.uom),
                }));
            }
            const sites=[];
            for(const site of structure.filter(x=>str(x.data.level)==='site'&&str(x.data.status)!=='inactive')){
                if(await recordAccess(ctx,'MFG.view',site.id))
                    sites.push({id:site.id,name:str(site.data.name)||site.id,code:str(site.data.code)});
            }
            const visibleSites=new Set(sites.map(x=>x.id));
            return {
                sites,warehouses,warehouseMaterials,
                utilities:(await Promise.all(utilityRegisters.map(async d=>
                    await recordAccess(ctx,'MFG.view',d.id)?d:null))).filter((d):d is NonNullable<typeof d>=>d!==null)
                    .flatMap(d=>ARR(d.data.items).map(u=>({
                        workCenterId:d.id,code:str(u.code),name:str(u.label)||str(u.code),
                    }))).filter(u=>u.code),
                materials:materials.filter(x=>['approved','active'].includes(str(x.data.status))&&str(x.data.materialNumber))
                    .map(x=>({id:x.id,name:str(x.data.shortText)||str(x.data.name)||x.id,
                        materialNumber:str(x.data.materialNumber),uom:str(x.data.uom)})),
                assets:assets.filter(x=>str(x.data.status)==='active'&&
                    (!str(x.data.siteId)||visibleSites.has(str(x.data.siteId))))
                    .map(x=>({id:x.id,name:str(x.data.name)||x.id,siteId:str(x.data.siteId)})),
            };
        }),
    ],
    'POST /api/org/pln-mfg/foundation/routing-references':[
        orgRoute('org.mfg.routing.references','MFG.view',async ctx=>{
            const root='organizations/'+ctx.orgId;
            const [structure,metadata,capacity,skuMasters]=await Promise.all([
                listDocs(root+'/structure'),
                getDoc('module_workspaces/FIN/metadata/costCenterTypes'),
                listDocs(root+'/pln_cost_center_capacity'),
                listDocs(root+'/mfg_items'),
            ]);
            const finishedSkuIds=new Set(skuMasters.filter(d=>str(d.data.category)==='FINISHED')
                .map(d=>d.id));
            const nodes=structure.map(d=>({
                id:d.id,parentId:str(d.data.parentId),level:str(d.data.level),
                name:str(d.data.name)||str(d.data.code)||d.id,
                code:str(d.data.code),costType:isObj(d.data.attributes)?str(d.data.attributes.costType):'',
                status:str(d.data.status)||'active',
            }));
            const eligible=eligibleManufacturingHierarchy(nodes,
                Array.isArray(metadata?.data.items)?metadata.data.items:[]);
            const indexed=new Map(nodes.map(n=>[n.id,n]));
            const saved=new Map(capacity.map(d=>[d.id,d]));
            const scope=await scopeOf(ctx),costCenters=[];
            for(const center of eligible.costCenters){
                if(ctx.role!=='org_super_admin'&&
                    !canAt(ctx,'MFG.view',await nodePath(ctx.orgId,center.id),scope))continue;
                let parent=indexed.get(center.parentId),siteId='',legalEntityId='';
                for(let i=0;i<12&&parent;i++){
                    if(parent.level==='site')siteId=parent.id;
                    if(parent.level==='legal_entity')legalEntityId=parent.id;
                    parent=indexed.get(parent.parentId);
                }
                if(!siteId)continue;
                const mapping=saved.get(center.id);
                const skuIds=(Array.isArray(mapping?.data.skuCapacities)?mapping.data.skuCapacities:[])
                    .filter(isObj).map(x=>str(x.skuId)).filter(id=>finishedSkuIds.has(id));
                costCenters.push({id:center.id,name:center.name,code:center.code,siteId,
                    legalEntityId,commissionedSkuIds:skuIds});
            }
            costCenters.sort((a,b)=>a.name.localeCompare(b.name));
            return {costCenters};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/routing-review':[
        orgRoute('org.mfg.routing.review','MFG.view',async ctx=>{
            const raw=isObj(ctx.body.record)?ctx.body.record:{};
            const siteId=str(raw.siteId);
            if(!await recordAccess(ctx,'MFG.view',siteId))
                throw new HttpError(403,'Routing review is outside your authorized production site.');
            const prepared=normalizeMaster('routings',{
                ...raw,id:str(raw.id)||'RTG-PREVIEW',
                name:str(raw.name)||'Routing preview',
                routingModelVersion:2,
            });
            return reviewManufacturingRouting(ctx,prepared);
        }),
    ],
    'POST /api/org/pln-mfg/foundation/sku/process-classify':[
        orgRoute('org.mfg.sku.process.classify','MFG.master.edit',async ctx=>{
            // Controlled classification-only update of an existing organization SKU.
            // This does NOT replace its ID, BOM, physical attributes, site mapping
            // or production capacity record. No production/stock posting occurs.
            if(ctx.role!=='org_super_admin'&&
                (!hasPerm(ctx.directPermissions,'MFG.master.edit')||
                 !hasPerm(ctx.directPermissions,'MFG.sku.configure')))
                throw new HttpError(403,'Direct manufacturing master and SKU configuration permissions are required.');
            if(!await recordAccess(ctx,'MFG.master.edit',''))
                throw new HttpError(403,'Organization SKU classification is outside your authorized scope.');
            const skuId=VALID_ID(ctx.body.skuId,'SKU code');
            const processClassId=VALID_ID(ctx.body.processClassId,'Manufacturing process classification');
            const [doc,group]=await Promise.all([
                getDoc(DOC(ctx.orgId,'items',skuId)),
                getDoc('organizations/'+ctx.orgId+'/mfg_sku_parameters/'+processClassId),
            ]);
            if(!doc||!['FINISHED','INTERMEDIATE'].includes(str(doc.data.category)))
                throw new HttpError(404,'Manufactured SKU was not found.');
            if(!group||str(group.data.kind)!=='processClasses'||group.data.enabled===false)
                throw new HttpError(400,'Choose an active manufacturing process classification from Product Configuration.');
            if(str(doc.data.status)==='pending_approval')
                throw new HttpError(409,'A submitted SKU cannot be reclassified while its approval is pending.');
            if(Number(ctx.body.expectedRevision)!==(num(doc.data.revision)??1))
                throw new HttpError(409,'The SKU changed. Refresh it before reclassifying.');
            const before=str(doc.data.processClassId);
            if(before===processClassId)return {ok:true,record:out(doc)};
            const linked=await listDocs(ROOT(ctx.orgId,'routings'));
            if(linked.some(route=>
                ['active','pending_approval'].includes(str(route.data.status))&&
                routingSkuIds(route.data).includes(skuId)&&
                !!str(route.data.processClassId)&&str(route.data.processClassId)!==processClassId))
                throw new HttpError(409,'An active or submitted routing for this SKU uses another process classification. Update the route through its approved revision workflow first.');
            const at=nowIso(),data={...doc.data,processClassId,
                revision:(num(doc.data.revision)??1)+1,updatedAt:at,updatedBy:ctx.uid};
            if(!await commitChecked([{path:DOC(ctx.orgId,'items',skuId),
                data,precondition:{updateTime:doc.updateTime}}]))
                throw new HttpError(409,'The SKU was changed concurrently. Reload it before reclassifying.');
            await audit([{category:'data',action:'mfg.sku.process.classify',actor:ctx.actor,
                meta:ctx.meta,orgId:ctx.orgId,target:{label:'items:'+skuId},
                details:'Classification metadata only: '+(before||'unclassified')+' → '+processClassId+
                    '; SKU identity, BOM and site/resource mapping preserved.'}]);
            return {ok:true,record:out({id:skuId,data})};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/capacity-overview':[
        orgRoute('org.mfg.routing.capacity.overview','MFG.view',async ctx=>{
            const siteId=str(ctx.body.siteId);
            const requestedOffset=Number(ctx.body.offset??0),requestedLimit=Number(ctx.body.limit??6);
            if(!Number.isSafeInteger(requestedOffset)||requestedOffset<0||
               !Number.isSafeInteger(requestedLimit)||requestedLimit<1||requestedLimit>10)
                throw new HttpError(400,'Choose a valid capacity analysis page and page size (maximum 10).');
            if(siteId&&!await recordAccess(ctx,'MFG.view',siteId))
                throw new HttpError(403,'This production site is outside your authorized scope.');
            const docs=await listDocs(ROOT(ctx.orgId,'routings'));
            const accessible=[];
            for(const doc of docs){
                if(['deleted','removed'].includes(str(doc.data.status)))continue;
                if(siteId&&str(doc.data.siteId)!==siteId)continue;
                if(!await recordAccess(ctx,'MFG.view',str(doc.data.siteId)))continue;
                accessible.push(doc);
            }
            accessible.sort((a,b)=>str(a.data.name).localeCompare(str(b.data.name))||
                a.id.localeCompare(b.id));
            const page=accessible.slice(requestedOffset,requestedOffset+requestedLimit);
            const flows=[];
            for(const doc of page){
                const result=await reviewManufacturingRouting(ctx,doc.data);
                let skuReviews=Array.isArray(result.skuReviews)?result.skuReviews:[];
                if(!skuReviews.length){
                    // Draft stage analysis is still useful before allocating
                    // the first SKU, but it must never be represented as approved.
                    const stages=ARR(doc.data.operations);
                    const prelim=analyzeFlowCapacity(stages.map(stage=>({
                        code:str(stage.code),name:str(stage.name),
                        dependsOn:Array.isArray(stage.dependsOn)?stage.dependsOn.map(str):[],
                        ratePerHour:str(stage.capacityBasis)==='CONTINUOUS_FLOW'?
                            num(stage.flowRatePerHour)??0:
                            str(stage.capacityBasis)==='BATCH_CYCLE'&&num(stage.cycleMinutes)?
                                (num(stage.batchSize)??0)*60/(num(stage.cycleMinutes)??1):0,
                        unitCode:str(stage.flowRateUom),
                        bufferAvailable:stage.flowBufferAvailable===null||stage.flowBufferAvailable===undefined?
                            undefined:num(stage.flowBufferAvailable)??undefined,
                        inputFactor:num(stage.flowInputFactor)??1,
                    })),PROCUREMENT_UNITS);
                    skuReviews=[{skuId:'',ready:false,issues:result.issues,
                        stages:[],bottlenecks:[],flowAnalysis:prelim}];
                }
                flows.push({
                    id:doc.id,name:str(doc.data.name),siteId:str(doc.data.siteId),
                    processClassId:str(doc.data.processClassId),
                    alternativeCode:str(doc.data.alternativeCode),status:str(doc.data.status),
                    revision:num(doc.data.revision)??1,
                    mappedSkus:routingSkuIds(doc.data),
                    skuReviews:skuReviews.map(variant=>({
                        skuId:variant.skuId,ready:variant.ready,issueCount:variant.issues.length,
                        flowAnalysis:variant.flowAnalysis,
                        stages:variant.stages.map(stage=>({
                            code:stage.code,name:stage.name,dependsOn:stage.dependsOn,
                            capacity:stage.capacity,
                        })),
                    })),
                });
            }
            return {total:accessible.length,offset:requestedOffset,limit:requestedLimit,
                hasMore:requestedOffset+page.length<accessible.length,flows};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/list':[
        orgRoute('org.mfg.foundation.list','MFG.view',async ctx=>{
            const kind=readKind(ctx.body.kind);
            const records=await listDocs(ROOT(ctx.orgId,kind));
            const visible=[];
            for(const record of records){
                if(kind==='resources'&&str(record.data.status)==='removed')continue;
                // Site tags on legacy SKUs must not hide them from authorized users at other sites.
                const siteId=kind==='items'?'':str(record.data.siteId);
                if(await recordAccess(ctx,'MFG.view',siteId))visible.push(out(record));
            }
            return {kind,records:visible};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/save':[
        orgRoute('org.mfg.foundation.save','MFG.master.edit',async ctx=>{
            const kind=readKind(ctx.body.kind);
            if(kind==='resources')throw new HttpError(409,
                'Manufacturing resources are configured through Production Planning → Manufacturing Resources. Choose a Production cost centre and configure only core information; use SKU allocation for each commissioned speed.');
            if(kind==='boms'&&!hasPerm(ctx.permissions,'MFG.bom.edit')&&ctx.role!=='org_super_admin')
                throw new HttpError(403,'BOM editing permission required.');
            if(kind==='routings'&&!hasPerm(ctx.permissions,'MFG.routing.edit')&&ctx.role!=='org_super_admin')
                throw new HttpError(403,'Routing editing permission required.');
            const raw=isObj(ctx.body.record)?{...ctx.body.record}:{};
            if(kind==='items'){
                // A SKU is an organization master; production-site mappings remain
                // exclusively in the shared manufacturing resource allocation.
                raw.siteId='';
                if(!str(raw.family).trim())throw new HttpError(400,'Product family is required.');
            }
            if(kind==='routings'&&!str(raw.alternativeCode).trim())
                throw new HttpError(400,'Enter an alternative route code, such as STANDARD or an organization-defined method. The field can be cleared and edited before saving.');
            if(kind==='boms'){
                // Canonical BOMs do not persist old category selectors.
                delete raw.type;delete raw.flavorVariantId;
            }
            const requestedId=str(raw.id).trim(),creating=!requestedId;
            if(creating&&Number(ctx.body.expectedRevision)!==0)
                throw new HttpError(409,'New master data starts with revision zero.');
            const old=creating?null:await getDoc(DOC(ctx.orgId,kind,VALID_ID(requestedId,'Master code')));
            if(kind==='routings'&&creating&&!str(raw.processClassId))
                throw new HttpError(400,'Select a manufacturing process classification before creating a routing. Create process groups in Product Configuration.');
            if(kind==='items'&&creating&&['FINISHED','INTERMEDIATE'].includes(str(raw.category))&&
                !str(raw.processClassId)){
                const configured=await skuParametersForOrg(ctx.orgId);
                if(configured.some(x=>x.kind==='processClasses'&&x.enabled!==false))
                    throw new HttpError(400,'Select the manufacturing process classification for this SKU. Configure it in Product Configuration.');
            }
            if(!creating&&!old)
                throw new HttpError(404,'The master code is generated by MEMS. Create a new record without entering a code.');
            if(old&&['pending_approval','active'].includes(str(old.data.status)))
                throw new HttpError(409,'Submitted or activated masters cannot be edited in place. Copy to a new managed version.');
            if(old&&Number(ctx.body.expectedRevision)!==(num(old.data.revision)??1))
                throw new HttpError(409,'This record has changed. Refresh to get the latest revision.');
            if(kind==='items'){
                if(str(raw.category)==='INTERMEDIATE'&&!str(raw.stockPolicy))
                    raw.stockPolicy=(await mfgMaterialPolicyForOrg(ctx.orgId)).policy.defaultIntermediateTracking;
                // Naming snapshots are server-authored: never trust a client-provided
                // revision, generated name or rule for a manufacturing master.
                const applySkuNamingSequence=raw.applySkuNamingSequence===true;
                delete raw.skuNamingSnapshot;
                delete raw.applySkuNamingSequence;
                const category=str(raw.category);
                const supplied=isObj(raw.skuComponents)?raw.skuComponents:{};
                if(category==='FINISHED'||Object.values(supplied).some(Boolean)){
                    const configured=await skuParametersForOrg(ctx.orgId);
                    if(!configured.length)throw new HttpError(409,'Configure SKU master parameters before creating finished goods.');
                    const selected:SkuComponents={
                        ...(supplied.containmentScope!==undefined?{containmentScope:str(supplied.containmentScope) as SkuComponents['containmentScope']}:{}),
                        ...(supplied.requiresCommercialPackaging!==undefined
                            ?{requiresCommercialPackaging:supplied.requiresCommercialPackaging as boolean}:{}),
                        ...(supplied.requiresTransportPackaging!==undefined
                            ?{requiresTransportPackaging:supplied.requiresTransportPackaging as boolean}:{}),
                        productNameId:str(supplied.productNameId),productionFormId:str(supplied.productionFormId),
                        containerId:str(supplied.containerId),containerSizeId:str(supplied.containerSizeId),
                        // SKU-specific physical capacity is explicit, not a form default.
                        ...(supplied.containerCapacityQuantity!==undefined
                            ?{containerCapacityQuantity:supplied.containerCapacityQuantity as number}:{}),
                        ...(supplied.containerCapacityUom!==undefined
                            ?{containerCapacityUom:str(supplied.containerCapacityUom)}:{}),
                        packageId:str(supplied.packageId),packagingSizeId:str(supplied.packagingSizeId),
                        packageCountId:str(supplied.packageCountId), // existing SKU compatibility
                        transportPackageId:str(supplied.transportPackageId),
                        transportLayeringEnabled:supplied.transportLayeringEnabled===true,
                        transportPackagesPerLayer:typeof supplied.transportPackagesPerLayer==='number'
                            ?supplied.transportPackagesPerLayer:undefined,
                        transportLayerCount:typeof supplied.transportLayerCount==='number'
                            ?supplied.transportLayerCount:undefined,
                        transportUnitsPerLoad:typeof supplied.transportUnitsPerLoad==='number'
                            ?supplied.transportUnitsPerLoad:undefined,
                        normalizationUnitId:str(supplied.normalizationUnitId),
                    };
                    const result=calculateSkuConversion(selected,configured,{
                        requireProductName:category!=='INTERMEDIATE',
                    });
                    const physicalPackage=configured.find(p=>p.id===selected.packageId);
                    const naming=await namingSequenceForOrg(ctx.orgId);
                    raw.skuComponents=selected;
                    raw.skuConversion=result;
                    if(category==='INTERMEDIATE'){
                        // Intermediate bulk/process outputs keep their user-entered identity;
                        // container configuration must never silently rename WIP masters.
                        raw.skuNamingSnapshot=old&&isObj(old.data.skuNamingSnapshot)
                            ?old.data.skuNamingSnapshot:{};
                    }else if(naming.configured&&(creating||applySkuNamingSequence)){
                        raw.name=composeSkuNameWithSequence(selected,configured,naming.sequence,result);
                        raw.skuNamingSnapshot={revision:naming.revision,sequence:naming.sequence,
                            generatedName:raw.name,generatedAt:nowIso()};
                    }else if(!creating&&old){
                        // Existing SKU names are stable until explicitly regenerated.
                        raw.name=str(old.data.name)||composeConfiguredSkuName(selected,configured);
                        raw.skuNamingSnapshot=isObj(old.data.skuNamingSnapshot)?old.data.skuNamingSnapshot:{};
                    }else{
                        // Existing names are stable until an explicit naming update.
                        raw.name=composeConfiguredSkuName(selected,configured);
                    }
                    raw.uom=physicalPackage?.uom||result.productionUom;
                    raw.packQty=result.containersPerPackage??1;
                }else if(creating&&category==='FINISHED'){
                    throw new HttpError(400,'Finished goods must be composed using the approved SKU configuration parameters.');
                }
            }
            if(kind==='routings'){
                const operations=ARR(raw.operations);
                const oldCodes=operations.map(o=>str(o.code));
                if(new Set(oldCodes).size!==oldCodes.length)
                    throw new HttpError(400,'Routing stages must have distinct identifiers.');
                const lookup=new Map(oldCodes.map((code,i)=>[code,'STG_'+String(i+1).padStart(9,'0')]));
                raw.operations=operations.map((o,i)=>({
                    ...o,code:'STG_'+String(i+1).padStart(9,'0'),
                    dependsOn:(Array.isArray(o.dependsOn)?o.dependsOn.map(str):(i>0?[oldCodes[i-1]]:[]))
                        .map(dep=>lookup.get(dep)||dep),
                }));
                // Stage codes are canonicalized on save. SKU-specific BOM/output
                // overrides must follow exactly the same renumbering to remain attached
                // to the correct process step after stages are inserted or moved.
                raw.skuMappings=ARR(raw.skuMappings).map(mapping=>({
                    ...mapping,stages:ARR(mapping.stages).map(stage=>({
                        ...stage,code:lookup.get(str(stage.code))||str(stage.code),
                    })),
                }));
            }
            const requiredPermission=kind==='boms'?'MFG.bom.edit':kind==='routings'?'MFG.routing.edit':'MFG.master.edit';
            const scopeSite=str(raw.siteId);
            if(!await recordAccess(ctx,'MFG.master.edit',scopeSite) ||
                !await recordAccess(ctx,requiredPermission,scopeSite) ||
                (old&&(!await recordAccess(ctx,'MFG.master.edit',str(old.data.siteId)) ||
                    !await recordAccess(ctx,requiredPermission,str(old.data.siteId)))))
                throw new HttpError(403,'This master is outside your authorized site or organization scope.');
            const makeData=async(id:string)=>{
                if(kind==='boms'&&!str(raw.name).trim()){
                    const produced=await getDoc(DOC(ctx.orgId,'items',str(raw.parentSkuId)));
                    if(!produced)throw new HttpError(400,'Select an existing output material before saving the BOM.');
                    raw.name=(str(produced.data.name)||str(raw.parentSkuId)).slice(0,150)+' · BOM';
                }
                const item=normalizeMaster(kind,{...raw,id});
                await referenceChecks(ctx,kind,item,id);
                const now=nowIso(),revision=old?(num(old.data.revision)??1)+1:1;
                return {...item,status:'draft',revision,
                    createdAt:old?str(old.data.createdAt)||now:now,
                    createdBy:old?str(old.data.createdBy)||ctx.uid:ctx.uid,
                    updatedAt:now,updatedBy:ctx.uid};
            };
            if(creating){
                const prefix=masterPrefix(kind);
                const created=await commitGeneratedCode(ctx.orgId,prefix,
                    id=>DOC(ctx.orgId,kind,id),makeData,{snapshotSubcollection:'revisions'});
                await track(ctx,'mfg.master.create',kind+':'+created.id);
                return {record:created.data,ok:true,generatedCode:created.id};
            }
            const id=requestedId,path=DOC(ctx.orgId,kind,id),data=await makeData(id);
            const revision=num(data.revision)??1;
            const saved=await commitChecked([
                {path,data,precondition:{updateTime:old!.updateTime}},
                {path:path+'/revisions/'+String(revision).padStart(6,'0'),
                    data:{...data,masterId:id,versionSnapshot:true},precondition:{exists:false}},
            ]);
            if(!saved)throw new HttpError(409,'This record changed before saving. Refresh and retry.');
            await track(ctx,'mfg.master.save',kind+':'+id);
            return {record:data,ok:true};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/history':[
        orgRoute('org.mfg.foundation.history','MFG.view',async ctx=>{
            const kind=readKind(ctx.body.kind),id=VALID_ID(ctx.body.id,'Master code');
            const master=await getDoc(DOC(ctx.orgId,kind,id));
            if(!master)throw new HttpError(404,'Master record not found.');
            if(!await recordAccess(ctx,'MFG.view',kind==='items'?'':str(master.data.siteId)))
                throw new HttpError(403,'This record is outside your authorized scope.');
            const revisions=await listDocs(DOC(ctx.orgId,kind,id)+'/revisions');
            return {revisions:revisions.map(out).sort((a,b)=>Number(a.revision)-Number(b.revision))};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/material-policy':[
        orgRoute('org.mfg.material.policy.view','MFG.view',async ctx=>
            mfgMaterialPolicyForOrg(ctx.orgId)),
    ],
    'POST /api/org/pln-mfg/foundation/material-policy/save':[
        orgRoute('org.mfg.material.policy.save','MFG.sku.configure',async ctx=>{
            if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'MFG.sku.configure'))
                throw new HttpError(403,'Organization-wide material handling policy requires a direct Manufacturing configuration permission.');
            const policy=normalizeMfgMaterialPolicy(ctx.body.policy);
            const used=(await listDocs(ROOT(ctx.orgId,'boms')))
                .filter(r=>!!str(r.data.classificationCode)).map(r=>bomClassificationCode(r.data));
            if(used.some(code=>!policy.bomClassifications.some(c=>c.code===code)))
                throw new HttpError(409,'A used BOM classification cannot be deleted; disable it.');
            const path=mfgMaterialPolicyPath(ctx.orgId),old=await getDoc(path);
            const version=num(old?.data.revision)??0;
            if(Number(ctx.body.expectedRevision)!==version)
                throw new HttpError(409,'Material handling setup changed. Refresh before saving.');
            const now=nowIso(),revision=version+1;
            const updated={policy,revision,updatedAt:now,updatedBy:ctx.uid};
            if(!await writeDoc(path,updated,old?{updateTime:old.updateTime}:{exists:false}))
                throw new HttpError(409,'Concurrent material handling setup update. Reload.');
            await track(ctx,'mfg.material.policy.save','material-policy:'+revision);
            return {policy,revision};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/config':[
        orgRoute('org.pln.foundation.config.view','PLN.view',async ctx=>{
            const doc=await getDoc('organizations/'+ctx.orgId+'/pln_config/master');
            const stored=doc?.data??{};
            return {config:{horizonDays:90,freezeDays:7,lotPolicy:'LOT_FOR_LOT',strategy:'MTS',...stored,
                formDefaults:normalizePlanningFormDefaults(stored.formDefaults)},revision:num(doc?.data.revision)??0,
                formDefaultsRevision:num(stored.formDefaultsRevision)??0};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/form-defaults/save':[
        orgRoute('org.pln.form.defaults.save','PLN.configure',async ctx=>{
            if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'PLN.configure'))
                throw new HttpError(403,'Organization-wide form defaults require direct Planning configuration permission.');
            const formDefaults=normalizePlanningFormDefaults(ctx.body.formDefaults);
            if(formDefaults.defaultSiteId){
                const site=await getNode(ctx,formDefaults.defaultSiteId);
                if(str(site.data.level)!=='site'||str(site.data.status)==='inactive')
                    throw new HttpError(400,'The default site must be an active site in this organization.');
            }
            const path='organizations/'+ctx.orgId+'/pln_config/master';
            const previous=await getDoc(path);
            const currentRevision=num(previous?.data.formDefaultsRevision)??0;
            if(Number(ctx.body.expectedRevision)!==currentRevision)
                throw new HttpError(409,'Form defaults changed. Refresh before saving again.');
            const revision=currentRevision+1;
            const updated={...(previous?.data??{}),formDefaults,formDefaultsRevision:revision,
                updatedAt:nowIso(),updatedBy:ctx.uid};
            if(!await writeDoc(path,updated,previous?{updateTime:previous.updateTime}:{exists:false}))
                throw new HttpError(409,'Concurrent form-default update. Reload before saving.');
            await track(ctx,'pln.form.defaults.save','PLN form defaults revision '+revision);
            return {formDefaults,revision};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/config/save':[
        orgRoute('org.pln.foundation.config.save','PLN.configure',async ctx=>{
            if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'PLN.configure'))
                throw new HttpError(403,'Organization-wide planning configuration requires a direct administration permission.');
            const raw=isObj(ctx.body.config)?ctx.body.config:{};
            const horizonDays=POSITIVE(raw.horizonDays,'Horizon days'),freezeDays=NONNEGATIVE(raw.freezeDays,'Freeze days',3650);
            if(horizonDays>3650||freezeDays>horizonDays)throw new HttpError(400,'Freeze period must fit within the planning horizon.');
            const lotPolicy=ENUM(raw.lotPolicy,['LOT_FOR_LOT','FIXED','MIN_MAX','PERIOD','OPTIMIZED'] as const,'lot sizing rule');
            const strategy=ENUM(raw.strategy,['MTS','MTO','ATO','ETO','HYBRID'] as const,'production strategy');
            const path='organizations/'+ctx.orgId+'/pln_config/master';
            const prev=await getDoc(path),old=num(prev?.data.revision)??0;
            if(Number(ctx.body.expectedRevision)!==old)throw new HttpError(409,'Configuration changed. Reload and retry.');
            // Planning rule saves must never revert newer form-default settings.
            const formDefaults=normalizePlanningFormDefaults(prev?.data.formDefaults??raw.formDefaults);
            const formDefaultsRevision=num(prev?.data.formDefaultsRevision)??0;
            if(formDefaults.defaultSiteId){
                const site=await getNode(ctx,formDefaults.defaultSiteId);
                if(str(site.data.level)!=='site'||str(site.data.status)==='inactive')
                    throw new HttpError(400,'Default planning site must be an active site in this organization.');
            }
            const config={horizonDays,freezeDays,lotPolicy,strategy,formDefaults,formDefaultsRevision,revision:old+1,updatedAt:nowIso(),updatedBy:ctx.uid};
            const ok=await writeDoc(path,config,prev?{updateTime:prev.updateTime}:{exists:false});
            if(!ok)throw new HttpError(409,'Concurrent planning configuration update detected.');
            await track(ctx,'pln.config.save','PLN planning configuration');
            return {config,revision:old+1};
        }),
    ],
};
