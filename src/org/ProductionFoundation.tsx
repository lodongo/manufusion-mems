import { useEffect, useMemo, useState } from 'react';
import { Alert } from '../components/ui';
import { Button, Card, PageTitle, Spinner } from '../admin/kit';
import { callBackend } from '../lib/backend';
import { hasPerm } from '../types';

type Kind='items'|'boms'|'resources'|'routings';
type Tab=Kind|'recipes'|'config'|'demo';
type Row=Record<string,unknown>&{id:string;name:string;revision?:number;type?:string};
type Component={skuId:string;quantity:number;uom:string;scrapPct:number};
type Operation={code:string;name:string;resourceId:string;setupMinutes:number;runMinutesPerUnit:number;producesSkuId?:string;dependsOn?:string[]};
type Config={horizonDays:number;freezeDays:number;lotPolicy:string;strategy:string};
type Demo={demo:boolean;persisted:boolean;label:string;items:Row[];boms:Row[];resources:Row[];routings:Row[]};
type DemoStatus={sandboxId:string;seeded:boolean;isolated:boolean;canSeed:boolean;createdAt:string;warning:string;counts:Record<string,number>|null};
type DemoVerification={seeded:boolean;valid:boolean;errors:string[];counts:Record<string,{expected:number;stored:number}>|null;verifiedAt?:string};
type References={
    materials:Array<{id:string;name:string;materialNumber:string;uom:string}>;
    assets:Array<{id:string;name:string;siteId:string}>;
    sites:Array<{id:string;name:string;code:string}>;
};
const emptyReferences:References={materials:[],assets:[],sites:[]};
const kinds:Kind[]=['items','boms','resources','routings'];
const tabs:{key:Tab;label:string;hint:string}[]=[
    {key:'items',label:'Products & SKUs',hint:'Finished, intermediate and Inventory-linked raw materials'},
    {key:'boms',label:'Bills of Materials',hint:'Versioned component structures'},
    {key:'recipes',label:'Recipes',hint:'Ingredient formulas and intermediate processing'},
    {key:'resources',label:'Manufacturing Resources',hint:'Work centres, machines and production lines'},
    {key:'routings',label:'Process Routings',hint:'Stage-by-stage manufacturing operations'},
    {key:'config',label:'Planning Configuration',hint:'Organization planning defaults'},
    {key:'demo',label:'Line 11 Pilot Preview',hint:'Read-only fictional multi-stage example'},
];
const emptyRows:Record<Kind,Row[]>={items:[],boms:[],resources:[],routings:[]};
const fld='w-full min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500';
const label='mb-1 block text-xs font-medium text-slate-300';
const newRecord=(tab:Tab):Row=>{
    if(tab==='items')return {id:'',name:'',category:'FINISHED',family:'',uom:'EA',siteId:'',packQty:1,inventoryMaterialId:''};
    if(tab==='boms'||tab==='recipes')return {id:'',name:'',type:tab==='recipes'?'RECIPE':'BOM',parentSkuId:'',outputQty:1,outputUom:'EA',components:[{skuId:'',quantity:1,uom:'EA',scrapPct:0}]};
    if(tab==='resources')return {id:'',name:'',type:'LINE',rate:1000,rateUom:'EA',efficiency:100,siteId:'',assetId:''};
    return {id:'',name:'',skuId:'',operations:[{code:'STAGE_01',name:'',resourceId:'',setupMinutes:0,runMinutesPerUnit:0,producesSkuId:'',dependsOn:[]}]};
};
const recordKind=(tab:Tab):Kind=>tab==='recipes'?'boms':tab as Kind;
const str=(value:unknown):string=>typeof value==='string'?value:'';
const number=(value:unknown,def=0):number=>typeof value==='number'&&Number.isFinite(value)?value:def;
const asComponents=(value:unknown):Component[]=>Array.isArray(value)?value as Component[]:[];
const asOperations=(value:unknown):Operation[]=>Array.isArray(value)?value as Operation[]:[];

function Field({title,value,onChange,type='text',placeholder='',required=false}:{title:string;value:string|number;onChange:(v:string)=>void;type?:string;placeholder?:string;required?:boolean}){
    return <label className='block min-w-0'><span className={label}>{title}</span><input className={fld} type={type} value={value} placeholder={placeholder} required={required} onChange={e=>onChange(e.target.value)}/></label>;
}
function Choice({title,value,options,onChange}:{title:string;value:string;options:Array<[string,string]>;onChange:(v:string)=>void}){
    return <label className='block min-w-0'><span className={label}>{title}</span><select className={fld} value={value} onChange={e=>onChange(e.target.value)}>{options.map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>;
}
function TextField({title,value,onChange}:{title:string;value:string;onChange:(v:string)=>void}){
    return <label className='block'><span className={label}>{title}</span><textarea rows={2} className={fld} value={value} onChange={e=>onChange(e.target.value)}/></label>;
}
function MasterEditor({tab,draft,onChange,items,resources,refs}:{tab:Tab;draft:Row;onChange:(v:Row)=>void;items:Row[];resources:Row[];refs:References}){
    const update=(key:string,value:unknown)=>onChange({...draft,[key]:value});
    const itemOptions:Array<[string,string]>=[['','Select a SKU'],...items.map(i=>[i.id,i.name] as [string,string])];
    const resourceOptions:Array<[string,string]>=[['','Select a resource'],...resources.map(r=>[r.id,r.name] as [string,string])];
    const siteOptions:Array<[string,string]>=[['','Organization-wide'],...refs.sites.map(r=>[r.id,r.name+(r.code?' · '+r.code:'')] as [string,string])];
    const assetOptions:Array<[string,string]>=[['','No linked asset'],...refs.assets.map(r=>[r.id,r.name+' · '+r.id] as [string,string])];
    const materialOptions:Array<[string,string]>=[['','Select approved Inventory material'],...refs.materials.map(r=>[r.id,r.materialNumber+' · '+r.name] as [string,string])];
    const components=asComponents(draft.components);
    const operations=asOperations(draft.operations);
    return <div className='space-y-4'>
        <div className='grid gap-3 md:grid-cols-2'>
            <Field title='Unique code' value={draft.id} required onChange={v=>update('id',v)} placeholder='e.g. FG-WAT-500-12'/>
            <Field title='Name' value={draft.name} required onChange={v=>update('name',v)}/>
            {tab==='items'&&<>
                <Choice title='SKU type' value={str(draft.category)} options={ [['FINISHED','Finished goods'],['INTERMEDIATE','Intermediate/WIP'],['RAW','Inventory material'],['PACKAGING','Packaging material']] } onChange={v=>update('category',v)}/>
                <Field title='Product family' value={str(draft.family)} onChange={v=>update('family',v)}/>
                <Field title='Base unit of measure' value={str(draft.uom)} onChange={v=>update('uom',v)}/>
                <Field title='Quantity per sales pack' value={number(draft.packQty,1)} type='number' onChange={v=>update('packQty',Number(v))}/>
                {['RAW','PACKAGING'].includes(str(draft.category))&&<Choice title='Published Inventory Material Master' value={str(draft.inventoryMaterialId)} options={materialOptions} onChange={v=>{const found=refs.materials.find(m=>m.id===v);onChange({...draft,inventoryMaterialId:v,uom:found?.uom||draft.uom});}}/>}
            </>}
            {(tab==='boms'||tab==='recipes')&&<>
                <Choice title='Manufactured SKU' value={str(draft.parentSkuId)} options={itemOptions} onChange={v=>{const product=items.find(x=>x.id===v);onChange({...draft,parentSkuId:v,outputUom:product?.uom??draft.outputUom});}}/>
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
        <TextField title='Description / notes' value={str(draft.description)} onChange={v=>update('description',v)}/>
        {(tab==='boms'||tab==='recipes')&&<section className='rounded-xl border border-slate-700 p-3'>
            <div className='mb-3 flex items-center justify-between gap-3'><h3 className='font-semibold'>Component quantities</h3><Button variant='secondary' type='button' onClick={()=>update('components',[...components,{skuId:'',quantity:1,uom:'EA',scrapPct:0}])}>Add component</Button></div>
            <div className='space-y-3'>{components.map((c,i)=><div key={i} className='grid gap-2 rounded-lg bg-slate-800/70 p-3 sm:grid-cols-2 xl:grid-cols-5'>
                <Choice title={'Component '+(i+1)} value={str(c.skuId)} options={itemOptions} onChange={v=>{const item=items.find(x=>x.id===v);update('components',components.map((a,j)=>j===i?{...a,skuId:v,uom:str(item?.uom)||a.uom}:a));}}/>
                <Field title='Quantity' type='number' value={c.quantity} onChange={v=>update('components',components.map((a,j)=>j===i?{...a,quantity:Number(v)}:a))}/>
                <Field title='UOM' value={c.uom} onChange={v=>update('components',components.map((a,j)=>j===i?{...a,uom:v}:a))}/>
                <Field title='Scrap allowance %' type='number' value={c.scrapPct} onChange={v=>update('components',components.map((a,j)=>j===i?{...a,scrapPct:Number(v)}:a))}/>
                <button type='button' className='min-h-11 self-end rounded-lg border border-red-700/50 px-3 text-sm text-red-300' onClick={()=>update('components',components.filter((_,j)=>j!==i))}>Remove</button>
            </div>)}</div>
            {!items.length&&<p className='mt-2 text-sm text-amber-300'>Create product or intermediate SKU masters first. Raw-material items must reference Inventory.</p>}
        </section>}
        {tab==='routings'&&<section className='rounded-xl border border-slate-700 p-3'>
            <div className='mb-3 flex items-center justify-between gap-3'><h3 className='font-semibold'>Manufacturing operations</h3><Button variant='secondary' type='button' onClick={()=>update('operations',[...operations,{code:'STAGE_'+String(operations.length+1).padStart(2,'0'),name:'',resourceId:'',setupMinutes:0,runMinutesPerUnit:0,producesSkuId:'',dependsOn:operations.length?[operations[operations.length-1].code]:[]}])}>Add stage</Button></div>
            <p className='mb-3 text-xs text-slate-400'>Define outputs for each stage; comma-separated dependencies enable parallel work (for example, prepare beverage and blow bottles before filling).</p>
            <div className='space-y-3'>{operations.map((op,i)=><div key={i} className='grid gap-2 rounded-lg bg-slate-800/70 p-3 md:grid-cols-2 xl:grid-cols-3'>
                <Field title='Stage code' value={op.code} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,code:v}:a))}/>
                <Field title='Stage description' value={op.name} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,name:v}:a))}/>
                <Choice title='Resource' value={op.resourceId} options={resourceOptions} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,resourceId:v}:a))}/>
                <Choice title='Produced SKU / intermediate' value={op.producesSkuId||''} options={itemOptions} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,producesSkuId:v}:a))}/>
                <Field title='Depends on stage codes (comma-separated)' value={(op.dependsOn||[]).join(', ')} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,dependsOn:v.split(',').map(x=>x.trim()).filter(Boolean)}:a))}/>
                <Field title='Setup minutes' type='number' value={op.setupMinutes} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,setupMinutes:Number(v)}:a))}/>
                <Field title='Minutes / unit' type='number' value={op.runMinutesPerUnit} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,runMinutesPerUnit:Number(v)}:a))}/>
                <button type='button' className='min-h-11 self-end rounded-lg border border-red-700/50 px-3 text-sm text-red-300' onClick={()=>update('operations',operations.filter((_,j)=>j!==i))}>Remove</button>
            </div>)}</div>
        </section>}
        <p className='text-xs text-amber-200'>Products and resources are maintained as drafts. BOMs, recipes and routings require independent technical release before becoming active; no Phase 1 operation can post purchases, stock or financial transactions.</p>
    </div>;
}

export default function ProductionFoundation({module,permissions}:{module:'PLN'|'MFG';permissions:string[]}){
    const [active,setActive]=useState<Tab>(module==='PLN'?'config':'items');
    const [rows,setRows]=useState<Record<Kind,Row[]>>(emptyRows);
    const [refs,setRefs]=useState<References>(emptyReferences);
    const [draft,setDraft]=useState<Row|null>(null);
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
    const canConfig=hasPerm(permissions,'PLN.configure');
    const isReleaseMaster=['boms','recipes','routings'].includes(active);
    const releaseScope=active==='routings'?'MFG.routing':'MFG.bom';
    const canSubmit=isReleaseMaster&&canEdit&&hasPerm(permissions,releaseScope+'.submit');
    const canApprove=isReleaseMaster&&hasPerm(permissions,releaseScope+'.approve');
    const canSave=canEdit && (active!=='boms'||hasPerm(permissions,'MFG.bom.edit')) && (active!=='recipes'||hasPerm(permissions,'MFG.bom.edit')) && (active!=='routings'||hasPerm(permissions,'MFG.routing.edit'));
    const load=async()=>{
        setLoading(true);setError('');
        try{
            const [datasets,configuration,refData]=await Promise.all([
                canViewMasters?Promise.all(kinds.map(kind=>callBackend<{records:Row[]}>('/api/org/pln-mfg/foundation/list',{kind}))):Promise.resolve(kinds.map(()=>({records:[] as Row[]}))),
                callBackend<{config:Config;revision:number}>('/api/org/pln-mfg/foundation/config').catch(()=>null),
                canViewMasters?callBackend<References>('/api/org/pln-mfg/foundation/references'):Promise.resolve(emptyReferences),
            ]);
            const [items,boms,resources,routings]=datasets;
            setRows({items:items.records,boms:boms.records,resources:resources.records,routings:routings.records});
            setRefs(refData);
            if(configuration){setConfig(configuration.config);setConfigRevision(configuration.revision);}
        }catch(e){setError(e instanceof Error?e.message:'Could not load manufacturing masters.');}
        finally{setLoading(false);}
    };
    useEffect(()=>{void load();},[]);
    const filtered=useMemo(()=>{
        const kind=recordKind(active);
        if(!kinds.includes(kind))return [] as Row[];
        if(active==='boms')return rows.boms.filter(r=>r.type==='BOM');
        if(active==='recipes')return rows.boms.filter(r=>r.type==='RECIPE');
        return rows[kind];
    },[active,rows]);
    const changeTab=(tab:Tab)=>{
        setActive(tab);setDraft(null);setHistory([]);setError('');setNotice('');setDecisionReason('');setDemoVerification(null);
        if(tab==='demo'&&canViewMasters)
            void callBackend<DemoStatus>('/api/org/pln-mfg/foundation/demo/status')
                .then(setDemoStatus).catch(e=>setError(e instanceof Error?e.message:'Pilot sandbox status unavailable.'));
    };
    const copyVersion=(row:Row)=>{const cloned={...row,id:'',name:String(row.name)+' — new revision',revision:undefined,status:'draft',effectiveFrom:'',createdBy:undefined,submittedBy:undefined,approvedBy:undefined,approvedAt:undefined};setDraft(cloned);setHistory([]);setError('');setNotice('Give this version a new unique code and effective date. The approved original remains unchanged.');};
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
            if(active==='boms'||active==='recipes')body.type=active==='recipes'?'RECIPE':'BOM';
            await callBackend('/api/org/pln-mfg/foundation/save',{kind:recordKind(active),record:body,expectedRevision:body.revision??0});
            await load();setDraft(null);setNotice('Draft saved with revision history. It has not been activated.');
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
        <PageTitle title={module==='PLN'?'Production Planning & MRP':'Manufacturing — Master Data'} subtitle='Phase 1 foundation · universal multi-stage production model · no live production or stock postings' action={<Button variant='secondary' disabled={busy} onClick={()=>void load()}>Refresh</Button>}/>
        <div className='flex gap-2 overflow-x-auto pb-1'>{visibleTabs.map(tab=><button type='button' key={tab.key} aria-current={active===tab.key?'page':undefined} onClick={()=>changeTab(tab.key)} className={'min-h-11 shrink-0 rounded-xl border px-3 text-sm '+(active===tab.key?'border-emerald-500 bg-emerald-500/10 text-emerald-200':'border-slate-700 text-slate-300')}>{tab.label}</button>)}</div>
        <p className='text-sm text-slate-400'>{tabs.find(t=>t.key===active)?.hint}</p>
        {error&&<Alert tone='error'>{error}</Alert>}
        {notice&&<p role='status' className='rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-3 text-sm text-emerald-200'>{notice}</p>}
        {loading?<Spinner/>:active==='config'?<Card className='space-y-4'>
            <p className='text-sm text-slate-400'>Initial organization-level planning defaults. Further rule sets and site overrides use the same configuration model in subsequent phases.</p>
            <div className='grid gap-3 sm:grid-cols-2'>
                <Field title='Planning horizon (days)' type='number' value={config.horizonDays} onChange={v=>setConfig(s=>({...s,horizonDays:Number(v)}))}/>
                <Field title='Frozen period (days)' type='number' value={config.freezeDays} onChange={v=>setConfig(s=>({...s,freezeDays:Number(v)}))}/>
                <Choice title='Default lot-sizing method' value={config.lotPolicy} options={[['LOT_FOR_LOT','Lot for lot'],['FIXED','Fixed lot'],['MIN_MAX','Min / max'],['PERIOD','Period grouping'],['OPTIMIZED','Optimized']]} onChange={v=>setConfig(s=>({...s,lotPolicy:v}))}/>
                <Choice title='Default manufacturing policy' value={config.strategy} options={['MTS','MTO','ATO','ETO','HYBRID'].map(x=>[x,x])} onChange={v=>setConfig(s=>({...s,strategy:v}))}/>
            </div>
            <div className='flex justify-end'><Button disabled={!canConfig||busy} onClick={()=>void saveConfig()}>Save planning configuration</Button></div>
        </Card>:active==='demo'?<Card className='space-y-4'>
            <div className='flex flex-wrap items-center justify-between gap-2'><p className='text-sm text-amber-200'>Read-only demonstration. Fictional data cannot post to live stock, purchasing or finance.</p><Button variant='secondary' disabled={busy} onClick={()=>void preview()}>Preview fictional Line 11</Button></div>
            {demoStatus&&<section className='rounded-xl border border-slate-700 p-3 space-y-2'>
                <p className='text-sm font-semibold'>{demoStatus.seeded?'Isolated pilot sandbox seeded':'Isolated pilot sandbox not seeded'}</p>
                <p className='text-xs text-slate-400'>{demoStatus.warning}</p>
                {demoStatus.seeded&&demoStatus.counts&&<p className='text-xs text-slate-300'>Sample records: {Object.entries(demoStatus.counts).map(([key,count])=>key+': '+count).join(' · ')}</p>}
                {demoStatus.seeded&&<Button variant='secondary' disabled={busy} onClick={()=>void verifyDemo()}>Verify stored pilot records</Button>}
                {demoVerification&&<div className='rounded-lg border border-slate-600 p-3 text-sm' role='status'>
                    <p className={demoVerification.valid?'font-semibold text-emerald-300':'font-semibold text-amber-300'}>{demoVerification.valid?'Integrity verified — all fictional pilot records match':'Pilot acceptance blocked — data inconsistencies found'}</p>
                    {demoVerification.counts&&<p className='mt-2 text-xs text-slate-400'>{Object.entries(demoVerification.counts).map(([key,value])=>key+': '+value.stored+'/'+value.expected).join(' · ')}</p>}
                    {demoVerification.errors.map((reason,i)=><p className='mt-1 text-xs text-amber-300' key={i}>{reason}</p>)}
                    {demoVerification.verifiedAt&&<p className='mt-1 text-xs text-slate-400'>Checked {demoVerification.verifiedAt}</p>}
                </div>}
                {!demoStatus.seeded&&demoStatus.canSeed&&<div className='flex flex-wrap gap-2'>
                    <label className='min-w-44 flex-1'><span className={label}>Confirmation phrase</span>
                        <input className={fld} value={seedPhrase} onChange={e=>setSeedPhrase(e.target.value)} placeholder='SEED FICTIONAL LINE 11'/></label>
                    <Button disabled={busy||seedPhrase!=='SEED FICTIONAL LINE 11'} onClick={()=>void seedDemo()}>Seed isolated test workspace</Button>
                </div>}
                {!demoStatus.seeded&&!demoStatus.canSeed&&<p className='text-xs text-slate-400'>Seeding is restricted to organization super admins in explicitly enabled development test mode. The preview remains available to authorized viewers.</p>}
            </section>}
            {demo&&<><p className='text-xs text-slate-400'>{demo.label}</p><div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>{([['SKUs',demo.items],['BOMs & recipes',demo.boms],['Resources',demo.resources],['Routings',demo.routings]] as Array<[string,Row[]]>).map(([title,data])=><section className='rounded-lg bg-slate-950 p-3' key={title}><h3 className='mb-2 font-semibold'>{title} ({data.length})</h3>{data.map(r=><div key={r.id} className='border-t border-slate-800 py-2 text-xs'><span className='text-emerald-200'>{r.id}</span><p className='text-slate-300'>{r.name}</p></div>)}</section>)}</div></>}
        </Card>:<>
            <div className='flex flex-wrap items-center justify-between gap-3'><p className='text-sm text-slate-400'>{filtered.length} saved master records · draft versions</p>{canSave&&<Button onClick={()=>setDraft(newRecord(active))}>Add {active==='items'?'SKU':active==='recipes'?'recipe':active==='boms'?'BOM':active==='routings'?'routing':'resource'}</Button>}</div>
            {draft?<Card className='space-y-4'>
                <div className='flex items-center justify-between gap-2'><h2 className='font-semibold'>{draft.revision?'Edit draft':'New master record'}</h2><Button variant='secondary' onClick={()=>setDraft(null)}>Cancel</Button></div>
                {draft.revision&&<div className='flex flex-wrap gap-2 text-xs text-slate-300'><span className='font-semibold'>Immutable revisions:</span>{history.map(h=><span key={String(h.revision)} className='rounded-md border border-slate-700 px-2 py-1'>r{h.revision} · {str(h.updatedAt).slice(0,10)}</span>)}</div>}
                <MasterEditor tab={active} draft={draft} onChange={setDraft} items={rows.items} resources={rows.resources} refs={refs}/>
                <div className='flex justify-end'><Button disabled={busy||!canSave} onClick={()=>void save()}>{busy?'Saving...':'Save draft'}</Button></div>
            </Card>:<div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>{filtered.map(row=><Card key={row.id} className='space-y-2'>
                <div className='flex items-start justify-between gap-2'><span className='font-mono text-xs text-emerald-300'>{row.id}</span><span className='rounded-full bg-slate-800 px-2 py-1 text-[11px] uppercase text-slate-300'>{str(row.status)||'draft'}</span></div>
                <h3 className='font-semibold'>{row.name}</h3>
                <p className='text-xs text-slate-400'>{active==='items'?str(row.category)+' · '+str(row.uom):active==='resources'?str(row.type)+' · '+number(row.rate)+'/h':active==='routings'?'Operations: '+asOperations(row.operations).length:'Components: '+asComponents(row.components).length}</p>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='text-xs text-slate-500'>Revision {row.revision??1} · effective {str(row.effectiveFrom)||'immediately'}</span>
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
                    <p className='text-xs text-slate-400'>The submitter and creator cannot approve their own master data.</p>
                </div>}
            </Card>)}</div>}
            {!filtered.length&&!draft&&<Card><p className='text-sm text-slate-400'>No records have been created here yet. Start with products and resources; then define the BOMs and production routings. The fictional pilot is available under Line 11 Pilot Preview.</p></Card>}
        </>}
    </div>;
}
