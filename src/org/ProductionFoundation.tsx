import { useEffect, useId, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Alert, Field as MemsField, SelectField } from '../components/ui';
import { Spinner } from '../admin/kit';
import { SkuConfigurationFields, SkuSetupPanel, UnitChoice, emptySkuSetup, type SkuSelections, type SkuSetup } from './MfgSkuSetup';
import PlnDemand from './PlnDemand';
import PlnSkuCostCenterRatings from './PlnSkuCostCenterRatings';
import ManufacturingResources from './ManufacturingResources';
import PlnProcessRoutingEditor from './PlnProcessRoutingEditor';
import PlnMaterialSupplyProfile, {type SupplyProfile} from './PlnMaterialSupplyProfile';
import PlnCapacityOverview from './PlnCapacityOverview';
import PlnDocumentation from './PlnDocumentation';
import {configurationProgress,type SetupRow,type SetupStep} from './plnSetupDependencies';
import {DEFAULT_FORM_DEFAULTS,formDefaultsFor,preferredSiteId,type FormDefaults} from './plnFormDefaults';
import PlnFormDefaultsPanel from './PlnFormDefaultsPanel';
import { bomUomName } from './plnBomUomDisplay';
function Card({children,className=''}:{children:ReactNode;className?:string}){
    return <section className={'min-w-0 rounded-2xl border border-line bg-panel p-3 text-ink sm:p-4 '+className}>{children}</section>;
}
function PageTitle({title,action}:{title:string;action:ReactNode}){
    return <div className='mb-3 flex min-w-0 items-center justify-between gap-2 py-1 sm:mb-4 sm:py-2'>
        <h1 className='min-w-0 break-words text-lg font-semibold text-ink sm:text-xl'>{title}</h1>
        {action}
    </div>;
}
function Button({variant='primary',children,className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'danger'}){
    const styles=variant==='primary'?'bg-brand text-onbrand':variant==='danger'?'border border-red-500/50 text-red-500':'border border-line text-ink';
    return <button {...props} className={'flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:opacity-50 '+styles+' '+className}>{children}</button>;
}
import { callBackend } from '../lib/backend';
import { hasPerm } from '../types';

type Kind='items'|'boms'|'resources'|'routings';
type Tab=Kind|'skuSetup'|'materialPolicy'|'formDefaults'|'config'|'demand'|'capacityOverview'|'documentation';
type Row=Record<string,unknown>&{id:string;name:string;revision?:number;type?:string};
type Component={source?:'INTERMEDIATE'|'WAREHOUSE';skuId:string;warehouseId?:string;materialId?:string;quantity:number;uom:string;scrapPct:number};
type Operation={code:string;name:string;resourceId:string;setupMinutes:number;runMinutesPerUnit:number;producesSkuId?:string;dependsOn?:string[]};
type Config={horizonDays:number;freezeDays:number;lotPolicy:string;strategy:string;formDefaults?:FormDefaults};
type BomClassification={code:string;name:string;enabled:boolean;mrpRelevant:boolean;productionEligible:boolean};
type MaterialPolicy={allowRawUtility:boolean;allowRawDirect:boolean;allowPackagingDirect:boolean;
    defaultIntermediateTracking:'STOCKED'|'NON_STOCKED';bomClassifications:BomClassification[]};
const defaultMaterialPolicy:MaterialPolicy={allowRawUtility:true,allowRawDirect:false,
    allowPackagingDirect:false,defaultIntermediateTracking:'NON_STOCKED',
    bomClassifications:[{code:'PRODUCTION',name:'Production',enabled:true,mrpRelevant:true,productionEligible:true}]};

type References={
    materials:Array<{id:string;name:string;materialNumber:string;uom:string}>;
    warehouses:Array<{id:string;name:string;code:string}>;
    warehouseMaterials:Array<{warehouseId:string;id:string;name:string;materialNumber:string;uom:string}>;
    utilities:Array<{workCenterId:string;code:string;name:string}>;
    assets:Array<{id:string;name:string;siteId:string}>;
    sites:Array<{id:string;name:string;code:string}>;
};
const emptyReferences:References={materials:[],warehouses:[],warehouseMaterials:[],utilities:[],assets:[],sites:[]};
const kinds:Kind[]=['items','boms','resources','routings'];
type Phase='foundation'|'masters'|'capacity'|'planning'|'guide';
const phases:{key:Phase;title:string;description:string}[]=[
    {key:'foundation',title:'1 · Foundation',description:'Establish policies and product definitions'},
    {key:'masters',title:'2 · Master data',description:'Create the manufactured products and resource masters'},
    {key:'capacity',title:'3 · Capacity & process',description:'Map commissioned capacity and manufacturing routes'},
    {key:'planning',title:'4 · Planning',description:'Configure planning rules and demand'},
    {key:'guide',title:'Reference',description:'Step-by-step documentation and examples'},
];
/** Configuration precedes use. Preserve the existing tab keys, data and permissions. */
const tabs:{key:Tab;label:string;shortLabel:string;phase:Phase;hint:string}[]=[
    {key:'materialPolicy',label:'Manufacturing Setup',shortLabel:'Manufacturing setup',phase:'foundation',hint:'Configure material consumption and intermediate inventory policies'},
    {key:'formDefaults',label:'Form Defaults',shortLabel:'Form defaults',phase:'foundation',hint:'Set suggested starting values for new SKU, BOM, resource, routing and demand forms'},
    {key:'skuSetup',label:'Product Configuration',shortLabel:'Product configuration',phase:'foundation',hint:'Define product variants, production forms, physical containers and packaging'},
    {key:'items',label:'Materials & Products',shortLabel:'Materials & products',phase:'masters',hint:'Create manufactured SKUs, ingredients, packaging and intermediate products'},
    {key:'boms',label:'Bills of Materials',shortLabel:'Bills of materials',phase:'masters',hint:'Define the materials and quantities consumed by each product'},
    {key:'resources',label:'Manufacturing Resources',shortLabel:'Manufacturing resources',phase:'masters',hint:'Register manufacturing resources used by routings'},
    {key:'routings',label:'Process Routings',shortLabel:'Process routings',phase:'capacity',hint:'Define operation sequences using configured resources and outputs'},
    {key:'capacityOverview',label:'Production Capacity Overview',shortLabel:'Capacity overview',phase:'capacity',hint:'Compare all authorized process flows, capacities and buffer constraints'},
    {key:'config',label:'Planning Configuration',shortLabel:'Planning rules',phase:'planning',hint:'Configure planning horizon, frozen period and lot-sizing defaults'},
    {key:'demand',label:'Demand & S&OP',shortLabel:'Demand & S&OP',phase:'planning',hint:'Maintain forecast and firm demand after the relevant masters are configured'},
    {key:'documentation',label:'Documentation & Setup Guide',shortLabel:'Documentation',phase:'guide',hint:'Search guided setup, topics, troubleshooting and fictional examples'},
];
const emptyRows:Record<Kind,Row[]>={items:[],boms:[],resources:[],routings:[]};
const fld='w-full min-h-11 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-brand';
const label='mb-1 block text-xs font-medium text-soft';
const newRecord=(tab:Tab,policy:MaterialPolicy=defaultMaterialPolicy,
    defaults:FormDefaults=DEFAULT_FORM_DEFAULTS,sites:References['sites']=[]):Row=>{
    const siteId=preferredSiteId(defaults.defaultSiteId,sites);
    if(tab==='items')return {id:'',name:'',category:defaults.skuCategory,processClassId:'',uom:'',siteId:'',packQty:1,
        stockPolicy:policy.defaultIntermediateTracking,sourceMode:'INVENTORY',inventoryMaterialId:'',utilityCode:'',utilityWorkCenterId:'',skuComponents:{}};
    if(tab==='boms')return {id:'',name:'',classificationCode:'PRODUCTION',alternativeCode:defaults.routingAlternativeCode,routingId:'',siteId,
        parentSkuId:'',outputQty:defaults.bomOutputQty,outputUom:'EA',components:[]};
    if(tab==='resources')return {id:'',name:'',type:defaults.resourceType,rate:defaults.resourceRate,rateUom:'EA',efficiency:defaults.resourceEfficiency,siteId,assetId:''};
    return {id:'',name:'',skuId:'',siteId,processClassId:'',routingModelVersion:2,alternativeCode:defaults.routingAlternativeCode,
        operations:[{code:'STG_000000001',name:'',resourceId:'',setupMinutes:0,
        runMinutesPerUnit:0,producesSkuId:'',costCenterId:'',bomId:'',stageType:'PRODUCE',
        processClass:'GENERAL',capacityBasis:'RESOURCE_RATE',batchSize:0,cycleMinutes:0,dependsOn:[]}]};
};
const recordKind=(tab:Tab):Kind=>tab as Kind;
const str=(value:unknown):string=>typeof value==='string'?value:'';
const number=(value:unknown,def=0):number=>typeof value==='number'&&Number.isFinite(value)?value:def;
const asComponents=(value:unknown):Component[]=>Array.isArray(value)?value as Component[]:[];
const asOperations=(value:unknown):Operation[]=>Array.isArray(value)?value as Operation[]:[];

function Field({title,value,onChange,type='text',placeholder='',required=false,disabled=false}:{title:string;value:string|number;onChange:(v:string)=>void;type?:string;placeholder?:string;required?:boolean;disabled?:boolean}){
    const id=useId();
    return <MemsField id={id} label={title} type={type} value={value} placeholder={placeholder}
        required={required} disabled={disabled} onChange={e=>onChange(e.target.value)}/>;
}
function Choice({title,value,options,onChange}:{title:string;value:string;options:Array<[string,string]>;onChange:(v:string)=>void}){
    const id=useId();
    return <SelectField id={id} label={title} value={value} onChange={e=>onChange(e.target.value)}>
        {options.map(([v,t])=><option key={v} value={v}>{t}</option>)}
    </SelectField>;
}
function TextField({title,value,onChange}:{title:string;value:string;onChange:(v:string)=>void}){
    return <label className='block'><span className={label}>{title}</span><textarea rows={2} className={fld} value={value} onChange={e=>onChange(e.target.value)}/></label>;
}

/** A clear output → inputs flow; technical versioning controls are optional. */
function BomEditor({draft,onChange,items,refs,skuSetup,materialPolicy}:{
 draft:Row;onChange:(v:Row)=>void;items:Row[];refs:References;skuSetup:SkuSetup;materialPolicy:MaterialPolicy;
}){
 const output=items.find(i=>i.id===str(draft.parentSkuId));
 const components=asComponents(draft.components);
 const quantity=number(draft.outputQty,1);
 const outputUom=str(draft.outputUom)||str(output?.uom)||'EA';
 const update=(key:string,value:unknown)=>onChange({...draft,[key]:value});
 const updateComponent=(i:number,patch:Partial<Component>)=>
   update('components',components.map((c,j)=>i===j?{...c,...patch}:c));
 const outputChoices:Array<[string,string]>=[['','Choose what you want to produce'],...items.map(i=>[i.id,i.name+' · '+str(i.category)] as [string,string])];
 const componentChoices:Array<[string,string]>=[['','Choose an intermediate/WIP material'],
    ...items.filter(i=>i.id!==str(output?.id)&&
        (str(i.category)==='INTERMEDIATE'||components.some(c=>c.skuId===i.id&&!c.source)))
        .map(i=>[i.id,i.name+' · '+str(i.category)] as [string,string])];
 const warehouseChoices:Array<[string,string]>=[['','Choose an accessible warehouse'],
    ...refs.warehouses.map(w=>[w.id,(w.code?w.code+' · ':'')+w.name] as [string,string])];
 const siteChoices:Array<[string,string]>=[['','All sites (organization default)'],...refs.sites.map(i=>[i.id,i.name] as [string,string])];
 const classes:Array<[string,string]>=materialPolicy.bomClassifications
    .filter(c=>c.enabled||c.code===str(draft.classificationCode)).map(c=>[c.code,c.name] as [string,string]);
 if(str(draft.classificationCode)&&!classes.some(c=>c[0]===str(draft.classificationCode)))
    classes.push([str(draft.classificationCode),str(draft.classificationCode)+' (existing)']);
 const units=(skuId:string,current:string,baseUnit?:string):Array<[string,string]>=>{
    const masterUom=baseUnit||str(items.find(i=>i.id===skuId)?.uom);
    const unit=skuSetup.units.find(u=>u.code===masterUom||u.symbol.toLowerCase()===masterUom.toLowerCase());
    const supported=unit?skuSetup.units.filter(u=>u.categoryCode===unit.categoryCode&&u.baseUnit===unit.baseUnit):[];
    return [
        ...(!current?([['','Choose a unit']] as Array<[string,string]>):
            [[current,bomUomName(current,skuSetup.units)] as [string,string]]),
        ...supported.filter(u=>u.code!==current&&u.symbol!==current)
            .map(u=>[u.code,bomUomName(u.code,skuSetup.units)] as [string,string]),
    ];
 };
 return <div className='space-y-4'>
    <div className='rounded-xl bg-page p-3 text-sm text-soft'>
        <p className='font-semibold text-ink'>Bill of materials</p>
        <p className='mt-1'>First choose what is produced. Then specify the components and their quantities. MEMS creates the BOM code and name automatically.</p>
    </div>
    <section className='space-y-3 rounded-xl border border-line p-3'>
        <h3 className='font-semibold'>1. What are you producing?</h3>
        <Choice title='Output material or finished product' value={str(draft.parentSkuId)}
            options={outputChoices} onChange={v=>{
                const selected=items.find(i=>i.id===v);
                onChange({...draft,parentSkuId:v,outputUom:str(selected?.uom)||'EA',
                    siteId:str(draft.siteId),productVariantId:'',routingId:'',
                    components:components.filter(c=>c.skuId!==v)});
            }}/>
        {output?<p className='text-sm text-soft'>Material classification: {str(output.category)} · Base unit: {bomUomName(str(output.uom),skuSetup.units)}</p>:
            <p className='text-xs text-muted'>Not listed? Create the material first in Materials & Products.</p>}
        <div className='grid gap-2 sm:grid-cols-2'>
            <Field title='How much does this BOM produce?' type='number' value={quantity}
                onChange={v=>update('outputQty',Number(v))}/>
            <div className='rounded-xl border border-line bg-page p-3'>
                <p className='text-xs text-muted'>Output unit (from selected material)</p>
                <p className='mt-1 text-sm font-semibold'>{bomUomName(outputUom,skuSetup.units)}</p>
            </div>
        </div>
    </section>
    <section className='space-y-3 rounded-xl border border-line p-3'>
        <div className='flex items-start justify-between gap-2'>
            <div>
                <h3 className='font-semibold'>2. What materials are needed?</h3>
                <p className='mt-1 text-xs text-muted'>Quantities for {quantity} {bomUomName(outputUom,skuSetup.units)} of the output.</p>
            </div>
            <Button type='button' variant='secondary' disabled={!output||components.length>=150}
                onClick={()=>update('components',[...components,{source:'INTERMEDIATE',skuId:'',warehouseId:'',materialId:'',quantity:1,uom:'',scrapPct:0}])}>Add material</Button>
        </div>
        {!output?<p className='text-sm text-muted'>Choose the output above first.</p>:
            <div className='space-y-3'>
                {components.map((c,i)=>{
                    const fromWarehouse=c.source==='WAREHOUSE';
                    const material=refs.warehouseMaterials.find(m=>m.warehouseId===c.warehouseId&&m.id===c.materialId);
                    const warehouse=refs.warehouses.find(w=>w.id===c.warehouseId);
                    const selected=items.find(item=>item.id===c.skuId);
                    const unitBasis=fromWarehouse?material?.uom:str(selected?.uom);
                    const availableMaterials=refs.warehouseMaterials.filter(m=>m.warehouseId===c.warehouseId);
                    return <div key={i} className='space-y-3 rounded-lg border border-line bg-page p-3'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                            <span className='text-sm font-semibold'>Required material {i+1}</span>
                            <button type='button' className='min-h-10 rounded-lg border border-line px-3 text-xs text-ink'
                                onClick={()=>update('components',components.filter((_,j)=>j!==i))}>Remove</button>
                        </div>
                        <Choice title='Material source' value={fromWarehouse?'WAREHOUSE':'INTERMEDIATE'}
                            options={[['INTERMEDIATE','Manufactured intermediate / WIP'],['WAREHOUSE','Approved Procurement material from warehouse']]}
                            onChange={v=>update('components',components.map((row,j)=>j===i?{
                                source:v as Component['source'],skuId:'',warehouseId:'',materialId:'',
                                quantity:row.quantity,uom:'',scrapPct:row.scrapPct}:row))}/>
                        <span className='inline-flex rounded-full border border-line bg-panel px-3 py-1 text-xs font-medium text-ink'>
                            {fromWarehouse?'WAREHOUSE · PROCUREMENT MATERIAL':!c.source&&selected&&str(selected.category)!=='INTERMEDIATE'?'EXISTING · MANUFACTURING SKU':'MANUFACTURED · INTERMEDIATE/WIP'}
                        </span>
                        {fromWarehouse?<div className='space-y-3'>
                            <Choice title='Warehouse (within your access)' value={c.warehouseId||''} options={warehouseChoices}
                                onChange={v=>updateComponent(i,{warehouseId:v,materialId:'',skuId:'',uom:''})}/>
                            {c.warehouseId&&<Choice title='Approved procurement material' value={c.materialId||''}
                                options={[['','Choose a material mapped to this warehouse'],
                                    ...availableMaterials.map(m=>[m.id,m.materialNumber+' · '+m.name] as [string,string])]}
                                onChange={v=>updateComponent(i,{materialId:v,skuId:'',
                                    uom:availableMaterials.find(m=>m.id===v)?.uom||''})}/>}
                            {material&&<p className='text-xs text-muted'>
                                Source: {warehouse?.code||warehouse?.name} · Procurement Material {material.materialNumber} · {material.name}
                            </p>}
                            {!refs.warehouses.length&&<p className='text-xs text-muted'>
                                No accessible warehouse currently has approved, mapped Procurement materials.
                            </p>}
                        </div>:<div className='space-y-2'>
                            <Choice title='Manufactured intermediate' value={c.skuId} options={componentChoices}
                                onChange={v=>updateComponent(i,{skuId:v,warehouseId:'',materialId:'',
                                    uom:str(items.find(item=>item.id===v)?.uom)||''})}/>
                            {selected&&<p className='text-xs text-muted'>SKU {selected.id} · {selected.name} · {str(selected.category)}</p>}
                        </div>}
                        <div className='grid grid-cols-2 gap-2'>
                            <Field title='Required quantity' type='number' value={c.quantity}
                                onChange={v=>updateComponent(i,{quantity:Number(v)})}/>
                            <div className='rounded-xl border border-line bg-panel p-3'>
                                <p className='text-xs text-muted'>Unit of measure</p>
                                <p className='mt-1 break-words text-sm font-semibold'>{bomUomName(c.uom,skuSetup.units)}</p>
                            </div>
                        </div>
                        {(fromWarehouse?!!material:!!c.skuId)&&<details className='text-xs text-muted'>
                            <summary className='cursor-pointer py-2'>Consumption options</summary>
                            <div className='grid gap-2 pt-2 sm:grid-cols-2'>
                                <Choice title='Alternate compatible unit' value={c.uom}
                                    options={units(c.skuId,c.uom,unitBasis)} onChange={v=>updateComponent(i,{uom:v})}/>
                                <Field title='Scrap allowance (%)' type='number' value={c.scrapPct}
                                    onChange={v=>updateComponent(i,{scrapPct:Number(v)})}/>
                            </div>
                        </details>}
                    </div>;
                })}
                {!components.length&&<p className='text-sm text-muted'>No inputs yet. Choose Add to include a component, ingredient or packaging material.</p>}
            </div>}
    </section>
    <details className='rounded-xl border border-line p-3'>
        <summary className='cursor-pointer font-semibold'>3. Additional settings (optional)</summary>
        <p className='my-3 text-xs text-muted'>The defaults work for most BOMs. Only change these when you need a different purpose, alternative method, site or effective date.</p>
        <div className='grid gap-3 sm:grid-cols-2'>
            <Choice title='BOM classification' value={str(draft.classificationCode)||'PRODUCTION'}
                options={classes} onChange={v=>update('classificationCode',v)}/>
            <Field title='Alternative method identifier' value={str(draft.alternativeCode)||'STANDARD'}
                onChange={v=>update('alternativeCode',v.toUpperCase())}/>
            <Choice title='Output unit override' value={outputUom} options={units(str(draft.parentSkuId),outputUom)}
                onChange={v=>update('outputUom',v)}/>
            <Choice title='Applicable site' value={str(draft.siteId)} options={siteChoices}
                onChange={v=>update('siteId',v)}/>
            <Field title='Effective from' type='date' value={str(draft.effectiveFrom)}
                onChange={v=>update('effectiveFrom',v)}/>
            <Field title='Optional BOM name' value={draft.name}
                placeholder={output?output.name+' · BOM':'Generated on save'}
                onChange={v=>update('name',v)}/>
            <Field title='Version note' value={str(draft.versionNote)}
                onChange={v=>update('versionNote',v)}/>
        </div>
        <TextField title='Description / notes' value={str(draft.description)}
            onChange={v=>update('description',v)}/>
        <p className='mt-2 text-xs text-muted'>Product identity comes from the output material; no separate variant selection is needed. Routing is maintained separately.</p>
    </details>
    <p className='text-xs text-muted'>Save creates a draft only. You can define upstream BOMs later. Production release follows the approval workflow.</p>
 </div>;
}
function MasterEditor({tab,draft,onChange,items,boms,resources,refs,skuSetup,materialPolicy}:{tab:Tab;draft:Row;onChange:(v:Row)=>void;items:Row[];boms:Row[];resources:Row[];refs:References;skuSetup:SkuSetup;materialPolicy:MaterialPolicy}){
    if(tab==='boms')return <BomEditor draft={draft} onChange={onChange} items={items} refs={refs} skuSetup={skuSetup} materialPolicy={materialPolicy}/>;
    if(tab==='routings')return <PlnProcessRoutingEditor value={draft} onChange={onChange}
        items={items} boms={boms} resources={resources} sites={refs.sites}
        processClasses={skuSetup.parameters.filter(p=>p.kind==='processClasses')}
        measureUnits={skuSetup.units}/>;
    const update=(key:string,value:unknown)=>onChange({...draft,[key]:value});
    const siteOptions:Array<[string,string]>=[['','Organization-wide'],...refs.sites.map(r=>[r.id,r.name+(r.code?' · '+r.code:'')] as [string,string])];
    const assetOptions:Array<[string,string]>=[['','No linked asset'],...refs.assets.map(r=>[r.id,r.name+' · '+r.id] as [string,string])];
    const materialOptions:Array<[string,string]>=[['','Select approved Inventory material'],...refs.materials.map(r=>[r.id,r.materialNumber+' · '+r.name] as [string,string])];
    const utilityOptions:Array<[string,string]>=[['','Select registered equipment utility'],
        ...refs.utilities.map(u=>[u.workCenterId+'::'+u.code,u.name+' · '+u.workCenterId] as [string,string])];
    return <div className='space-y-4'>
        <div className='grid gap-3 md:grid-cols-2'>
            <div className='rounded-xl border border-line bg-page p-3'>
                <span className='block text-xs text-muted'>MEMS generated master code</span>
                <span className='font-mono text-sm text-brand'>{draft.id||'Automatically allocated on Save'}</span>
            </div>
            {!(tab==='items'&&str(draft.category)==='FINISHED')&&<Field title='Name' value={draft.name} required onChange={v=>update('name',v)}/>}
            {tab==='items'&&<>
                <Choice title='SKU type' value={str(draft.category)} options={ [['FINISHED','Finished goods'],['INTERMEDIATE','Intermediate/WIP'],['RAW','Raw/input material'],['PACKAGING','Packaging component']] } onChange={v=>update('category',v)}/>
                {['FINISHED','INTERMEDIATE'].includes(str(draft.category))&&<>
                    <Choice title='Manufacturing process classification' value={str(draft.processClassId)}
                        options={[['','Choose production process group'],...skuSetup.parameters.filter(p=>
                            p.kind==='processClasses'&&(p.enabled!==false||p.id===str(draft.processClassId)))
                            .map(p=>[p.id,(p.processCode?p.processCode+' · ':'')+p.name] as [string,string])]}
                        onChange={v=>update('processClassId',v)}/>
                    <p className='text-xs text-muted'>Select the manufacturing process used for this SKU. Different products following the same process can share routing stages and equipment, while retaining their own BOMs and recipes. Configure process groups under Product Configuration.</p>
                </>}
                {str(draft.category)!=='FINISHED'&&<div className='md:col-span-2'>
                    <UnitChoice key={draft.id||'new-sku'} title='Unit of measure'
                        value={str(draft.uom)} setup={skuSetup} onChange={v=>update('uom',v)}/>
                </div>}
                {str(draft.category)==='FINISHED'&&<div className='rounded-xl border border-line bg-page p-3 text-sm text-soft'>The SKU name, production unit and relevant packaging conversions are calculated from its configuration. Commercial and transport packaging can be marked Not required; bulk tanks and silos use Bulk storage containment.</div>}
                {str(draft.category)==='INTERMEDIATE'&&<>
                    <Choice title='Intermediate tracking' value={str(draft.stockPolicy)||'NON_STOCKED'}
                        options={ [['NON_STOCKED','Non-stock (process output / no inventory posting)'],['STOCKED','Stock-managed intermediate']] }
                        onChange={v=>update('stockPolicy',v)}/>
                    {str(draft.stockPolicy)==='STOCKED'&&<Choice title='Approved Inventory material for stocked intermediate'
                        value={str(draft.inventoryMaterialId)} options={materialOptions}
                        onChange={v=>{const found=refs.materials.find(m=>m.id===v);onChange({...draft,inventoryMaterialId:v,uom:found?.uom||draft.uom});}}/>}
                </>}
                {['RAW','PACKAGING'].includes(str(draft.category))&&
                    <Choice title='Material consumption source' value={str(draft.sourceMode)||'INVENTORY'}
                        options={[
                            ['INVENTORY','Stock-managed Inventory material'],
                            ...(str(draft.category)==='RAW'&&materialPolicy.allowRawUtility?[['UTILITY','Metered process input (no stock issue)'] as [string,string]]:[]),
                            ...((str(draft.category)==='RAW'&&materialPolicy.allowRawDirect)||
                                (str(draft.category)==='PACKAGING'&&materialPolicy.allowPackagingDirect)
                                ?[['DIRECT','Non-stock direct consumption (no Inventory issue)'] as [string,string]]:[]),
                        ]}
                        onChange={v=>onChange({...draft,sourceMode:v,inventoryMaterialId:'',utilityCode:'',utilityWorkCenterId:''})}/>}
                {['RAW','PACKAGING'].includes(str(draft.category))&&str(draft.sourceMode)==='INVENTORY'&&
                    <Choice title='Published Inventory Material Master' value={str(draft.inventoryMaterialId)} options={materialOptions}
                        onChange={v=>{const found=refs.materials.find(m=>m.id===v);onChange({...draft,inventoryMaterialId:v,uom:found?.uom||draft.uom});}}/>}
                {['RAW','PACKAGING'].includes(str(draft.category))&&str(draft.sourceMode)==='DIRECT'&&
                    <p className='text-xs text-muted'>Direct consumption tracks the material as a BOM input without creating stock issues. Purchasing, costing and consumption evidence still require downstream configuration.</p>}
                {str(draft.category)==='RAW'&&str(draft.sourceMode)==='UTILITY'&&
                    <Choice title='Adopted equipment utility supply'
                        value={str(draft.utilityWorkCenterId)&&str(draft.utilityCode)?str(draft.utilityWorkCenterId)+'::'+str(draft.utilityCode):''}
                        options={utilityOptions} onChange={v=>{const selected=refs.utilities.find(u=>u.workCenterId+'::'+u.code===v);
                            onChange({...draft,utilityCode:selected?.code||'',utilityWorkCenterId:selected?.workCenterId||''});}}/>}
            </>}
            {tab==='resources'&&<>
                <Choice title='Resource class' value={str(draft.type)} options={['LINE','WORK_CENTER','MACHINE','BATCH_VESSEL','ASSEMBLY_CELL','OTHER'].map(v=>[v,v.replaceAll('_',' ')])} onChange={v=>update('type',v)}/>
                <Field title='Rated units per hour' type='number' value={number(draft.rate,1000)} onChange={v=>update('rate',Number(v))}/>
                <Field title='Rate unit' value={str(draft.rateUom)} onChange={v=>update('rateUom',v)}/>
                <Field title='Planning efficiency (%)' type='number' value={number(draft.efficiency,100)} onChange={v=>update('efficiency',Number(v))}/>
                <Choice title='Active Asset Register equipment (optional)' value={str(draft.assetId)} options={assetOptions} onChange={v=>update('assetId',v)}/>
            </>}
            {tab!=='items'&&<Choice title='Site applicability' value={str(draft.siteId)} options={siteOptions} onChange={v=>update('siteId',v)}/>}
            {tab==='items'&&<p className='md:col-span-2 text-xs text-muted'>
                SKUs belong to the organization, not one site. Their manufacturing process classification is shared across sites. Set site-specific availability and production speed through Manufacturing Resources → SKU allocation; no site mappings are changed by classification.
            </p>}
        </div>
        {tab==='items'&&str(draft.category)!=='PACKAGING'&&
            <PlnMaterialSupplyProfile
                value={(draft.supplyProfile||{}) as SupplyProfile}
                onChange={v=>update('supplyProfile',v)}
                materialUom={str(draft.uom)}
                sites={refs.sites} units={skuSetup.units}/>}
        {tab==='items'&&str(draft.category)==='INTERMEDIATE'&&<label className='flex min-h-11 items-start gap-3 rounded-xl border border-line bg-page p-3 text-sm text-ink'>
            <input type='checkbox' className='mt-1 shrink-0'
                checked={Object.values((draft.skuComponents||{}) as Record<string,unknown>).some(Boolean)}
                onChange={e=>update('skuComponents',e.target.checked
                    ?{containmentScope:'PRIMARY_CONTAINER',requiresCommercialPackaging:false,
                        requiresTransportPackaging:false}: {})}/>
            <span><strong>Configure physical containment for this intermediate SKU</strong>
                <span className='mt-1 block text-xs text-muted'>Enable for syrup, concentrate, bulk material, WIP in tanks or other intermediate products with a physical container. Select a production form, physical container and its size. Commercial and transport packaging are optional.</span>
            </span>
        </label>}
        {tab==='items'&&(str(draft.category)==='FINISHED'||str(draft.category)==='INTERMEDIATE'&&
            Object.values((draft.skuComponents||{}) as Record<string,unknown>).some(Boolean))&&<>
            <SkuConfigurationFields value={(draft.skuComponents||{}) as SkuSelections}
                onChange={v=>update('skuComponents',v)} setup={skuSetup}
                processClassId={str(draft.processClassId)}
                variantLabel={str(draft.category)==='INTERMEDIATE'?'Product/Variant (optional for intermediate)':'Product/Variant'}/>
            {str(draft.category)==='FINISHED'&&draft.id&&skuSetup.namingConfigured&&<label className='flex min-h-11 items-center gap-2 rounded-xl border border-line p-3 text-sm text-ink'>
                <input type='checkbox' checked={draft.applySkuNamingSequence===true}
                    onChange={e=>update('applySkuNamingSequence',e.target.checked)}/>
                Apply the latest SKU naming sequence when saving this existing SKU
            </label>}
        </>}
        <TextField title='Description / notes' value={str(draft.description)} onChange={v=>update('description',v)}/>


    </div>;
}

export default function ProductionFoundation({module,permissions}:{module:'PLN'|'MFG';permissions:string[]}){
    const [active,setActive]=useState<Tab>('materialPolicy');
    const [rows,setRows]=useState<Record<Kind,Row[]>>(emptyRows);
    const [skuSetup,setSkuSetup]=useState<SkuSetup>(emptySkuSetup);
    const [refs,setRefs]=useState<References>(emptyReferences);
    const [draft,setDraft]=useState<Row|null>(null);
    const [viewSkuId,setViewSkuId]=useState('');
    const [classEditingSku,setClassEditingSku]=useState('');
    const [classSelected,setClassSelected]=useState('');
    const [materialPolicy,setMaterialPolicy]=useState<MaterialPolicy>(defaultMaterialPolicy);
    const [materialPolicyRevision,setMaterialPolicyRevision]=useState(0);
    const [capacityMappings,setCapacityMappings]=useState<SetupRow[]>([]);
    const [capacityLoaded,setCapacityLoaded]=useState(false);
    const [setupBlocked,setSetupBlocked]=useState('');
    const [blockedTarget,setBlockedTarget]=useState<Tab|null>(null);
    const [config,setConfig]=useState<Config>({horizonDays:90,freezeDays:7,lotPolicy:'LOT_FOR_LOT',strategy:'MTS',formDefaults:formDefaultsFor()});
    const [configRevision,setConfigRevision]=useState(0);
    const [formDefaultsRevision,setFormDefaultsRevision]=useState(0);
    const formDefaults=useMemo(()=>formDefaultsFor(config.formDefaults),[config.formDefaults]);
    const [history,setHistory]=useState<Row[]>([]);
    const [decisionReason,setDecisionReason]=useState('');
    const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
    const canViewMasters=hasPerm(permissions,'MFG.view');
    const canViewPlanning=hasPerm(permissions,'PLN.view');
    const visibleTabs=tabs.filter(t=>t.key==='documentation'?module==='PLN'&&canViewPlanning:
        t.key==='formDefaults'||t.key==='config'||t.key==='demand'?canViewPlanning:canViewMasters);
    // Configuration progression depends on saved masters, not merely opening tabs.
    // Keep MFG master-data navigation and read-only PLN users usable.
    const enforceSetup=module==='PLN'&&canViewMasters&&canViewPlanning;
    const setupProgress=configurationProgress({
        materialPolicyRevision,formDefaultsRevision,parameters:skuSetup.parameters,
        items:rows.items as SetupRow[],boms:rows.boms as SetupRow[],
        resources:rows.resources as SetupRow[],routings:rows.routings as SetupRow[],
        capacityMappings,capacityLoaded,planningConfigurationRevision:configRevision,
    });
    const prerequisiteNames=(step:Tab)=>(step==='capacityOverview'?[]:setupProgress[step as SetupStep]?.missing||[])
        .map(key=>key==='costCenterSku'?'SKU allocation in Manufacturing Resources':
            tabs.find(t=>t.key===key)?.shortLabel||key);
    // Read-only users may have a different first accessible step.
    useEffect(()=>{
        if(visibleTabs.length&&!visibleTabs.some(tab=>tab.key===active)){
            setActive(visibleTabs[0].key);
            setDraft(null);
            setViewSkuId('');
        }
    },[active,visibleTabs.length,canViewPlanning,canViewMasters,module]);
    const canEdit=canViewMasters&&hasPerm(permissions,'MFG.master.edit');
    const canSkuConfig=canViewMasters&&hasPerm(permissions,'MFG.sku.configure');
    const canConfig=hasPerm(permissions,'PLN.configure');
    const isReleaseMaster=['boms','routings'].includes(active);
    const releaseScope=active==='routings'?'MFG.routing':'MFG.bom';
    const canSubmit=isReleaseMaster&&canEdit&&hasPerm(permissions,releaseScope+'.submit');
    const canApprove=isReleaseMaster&&hasPerm(permissions,releaseScope+'.approve');
    const canSave=canEdit && (active!=='boms'||hasPerm(permissions,'MFG.bom.edit')) && (active!=='routings'||hasPerm(permissions,'MFG.routing.edit'));
    const load=async()=>{
        setLoading(true);setError('');
        try{
            const [datasets,configuration,refData,skuData,materialSetup,capacitySetup]=await Promise.all([
                canViewMasters?Promise.all(kinds.map(kind=>callBackend<{records:Row[]}>('/api/org/pln-mfg/foundation/list',{kind}))):Promise.resolve(kinds.map(()=>({records:[] as Row[]}))),
                callBackend<{config:Config;revision:number;formDefaultsRevision:number}>('/api/org/pln-mfg/foundation/config').catch(()=>null),
                canViewMasters?callBackend<References>('/api/org/pln-mfg/foundation/references'):Promise.resolve(emptyReferences),
                canViewMasters?callBackend<SkuSetup>('/api/org/pln-mfg/sku/setup'):Promise.resolve(emptySkuSetup),
                canViewMasters?callBackend<{policy:MaterialPolicy;revision:number}>('/api/org/pln-mfg/foundation/material-policy'):Promise.resolve({policy:defaultMaterialPolicy,revision:0}),
                canViewPlanning?callBackend<{mappings:SetupRow[]}>('/api/org/pln/cost-center/hierarchy').catch(()=>null):Promise.resolve(null),
            ]);
            const [items,boms,resources,routings]=datasets;
            setRows({items:items.records,boms:boms.records,resources:resources.records,routings:routings.records});
            setRefs(refData);
            setSkuSetup(skuData);
            setMaterialPolicy(materialSetup.policy);setMaterialPolicyRevision(materialSetup.revision);
            setCapacityMappings(capacitySetup?.mappings??[]);setCapacityLoaded(!!capacitySetup);
            if(configuration){setConfig({...configuration.config,formDefaults:formDefaultsFor(configuration.config.formDefaults)});setConfigRevision(configuration.revision);setFormDefaultsRevision(configuration.formDefaultsRevision??0);}
        }catch(e){setError(e instanceof Error?e.message:'Could not load manufacturing masters.');}
        finally{setLoading(false);}
    };
    useEffect(()=>{void load();},[]);
    const filtered=useMemo(()=>{
        const kind=recordKind(active);
        return kinds.includes(kind)?rows[kind]:[] as Row[];
    },[active,rows]);
    const viewedSku=rows.items.find(row=>row.id===viewSkuId);
    const refreshSkuSetup=async()=>{
        const data=await callBackend<SkuSetup>('/api/org/pln-mfg/sku/setup');
        setSkuSetup(data);
    };
    const changeTab=(tab:Tab)=>{
        if(enforceSetup&&loading&&tab!=='documentation'){
            setBlockedTarget(tab);
            setSetupBlocked('Configuration readiness is still loading. Open the step after the current setup status has been checked.');
            return;
        }
        if(enforceSetup){
            const missing=prerequisiteNames(tab);
            if(missing.length){
                const detail=(tab==='capacityOverview'?[]:setupProgress[tab as SetupStep]?.missing||[]).map(step=>setupProgress[step].detail).join(' ');
                setBlockedTarget(tab);
                setSetupBlocked('Complete these configuration dependencies before continuing to '+
                    (tabs.find(t=>t.key===tab)?.label||tab)+': '+missing.join(', ')+'. '+detail);
                return;
            }
        }
        setSetupBlocked('');setBlockedTarget(null);
        setActive(tab);setDraft(null);setViewSkuId('');setHistory([]);setError('');setNotice('');setDecisionReason('');
    };
    const copyVersion=(row:Row)=>{setViewSkuId('');const cloned={...row,id:'',name:String(row.name)+' — new revision',revision:undefined,status:'draft',effectiveFrom:'',createdBy:undefined,submittedBy:undefined,approvedBy:undefined,approvedAt:undefined};setDraft(cloned);setHistory([]);setError('');setNotice('Give this version a new unique code and effective date. The approved original remains unchanged.');};
    const createAlternativeRoute=(row:Row)=>{
        const used=new Set(rows.routings.filter(r=>str(r.siteId)===str(row.siteId)&&
            str(r.processClassId)===str(row.processClassId))
            .map(r=>str(r.alternativeCode).toUpperCase()));
        let index=1,alternativeCode='ALTERNATIVE_'+index;
        while(used.has(alternativeCode)){index++;alternativeCode='ALTERNATIVE_'+index;}
        setDraft({...row,id:'',revision:undefined,status:'draft',
            name:String(row.name).slice(0,110)+' · alternative '+index,
            alternativeCode,effectiveFrom:'',createdBy:undefined,submittedBy:undefined,
            approvedBy:undefined,approvedAt:undefined});
        setViewSkuId('');setHistory([]);setError('');
        setNotice('New alternative route started. Change its stages, resources or sequence, then save and submit it separately for approval.');
    };
    const saveExistingSkuProcessClass=async(row:Row)=>{
        if(!canEdit||!canSkuConfig||!classSelected)return;
        setBusy(true);setError('');setNotice('');
        try{
            await callBackend('/api/org/pln-mfg/foundation/sku/process-classify',{
                skuId:row.id,processClassId:classSelected,expectedRevision:row.revision??1,
            });
            await load();setClassEditingSku('');setClassSelected('');
            setNotice('Manufacturing process classification saved for '+row.name+
                '. The SKU code, BOMs, site allocations and commissioned resource speeds remain unchanged.');
        }catch(e){setError(e instanceof Error?e.message:'SKU classification could not be saved.');}
        finally{setBusy(false);}
    };
    const release=async (id:string,decision:'submit'|'approve'|'reject')=>{
        if(decision==='reject'&&!decisionReason.trim()){setError('Enter a rejection reason first.');return;}
        setBusy(true);setError('');setNotice('');
        try{
            await callBackend(decision==='submit'?'/api/org/pln-mfg/foundation/submit':'/api/org/pln-mfg/foundation/decide',{
                kind:recordKind(active),id,...(decision==='submit'?{}:{decision,note:decisionReason.trim()}),
            });
            setDecisionReason('');await load();
            setNotice(decision==='submit'?'Revision submitted to an independent technical approver.':decision==='approve'?'Version approved for effective-date selection.':'Revision rejected and returned for correction.');
        }catch(e){setError(e instanceof Error?e.message:'Manufacturing approval could not be completed.');}
        finally{setBusy(false);}
    };
    const openDraft=async(row:Row)=>{
        setViewSkuId('');setDraft(row);setHistory([]);setError('');
        try{
            const result=await callBackend<{revisions:Row[]}>('/api/org/pln-mfg/foundation/history',{kind:recordKind(active),id:row.id});
            setHistory(result.revisions);
        }catch(e){setError(e instanceof Error?e.message:'Could not read revision history.');}
    };
    const save=async()=>{
        if(!draft||!canSave)return;
        if(active==='items'){
            if(str(draft.category)!=='FINISHED'&&!skuSetup.units.some(u=>u.code===str(draft.uom)||u.symbol.toLowerCase()===str(draft.uom).toLowerCase())){
                setError('Choose a unit category and unit of measure from the MEMS unit registry.');return;
            }
        }
        if(active==='boms'){
            const parts=asComponents(draft.components);
            if(!str(draft.parentSkuId)){setError('Choose the output material before saving.');return;}
            if(!parts.length||parts.some(c=>
                (c.source==='WAREHOUSE'?(!str(c.warehouseId)||!str(c.materialId)):!str(c.skuId))||
                !str(c.uom)||!Number.isFinite(c.quantity)||c.quantity<=0)){
                setError('Each BOM line needs a source, an intermediate or warehouse material, a unit and a positive quantity.');return;
            }
        }
        setBusy(true);setError('');setNotice('');
        try{
            const body={...draft};
            if(active==='items')delete body.family; // Drop obsolete, unreferenced free-text SKU family on save.
            if(active==='routings'&&!str(body.name).trim()){
                const group=skuSetup.parameters.find(p=>p.kind==='processClasses'&&p.id===str(body.processClassId));
                body.name=(group?.name||'Manufacturing')+' · Process route';
            }
            const result=await callBackend<{record:Row;generatedCode?:string}>('/api/org/pln-mfg/foundation/save',{kind:recordKind(active),record:body,expectedRevision:body.revision??0});
            await load();setDraft(null);setNotice('Saved '+(result.generatedCode||result.record.id)+' · Revision '+result.record.revision+'. The code is maintained by MEMS.');
        }catch(e){setError(e instanceof Error?e.message:'Could not save.');}
        finally{setBusy(false);}
    };
    const saveMaterialPolicy=async()=>{
        if(!canSkuConfig)return;
        setBusy(true);setError('');setNotice('');
        try{
            const response=await callBackend<{policy:MaterialPolicy;revision:number}>(
                '/api/org/pln-mfg/foundation/material-policy/save',
                {policy:materialPolicy,expectedRevision:materialPolicyRevision});
            setMaterialPolicy(response.policy);setMaterialPolicyRevision(response.revision);
            setNotice('Material handling settings saved. Existing approved records are unchanged.');
        }catch(e){setError(e instanceof Error?e.message:'Unable to save manufacturing setup.');}
        finally{setBusy(false);}
    };
    const saveConfig=async()=>{
        if(!canConfig)return;setBusy(true);setError('');setNotice('');
        try{
            const result=await callBackend<{config:Config;revision:number}>('/api/org/pln-mfg/foundation/config/save',{config,expectedRevision:configRevision});
            setConfig({...result.config,formDefaults:formDefaultsFor(result.config.formDefaults)});setConfigRevision(result.revision);setNotice('Planning rules saved; form defaults are managed independently in Form Defaults.');
        }catch(e){setError(e instanceof Error?e.message:'Could not save planning configuration.');}
        finally{setBusy(false);}
    };
    return <div className='space-y-4'>
        <PageTitle title={module==='PLN'?'Production Planning & MRP':'Manufacturing'} action={null}/>
        <nav aria-label='Production configuration menu' className='rounded-xl border border-line bg-panel px-3 py-2'>
            <SelectField id='manufacturing-step-select' label='Configuration' value={active}
                onChange={event=>changeTab(event.target.value as Tab)}>
                {phases.map(phase=><optgroup key={phase.key} label={phase.title}>
                    {visibleTabs.filter(tab=>tab.phase===phase.key).map(tab=>
                        <option key={tab.key} value={tab.key}>{tab.shortLabel}</option>)}
                </optgroup>)}
            </SelectField>
        </nav>
        {setupBlocked&&<div role='alert' className='space-y-2 rounded-xl border border-amber-500/50 p-3 text-sm'>
            <p>{setupBlocked}</p>
            <Button variant='secondary' className='w-fit px-3 text-xs'
                onClick={()=>{
                    let step=blockedTarget as SetupStep|null;
                    const visited=new Set<string>();
                    while(step&&setupProgress[step].missing.length&&!visited.has(step)){
                        visited.add(step);step=setupProgress[step].missing[0];
                    }
                    if(step==='costCenterSku')changeTab('resources');
                    else if(step)changeTab(step as Tab);
                    else{setSetupBlocked('');setBlockedTarget(null);}
                }}>
                Review prerequisites
            </Button>
        </div>}
        {error&&<Alert tone='error'>{error}</Alert>}
        {notice&&<p role='status' className='rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-3 text-sm text-brand'>{notice}</p>}
        {active==='documentation'?<PlnDocumentation onNavigate={value=>changeTab(value as Tab)}/>:
        loading?<Spinner/>:active==='formDefaults'?<PlnFormDefaultsPanel initial={formDefaults} revision={formDefaultsRevision} sites={refs.sites} canEdit={canConfig} onSaved={(next,revision)=>{
            setConfig(previous=>({...previous,formDefaults:next}));setFormDefaultsRevision(revision);
        }}/>:active==='demand'?<PlnDemand permissions={permissions} formDefaults={formDefaults}/>: active==='skuSetup'?<SkuSetupPanel setup={skuSetup} canEdit={canSkuConfig} onSaved={refreshSkuSetup}/>:active==='materialPolicy'?<Card className='space-y-4'>
            <h2 className='font-semibold'>Manufacturing material handling</h2>
            <p className='text-sm text-muted'>Configure material consumption and intermediate stock policies. The same material and BOM structure applies to every organization.</p>
            <div className='grid gap-3 sm:grid-cols-2'>
                <Choice title='Default intermediate tracking' value={materialPolicy.defaultIntermediateTracking}
                    options={ [['NON_STOCKED','Non-stock production stage'],['STOCKED','Stock-managed intermediate']] }
                    onChange={v=>setMaterialPolicy(s=>({...s,defaultIntermediateTracking:v as MaterialPolicy['defaultIntermediateTracking']}))}/>
            </div>
            <div className='space-y-3'>
                {([
                    ['allowRawUtility','Allow metered process inputs'],
                    ['allowRawDirect','Allow directly consumed non-stock raw materials'],
                    ['allowPackagingDirect','Allow directly consumed non-stock packaging materials'],
                ] as Array<[keyof MaterialPolicy,string]>).map(([key,title])=>
                    <label key={key} className='flex min-h-11 items-center gap-3 rounded-xl border border-line p-3 text-sm'>
                        <input type='checkbox' checked={materialPolicy[key]===true} onChange={e=>
                            setMaterialPolicy(s=>({...s,[key]:e.target.checked}))}/>{title}
                    </label>)}
            </div>
            <p className='text-xs text-muted'>All BOMs use one engine; classify them by purpose without restricting what material categories they can consume. Production/MRP relevance is controlled below.</p>
            <details className='rounded-xl border border-line p-3'>
                <summary className='cursor-pointer text-sm font-semibold'>
                    BOM classifications · {materialPolicy.bomClassifications.length} configured
                    <span className='ml-2 text-xs font-normal text-muted'>Expand to manage</span>
                </summary>
                <div className='mt-3 space-y-3'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                    <h3 className='text-sm font-semibold'>Classification records</h3>
                    <Button variant='secondary' disabled={!canSkuConfig||materialPolicy.bomClassifications.length>=30}
                        onClick={()=>setMaterialPolicy(p=>({...p,bomClassifications:[...p.bomClassifications,
                            {code:'',name:'',enabled:true,mrpRelevant:false,productionEligible:false}]}))}>Add classification</Button>
                </div>
                <p className='text-xs text-muted'>Production is the default. Add other classifications only when needed. Classification settings are not material classifications.</p>
                {materialPolicy.bomClassifications.map((c,i)=><div key={i} className='grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2'>
                    <Field title='Code' value={c.code} disabled={!canSkuConfig||c.code==='PRODUCTION'}
                        onChange={v=>setMaterialPolicy(p=>({...p,bomClassifications:p.bomClassifications.map((x,j)=>j===i?{...x,code:v.toUpperCase()}:x)}))}/>
                    <Field title='Name' value={c.name} disabled={!canSkuConfig}
                        onChange={v=>setMaterialPolicy(p=>({...p,bomClassifications:p.bomClassifications.map((x,j)=>j===i?{...x,name:v}:x)}))}/>
                    {([
                        ['enabled','Enabled'],['mrpRelevant','MRP relevant'],['productionEligible','Production eligible'],
                    ] as Array<[keyof BomClassification,string]>).map(([key,title])=>
                        <label key={key} className='flex min-h-9 items-center gap-2 text-xs'>
                            <input type='checkbox' checked={c[key]===true}
                                disabled={!canSkuConfig||(c.code==='PRODUCTION'&&c[key]===true)}
                                onChange={e=>setMaterialPolicy(p=>({...p,bomClassifications:p.bomClassifications.map((x,j)=>
                                    j===i?{...x,[key]:e.target.checked}:x)}))}/>{title}
                        </label>)}
                    {c.code!=='PRODUCTION'&&<Button variant='secondary' disabled={!canSkuConfig}
                        onClick={()=>setMaterialPolicy(p=>({...p,bomClassifications:p.bomClassifications.filter((_,j)=>j!==i)}))}>
                        Remove classification
                    </Button>}
                </div>)}
                </div>
            </details>
            <div className='flex justify-end'><Button disabled={!canSkuConfig||busy} onClick={()=>void saveMaterialPolicy()}>Save manufacturing setup</Button></div>
        </Card>:active==='resources'?<ManufacturingResources onChanged={()=>{void load();}}/>:active==='capacityOverview'?
        <PlnCapacityOverview sites={refs.sites} processClasses={skuSetup.parameters.filter(p=>p.kind==='processClasses')}
            items={rows.items} units={skuSetup.units}/>:active==='config'?<Card className='space-y-4'>
            <p className='text-sm text-muted'>Initial organization-level planning defaults. Further rule sets and site overrides use the same configuration model in subsequent phases.</p>
            <div className='grid gap-3 sm:grid-cols-2'>
                <Field title='Planning horizon (days)' type='number' value={config.horizonDays} onChange={v=>setConfig(s=>({...s,horizonDays:Number(v)}))}/>
                <Field title='Frozen period (days)' type='number' value={config.freezeDays} onChange={v=>setConfig(s=>({...s,freezeDays:Number(v)}))}/>
                <Choice title='Default lot-sizing method' value={config.lotPolicy} options={[['LOT_FOR_LOT','Lot for lot'],['FIXED','Fixed lot'],['MIN_MAX','Min / max'],['PERIOD','Period grouping'],['OPTIMIZED','Optimized']]} onChange={v=>setConfig(s=>({...s,lotPolicy:v}))}/>
                <Choice title='Default manufacturing policy' value={config.strategy} options={['MTS','MTO','ATO','ETO','HYBRID'].map(x=>[x,x])} onChange={v=>setConfig(s=>({...s,strategy:v}))}/>
            </div>

            <div className='rounded-xl border border-line bg-page p-3 text-sm text-soft'>
                Default SKU, BOM, resource, routing and demand form values are maintained separately in
                <button type='button' className='ml-1 font-semibold text-brand underline' onClick={()=>changeTab('formDefaults')}>Form Defaults</button>
                so you can configure them before planning routes and orders.
            </div>
            <div className='flex justify-end'><Button disabled={!canConfig||busy} onClick={()=>void saveConfig()}>Save planning configuration</Button></div>
        </Card>:<>
            <div className='flex min-w-0 flex-wrap items-center justify-between gap-2'><p className='text-xs text-muted sm:text-sm'>{active==='routings'?'Choose or create a process route. A route can serve multiple SKUs.':filtered.length+' saved master records · draft versions'}</p>{canSave&&!viewSkuId&&<Button onClick={()=>{setDraft(newRecord(active,materialPolicy,formDefaults,refs.sites));setError('');setNotice('');}}>Add {active==='items'?'SKU':active==='boms'?'BOM':active==='routings'?'new route':'resource'}</Button>}</div>
            {draft?<Card className='space-y-4'>
                <div className='flex items-center justify-between gap-2'><h2 className='font-semibold'>{active==='routings'?(draft.revision?'Edit routing draft':'Create manufacturing route'):(draft.revision?'Edit draft':'New master record')}</h2><Button variant='secondary' onClick={()=>setDraft(null)}>Cancel</Button></div>
                {draft.revision&&<div className='flex flex-wrap gap-2 text-xs text-soft'><span className='font-semibold'>Immutable revisions:</span>{history.map(h=><span key={String(h.revision)} className='rounded-md border border-line px-2 py-1'>r{h.revision} · {str(h.updatedAt).slice(0,10)}</span>)}</div>}
                <MasterEditor tab={active} draft={draft} onChange={setDraft} items={rows.items}
                    boms={rows.boms} resources={rows.resources} refs={refs} skuSetup={skuSetup} materialPolicy={materialPolicy}/>
                {active==='items'&&draft.id&&['FINISHED','INTERMEDIATE'].includes(str(draft.category))&&
                    <PlnSkuCostCenterRatings skuId={draft.id}/>}

                <div className='flex justify-end'><Button disabled={busy||!canSave} onClick={()=>void save()}>{busy?'Saving...':'Save draft'}</Button></div>
            </Card>:active==='items'&&viewSkuId?<Card className='space-y-4'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                    <h2 className='font-semibold'>Manufactured SKU detail</h2>
                    <Button variant='secondary' onClick={()=>setViewSkuId('')}>Back to SKU list</Button>
                </div>
                {viewedSku?<>
                    <div className='rounded-xl bg-page p-3'>
                        <p className='font-mono text-xs text-brand'>{viewedSku.id}</p>
                        <p className='mt-1 break-words font-semibold'>{viewedSku.name}</p>
                        <p className='mt-1 text-xs text-muted'>{str(viewedSku.category)} · {str(viewedSku.uom)} · Revision {viewedSku.revision??1}</p>
                        <p className='mt-1 text-xs text-muted'>Manufacturing process: {skuSetup.parameters.find(p=>p.id===str(viewedSku.processClassId))?.name||'Not classified'}</p>
                    </div>
                    <PlnSkuCostCenterRatings skuId={viewedSku.id}/>
                    {canSave&&['draft','rejected',''].includes(str(viewedSku.status))&&
                        <Button variant='secondary' onClick={()=>void openDraft(viewedSku)}>Edit SKU draft</Button>}
                </>:<p className='text-sm text-muted'>SKU not found. Refresh the Materials &amp; Products list.</p>}
            </Card>:<div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>{filtered.map(row=><Card key={row.id} className='space-y-2'>
                <div className='flex items-start justify-between gap-2'><span className='font-mono text-xs text-brand'>{row.id}</span><span className='rounded-full bg-page px-2 py-1 text-[11px] uppercase text-soft'>{str(row.status)||'draft'}</span></div>
                <h3 className='break-words font-semibold'>{row.name}</h3>
                <p className='text-xs text-muted'>{active==='items'?
                    str(row.category)+' · '+str(row.uom)+' · Process: '+(skuSetup.parameters.find(p=>p.id===str(row.processClassId))?.name||'Not classified'):
                    active==='routings'?'Process: '+(skuSetup.parameters.find(p=>p.id===str(row.processClassId))?.name||'Not classified')+' · Alternative: '+(str(row.alternativeCode)||'Not set')+' · '+asOperations(row.operations).length+' stages · '+((str(row.skuId)?1:0)+(Array.isArray(row.skuMappings)?row.skuMappings.length:0))+' mapped SKU(s)':
                    'BOM · '+(materialPolicy.bomClassifications.find(c=>c.code===str(row.classificationCode))?.name||str(row.classificationCode)||'Production')+' · Components: '+asComponents(row.components).length}</p>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='text-xs text-muted'>Revision {row.revision??1} · effective {str(row.effectiveFrom)||'immediately'}</span>
                    {active==='items'&&['FINISHED','INTERMEDIATE'].includes(str(row.category))&&
                        <Button variant='secondary' onClick={()=>{
                            setViewSkuId(row.id);setDraft(null);setError('');setNotice('');
                        }}>View SKU</Button>}
                    {canSave&&['draft','rejected',''].includes(str(row.status))&&<Button variant='secondary' onClick={()=>void openDraft(row)}>Open / edit</Button>}
                    {active==='items'&&canEdit&&canSkuConfig&&str(row.status)==='active'&&
                        ['FINISHED','INTERMEDIATE'].includes(str(row.category))&&
                        <Button variant='secondary' onClick={()=>{
                            setClassEditingSku(row.id);setClassSelected(str(row.processClassId));
                            setError('');setNotice('');
                        }}>Classify manufacturing process</Button>}
                    {canSave&&active==='routings'&&<Button variant='secondary' onClick={()=>createAlternativeRoute(row)}>Create different route from this</Button>}
                    {canSave&&['active','pending_approval'].includes(str(row.status))&&<Button variant='secondary' onClick={()=>copyVersion(row)}>New version</Button>}
                </div>
                {active==='items'&&classEditingSku===row.id&&<div className='space-y-2 rounded-xl border border-line bg-page p-3'>
                    <Choice title='Manufacturing process classification' value={classSelected}
                        options={[['','Select a process classification'],...skuSetup.parameters
                            .filter(p=>p.kind==='processClasses'&&p.enabled!==false)
                            .map(p=>[p.id,(p.processCode?p.processCode+' · ':'')+p.name] as [string,string])]}
                        onChange={setClassSelected}/>
                    <p className='text-xs text-muted'>Only process classification metadata changes. This keeps the existing SKU ID, BOMs, site allocation and commissioned rates intact.</p>
                    <div className='flex flex-wrap gap-2'>
                        <Button disabled={!classSelected||busy} onClick={()=>void saveExistingSkuProcessClass(row)}>Save classification</Button>
                        <Button variant='secondary' disabled={busy} onClick={()=>{setClassEditingSku('');setClassSelected('');}}>Cancel</Button>
                    </div>
                </div>}
                {str(row.status)==='draft'&&canSubmit&&<Button variant='secondary' disabled={busy} onClick={()=>void release(row.id,'submit')}>Submit for technical approval</Button>}
                {str(row.status)==='pending_approval'&&canApprove&&<div className='space-y-2'>
                    <Field title='Decision note / rejection reason' value={decisionReason} onChange={setDecisionReason}/>
                    <div className='flex flex-wrap gap-2'>
                        <Button disabled={busy} onClick={()=>void release(row.id,'approve')}>Approve version</Button>
                        <Button variant='danger' disabled={busy} onClick={()=>void release(row.id,'reject')}>Reject</Button>
                    </div>
                    <p className='text-xs text-muted'>The submitter and creator cannot approve their own master data.</p>
                </div>}
            </Card>)}</div>}
            {!filtered.length&&!draft&&<Card><p className='text-sm text-muted'>No records exist yet. Begin with material and product records, then define BOMs, resources and routings.</p></Card>}
        </>}
    </div>;
}
