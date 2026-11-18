import {useId,useState} from 'react';
import {ArrowLeft,Box,ChevronRight,Layers3,Maximize2,Package,PackageOpen,Shapes, type LucideIcon} from 'lucide-react';
import {Field,SelectField} from '../components/ui';
import {callBackend} from '../lib/backend';

export type SkuParameterKind='productNames'|'productionForms'|'containers'|'containerSizes'|'packages'|'packagingSizes'|'packageCounts'|'normalizationUnits';
export type SkuParameter={
    id:string;kind:SkuParameterKind;name:string;enabled?:boolean;description?:string;
    quantity?:number;uom?:string;baseUom?:string;quantityPerUnit?:number;revision?:number;
    categoryCode?:string;unitCode?:string;unitCount?:number;productCode?:string;
    metadataCode?:string;subcategoryCode?:string;containerAttributes?:Record<string,string>;
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
    conventions:Record<string,string|number>;
};
export const emptySkuSetup:SkuSetup={
    parameters:[],
    groups:{productNames:'NME',productionForms:'FRM',containers:'CNT',containerSizes:'SIZ',
        packages:'PKG',packagingSizes:'PSZ',packageCounts:'PCT',normalizationUnits:'NRM'},
    units:[],categories:[],primaryContainerMetadata:{version:1,categories:[],types:[]},
    packagingMetadata:{version:1,categories:[],types:[]},
    conventions:{items:'SKU',boms:'BOM',recipes:'RCP',resources:'RSC',
        routings:'RTG',batches:'BTH',digits:9},
};
export type SkuSelections={
    productNameId?:string;productionFormId?:string;containerId?:string;containerSizeId?:string;
    packageId?:string;packagingSizeId?:string;packageCountId?:string;normalizationUnitId?:string;
};
type MenuKey=Exclude<SkuParameterKind,'packageCounts'>;
export const SKU_GROUPS:Array<{kind:MenuKey;title:string}>=[
    {kind:'productNames',title:'Product / SKU Names'},
    {kind:'productionForms',title:'Production Forms'},
    {kind:'containers',title:'Physical Containers'},
    {kind:'containerSizes',title:'Container Sizes'},
    {kind:'packages',title:'Container Packaging'},
    {kind:'packagingSizes',title:'Container Packaging Sizes'},
    {kind:'normalizationUnits',title:'Normalization Units'},
];
type IconComponent=LucideIcon;
const menu:Array<{key:MenuKey;title:string;Icon:IconComponent}>=[
    {key:'productNames',title:'Product / SKU Names',Icon:Box},
    {key:'productionForms',title:'Production Forms',Icon:Layers3},
    {key:'containers',title:'Physical Containers',Icon:PackageOpen},
    {key:'containerSizes',title:'Container Sizes',Icon:Maximize2},
    {key:'packages',title:'Container Packaging',Icon:Package},
    {key:'packagingSizes',title:'Container Packaging Sizes',Icon:Box},
    {key:'normalizationUnits',title:'Normalization Units',Icon:Shapes},
];
const variants:Array<{key:keyof SkuSelections;kind:SkuParameterKind;label:string}>=[
    {key:'productNameId',kind:'productNames',label:'Product / SKU name'},
    {key:'productionFormId',kind:'productionForms',label:'Production form'},
    {key:'containerId',kind:'containers',label:'Physical container'},
    {key:'containerSizeId',kind:'containerSizes',label:'Container size'},
    {key:'packageId',kind:'packages',label:'Container packaging'},
    {key:'packagingSizeId',kind:'packagingSizes',label:'Containers per packaging'},
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
function UnitChoice({title,value,setup,onChange}:{title:string;value:string;setup:SkuSetup;onChange:(v:string)=>void}){
    const [category,setCategory]=useState('');
    const fromRecord=pickUnit(setup,value)?.categoryCode||'';
    const activeCategory=fromRecord||category;
    return <div className='grid gap-3 sm:grid-cols-2'>
        <Choice title='Unit category' value={activeCategory} placeholder='Select category'
            options={setup.categories.map(c=>[c.code,c.name])}
            onChange={next=>{setCategory(next);onChange('');}}/>
        <Choice title={title} value={value} placeholder='Select unit'
            options={setup.units.filter(u=>u.categoryCode===activeCategory)
                .map(u=>[u.code,u.label+' ('+u.symbol+')'])} onChange={onChange}/>
    </div>;
}

export function SkuConfigurationFields({value,onChange,setup}:{
    value:SkuSelections;onChange:(next:SkuSelections)=>void;setup:SkuSetup;
}){
    const form=getParam(setup,'productionForms',value.productionFormId);
    const container=getParam(setup,'containers',value.containerId);
    const size=getParam(setup,'containerSizes',value.containerSizeId);
    const packageRecord=getParam(setup,'packages',value.packageId);
    const packSize=value.packagingSizeId
        ?getParam(setup,'packagingSizes',value.packagingSizeId)
        :getParam(setup,'packageCounts',value.packageCountId);
    const norm=getParam(setup,'normalizationUnits',value.normalizationUnitId);
    const contentPerContainer=size&&form&&ratio(setup,size.uom,form.uom)!==null
        ?(size.quantity??0)*ratio(setup,size.uom,form.uom)!:null;
    const effectivePackSize=packageRecord?.packagingTypeCode
        ?packagePrimaryCount(packageRecord,setup.parameters)
        :packSize?.quantity??null;
    const contentPerPackage=effectivePackSize!==null&&contentPerContainer!==null
        ?contentPerContainer*effectivePackSize:null;
    const normalBase=norm&&form&&ratio(setup,norm.baseUom,form.uom)!==null
        ?(norm.quantityPerUnit??0)*ratio(setup,norm.baseUom,form.uom)!:null;
    const factor=normalBase&&contentPerPackage!==null?contentPerPackage/normalBase:null;
    const product=getParam(setup,'productNames',value.productNameId)?.name||'Select product';
    const title=[product,[size?.name,container?.name].filter(Boolean).join(' '),
        [packageRecord?.name,packSize?'x'+packSize.quantity:''].filter(Boolean).join(' ')]
        .filter(Boolean).join(' · ');
    const optionsFor=(kind:SkuParameterKind):Array<[string,string]>=>setup.parameters
        .filter(p=>p.kind===kind&&p.enabled!==false&&
            (kind!=='containers'||!value.productionFormId||!p.categoryCode?.startsWith('UOM-')||
                p.categoryCode===pickUnit(setup,form?.uom)?.categoryCode))
        .map(p=>[p.id,p.name] as [string,string]);
    return <section className={modal+' space-y-3'}>
        <h3 className='text-base font-semibold'>SKU composition</h3>
        <div className='grid gap-3 sm:grid-cols-2'>
            {variants.map(v=><Choice key={v.key} title={v.label}
                value={value[v.key]||(!value.packagingSizeId&&v.kind==='packagingSizes'?value.packageCountId||'':'')}
                options={v.kind==='packagingSizes'&&value.packageCountId
                    ?[...optionsFor(v.kind),...setup.parameters.filter(p=>p.kind==='packageCounts'&&p.id===value.packageCountId).map(p=>[p.id,p.name] as [string,string])]
                    :optionsFor(v.kind)}
                onChange={selected=>{
                    if(v.key==='productionFormId')onChange({...value,productionFormId:selected,containerId:'',
                        containerSizeId:'',normalizationUnitId:''});
                    else if(v.key==='packagingSizeId')onChange({...value,packagingSizeId:selected,packageCountId:''});
                    else onChange({...value,[v.key]:selected});
                }}/>)}
        </div>
        <div className='rounded-xl border border-line bg-page p-3 text-sm' aria-live='polite'>
            <p className='font-medium text-ink'>{title}</p>
            {contentPerContainer!==null&&<p className='mt-1 text-muted'>Per container: {pretty(contentPerContainer)} {pickUnit(setup,form?.uom)?.symbol||form?.uom}</p>}
            {packageRecord?.packagingTypeCode&&<p className='mt-1 text-muted'>
                {packageRecord.containersPerLayer} {packageRecord.containedUnit==='PACKAGING'?'packages':'containers'} per layer × {packageRecord.numberOfLayers} layers
                {effectivePackSize!==null?' · '+pretty(effectivePackSize)+' primary containers':''}
            </p>}
            {contentPerPackage!==null&&<p className='mt-1 text-muted'>Per package: {pretty(contentPerPackage)} {pickUnit(setup,form?.uom)?.symbol||form?.uom}</p>}
            {factor!==null&&<p className='mt-1 font-semibold text-brand'>Conversion factor: {pretty(factor)} {norm?.name} / {packageRecord?.name}</p>}
            {size&&form&&contentPerContainer===null&&<p className='mt-1 text-red-500'>Container size unit is incompatible with production form.</p>}
        </div>
    </section>;
}

export function SkuSetupPanel({setup,canEdit,onSaved}:{setup:SkuSetup;canEdit:boolean;onSaved:()=>Promise<void>}){
    const [active,setActive]=useState<MenuKey|null>(null);
    const [draft,setDraft]=useState<Partial<SkuParameter>|null>(null);
    const [busy,setBusy]=useState(false);
    const [error,setError]=useState(''),[notice,setNotice]=useState('');
    const [category,setCategory]=useState('');
    const [typeCode,setTypeCode]=useState('');
    const availableMetadata=setup.primaryContainerMetadata||emptySkuSetup.primaryContainerMetadata;
    const metadataType=availableMetadata.types.find(t=>t.code===typeCode);
    const packagingMetadata=setup.packagingMetadata||emptySkuSetup.packagingMetadata;
    const packagingType=packagingMetadata.types.find(t=>t.code===typeCode);
    const packagedUnitTotal=Number(draft?.containersPerLayer)*Number(draft?.numberOfLayers);
    const validLayerCount=Number.isSafeInteger(packagedUnitTotal)&&packagedUnitTotal>0&&packagedUnitTotal<=10000000;
    const kindName=menu.find(x=>x.key===active)?.title||'SKU Configuration';
    const records=active?setup.parameters.filter(p=>p.kind===active):[];
    const update=(field:keyof SkuParameter,value:unknown)=>setDraft(d=>({...d,[field]:value}));
    const open=(kind:MenuKey)=>{setActive(kind);setDraft(null);setError('');setNotice('');setCategory('');setTypeCode('');};
    const begin=()=>{
        setDraft({name:'',enabled:true});
        setTypeCode('');
        setError('');setNotice('');
    };
    const edit=(entry:SkuParameter)=>{
        setDraft({...entry});
        setTypeCode(entry.kind==='packages'?entry.packagingTypeCode||'':entry.metadataCode||'');
        setCategory(entry.categoryCode||'');
        setError('');setNotice('');
    };
    const save=async()=>{
        if(!active||!draft||!canEdit)return;
        setBusy(true);setError('');setNotice('');
        try{
            const parameter:Partial<SkuParameter>={...draft};
            if(active==='containers'){
                parameter.metadataCode=typeCode;
                parameter.containerAttributes=draft.containerAttributes||{};
            }
            if(active==='packages'&&typeCode){
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
    return <section className={modal}>
        {!active?<>
            <h2 className='mb-4 text-lg font-semibold'>SKU Configuration</h2>
            <nav aria-label='SKU configuration' className='space-y-2'>
                {menu.map(({key,title,Icon})=><button key={key} type='button' onClick={()=>open(key)}
                    className='flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2 text-left transition-colors hover:bg-page focus-visible:outline-2 focus-visible:outline-brand'>
                    <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand'>
                        <Icon className='h-5 w-5' aria-hidden='true'/>
                    </span>
                    <span className='min-w-0 flex-1 text-sm font-semibold'>{title}</span>
                    <ChevronRight className='h-5 w-5 shrink-0 text-muted' aria-hidden='true'/>
                </button>)}
            </nav>
        </>:<>
            <div className='mb-4 flex items-center gap-2'>
                <button type='button' className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line'
                    aria-label='Back to SKU configuration menu' onClick={()=>{setActive(null);setDraft(null);setError('');}}>
                    <ArrowLeft className='h-5 w-5' aria-hidden='true'/>
                </button>
                <h2 className='min-w-0 flex-1 text-lg font-semibold'>{kindName}</h2>
                {canEdit&&!draft&&<button type='button' className={primary} onClick={begin}>Add</button>}
            </div>
            {!draft?<div className='space-y-2'>
                {records.map(row=><div key={row.id} className='flex min-h-14 items-center justify-between gap-2 rounded-xl border border-line px-3 py-2'>
                    <div className='min-w-0'>
                        <p className='text-sm font-medium'>{row.name}
                            {row.enabled===false&&<span className='ml-2 text-xs text-muted'>Inactive</span>}</p>
                        <p className='text-xs text-muted'>{active==='productNames'&&row.productCode?row.productCode+' · ':''}{row.id}
                            {row.subcategoryCode?' · '+row.subcategoryCode:''}
                            {active==='packages'&&row.packagingTypeCode?' · '+row.packagingTypeCode+' · '+(row.containersPerLayer||0)+' × '+(row.numberOfLayers||0)+' layers':''}</p>
                    </div>
                    {canEdit&&<button type='button' className={secondary} onClick={()=>edit(row)}>Edit</button>}
                </div>)}
                {!records.length&&<p className='py-6 text-center text-sm text-muted'>No configured values</p>}
            </div>:<div className='space-y-4 rounded-xl border border-line bg-page p-3'>
                <div className='flex items-center justify-between gap-2'>
                    <h3 className='font-semibold'>{draft.id?'Edit':'New'} {kindName}</h3>
                    <button type='button' className={secondary} onClick={()=>setDraft(null)}>Cancel</button>
                </div>
                {active==='productNames'&&<>
                    <TextInput title='SKU name' value={draft.name||''} onChange={v=>update('name',v)} required/>
                    <TextInput title='SKU code' value={draft.productCode||''} onChange={v=>update('productCode',v.toUpperCase())} required/>
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
                </>}
                {active==='containerSizes'&&<>
                    <TextInput title='Container size name' value={draft.name||''} onChange={v=>update('name',v)} required/>
                    <QuantityInput title='Quantity per container' value={draft.quantity||0} onChange={v=>update('quantity',v)}/>
                    <UnitChoice key={draft.id||'new-size'} title='Unit' value={draft.uom||''} setup={setup}
                        onChange={v=>update('uom',v)}/>
                </>}
                {active==='packages'&&<>
                    <Choice title='Packaging category' value={category} placeholder='Select packaging category'
                        options={packagingMetadata.categories.map(c=>[c.code,c.name])}
                        onChange={code=>{setCategory(code);setTypeCode('');update('containedPackagingId','');}}/>
                    <Choice title='Packaging type' value={typeCode} placeholder='Select packaging type'
                        options={packagingMetadata.types.filter(t=>t.code.slice(0,3)===category)
                            .map(t=>[t.code,t.name+' · '+t.code])}
                        onChange={code=>{setTypeCode(code);update('containedPackagingId','');}}/>
                    {packagingType&&<div className='rounded-xl border border-line p-3 text-xs text-muted'>
                        {packagingType.level} · {packagingType.containedUnit==='PACKAGING'?'Consolidates lower-level packages':'Holds primary containers'}
                    </div>}
                    {packagingType?.containedUnit==='PACKAGING'&&<Choice
                        title='Contained packaging (lower level)' value={draft.containedPackagingId||''}
                        placeholder='Select a configured package'
                        options={setup.parameters.filter(p=>p.kind==='packages'&&p.id!==draft.id&&p.enabled!==false
                            &&!!p.packagingTypeCode&&p.level!=='TRANSPORT'&&p.level!=='BULK')
                            .map(p=>[p.id,p.name+' · '+(p.quantity||0)+' contained units'])}
                        onChange={code=>update('containedPackagingId',code)}/>}
                    <TextInput title='Name' value={draft.name||''} onChange={v=>update('name',v)} required/>
                    <TextInput title='Description' value={draft.description||''} onChange={v=>update('description',v)}/>
                    <NumberInput title={packagingType?.containedUnit==='PACKAGING'?'Packages per layer':'Containers per layer'}
                        value={draft.containersPerLayer||0} onChange={v=>update('containersPerLayer',v)}/>
                    <NumberInput title='Number of layers' value={draft.numberOfLayers||0}
                        onChange={v=>update('numberOfLayers',v)}/>
                    {validLayerCount&&<p className='rounded-xl border border-line p-3 text-sm font-medium text-brand'
                        role='status'>Total: {packagedUnitTotal} {packagingType?.containedUnit==='PACKAGING'?'packages':'containers'} per load</p>}
                </>}
                {active==='packagingSizes'&&<>
                    <NumberInput title='Number of containers' value={draft.quantity||0}
                        onChange={v=>update('quantity',v)}/>
                </>}
                {active==='normalizationUnits'&&<>
                    <TextInput title='Normalization unit' value={draft.name||''} onChange={v=>update('name',v)} required/>
                    <QuantityInput title='Quantity per normalized unit' value={draft.quantityPerUnit||0}
                        onChange={v=>update('quantityPerUnit',v)}/>
                    <UnitChoice key={draft.id||'new-normalization'} title='Unit' value={draft.baseUom||''}
                        setup={setup} onChange={v=>update('baseUom',v)}/>
                </>}
                <label className='flex min-h-11 items-center gap-2 text-sm'>
                    <input type='checkbox' checked={draft.enabled!==false} onChange={e=>update('enabled',e.target.checked)}/>
                    Active
                </label>
                <button type='button' className={primary} disabled={busy||
                    (active==='containers'?(!typeCode||!metadataType?.attributes.filter(a=>a.required).every(a=>draft.containerAttributes?.[a.key])):
                    active==='packages'?(!typeCode||!draft.name?.trim()||!validLayerCount||
                        (packagingType?.containedUnit==='PACKAGING'&&!draft.containedPackagingId)):
                    active==='packagingSizes'?!(Number.isSafeInteger(draft.quantity)&&Number(draft.quantity)>0):
                    !draft.name?.trim())} onClick={()=>void save()}>{busy?'Saving…':'Save'}</button>
            </div>}
        </>}
        {error&&<p role='alert' className='mt-3 rounded-xl border border-red-400 p-3 text-sm text-red-500'>{error}</p>}
        {notice&&<p role='status' className='mt-3 rounded-xl border border-line p-3 text-sm text-brand'>{notice}</p>}
    </section>;
}
