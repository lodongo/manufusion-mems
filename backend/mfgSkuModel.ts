/**
 * Industry-neutral manufacturing SKU composition and conversion model.
 * Uses the existing MEMS Procurement unit registry (not a new parallel UoM master).
 * The normalization basis (e.g., L per unit case) belongs to the organization.
 */
import { HttpError, num, str } from './core';
import { PROCUREMENT_UNITS } from './procurementUnits';
import { validatePrimaryContainerSelection, type MfgPrimaryContainerType } from './mfgPrimaryContainerMetadata';
import {validatePackagingLayout, type MfgPackagingType} from './mfgPackagingMetadata';

export const SKU_PARAMETERS={
    productNames:'NME', productionForms:'FRM', containers:'CNT',
    containerSizes:'SIZ', packages:'PKG', transportPackages:'TLP', packagingSizes:'PSZ', 
    packageCounts:'PCT', // retained for existing organization records, hidden from new configuration
    normalizationUnits:'NRM',
} as const;
export type SkuParameterKind=keyof typeof SKU_PARAMETERS;
export const SKU_PARAMETER_KINDS=Object.keys(SKU_PARAMETERS) as SkuParameterKind[];
export type SkuParameter={id:string;kind:SkuParameterKind;name:string;
    uom?:string;quantity?:number;baseUom?:string;quantityPerUnit?:number;
    categoryCode?:string;unitCode?:string;unitCount?:number;
    productCode?:string;metadataCode?:string;subcategoryCode?:string;
    containerAttributes?:Record<string,string>;
    packagingTypeCode?:string;level?:string;containedUnit?:string;containedPackagingId?:string;
    containersPerLayer?:number;numberOfLayers?:number;
    enabled?:boolean;description?:string};
export type SkuComponents={
    productNameId?:string;productionFormId?:string;containerId?:string;
    containerSizeId?:string;packageId?:string;
    packagingSizeId?:string;packageCountId?:string; // legacy packageCountId read-only compatibility
    transportPackageId?:string;transportLayeringEnabled?:boolean;
    transportPackagesPerLayer?:number;transportLayerCount?:number;transportUnitsPerLoad?:number;
    normalizationUnitId?:string;
};
export type SkuConversion={
    productionUom:string;containerSizeInProductionUom:number|null;
    containersPerPackage:number|null;productionQtyPerPackage:number|null;
    normalizationUom:string;productionQtyPerNormalizationUnit:number|null;
    conversionFactor:number|null; // normalized units per one commercial package
    reverseConversionFactor:number|null; // commercial packages per normalized unit
    transportLayeringEnabled:boolean;
    commercialPackagesPerTransportUnit:number|null;primaryContainersPerTransportUnit:number|null;
    productionQtyPerTransportUnit:number|null;normalizationUnitsPerTransportUnit:number|null;
    selectedNames:Record<string,string>;
};

export function managedCode(prefix:string,sequence:number):string {
    if(!/^[A-Z]{3}$/.test(prefix)||!Number.isSafeInteger(sequence)||sequence<1||sequence>999999999)
        throw new HttpError(409,'The database-managed nine-digit code sequence is invalid or exhausted.');
    return prefix+'_'+String(sequence).padStart(9,'0');
}
export function masterPrefix(kind:'items'|'boms'|'resources'|'routings',type=''):string {
    return kind==='items'?'SKU':kind==='boms'?(type==='RECIPE'?'RCP':'BOM'):
        kind==='resources'?'RSC':'RTG';
}

/** Exact conversion between dimensional units using the published central MEMS registry. */
export function skuUnitConversion(from:string,to:string):number|null {
    if(!from||!to)return null;
    const pick=(code:string)=>{
        const units=PROCUREMENT_UNITS.filter(u=>u.active&&u.selectable);
        const exact=units.find(u=>u.code===code);
        const exactSymbol=units.filter(u=>u.symbol===code);
        if(exact)return exact;
        if(exactSymbol.length===1)return exactSymbol[0]; // g = gram, G can be a distinct dimensional symbol
        const matching=units.filter(u=>u.symbol.toLowerCase()===code.toLowerCase()||
            u.label.toLowerCase()===code.toLowerCase());
        return matching.length===1?matching[0]:null;
    };
    const a=pick(from),b=pick(to);
    if(!a||!b||a.baseUnit!==b.baseUnit||a.categoryCode!==b.categoryCode)return null;
    if(!Number.isFinite(a.multiplier)||a.multiplier<=0||!Number.isFinite(b.multiplier)||b.multiplier<=0)return null;
    return a.multiplier/b.multiplier;
}

/** Only units from the authoritative MEMS registry can be used as SKU dimensions. */
export function skuUnitCategories(){
    return [...new Map(PROCUREMENT_UNITS.filter(u=>u.active&&u.selectable)
        .map(u=>[u.categoryCode,{code:u.categoryCode,name:u.category}])).values()];
}
export function skuUnitsInCategory(categoryCode:string){
    return PROCUREMENT_UNITS.filter(u=>u.active&&u.selectable&&u.categoryCode===categoryCode);
}
export function skuUnitCategoryOf(code:string):string|null {
    const unit=PROCUREMENT_UNITS.find(u=>u.active&&u.selectable&&
        (u.code===code||u.symbol===code));
    return unit?.categoryCode??null;
}
export function countUnitTotal(unitCode:string,unitCount:number):number {
    const unit=PROCUREMENT_UNITS.find(u=>u.code===unitCode&&u.active&&u.selectable&&u.category==='Count');
    if(!unit)throw new HttpError(400,'Choose a Count unit from the MEMS unit registry.');
    if(!Number.isSafeInteger(unitCount)||unitCount<1)
        throw new HttpError(400,'Number of count units must be a positive whole number.');
    const total=unitCount*unit.multiplier;
    if(!Number.isSafeInteger(total)||total>10000000)
        throw new HttpError(400,'Total containers exceeds the supported whole-number range.');
    return total;
}

/** Count primary containers through a hierarchy such as bottle → case → pallet.
 * Layout quantities measure items of the declared immediate child level.
 * Cycles, missing and inactive child packaging prevent misleading totals.
 */
export function packagingPrimaryContainerCount(pack:SkuParameter,params:SkuParameter[],seen=new Set<string>()):number{
    if(pack.kind!=='packages'||pack.enabled===false)
        throw new HttpError(400,'Packaging record is not active.');
    if(seen.has(pack.id))throw new HttpError(400,'Circular packaging consolidation is not permitted.');
    const branch=new Set(seen);branch.add(pack.id);
    const total=Number(pack.quantity);
    if(!Number.isSafeInteger(total)||total<=0||total>10000000)
        throw new HttpError(400,'A packaging layout must have a valid container count.');
    if(pack.containedUnit!=='PACKAGING')return total;
    const child=params.find(p=>p.id===pack.containedPackagingId&&p.kind==='packages');
    if(!child)throw new HttpError(400,'Referenced lower-level packaging is missing.');
    const primary=total*packagingPrimaryContainerCount(child,params,branch);
    if(!Number.isSafeInteger(primary)||primary>100000000)
        throw new HttpError(400,'Consolidated primary container count exceeds the supported range.');
    return primary;
}

export function calculateSkuConversion(
    values:SkuComponents,
    params:SkuParameter[],
):SkuConversion {
    const byId=new Map(params.map(p=>[p.id,p]));
    const get=(kind:SkuParameterKind,id:string|undefined,required=false):SkuParameter|null=>{
        if(!id){if(required)throw new HttpError(400,'Select a configured '+kind+' parameter.');return null;}
        const found=byId.get(id);
        if(!found||found.kind!==kind||found.enabled===false)
            throw new HttpError(400,'Choose an active, configured '+kind+' value (not a free-text value).');
        return found;
    };
    const name=get('productNames',values.productNameId,true);
    const form=get('productionForms',values.productionFormId,true);
    const container=get('containers',values.containerId);
    const size=get('containerSizes',values.containerSizeId);
    const pack=get('packages',values.packageId);
    const transport=get('transportPackages',values.transportPackageId);
    // Legacy PCT selections continue to calculate; all new SKUs select PSZ packaging sizes.
    const count=values.packagingSizeId
        ? get('packagingSizes',values.packagingSizeId) : get('packageCounts',values.packageCountId);
    const normalize=get('normalizationUnits',values.normalizationUnitId);
    if(Boolean(container)!==Boolean(size))throw new HttpError(400,'Container and container size must be selected together.');
    if(!pack&&count)throw new HttpError(400,'Select container packaging before its packaging size.');
    const legacyConfiguredLayout=Boolean(pack?.packagingTypeCode&&Number.isSafeInteger(pack.quantity)&&Number(pack.quantity)>0);
    if(pack&&!count&&!legacyConfiguredLayout)throw new HttpError(400,'Select the commercial packaging size.');
    if(transport&&!pack)throw new HttpError(400,'Transport packaging requires commercial packaging.');
    if((pack||normalize)&&!container)throw new HttpError(400,'Package or normalization requires a configured container and size.');
    if(normalize&&!pack)throw new HttpError(400,'Select the physical package before normalization.');
    const productionUom=str(form?.uom);
    if(!productionUom)throw new HttpError(400,'Production form must define a production unit.');
    // Existing container parameters without category stay readable during migration.
    if(container?.categoryCode?.startsWith('UOM-') && container.categoryCode!==skuUnitCategoryOf(productionUom))
        throw new HttpError(400,'Physical container category is incompatible with the production form unit.');
    let contentPerContainer:number|null=null,perPack:number|null=null,perUnit:number|null=null;
    if(size){
        const ratio=skuUnitConversion(str(size.uom),productionUom);
        if(!ratio)throw new HttpError(400,'Container size unit is incompatible with the production form unit.');
        contentPerContainer=(num(size.quantity)??0)*ratio;
        if(!Number.isFinite(contentPerContainer)||contentPerContainer<=0)
            throw new HttpError(400,'Configured container size must be positive.');
    }
    let packagedContainers:number|null=null;
    if(pack){
        const n=legacyConfiguredLayout?packagingPrimaryContainerCount(pack,params):(num(count?.quantity)??0);
        if(!Number.isSafeInteger(n)||n<=0)
            throw new HttpError(400,'Container packaging must have a positive whole-number quantity.');
        // A selected standard size must agree with the configured layout.
        // For nested pallets the packaging size describes the child pack, not the
        // total primary-container count, so do not multiply it a second time.
        if(legacyConfiguredLayout&&count){
            const expected=pack.containedUnit==='PACKAGING'
                ?params.find(p=>p.id===pack.containedPackagingId)?.quantity:n;
            if(Number(count.quantity)!==Number(expected))
                throw new HttpError(400,'Packaging size does not match its selected lower-level packaging layout.');
        }
        packagedContainers=n;
        perPack=(contentPerContainer??0)*n;
    }
    let normalizedName='';
    if(normalize){
        const ratio=skuUnitConversion(str(normalize.baseUom),productionUom);
        if(!ratio)throw new HttpError(400,'Normalization basis is incompatible with the production form.');
        perUnit=(num(normalize.quantityPerUnit)??0)*ratio;
        if(!Number.isFinite(perUnit)||perUnit<=0)
            throw new HttpError(400,'Configured normalization content must be positive.');
        normalizedName=normalize.name;
    }
    const stacking=values.transportLayeringEnabled===true;
    let packagesPerTransport:number|null=null;
    if(transport){
        const bounded=(v:unknown,label:string)=>{
            const n=Number(v);
            if(!Number.isSafeInteger(n)||n<1||n>1000000)
                throw new HttpError(400,label+' must be a positive whole number.');
            return n;
        };
        packagesPerTransport=stacking
            ?bounded(values.transportPackagesPerLayer,'Commercial packages per layer')*
                bounded(values.transportLayerCount,'Number of layers')
            :bounded(values.transportUnitsPerLoad,'Commercial packages per transport unit');
        if(packagesPerTransport>10000000)
            throw new HttpError(400,'Consolidated transport quantity exceeds the supported range.');
    }else if(stacking||values.transportPackagesPerLayer||values.transportLayerCount||values.transportUnitsPerLoad)
        throw new HttpError(400,'Select a transport packaging type before configuring its load.');
    const round=(v:number|null)=>v===null?null:Number(v.toPrecision(12));
    const factor=perPack!==null&&perUnit!==null?perPack/perUnit:null;
    const reverse=factor!==null?1/factor:null;
    const selectedNames:Record<string,string>={};
    for(const [key,value] of Object.entries({productName:name,productionForm:form,container,containerSize:size,commercialPackage:pack,packageCount:count,transportPackage:transport,normalizationUnit:normalize}))
        if(value)selectedNames[key]=value.name;
    return {
        productionUom,containerSizeInProductionUom:round(contentPerContainer),
        containersPerPackage:packagedContainers,
        productionQtyPerPackage:round(perPack),
        normalizationUom:normalizedName,
        productionQtyPerNormalizationUnit:round(perUnit),
        conversionFactor:round(factor),
        reverseConversionFactor:round(reverse),
        transportLayeringEnabled:transport?stacking:false,
        commercialPackagesPerTransportUnit:packagesPerTransport,
        primaryContainersPerTransportUnit:packagedContainers!==null&&packagesPerTransport!==null
            ?packagedContainers*packagesPerTransport:null,
        productionQtyPerTransportUnit:perPack!==null&&packagesPerTransport!==null
            ?round(perPack*packagesPerTransport):null,
        normalizationUnitsPerTransportUnit:factor!==null&&packagesPerTransport!==null
            ?round(factor*packagesPerTransport):null,
        selectedNames,
    };
}

export function normalizeSkuParameter(kind:SkuParameterKind,raw:Record<string,unknown>,containerTypes?:MfgPrimaryContainerType[],packagingTypes?:MfgPackagingType[]):Omit<SkuParameter,'id'> {
    // Package containment has a canonical name derived from the MEMS Count unit.
    const name=kind==='packageCounts'
        ? String(countUnitTotal(str(raw.unitCode).trim(),Number(raw.unitCount)))
        : kind==='packagingSizes'?String(Number(raw.quantity))
        : kind==='containers'?validatePrimaryContainerSelection(str(raw.metadataCode),raw.containerAttributes,containerTypes).name
        : str(raw.name).trim();
    if(!name||name.length>120)throw new HttpError(400,'A parameter name of up to 120 characters is required.');
    const description=str(raw.description).trim().slice(0,300);
    const base={kind,name,description,enabled:raw.enabled!==false};
    if(kind==='productNames'){
        const productCode=str(raw.productCode).trim().toUpperCase();
        if(!/^[A-Z0-9][A-Z0-9_.-]{1,29}$/.test(productCode))
            throw new HttpError(400,'Enter a unique SKU name code (2–30 letters, digits, dots, hyphens or underscores).');
        return {...base,productCode};
    }
    if(kind==='productionForms'){
        const uom=str(raw.uom).trim();
        if(!uom||!skuUnitConversion(uom,uom))throw new HttpError(400,'Select a supported MEMS production unit.');
        return {...base,uom};
    }
    if(kind==='containers'){
        const chosen=validatePrimaryContainerSelection(str(raw.metadataCode),raw.containerAttributes,containerTypes);
        return {...base,...chosen};
    }
    if(kind==='containerSizes'){
        const uom=str(raw.uom).trim(),quantity=Number(raw.quantity);
        if(!uom||!skuUnitConversion(uom,uom)||!Number.isFinite(quantity)||quantity<=0||quantity>1e12)
            throw new HttpError(400,'Container size needs a positive quantity and MEMS unit of measure.');
        return {...base,uom,quantity};
    }
    if(kind==='packages'||kind==='transportPackages'){
        if(str(raw.packagingTypeCode)){
            const type=(packagingTypes??[]).find(t=>t.code===str(raw.packagingTypeCode));
            if(!type)throw new HttpError(400,'Select a published MEMS packaging type.');
            // The business role (commercial versus transport) belongs to the
            // organization, not to a hard-coded package type or industry.
            // Previously configured layer layouts remain readable and editable,
            // but new master types carry no SKU-specific stacking quantities.
            if(kind==='packages'&&raw.containersPerLayer!==undefined&&raw.numberOfLayers!==undefined){
                const layout=validatePackagingLayout(raw,packagingTypes);
                return {...base,...layout};
            }
            if(!skuUnitConversion(type.defaultUnitCode,type.defaultUnitCode))
                throw new HttpError(400,'Packaging metadata must use a published MEMS unit.');
            return {...base,packagingTypeCode:type.code,level:type.level,
                containedUnit:type.containedUnit,uom:type.defaultUnitCode};
        }
        // Only pre-existing commercial packaging can use this legacy fallback.
        if(kind==='transportPackages')throw new HttpError(400,'Select a published transport packaging type.');
        const uom=str(raw.uom).trim();
        if(!skuUnitConversion(uom,uom))
            throw new HttpError(400,'Select a unit from the existing MEMS Units master for container packaging.');
        return {...base,uom};
    }
    if(kind==='packagingSizes'){
        const quantity=Number(raw.quantity);
        if(!Number.isSafeInteger(quantity)||quantity<1||quantity>10000000)
            throw new HttpError(400,'Container packaging size must be a positive whole number.');
        return {...base,quantity,description:''};
    }
    if(kind==='packageCounts'){
        // Package containment is measured using the existing MEMS Count-category units:
        // 1 dozen = 12, 2 dozen = 24, or 6 each = 6.
        const unitCode=str(raw.unitCode).trim(),unitCount=Number(raw.unitCount);
        const quantity=countUnitTotal(unitCode,unitCount);
        return {...base,unitCode,unitCount,quantity};
    }
    if(kind==='normalizationUnits'){
        const baseUom=str(raw.baseUom).trim(),quantityPerUnit=Number(raw.quantityPerUnit);
        if(!baseUom||!skuUnitConversion(baseUom,baseUom)||!Number.isFinite(quantityPerUnit)||quantityPerUnit<=0||quantityPerUnit>1e12)
            throw new HttpError(400,'Define the production content of one normalization unit using a MEMS unit of measure.');
        return {...base,baseUom,quantityPerUnit};
    }
    return base;
}

/** Human-friendly SKU name derived from the organization's selected catalogue values. */
export function composeConfiguredSkuName(values:SkuComponents,params:SkuParameter[]):string {
    const selected=new Map(params.map(p=>[p.id,p]));
    const name=str(selected.get(values.productNameId||'')?.name).trim();
    const size=str(selected.get(values.containerSizeId||'')?.name).trim();
    const container=str(selected.get(values.containerId||'')?.name).trim();
    const pack=str(selected.get(values.packageId||'')?.name).trim();
    const count=str(selected.get(values.packagingSizeId||values.packageCountId||'')?.name).trim();
    return [name,[size,container].filter(Boolean).join(' '),[pack,count?'x'+count:''].filter(Boolean).join(' ')]
        .filter(Boolean).join(' · ').slice(0,160);
}
