import { useEffect, useId, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Alert, Field as MemsField, SelectField } from '../components/ui';
import { Spinner } from '../admin/kit';
import { SkuConfigurationFields, SkuSetupPanel, emptySkuSetup, type SkuSelections, type SkuSetup } from './MfgSkuSetup';
function Card({children,className=''}:{children:ReactNode;className?:string}){
    return <section className={'rounded-2xl border border-line bg-panel p-4 text-ink '+className}>{children}</section>;
}
function PageTitle({title,action}:{title:string;action:ReactNode}){
    return <div className='mb-4 flex flex-col items-start gap-3 py-2 sm:flex-row sm:items-center sm:justify-between'>
        <h1 className='text-xl font-semibold text-ink'>{title}</h1>
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
type Tab=Kind|'skuSetup'|'config'|'demo';
type Row=Record<string,unknown>&{id:string;name:string;revision?:number;type?:string};
type Component={skuId:string;quantity:number;uom:string;scrapPct:number};
type Operation={code:string;name:string;resourceId:string;setupMinutes:number;runMinutesPerUnit:number;producesSkuId?:string;dependsOn?:string[]};
type Config={horizonDays:number;freezeDays:number;lotPolicy:string;strategy:string};
type Demo={demo:boolean;persisted:boolean;label:string;items:Row[];boms:Row[];resources:Row[];routings:Row[]};
type DemoStatus={sandboxId:string;seeded:boolean;isolated:boolean;canSeed:boolean;createdAt:string;warning:string;counts:Record<string,number>|null};
type DemoVerification={seeded:boolean;valid:boolean;errors:string[];counts:Record<string,{expected:number;stored:number}>|null;verifiedAt?:string};
type References={
    materials:Array<{id:string;name:string;materialNumber:string;uom:string}>;
    utilities:Array<{workCenterId:string;code:string;name:string}>;
    assets:Array<{id:string;name:string;siteId:string}>;
    sites:Array<{id:string;name:string;code:string}>;
};
const emptyReferences:References={materials:[],utilities:[],assets:[],sites:[]};
const kinds:Kind[]=['items','boms','resources','routings'];
const tabs:{key:Tab;label:string;hint:string}[]=[
    {key:'skuSetup',label:'SKU Configuration',hint:'Configure names, production forms, containers, packages and normalization units'},
    {key:'items',label:'Products & SKUs',hint:'Finished, intermediate and Inventory-linked raw materials'},
    {key:'boms',label:'Bills of Materials',hint:'Flavor/Variant BOM and Packaging BOM, with separate versioned structures'},
    {key:'resources',label:'Manufacturing Resources',hint:'Work centres, machines and production lines'},
    {key:'routings',label:'Process Routings',hint:'Stage-by-stage manufacturing operations'},
    {key:'config',label:'Planning Configuration',hint:'Organization planning defaults'},
    {key:'demo',label:'Line 11 Pilot Preview',hint:'Read-only fictional multi-stage example'},
];
const emptyRows:Record<Kind,Row[]>={items:[],boms:[],resources:[],routings:[]};
const fld='w-full min-h-11 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-brand';
const label='mb-1 block text-xs font-medium text-soft';
const newRecord=(tab:Tab):Row=>{
    if(tab==='items')return {id:'',name:'',category:'FINISHED',family:'',uom:'EA',siteId:'',packQty:1,
        stockPolicy:'NON_STOCKED',sourceMode:'INVENTORY',inventoryMaterialId:'',utilityCode:'',utilityWorkCenterId:'',skuComponents:{}};
    if(tab==='boms')return {id:'',name:'',type:'FLAVOR_VARIANT',flavorVariantId:'',alternativeCode:'STANDARD',routingId:'',
        parentSkuId:'',outputQty:1,outputUom:'EA',components:[{skuId:'',quantity:1,uom:'EA',scrapPct:0}]};
    if(tab==='resources')return {id:'',name:'',type:'LINE',rate:1000,rateUom:'EA',efficiency:100,siteId:'',assetId:''};
    return {id:'',name:'',skuId:'',operations:[{code:'STG_000000001',name:'',resourceId:'',setupMinutes:0,runMinutesPerUnit:0,producesSkuId:'',dependsOn:[]}]};
};
const recordKind=(tab:Tab):Kind=>tab as Kind;
const bomCategory=(type:string):'FLAVOR_VARIANT'|'PACKAGING'=>
    type==='FLAVOR_VARIANT'||type==='RECIPE'?'FLAVOR_VARIANT':'PACKAGING';
const bomLabel=(type:string)=>bomCategory(type)==='FLAVOR_VARIANT'?'Flavor/Variant BOM':'Packaging BOM';
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
function MasterEditor({tab,draft,onChange,items,resources,refs,skuSetup}:{tab:Tab;draft:Row;onChange:(v:Row)=>void;items:Row[];resources:Row[];refs:References;skuSetup:SkuSetup}){
    const update=(key:string,value:unknown)=>onChange({...draft,[key]:value});
    const itemOptions:Array<[string,string]>=[['','Select a SKU'],...items.map(i=>[i.id,i.name] as [string,string])];
    const flavorOptions:Array<[string,string]>=[['','Select Flavor/Variant'],
        ...skuSetup.parameters.filter(p=>p.kind==='productNames'&&p.enabled!==false)
            .map(p=>[p.id,p.name+(p.productCode?' · '+p.productCode:'')] as [string,string])];
    const componentOptions=tab==='boms'&&bomCategory(str(draft.type))==='FLAVOR_VARIANT'
        ?itemOptions.filter(([id])=>!id||items.find(x=>x.id===id)?.category!=='PACKAGING')
        :itemOptions;
    const resourceOptions:Array<[string,string]>=[['','Select a resource'],...resources.map(r=>[r.id,r.name] as [string,string])];
    const siteOptions:Array<[string,string]>=[['','Organization-wide'],...refs.sites.map(r=>[r.id,r.name+(r.code?' · '+r.code:'')] as [string,string])];
    const assetOptions:Array<[string,string]>=[['','No linked asset'],...refs.assets.map(r=>[r.id,r.name+' · '+r.id] as [string,string])];
    const materialOptions:Array<[string,string]>=[['','Select approved Inventory material'],...refs.materials.map(r=>[r.id,r.materialNumber+' · '+r.name] as [string,string])];
    const utilityOptions:Array<[string,string]>=[['','Select registered equipment utility'],
        ...refs.utilities.map(u=>[u.workCenterId+'::'+u.code,u.name+' · '+u.workCenterId] as [string,string])];
    const routingUnitOptions=(skuId:string,current:string):Array<[string,string]>=>{
        const masterUnit=str(items.find(item=>item.id===skuId)?.uom);
        const units=skuSetup.units,master=units.find(u=>u.code===masterUnit||u.symbol===masterUnit);
        const options=master?units.filter(u=>u.categoryCode===master.categoryCode&&u.baseUnit===master.baseUnit):[];
        return [[current,current],...options.filter(u=>u.code!==current).map(u=>[u.code,u.label+' ('+u.symbol+')'] as [string,string])];
    };
    const components=asComponents(draft.components);
    const operations=asOperations(draft.operations);
    return <div className='space-y-4'>
        <div className='grid gap-3 md:grid-cols-2'>
            <div className='rounded-xl border border-line bg-page p-3'>
                <span className='block text-xs text-muted'>MEMS generated master code</span>
                <span className='font-mono text-sm text-brand'>{draft.id||'Automatically allocated on Save'}</span>
            </div>
            {!(tab==='items'&&str(draft.category)==='FINISHED')&&<Field title='Name' value={draft.name} required onChange={v=>update('name',v)}/>}
            {tab==='items'&&<>
                <Choice title='SKU type' value={str(draft.category)} options={ [['FINISHED','Finished goods'],['INTERMEDIATE','Intermediate/WIP'],['RAW','Inventory material'],['PACKAGING','Packaging material']] } onChange={v=>update('category',v)}/>
                <Field title='Product family (optional)' value={str(draft.family)} onChange={v=>update('family',v)}/>
                {str(draft.category)!=='FINISHED'&&<Field title='Base unit of measure' value={str(draft.uom)} onChange={v=>update('uom',v)}/>}
                {str(draft.category)==='FINISHED'&&<div className='rounded-xl border border-line bg-page p-3 text-sm text-soft'>The SKU name, physical package unit, containers per pack and conversion factor are calculated from selected configuration parameters.</div>}
                {str(draft.category)==='INTERMEDIATE'&&<>
                    <Choice title='Intermediate tracking' value={str(draft.stockPolicy)||'NON_STOCKED'}
                        options={ [['NON_STOCKED','Non-stock (process output / no inventory posting)'],['STOCKED','Stock-managed intermediate']] }
                        onChange={v=>update('stockPolicy',v)}/>
                    {str(draft.stockPolicy)==='STOCKED'&&<Choice title='Approved Inventory material for stocked intermediate'
                        value={str(draft.inventoryMaterialId)} options={materialOptions}
                        onChange={v=>{const found=refs.materials.find(m=>m.id===v);onChange({...draft,inventoryMaterialId:v,uom:found?.uom||draft.uom});}}/>}
                </>}
                {str(draft.category)==='RAW'&&<Choice title='Input source' value={str(draft.sourceMode)||'INVENTORY'}
                    options={ [['INVENTORY','Inventory raw material'],['UTILITY','Metered equipment utility (no stock issue)']] }
                    onChange={v=>onChange({...draft,sourceMode:v,inventoryMaterialId:'',utilityCode:'',utilityWorkCenterId:''})}/>}
                {(str(draft.category)==='PACKAGING'||str(draft.category)==='RAW'&&str(draft.sourceMode)!=='UTILITY')&&
                    <Choice title='Published Inventory Material Master' value={str(draft.inventoryMaterialId)} options={materialOptions}
                        onChange={v=>{const found=refs.materials.find(m=>m.id===v);onChange({...draft,inventoryMaterialId:v,uom:found?.uom||draft.uom});}}/>}
                {str(draft.category)==='RAW'&&str(draft.sourceMode)==='UTILITY'&&
                    <Choice title='Adopted equipment utility supply'
                        value={str(draft.utilityWorkCenterId)&&str(draft.utilityCode)?str(draft.utilityWorkCenterId)+'::'+str(draft.utilityCode):''}
                        options={utilityOptions} onChange={v=>{const selected=refs.utilities.find(u=>u.workCenterId+'::'+u.code===v);
                            onChange({...draft,utilityCode:selected?.code||'',utilityWorkCenterId:selected?.workCenterId||''});}}/>}
            </>}
            {(tab==='boms')&&<>
                <Choice title='BOM type' value={bomCategory(str(draft.type))}
                    options={ [['FLAVOR_VARIANT','Flavor/Variant BOM'],['PACKAGING','Packaging BOM']] }
                    onChange={v=>update('type',v)}/>
                <Choice title='Flavor/Variant (optional for common intermediates)' value={str(draft.flavorVariantId)} options={flavorOptions}
                    onChange={v=>update('flavorVariantId',v)}/>
                <Choice title='Manufactured SKU' value={str(draft.parentSkuId)} options={itemOptions} onChange={v=>{const product=items.find(x=>x.id===v);onChange({...draft,parentSkuId:v,outputUom:product?.uom??draft.outputUom});}}/>
                <Field title='BOM alternative code' value={str(draft.alternativeCode)||'STANDARD'}
                    onChange={v=>update('alternativeCode',v.toUpperCase())}/>
                <Field title='Output quantity (basis)' type='number' value={number(draft.outputQty,1)} onChange={v=>update('outputQty',Number(v))}/>
                <Field title='Output unit' value={str(draft.outputUom)} onChange={v=>update('outputUom',v)}/>
                <Field title='Effective from (optional)' type='date' value={str(draft.effectiveFrom)} onChange={v=>update('effectiveFrom',v)}/>
                <Field title='Version note' value={str(draft.versionNote)} onChange={v=>update('versionNote',v)}/>
            </>}
            {tab==='resources'&&<>
                <Choice title='Resource class' value={str(draft.type)} options={['LINE','WORK_CENTER','MACHINE','BATCH_VESSEL','ASSEMBLY_CELL','OTHER'].map(v=>[v,v.replaceAll('_',' ')])} onChange={v=>update('type',v)}/>
                <Field title='Rated units per hour' type='number' value={number(draft.rate,1000)} onChange={v=>update('rate',Number(v))}/>
                <Field title='Rate unit' value={str(draft.rateUom)} onChange={v=>update('rateUom',v)}/>
                <Field title='Planning efficiency (%)' type='number' value={number(draft.efficiency,100)} onChange={v=>update('efficiency',Number(v))}/>
                <Choice title='Active Asset Register equipment (optional)' value={str(draft.assetId)} options={assetOptions} onChange={v=>update('assetId',v)}/>
            </>}
            {tab==='routings'&&<>
                <Choice title='Finished / intermediate SKU' value={str(draft.skuId)} options={itemOptions} onChange={v=>update('skuId',v)}/>
                <Field title='Effective date (optional)' type='date' value={str(draft.effectiveFrom)} onChange={v=>update('effectiveFrom',v)}/>
            </>}
            <Choice title='Site applicability' value={str(draft.siteId)} options={siteOptions} onChange={v=>update('siteId',v)}/>
        </div>
        {tab==='items'&&str(draft.category)==='FINISHED'&&<>
            <SkuConfigurationFields value={(draft.skuComponents||{}) as SkuSelections}
                onChange={v=>update('skuComponents',v)} setup={skuSetup}/>
            {draft.id&&skuSetup.namingConfigured&&<label className='flex min-h-11 items-center gap-2 rounded-xl border border-line p-3 text-sm text-ink'>
                <input type='checkbox' checked={draft.applySkuNamingSequence===true}
                    onChange={e=>update('applySkuNamingSequence',e.target.checked)}/>
                Apply the latest SKU naming sequence when saving this existing SKU
            </label>}
        </>}
        <TextField title='Description / notes' value={str(draft.description)} onChange={v=>update('description',v)}/>
        {(tab==='boms')&&<section className='rounded-xl border border-line p-3'>
            <div className='mb-3 flex items-center justify-between gap-3'><h3 className='font-semibold'>Component quantities</h3><Button variant='secondary' type='button' onClick={()=>update('components',[...components,{skuId:'',quantity:1,uom:'EA',scrapPct:0}])}>Add component</Button></div>
            <div className='space-y-3'>{components.map((c,i)=><div key={i} className='grid gap-2 rounded-lg bg-page p-3 sm:grid-cols-2 xl:grid-cols-5'>
                <Choice title={'Component '+(i+1)} value={str(c.skuId)} options={componentOptions} onChange={v=>{const item=items.find(x=>x.id===v);update('components',components.map((a,j)=>j===i?{...a,skuId:v,uom:str(item?.uom)||a.uom}:a));}}/>
                <Field title='Quantity' type='number' value={c.quantity} onChange={v=>update('components',components.map((a,j)=>j===i?{...a,quantity:Number(v)}:a))}/>
                <Choice title='Component unit' value={c.uom} options={routingUnitOptions(c.skuId,c.uom)}
                    onChange={v=>update('components',components.map((a,j)=>j===i?{...a,uom:v}:a))}/>
                <Field title='Scrap allowance %' type='number' value={c.scrapPct} onChange={v=>update('components',components.map((a,j)=>j===i?{...a,scrapPct:Number(v)}:a))}/>
                <button type='button' className='min-h-11 self-end rounded-lg border border-red-700/50 px-3 text-sm text-red-300' onClick={()=>update('components',components.filter((_,j)=>j!==i))}>Remove</button>
            </div>)}</div>
            <p className='mt-2 text-xs text-muted'>Component material records must exist before this BOM is saved. Upstream BOMs can be created later; production readiness requires approved upstream supply or confirmed stock.</p>
        </section>}
        {tab==='routings'&&<section className='rounded-xl border border-line p-3'>
            <div className='mb-3 flex items-center justify-between gap-3'><h3 className='font-semibold'>Manufacturing operations</h3><Button variant='secondary' type='button' onClick={()=>update('operations',[...operations,{code:'STG_'+String(operations.length+1).padStart(9,'0'),name:'',resourceId:'',setupMinutes:0,runMinutesPerUnit:0,producesSkuId:'',dependsOn:operations.length?[operations[operations.length-1].code]:[]}])}>Add stage</Button></div>
            <p className='mb-3 text-xs text-muted'>Stage codes are created by MEMS. Tick previous stages that must finish before the current stage; leaving them unticked permits parallel execution.</p>
            <div className='space-y-3'>{operations.map((op,i)=><div key={i} className='grid gap-2 rounded-lg bg-page p-3 md:grid-cols-2 xl:grid-cols-3'>
                <Field title='Automatically assigned stage code' value={op.code} disabled onChange={()=>{}}/>
                <Field title='Stage description' value={op.name} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,name:v}:a))}/>
                <Choice title='Resource' value={op.resourceId} options={resourceOptions} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,resourceId:v}:a))}/>
                <Choice title='Produced SKU / intermediate' value={op.producesSkuId||''} options={itemOptions} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,producesSkuId:v}:a))}/>
                <fieldset className='rounded-xl border border-line p-3 text-sm text-ink'>
                    <legend className='px-1 text-xs text-soft'>Must follow these stages</legend>
                    {operations.slice(0,i).map(previous=><label key={previous.code} className='flex min-h-9 items-center gap-2'>
                        <input type='checkbox' checked={(op.dependsOn||[]).includes(previous.code)}
                            onChange={event=>update('operations',operations.map((step,j)=>j===i?{
                                ...step,dependsOn:event.target.checked?[...(step.dependsOn||[]),previous.code]:(step.dependsOn||[]).filter(code=>code!==previous.code),
                            }:step))}/>
                        {previous.name||previous.code}
                    </label>)}
                    {i===0&&<p className='text-xs text-muted'>First stage; no dependencies</p>}
                </fieldset>
                <Field title='Setup minutes' type='number' value={op.setupMinutes} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,setupMinutes:Number(v)}:a))}/>
                <Field title='Minutes / unit' type='number' value={op.runMinutesPerUnit} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,runMinutesPerUnit:Number(v)}:a))}/>
                <button type='button' className='min-h-11 self-end rounded-lg border border-red-700/50 px-3 text-sm text-red-300' onClick={()=>update('operations',operations.filter((_,j)=>j!==i))}>Remove</button>
            </div>)}</div>
        </section>}
        <p className='text-xs text-amber-200'>Flavor/Variant BOMs define formulation inputs (including flavor-neutral syrup); Packaging BOMs define containers and packed-product inputs. BOMs and routings require independent technical release; no Phase 1 operation posts purchases, stock or financial transactions.</p>
    </div>;
}

export default function ProductionFoundation({module,permissions}:{module:'PLN'|'MFG';permissions:string[]}){
    const [active,setActive]=useState<Tab>(module==='PLN'&&!hasPerm(permissions,'MFG.view')?'config':'skuSetup');
    const [rows,setRows]=useState<Record<Kind,Row[]>>(emptyRows);
    const [skuSetup,setSkuSetup]=useState<SkuSetup>(emptySkuSetup);
    const [refs,setRefs]=useState<References>(emptyReferences);
    const [draft,setDraft]=useState<Row|null>(null);
    const [bomFilter,setBomFilter]=useState<'ALL'|'FLAVOR_VARIANT'|'PACKAGING'>('ALL');
    const [config,setConfig]=useState<Config>({horizonDays:90,freezeDays:7,lotPolicy:'LOT_FOR_LOT',strategy:'MTS'});
    const [configRevision,setConfigRevision]=useState(0);
    const [demo,setDemo]=useState<Demo|null>(null);
    const [demoStatus,setDemoStatus]=useState<DemoStatus|null>(null);
    const [demoVerification,setDemoVerification]=useState<DemoVerification|null>(null);
    const [seedPhrase,setSeedPhrase]=useState('');
    const [history,setHistory]=useState<Row[]>([]);
    const [decisionReason,setDecisionReason]=useState('');
    const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
    const canViewMasters=hasPerm(permissions,'MFG.view');
    const canViewPlanning=hasPerm(permissions,'PLN.view');
    const visibleTabs=tabs.filter(t=>t.key==='config'?canViewPlanning:canViewMasters);
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
            const [datasets,configuration,refData,skuData]=await Promise.all([
                canViewMasters?Promise.all(kinds.map(kind=>callBackend<{records:Row[]}>('/api/org/pln-mfg/foundation/list',{kind}))):Promise.resolve(kinds.map(()=>({records:[] as Row[]}))),
                callBackend<{config:Config;revision:number}>('/api/org/pln-mfg/foundation/config').catch(()=>null),
                canViewMasters?callBackend<References>('/api/org/pln-mfg/foundation/references'):Promise.resolve(emptyReferences),
                canViewMasters?callBackend<SkuSetup>('/api/org/pln-mfg/sku/setup'):Promise.resolve(emptySkuSetup),
            ]);
            const [items,boms,resources,routings]=datasets;
            setRows({items:items.records,boms:boms.records,resources:resources.records,routings:routings.records});
            setRefs(refData);
            setSkuSetup(skuData);
            if(configuration){setConfig(configuration.config);setConfigRevision(configuration.revision);}
        }catch(e){setError(e instanceof Error?e.message:'Could not load manufacturing masters.');}
        finally{setLoading(false);}
    };
    useEffect(()=>{void load();},[]);
    const filtered=useMemo(()=>{
        const kind=recordKind(active);
        if(!kinds.includes(kind))return [] as Row[];
        if(active==='boms')return rows.boms.filter(r=>bomFilter==='ALL'||bomCategory(str(r.type))===bomFilter);
        return rows[kind];
    },[active,rows,bomFilter]);
    const refreshSkuSetup=async()=>{
        const data=await callBackend<SkuSetup>('/api/org/pln-mfg/sku/setup');
        setSkuSetup(data);
    };
    const changeTab=(tab:Tab)=>{
        setActive(tab);setDraft(null);setHistory([]);setError('');setNotice('');setDecisionReason('');setDemoVerification(null);
        if(tab==='demo'&&canViewMasters)
            void callBackend<DemoStatus>('/api/org/pln-mfg/foundation/demo/status')
                .then(setDemoStatus).catch(e=>setError(e instanceof Error?e.message:'Pilot sandbox status unavailable.'));
    };
    const copyVersion=(row:Row)=>{const cloned={...row,...(active==='boms'?{type:bomCategory(str(row.type))}:{}),id:'',name:String(row.name)+' — new revision',revision:undefined,status:'draft',effectiveFrom:'',createdBy:undefined,submittedBy:undefined,approvedBy:undefined,approvedAt:undefined};setDraft(cloned);setHistory([]);setError('');setNotice('Give this version a new unique code and effective date. The approved original remains unchanged.');};
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
        setDraft(row);setHistory([]);setError('');
        try{
            const result=await callBackend<{revisions:Row[]}>('/api/org/pln-mfg/foundation/history',{kind:recordKind(active),id:row.id});
            setHistory(result.revisions);
        }catch(e){setError(e instanceof Error?e.message:'Could not read revision history.');}
    };
    const save=async()=>{
        if(!draft||!canSave)return;
        setBusy(true);setError('');setNotice('');
        try{
            const body={...draft};
            if(active==='boms')body.type=bomCategory(str(body.type));
            const result=await callBackend<{record:Row;generatedCode?:string}>('/api/org/pln-mfg/foundation/save',{kind:recordKind(active),record:body,expectedRevision:body.revision??0});
            await load();setDraft(null);setNotice('Saved '+(result.generatedCode||result.record.id)+' · Revision '+result.record.revision+'. The code is maintained by MEMS.');
        }catch(e){setError(e instanceof Error?e.message:'Could not save.');}
        finally{setBusy(false);}
    };
    const saveConfig=async()=>{
        if(!canConfig)return;setBusy(true);setError('');setNotice('');
        try{
            const result=await callBackend<{config:Config;revision:number}>('/api/org/pln-mfg/foundation/config/save',{config,expectedRevision:configRevision});
            setConfig(result.config);setConfigRevision(result.revision);setNotice('Planning configuration saved.');
        }catch(e){setError(e instanceof Error?e.message:'Could not save planning configuration.');}
        finally{setBusy(false);}
    };
    const seedDemo=async()=>{
        if(!demoStatus?.canSeed||seedPhrase!=='SEED FICTIONAL LINE 11')return;
        setBusy(true);setError('');setNotice('');
        try{
            await callBackend('/api/org/pln-mfg/foundation/demo/seed',{confirm:seedPhrase});
            setDemoStatus(await callBackend<DemoStatus>('/api/org/pln-mfg/foundation/demo/status'));
            setSeedPhrase('');setDemoVerification(null);setNotice('The fictional Line 11 pilot was seeded inside its isolated simulation namespace.');
        }catch(e){setError(e instanceof Error?e.message:'Isolated demo seeding was not permitted.');}
        finally{setBusy(false);}
    };
    const verifyDemo=async()=>{
        setBusy(true);setError('');setNotice('');
        try{
            const verified=await callBackend<DemoVerification>('/api/org/pln-mfg/foundation/demo/verify');
            setDemoVerification(verified);
        }catch(e){setError(e instanceof Error?e.message:'Could not verify isolated pilot records.');}
        finally{setBusy(false);}
    };
    const preview=async()=>{
        setBusy(true);setError('');
        try{setDemo(await callBackend<Demo>('/api/org/pln-mfg/foundation/demo'));}catch(e){setError(e instanceof Error?e.message:'Could not open pilot data.');}finally{setBusy(false);}
    };
    return <div className='space-y-4'>
        <PageTitle title={module==='PLN'?'Production Planning & MRP':'Manufacturing'} action={<Button variant='secondary' disabled={busy} onClick={()=>void load()}>Refresh</Button>}/>
        <div className='flex gap-2 overflow-x-auto pb-1'>{visibleTabs.map(tab=><button type='button' key={tab.key} aria-current={active===tab.key?'page':undefined} onClick={()=>changeTab(tab.key)} className={'min-h-11 shrink-0 rounded-xl border px-3 text-sm '+(active===tab.key?'border-brand bg-brand/10 text-brand':'border-line text-soft')}>{tab.label}</button>)}</div>
        {active!=='skuSetup'&&<p className='text-sm text-muted'>{tabs.find(t=>t.key===active)?.hint}</p>}
        {error&&<Alert tone='error'>{error}</Alert>}
        {notice&&<p role='status' className='rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-3 text-sm text-brand'>{notice}</p>}
        {loading?<Spinner/>:active==='skuSetup'?<SkuSetupPanel setup={skuSetup} canEdit={canSkuConfig} onSaved={refreshSkuSetup}/>:active==='config'?<Card className='space-y-4'>
            <p className='text-sm text-muted'>Initial organization-level planning defaults. Further rule sets and site overrides use the same configuration model in subsequent phases.</p>
            <div className='grid gap-3 sm:grid-cols-2'>
                <Field title='Planning horizon (days)' type='number' value={config.horizonDays} onChange={v=>setConfig(s=>({...s,horizonDays:Number(v)}))}/>
                <Field title='Frozen period (days)' type='number' value={config.freezeDays} onChange={v=>setConfig(s=>({...s,freezeDays:Number(v)}))}/>
                <Choice title='Default lot-sizing method' value={config.lotPolicy} options={[['LOT_FOR_LOT','Lot for lot'],['FIXED','Fixed lot'],['MIN_MAX','Min / max'],['PERIOD','Period grouping'],['OPTIMIZED','Optimized']]} onChange={v=>setConfig(s=>({...s,lotPolicy:v}))}/>
                <Choice title='Default manufacturing policy' value={config.strategy} options={['MTS','MTO','ATO','ETO','HYBRID'].map(x=>[x,x])} onChange={v=>setConfig(s=>({...s,strategy:v}))}/>
            </div>
            <div className='flex justify-end'><Button disabled={!canConfig||busy} onClick={()=>void saveConfig()}>Save planning configuration</Button></div>
        </Card>:active==='demo'?<Card className='space-y-4'>
            <div className='flex flex-wrap items-center justify-between gap-2'><p className='text-sm text-amber-200'>Read-only demonstration. Fictional data cannot post to live stock, purchasing or finance.</p><Button variant='secondary' disabled={busy} onClick={()=>void preview()}>Preview fictional Line 11</Button></div>
            {demoStatus&&<section className='rounded-xl border border-line p-3 space-y-2'>
                <p className='text-sm font-semibold'>{demoStatus.seeded?'Isolated pilot sandbox seeded':'Isolated pilot sandbox not seeded'}</p>
                <p className='text-xs text-muted'>{demoStatus.warning}</p>
                {demoStatus.seeded&&demoStatus.counts&&<p className='text-xs text-soft'>Sample records: {Object.entries(demoStatus.counts).map(([key,count])=>key+': '+count).join(' · ')}</p>}
                {demoStatus.seeded&&<Button variant='secondary' disabled={busy} onClick={()=>void verifyDemo()}>Verify stored pilot records</Button>}
                {demoVerification&&<div className='rounded-lg border border-line p-3 text-sm' role='status'>
                    <p className={demoVerification.valid?'font-semibold text-brand':'font-semibold text-amber-300'}>{demoVerification.valid?'Integrity verified — all fictional pilot records match':'Pilot acceptance blocked — data inconsistencies found'}</p>
                    {demoVerification.counts&&<p className='mt-2 text-xs text-muted'>{Object.entries(demoVerification.counts).map(([key,value])=>key+': '+value.stored+'/'+value.expected).join(' · ')}</p>}
                    {demoVerification.errors.map((reason,i)=><p className='mt-1 text-xs text-amber-300' key={i}>{reason}</p>)}
                    {demoVerification.verifiedAt&&<p className='mt-1 text-xs text-muted'>Checked {demoVerification.verifiedAt}</p>}
                </div>}
                {!demoStatus.seeded&&demoStatus.canSeed&&<div className='flex flex-wrap gap-2'>
                    <label className='min-w-44 flex-1'><span className={label}>Confirmation phrase</span>
                        <input className={fld} value={seedPhrase} onChange={e=>setSeedPhrase(e.target.value)} placeholder='SEED FICTIONAL LINE 11'/></label>
                    <Button disabled={busy||seedPhrase!=='SEED FICTIONAL LINE 11'} onClick={()=>void seedDemo()}>Seed isolated test workspace</Button>
                </div>}
                {!demoStatus.seeded&&!demoStatus.canSeed&&<p className='text-xs text-muted'>Seeding is restricted to organization super admins in explicitly enabled development test mode. The preview remains available to authorized viewers.</p>}
            </section>}
            {demo&&<><p className='text-xs text-muted'>{demo.label}</p><div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>{([['SKUs',demo.items],['Flavor/Variant & Packaging BOMs',demo.boms],['Resources',demo.resources],['Routings',demo.routings]] as Array<[string,Row[]]>).map(([title,data])=><section className='rounded-lg bg-page p-3' key={title}><h3 className='mb-2 font-semibold'>{title} ({data.length})</h3>{data.map(r=><div key={r.id} className='border-t border-line py-2 text-xs'><span className='text-brand'>{r.id}</span><p className='text-soft'>{r.name}</p></div>)}</section>)}</div></>}
        </Card>:<>
            {active==='boms'&&<div className='grid gap-2 sm:grid-cols-2'>
                <Choice title='Show BOM type' value={bomFilter} onChange={v=>setBomFilter(v as typeof bomFilter)}
                    options={ [['ALL','All BOMs'],['FLAVOR_VARIANT','Flavor/Variant BOM'],['PACKAGING','Packaging BOM']] }/>
                <p className='self-end text-xs text-muted'>Earlier RECIPE and BOM revisions remain available in the corresponding categories.</p>
            </div>}
            <div className='flex flex-wrap items-center justify-between gap-3'><p className='text-sm text-muted'>{filtered.length} saved master records · draft versions</p>{canSave&&<Button onClick={()=>setDraft(newRecord(active))}>Add {active==='items'?'SKU':active==='boms'?'BOM':active==='routings'?'routing':'resource'}</Button>}</div>
            {draft?<Card className='space-y-4'>
                <div className='flex items-center justify-between gap-2'><h2 className='font-semibold'>{draft.revision?'Edit draft':'New master record'}</h2><Button variant='secondary' onClick={()=>setDraft(null)}>Cancel</Button></div>
                {draft.revision&&<div className='flex flex-wrap gap-2 text-xs text-soft'><span className='font-semibold'>Immutable revisions:</span>{history.map(h=><span key={String(h.revision)} className='rounded-md border border-line px-2 py-1'>r{h.revision} · {str(h.updatedAt).slice(0,10)}</span>)}</div>}
                <MasterEditor tab={active} draft={draft} onChange={setDraft} items={rows.items} resources={rows.resources} refs={refs} skuSetup={skuSetup}/>
                <div className='flex justify-end'><Button disabled={busy||!canSave} onClick={()=>void save()}>{busy?'Saving...':'Save draft'}</Button></div>
            </Card>:<div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>{filtered.map(row=><Card key={row.id} className='space-y-2'>
                <div className='flex items-start justify-between gap-2'><span className='font-mono text-xs text-brand'>{row.id}</span><span className='rounded-full bg-page px-2 py-1 text-[11px] uppercase text-soft'>{str(row.status)||'draft'}</span></div>
                <h3 className='font-semibold'>{row.name}</h3>
                <p className='text-xs text-muted'>{active==='items'?str(row.category)+' · '+str(row.uom):active==='resources'?str(row.type)+' · '+number(row.rate)+'/h':active==='routings'?'Operations: '+asOperations(row.operations).length:bomLabel(str(row.type))+' · Components: '+asComponents(row.components).length}</p>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='text-xs text-muted'>Revision {row.revision??1} · effective {str(row.effectiveFrom)||'immediately'}</span>
                    {canSave&&['draft','rejected',''].includes(str(row.status))&&<Button variant='secondary' onClick={()=>void openDraft(row)}>Open / edit</Button>}
                    {canSave&&['active','pending_approval'].includes(str(row.status))&&<Button variant='secondary' onClick={()=>copyVersion(row)}>New version</Button>}
                </div>
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
            {!filtered.length&&!draft&&<Card><p className='text-sm text-muted'>No records have been created here yet. Start with flavors/variants, SKUs and resources; then define Flavor/Variant and Packaging BOMs and production routings. The fictional pilot is available under Line 11 Pilot Preview.</p></Card>}
        </>}
    </div>;
}
