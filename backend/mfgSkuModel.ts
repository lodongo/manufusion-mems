/**
 * Industry-neutral manufacturing SKU composition and conversion model.
 * Uses the existing MEMS Procurement unit registry (not a new parallel UoM master).
 * The normalization basis (e.g., L per unit case) belongs to the organization.
 */
import { HttpError, num, str } from './core';
import { PROCUREMENT_UNITS } from './procurementUnits';

export const SKU_PARAMETERS={
    productNames:'NME', productionForms:'FRM', containers:'CNT',
    containerSizes:'SIZ', packages:'PKG', packageCounts:'PCT', normalizationUnits:'NRM',
} as const;
export type SkuParameterKind=keyof typeof SKU_PARAMETERS;
export const SKU_PARAMETER_KINDS=Object.keys(SKU_PARAMETERS) as SkuParameterKind[];
export type SkuParameter={id:string;kind:SkuParameterKind;name:string;
    uom?:string;quantity?:number;baseUom?:string;quantityPerUnit?:number;
    enabled?:boolean;description?:string};
export type SkuComponents={
    productNameId?:string;productionFormId?:string;containerId?:string;
    containerSizeId?:string;packageId?:string;packageCountId?:string;normalizationUnitId?:string;
};
export type SkuConversion={
    productionUom:string;containerSizeInProductionUom:number|null;
    containersPerPackage:number|null;productionQtyPerPackage:number|null;
    normalizationUom:string;productionQtyPerNormalizationUnit:number|null;
    conversionFactor:number|null; // normalized units per one physical package
    reverseConversionFactor:number|null; // physical packages per normalized unit
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
    if(from.toLowerCase()===to.toLowerCase())return 1;
    const pick=(code:string)=>{
        const exact=PROCUREMENT_UNITS.find(u=>u.code===code&&u.active&&u.selectable);
        const matching=PROCUREMENT_UNITS.filter(u=>u.active&&u.selectable&&
            (u.symbol.toLowerCase()===code.toLowerCase()||u.label.toLowerCase()===code.toLowerCase()));
        return exact??(matching.length===1?matching[0]:null);
    };
    const a=pick(from),b=pick(to);
    if(!a||!b||a.baseUnit!==b.baseUnit||a.categoryCode!==b.categoryCode)return null;
    if(!Number.isFinite(a.multiplier)||a.multiplier<=0||!Number.isFinite(b.multiplier)||b.multiplier<=0)return null;
    return a.multiplier/b.multiplier;
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
    const count=get('packageCounts',values.packageCountId);
    const normalize=get('normalizationUnits',values.normalizationUnitId);
    if(Boolean(container)!==Boolean(size))throw new HttpError(400,'Container and container size must be selected together.');
    if(Boolean(pack)!==Boolean(count))throw new HttpError(400,'Package and pack containment must be selected together.');
    if((pack||normalize)&&!container)throw new HttpError(400,'Package or normalization requires a configured container and size.');
    if(normalize&&!pack)throw new HttpError(400,'Select the physical package before normalization.');
    const productionUom=str(form?.uom);
    if(!productionUom)throw new HttpError(400,'Production form must define a production unit.');
    let contentPerContainer:number|null=null,perPack:number|null=null,perUnit:number|null=null;
    if(size){
        const ratio=skuUnitConversion(str(size.uom),productionUom);
        if(!ratio)throw new HttpError(400,'Container size unit is incompatible with the production form unit.');
        contentPerContainer=(num(size.quantity)??0)*ratio;
        if(!Number.isFinite(contentPerContainer)||contentPerContainer<=0)
            throw new HttpError(400,'Configured container size must be positive.');
    }
    if(pack&&count){
        const n=num(count.quantity)??0;
        if(!Number.isSafeInteger(n)||n<=0)
            throw new HttpError(400,'Package containment must be a positive whole number.');
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
    const round=(v:number|null)=>v===null?null:Number(v.toPrecision(12));
    const factor=perPack!==null&&perUnit!==null?perPack/perUnit:null;
    const reverse=factor!==null?1/factor:null;
    const selectedNames:Record<string,string>={};
    for(const [key,value] of Object.entries({productName:name,productionForm:form,container,containerSize:size,package:pack,packageCount:count,normalizationUnit:normalize}))
        if(value)selectedNames[key]=value.name;
    return {
        productionUom,containerSizeInProductionUom:round(contentPerContainer),
        containersPerPackage:count?(num(count.quantity)??null):null,
        productionQtyPerPackage:round(perPack),
        normalizationUom:normalizedName,
        productionQtyPerNormalizationUnit:round(perUnit),
        conversionFactor:round(factor),
        reverseConversionFactor:round(reverse),
        selectedNames,
    };
}

export function normalizeSkuParameter(kind:SkuParameterKind,raw:Record<string,unknown>):Omit<SkuParameter,'id'> {
    const name=str(raw.name).trim();
    if(!name||name.length>120)throw new HttpError(400,'A parameter name of up to 120 characters is required.');
    const description=str(raw.description).trim().slice(0,300);
    const base={kind,name,description,enabled:raw.enabled!==false};
    if(kind==='productionForms'){
        const uom=str(raw.uom).trim();
        if(!uom||!skuUnitConversion(uom,uom))throw new HttpError(400,'Select a supported MEMS production unit.');
        return {...base,uom};
    }
    if(kind==='containerSizes'){
        const uom=str(raw.uom).trim(),quantity=Number(raw.quantity);
        if(!uom||!skuUnitConversion(uom,uom)||!Number.isFinite(quantity)||quantity<=0||quantity>1e12)
            throw new HttpError(400,'Container size needs a positive quantity and MEMS unit of measure.');
        return {...base,uom,quantity};
    }
    if(kind==='packageCounts'){
        const quantity=Number(raw.quantity);
        if(!Number.isSafeInteger(quantity)||quantity<1||quantity>10000000)
            throw new HttpError(400,'Package containment must be a positive whole number.');
        return {...base,quantity};
    }
    if(kind==='normalizationUnits'){
        const baseUom=str(raw.baseUom).trim(),quantityPerUnit=Number(raw.quantityPerUnit);
        if(!baseUom||!skuUnitConversion(baseUom,baseUom)||!Number.isFinite(quantityPerUnit)||quantityPerUnit<=0||quantityPerUnit>1e12)
            throw new HttpError(400,'Define the production content of one normalization unit using a MEMS unit of measure.');
        return {...base,baseUom,quantityPerUnit};
    }
    return base;
}
