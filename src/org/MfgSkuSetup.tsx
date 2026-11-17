import {useId,useMemo,useState} from 'react';
import {ArrowLeft,Box,Boxes,ChevronRight,Layers3,Maximize2,Package,PackageOpen,Ruler,Shapes} from 'lucide-react';
import {Field,SelectField} from '../components/ui';
import {callBackend} from '../lib/backend';

export type SkuParameterKind='productNames'|'productionForms'|'containers'|'containerSizes'|'packages'|'packageCounts'|'normalizationUnits';
export type SkuParameter={
    id:string;kind:SkuParameterKind;name:string;enabled?:boolean;description?:string;
    quantity?:number;uom?:string;baseUom?:string;quantityPerUnit?:number;revision?:number;
    categoryCode?:string;unitCode?:string;unitCount?:number;
};
export type MeasureUnit={code:string;label:string;symbol:string;category:string;categoryCode:string;baseUnit:string;multiplier:number};
export type MeasureCategory={code:string;name:string};
export type SkuSetup={
    parameters:SkuParameter[];groups:Record<SkuParameterKind,string>;units:MeasureUnit[];categories:MeasureCategory[];
    conventions:Record<string,string|number>;
};
export const emptySkuSetup:SkuSetup={
    parameters:[],groups:{productNames:'NME',productionForms:'FRM',containers:'CNT',
        containerSizes:'SIZ',packages:'PKG',packageCounts:'PCT',normalizationUnits:'NRM'},
    units:[],categories:[],conventions:{items:'SKU',boms:'BOM',recipes:'RCP',resources:'RSC',
        routings:'RTG',batches:'BTH',digits:9},
};
export type SkuSelections={
    productNameId?:string;productionFormId?:string;containerId?:string;containerSizeId?:string;
    packageId?:string;packageCountId?:string;normalizationUnitId?:string;
};
export const SKU_GROUPS:Array<{kind:SkuParameterKind;title:string;hint:string}>=[
    {kind:'productNames',title:'Product / SKU Names',hint:'Fanta, water, milk, detergent, etc.'},
    {kind:'productionForms',title:'Production Forms',hint:'Liquid (L), mass (kg), pieces (ea), or other manufactured forms'},
    {kind:'containers',title:'Physical Containers',hint:'Bottle, can, pouch, bag, drum, tank or other containment'},
    {kind:'containerSizes',title:'Container Sizes',hint:'Volume, weight or item quantity per container'},
    {kind:'packages',title:'Sales / Physical Packages',hint:'Case, tray, crate, pack or pallet; specify its counting code'},
    {kind:'packageCounts',title:'Package Containment',hint:'Number of containers in a physical package (6, 12, 24 etc.)'},
    {kind:'normalizationUnits',title:'Normalization Units',hint:'Standardized quantity, e.g. configurable L per unit case'},
];
const variants:{key:keyof SkuSelections;kind:SkuParameterKind;label:string}[]=[
    {key:'productNameId',kind:'productNames',label:'Product / SKU name'},
    {key:'productionFormId',kind:'productionForms',label:'Production form / base quantity'},
    {key:'containerId',kind:'containers',label:'Production container'},
    {key:'containerSizeId',kind:'containerSizes',label:'Container size'},
    {key:'packageId',kind:'packages',label:'Physical sales package'},
    {key:'packageCountId',kind:'packageCounts',label:'Containers per package'},
    {key:'normalizationUnitId',kind:'normalizationUnits',label:'Normalization standard'},
];
const nice=(value:number)=>Number(value.toPrecision(9)).toLocaleString(undefined,{maximumFractionDigits:9});
const found=(setup:SkuSetup,kind:SkuParameterKind,id:string|undefined)=>
    setup.parameters.find(p=>p.kind===kind&&p.id===id);
const pickUnit=(setup:SkuSetup,code:string|undefined)=>{
    if(!code)return undefined;
    return setup.units.find(u=>u.code===code)||setup.units.find(u=>u.symbol===code);
};
function convert(setup:SkuSetup,from:string|undefined,to:string|undefined):number|null{
    const a=pickUnit(setup,from),b=pickUnit(setup,to);
    if(!a||!b||a.category!==b.category||a.baseUnit!==b.baseUnit)return null;
    return a.multiplier/b.multiplier;
}

function ConfigSelect({title,value,options,onChange,placeholder='Select a configured value'}:{
    title:string;value:string;options:Array<[string,string]>;onChange:(v:string)=>void;placeholder?:string;
}){
    const id=useId();
    return <SelectField label={title} id={id} value={value} onChange={e=>onChange(e.target.value)}>
        <option value=''>{placeholder}</option>
        {options.map(([v,t])=><option key={v} value={v}>{t}</option>)}
    </SelectField>;
}
function Numeric({title,value,onChange,hint}:{title:string;value:number;onChange:(v:number)=>void;hint?:string}){
    const id=useId();
    return <Field label={title} id={id} hint={hint} type='number' step='any' min='0' value={value} onChange={e=>onChange(Number(e.target.value))}/>;
}
function Named({title,value,onChange,hint,required=false}:{title:string;value:string;onChange:(v:string)=>void;hint?:string;required?:boolean}){
    const id=useId();
    return <Field label={title} id={id} value={value} hint={hint} required={required} onChange={e=>onChange(e.target.value)}/>;
}
function Measure({label,value,setup,onChange}:{label:string;value:string;setup:SkuSetup;onChange:(v:string)=>void}){
    const [chosenCategory,setChosenCategory]=useState('');
    const selectedUnit=pickUnit(setup,value);
    const category=selectedUnit?.categoryCode||chosenCategory;
    const categories=setup.categories.length?setup.categories:
        [...new Map(setup.units.map(u=>[u.categoryCode,{code:u.categoryCode,name:u.category}])).values()];
    return <div className='grid gap-3 sm:grid-cols-2'>
        <ConfigSelect title='Unit category' value={category} placeholder='Select category'
            options={categories.map(c=>[c.code,c.name] as [string,string])}
            onChange={code=>{setChosenCategory(code);onChange('');}}/>
        <ConfigSelect title={label} value={value} placeholder='Select unit' onChange={onChange}
            options={setup.units.filter(u=>u.categoryCode===category)
                .map(u=>[u.code,u.label+' ('+u.symbol+')'] as [string,string])}/>
    </div>;
}
const boxClass='rounded-2xl border border-line bg-panel p-3 sm:p-4';
const solid='min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand disabled:opacity-50';
const subtle='min-h-11 rounded-xl border border-line px-3 text-sm text-ink disabled:opacity-50';

export function SkuConfigurationFields({value,onChange,setup}:{
    value:SkuSelections;onChange:(next:SkuSelections)=>void;setup:SkuSetup;
}){
    const selections=useMemo(()=>variants.map(v=>({...v,record:found(setup,v.kind,value[v.key])})),[setup,value]);
    const form=found(setup,'productionForms',value.productionFormId);
    const size=found(setup,'containerSizes',value.containerSizeId);
    const count=found(setup,'packageCounts',value.packageCountId);
    const pack=found(setup,'packages',value.packageId);
    const norm=found(setup,'normalizationUnits',value.normalizationUnitId);
    const unitsFactor=size&&form?convert(setup,size.uom,form.uom):null;
    const perContainer=size&&unitsFactor!==null?(size.quantity??0)*unitsFactor:null;
    const perPack=perContainer!==null&&count?perContainer*(count.quantity??0):null;
    const normFactor=norm&&form?convert(setup,norm.baseUom,form.uom):null;
    const normBase=norm&&normFactor!==null?(norm.quantityPerUnit??0)*normFactor:null;
    const finalFactor=perPack!==null&&normBase&&normBase>0?perPack/normBase:null;
    const product=found(setup,'productNames',value.productNameId)?.name||'Select product';
    const previewName=[product,[size?.name,found(setup,'containers',value.containerId)?.name].filter(Boolean).join(' '),
        [pack?.name,count?'x'+count.name:''].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    const optionsFor=(kind:SkuParameterKind):Array<[string,string]>=>setup.parameters
        .filter(p=>p.kind===kind&&p.enabled!==false&&
            (kind!=='containers'||!value.productionFormId||!p.categoryCode||p.categoryCode===pickUnit(setup,found(setup,'productionForms',value.productionFormId)?.uom)?.categoryCode))
        .map(p=>[p.id, [p.name,
            p.kind==='containerSizes'&&p.uom?String(p.quantity)+' '+(pickUnit(setup,p.uom)?.symbol||p.uom):'',
            p.kind==='normalizationUnits'?String(p.quantityPerUnit)+' '+(pickUnit(setup,p.baseUom)?.symbol||p.baseUom):'',
        ].filter(Boolean).join(' · ')] as [string,string]);
    return <section className={boxClass+' space-y-3'}>
        <div>
            <h3 className='text-base font-semibold text-ink'>SKU composition</h3>
            <p className='text-xs text-muted'>All attributes come from the organization SKU configuration master. The code and conversion factors are generated by MEMS.</p>
        </div>
        <div className='grid gap-3 sm:grid-cols-2'>
            {selections.map(group=><ConfigSelect key={group.key} title={group.label}
                value={value[group.key]||''} onChange={v=>{
                    if(group.key==='productionFormId')onChange({...value,productionFormId:v,containerId:'',containerSizeId:'',normalizationUnitId:''});
                    else onChange({...value,[group.key]:v});
                }}
                options={optionsFor(group.kind)}/>)}
        </div>
        <div className='rounded-xl border border-line bg-page p-3 space-y-1' aria-live='polite'>
            <p className='font-semibold text-ink'>{previewName}</p>
            {perContainer!==null&&<p className='text-sm text-soft'>Content per container: {nice(perContainer)} {pickUnit(setup,form?.uom)?.symbol||form?.uom}</p>}
            {perPack!==null&&<p className='text-sm text-soft'>Content per {pack?.name}: {nice(perPack)} {pickUnit(setup,form?.uom)?.symbol||form?.uom} ({count?.quantity} containers)</p>}
            {finalFactor!==null&&<p className='text-sm font-semibold text-brand'>Conversion factor: {nice(finalFactor)} {norm?.name} per {pack?.name}</p>}
            {finalFactor!==null&&<p className='text-sm text-soft'>Reverse conversion: {nice(1/finalFactor)} {pack?.name} per {norm?.name}</p>}
            {size&&form&&unitsFactor===null&&<p className='text-sm text-red-400'>Container size and production form units are incompatible.</p>}
            {norm&&form&&normFactor===null&&<p className='text-sm text-red-400'>Normalization and production form units are incompatible.</p>}
            {!setup.parameters.length&&<p className='text-sm text-muted'>Set up SKU parameters first, under SKU Configuration.</p>}
        </div>
    </section>;
}


type MenuKey=SkuParameterKind|'units';
const menuOrder:Array<{key:MenuKey;title:string;description?:string;Icon:typeof Box}>=[
    {key:'productNames',title:'Product / SKU Names',Icon:Box},
    {key:'productionForms',title:'Production Forms',Icon:Layers3},
    {key:'units',title:'Units',description:'Select category, then unit',Icon:Ruler},
    {key:'containers',title:'Physical Containers',description:'From unit category and subcategory',Icon:PackageOpen},
    {key:'containerSizes',title:'Container Sizes',Icon:Maximize2},
    {key:'packages',title:'Packages',Icon:Package},
    {key:'packageCounts',title:'Package Containment',description:'From units',Icon:Boxes},
    {key:'normalizationUnits',title:'Normalization Units',Icon:Shapes},
];
export function SkuSetupPanel({setup,canEdit,onSaved}:{
    setup:SkuSetup;canEdit:boolean;onSaved:()=>Promise<void>;
}){
    const [active,setActive]=useState<MenuKey|null>(null);
    const [draft,setDraft]=useState<Partial<SkuParameter>|null>(null);
    const [busy,setBusy]=useState(false),[error,setError]=useState(''),[info,setInfo]=useState('');
    const [unitCategory,setUnitCategory]=useState(''),[unitCode,setUnitCode]=useState('');
    const categories=setup.categories.length?setup.categories:
        [...new Map(setup.units.map(u=>[u.categoryCode,{code:u.categoryCode,name:u.category}])).values()];
    const group=active===null?null:menuOrder.find(x=>x.key===active);
    const records=active===null||active==='units'?[]:setup.parameters.filter(x=>x.kind===active);
    const countUnits=setup.units.filter(u=>u.category==='Count'&&Number.isSafeInteger(u.multiplier)&&u.multiplier>0);
    const chosenCountUnit=countUnits.find(u=>u.code===draft?.unitCode);
    const chosenCount=chosenCountUnit&&draft?.unitCount?Number(draft.unitCount)*chosenCountUnit.multiplier:0;
    const selectedUnit=setup.units.find(u=>u.code===unitCode);
    const update=(key:keyof SkuParameter,value:unknown)=>setDraft(d=>({...d,[key]:value}));
    const open=(key:MenuKey)=>{
        setActive(key);setDraft(null);setError('');setInfo('');setUnitCategory('');setUnitCode('');
    };
    const edit=(entry:SkuParameter)=>{
        setDraft(entry.kind==='packageCounts'&&!entry.unitCode?
            {...entry,unitCode:countUnits.find(u=>u.symbol==='ea')?.code||'',unitCount:entry.quantity||1}:entry);
        setError('');setInfo('');
    };
    const save=async()=>{
        if(!draft||!canEdit||!active||active==='units')return;
        setBusy(true);setError('');setInfo('');
        try{
            const parameter=active==='packageCounts'?{...draft,name:String(chosenCount)}:draft;
            const result=await callBackend<{record:SkuParameter}>('/api/org/pln-mfg/sku/setup/save',{
                kind:active,parameter,expectedRevision:draft.revision||0,
            });
            await onSaved();setDraft(null);
            setInfo(result.record.name+' saved');
        }catch(e){setError(e instanceof Error?e.message:'Could not save configuration.');}
        finally{setBusy(false);}
    };
    const startNew=()=>{
        const initial:Partial<SkuParameter>={name:'',enabled:true};
        if(active==='packageCounts'){initial.unitCount=1;initial.unitCode='';}
        if(active==='containers'&&unitCategory)initial.categoryCode=unitCategory;
        setDraft(initial);setError('');setInfo('');
    };
    return <section className='rounded-2xl border border-line bg-panel p-3 text-ink sm:p-5'>
        {active===null?<>
            <h2 className='mb-4 text-lg font-semibold text-ink'>SKU Configuration</h2>
            <nav aria-label='SKU configuration' className='space-y-2'>
                {menuOrder.map(({key,title,description,Icon})=><button key={key}
                    type='button' onClick={()=>open(key)}
                    className='flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2 text-left text-ink transition-colors hover:bg-page focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'>
                    <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand'>
                        <Icon className='h-5 w-5' aria-hidden='true'/>
                    </span>
                    <span className='min-w-0 flex-1'>
                        <span className='block text-sm font-semibold'>{title}</span>
                        {description&&<span className='block text-xs text-muted'>{description}</span>}
                    </span>
                    <ChevronRight className='h-5 w-5 shrink-0 text-muted' aria-hidden='true'/>
                </button>)}
            </nav>
        </>:<>
            <div className='mb-4 flex items-center gap-2'>
                <button type='button' className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-ink'
                    aria-label='Back to SKU configuration menu' onClick={()=>{setActive(null);setDraft(null);setError('');setInfo('');}}>
                    <ArrowLeft className='h-5 w-5' aria-hidden='true'/>
                </button>
                <h2 className='min-w-0 flex-1 text-lg font-semibold text-ink'>{group?.title}</h2>
                {active!=='units'&&canEdit&&!draft&&<button type='button' className={solid} onClick={startNew}>Add</button>}
            </div>
            {active==='units'?<div className='space-y-4'>
                <ConfigSelect title='Category' value={unitCategory} placeholder='Select unit category'
                    options={categories.map(c=>[c.code,c.name] as [string,string])}
                    onChange={v=>{setUnitCategory(v);setUnitCode('');}}/>
                <ConfigSelect title='Unit' value={unitCode} placeholder='Select unit'
                    options={setup.units.filter(u=>u.categoryCode===unitCategory)
                        .map(u=>[u.code,u.label+' ('+u.symbol+')'] as [string,string])} onChange={setUnitCode}/>
                {selectedUnit&&<div className='rounded-xl border border-line bg-page p-3'>
                    <p className='font-medium'>{selectedUnit.label} ({selectedUnit.symbol})</p>
                    <p className='text-xs text-muted'>{selectedUnit.code} · {selectedUnit.category}</p>
                </div>}
            </div>:<>
                {active==='containers'&&<ConfigSelect title='Unit category' value={unitCategory} placeholder='All unit categories'
                    options={[['','All categories'],...categories.map(c=>[c.code,c.name] as [string,string])]}
                    onChange={v=>setUnitCategory(v)}/>}
                {!draft&&<div className='space-y-2'>
                    {records.filter(x=>active!=='containers'||!unitCategory||x.categoryCode===unitCategory)
                        .map(item=><div key={item.id} className='flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line p-3'>
                        <div className='min-w-0'>
                            <p className='text-sm font-medium'>{item.name}
                                {item.enabled===false&&<span className='ml-2 text-xs text-muted'>(Inactive)</span>}
                            </p>
                            <p className='text-xs text-muted'>{item.id}
                                {item.categoryCode?' · '+(categories.find(c=>c.code===item.categoryCode)?.name||item.categoryCode):''}
                                {item.kind==='packageCounts'?' · '+item.quantity+' containers':''}
                            </p>
                        </div>
                        {canEdit&&<button type='button' className={subtle} onClick={()=>edit(item)}>Edit</button>}
                    </div>)}
                    {!records.length&&<p className='py-4 text-center text-sm text-muted'>No values configured</p>}
                </div>}
                {draft&&canEdit&&<div className='space-y-4 rounded-xl border border-line bg-page p-3'>
                    <div className='flex items-center justify-between gap-2'>
                        <h3 className='text-sm font-semibold'>{draft.id?'Edit '+draft.id:'New '+group?.title}</h3>
                        <button className={subtle} type='button' onClick={()=>setDraft(null)}>Cancel</button>
                    </div>
                    {active==='containers'?<>
                        <ConfigSelect title='Unit category' value={draft.categoryCode||''} placeholder='Select unit category'
                            options={categories.map(c=>[c.code,c.name] as [string,string])}
                            onChange={v=>update('categoryCode',v)}/>
                        <Named title='Container subcategory' value={draft.name||''} onChange={v=>update('name',v)}
                            required hint='This subcategory becomes the physical container selection'/>
                    </>:active==='packageCounts'?<>
                        <ConfigSelect title='Unit category' value={countUnits[0]?.categoryCode||''} placeholder='Count'
                            options={countUnits.length?[[countUnits[0].categoryCode,'Count']]:[]} onChange={()=>{}}/>
                        <ConfigSelect title='Count unit' value={draft.unitCode||''} placeholder='Select a Count unit'
                            options={countUnits.map(u=>[u.code,u.label+' ('+u.symbol+')'] as [string,string])}
                            onChange={v=>update('unitCode',v)}/>
                        <Numeric title='Number of selected units' value={draft.unitCount||0}
                            onChange={v=>update('unitCount',v)} hint='For example, 2 × Dozen = 24 containers'/>
                        {chosenCount>0&&Number.isSafeInteger(chosenCount)&&<p className='rounded-xl border border-line p-3 font-medium text-brand'>
                            {chosenCount} containers per package
                        </p>}
                    </>:<>
                        <Named title='Name' value={draft.name||''} onChange={v=>update('name',v)} required/>
                    </>}
                    {active==='productionForms'&&<Measure key='forms' label='Unit' value={draft.uom||''} setup={setup} onChange={v=>update('uom',v)}/>}
                    {active==='containerSizes'&&<>
                        <Numeric title='Quantity per container' value={draft.quantity||0} onChange={v=>update('quantity',v)}/>
                        <Measure key='sizes' label='Unit' value={draft.uom||''} setup={setup} onChange={v=>update('uom',v)}/>
                    </>}
                    {active==='packages'&&<Named title='Physical package UOM code' value={draft.uom||''}
                        onChange={v=>update('uom',v.toUpperCase())}/>}
                    {active==='normalizationUnits'&&<>
                        <Numeric title='Content per normalization unit' value={draft.quantityPerUnit||0}
                            onChange={v=>update('quantityPerUnit',v)}/>
                        <Measure key='normalization' label='Unit' value={draft.baseUom||''} setup={setup}
                            onChange={v=>update('baseUom',v)}/>
                    </>}
                    <label className='flex min-h-11 items-center gap-2 text-sm text-ink'>
                        <input type='checkbox' checked={draft.enabled!==false} onChange={e=>update('enabled',e.target.checked)}/>
                        Active
                    </label>
                    <button type='button' className={solid} disabled={busy||
                        (active==='packageCounts'?!(chosenCount>0&&Number.isSafeInteger(chosenCount)):!draft.name?.trim())}
                        onClick={()=>void save()}>{busy?'Saving…':'Save'}</button>
                </div>}
            </>}
        </>}
        {error&&<p role='alert' className='mt-3 rounded-xl border border-red-400 p-3 text-sm text-red-500'>{error}</p>}
        {info&&<p role='status' className='mt-3 rounded-xl border border-line p-3 text-sm text-brand'>{info}</p>}
    </section>;
}
