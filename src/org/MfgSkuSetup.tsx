import {useId,useMemo,useState} from 'react';
import {Field,SelectField} from '../components/ui';
import {callBackend} from '../lib/backend';

export type SkuParameterKind='productNames'|'productionForms'|'containers'|'containerSizes'|'packages'|'packageCounts'|'normalizationUnits';
export type SkuParameter={
    id:string;kind:SkuParameterKind;name:string;enabled?:boolean;description?:string;
    quantity?:number;uom?:string;baseUom?:string;quantityPerUnit?:number;revision?:number;
};
export type MeasureUnit={code:string;label:string;symbol:string;category:string;baseUnit:string;multiplier:number};
export type SkuSetup={
    parameters:SkuParameter[];groups:Record<SkuParameterKind,string>;units:MeasureUnit[];
    conventions:Record<string,string|number>;
};
export const emptySkuSetup:SkuSetup={
    parameters:[],groups:{productNames:'NME',productionForms:'FRM',containers:'CNT',
        containerSizes:'SIZ',packages:'PKG',packageCounts:'PCT',normalizationUnits:'NRM'},
    units:[],conventions:{items:'SKU',boms:'BOM',recipes:'RCP',resources:'RSC',
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
    return setup.units.find(u=>u.code===code)||setup.units.find(u=>u.symbol.toLowerCase()===code.toLowerCase());
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
    return <ConfigSelect title={label} value={value} onChange={onChange} options={
        setup.units.map(x=>[x.code,x.label+' ('+x.symbol+') · '+x.category] as [string,string])
    } placeholder='Select a unit from the MEMS master'/>;
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
    return <section className={boxClass+' space-y-3'}>
        <div>
            <h3 className='text-base font-semibold text-ink'>SKU composition</h3>
            <p className='text-xs text-muted'>All attributes come from the organization SKU configuration master. The code and conversion factors are generated by MEMS.</p>
        </div>
        <div className='grid gap-3 sm:grid-cols-2'>
            {selections.map(group=><ConfigSelect key={group.key} title={group.label}
                value={value[group.key]||''} onChange={v=>onChange({...value,[group.key]:v})}
                options={setup.parameters.filter(p=>p.kind===group.kind&&p.enabled!==false)
                    .map(p=>[p.id,p.name+
                        (p.kind==='containerSizes'&&p.uom?' · '+p.quantity+' '+(pickUnit(setup,p.uom)?.symbol||p.uom):'')+
                        (p.kind==='normalizationUnits'?' · '+p.quantityPerUnit+' '+(pickUnit(setup,p.baseUom)?.symbol||p.baseUom):'')]
                        as [string,string])}/>)}
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

export function SkuSetupPanel({setup,canEdit,onSaved}:{
    setup:SkuSetup;canEdit:boolean;onSaved:()=>Promise<void>;
}){
    const [kind,setKind]=useState<SkuParameterKind>('productNames');
    const [draft,setDraft]=useState<Partial<SkuParameter>|null>(null);
    const [busy,setBusy]=useState(false);
    const [error,setError]=useState('');
    const [info,setInfo]=useState('');
    const selected=SKU_GROUPS.find(x=>x.kind===kind)!;
    const items=setup.parameters.filter(x=>x.kind===kind);
    const update=(key:string,value:unknown)=>setDraft(d=>({...d,[key]:value}));
    const save=async()=>{
        if(!draft||!canEdit)return;setBusy(true);setError('');setInfo('');
        try{
            const result=await callBackend<{record:SkuParameter}>('/api/org/pln-mfg/sku/setup/save',{
                kind,parameter:draft,expectedRevision:draft.revision||0,
            });
            await onSaved();setDraft(null);
            setInfo('Saved '+result.record.name+' · '+result.record.id+' (code generated by MEMS).');
        }catch(e){setError(e instanceof Error?e.message:'SKU parameter could not be saved.');}
        finally{setBusy(false);}
    };
    return <section className='space-y-4'>
        <div className={boxClass+' space-y-2'}>
            <h2 className='text-lg font-semibold text-ink'>Organization SKU Configuration</h2>
            <p className='text-sm text-soft'>Maintain the approved drop-down values used to compose SKUs. The configuration supports liquid, mass, piece-count and other production units; no bottling rules are hard-coded.</p>
            <p className='text-xs text-muted'>All parameter IDs are automatically assigned unique three-letter prefixes and nine-digit sequences in the organization database.</p>
        </div>
        <div className='grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'>
            <div className={boxClass+' space-y-1'}>
                {SKU_GROUPS.map(row=><button type='button' key={row.kind}
                    onClick={()=>{setKind(row.kind);setDraft(null);setError('');setInfo('');}}
                    className={'min-h-11 w-full rounded-xl px-3 py-2 text-left text-sm '+(kind===row.kind?'bg-brand/15 font-semibold text-brand':'text-ink hover:bg-page')}>
                    {row.title} <span className='text-xs text-muted'>({setup.parameters.filter(x=>x.kind===row.kind).length})</span>
                </button>)}
            </div>
            <div className='space-y-3'>
                <div className={boxClass+' space-y-2'}>
                    <div className='flex flex-wrap items-start justify-between gap-2'>
                        <div><h3 className='font-semibold text-ink'>{selected.title}</h3><p className='text-xs text-muted'>{selected.hint}</p></div>
                        {canEdit&&<button className={solid} type='button' onClick={()=>{setDraft({name:'',enabled:true});setError('');setInfo('');}}>Add parameter</button>}
                    </div>
                    {items.map(item=><div key={item.id} className='flex flex-wrap items-center justify-between gap-2 border-t border-line py-2'>
                        <div className='min-w-0'><p className='font-medium text-ink'>{item.name} {item.enabled===false&&<span className='text-xs text-amber-500'>disabled</span>}</p>
                            <p className='text-xs text-muted'>{item.id}{item.quantity?' · '+item.quantity+' '+(item.uom||''):''}{item.quantityPerUnit?' · '+item.quantityPerUnit+' '+(item.baseUom||'')+' / unit':''}</p></div>
                        {canEdit&&<button type='button' className={subtle} onClick={()=>{setDraft(item);setError('');setInfo('');}}>Edit</button>}
                    </div>)}
                    {!items.length&&<p className='py-3 text-sm text-muted'>No configured options yet.</p>}
                </div>
                {draft&&canEdit&&<div className={boxClass+' space-y-3'}>
                    <div className='flex justify-between gap-2'><h4 className='font-semibold text-ink'>{draft.id?'Edit parameter '+draft.id:'New parameter — ID assigned on save'}</h4>
                        <button className={subtle} type='button' onClick={()=>setDraft(null)}>Cancel</button></div>
                    <Named title='Display name' value={draft.name||''} onChange={v=>update('name',v)} required hint='User-facing text in SKU dropdowns'/>
                    {kind==='productionForms'&&<Measure label='Manufactured quantity unit' value={draft.uom||''} setup={setup} onChange={v=>update('uom',v)}/>}
                    {kind==='containerSizes'&&<>
                        <Numeric title='Quantity in one container' value={draft.quantity||0} onChange={v=>update('quantity',v)}/>
                        <Measure label='Container size unit' value={draft.uom||''} setup={setup} onChange={v=>update('uom',v)}/>
                    </>}
                    {kind==='packages'&&<Named title='Physical package UOM code' value={draft.uom||''}
                        onChange={v=>update('uom',v.toUpperCase())} hint='Example: CASE, PACK, TRAY, CRATE or PALLET'/>}
                    {kind==='packageCounts'&&<Numeric title='Containers per package' value={draft.quantity||0}
                        onChange={v=>update('quantity',v)} hint='Whole number, e.g. 6, 12, 24'/>}
                    {kind==='normalizationUnits'&&<>
                        <Numeric title='Manufactured quantity in one normalized unit' value={draft.quantityPerUnit||0}
                            onChange={v=>update('quantityPerUnit',v)} hint='Specify your organization standard (e.g., volume per UC).'/>
                        <Measure label='Normalization basis unit' value={draft.baseUom||''} setup={setup} onChange={v=>update('baseUom',v)}/>
                    </>}
                    <Named title='Description (optional)' value={draft.description||''} onChange={v=>update('description',v)}/>
                    <label className='flex min-h-11 items-center gap-2 text-sm text-ink'><input type='checkbox'
                        checked={draft.enabled!==false} onChange={e=>update('enabled',e.target.checked)}/>Enabled for SKU creation</label>
                    <button className={solid} disabled={busy||!draft.name?.trim()} onClick={()=>void save()} type='button'>Save parameter</button>
                </div>}
                {error&&<p role='alert' className='rounded-xl border border-red-400 p-3 text-sm text-red-500'>{error}</p>}
                {info&&<p role='status' className='rounded-xl border border-line p-3 text-sm text-brand'>{info}</p>}
            </div>
        </div>
    </section>;
}
