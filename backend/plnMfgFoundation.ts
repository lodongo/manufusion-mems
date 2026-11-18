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
import { calculateSkuConversion, composeConfiguredSkuName, composeSkuNameWithSequence, masterPrefix, type SkuComponents } from './mfgSkuModel';
import { commitGeneratedCode, skuParametersForOrg, namingSequenceForOrg } from './mfgSkuConfiguration';

export const MASTER_KINDS = ['items', 'boms', 'resources', 'routings'] as const;
export type MasterKind = typeof MASTER_KINDS[number];
const COLLECTION: Record<MasterKind,string> = {
    items: 'mfg_items', boms: 'mfg_boms', resources: 'mfg_resources', routings: 'mfg_routings',
};
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,59}$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,59}$/;
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
const BOM_TYPES=['BOM','RECIPE'] as const;

/** Validation is shared with executable tests; rejects malformed graphs before persistence. */
export function normalizeMaster(kind:MasterKind, raw:unknown): Obj {
    if(!isObj(raw))throw new HttpError(400,'A master-data object is required.');
    const id=VALID_ID(raw.id,'Master code'), name=REQUIRED(raw.name,'Name',160);
    const siteId=str(raw.siteId).trim();
    if(siteId&&!ID.test(siteId))throw new HttpError(400,'Invalid site code.');
    const base:Obj={id,name,siteId,description:str(raw.description).slice(0,600)};
    if(kind==='items'){
        const category=ENUM(raw.category,STAGES,'item category');
        const inventoryMaterialId=str(raw.inventoryMaterialId).trim();
        if(inventoryMaterialId&&!ID.test(inventoryMaterialId))throw new HttpError(400,'Invalid Inventory material reference.');
        if((category==='RAW'||category==='PACKAGING')&& !inventoryMaterialId)throw new HttpError(400,'Raw and packaging materials must refer to the existing Inventory material master. Fictional demo materials remain read-only.');
        return {...base,category,family:str(raw.family).slice(0,100),uom:UOM(raw.uom),inventoryMaterialId,packQty:POSITIVE(raw.packQty??1,'Pack quantity'),skuComponents:isObj(raw.skuComponents)?raw.skuComponents:{},skuConversion:isObj(raw.skuConversion)?raw.skuConversion:{},skuNamingSnapshot:isObj(raw.skuNamingSnapshot)?raw.skuNamingSnapshot:{}};
    }
    if(kind==='resources'){
        return {...base,type:ENUM(raw.type,RESOURCE_TYPES,'resource type'),rate:POSITIVE(raw.rate,'Rated units per hour'),rateUom:UOM(raw.rateUom),assetId:str(raw.assetId).slice(0,60),efficiency:NONNEGATIVE(raw.efficiency??100,'Efficiency percentage',100)};
    }
    if(kind==='boms'){
        const type=ENUM(raw.type,BOM_TYPES,'BOM/recipe type');
        const parentSkuId=VALID_ID(raw.parentSkuId,'Parent SKU');
        const components=ARR(raw.components);
        if(!components.length||components.length>150)throw new HttpError(400,'A BOM/recipe must have 1–150 components.');
        const seen=new Set<string>();
        const lines=components.map((c,i)=>{
            const skuId=VALID_ID(c.skuId,'Component SKU');
            if(skuId===parentSkuId)throw new HttpError(400,'A SKU cannot consume itself.');
            if(seen.has(skuId))throw new HttpError(400,'Duplicate component SKU '+skuId+'. Combine quantities in one line.');
            seen.add(skuId);
            return {line:i+1,skuId,quantity:POSITIVE(c.quantity,'Component quantity'),uom:UOM(c.uom),scrapPct:NONNEGATIVE(c.scrapPct??0,'Scrap percentage',100)};
        });
        return {...base,type,parentSkuId,outputQty:POSITIVE(raw.outputQty??1,'Output basis'),outputUom:UOM(raw.outputUom),components:lines as unknown as Plain,effectiveFrom:effectiveDate(raw.effectiveFrom),versionNote:str(raw.versionNote).slice(0,300)};
    }
    const skuId=VALID_ID(raw.skuId,'Routed SKU');
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
        return {code,sequence:i+1,name:REQUIRED(o.name,'Operation name',120),resourceId:VALID_ID(o.resourceId,'Resource code'),producesSkuId,dependsOn,setupMinutes:NONNEGATIVE(o.setupMinutes??0,'Setup minutes',100000),runMinutesPerUnit:NONNEGATIVE(o.runMinutesPerUnit??0,'Minutes per output unit',100000)};
    });
    return {...base,skuId,operations:steps as unknown as Plain,effectiveFrom:str(raw.effectiveFrom).slice(0,10)};
}

export function detectBomCycle(boms:Array<{parentSkuId:string;components:Array<{skuId:string}>}>,parentSkuId:string,components:Array<{skuId:string}>):boolean {
    const byParent=new Map(boms.map(b=>[b.parentSkuId,b.components.map(c=>c.skuId)]));
    byParent.set(parentSkuId,components.map(c=>c.skuId));
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
        const materialId=str(item.inventoryMaterialId);
        if(materialId){
            const material=await getDoc('organizations/'+ctx.orgId+'/materials/'+materialId);
            if(!material||!['approved','active'].includes(str(material.data.status))||!str(material.data.materialNumber))
                throw new HttpError(400,'Choose an approved, numbered Inventory material from the existing Material Master.');
            const inventoryUom=str(material.data.uom);
            if(inventoryUom && inventoryUom.toUpperCase()!==str(item.uom).toUpperCase())
                throw new HttpError(400,'SKU unit '+str(item.uom)+' must match Inventory material unit '+inventoryUom+' (unit conversions are not yet configured).');
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
        const parent=await getDoc(DOC(ctx.orgId,'items',str(item.parentSkuId)));
        if(!parent)throw new HttpError(400,'Parent SKU does not exist in Manufacturing master data.');
        if(['RAW','PACKAGING'].includes(str(parent.data.category)))throw new HttpError(400,'Inventory-owned raw and packaging materials cannot be produced as manufacturing outputs.');
        if(str(parent.data.uom).toUpperCase()!==str(item.outputUom).toUpperCase())
            throw new HttpError(400,'BOM output unit must match the parent SKU unit.');
        if(str(parent.data.siteId)&&str(parent.data.siteId)!==str(item.siteId))
            throw new HttpError(400,'BOM output belongs to another production site.');
        const components=ARR(item.components);
        for(const component of components){
            const child=await getDoc(DOC(ctx.orgId,'items',str(component.skuId)));
            if(!child)throw new HttpError(400,'Component '+str(component.skuId)+' is missing from SKU master.');
            if(str(child.data.uom).toUpperCase()!==str(component.uom).toUpperCase())
                throw new HttpError(400,'Component '+str(component.skuId)+' unit does not match its SKU master.');
            if(str(child.data.siteId)&&str(child.data.siteId)!==str(item.siteId))
                throw new HttpError(400,'Component '+str(component.skuId)+' belongs to another production site.');
        }
        const others=(await listDocs(ROOT(ctx.orgId,'boms')))
            .filter(d=>d.id!==existingId)
            .map(d=>({parentSkuId:str(d.data.parentSkuId),components:ARR(d.data.components).map(c=>({skuId:str(c.skuId)}))}));
        if(detectBomCycle(others,str(item.parentSkuId),components.map(c=>({skuId:str(c.skuId)}))))
            throw new HttpError(400,'The BOM introduces a circular manufacturing dependency.');
    }
    if(kind==='routings'){
        const routed=await getDoc(DOC(ctx.orgId,'items',str(item.skuId)));
        if(!routed)throw new HttpError(400,'Routing SKU not found.');
        if(str(routed.data.siteId)&&str(routed.data.siteId)!==str(item.siteId))
            throw new HttpError(400,'Routing SKU is assigned to another site.');
        for(const o of ARR(item.operations)){
            const resource=await getDoc(DOC(ctx.orgId,'resources',str(o.resourceId)));
            if(!resource)throw new HttpError(400,'Routing resource '+str(o.resourceId)+' not found.');
            if(str(resource.data.siteId)&&str(resource.data.siteId)!==str(item.siteId))
                throw new HttpError(400,'Routing resource '+str(o.resourceId)+' is assigned to another site.');
            if(str(o.producesSkuId)){
                const product=await getDoc(DOC(ctx.orgId,'items',str(o.producesSkuId)));
                if(!product||['RAW','PACKAGING'].includes(str(product.data.category)))
                    throw new HttpError(400,'Stage output must be a manufactured SKU or intermediate product.');
                if(str(product.data.siteId)&&str(product.data.siteId)!==str(item.siteId))
                    throw new HttpError(400,'Stage output '+str(o.producesSkuId)+' belongs to another site.');
            }
        }
    }
}

const track=(ctx:OrgContext,action:string,target:string)=>
    audit([{category:'data',action,actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:target},details:'Production master data; approval and release remain separate from draft editing.'}]);
const out=(d:{id:string;data:Obj;updateTime?:string})=>({id:d.id,...d.data,updatedAt:str(d.data.updatedAt),revision:num(d.data.revision)??1});
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
            const [materials,assets,structure]=await Promise.all([
                listDocs(orgRoot+'/materials'),listDocs(orgRoot+'/assets'),listDocs(orgRoot+'/structure'),
            ]);
            const sites=[];
            for(const site of structure.filter(x=>str(x.data.level)==='site'&&str(x.data.status)!=='inactive')){
                if(await recordAccess(ctx,'MFG.view',site.id))
                    sites.push({id:site.id,name:str(site.data.name)||site.id,code:str(site.data.code)});
            }
            const visibleSites=new Set(sites.map(x=>x.id));
            return {
                sites,
                materials:materials.filter(x=>['approved','active'].includes(str(x.data.status))&&str(x.data.materialNumber))
                    .map(x=>({id:x.id,name:str(x.data.shortText)||str(x.data.name)||x.id,
                        materialNumber:str(x.data.materialNumber),uom:str(x.data.uom)})),
                assets:assets.filter(x=>str(x.data.status)==='active'&&
                    (!str(x.data.siteId)||visibleSites.has(str(x.data.siteId))))
                    .map(x=>({id:x.id,name:str(x.data.name)||x.id,siteId:str(x.data.siteId)})),
            };
        }),
    ],
    'POST /api/org/pln-mfg/foundation/list':[
        orgRoute('org.mfg.foundation.list','MFG.view',async ctx=>{
            const kind=readKind(ctx.body.kind);
            const records=await listDocs(ROOT(ctx.orgId,kind));
            const visible=[];
            for(const record of records){
                const siteId=str(record.data.siteId);
                if(await recordAccess(ctx,'MFG.view',siteId))visible.push(out(record));
            }
            return {kind,records:visible};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/save':[
        orgRoute('org.mfg.foundation.save','MFG.master.edit',async ctx=>{
            const kind=readKind(ctx.body.kind);
            if(kind==='boms'&&!hasPerm(ctx.permissions,'MFG.bom.edit')&&ctx.role!=='org_super_admin')
                throw new HttpError(403,'BOM and recipe editing permission required.');
            if(kind==='routings'&&!hasPerm(ctx.permissions,'MFG.routing.edit')&&ctx.role!=='org_super_admin')
                throw new HttpError(403,'Routing editing permission required.');
            const raw=isObj(ctx.body.record)?{...ctx.body.record}:{};
            const requestedId=str(raw.id).trim(),creating=!requestedId;
            if(creating&&Number(ctx.body.expectedRevision)!==0)
                throw new HttpError(409,'New master data starts with revision zero.');
            const old=creating?null:await getDoc(DOC(ctx.orgId,kind,VALID_ID(requestedId,'Master code')));
            if(!creating&&!old)
                throw new HttpError(404,'The master code is generated by MEMS. Create a new record without entering a code.');
            if(old&&['pending_approval','active'].includes(str(old.data.status)))
                throw new HttpError(409,'Submitted or activated masters cannot be edited in place. Copy to a new managed version.');
            if(old&&Number(ctx.body.expectedRevision)!==(num(old.data.revision)??1))
                throw new HttpError(409,'This record has changed. Refresh to get the latest revision.');
            if(kind==='items'){
                const category=str(raw.category);
                const supplied=isObj(raw.skuComponents)?raw.skuComponents:{};
                if(category==='FINISHED'||Object.values(supplied).some(Boolean)){
                    const configured=await skuParametersForOrg(ctx.orgId);
                    if(!configured.length)throw new HttpError(409,'Configure SKU master parameters before creating finished goods.');
                    const selected:SkuComponents={
                        productNameId:str(supplied.productNameId),productionFormId:str(supplied.productionFormId),
                        containerId:str(supplied.containerId),containerSizeId:str(supplied.containerSizeId),
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
                    const result=calculateSkuConversion(selected,configured);
                    const physicalPackage=configured.find(p=>p.id===selected.packageId);
                    const naming=await namingSequenceForOrg(ctx.orgId);
                    raw.skuComponents=selected;
                    raw.skuConversion=result;
                    if(naming.configured&&(creating||raw.applySkuNamingSequence===true)){
                        raw.name=composeSkuNameWithSequence(selected,configured,naming.sequence,result);
                        raw.skuNamingSnapshot={revision:naming.revision,sequence:naming.sequence,
                            generatedName:raw.name,generatedAt:nowIso()};
                    }else if(!creating&&old){
                        // Existing SKU names are stable until explicitly regenerated.
                        raw.name=str(old.data.name)||composeConfiguredSkuName(selected,configured);
                        raw.skuNamingSnapshot=isObj(old.data.skuNamingSnapshot)?old.data.skuNamingSnapshot:{};
                    }else{
                        // Preserve legacy naming until the organization activates a sequence.
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
            }
            const requiredPermission=kind==='boms'?'MFG.bom.edit':kind==='routings'?'MFG.routing.edit':'MFG.master.edit';
            const scopeSite=str(raw.siteId);
            if(!await recordAccess(ctx,'MFG.master.edit',scopeSite) ||
                !await recordAccess(ctx,requiredPermission,scopeSite) ||
                (old&&(!await recordAccess(ctx,'MFG.master.edit',str(old.data.siteId)) ||
                    !await recordAccess(ctx,requiredPermission,str(old.data.siteId)))))
                throw new HttpError(403,'This master is outside your authorized site or organization scope.');
            const makeData=async(id:string)=>{
                const item=normalizeMaster(kind,{...raw,id});
                await referenceChecks(ctx,kind,item,id);
                const now=nowIso(),revision=old?(num(old.data.revision)??1)+1:1;
                return {...item,status:'draft',revision,
                    createdAt:old?str(old.data.createdAt)||now:now,
                    createdBy:old?str(old.data.createdBy)||ctx.uid:ctx.uid,
                    updatedAt:now,updatedBy:ctx.uid};
            };
            if(creating){
                const prefix=masterPrefix(kind,str(raw.type));
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
            if(!await recordAccess(ctx,'MFG.view',str(master.data.siteId)))throw new HttpError(403,'This record is outside your site scope.');
            const revisions=await listDocs(DOC(ctx.orgId,kind,id)+'/revisions');
            return {revisions:revisions.map(out).sort((a,b)=>Number(a.revision)-Number(b.revision))};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/config':[
        orgRoute('org.pln.foundation.config.view','PLN.view',async ctx=>{
            const doc=await getDoc('organizations/'+ctx.orgId+'/pln_config/master');
            return {config:doc?.data??{horizonDays:90,freezeDays:7,lotPolicy:'LOT_FOR_LOT',strategy:'MTS'},revision:num(doc?.data.revision)??0};
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
            const config={horizonDays,freezeDays,lotPolicy,strategy,revision:old+1,updatedAt:nowIso(),updatedBy:ctx.uid};
            const ok=await writeDoc(path,config,prev?{updateTime:prev.updateTime}:{exists:false});
            if(!ok)throw new HttpError(409,'Concurrent planning configuration update detected.');
            await track(ctx,'pln.config.save','PLN planning configuration');
            return {config,revision:old+1};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/demo':[
        orgRoute('org.mfg.foundation.demo','MFG.view',async ()=>fictionalLine11Demo()),
    ],
};
