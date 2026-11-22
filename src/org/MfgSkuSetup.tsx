import {useId,useState} from 'react';
import {ArrowLeft,ArrowDown,ArrowUp,Box,ChevronRight,Layers3,Maximize2,Package,PackageOpen,Shapes,ListOrdered,Plus,Trash2, type LucideIcon} from 'lucide-react';
import {SKU_NAME_FIELDS,SKU_NAME_SEPARATORS,DEFAULT_SKU_NAMING_SEQUENCE,composeSkuNameFromSequence,
    type SkuNamingSequence,type SkuNameValues,type SkuNameMode} from '../shared/mfgSkuNaming';
import {Field,SelectField} from '../components/ui';
import {callBackend} from '../lib/backend';
import {THROUGHPUT_OUTPUTS,throughputOutput,throughputOutputGroups} from '../shared/throughputOutput';
import {BULK_STORAGE_CONTAINER_CATEGORY,SKU_CONTAINMENT_SCOPES,skuContainmentNeeds,type SkuContainmentScope} from '../shared/skuContainmentPolicy';

export type SkuParameterKind='productNames'|'processClasses'|'productionForms'|'containers'|'containerSizes'|'packages'|'transportPackages'|'packagingSizes'|'packageCounts'|'normalizationUnits';
export type SkuParameter={
    id:string;kind:SkuParameterKind;name:string;enabled?:boolean;description?:string;
    quantity?:number;uom?:string;baseUom?:string;quantityPerUnit?:number;revision?:number;
    referenceProductionFormId?:string;normalizationOperator?:'DIVIDE'|'MULTIPLY';
    categoryCode?:string;unitCode?:string;unitCount?:number;productCode?:string;processCode?:string;
    metadataCode?:string;subcategoryCode?:string;containerAttributes?:Record<string,string>;ratingCountUnitCode?:string;ratingOutputCode?:string;
    packagingTypeCode?:string;level?:string;containedUnit?:string;containedPackagingId?:string;
    containersPerLayer?:number;numberOfLayers?:number;
};
export type MeasureUnit={code:string;label:string;symbol:string;category:string;categoryCode:string;baseUnit:string;multiplier:number};
export type MeasureCategory={code:string;name:string};
export type ContainerAttr={key:string;label:string;required:boolean;choices:string[]};
export type ContainerMetadataType={
    code:string;name:string;categoryCode:string;category:string;
    subcategoryCode:string;subcategory:string;sectors:string[];attributes:ContainerAttr[];
};
export type PrimaryContainerMetadata={
    version:number;categories:Array<{code:string;name:string;sectors:string[]}>;
    types:ContainerMetadataType[];
};
export type PackagingType={code:string;name:string;category:string;subcategory:string;
    level:string;containedUnit:'PRIMARY'|'PACKAGING';description:string;defaultUnitCode:string};
export type PackagingMetadata={
    version:number;categories:Array<{code:string;name:string;level:string}>;types:PackagingType[];
};
export type SkuSetup={
    parameters:SkuParameter[];groups:Record<SkuParameterKind,string>;units:MeasureUnit[];
    categories:MeasureCategory[];primaryContainerMetadata:PrimaryContainerMetadata;
    packagingMetadata:PackagingMetadata;
    namingSequence:SkuNamingSequence;namingRevision:number;namingConfigured:boolean;
    conventions:Record<string,string|number>;
};
export const emptySkuSetup:SkuSetup={
    parameters:[],
    groups:{productNames:'NME',processClasses:'PRC',productionForms:'FRM',containers:'CNT',containerSizes:'SIZ',
        packages:'PKG',transportPackages:'TLP',packagingSizes:'PSZ',packageCounts:'PCT',normalizationUnits:'NRM'},
    units:[],categories:[],primaryContainerMetadata:{version:1,categories:[],types:[]},
    packagingMetadata:{version:1,categories:[],types:[]},
    namingSequence:DEFAULT_SKU_NAMING_SEQUENCE,namingRevision:0,namingConfigured:false,
    conventions:{items:'SKU',boms:'BOM',resources:'RSC',
        routings:'RTG',batches:'BTH',digits:9},
};
export type SkuSelections={
    containmentScope?:SkuContainmentScope;
    requiresCommercialPackaging?:boolean;requiresTransportPackaging?:boolean;
    productNameId?:string;productionFormId?:string;containerId?:string;containerSizeId?:string;
    containerCapacityQuantity?:number;containerCapacityUom?:string;
    packageId?:string;packagingSizeId?:string;packageCountId?:string;
    transportPackageId?:string;transportLayeringEnabled?:boolean;
    transportPackagesPerLayer?:number;transportLayerCount?:number;transportUnitsPerLoad?:number;
    normalizationUnitId?:string;
};
type MenuKey=Exclude<SkuParameterKind,'packageCounts'>|'namingSequence';
export const SKU_GROUPS:Array<{kind:MenuKey;title:string}>=[
    {kind:'productNames',title:'Product/Variant'},
    {kind:'processClasses',title:'Manufacturing Process Classifications'},
    {kind:'productionForms',title:'Production Forms'},
    {kind:'containers',title:'Physical Containers'},
    {kind:'containerSizes',title:'Container Sizes'},
    {kind:'packages',title:'Commercial Packaging'},
    {kind:'packagingSizes',title:'Commercial Packaging Sizes'},
    {kind:'transportPackages',title:'Transport & Logistics Packaging'},
    {kind:'normalizationUnits',title:'Normalization Units'},
    {kind:'namingSequence',title:'SKU Naming Sequence'},
];
type IconComponent=LucideIcon;
const menu:Array<{key:MenuKey;title:string;Icon:IconComponent}>=[
    {key:'productNames',title:'Product/Variant',Icon:Box},
    {key:'processClasses',title:'Manufacturing Process Classifications',Icon:Shapes},
    {key:'productionForms',title:'Production Forms',Icon:Layers3},
    {key:'containers',title:'Physical Containers',Icon:PackageOpen},
    {key:'containerSizes',title:'Container Sizes',Icon:Maximize2},
    {key:'packages',title:'Commercial Packaging',Icon:Package},
    {key:'packagingSizes',title:'Commercial Packaging Sizes',Icon:Box},
    {key:'transportPackages',title:'Transport & Logistics Packaging',Icon:Layers3},
    {key:'normalizationUnits',title:'Normalization Units',Icon:Shapes},
    {key:'namingSequence',title:'SKU Naming Sequence',Icon:ListOrdered},
];
/** Organize the large parameter catalogue without changing any editor or SKU setting. */
const menuGroups:{title:string;hint:string;keys:MenuKey[]}[]=[
    {title:'Product identity & manufacturing process',hint:'What the product is · how it is made · the physical form and production unit',
        keys:['productNames','processClasses','productionForms']},
    {title:'Primary container',hint:'Container types and physical sizes',
        keys:['containers','containerSizes']},
    {title:'Commercial & transport packaging',hint:'Selling packs and logistics units',
        keys:['packages','packagingSizes','transportPackages']},
    {title:'Reporting units',hint:'Normalized production measurement',
        keys:['normalizationUnits']},
];
/** Consistent language at Product Configuration and Materials & Products. */
export function SkuIdentityGuide({inSkuForm=false,onOpenSkus}:{inSkuForm?:boolean;onOpenSkus?:()=>void}){
 return <div className='space-y-2 rounded-xl border border-line bg-page p-3'>
  <p className='text-sm font-semibold text-ink'>How do these link to an SKU?</p>
  <p className='text-xs text-muted'>
   Product/Variant says <strong>what</strong> the product is. Manufacturing Process Classification says <strong>how</strong> it is made.
   Production Form describes <strong>the physical form and its measuring unit</strong>.
   An SKU is the specific product or intermediate record that uses these choices.
  </p>
  <details className='rounded-lg border border-line bg-panel p-3'>
   <summary className='cursor-pointer text-sm font-semibold text-ink'>Show an example and how the selections work</summary>
   <div className='mt-3 space-y-2 text-xs text-muted'>
    <p><strong>1. Product/Variant:</strong> Cola Original — one reusable name and code across pack sizes.</p>
    <p><strong>2. Manufacturing Process Classification:</strong> PET carbonated beverage process — the group used to find compatible routings, not the flavour or recipe.</p>
    <p><strong>3. Production Form:</strong> Liquid, measured in litres (L) — defines the output unit and physical-quantity conversions; it is not a bottle or case.</p>
    <p><strong>4. SKU:</strong> Cola Original · 500 mL PET · 24 bottles/case is one SKU.
     Cola Original · 1 L PET · 12 bottles/case is a different SKU, even if the first three choices stay the same.</p>
    <p><strong>How they connect:</strong> In Materials &amp; Products → Add SKU, choose the process classification and applicable Product/Variant and Production Form;
     add packaging and containment only when required. Each SKU receives its own generated SKU_ identifier and can have its own BOM/recipe.
     Process classification helps determine routing eligibility; the resource and site allocation determines where it can be made.</p>
    <p><strong>Not industry-specific:</strong> The same framework works for resin by kg, fabric by m² or machined components by piece.</p>
    <p><strong>Intermediate/WIP:</strong> Product/Variant can be optional, while Production Form is needed when physical SKU composition and conversions are configured.</p>
   </div>
  </details>
  {inSkuForm&&<p className='text-xs text-muted'>Choose the process group above, then use SKU composition below for Product/Variant and Production Form when applicable. These catalogue records never create a new SKU by themselves.</p>}
  {onOpenSkus&&<button type='button' className='min-h-11 rounded-lg border border-line bg-panel px-3 text-sm font-semibold text-ink'
   onClick={onOpenSkus}>Open Materials &amp; Products to create or edit an SKU</button>}
 </div>;
}
const identityHints:Partial<Record<MenuKey,string>>={
 productNames:'Product identity and code; reused across multiple sizes and packs',
 processClasses:'Shared manufacturing method; links SKUs to eligible routings',
 productionForms:'Physical form and output unit, e.g. liquid (L), mass (kg), length (m)',
};
const variants:Array<{key:'productNameId'|'productionFormId'|'containerId'|'containerSizeId'|'packageId'|'packagingSizeId'|'normalizationUnitId';kind:SkuParameterKind;label:string}>=[
    {key:'productNameId',kind:'productNames',label:'Product/Variant'},
    {key:'productionFormId',kind:'productionForms',label:'Production form'},
    {key:'containerId',kind:'containers',label:'Physical container'},
    {key:'containerSizeId',kind:'containerSizes',label:'Container size'},
    {key:'packageId',kind:'packages',label:'Commercial packaging'},
    {key:'packagingSizeId',kind:'packagingSizes',label:'Primary containers per commercial package'},
    {key:'normalizationUnitId',kind:'normalizationUnits',label:'Normalization unit'},
];
const pretty=(v:number)=>Number(v.toPrecision(9)).toLocaleString(undefined,{maximumFractionDigits:9});
const getParam=(setup:SkuSetup,kind:SkuParameterKind,id:string|undefined)=>
    setup.parameters.find(p=>p.kind===kind&&p.id===id);
const pickUnit=(setup:SkuSetup,code:string|undefined)=>{
    if(!code)return undefined;
    return setup.units.find(u=>u.code===code)||setup.units.find(u=>u.symbol===code);
};
const packagePrimaryCount=(pack:SkuParameter,all:SkuParameter[],visited=new Set<string>()):number|null=>{
    if(visited.has(pack.id))return null;
    const next=new Set(visited);next.add(pack.id);
    const total=Number(pack.quantity);
    if(!Number.isSafeInteger(total)||total<1)return null;
    if(pack.containedUnit!=='PACKAGING')return total;
    const child=all.find(p=>p.id===pack.containedPackagingId&&p.kind==='packages');
    if(!child)return null;
    const lower=packagePrimaryCount(child,all,next);
    return lower===null?null:total*lower;
};
const ratio=(setup:SkuSetup,from:string|undefined,to:string|undefined):number|null=>{
    const a=pickUnit(setup,from),b=pickUnit(setup,to);
    if(!a||!b||a.categoryCode!==b.categoryCode||a.baseUnit!==b.baseUnit)return null;
    return a.multiplier/b.multiplier;
};
const modal='rounded-2xl border border-line bg-panel p-3 text-ink sm:p-5';
const primary='min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand disabled:opacity-50';
const secondary='min-h-11 rounded-xl border border-line px-3 text-sm text-ink disabled:opacity-50';

function Choice({title,value,options,onChange,placeholder='Select'}:{
    title:string;value:string;options:Array<[string,string]>;onChange:(v:string)=>void;placeholder?:string;
}){
    const id=useId();
    return <SelectField id={id} label={title} value={value} onChange={e=>onChange(e.target.value)}>
        <option value=''>{placeholder}</option>
        {options.map(([code,label])=><option key={code} value={code}>{label}</option>)}
    </SelectField>;
}
function TextInput({title,value,onChange,required=false,hint}:{title:string;value:string;
    onChange:(v:string)=>void;required?:boolean;hint?:string}){
    const id=useId();
    return <Field id={id} label={title} hint={hint} required={required}
        value={value} onChange={e=>onChange(e.target.value)}/>;
}
function NumberInput({title,value,onChange}:{title:string;value:number;onChange:(v:number)=>void}){
    const id=useId();
    return <Field id={id} label={title} type='number' min='1' step='1'
        value={value} onChange={e=>onChange(Number(e.target.value))}/>;
}
function QuantityInput({title,value,onChange}:{title:string;value:number;onChange:(v:number)=>void}){
    const id=useId();
    return <Field id={id} label={title} type='number' min='0' step='any'
        value={value} onChange={e=>onChange(Number(e.target.value))}/>;
}
export function UnitChoice({title,value,setup,onChange}:{title:string;value:string;setup:SkuSetup;onChange:(v:string)=>void}){
    const [category,setCategory]=useState('');
    // Read earlier SKU symbols such as EA without changing their stored value until the user selects a unit.
    const selected=pickUnit(setup,value)||setup.units.find(u=>u.symbol.toLowerCase()===value.toLowerCase());
    const fromRecord=selected?.categoryCode||'';
    const activeCategory=fromRecord||category;
    return <div className='grid gap-3 sm:grid-cols-2'>
        <Choice title='Unit category' value={activeCategory} placeholder='Select category'
            options={setup.categories.map(c=>[c.code,c.name])}
            onChange={next=>{setCategory(next);onChange('');}}/>
        <Choice title={title} value={selected?.code||value} placeholder='Select unit'
            options={setup.units.filter(u=>u.categoryCode===activeCategory)
                .map(u=>[u.code,u.label+' ('+u.symbol+')'])} onChange={onChange}/>
    </div>;
}

export function SkuConfigurationFields({value,onChange,setup,variantLabel='Product/Variant',processClassId=''}:{
    value:SkuSelections;onChange:(next:SkuSelections)=>void;setup:SkuSetup;variantLabel?:string;processClassId?:string;
}){
    const form=getParam(setup,'productionForms',value.productionFormId);
    const needs=skuContainmentNeeds(value);
    const selectedScope=value.containmentScope||'PRIMARY_CONTAINER';
    const container=getParam(setup,'containers',value.containerId);
    const legacySize=getParam(setup,'containerSizes',value.containerSizeId);
    const size=value.containerCapacityQuantity!==undefined?undefined:legacySize;
    const enteredUnit=pickUnit(setup,value.containerCapacityUom);
    const enteredCapacity=value.containerCapacityQuantity;
    const capacityValue=enteredCapacity!==undefined&&value.containerCapacityUom
        ?enteredCapacity:legacySize?.quantity;
    const capacityUom=value.containerCapacityUom||legacySize?.uom;
    const packageRecord=getParam(setup,'packages',value.packageId);
    const transportRecord=getParam(setup,'transportPackages',value.transportPackageId);
    const packSize=value.packagingSizeId
        ?getParam(setup,'packagingSizes',value.packagingSizeId)
        :getParam(setup,'packageCounts',value.packageCountId);
    const norm=getParam(setup,'normalizationUnits',value.normalizationUnitId);
    const normalizationReferenceForm=getParam(setup,'productionForms',norm?.referenceProductionFormId);
    const contentPerContainer=capacityValue!==undefined&&form&&ratio(setup,capacityUom,form.uom)!==null
        ?capacityValue*ratio(setup,capacityUom,form.uom)!:null;
    const effectivePackSize=packageRecord?.packagingTypeCode&&Number.isSafeInteger(packageRecord.quantity)&&Number(packageRecord.quantity)>0
        ?packagePrimaryCount(packageRecord,setup.parameters)
        :packSize?.quantity??null;
    const contentPerPackage=effectivePackSize!==null&&contentPerContainer!==null
        ?contentPerContainer*effectivePackSize:null;
    const layersEnabled=!!value.transportLayeringEnabled;
    const transportCount=transportRecord
        ?(layersEnabled?Number(value.transportPackagesPerLayer)*Number(value.transportLayerCount):
            Number(value.transportUnitsPerLoad)):null;
    const validTransportCount=transportCount!==null&&Number.isSafeInteger(transportCount)&&
        transportCount>=1&&transportCount<=10000000?transportCount:null;
    const physicalPerUnit=needs.requiresCommercialPackaging?effectivePackSize:1;
    const primaryPerTransport=validTransportCount!==null&&physicalPerUnit!==null
        ?validTransportCount*physicalPerUnit:null;
    const quantityPerTransport=validTransportCount!==null&&
        (needs.requiresCommercialPackaging?contentPerPackage:contentPerContainer)!==null
        ?validTransportCount*(needs.requiresCommercialPackaging?contentPerPackage!:contentPerContainer!):null;
    const normalizedReferenceUom=normalizationReferenceForm?.uom||norm?.baseUom;
    const unitRatio=norm&&form?ratio(setup,normalizedReferenceUom,form.uom):null;
    const normalizedOperator=norm?.normalizationOperator==='MULTIPLY'?'MULTIPLY':'DIVIDE';
    const normalBase=norm&&unitRatio!==null&&norm.quantityPerUnit&&norm.quantityPerUnit>0
        ?(normalizedOperator==='MULTIPLY'?unitRatio/norm.quantityPerUnit:norm.quantityPerUnit*unitRatio):null;
    const factor=normalBase&&contentPerPackage!==null?contentPerPackage/normalBase:null;
    const productRecord=getParam(setup,'productNames',value.productNameId);
    const processRecord=getParam(setup,'processClasses',processClassId);
    const product=productRecord?.name||'Select product';
    const capacityTitle=enteredCapacity!==undefined
        ?String(enteredCapacity)+' '+(enteredUnit?.symbol||value.containerCapacityUom||'')
        :legacySize?.name||'';
    const defaultTitle=[product,[capacityTitle,container?.name].filter(Boolean).join(' '),
        [packageRecord?.name,packSize?'x'+packSize.quantity:''].filter(Boolean).join(' ')]
        .filter(Boolean).join(' · ');
    const unitSymbol=(code:string|undefined)=>pickUnit(setup,code)?.symbol||code||'';
    const token=(p:SkuParameter|undefined,code?:string)=>p?{
        name:p.name,code:code||p.id,quantity:p.quantity,unit:unitSymbol(p.uom),
    }:undefined;
    const namingValues:SkuNameValues={
        productName:token(productRecord,productRecord?.productCode),
        manufacturingProcess:processRecord?{name:processRecord.name,code:processRecord.processCode||''}:undefined,
        productionForm:token(form),
        primaryContainer:token(container,container?.metadataCode),
        containerSize:enteredCapacity!==undefined
            ?{name:capacityTitle,quantity:enteredCapacity,unit:enteredUnit?.symbol||value.containerCapacityUom}
            :token(legacySize),
        commercialPackaging:token(packageRecord,packageRecord?.packagingTypeCode),
        commercialPackSize:token(packSize),
        transportPackaging:token(transportRecord,transportRecord?.packagingTypeCode),
        normalizationUnit:norm?{name:norm.name,code:norm.id,quantity:norm.quantityPerUnit,unit:unitSymbol(normalizedReferenceUom)}:undefined,
        commercialProductQuantity:contentPerPackage===null?undefined:{quantity:contentPerPackage,unit:unitSymbol(form?.uom)},
        normalizedCommercialQuantity:factor===null?undefined:{quantity:factor},
        transportPackagesPerLayer:value.transportPackagesPerLayer?{quantity:value.transportPackagesPerLayer}:undefined,
        transportLayerCount:value.transportLayerCount?{quantity:value.transportLayerCount}:undefined,
        transportTotalUnits:validTransportCount===null?undefined:{quantity:validTransportCount},
    };
    const title=setup.namingConfigured?
        composeSkuNameFromSequence(setup.namingSequence,namingValues):defaultTitle;
    const optionsFor=(kind:SkuParameterKind):Array<[string,string]>=>setup.parameters
        .filter(p=>p.kind===kind&&p.enabled!==false&&
            (kind!=='containers'||(selectedScope==='BULK_STORAGE'
                ?p.categoryCode===BULK_STORAGE_CONTAINER_CATEGORY
                :p.categoryCode!==BULK_STORAGE_CONTAINER_CATEGORY))&&
            (kind!=='containers'||!value.productionFormId||!p.categoryCode?.startsWith('UOM-')||
                p.categoryCode===pickUnit(setup,form?.uom)?.categoryCode)&&
            (kind!=='normalizationUnits'||!form?.uom||
                ratio(setup,getParam(setup,'productionForms',p.referenceProductionFormId)?.uom||p.baseUom,form.uom)!==null))
        .map(p=>[p.id,p.kind==='normalizationUnits'
            ?p.name+' · '+p.quantityPerUnit+' '+(pickUnit(setup,
                getParam(setup,'productionForms',p.referenceProductionFormId)?.uom||p.baseUom)?.symbol||
                getParam(setup,'productionForms',p.referenceProductionFormId)?.uom||p.baseUom||'')+' / normalized unit'
            :p.name] as [string,string]);
    const shownVariants=variants.filter(v=>
        (v.key!=='containerSizeId')&&
        (v.key!=='containerId'||selectedScope!=='NONE')&&
        (!['packageId','packagingSizeId'].includes(v.key)||needs.requiresCommercialPackaging));
    return <section className={modal+' space-y-3'}>
        <h3 className='text-base font-semibold'>SKU composition</h3>
        <div className='rounded-xl border border-line bg-page p-3 space-y-3'>
            <Choice title='Physical containment scope *' value={selectedScope}
                options={SKU_CONTAINMENT_SCOPES.map(item=>[item.code,item.label] as [string,string])}
                onChange={scope=>onChange({...value,containmentScope:scope as SkuContainmentScope,
                    containerId:'',containerSizeId:'',containerCapacityQuantity:undefined,containerCapacityUom:'',
                    packageId:'',packagingSizeId:'',packageCountId:'',
                    transportPackageId:'',requiresCommercialPackaging:false,requiresTransportPackaging:false,
                    transportLayeringEnabled:false,transportPackagesPerLayer:undefined,
                    transportLayerCount:undefined,transportUnitsPerLoad:undefined})}/>
            {selectedScope==='BULK_STORAGE'&&
                <p className='text-xs text-muted'>Select an adopted bulk tank, silo, hopper, bunker, vessel or bin. Enter its physical capacity and unit for this SKU manually below. Commercial and transport packaging are optional.</p>}
            {selectedScope==='NONE'&&
                <p className='text-xs text-muted'>Direct or continuous process output. No physical container, commercial pack or logistics load is required.</p>}
            {selectedScope!=='NONE'&&<div className='space-y-2'>
                <label className='flex min-h-11 items-center gap-3 rounded-lg border border-line p-3 text-sm'>
                    <input type='checkbox' checked={needs.requiresCommercialPackaging}
                        onChange={e=>onChange({...value,requiresCommercialPackaging:e.target.checked,
                            ...(!e.target.checked?{packageId:'',packagingSizeId:'',packageCountId:''}:{}),
                            transportLayeringEnabled:false,transportPackagesPerLayer:undefined,
                            transportLayerCount:undefined,transportUnitsPerLoad:undefined})}/>
                    <span><strong>Requires commercial packaging</strong><span className='block text-xs text-muted'>Selling pack, case, tray or other commercial unit</span></span>
                </label>
                <label className='flex min-h-11 items-center gap-3 rounded-lg border border-line p-3 text-sm'>
                    <input type='checkbox' checked={needs.requiresTransportPackaging}
                        onChange={e=>onChange({...value,requiresTransportPackaging:e.target.checked,
                            ...(!e.target.checked?{transportPackageId:''}:{}),
                            transportLayeringEnabled:false,transportPackagesPerLayer:undefined,
                            transportLayerCount:undefined,transportUnitsPerLoad:undefined})}/>
                    <span><strong>Requires transport & logistics packaging</strong><span className='block text-xs text-muted'>Pallet, crate, shipping load or transport handling unit</span></span>
                </label>
            </div>}
        </div>
        <div className='grid gap-3 sm:grid-cols-2'>
            {shownVariants.map(v=><Choice key={v.key} title={v.kind==='productNames'?variantLabel:v.label}
                value={value[v.key]||(!value.packagingSizeId&&v.kind==='packagingSizes'?value.packageCountId||'':'')}
                options={v.kind==='packagingSizes'&&value.packageCountId
                    ?[...optionsFor(v.kind),...setup.parameters.filter(p=>p.kind==='packageCounts'&&p.id===value.packageCountId).map(p=>[p.id,p.name] as [string,string])]
                    :optionsFor(v.kind)}
                onChange={selected=>{
                    if(v.key==='productionFormId')onChange({...value,productionFormId:selected,
                        normalizationUnitId:''});
                    else if(v.key==='packagingSizeId')onChange({...value,packagingSizeId:selected,packageCountId:''});
                    else if(v.key==='containerId')onChange({...value,containerId:selected,containerSizeId:'',
                        containerCapacityQuantity:undefined,containerCapacityUom:''});
                    else onChange({...value,[v.key]:selected});
                }}/>)}
        </div>
        {selectedScope!=='NONE'&&<div className='space-y-3 rounded-xl border border-line bg-page p-3'>
            <h4 className='text-sm font-semibold'>Primary container capacity · entered for this SKU</h4>
            <p className='text-xs text-muted'>Manually enter the actual physical capacity and its unit. Form Defaults do not set this quantity. The production form defines only the output measurement dimension.</p>
            <div className='grid gap-3 sm:grid-cols-2'>
                <Field id='sku-primary-capacity-quantity' label='Capacity quantity *'
                    type='number' min='0.000001' step='any' inputMode='decimal'
                    value={value.containerCapacityQuantity??''}
                    onChange={e=>onChange({...value,containerSizeId:'',
                        containerCapacityQuantity:e.target.value===''?undefined:Number(e.target.value)})}/>
                <UnitChoice title='Capacity unit *' setup={setup} value={value.containerCapacityUom||''}
                    onChange={unit=>onChange({...value,containerSizeId:'',containerCapacityUom:unit})}/>
            </div>
            {legacySize&&value.containerCapacityQuantity===undefined&&
                <p className='text-xs text-amber-700'>Legacy saved capacity: {legacySize.quantity} {pickUnit(setup,legacySize.uom)?.symbol||legacySize.uom}. Enter the actual capacity and select its unit above to replace the legacy size reference. Existing values remain readable until changed.</p>}
            {value.containerCapacityUom&&form?.uom&&ratio(setup,value.containerCapacityUom,form.uom)===null&&
                <p role='alert' className='text-xs text-red-500'>The selected capacity unit must be compatible with the production form ({pickUnit(setup,form.uom)?.symbol||form.uom}).</p>}
        </div>}
        {selectedScope==='BULK_STORAGE'&&!optionsFor('containers').length&&
            <p role='status' className='rounded-lg border border-line p-3 text-xs text-muted'>
                No bulk storage containers adopted yet. Open Product Configuration → Physical Containers to adopt a bulk tank, silo, hopper or storage vessel before saving the SKU.
            </p>}
        {needs.requiresTransportPackaging&&selectedScope!=='NONE'&&<div className='rounded-xl border border-line p-3 space-y-3'>
            <h4 className='text-sm font-semibold'>Transport & Logistics Packaging</h4>
            <Choice title='Transport packaging (optional)' value={value.transportPackageId||''}
                placeholder='No transport package selected'
                options={optionsFor('transportPackages')}
                onChange={id=>onChange({...value,transportPackageId:id,
                    transportLayeringEnabled:false,transportPackagesPerLayer:undefined,
                    transportLayerCount:undefined,transportUnitsPerLoad:undefined})}/>
            {transportRecord&&<>
                <label className='flex min-h-11 items-center gap-3 text-sm'>
                    <input type='checkbox' checked={layersEnabled}
                        onChange={e=>onChange({...value,transportLayeringEnabled:e.target.checked,
                            transportPackagesPerLayer:undefined,transportLayerCount:undefined,
                            transportUnitsPerLoad:undefined})}/>
                    Enable layered stacking
                </label>
                {layersEnabled?<div className='grid gap-3 sm:grid-cols-2'>
                    <NumberInput title={needs.requiresCommercialPackaging?'Commercial packages per layer':'Physical containers per layer'}
                        value={value.transportPackagesPerLayer||0}
                        onChange={n=>onChange({...value,transportPackagesPerLayer:n})}/>
                    <NumberInput title='Number of layers'
                        value={value.transportLayerCount||0}
                        onChange={n=>onChange({...value,transportLayerCount:n})}/>
                </div>:<NumberInput title={needs.requiresCommercialPackaging?'Commercial packages per transport unit':'Physical containers per transport unit'}
                    value={value.transportUnitsPerLoad||0}
                    onChange={n=>onChange({...value,transportUnitsPerLoad:n})}/>}
                {validTransportCount!==null&&<p className='text-sm font-medium text-brand'>
                    {pretty(validTransportCount)} {needs.requiresCommercialPackaging?'commercial packages':'physical containers'} per {transportRecord.name}
                    {primaryPerTransport!==null?' · '+pretty(primaryPerTransport)+' primary containers':''}
                </p>}
            </>}
        </div>}
        <div className='rounded-xl border border-line bg-page p-3 text-sm' aria-live='polite'>
            <p className='font-medium text-ink'>{title}</p>
            {contentPerContainer!==null&&<p className='mt-1 text-muted'>Per container: {pretty(contentPerContainer)} {pickUnit(setup,form?.uom)?.symbol||form?.uom}</p>}
            {packageRecord?.packagingTypeCode&&packageRecord.containersPerLayer&&packageRecord.numberOfLayers&&<p className='mt-1 text-muted'>
                {packageRecord.containersPerLayer} {packageRecord.containedUnit==='PACKAGING'?'packages':'containers'} per layer × {packageRecord.numberOfLayers} layers
                {effectivePackSize!==null?' · '+pretty(effectivePackSize)+' primary containers':''}
            </p>}
            {contentPerPackage!==null&&<p className='mt-1 text-muted'>Per commercial package: {pretty(contentPerPackage)} {pickUnit(setup,form?.uom)?.symbol||form?.uom}</p>}
            {quantityPerTransport!==null&&<p className='mt-1 text-muted'>Per transport unit: {pretty(quantityPerTransport)} {pickUnit(setup,form?.uom)?.symbol||form?.uom}</p>}
            {norm&&contentPerPackage!==null&&<p className='mt-2 text-muted'>
                Commercial package: {pretty(contentPerPackage)} {unitSymbol(form?.uom)} ·
                {normalizedOperator==='MULTIPLY'
                    ?' Multiply by '+norm.quantityPerUnit+' '+norm.name+' per '+unitSymbol(normalizedReferenceUom)
                    :' Divide by '+norm.quantityPerUnit+' '+unitSymbol(normalizedReferenceUom)+' per '+norm.name}
            </p>}
            {!needs.requiresCommercialPackaging&&norm&&normalBase&&contentPerContainer!==null&&
                <p className='mt-1 font-semibold text-brand'>Normalized units per {container?.name||'physical unit'}: {pretty(contentPerContainer/normalBase)} {norm.name}</p>}
            {factor!==null&&<p className='mt-1 font-semibold text-brand'>
                Normalized unit cases per commercial package: {pretty(factor)} {norm?.name}
            </p>}
            {norm&&form&&normalBase===null&&<p className='mt-1 text-red-500'>
                The normalization reference is incompatible with the selected production form.
            </p>}
            {factor!==null&&validTransportCount!==null&&<p className='mt-1 text-muted'>
                Transport conversion: {pretty(factor*validTransportCount)} {norm?.name} / {transportRecord?.name}
            </p>}
            {size&&form&&contentPerContainer===null&&<p className='mt-1 text-red-500'>Container size unit is incompatible with production form.</p>}
        </div>
    </section>;
}

export function SkuSetupPanel({setup,canEdit,onSaved,variantLabel='Product/Variant',onOpenSkus}:{setup:SkuSetup;canEdit:boolean;onSaved:()=>Promise<void>;variantLabel?:string;onOpenSkus?:()=>void}){
    const [active,setActive]=useState<MenuKey|null>(null);
    const [draft,setDraft]=useState<Partial<SkuParameter>|null>(null);
    const [namingDraft,setNamingDraft]=useState<SkuNamingSequence|null>(null);
    const [showNamingPicker,setShowNamingPicker]=useState(false);
    const [namingFieldToAdd,setNamingFieldToAdd]=useState('');
    const [busy,setBusy]=useState(false);
    const [error,setError]=useState(''),[notice,setNotice]=useState('');
    const [category,setCategory]=useState('');
    const [typeCode,setTypeCode]=useState('');
    const availableMetadata=setup.primaryContainerMetadata||emptySkuSetup.primaryContainerMetadata;
    const metadataType=availableMetadata.types.find(t=>t.code===typeCode);
    const packagingMetadata=setup.packagingMetadata||emptySkuSetup.packagingMetadata;
    const packagingType=packagingMetadata.types.find(t=>t.code===typeCode);
    // Category priority is a suggestion, not a restriction. A commercial load
    // can be a pallet, and a logistics unit can be a case in some industries.
    const availablePackagingCategories=[...packagingMetadata.categories].sort((a,b)=>{
        const prioritize=(level:string)=>active==='packages'?level==='SECONDARY':level!=='SECONDARY';
        return Number(prioritize(b.level))-Number(prioritize(a.level));
    });
    const availablePackagingTypes=packagingMetadata.types;
    const kindName=active==='productNames'?variantLabel:menu.find(x=>x.key===active)?.title||'SKU Configuration';
    const records=active?setup.parameters.filter(p=>p.kind===active):[];
    const update=(field:keyof SkuParameter,value:unknown)=>setDraft(d=>({...d,[field]:value}));
    const open=(kind:MenuKey)=>{
        setActive(kind);setDraft(null);
        setNamingDraft(kind==='namingSequence'?{
            separator:setup.namingSequence.separator,
            // New organizations build their naming rule using + Add.
            // For previously configured rules, show only selected steps.
            steps:setup.namingConfigured?setup.namingSequence.steps
                .filter(step=>step.enabled).map(step=>({...step})):[],
        }:null);
        setShowNamingPicker(false);setNamingFieldToAdd('');
        setError('');setNotice('');setCategory('');setTypeCode('');
    };
    const begin=()=>{
        setDraft({name:'',enabled:true});
        setTypeCode('');
        setError('');setNotice('');
    };
    const edit=(entry:SkuParameter)=>{
        setDraft({...entry});
        setTypeCode(['packages','transportPackages'].includes(entry.kind)?entry.packagingTypeCode||'':entry.metadataCode||'');
        setCategory(['packages','transportPackages'].includes(entry.kind)?entry.packagingTypeCode?.slice(0,3)||'':entry.categoryCode||'');
        setError('');setNotice('');
    };
    const save=async()=>{
        if(!active||active==='namingSequence'||!draft||!canEdit)return;
        setBusy(true);setError('');setNotice('');
        try{
            const parameter:Partial<SkuParameter>={...draft};
            if(active==='containers'){
                parameter.metadataCode=typeCode;
                parameter.containerAttributes=draft.containerAttributes||{};
            }
            if((active==='packages'||active==='transportPackages')&&typeCode){
                parameter.packagingTypeCode=typeCode;
            }
            if(active==='packagingSizes'){
                parameter.name=String(parameter.quantity||'');
                parameter.description='';
            }
            const result=await callBackend<{record:SkuParameter}>('/api/org/pln-mfg/sku/setup/save',{
                kind:active,parameter,expectedRevision:parameter.revision??0,
            });
            await onSaved();setDraft(null);
            setNotice(result.record.name+' saved');
        }catch(e){setError(e instanceof Error?e.message:'Unable to save SKU configuration.');}
        finally{setBusy(false);}
    };
    const saveNaming=async()=>{
        if(!canEdit||!namingDraft)return;
        setBusy(true);setError('');setNotice('');
        try{
            await callBackend('/api/org/pln-mfg/sku/naming/save',{
                sequence:namingDraft,expectedRevision:setup.namingRevision,
            });
            await onSaved();
            setNotice('SKU naming sequence saved. Existing SKU names are unchanged.');
        }catch(e){setError(e instanceof Error?e.message:'Unable to save SKU naming sequence.');}
        finally{setBusy(false);}
    };
    const moveNaming=(i:number,change:number)=>{
        setNamingDraft(previous=>{
            if(!previous||i+change<0||i+change>=previous.steps.length)return previous;
            const steps=previous.steps.map(step=>({...step}));
            [steps[i],steps[i+change]]=[steps[i+change],steps[i]];
            return {...previous,steps};
        });
    };
    const addNamingComponent=()=>{
        const field=SKU_NAME_FIELDS.find(x=>x.key===namingFieldToAdd);
        if(!field||!canEdit)return;
        setNamingDraft(d=>d&&d.steps.length<32?{...d,steps:[...d.steps,{
            field:field.key,mode:field.modes[0] as SkuNameMode,enabled:true,
            ...(field.key==='literal'?{text:''}:{}),
        }]}:d);
        setNamingFieldToAdd('');setShowNamingPicker(false);setError('');
    };
    const removeNamingComponent=(i:number)=>{
        setNamingDraft(d=>d?{...d,steps:d.steps.filter((_,j)=>j!==i)}:d);
    };
    const changeNaming=(i:number,updates:Partial<SkuNamingSequence['steps'][number]>)=>{
        setNamingDraft(previous=>previous?{...previous,steps:previous.steps.map(
            (step,j)=>j===i?{...step,...updates}:step)}:previous);
    };
    const namingLayout=namingDraft?.steps.filter(step=>step.enabled).map(step=>{
        if(step.field==='literal')return step.text?.trim()||'[Custom text]';
        const label=SKU_NAME_FIELDS.find(f=>f.key===step.field)?.label||step.field;
        return '['+label+' · '+step.mode.toLowerCase().replaceAll('_',' ')+']';
    }).join(namingDraft?.separator??'_');
    return <section className={modal}>
        {!active?<>
            <h2 className='mb-2 text-base font-semibold sm:text-lg'>SKU Configuration</h2>
            <p className='mb-3 text-xs text-muted'>Configure the product identity and physical container before commercial packaging and reporting units.</p>
            <nav aria-label='SKU configuration' className='grid gap-3 lg:grid-cols-2'>
                {menuGroups.map((group,i)=><details key={group.title} className='min-w-0 rounded-xl border border-line bg-panel p-3' open={i===0}>
                    <summary className='cursor-pointer text-sm font-semibold'>
                        {i+1}. {group.title}
                        <span className='mt-1 block text-xs font-normal text-muted'>{group.hint}</span>
                    </summary>
                    {i===0&&<div className='mt-3'><SkuIdentityGuide onOpenSkus={onOpenSkus}/></div>}
                    <div className='mt-3 space-y-2'>
                        {group.keys.map(key=>{
                            const entry=menu.find(m=>m.key===key);
                            if(!entry)return null;
                            const Icon=entry.Icon;
                            return <button key={key} type='button' onClick={()=>open(key)}
                                className='flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-page px-2 py-2 text-left hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-brand'>
                                <Icon className='h-4 w-4 shrink-0 text-brand' aria-hidden='true'/>
                                <span className='min-w-0 flex-1'>
                                    <span className='block break-words text-xs font-semibold sm:text-sm'>
                                        {key==='productNames'?variantLabel:entry.title}
                                    </span>
                                    {identityHints[key]&&<span className='mt-1 block text-xs font-normal text-muted'>{identityHints[key]}</span>}
                                </span>
                                <ChevronRight className='h-4 w-4 shrink-0 text-muted' aria-hidden='true'/>
                            </button>;
                        })}
                    </div>
                </details>)}
                <section aria-label='SKU Naming Sequence' className='min-w-0 rounded-xl border border-line bg-panel p-3'>
                    <p className='mb-1 text-sm font-semibold'>SKU Naming Sequence</p>
                    <p className='mb-3 text-xs text-muted'>Standalone naming standard for manufactured SKUs; separate from product identity and physical configuration.</p>
                    <button type='button' onClick={()=>open('namingSequence')}
                        className='flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-page px-3 py-2 text-left hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-brand'>
                        <ListOrdered className='h-5 w-5 shrink-0 text-brand' aria-hidden='true'/>
                        <span className='min-w-0 flex-1 text-sm font-semibold'>Configure SKU naming sequence</span>
                        <ChevronRight className='h-5 w-5 shrink-0 text-muted' aria-hidden='true'/>
                    </button>
                </section>
            </nav>
        </>:<>
            <div className='mb-4 flex items-center gap-2'>
                <button type='button' className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line'
                    aria-label='Back to SKU configuration menu' onClick={()=>{setActive(null);setDraft(null);setError('');}}>
                    <ArrowLeft className='h-5 w-5' aria-hidden='true'/>
                </button>
                <h2 className='min-w-0 flex-1 text-lg font-semibold'>{kindName}</h2>
                {canEdit&&!draft&&active!=='namingSequence'&&<button type='button' className={primary} onClick={begin}>Add</button>}
            </div>
            {active==='namingSequence'?<div className='space-y-4'>
                <Choice title='Separator' value={namingDraft?.separator??'_'}
                    options={SKU_NAME_SEPARATORS.map(x=>[x.value,x.label])}
                    onChange={v=>setNamingDraft(d=>d?{...d,separator:v}:d)}/>
                <div className='space-y-2'>
                    {namingDraft?.steps.map((step,i)=>{
                        const field=SKU_NAME_FIELDS.find(x=>x.key===step.field);
                        return <div key={i} className='rounded-xl border border-line bg-panel p-3 space-y-3'>
                            <div className='flex items-center gap-2'>
                                <span className='flex-1 min-w-0 text-sm font-semibold'>
                                    {i+1}. {field?.label||step.field}
                                </span>
                                <button type='button' className={secondary} disabled={!canEdit||i===0}
                                    aria-label={'Move '+(field?.label||step.field)+' up'}
                                    onClick={()=>moveNaming(i,-1)}><ArrowUp className='h-4 w-4'/></button>
                                <button type='button' className={secondary}
                                    disabled={!canEdit||i===(namingDraft.steps.length-1)}
                                    aria-label={'Move '+(field?.label||step.field)+' down'}
                                    onClick={()=>moveNaming(i,1)}><ArrowDown className='h-4 w-4'/></button>
                                {canEdit&&<button type='button' className={secondary}
                                    aria-label={'Remove '+(field?.label||step.field)}
                                    onClick={()=>removeNamingComponent(i)}><Trash2 className='h-4 w-4'/></button>}
                            </div>
                            {step.field==='literal'
                                ?<TextInput title='Custom text' value={step.text||''}
                                    onChange={text=>changeNaming(i,{text})} required/>
                                :<Choice title='Use' value={step.mode}
                                    options={(field?.modes||['NAME']).map(mode=>
                                        [mode,mode==='QUANTITY_UNIT'?'Quantity + unit':
                                            mode==='QUANTITY'?'Quantity':mode==='CODE'?'Code':'Name'])}
                                    onChange={v=>changeNaming(i,{mode:v as SkuNameMode})}/>}
                        </div>;
                    })}
                    {!namingDraft?.steps.length&&<div className='rounded-xl border border-dashed border-line p-5 text-center text-sm text-muted'>
                        No naming components added. Use + Add component to build your sequence.
                    </div>}
                </div>
                {canEdit&&<div className='space-y-2'>
                    <button type='button' className={secondary+' inline-flex items-center gap-2'}
                        disabled={busy||(namingDraft?.steps.length??0)>=32}
                        onClick={()=>setShowNamingPicker(v=>!v)}>
                        <Plus className='h-4 w-4'/> Add component
                    </button>
                    {showNamingPicker&&<div className='space-y-3 rounded-xl border border-line bg-page p-3'>
                        <Choice title='What would you like to add?' value={namingFieldToAdd}
                            placeholder='Select attribute or custom text'
                            options={SKU_NAME_FIELDS.map(f=>[f.key,f.label])}
                            onChange={setNamingFieldToAdd}/>
                        <div className='flex flex-wrap gap-2'>
                            <button type='button' className={primary}
                                disabled={!namingFieldToAdd}
                                onClick={addNamingComponent}>Add to sequence</button>
                            <button type='button' className={secondary}
                                onClick={()=>{setShowNamingPicker(false);setNamingFieldToAdd('');}}>Cancel</button>
                        </div>
                    </div>}
                </div>}
                <div className='rounded-xl border border-line bg-page p-3' aria-live='polite'>
                    <p className='text-xs font-medium text-muted'>Naming sequence preview</p>
                    <p className='mt-2 break-all font-mono text-sm text-ink'>{namingLayout||'Add your first component'}</p>
                </div>
                {canEdit&&<div className='flex flex-wrap gap-2'>
                    <button type='button' className={primary}
                        disabled={busy||!namingDraft?.steps.length||namingDraft.steps.some(
                            step=>step.field==='literal'&&!step.text?.trim())}
                        onClick={()=>void saveNaming()}>{busy?'Saving…':'Save naming sequence'}</button>
                    <button type='button' className={secondary} disabled={busy||!namingDraft?.steps.length}
                        onClick={()=>setNamingDraft(d=>d?{...d,steps:[]}:d)}>Clear all</button>
                </div>}
                <p className='text-xs text-muted'>The internal SKU_######### code remains database-generated. Existing SKU names only change when explicitly regenerated.</p>
            </div>:!draft?<div className='space-y-2'>
                {records.map(row=><div key={row.id} className='flex min-h-14 items-center justify-between gap-2 rounded-xl border border-line px-3 py-2'>
                    <div className='min-w-0'>
                        <p className='text-sm font-medium'>{row.name}
                            {row.enabled===false&&<span className='ml-2 text-xs text-muted'>Inactive</span>}</p>
                        <p className='text-xs text-muted'>{active==='productNames'&&row.productCode?row.productCode+' · ':''}{active==='processClasses'&&row.processCode?row.processCode+' · ':''}{row.id}
                            {row.subcategoryCode?' · '+row.subcategoryCode:''}
                            {(active==='packages'||active==='transportPackages')&&row.packagingTypeCode?' · '+row.packagingTypeCode:''}</p>
                    </div>
                    {canEdit&&<button type='button' className={secondary} onClick={()=>edit(row)}>Edit</button>}
                </div>)}
                {!records.length&&<p className='py-6 text-center text-sm text-muted'>No configured values</p>}
            </div>:<div className='space-y-4 rounded-xl border border-line bg-page p-3'>
                <div className='flex items-center justify-between gap-2'>
                    <h3 className='font-semibold'>{draft.id?'Edit':'New'} {kindName}</h3>
                    <button type='button' className={secondary} onClick={()=>setDraft(null)}>Cancel</button>
                </div>
                {active==='processClasses'&&<>
                    <TextInput title='Manufacturing process classification name' value={draft.name||''}
                        onChange={v=>update('name',v)} required/>
                    <TextInput title='Classification code' value={draft.processCode||''}
                        onChange={v=>update('processCode',v.toUpperCase().replace(/\s+/g,'_'))}
                        hint='A unique 2–30 character business code. It can be added to your SKU naming sequence.'
                        required/>
                    <TextInput title='What manufacturing method does this group share?' value={draft.description||''}
                        onChange={v=>update('description',v)}/>
                    <p className='text-xs text-muted'>Group SKUs by their common production process, not flavor or material family. The classification code can be used in the SKU naming sequence (Code mode). The internal PRC number remains unchanged. Editing a classification does not rename existing SKUs.</p>
                </>}
                {active==='productNames'&&<>
                    <TextInput title={variantLabel+' name'} value={draft.name||''} onChange={v=>update('name',v)} required/>
                    <TextInput title={variantLabel+' code'} value={draft.productCode||''} onChange={v=>update('productCode',v.toUpperCase())} required/>
                    <TextInput title='Description' value={draft.description||''} onChange={v=>update('description',v)}/>
                </>}
                {active==='productionForms'&&<>
                    <TextInput title='Production form' value={draft.name||''} onChange={v=>update('name',v)} required/>
                    <UnitChoice key={draft.id||'new-form'} title='Production unit' value={draft.uom||''}
                        setup={setup} onChange={v=>update('uom',v)}/>
                    <TextInput title='Description' value={draft.description||''} onChange={v=>update('description',v)}/>
                </>}
                {active==='containers'&&<>
                    <Choice title='Container category' value={category} placeholder='Select category'
                        options={availableMetadata.categories.map(c=>[c.code,c.name])}
                        onChange={code=>{setCategory(code);setTypeCode('');update('containerAttributes',{});}}/>
                    <Choice title='Container subcategory / type' value={typeCode} placeholder='Select a primary container'
                        options={availableMetadata.types.filter(t=>t.categoryCode===category)
                            .map(t=>[t.code,t.name+' · '+t.subcategoryCode])}
                        onChange={code=>{setTypeCode(code);update('containerAttributes',{});}}/>
                    {metadataType&&<>
                        <p className='text-xs text-muted'>{metadataType.code} · {metadataType.category}</p>
                        {metadataType.attributes.slice(0,5).map(field=><Choice key={field.key}
                            title={field.label+(field.required?' *':'')} value={draft.containerAttributes?.[field.key]||''}
                            placeholder='Select' options={field.choices.map(option=>[option,option])}
                            onChange={value=>update('containerAttributes',{...draft.containerAttributes,[field.key]:value})}/>)}
                    </>}
                    <div className='rounded-xl border border-line p-3 space-y-3'>
                        <p className='text-sm font-semibold'>Manufacturing line speed / rated output basis</p>
                        <p className='text-xs text-muted'>What does one output unit represent? This is separate from the physical container material/type and the Each/Dozen count multiplier.</p>
                        <SelectField id='primary-container-rating-output-type' label='Output type used for line speed' required
                            value={draft.ratingOutputCode||'PRIMARY_CONTAINER'}
                            onChange={event=>update('ratingOutputCode',event.target.value)}>
                                {throughputOutputGroups().map(group=><optgroup key={group} label={group}>
                                    {THROUGHPUT_OUTPUTS.filter(x=>x.group===group).map(x=>
                                        <option key={x.code} value={x.code}>{x.name}</option>)}
                                </optgroup>)}
                        </SelectField>
                        <p className='text-xs text-muted'>{throughputOutput(draft.ratingOutputCode||'PRIMARY_CONTAINER')?.description}</p>
                        <p className='text-xs text-muted'>Default rated output count unit · Count category</p>
                        <Choice title='Count multiplier (Each, Dozen, etc.)'
                            value={draft.ratingCountUnitCode||'UOM-20-001'}
                            options={setup.units.filter(u=>u.category==='Count')
                                .map(u=>[u.code,u.label+' ('+u.symbol+')'])}
                            onChange={ratingCountUnitCode=>update('ratingCountUnitCode',ratingCountUnitCode)}/>
                        <p className='text-xs text-muted'>Example: Bottle + Each → bottles/hour; Case + Each → cases/hour; Kilogram + Each → kg/hour. A case is converted to bottles using the selected SKU commercial-packaging ratio; measured units use the SKU production-form dimension. A custom output needs its explicit primary-unit conversion at the cost centre. The configured type is the default for new SKU ratings only; existing saved ratings stay unchanged.</p>
                    </div>
                </>}
                {active==='containerSizes'&&<>
                    <TextInput title='Container size name' value={draft.name||''} onChange={v=>update('name',v)} required/>
                    <QuantityInput title='Quantity per container' value={draft.quantity||0} onChange={v=>update('quantity',v)}/>
                    <UnitChoice key={draft.id||'new-size'} title='Unit' value={draft.uom||''} setup={setup}
                        onChange={v=>update('uom',v)}/>
                </>}
                {(active==='packages'||active==='transportPackages')&&<>
                    <Choice title='Packaging category' value={category} placeholder='Select packaging category'
                        options={availablePackagingCategories.map(c=>[c.code,c.name])}
                        onChange={code=>{setCategory(code);setTypeCode('');update('containedPackagingId','');}}/>
                    <Choice title='Packaging type' value={typeCode} placeholder='Select packaging type'
                        options={availablePackagingTypes.filter(t=>t.code.slice(0,3)===category)
                            .map(t=>[t.code,t.name+' · '+t.code])}
                        onChange={code=>{setTypeCode(code);update('containedPackagingId','');}}/>
                    {packagingType&&<div className='rounded-xl border border-line p-3 text-xs text-muted'>
                        {packagingType.name} · {packagingType.level}
                        {active==='packages'?' · Commercial selling unit':' · Transport, storage or consolidated load'}
                    </div>}
                    <TextInput title='Name' value={draft.name||''} onChange={v=>update('name',v)} required/>
                    <TextInput title='Description' value={draft.description||''} onChange={v=>update('description',v)}/>
                    {draft.id&&draft.containersPerLayer&&draft.numberOfLayers&&<p className='text-xs text-muted'>
                        Previously configured layering remains stored. New stacking arrangements are set per SKU.
                    </p>}
                </>}
                {active==='packagingSizes'&&<>
                    <NumberInput title='Number of containers' value={draft.quantity||0}
                        onChange={v=>update('quantity',v)}/>
                </>}
                {active==='normalizationUnits'&&<>
                    <TextInput title='Normalized unit name' value={draft.name||''}
                        onChange={v=>update('name',v)} required/>
                    <Choice title='Reference production form' value={draft.referenceProductionFormId||''}
                        placeholder='Select production form'
                        options={setup.parameters.filter(p=>p.kind==='productionForms'&&p.enabled!==false)
                            .map(p=>[p.id,p.name+' · '+(pickUnit(setup,p.uom)?.symbol||p.uom||'')])}
                        onChange={id=>{
                            const selected=setup.parameters.find(p=>p.kind==='productionForms'&&p.id===id);
                            setDraft(prev=>({...prev,referenceProductionFormId:id,baseUom:selected?.uom||''}));
                        }}/>
                    <Choice title='Normalization operator' value={draft.normalizationOperator||'DIVIDE'}
                        options={[[ 'DIVIDE','Divide ( ÷ )'],['MULTIPLY','Multiply ( × )']]}
                        onChange={v=>update('normalizationOperator',v)}/>
                    <QuantityInput title={(draft.normalizationOperator==='MULTIPLY'
                        ?'Multiplier: normalized units per reference unit ('
                        :'Reference quantity per normalized unit (')+
                        (pickUnit(setup,draft.baseUom)?.symbol||draft.baseUom||'select a form')+')'}
                        value={draft.quantityPerUnit||0} onChange={v=>update('quantityPerUnit',v)}/>
                    {!draft.id&&!draft.referenceProductionFormId&&<p className='text-xs text-muted'>
                        Select a production form to establish the reference measurement unit.
                    </p>}
                    {draft.id&&!draft.referenceProductionFormId&&<p className='text-xs text-muted'>
                        Existing normalization reference: {draft.baseUom}. Select a production form to link it.
                    </p>}
                </>}
                <label className='flex min-h-11 items-center gap-2 text-sm'>
                    <input type='checkbox' checked={draft.enabled!==false} onChange={e=>update('enabled',e.target.checked)}/>
                    Active
                </label>
                <button type='button' className={primary} disabled={busy||
                    (active==='containers'?(!typeCode||!metadataType?.attributes.filter(a=>a.required).every(a=>draft.containerAttributes?.[a.key])):
                    (active==='packages'||active==='transportPackages')?(!typeCode||!draft.name?.trim()):
                    active==='packagingSizes'?!(Number.isSafeInteger(draft.quantity)&&Number(draft.quantity)>0):
                    !draft.name?.trim())} onClick={()=>void save()}>{busy?'Saving…':'Save'}</button>
            </div>}
        </>}
        {error&&<p role='alert' className='mt-3 rounded-xl border border-red-400 p-3 text-sm text-red-500'>{error}</p>}
        {notice&&<p role='status' className='mt-3 rounded-xl border border-line p-3 text-sm text-brand'>{notice}</p>}
    </section>;
}
