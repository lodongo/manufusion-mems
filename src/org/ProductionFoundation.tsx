import { useEffect, useId, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Alert, Field as MemsField, SelectField, TextArea } from '../components/ui';
import { Spinner } from '../admin/kit';
import { SkuConfigurationFields, SkuSetupPanel, SkuIdentityGuide, UnitChoice, emptySkuSetup, type SkuSelections, type SkuSetup } from './MfgSkuSetup';
import PlnDemand from './PlnDemand';
import PlnPlanningWorkspace from './PlnPlanningWorkspace';
import PlnSkuCostCenterRatings from './PlnSkuCostCenterRatings';
import PlnSkuAuditLog from './PlnSkuAuditLog';
import ManufacturingResources from './ManufacturingResources';
import PlnProcessRoutingEditor from './PlnProcessRoutingEditor';
import PlnMaterialSupplyProfile, {type SupplyProfile} from './PlnMaterialSupplyProfile';
import PlnCapacityOverview from './PlnCapacityOverview';
import PlnDocumentation from './PlnDocumentation';
import {configurationProgress,type SetupRow,type SetupStep} from './plnSetupDependencies';
import {DEFAULT_FORM_DEFAULTS,formDefaultsFor,preferredSiteId,type FormDefaults} from './plnFormDefaults';
import PlnFormDefaultsPanel from './PlnFormDefaultsPanel';
import { bomUomName } from './plnBomUomDisplay';
import {normalizedMaterialFlow} from '../shared/utilityDistributionCapacity';
import {navigate} from '../lib/route';
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
type Tab=Kind|'skuSetup'|'materialPolicy'|'formDefaults'|'config'|'sop'|'demand'|'capacityOverview'|'documentation';
type Row=Record<string,unknown>&{id:string;name:string;revision?:number;type?:string};
type Component={
 source?:'INTERMEDIATE'|'WAREHOUSE'|'PROCESS_SUPPLY';
 skuId:string;warehouseId?:string;materialId?:string;quantity:number;uom:string;scrapPct:number;
 processSupplyKind?:'SKU'|'UTILITY'|'PROCUREMENT';
 utilityWorkCenterId?:string;utilityCode?:string;
 supplyCostCenterId?:string;supplyUtilityCode?:string;
 quantityMethod?:'PLANNED'|'METERED'|'AS_REQUIRED';
 deliveryMode?:'INLINE'|'BUFFERED'|'BULK_STORAGE'|'CYLINDER';
 requiredFlowPerHour?:number|null;bufferCapacity?:number|null;bufferUsable?:number|null;
};
type CostCenterSupplyOption={costCenterId:string;costCenterName:string;siteId:string;
 code:string;label:string;capacity:number|null;capacityUnit:string;determinantKey:string;
 demand:number;percentage:number|null;status:string;ready:boolean;values:Record<string,unknown>;
 sourceCount:number;unknown:number;relevance?:number;costCenterSubcategories?:string[]};
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
    utilities:Array<{workCenterId:string;code:string;name:string;uom?:string}>;
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
    {key:'sop',label:'S&OP Planning Cycle',shortLabel:'S&OP planning cycle',phase:'planning',hint:'Annual demand per SKU for the financial year, detailed SKU forecast, BOM unitisation, MRP, rough-cut capacity and Chart of Authority approval'},
    {key:'config',label:'Planning Configuration',shortLabel:'Planning rules',phase:'planning',hint:'Configure planning horizon, frozen period and lot-sizing defaults'},
    {key:'demand',label:'Demand & S&OP',shortLabel:'Demand & S&OP',phase:'planning',hint:'Maintain forecast and firm demand after the relevant masters are configured'},
    {key:'documentation',label:'Documentation & Setup Guide',shortLabel:'Documentation',phase:'guide',hint:'Search guided setup, topics, troubleshooting and fictional examples'},
];
const emptyRows:Record<Kind,Row[]>={items:[],boms:[],resources:[],routings:[]};
const newRecord=(tab:Tab,policy:MaterialPolicy=defaultMaterialPolicy,
    defaults:FormDefaults=DEFAULT_FORM_DEFAULTS,sites:References['sites']=[]):Row=>{
    const siteId=preferredSiteId(defaults.defaultSiteId,sites);
    if(tab==='items')return {id:'',name:'',category:defaults.skuCategory,processClassId:'',uom:'',siteId:'',packQty:1,
        stockPolicy:policy.defaultIntermediateTracking,sourceMode:'INVENTORY',inventoryMaterialId:'',
        utilityCode:'',utilityWorkCenterId:'',utilitySourceCostCenterId:'',utilitySourceSubcategoryCode:'',skuComponents:{}};
    if(tab==='boms')return {id:'',name:'',classificationCode:'PRODUCTION',alternativeCode:defaults.routingAlternativeCode,routingId:'',siteId,
        parentSkuId:'',outputQty:defaults.bomOutputQty,outputUom:'EA',components:[]};
    if(tab==='resources')return {id:'',name:'',siteId,assetId:''}; // Resource class and capacity are inherited from a cost centre and SKU mapping.
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
function Choice({title,value,options,onChange,disabled=false}:{title:string;value:string;options:Array<[string,string]>;onChange:(v:string)=>void;disabled?:boolean}){
    const id=useId();
    return <SelectField id={id} label={title} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>
        {options.map(([v,t])=><option key={v} value={v}>{t}</option>)}
    </SelectField>;
}
function TextField({title,value,onChange}:{title:string;value:string;onChange:(v:string)=>void}){
    return <TextArea label={title} rows={2} value={value} onChange={e=>onChange(e.target.value)}/>;
}


/** Category and compatible unit only; the measurement system is metadata,
 * not a separate selection step. Conversion remains with the BOM editor. */
function BomMaterialUnitSelector({setup,value,allowedUnitCodes,onChange}:{
    setup:SkuSetup;value:string;allowedUnitCodes:string[];onChange:(code:string)=>void;
}){
    const [categoryChoice,setCategoryChoice]=useState('');
    const allowedUnits=setup.units.filter(unit=>
        allowedUnitCodes.some(code=>code===unit.code||code.toLowerCase()===unit.symbol.toLowerCase()));
    const current=setup.units.find(unit=>unit.code===value||unit.symbol.toLowerCase()===value.toLowerCase());
    const categoryKeys=[...new Set(allowedUnits.map(unit=>unit.categoryCode))];
    const category=categoryChoice||current?.categoryCode||
        (categoryKeys.length===1?categoryKeys[0]:'');
    const categoryOptions=categoryKeys.map(code=>{
        const registered=setup.categories.find(item=>item.code===code);
        return [code,registered?.name||allowedUnits.find(u=>u.categoryCode===code)?.category||code] as [string,string];
    });
    const matchingUnits=allowedUnits.filter(unit=>unit.categoryCode===category);
    const selectedValue=matchingUnits.some(unit=>unit.code===current?.code)?current?.code||'':'';
    return <div className='grid gap-3'>
        <Choice title='Unit category' value={category}
            options={[['','Choose unit category'],...categoryOptions]}
            onChange={setCategoryChoice}/>
        <Choice title='Material quantity unit' value={selectedValue}
            options={[['','Choose unit'],...matchingUnits.map(unit=>[
                unit.code,bomUomName(unit.code,setup.units),
            ] as [string,string])]}
            onChange={code=>{if(code)onChange(code);}}/>
        <p className='text-xs text-muted'>Selected unit: {bomUomName(value,setup.units)}. Compatible unit changes convert quantities, flow and buffer values.</p>
        {!allowedUnits.length&&<p role='alert' className='text-xs text-amber-600'>
            No compatible units are available in the active MEMS unit registry.
        </p>}
    </div>;
}

/** Category-first BOM output unit picker. The same outputUom is shared by
 * Settings and Output, so both views remain in sync. No metric/imperial step. */
function BomOutputUnitSelector({draft,setup,allowedCodes,onCategoryChange,onChange,title}:{
    draft:Row;setup:SkuSetup;allowedCodes:string[];
    onCategoryChange:(category:string)=>void;onChange:(code:string)=>void;title:string;
}){
    const value=str(draft.outputUom);
    const current=setup.units.find(unit=>unit.code===value||unit.symbol.toLowerCase()===value.toLowerCase());
    const allowed=setup.units.filter(unit=>allowedCodes.some(code=>code===unit.code||
        code.toLowerCase()===unit.symbol.toLowerCase()));
    const keys=[...new Set(allowed.map(unit=>unit.categoryCode))];
    const requested=str(draft.outputUnitCategory);
    const category=requested&&keys.includes(requested)?requested:current?.categoryCode||
        (keys.length===1?keys[0]:'');
    const available=allowed.filter(unit=>unit.categoryCode===category);
    const unitValue=available.some(unit=>unit.code===current?.code)?current?.code||'':'';
    return <div className='grid gap-3'>
        <Choice title='Output unit category' value={category}
            options={[['','Choose unit category'],...keys.map(code=>{
                const record=setup.categories.find(c=>c.code===code);
                return [code,record?.name||allowed.find(unit=>unit.categoryCode===code)?.category||code] as [string,string];
            })]} onChange={onCategoryChange}/>
        <Choice title={title} value={unitValue} disabled={!category}
            options={[['','Choose output unit'],...available.map(unit=>[
                unit.code,bomUomName(unit.code,setup.units),
            ] as [string,string])]}
            onChange={onChange}/>
    </div>;
}

/** A clear output → inputs flow; technical versioning controls are optional. */
function BomEditor({draft,onChange,items,refs,skuSetup,materialPolicy}:{
 draft:Row;onChange:(v:Row)=>void;items:Row[];refs:References;skuSetup:SkuSetup;materialPolicy:MaterialPolicy;
}){
 const output=items.find(i=>i.id===str(draft.parentSkuId));
 const outputReady=!!output&&(str(draft.applicability)||'SKU')==='SKU'||
    ['PROCESS_CLASS','ALL'].includes(str(draft.applicability));
 const [sectionTab,setSectionTab]=useState<'output'|'materials'|'settings'>('settings');
 const [materialsView,setMaterialsView]=useState<'list'|'edit'>('list');
 const [selectedMaterialIndex,setSelectedMaterialIndex]=useState<number|null>(null);
 const [materialEditorMode,setMaterialEditorMode]=useState<'create'|'edit'>('create');
 const [materialEditorSnapshot,setMaterialEditorSnapshot]=useState<Row|null>(null);
 const [materialEditorError,setMaterialEditorError]=useState('');
 const [estimatedRunHours,setEstimatedRunHours]=useState('');
 useEffect(()=>{
    setSectionTab('settings');
    setMaterialsView('list');
    setSelectedMaterialIndex(null);
    setMaterialEditorSnapshot(null);
    setMaterialEditorError('');
    setEstimatedRunHours('');
 },[draft.id]);
 // Keep the mobile editor independent from the scrolling BOM list.
 useEffect(()=>{
    if(materialsView!=='edit')return;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const onEscape=(event:KeyboardEvent)=>{
        if(event.key!=='Escape')return;
        if(materialEditorSnapshot)onChange(materialEditorSnapshot);
        setMaterialsView('list');
        setSelectedMaterialIndex(null);
        setMaterialEditorSnapshot(null);
        setMaterialEditorError('');
    };
    window.addEventListener('keydown',onEscape);
    return ()=>{
        document.body.style.overflow=previousOverflow;
        window.removeEventListener('keydown',onEscape);
    };
 },[materialsView,materialEditorSnapshot,onChange]);
 const [costSupplies,setCostSupplies]=useState<CostCenterSupplyOption[]>([]);
 const [costSupplyError,setCostSupplyError]=useState('');
 const includesProcess=asComponents(draft.components).some(c=>c.source==='PROCESS_SUPPLY');
 const refreshCostSupplies=()=>{
    setCostSupplyError('');
    void callBackend<{supplies:CostCenterSupplyOption[]}>('/api/org/ast/cost-center-utilities/options',
        {outputSkuId:str(draft.parentSkuId)})
     .then(result=>setCostSupplies(result.supplies))
     .catch(e=>setCostSupplyError(e instanceof Error?e.message:'Could not load cost-centre utility capability.'));
 };
 useEffect(()=>{if(includesProcess)refreshCostSupplies();},[includesProcess,draft.parentSkuId]);
 const components=asComponents(draft.components);
 const quantity=number(draft.outputQty,1);
 const outputUom=str(draft.outputUom)||str(output?.uom)||'EA';
 const update=(key:string,value:unknown)=>onChange({...draft,[key]:value});
 const outputUnitOptions=skuSetup.units.filter(unit=>{
    if((str(draft.applicability)||'SKU')!=='SKU'||!output)return true;
    const base=skuSetup.units.find(candidate=>candidate.code===str(output.uom)||
        candidate.symbol.toLowerCase()===str(output.uom).toLowerCase());
    return !!base&&unit.baseUnit===base.baseUnit&&unit.categoryCode===base.categoryCode;
 });
 const chooseOutputUnitCategory=(category:string)=>{
    const previous=skuSetup.units.find(unit=>unit.code===str(draft.outputUom)||
        unit.symbol.toLowerCase()===str(draft.outputUom).toLowerCase());
    if(category===previous?.categoryCode){
        onChange({...draft,outputUnitCategory:category});
        return;
    }
    if(previous&&components.length&&
        !window.confirm('Changing the output unit category changes the BOM measurement basis. Review the output quantity and material requirements afterwards. Continue?'))return;
    // Require an explicit unit choice in the new category; never silently relabel
    // a quantity using a physically incompatible unit.
    onChange({...draft,outputUnitCategory:category,outputUom:''});
 };
 const chooseOutputUnit=(code:string)=>{
    const before=skuSetup.units.find(unit=>unit.code===str(draft.outputUom)||
        unit.symbol.toLowerCase()===str(draft.outputUom).toLowerCase());
    const after=skuSetup.units.find(unit=>unit.code===code||
        unit.symbol.toLowerCase()===code.toLowerCase());
    const conversion=before&&after&&before.categoryCode===after.categoryCode&&
        before.baseUnit===after.baseUnit&&after.multiplier>0?
        before.multiplier/after.multiplier:null;
    onChange({...draft,outputUom:code,outputUnitCategory:after?.categoryCode||'',
        ...(conversion!==null&&conversion!==1?{outputQty:quantity*conversion}:{})});
 };
 const updateComponent=(i:number,patch:Partial<Component>)=>
   update('components',components.map((c,j)=>i===j?{...c,...patch}:c));
 const beginAddMaterial=()=>{
    if(!outputReady||components.length>=150)return;
    setMaterialEditorSnapshot(draft);
    setEstimatedRunHours('');
    setMaterialEditorMode('create');
    setMaterialEditorError('');
    update('components',[...components,{
        source:'INTERMEDIATE',skuId:'',warehouseId:'',materialId:'',quantity:1,uom:'',scrapPct:0,
    }]);
    setSelectedMaterialIndex(components.length);
    setMaterialsView('edit');
 };
 const beginEditMaterial=(index:number)=>{
    if(!components[index])return;
    setMaterialEditorSnapshot(draft);
    setEstimatedRunHours('');
    setMaterialEditorMode('edit');
    setMaterialEditorError('');
    setSelectedMaterialIndex(index);
    setMaterialsView('edit');
 };
 const cancelMaterialEditor=()=>{
    if(materialEditorSnapshot)onChange(materialEditorSnapshot);
    setMaterialsView('list');
    setSelectedMaterialIndex(null);
    setMaterialEditorSnapshot(null);
    setMaterialEditorError('');
 };
 const saveMaterialEditor=()=>{
    if(selectedMaterialIndex===null||!components[selectedMaterialIndex])return;
    const c=components[selectedMaterialIndex];
    const source=c.source||'INTERMEDIATE',kind=c.processSupplyKind||'SKU';
    const referencePresent=source==='WAREHOUSE'?!!c.warehouseId&&!!c.materialId:
        source==='PROCESS_SUPPLY'?kind==='SKU'?!!c.skuId:
            kind==='PROCUREMENT'?!!c.materialId:
                !!(c.supplyCostCenterId&&c.supplyUtilityCode)||!!(c.utilityWorkCenterId&&c.utilityCode):
        !!c.skuId;
    if(!referencePresent||!c.uom||!Number.isFinite(c.quantity)||c.quantity<=0){
        setMaterialEditorError('Select the required material or utility and enter a positive quantity and valid unit before adding it to the BOM.');
        return;
    }
    if(source==='PROCESS_SUPPLY'&&kind==='UTILITY'&&
        !(c.supplyCostCenterId&&c.supplyUtilityCode)&&
        !(c.utilityWorkCenterId&&c.utilityCode)){
        setMaterialEditorError('Choose a configured supplying cost-centre utility for this process material.');
        return;
    }
    if(source==='PROCESS_SUPPLY'&&['BUFFERED','BULK_STORAGE'].includes(c.deliveryMode||'INLINE')&&
        (!(Number.isFinite(c.bufferCapacity)&&Number(c.bufferCapacity)>0)||
            (c.bufferUsable!=null&&(c.bufferUsable<0||c.bufferUsable>Number(c.bufferCapacity))))){
        setMaterialEditorError('Enter a valid buffer capacity and usable quantity not greater than capacity.');
        return;
    }
    setMaterialsView('list');
    setSelectedMaterialIndex(null);
    setMaterialEditorSnapshot(null);
    setMaterialEditorError('');
 };
 const removeMaterial=(index:number)=>{
    if(!window.confirm('Remove material '+(index+1)+' from this BOM draft? Save the BOM draft to persist the change.'))return;
    update('components',components.filter((_,i)=>i!==index));
    setSelectedMaterialIndex(null);
    setMaterialsView('list');
 };
 const describeMaterial=(component:Component)=>{
    const fromWarehouse=component.source==='WAREHOUSE';
    const processSupply=component.source==='PROCESS_SUPPLY';
    const kind=component.processSupplyKind||'SKU';
    const sku=items.find(item=>item.id===component.skuId);
    const warehouseMaterial=refs.warehouseMaterials.find(
        item=>item.warehouseId===component.warehouseId&&item.id===component.materialId);
    const purchased=refs.materials.find(item=>item.id===component.materialId);
    const utility=costSupplies.find(
        item=>item.costCenterId===component.supplyCostCenterId&&item.code===component.supplyUtilityCode);
    const legacyUtility=refs.utilities.find(
        item=>item.workCenterId===component.utilityWorkCenterId&&item.code===component.utilityCode);
    const name=fromWarehouse?
        (warehouseMaterial?.name||purchased?.name||'Select warehouse material'):
        processSupply&&kind==='UTILITY'?
            (utility?.label||legacyUtility?.name||'Select process utility'):
        processSupply&&kind==='PROCUREMENT'?
            (purchased?.name||'Select purchased material'):
            (sku?.name||'Select manufactured material');
    const source=fromWarehouse?'Warehouse · Procurement':
        processSupply?'Process supply':'Manufactured intermediate / WIP';
    return {name,source};
 };
 const outputChoices:Array<[string,string]>=[['','Choose what you want to produce'],...items.map(i=>[i.id,i.name+' · '+str(i.category)] as [string,string])];
 const componentChoices:Array<[string,string]>=[['','Choose an intermediate/WIP material'],
    ...items.filter(i=>i.id!==str(output?.id)&&
        (str(i.category)==='INTERMEDIATE'||components.some(c=>c.skuId===i.id&&!c.source)))
        .map(i=>[i.id,i.name+' · '+str(i.category)] as [string,string])];
 const processMaterialChoices:Array<[string,string]>=[['','Select a manufactured or raw process-input SKU'],
    ...items.filter(x=>x.id!==str(output?.id)&&['INTERMEDIATE','RAW'].includes(str(x.category)))
        .map(x=>[x.id,x.name+' · '+str(x.category)] as [string,string])];
 const processProcurementChoices:Array<[string,string]>=[['','Choose an approved bulk/direct procurement material'],
    ...refs.materials.map(m=>[m.id,m.materialNumber+' · '+m.name] as [string,string])];
 const relevantSupplies=costSupplies.filter(s=>!str(draft.siteId)||s.siteId===str(draft.siteId));
 const processCostCenterChoices:Array<[string,string]>=[
     ['','Choose a permitted manufacturing cost centre'],
     ...[...new Map(relevantSupplies.map(s=>[s.costCenterId,s])).values()]
         .sort((a,b)=>(b.relevance||0)-(a.relevance||0)||a.costCenterName.localeCompare(b.costCenterName))
         .map(s=>[s.costCenterId,s.costCenterName+
             (s.costCenterSubcategories?.length?' · '+s.costCenterSubcategories.join(', '):'')+
             ((s.relevance||0)>0?' · Matches output':'')] as [string,string]),
 ];
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
    const supported=unit?skuSetup.units.filter(u=>u.categoryCode===unit.categoryCode&&u.baseUnit===unit.baseUnit):
        skuSetup.units.filter(u=>u.code&&u.baseUnit);
    return [
        ...(!current?([['','Choose a unit']] as Array<[string,string]>):
            [[current,bomUomName(current,skuSetup.units)] as [string,string]]),
        ...supported.filter(u=>u.code!==current&&u.symbol!==current)
            .map(u=>[u.code,bomUomName(u.code,skuSetup.units)] as [string,string]),
    ];
 };
 const changeComponentUnit=(index:number,code:string)=>{
    const old=components[index];
    const from=skuSetup.units.find(u=>u.code===old.uom||u.symbol===old.uom);
    const to=skuSetup.units.find(u=>u.code===code||u.symbol===code);
    // Converting material UOM must also convert its quantity and all
    // associated rate/buffer values: do not silently change physical amounts.
    if(from&&to&&from.baseUnit===to.baseUnit&&from.categoryCode===to.categoryCode&&
        Number.isFinite(from.multiplier)&&Number.isFinite(to.multiplier)&&to.multiplier>0){
        const factor=from.multiplier/to.multiplier;
        updateComponent(index,{uom:code,quantity:old.quantity*factor,
            ...(old.source==='PROCESS_SUPPLY'?{
                requiredFlowPerHour:old.requiredFlowPerHour==null?null:old.requiredFlowPerHour*factor,
                bufferCapacity:old.bufferCapacity==null?null:old.bufferCapacity*factor,
                bufferUsable:old.bufferUsable==null?null:old.bufferUsable*factor,
            }:{})});
    }else if(!old.uom||old.uom===code)updateComponent(index,{uom:code});
 };
 const sectionTabs=[
    {key:'settings',title:'1. Settings'},
    {key:'output',title:'2. Output'},
    {key:'materials',title:'3. Materials'},
 ] as const;
 return <div className='space-y-4'>
    <div role='tablist' aria-label='BOM creation sections' className='grid grid-cols-3 gap-1 rounded-xl border border-line bg-page p-1'>
        {sectionTabs.map(section=>
            <button key={section.key} id={'bom-tab-'+section.key} type='button' role='tab'
                aria-selected={sectionTab===section.key} aria-controls={'bom-panel-'+section.key}
                onClick={()=>{
                    setSectionTab(section.key);
                    if(section.key==='materials'){
                        setMaterialsView('list');
                        setSelectedMaterialIndex(null);
                    }
                }}
                className={'min-w-0 min-h-11 rounded-lg px-1.5 py-2 text-center text-xs font-semibold sm:px-3 sm:text-sm '+
                    (sectionTab===section.key?'bg-brand text-onbrand':'text-soft hover:bg-panel')}>
                {section.title}
            </button>)}
    </div>
    <section id='bom-panel-output' role='tabpanel' aria-labelledby='bom-tab-output'
        className={'space-y-3 rounded-xl border border-line p-3'+(sectionTab==='output'?'':' hidden')}>
        <h3 className='font-semibold'>2. What are you producing?</h3>
        {(str(draft.applicability)||'SKU')==='SKU'&&<Choice title='Output material or finished product' value={str(draft.parentSkuId)}
            options={outputChoices} onChange={v=>{
                const selected=items.find(i=>i.id===v);
                onChange({...draft,parentSkuId:v,outputUom:str(selected?.uom)||'EA',outputUnitCategory:'',
                    siteId:str(draft.siteId),productVariantId:'',routingId:'',
                    components:components.filter(c=>c.skuId!==v)});
                setMaterialsView('list');
                setSelectedMaterialIndex(null);
            }}/>}
        {output?<p className='text-sm text-soft'>Material classification: {str(output.category)} · Base unit: {bomUomName(str(output.uom),skuSetup.units)}</p>:
            <p className='text-xs text-muted'>{(str(draft.applicability)||'SKU')==='SKU'
                ?'Not listed? Create the material first in Materials & Products.'
                :'This is a shared BOM. Define the output measurement basis and quantity below.'}</p>}
        <div className='grid gap-2 sm:grid-cols-2'>
            <Field title='How much does this BOM produce?' type='number' value={quantity}
                onChange={v=>update('outputQty',Number(v))}/>
            <div className='rounded-xl border border-line bg-page p-3'>
                {(str(draft.applicability)||'SKU')==='SKU'?
                    <><p className='text-xs text-muted'>Output unit (from selected material)</p>
                    <p className='mt-1 text-sm font-semibold'>{bomUomName(outputUom,skuSetup.units)}</p></>:
                    <BomOutputUnitSelector draft={draft} setup={skuSetup}
                        allowedCodes={outputUnitOptions.map(unit=>unit.code)}
                        onCategoryChange={chooseOutputUnitCategory}
                        onChange={chooseOutputUnit} title='Output quantity unit'/>}
            </div>
        </div>
    </section>
    <section id='bom-panel-materials' role='tabpanel' aria-labelledby='bom-tab-materials'
        className={'space-y-3 rounded-xl border border-line p-3'+(sectionTab==='materials'?'':' hidden')}>
        <div>
            <h3 className='font-semibold'>3. What materials are needed?</h3>
            <p className='mt-1 text-xs text-muted'>Quantities for {quantity} {bomUomName(outputUom,skuSetup.units)} of the output.</p>
        </div>
        <div className='flex flex-wrap items-center justify-between gap-2'>
            <span className='text-sm font-semibold'>Added materials ({components.length})</span>
            <Button type='button' variant='secondary' disabled={!outputReady||components.length>=150}
                onClick={beginAddMaterial}>Add material</Button>
        </div>
        {!outputReady?<p className='text-sm text-muted'>Choose an applicable SKU in Settings before adding materials.</p>:
            <div className='space-y-3'>
            <div className='space-y-2'>
                {components.map((component,index)=>{
                    const description=describeMaterial(component);
                    return <div key={index} className='flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-page p-3'>
                        <div className='min-w-0 flex-1'>
                            <p className='break-words text-sm font-semibold'>{index+1}. {description.name}</p>
                            <p className='mt-1 text-xs text-muted'>{description.source}</p>
                            <p className='mt-1 text-xs text-soft'>
                                {Number.isFinite(component.quantity)?component.quantity.toLocaleString():'—'}
                                {' '}{bomUomName(component.uom,skuSetup.units)||'Unit not selected'}
                            </p>
                        </div>
                        <div className='flex shrink-0 items-center gap-2'>
                            <Button type='button' variant='secondary' onClick={()=>beginEditMaterial(index)}>Edit</Button>
                            <Button type='button' variant='danger' onClick={()=>removeMaterial(index)}>Delete</Button>
                        </div>
                    </div>;
                })}
                {!components.length&&<p className='rounded-lg bg-page p-3 text-sm text-muted'>
                    No materials added. Select Add material to enter the first material.
                </p>}
            </div>
            {materialsView==='edit'&&
            <div className='fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-0 sm:p-4'>
                <div role='dialog' aria-modal='true' aria-labelledby='bom-material-editor-title'
                    className='flex h-full min-h-0 w-full flex-col overflow-hidden bg-panel text-ink shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:max-w-3xl sm:rounded-2xl'>
                    <div className='flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3'>
                        <h4 id='bom-material-editor-title' className='text-base font-semibold'>
                            {materialEditorMode==='create'?'Add material':'Edit material '+(selectedMaterialIndex===null?'':selectedMaterialIndex+1)}
                        </h4>
                        <button type='button' aria-label='Cancel and close material editor' onClick={cancelMaterialEditor}
                            className='flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-line text-xl text-ink'>×</button>
                    </div>
                    <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-5'>
                {components.map((c,i)=>{
                    if(i!==selectedMaterialIndex)return null;
                    const fromWarehouse=c.source==='WAREHOUSE';
                    const processSupply=c.source==='PROCESS_SUPPLY';
                    const supplyRef=c.processSupplyKind||'SKU';
                    const processMaterial=refs.materials.find(m=>m.id===c.materialId);
                    const processUtility=refs.utilities.find(u=>u.workCenterId===c.utilityWorkCenterId&&u.code===c.utilityCode);
                    const currentSupply=costSupplies.find(x=>x.costCenterId===c.supplyCostCenterId&&x.code===c.supplyUtilityCode);
                    const selectedUnit=skuSetup.units.find(u=>u.code===c.uom||u.symbol.toLowerCase()===c.uom.toLowerCase());
                    // Aggregate demand is a RATE, not a per-BOM recipe quantity.
                    const demandRate=currentSupply&&currentSupply.demand>0&&currentSupply.determinantKey==='flow'&&selectedUnit?
                        normalizedMaterialFlow(currentSupply.demand,currentSupply.capacityUnit,
                            selectedUnit.symbol+'/h'):null;
                    const runHours=estimatedRunHours.trim()===''?null:Number(estimatedRunHours);
                    const demandQuantity=demandRate!==null&&runHours!==null&&Number.isFinite(runHours)&&runHours>0?
                        demandRate*runHours:null;
                    const material=refs.warehouseMaterials.find(m=>m.warehouseId===c.warehouseId&&m.id===c.materialId);
                    const warehouse=refs.warehouses.find(w=>w.id===c.warehouseId);
                    const selected=items.find(item=>item.id===c.skuId);
                    const materialSupplyProfile=(selected?.supplyProfile||{}) as SupplyProfile;
                    const unitBasis=fromWarehouse?material?.uom:processSupply?
                        (supplyRef==='SKU'?str(selected?.uom):supplyRef==='PROCUREMENT'?processMaterial?.uom:processUtility?.uom):
                        str(selected?.uom);
                    const availableMaterials=refs.warehouseMaterials.filter(m=>m.warehouseId===c.warehouseId);
                    return <div key={i} className='space-y-3'>
                        <Choice title='Material source' value={c.source==='PROCESS_SUPPLY'?'PROCESS_SUPPLY':fromWarehouse?'WAREHOUSE':'INTERMEDIATE'}
                            options={[
                                ['INTERMEDIATE','Manufactured intermediate / WIP'],
                                ['WAREHOUSE','Approved Procurement material from warehouse'],
                                ['PROCESS_SUPPLY','Process supply · continuous, metered, inline or bulk'],
                            ]}
                            onChange={v=>update('components',components.map((row,j)=>j===i?{
                                source:v as Component['source'],skuId:'',warehouseId:'',materialId:'',
                                utilityWorkCenterId:'',utilityCode:'',supplyCostCenterId:'',supplyUtilityCode:'',
                                processSupplyKind:v==='PROCESS_SUPPLY'?'SKU':undefined,
                                deliveryMode:v==='PROCESS_SUPPLY'?'INLINE':undefined,
                                quantityMethod:v==='PROCESS_SUPPLY'?'PLANNED':undefined,
                                requiredFlowPerHour:null,bufferCapacity:null,bufferUsable:null,
                                quantity:row.quantity,uom:'',scrapPct:row.scrapPct}:row))}/>
                        <span className='inline-flex rounded-full border border-line bg-panel px-3 py-1 text-xs font-medium text-ink'>
                            {processSupply?'PROCESS SUPPLY · NON-WAREHOUSE':
                                fromWarehouse?'WAREHOUSE · PROCUREMENT MATERIAL':
                                    !c.source&&selected&&str(selected.category)!=='INTERMEDIATE'?'EXISTING · MANUFACTURING SKU':'MANUFACTURED · INTERMEDIATE/WIP'}
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
                        </div>:processSupply?<div className='space-y-3'>
                            <p className='text-xs text-muted'>For treated water, gas, steam or other process inputs. Choose the existing material or utility first, then describe how it reaches this manufacturing stage. Do not create a duplicate SKU just because the source changes.</p>
                            <Choice title='Process supply reference' value={supplyRef}
                                options={[['SKU','Existing manufactured / raw material SKU'],
                                    ['UTILITY','Registered metered equipment utility'],
                                    ['PROCUREMENT','Approved Procurement material · direct/bulk (not a warehouse stock issue)']]}
                                onChange={v=>updateComponent(i,{processSupplyKind:v as Component['processSupplyKind'],
                                    skuId:'',materialId:'',warehouseId:'',utilityWorkCenterId:'',utilityCode:'',
                                    supplyCostCenterId:'',supplyUtilityCode:'',uom:''})}/>
                            {supplyRef==='SKU'&&<Choice title='Process material / intermediate SKU' value={c.skuId}
                                options={processMaterialChoices}
                                onChange={v=>updateComponent(i,{skuId:v,materialId:'',warehouseId:'',
                                    utilityWorkCenterId:'',utilityCode:'',supplyCostCenterId:'',supplyUtilityCode:'',
                                    uom:str(items.find(x=>x.id===v)?.uom)})}/>}
                            {supplyRef==='PROCUREMENT'&&<Choice title='Direct / bulk purchased material' value={c.materialId||''}
                                options={processProcurementChoices}
                                onChange={v=>updateComponent(i,{materialId:v,skuId:'',warehouseId:'',
                                    utilityWorkCenterId:'',utilityCode:'',supplyCostCenterId:'',supplyUtilityCode:'',
                                    uom:str(refs.materials.find(m=>m.id===v)?.uom)})}/>}
                            {supplyRef==='UTILITY'&&<div className='space-y-2 rounded-lg border border-line bg-panel p-3'>
                                <div className='flex flex-wrap items-center justify-between gap-2'>
                                    <p className='text-xs font-semibold'>Supplying cost centre &amp; utility</p>
                                    <button type='button' className='min-h-11 rounded-lg border border-line px-3 text-xs'
                                        onClick={refreshCostSupplies}>Refresh utility supplies</button>
                                </div>
                                <Choice title='Supplying cost centre' value={c.supplyCostCenterId||''}
                                    options={processCostCenterChoices}
                                    onChange={costCenterId=>{
                                        const selectedSupply=costSupplies.find(s=>s.costCenterId===costCenterId);
                                        onChange({...draft,
                                            siteId:selectedSupply?.siteId||str(draft.siteId),
                                            components:components.map((row,j)=>j===i?{...row,
                                                supplyCostCenterId:costCenterId,supplyUtilityCode:'',
                                                utilityWorkCenterId:'',utilityCode:''}:row),
                                        });
                                    }}/>
                                <Choice title='Utility supplied by selected cost centre'
                                    disabled={!c.supplyCostCenterId}
                                    value={c.supplyUtilityCode||''}
                                    options={[['','Choose utility from this cost centre'],
                                        ...relevantSupplies.filter(s=>s.costCenterId===c.supplyCostCenterId)
                                            .map(s=>[s.code,s.label+
                                                (s.ready?'':' · capacity configuration recommended')] as [string,string])]}
                                    onChange={code=>updateComponent(i,{supplyUtilityCode:code,
                                        utilityWorkCenterId:'',utilityCode:''})}/>
                                {costSupplyError&&<p role='alert' className='text-xs text-red-500'>{costSupplyError}</p>}
                                {!processCostCenterChoices.slice(1).length&&<p className='text-xs text-amber-600'>
                                    No cost-centre utility supplies configured within this site's permitted scope.
                                    Open Organization Design → Cost centre → Utility supply &amp; distribution,
                                    adopt the utility. Assigning a rated source asset is highly recommended, not mandatory for the BOM.
                                </p>}
                                {currentSupply&&<div className='space-y-1 rounded-lg bg-page p-3 text-xs'>
                                    <p className='font-semibold'>Available capability from the cost-centre master</p>
                                    <p>{currentSupply.costCenterName} · {currentSupply.label}</p>
                                    <p>Allocated capacity: {currentSupply.capacity??'Not rated'} {currentSupply.capacityUnit}</p>
                                    <p>Aggregate equipment demand: {currentSupply.demand} {currentSupply.capacityUnit}</p>
                                    <p>Loading: {currentSupply.percentage===null?'Not comparable':currentSupply.percentage.toFixed(1)+'%'}
                                        {' · '}Source assets: {currentSupply.sourceCount}
                                        {' · '}Status: {currentSupply.status}</p>
                                    {Object.entries(currentSupply.values).map(([key,value])=>
                                        <p key={key}>{key}: {String(value)}</p>)}
                                    {!currentSupply.ready&&
                                        <p role='status' className='rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900'>
                                            <strong>Highly recommended · Optional:</strong> Configure supplying assets, rated utility capacity and equipment demand at the cost centre.
                                            You can save and submit this BOM without completing those details. Capacity and compatibility may remain unverified until configured.
                                        </p>}
                                    {c.requiredFlowPerHour!=null&&c.requiredFlowPerHour>0&&
                                        currentSupply.capacity!==null&&currentSupply.determinantKey==='flow'&&
                                        (()=>{const adjusted=normalizedMaterialFlow(c.requiredFlowPerHour,c.uom,currentSupply.capacityUnit);
                                          return <p className={adjusted!==null&&adjusted>currentSupply.capacity?'text-red-500':'text-muted'}>
                                            BOM requested flow: {adjusted===null?'Unit conversion not verified · compare manually':
                                             adjusted.toLocaleString(undefined,{maximumFractionDigits:2})+' '+currentSupply.capacityUnit+
                                              (adjusted>currentSupply.capacity?' · EXCEEDS AVAILABLE UTILITY CAPACITY':' · within supply allocation')}
                                          </p>;})()}
                                    <p className='text-muted'>Existing equipment utility demand is not added to the BOM demand a second time.</p>
                                </div>}
                                <button type='button' className='min-h-10 rounded-lg border border-line px-3 text-xs'
                                    onClick={()=>navigate(c.supplyCostCenterId?'organization_admin/structure/'+c.supplyCostCenterId:'organization_admin/structure')}>
                                    Open cost-centre setup / add missing utility or source asset
                                </button>
                            </div>}
                            {supplyRef==='UTILITY'&&<p className='text-xs text-muted'>
                                A registered cost-centre utility supplies this process. Select its consumption UoM below;
                                the utility source's capacity and conditions are pulled from the cost centre.
                            </p>}
                            {supplyRef==='SKU'&&selected&&<div className='rounded-lg border border-line bg-page p-3 text-xs text-soft'>
                                <p className='font-semibold text-ink'>Adopted process material · {selected.name}</p>
                                <p className='mt-1'>Source SKU {selected.id} · {str(selected.category)}. This BOM uses its registered material identity, unit and supply setup directly. No extra supplying cost centre or utility needs to be selected here.</p>
                                {materialSupplyProfile.handlingMode&&<p className='mt-1'>Handling: {materialSupplyProfile.handlingMode.replaceAll('_',' ').toLowerCase()}</p>}
                                {(materialSupplyProfile.sources?.length??0)>0&&<p className='mt-1'>{materialSupplyProfile.sources?.length??0} material supply source(s) are already configured.</p>}
                                {str(selected.utilitySourceCostCenterId)&&str(selected.utilitySourceSubcategoryCode)&&
                                    <p className='mt-1'>Adopted utility origin: cost centre {str(selected.utilitySourceCostCenterId)} · activated source {str(selected.utilitySourceSubcategoryCode)}</p>}
                                <p className='mt-1'>Changes to the source master stay managed under Materials &amp; Products rather than being duplicated in this BOM.</p>
                            </div>}
                            {supplyRef==='PROCUREMENT'&&processMaterial&&<p className='text-xs text-muted'>
                                {processMaterial.materialNumber} · {processMaterial.name}. Direct process use does not create a warehouse stock issue or purchase.
                            </p>}
                            <Choice title='Supply / delivery arrangement' value={c.deliveryMode||'INLINE'}
                                options={[['INLINE','Inline · continuous / supply on demand'],
                                    ['BUFFERED','Continuous feed with a buffer tank or accumulator'],
                                    ['BULK_STORAGE','Bulk tank, silo or storage vessel'],
                                    ['CYLINDER','Cylinder / canister supply']]}
                                onChange={v=>updateComponent(i,{deliveryMode:v as Component['deliveryMode'],
                                    bufferCapacity:null,bufferUsable:null})}/>
                            <Choice title='How will actual usage be determined?' value={c.quantityMethod||'PLANNED'}
                                options={[['PLANNED','Fixed / calculated recipe requirement'],
                                    ['METERED','Metered continuous flow · actual usage recorded separately'],
                                    ['AS_REQUIRED','As required · planned estimate, actual quantity reconciled later']]}
                                onChange={v=>updateComponent(i,{quantityMethod:v as Component['quantityMethod']})}/>
                            <p className='text-xs text-muted'>All three methods still need a planned material quantity for the selected BOM output. This keeps MRP and recipe calculations valid; meter readings and actual consumption are separate records.</p>
                            {['BUFFERED','BULK_STORAGE'].includes(c.deliveryMode||'INLINE')&&
                                <div className='space-y-2 rounded-lg border border-line bg-panel p-3'>
                                    <p className='text-xs font-semibold'>Buffer / bulk storage</p>
                                    <Field title='Buffer size / physical capacity' type='number' value={c.bufferCapacity??''}
                                        onChange={v=>updateComponent(i,{bufferCapacity:v===''?null:Number(v)})}/>
                                    <Field title='Usable quantity currently available (optional)' type='number' value={c.bufferUsable??''}
                                        onChange={v=>updateComponent(i,{bufferUsable:v===''?null:Number(v)})}/>
                                    <p className='text-xs text-muted'>Both quantities use the material unit below. Usable quantity must not exceed capacity. Leave usable blank if unknown; zero indicates an empty usable buffer. Capacity is NOT material consumed by the recipe.</p>
                                </div>}
                        </div>:<div className='space-y-2'>
                            <Choice title='Manufactured intermediate' value={c.skuId} options={componentChoices}
                                onChange={v=>updateComponent(i,{skuId:v,warehouseId:'',materialId:'',
                                    uom:str(items.find(item=>item.id===v)?.uom)||''})}/>
                            {selected&&<p className='text-xs text-muted'>SKU {selected.id} · {selected.name} · {str(selected.category)}</p>}
                        </div>}
                        <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                            <Field title={processSupply?'Planned material quantity for BOM output':'Required quantity'}
                                type='number' value={c.quantity}
                                onChange={v=>updateComponent(i,{quantity:Number(v)})}/>
                        </div>
                        <BomMaterialUnitSelector
                            key={[i,c.source,c.skuId,c.materialId,c.warehouseId,c.processSupplyKind,c.supplyUtilityCode,unitBasis].join(':')}
                            setup={skuSetup} value={c.uom}
                            allowedUnitCodes={units(c.skuId,c.uom,unitBasis).map(([code])=>code).filter(Boolean)}
                            onChange={code=>changeComponentUnit(i,code)}/>
                        {processSupply&&<div className='space-y-2 rounded-lg border border-line bg-panel p-3'>
                            <p className='text-xs font-semibold'>Continuous / on-demand quantity planning</p>
                            {demandRate!==null&&<div className='space-y-2 rounded-lg border border-line p-3'>
                                <p className='font-semibold'>Suggested from equipment utility demand</p>
                                <p>Aggregate configured demand: {demandRate.toLocaleString(undefined,{maximumFractionDigits:2})} {bomUomName(c.uom,skuSetup.units)}/hour.</p>
                                <p>This is the cost-centre equipment aggregate, not a verified recipe quantity for this product. Review allocation to this BOM before applying.</p>
                                <Button type='button' variant='secondary'
                                    onClick={()=>updateComponent(i,{requiredFlowPerHour:demandRate})}>
                                    Use suggested flow rate
                                </Button>
                                <Field title='Estimated production duration (hours)' type='number'
                                    value={estimatedRunHours} onChange={setEstimatedRunHours}/>
                                {demandQuantity!==null&&<div className='space-y-2'>
                                    <p>Indicative material quantity: {demandQuantity.toLocaleString(undefined,{maximumFractionDigits:2})} {bomUomName(c.uom,skuSetup.units)}.</p>
                                    <Button type='button' variant='secondary'
                                        onClick={()=>updateComponent(i,{quantity:demandQuantity})}>
                                        Use suggested planned quantity
                                    </Button>
                                </div>}
                            </div>}
                            {currentSupply&&demandRate===null&&<p className='text-xs text-amber-600'>
                                No compatible, positive equipment demand flow is configured. Enter planned quantity manually; an estimate requires a known flow and production duration.
                            </p>}
                            <p className='text-xs text-muted'>The quantity above is required for {quantity} {bomUomName(outputUom,skuSetup.units)} of output, regardless of whether supply is metered or buffered. It is the planning basis for BOM demand, NOT a buffer volume or equipment rate.</p>
                            <Field title='Optional required continuous flow (material units/hour)' type='number'
                                value={c.requiredFlowPerHour??''}
                                onChange={v=>updateComponent(i,{requiredFlowPerHour:v===''?null:Number(v)})}/>
                            <p className='text-xs text-muted'>Use the same unit selected above. This optional target can be compared with upstream capacity during planning; it does not overwrite recipe quantities or represent a live meter reading.</p>
                            {['BUFFERED','BULK_STORAGE'].includes(c.deliveryMode||'INLINE')&&
                                c.bufferUsable!==null&&c.bufferUsable!==undefined&&
                                c.requiredFlowPerHour!==null&&c.requiredFlowPerHour!==undefined&&c.requiredFlowPerHour>0&&
                                <p className='text-xs font-semibold text-ink'>
                                    Without replenishment, the usable buffer would cover approximately {(c.bufferUsable/c.requiredFlowPerHour*60).toLocaleString(undefined,{maximumFractionDigits:1})} minutes of the stated requirement. This is not a live stoppage prediction.
                                </p>}
                        </div>}
                        {(fromWarehouse?!!material:processSupply?
                            (supplyRef==='SKU'?!!c.skuId:supplyRef==='PROCUREMENT'?!!c.materialId:!!c.utilityCode):
                            !!c.skuId)&&<details className='text-xs text-muted'>
                            <summary className='cursor-pointer py-2'>Consumption options</summary>
                            <div className='grid gap-2 pt-2 sm:grid-cols-2'>
                                <p className='text-xs text-muted'>Compatible units are selected above by category and subcategory.</p>
                                <Field title='Scrap / process loss allowance (%)' type='number' value={c.scrapPct}
                                    onChange={v=>updateComponent(i,{scrapPct:Number(v)})}/>
                            </div>
                        </details>}
                    </div>;
                })}
                    </div>
                    <div className='shrink-0 space-y-2 border-t border-line bg-panel p-3 sm:p-4'>
                        {materialEditorError&&<p role='alert' className='text-sm text-red-500'>{materialEditorError}</p>}
                        <div className='flex justify-end gap-2'>
                            <Button type='button' variant='secondary' onClick={cancelMaterialEditor}>Cancel</Button>
                            <Button type='button' onClick={saveMaterialEditor}>
                                {materialEditorMode==='create'?'Add material':'Save changes'}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>}
            </div>}
    </section>
    <section id='bom-panel-settings' role='tabpanel' aria-labelledby='bom-tab-settings'
        className={'rounded-xl border border-line p-3'+(sectionTab==='settings'?'':' hidden')}>
        <h3 className='font-semibold'>1. BOM settings and applicability</h3>
        <Choice title='Where does this BOM apply?' value={str(draft.applicability)||'SKU'}
            options={ [['SKU','One specific SKU'],['PROCESS_CLASS','All SKUs in a manufacturing process classification'],['ALL','All SKUs']] }
            onChange={v=>onChange({...draft,applicability:v,
                processClassId:v==='PROCESS_CLASS'?str(draft.processClassId):'',
                parentSkuId:v==='SKU'?str(draft.parentSkuId):'',
                outputUom:v==='SKU'?str(draft.outputUom):'',
                outputUnitCategory:''})}/>
        {(str(draft.applicability)||'SKU')==='SKU'&&
            <Choice title='Applicable SKU' value={str(draft.parentSkuId)} options={outputChoices}
                onChange={v=>{
                    const selected=items.find(i=>i.id===v);
                    onChange({...draft,parentSkuId:v,outputUom:str(selected?.uom)||'EA',
                        outputUnitCategory:'',components:components.filter(c=>c.skuId!==v)});
                }}/>}
        {str(draft.applicability)==='PROCESS_CLASS'&&
            <Choice title='Manufacturing process classification' value={str(draft.processClassId)}
                options={[['','Choose process classification'],
                    ...skuSetup.parameters.filter(p=>p.kind==='processClasses'&&p.enabled!==false)
                        .map(p=>[p.id,p.name] as [string,string])]}
                onChange={v=>update('processClassId',v)}/>}
        {str(draft.applicability)==='ALL'&&
            <p className='rounded-lg bg-page p-3 text-sm text-muted'>This BOM is a common default for all SKUs. SKU-specific and process-classification BOMs take precedence.</p>}
        <div className='grid gap-3 sm:grid-cols-2'>
            <Choice title='BOM classification' value={str(draft.classificationCode)||'PRODUCTION'}
                options={classes} onChange={v=>update('classificationCode',v)}/>
            <Field title='Alternative method identifier' value={str(draft.alternativeCode)||'STANDARD'}
                onChange={v=>update('alternativeCode',v.toUpperCase())}/>
            <BomOutputUnitSelector draft={draft} setup={skuSetup}
                allowedCodes={outputUnitOptions.map(unit=>unit.code)}
                onCategoryChange={chooseOutputUnitCategory}
                onChange={chooseOutputUnit} title='Output unit override'/>
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
    </section>
    <div className='flex flex-wrap items-center justify-between gap-2'>
        {sectionTab!=='settings'?<Button type='button' variant='secondary'
            onClick={()=>setSectionTab(sectionTab==='materials'?'output':'settings')}>
            Back
        </Button>:<span className='text-xs text-muted'>Step 1 of 3</span>}
        {sectionTab!=='materials'&&<Button type='button' variant='secondary'
            onClick={()=>setSectionTab(sectionTab==='settings'?'output':'materials')}>
            Next: {sectionTab==='settings'?'Output':'Materials'}
        </Button>}
    </div>
    <p className='text-xs text-muted'>Save draft is available on every tab. You can define upstream BOMs later. Production release follows the approval workflow.</p>
 </div>;
}

type UtilityCostCentreChoice={
 id:string;name:string;code:string;siteId:string;
 sources:Array<{code:string;label:string}>;
};
/** A raw/input SKU belongs to the organization. This only links its utility
 * consumption source to an authorized UTL cost centre and one of its own
 * activated operational subcategories, without forcing equipment adoption. */
function SkuUtilityCostCentreSource({draft,onChange}:{
 draft:Row;onChange:(row:Row)=>void;
}){
 const [centres,setCentres]=useState<UtilityCostCentreChoice[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const refresh=()=>{
    setLoading(true);setError('');
    void callBackend<{costCenters:UtilityCostCentreChoice[]}>(
        '/api/org/pln-mfg/foundation/utility-source-options')
      .then(data=>setCentres(data.costCenters))
      .catch(e=>setError(e instanceof Error?e.message:'Could not load permitted utility cost centres.'))
      .finally(()=>setLoading(false));
 };
 useEffect(()=>{refresh();},[]);
 const costCentreId=str(draft.utilitySourceCostCenterId);
 const selected=centres.find(c=>c.id===costCentreId);
 const sourceCode=str(draft.utilitySourceSubcategoryCode);
 const sourceOptions:Array<[string,string]>=[['','Choose an activated utility source'],
    ...(selected?.sources||[]).map(s=>[s.code,s.label] as [string,string])];
 return <div className='md:col-span-2 space-y-3 rounded-xl border border-line bg-page p-3'>
    <h3 className='text-sm font-semibold'>Utilities supply source</h3>
    <p className='text-xs text-muted'>Choose a Utilities (UTL) cost centre within your permitted scope, then select a source from its activated subcategories in Organization Design.</p>
    <Choice title='Utilities cost centre' value={costCentreId}
        options={[['','Choose an authorized Utilities cost centre'],
            ...centres.map(c=>[c.id,(c.code?c.code+' · ':'')+c.name] as [string,string])]}
        onChange={id=>onChange({...draft,utilitySourceCostCenterId:id,
            utilitySourceSubcategoryCode:'',utilityCode:'',utilityWorkCenterId:''})}
        disabled={loading}/>
    <Choice title='Source (activated cost-centre subcategory)' value={sourceCode}
        options={sourceOptions} disabled={!selected||!selected.sources.length}
        onChange={code=>onChange({...draft,utilitySourceSubcategoryCode:code,
            utilityCode:'',utilityWorkCenterId:''})}/>
    {selected&&!selected.sources.length&&<p className='text-xs text-amber-600'>No active Utilities subcategories were found on this cost centre. Configure them in Organization Design.</p>}
    {!selected&&costCentreId&&!loading&&!error&&<p className='text-xs text-amber-600'>This cost centre is not currently available to you. Select a permitted Utilities cost centre.</p>}
    {loading&&<p role='status' className='text-xs text-muted'>Loading Utilities cost centres…</p>}
    {error&&<div className='flex flex-wrap items-center gap-2'>
        <p role='alert' className='text-xs text-red-500'>{error}</p>
        <Button type='button' variant='secondary' onClick={refresh}>Retry</Button>
    </div>}
    {!loading&&!error&&!centres.length&&<p className='text-xs text-amber-600'>No accessible Utilities cost centres with activated subcategories are available. Configure one in Organization Design or request access.</p>}
    {!costCentreId&&!!str(draft.utilityWorkCenterId)&&
        <p className='text-xs text-muted'>Historical equipment-level source: {str(draft.utilityWorkCenterId)} · {str(draft.utilityCode)}. Choose a cost centre and source to migrate this material.</p>}
    <p className='text-xs text-muted'>This selection identifies the material's utility source activity. Physical supply assets, rated capacity and distribution remain configured separately under the cost centre.</p>
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
    const materialOptions:Array<[string,string]>=[['','Select approved Inventory material'],...refs.materials.map(r=>[r.id,r.materialNumber+' · '+r.name] as [string,string])];
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
                        onChange={v=>onChange({...draft,sourceMode:v,inventoryMaterialId:'',
                            utilityCode:'',utilityWorkCenterId:'',utilitySourceCostCenterId:'',
                            utilitySourceSubcategoryCode:''})}/>}
                {['RAW','PACKAGING'].includes(str(draft.category))&&str(draft.sourceMode)==='INVENTORY'&&
                    <Choice title='Published Inventory Material Master' value={str(draft.inventoryMaterialId)} options={materialOptions}
                        onChange={v=>{const found=refs.materials.find(m=>m.id===v);onChange({...draft,inventoryMaterialId:v,uom:found?.uom||draft.uom});}}/>}
                {['RAW','PACKAGING'].includes(str(draft.category))&&str(draft.sourceMode)==='DIRECT'&&
                    <p className='text-xs text-muted'>Direct consumption tracks the material as a BOM input without creating stock issues. Purchasing, costing and consumption evidence still require downstream configuration.</p>}
                {str(draft.category)==='RAW'&&str(draft.sourceMode)==='UTILITY'&&
                    <SkuUtilityCostCentreSource draft={draft} onChange={onChange}/>}
            </>}
            {tab!=='items'&&<Choice title='Site applicability' value={str(draft.siteId)} options={siteOptions} onChange={v=>update('siteId',v)}/>}
            {tab==='items'&&<p className='md:col-span-2 text-xs text-muted'>
                SKUs belong to the organization, not one site. Their manufacturing process classification is shared across sites. Set site-specific availability and production speed through Manufacturing Resources → SKU allocation; no site mappings are changed by classification.
            </p>}
        </div>
        {tab==='items'&&['FINISHED','INTERMEDIATE'].includes(str(draft.category))&&
            <SkuIdentityGuide inSkuForm/>}
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
    const [active,setActive]=useState<Tab>(module==='PLN'?'sop':'materialPolicy');
    const [rows,setRows]=useState<Record<Kind,Row[]>>(emptyRows);
    const [skuSetup,setSkuSetup]=useState<SkuSetup>(emptySkuSetup);
    const [refs,setRefs]=useState<References>(emptyReferences);
    const [draft,setDraft]=useState<Row|null>(null);
    const [testBomOverride,setTestBomOverride]=useState(false);
    const [viewSkuId,setViewSkuId]=useState('');
    const [skuEditTab,setSkuEditTab]=useState<'details'|'audit'>('details');
    const [skuViewTab,setSkuViewTab]=useState<'details'|'audit'>('details');
    const [viewBomId,setViewBomId]=useState('');
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
        t.key==='formDefaults'||t.key==='config'||t.key==='demand'||t.key==='sop'?canViewPlanning:canViewMasters);
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
            setViewBomId('');
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
    const canDeleteBom=canViewMasters&&hasPerm(permissions,'MFG.bom.delete');
    const viewedBom=rows.boms.find(row=>row.id===viewBomId);
    const load=async()=>{
        setLoading(true);setError('');
        try{
            const [datasets,configuration,refData,skuData,materialSetup,capacitySetup,testState]=await Promise.all([
                canViewMasters?Promise.all(kinds.map(kind=>callBackend<{records:Row[]}>('/api/org/pln-mfg/foundation/list',{kind}))):Promise.resolve(kinds.map(()=>({records:[] as Row[]}))),
                callBackend<{config:Config;revision:number;formDefaultsRevision:number}>('/api/org/pln-mfg/foundation/config').catch(()=>null),
                canViewMasters?callBackend<References>('/api/org/pln-mfg/foundation/references'):Promise.resolve(emptyReferences),
                canViewMasters?callBackend<SkuSetup>('/api/org/pln-mfg/sku/setup'):Promise.resolve(emptySkuSetup),
                canViewMasters?callBackend<{policy:MaterialPolicy;revision:number}>('/api/org/pln-mfg/foundation/material-policy'):Promise.resolve({policy:defaultMaterialPolicy,revision:0}),
                canViewPlanning?callBackend<{mappings:SetupRow[]}>('/api/org/pln/cost-center/hierarchy').catch(()=>null):Promise.resolve(null),
                canViewMasters?callBackend<{testOverride:boolean}>('/api/org/pln-mfg/foundation/test-state').catch(()=>({testOverride:false})):Promise.resolve({testOverride:false}),
            ]);
            setTestBomOverride(testState.testOverride);
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
        setActive(tab);setDraft(null);setViewSkuId('');setViewBomId('');setHistory([]);setError('');setNotice('');setDecisionReason('');
    };
    const copyVersion=(row:Row)=>{setViewSkuId('');setViewBomId('');const cloned={...row,id:'',name:String(row.name)+' — new revision',revision:undefined,status:'draft',effectiveFrom:'',createdBy:undefined,submittedBy:undefined,approvedBy:undefined,approvedAt:undefined};setDraft(cloned);setHistory([]);setError('');setNotice('Give this version a new unique code and effective date. The approved original remains unchanged.');};
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
        setViewSkuId('');setViewBomId('');setDraft(row);setHistory([]);setError('');
        setSkuEditTab('details');
        if(active==='items')return; // The SKU audit is loaded on demand in its dedicated tab.
        try{
            const result=await callBackend<{revisions:Row[]}>('/api/org/pln-mfg/foundation/history',{kind:recordKind(active),id:row.id});
            setHistory(result.revisions);
        }catch(e){setError(e instanceof Error?e.message:'Could not read revision history.');}
    };
    const deleteBom=async(row:Row)=>{
        if(active!=='boms'||!canDeleteBom||busy)return;
        if(!window.confirm('Delete BOM '+row.id+' · '+row.name+'? It will disappear from the active list, but its revisions and audit trail will be retained. Approved BOMs require privileged test mode and cannot be deleted if referenced by a routing.'))return;
        setBusy(true);setError('');setNotice('');
        try{
            await callBackend('/api/org/pln-mfg/foundation/delete',{
                id:row.id,expectedRevision:row.revision??1,
            });
            setViewBomId('');
            await load();
            setNotice('BOM '+row.id+' deleted. Prior revisions and audit history are retained.');
        }catch(e){setError(e instanceof Error?e.message:'BOM deletion was not permitted.');}
        finally{setBusy(false);}
    };
    const save=async()=>{
        if(!draft||!canSave)return;
        if(active==='items'){
            if(str(draft.category)==='RAW'&&str(draft.sourceMode)==='UTILITY'&&
                !(str(draft.utilitySourceCostCenterId)&&str(draft.utilitySourceSubcategoryCode))&&
                !(str(draft.id)&&str(draft.utilityWorkCenterId)&&str(draft.utilityCode))){
                setError('Select a Utilities (UTL) cost centre and one of its activated source subcategories before saving this raw/input material.');
                return;
            }
            if(['FINISHED','INTERMEDIATE'].includes(str(draft.category))&&
                skuSetup.parameters.some(p=>p.kind==='processClasses'&&p.enabled!==false)&&
                !str(draft.processClassId)){
                setError('Select a manufacturing process classification before saving this manufactured SKU.');
                return;
            }
            if(str(draft.category)!=='FINISHED'&&!skuSetup.units.some(u=>u.code===str(draft.uom)||u.symbol.toLowerCase()===str(draft.uom).toLowerCase())){
                setError('Choose a unit category and unit of measure from the MEMS unit registry.');return;
            }
        }
        if(active==='boms'){
            const parts=asComponents(draft.components);
            if((str(draft.applicability)||'SKU')==='SKU'&&!str(draft.parentSkuId)){setError('Choose the applicable SKU before saving.');return;}
            if(str(draft.applicability)==='PROCESS_CLASS'&&!str(draft.processClassId)){setError('Choose the manufacturing process classification before saving.');return;}
            if(!str(draft.outputUom)){setError('Choose the output unit before saving.');return;}
            if(!parts.length||parts.some(c=>{
                const missing=c.source==='WAREHOUSE'?(!str(c.warehouseId)||!str(c.materialId)):
                    c.source==='PROCESS_SUPPLY'?(c.processSupplyKind==='SKU'?!str(c.skuId):
                        c.processSupplyKind==='UTILITY'?false:
                        c.processSupplyKind==='PROCUREMENT'?!str(c.materialId):true):!str(c.skuId);
                const missingDistribution=c.source==='PROCESS_SUPPLY'&&c.processSupplyKind==='UTILITY'&&
                    (!str(c.supplyCostCenterId)||!str(c.supplyUtilityCode))&&
                    // Keep historical read-only-ish process links visible; the
                    // backend allows only unchanged legacy lines during migration.
                    !(str(draft.id)&&str(c.utilityWorkCenterId));
                const needsBuffer=c.source==='PROCESS_SUPPLY'&&
                    ['BUFFERED','BULK_STORAGE'].includes(c.deliveryMode||'INLINE');
                const invalidBuffer=needsBuffer&&(!Number.isFinite(c.bufferCapacity)||Number(c.bufferCapacity)<=0||
                    (c.bufferUsable!=null&&(!Number.isFinite(c.bufferUsable)||
                        c.bufferUsable<0||c.bufferUsable>Number(c.bufferCapacity))));
                const invalidRate=c.source==='PROCESS_SUPPLY'&&c.requiredFlowPerHour!=null&&
                    (!Number.isFinite(c.requiredFlowPerHour)||c.requiredFlowPerHour<=0);
                return missing||missingDistribution||!str(c.uom)||!Number.isFinite(c.quantity)||c.quantity<=0||
                    invalidBuffer||invalidRate;
            })){
                setError('Every BOM material needs its selected SKU, utility or Procurement material, a valid unit and positive planned consumption. Supplying cost-centre details are required only for direct utility references; check rates and buffer sizes where used.');return;
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
            await load();setDraft(null);setNotice('Saved '+(result.generatedCode||result.record.id)+' · Revision '+result.record.revision+
                (active==='boms'&&testBomOverride?'. Applied immediately with audited test override.':
                 '. Existing BOM code retained. Normal approval controls apply.'));
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
        }}/>:active==='sop'?<PlnPlanningWorkspace/>:active==='demand'?<PlnDemand permissions={permissions} formDefaults={formDefaults}/>: active==='skuSetup'?<SkuSetupPanel setup={skuSetup} canEdit={canSkuConfig} onSaved={refreshSkuSetup}
            onOpenSkus={()=>changeTab('items')}/>:active==='materialPolicy'?<Card className='space-y-4'>
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
        </Card>:active==='resources'?<ManufacturingResources defaultCategory={formDefaults.resourceCostCenterCategory}
            defaultSubcategory={formDefaults.resourceCostCenterSubcategory} onChanged={()=>{void load();}}
            onEditSku={skuId=>{
                // Open the mapped SKU for correction in Materials & Products (restored after 209877a).
                const found=rows.items.find(item=>item.id===skuId);
                setActive('items');setDraft(null);setViewSkuId('');
                if(found){void openDraft(found);}
                else setError('The selected SKU was not found in your current Materials & Products list. Refresh the list and search for '+skuId+'.');
            }}/>:active==='capacityOverview'?
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
            <div className='flex min-w-0 flex-wrap items-center justify-between gap-2'><p className='text-xs text-muted sm:text-sm'>{active==='routings'?'Choose or create a process route. A route can serve multiple SKUs.':filtered.length+' saved master records · draft versions'}</p>{canSave&&!viewSkuId&&!viewBomId&&<Button onClick={()=>{setViewBomId('');setDraft(newRecord(active,materialPolicy,formDefaults,refs.sites));setError('');setNotice('');}}>Add {active==='items'?'SKU':active==='boms'?'BOM':active==='routings'?'new route':'resource'}</Button>}</div>
            {draft?<Card className={'space-y-4'+(active==='boms'&&testBomOverride?' border-2 border-blue-600':'')}>
                <div className='flex items-center justify-between gap-2'><h2 className='font-semibold'>{active==='routings'?(draft.revision?'Edit routing draft':'Create manufacturing route'):(draft.revision?'Edit draft':'New master record')}</h2>{active!=='boms'&&<Button variant='secondary' disabled={busy} onClick={()=>setDraft(null)}>Cancel</Button>}</div>
                {active==='boms'&&testBomOverride&&
                    <div role='status' className='rounded-xl border-2 border-blue-600 bg-blue-50 p-3 text-sm text-blue-900'>
                        Development test override · super admin. Save applies changes immediately to this BOM code; version history and high-priority security audit are retained.
                    </div>}
                {active==='items'&&!!draft.id&&<div role='tablist' aria-label='SKU editor sections'
                    className='grid grid-cols-2 gap-1 rounded-xl border border-line bg-page p-1'>
                    <button type='button' role='tab' aria-selected={skuEditTab==='details'}
                        onClick={()=>setSkuEditTab('details')}
                        className={'min-h-11 rounded-lg px-3 text-sm font-semibold '+(skuEditTab==='details'?'bg-brand text-onbrand':'text-soft')}>
                        SKU information
                    </button>
                    <button type='button' role='tab' aria-selected={skuEditTab==='audit'}
                        onClick={()=>setSkuEditTab('audit')}
                        className={'min-h-11 rounded-lg px-3 text-sm font-semibold '+(skuEditTab==='audit'?'bg-brand text-onbrand':'text-soft')}>
                        Audit log
                    </button>
                </div>}
                {active!=='items'&&draft.revision&&<div className='flex flex-wrap gap-2 text-xs text-soft'><span className='font-semibold'>Revision history:</span>{history.map(h=><span key={String(h.revision)} className='rounded-md border border-line px-2 py-1'>r{h.revision} · {str(h.updatedAt).slice(0,10)}</span>)}</div>}
                {active==='items'&&draft.id&&skuEditTab==='audit'
                    ?<PlnSkuAuditLog skuId={draft.id}/>
                    :<>
                <MasterEditor tab={active} draft={draft} onChange={setDraft} items={rows.items}
                    boms={rows.boms} resources={rows.resources} refs={refs} skuSetup={skuSetup} materialPolicy={materialPolicy}/>
                {active==='items'&&draft.id&&['FINISHED','INTERMEDIATE'].includes(str(draft.category))&&
                    <PlnSkuCostCenterRatings skuId={draft.id}/>}

                <div className='flex flex-wrap justify-end gap-2'>
                    {active==='boms'&&<Button variant='secondary' disabled={busy} onClick={()=>setDraft(null)}>Cancel</Button>}
                    <Button disabled={busy||!canSave} className={active==='boms'&&testBomOverride?'border-2 border-blue-600 ring-2 ring-blue-300':''}
                        onClick={()=>void save()}>{busy?'Saving...':active==='boms'&&testBomOverride?'Save & apply now':active==='boms'?'Save BOM':'Save draft'}</Button>
                </div>
                </>}
            </Card>:active==='boms'&&viewedBom?<Card className='space-y-4'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                    <h2 className='font-semibold'>BOM details · {viewedBom.id}</h2>
                    <Button variant='secondary' onClick={()=>setViewBomId('')}>Back to BOM list</Button>
                </div>
                <div className='rounded-xl bg-page p-3'>
                    <p className='break-words font-semibold'>{viewedBom.name}</p>
                    <p className='mt-1 text-sm text-muted'>Status: {str(viewedBom.status)||'draft'} · Revision {viewedBom.revision??1}</p>
                    <p className='mt-1 text-sm text-muted'>Effective: {str(viewedBom.effectiveFrom)||'Immediately'}</p>
                </div>
                <div className='space-y-1'>
                    <h3 className='font-semibold'>Output</h3>
                    <p className='break-words text-sm'>
                        {rows.items.find(item=>item.id===str(viewedBom.parentSkuId))?.name||str(viewedBom.parentSkuId)}
                        {' · '}{number(viewedBom.outputQty)} {bomUomName(str(viewedBom.outputUom),skuSetup.units)}
                    </p>
                </div>
                <div className='space-y-2'>
                    <h3 className='font-semibold'>Materials ({asComponents(viewedBom.components).length})</h3>
                    {asComponents(viewedBom.components).map((component,index)=>{
                        const sku=rows.items.find(item=>item.id===component.skuId);
                        const warehouseMaterial=refs.warehouseMaterials.find(item=>
                            item.id===component.materialId&&item.warehouseId===component.warehouseId);
                        const purchased=refs.materials.find(item=>item.id===component.materialId);
                        const utility=refs.utilities.find(item=>item.code===component.utilityCode&&
                            item.workCenterId===component.utilityWorkCenterId);
                        const name=component.source==='WAREHOUSE'?
                            (warehouseMaterial?.name||purchased?.name||component.materialId):
                            component.source==='PROCESS_SUPPLY'&&component.processSupplyKind==='UTILITY'?
                            (utility?.name||component.supplyUtilityCode||'Process utility'):
                            component.source==='PROCESS_SUPPLY'&&component.processSupplyKind==='PROCUREMENT'?
                            (purchased?.name||component.materialId):
                            (sku?.name||component.skuId||'Not selected');
                        return <div key={index} className='rounded-lg border border-line p-3'>
                            <p className='break-words text-sm font-semibold'>{index+1}. {name}</p>
                            <p className='mt-1 text-xs text-muted'>{component.source==='WAREHOUSE'?'Warehouse':component.source==='PROCESS_SUPPLY'?'Process supply':'Intermediate / WIP'} · {component.quantity} {bomUomName(component.uom,skuSetup.units)}</p>
                        </div>;
                    })}
                </div>
                <div className='space-y-1 text-sm text-soft'>
                    <h3 className='font-semibold text-ink'>Settings</h3>
                    <p>Classification: {materialPolicy.bomClassifications.find(x=>x.code===str(viewedBom.classificationCode))?.name||str(viewedBom.classificationCode)}</p>
                    <p>Alternative: {str(viewedBom.alternativeCode)||'STANDARD'}</p>
                    <p>Site: {refs.sites.find(site=>site.id===str(viewedBom.siteId))?.name||'Organization default'}</p>
                    {str(viewedBom.versionNote)&&<p>Version note: {str(viewedBom.versionNote)}</p>}
                    {str(viewedBom.description)&&<p className='whitespace-pre-wrap'>Notes: {str(viewedBom.description)}</p>}
                </div>
            </Card>:active==='items'&&viewSkuId?<Card className='space-y-4'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                    <h2 className='font-semibold'>Manufactured SKU detail</h2>
                    <Button variant='secondary' onClick={()=>setViewSkuId('')}>Back to SKU list</Button>
                </div>
                {viewedSku?<>
                    <div role='tablist' aria-label='SKU detail sections' className='grid grid-cols-2 gap-1 rounded-xl border border-line bg-page p-1'>
                        <button type='button' role='tab' aria-selected={skuViewTab==='details'}
                            onClick={()=>setSkuViewTab('details')}
                            className={'min-h-11 rounded-lg px-3 text-sm font-semibold '+(skuViewTab==='details'?'bg-brand text-onbrand':'text-soft')}>SKU information</button>
                        <button type='button' role='tab' aria-selected={skuViewTab==='audit'}
                            onClick={()=>setSkuViewTab('audit')}
                            className={'min-h-11 rounded-lg px-3 text-sm font-semibold '+(skuViewTab==='audit'?'bg-brand text-onbrand':'text-soft')}>Audit log</button>
                    </div>
                    {skuViewTab==='audit'?<PlnSkuAuditLog skuId={viewedSku.id}/>:<>
                    <div className='rounded-xl bg-page p-3'>
                        <p className='font-mono text-xs text-brand'>{viewedSku.id}</p>
                        <p className='mt-1 break-words font-semibold'>{viewedSku.name}</p>
                        <p className='mt-1 text-xs text-muted'>{str(viewedSku.category)} · {str(viewedSku.uom)} · Revision {viewedSku.revision??1}</p>
                        <p className='mt-1 text-xs text-muted'>Manufacturing process: {skuSetup.parameters.find(p=>p.id===str(viewedSku.processClassId))?.name||'Not classified'}</p>
                    </div>
                    {['FINISHED','INTERMEDIATE'].includes(str(viewedSku.category))&&
                        <PlnSkuCostCenterRatings skuId={viewedSku.id}/>}
                    {canSave&&['draft','rejected',''].includes(str(viewedSku.status))&&
                        <Button variant='secondary' onClick={()=>void openDraft(viewedSku)}>Edit SKU draft</Button>}
                    </>}
                </>:<p className='text-sm text-muted'>SKU not found. Refresh the Materials &amp; Products list.</p>}
            </Card>:<div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>{filtered.map(row=><Card key={row.id} className='space-y-2'>
                <div className='flex items-start justify-between gap-2'><span className='font-mono text-xs text-brand'>{row.id}</span><span className='rounded-full bg-page px-2 py-1 text-xs uppercase text-soft'>{str(row.status)||'draft'}</span></div>
                <h3 className='break-words font-semibold'>{row.name}</h3>
                <p className='text-xs text-muted'>{active==='items'?
                    str(row.category)+' · '+str(row.uom)+' · Process: '+(skuSetup.parameters.find(p=>p.id===str(row.processClassId))?.name||'Not classified'):
                    active==='routings'?'Process: '+(skuSetup.parameters.find(p=>p.id===str(row.processClassId))?.name||'Not classified')+' · Alternative: '+(str(row.alternativeCode)||'Not set')+' · '+asOperations(row.operations).length+' stages · '+((str(row.skuId)?1:0)+(Array.isArray(row.skuMappings)?row.skuMappings.length:0))+' mapped SKU(s)':
                    'BOM · '+(materialPolicy.bomClassifications.find(c=>c.code===str(row.classificationCode))?.name||str(row.classificationCode)||'Production')+' · Components: '+asComponents(row.components).length}</p>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='text-xs text-muted'>Revision {row.revision??1} · effective {str(row.effectiveFrom)||'immediately'}</span>
                    {active==='items'&&['FINISHED','INTERMEDIATE'].includes(str(row.category))&&
                        <Button variant='secondary' onClick={()=>{
                            setViewSkuId(row.id);setSkuViewTab('details');setDraft(null);setError('');setNotice('');
                        }}>View SKU</Button>}
                    {active==='items'&&<Button variant='secondary' disabled={busy} onClick={()=>{
                        setViewSkuId(row.id);setSkuViewTab('audit');setDraft(null);setError('');setNotice('');
                    }}>Audit log</Button>}
                    {active==='boms'&&<div className='flex flex-wrap gap-2'>
                        <Button variant='secondary' disabled={busy} onClick={()=>{
                            setDraft(null);setViewSkuId('');setViewBomId(row.id);setError('');setNotice('');
                        }}>View</Button>
                        {canSave&&<Button variant='secondary' disabled={busy||(str(row.status)==='pending_approval'&&!testBomOverride)}
                            className={testBomOverride?'border-2 border-blue-600':''}
                            title={str(row.status)==='pending_approval'&&!testBomOverride?'Submitted BOMs must complete review before editing.':''}
                            onClick={()=>void openDraft(row)}>
                            Edit
                        </Button>}
                        {canDeleteBom&&<Button variant='danger' disabled={busy}
                            onClick={()=>void deleteBom(row)}>Delete</Button>}
                    </div>}
                    {active!=='boms'&&canSave&&['draft','rejected',''].includes(str(row.status))&&<Button variant='secondary' onClick={()=>void openDraft(row)}>Open / edit</Button>}
                    {active==='items'&&canEdit&&canSkuConfig&&str(row.status)==='active'&&
                        ['FINISHED','INTERMEDIATE'].includes(str(row.category))&&
                        <Button variant='secondary' onClick={()=>{
                            setClassEditingSku(row.id);setClassSelected(str(row.processClassId));
                            setError('');setNotice('');
                        }}>Classify manufacturing process</Button>}
                    {canSave&&active==='routings'&&<Button variant='secondary' onClick={()=>createAlternativeRoute(row)}>Create different route from this</Button>}
                    {active!=='boms'&&canSave&&['active','pending_approval'].includes(str(row.status))&&<Button variant='secondary' onClick={()=>copyVersion(row)}>New version</Button>}
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
                {str(row.status)==='pending_approval'&&(canApprove||active==='boms'&&testBomOverride)&&<div className='space-y-2'>
                    <Field title='Decision note / rejection reason' value={decisionReason} onChange={setDecisionReason}/>
                    <div className='flex flex-wrap gap-2'>
                        <Button disabled={busy} className={testBomOverride?'border-2 border-blue-600':''}
                            onClick={()=>void release(row.id,'approve')}>Approve version</Button>
                        <Button variant='danger' disabled={busy} onClick={()=>void release(row.id,'reject')}>Reject</Button>
                    </div>
                    <p className='text-xs text-muted'>{active==='boms'&&testBomOverride?
                        'Blue-border test override: a super admin may approve their own BOM; all bypasses are audited.':
                        'The submitter and creator cannot approve their own master data.'}</p>
                </div>}
            </Card>)}</div>}
            {!filtered.length&&!draft&&<Card><p className='text-sm text-muted'>No records exist yet. Begin with material and product records, then define BOMs, resources and routings.</p></Card>}
        </>}
    </div>;
}
