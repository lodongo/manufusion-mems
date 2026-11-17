import { useEffect, useMemo, useState } from 'react';
import { Alert } from '../components/ui';
import { Button, Card, PageTitle, Spinner } from '../admin/kit';
import { callBackend } from '../lib/backend';
import { hasPerm } from '../types';

type Kind='items'|'boms'|'resources'|'routings';
type Tab=Kind|'recipes'|'config'|'demo';
type Row=Record<string,unknown>&{id:string;name:string;revision?:number;type?:string};
type Component={skuId:string;quantity:number;uom:string;scrapPct:number};
type Operation={code:string;name:string;resourceId:string;setupMinutes:number;runMinutesPerUnit:number};
type Config={horizonDays:number;freezeDays:number;lotPolicy:string;strategy:string};
type Demo={demo:boolean;persisted:boolean;label:string;items:Row[];boms:Row[];resources:Row[];routings:Row[]};
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
    return {id:'',name:'',skuId:'',operations:[{code:'STAGE_01',name:'',resourceId:'',setupMinutes:0,runMinutesPerUnit:0}]};
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
function MasterEditor({tab,draft,onChange,items,resources}:{tab:Tab;draft:Row;onChange:(v:Row)=>void;items:Row[];resources:Row[]}){
    const update=(key:string,value:unknown)=>onChange({...draft,[key]:value});
    const itemOptions:Array<[string,string]>=[['','Select a SKU'],...items.map(i=>[i.id,i.name])];
    const resourceOptions:Array<[string,string]>=[['','Select a resource'],...resources.map(r=>[r.id,r.name])];
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
                {['RAW','PACKAGING'].includes(str(draft.category))&&<Field title='Inventory material ID (required for raw stock)' value={str(draft.inventoryMaterialId)} onChange={v=>update('inventoryMaterialId',v)}/>}
            </>}
            {(tab==='boms'||tab==='recipes')&&<>
                <Choice title='Manufactured SKU' value={str(draft.parentSkuId)} options={itemOptions} onChange={v=>update('parentSkuId',v)}/>
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
                <Field title='Existing asset ID (optional)' value={str(draft.assetId)} onChange={v=>update('assetId',v)}/>
            </>}
            {tab==='routings'&&<Choice title='Finished / intermediate SKU' value={str(draft.skuId)} options={itemOptions} onChange={v=>update('skuId',v)}/>}
            {['items','resources','routings'].includes(tab)&&<Field title='Organization site ID (optional)' value={str(draft.siteId)} onChange={v=>update('siteId',v)}/>}
        </div>
        <TextField title='Description / notes' value={str(draft.description)} onChange={v=>update('description',v)}/>
        {(tab==='boms'||tab==='recipes')&&<section className='rounded-xl border border-slate-700 p-3'>
            <div className='mb-3 flex items-center justify-between gap-3'><h3 className='font-semibold'>Component quantities</h3><Button variant='secondary' type='button' onClick={()=>update('components',[...components,{skuId:'',quantity:1,uom:'EA',scrapPct:0}])}>Add component</Button></div>
            <div className='space-y-3'>{components.map((c,i)=><div key={i} className='grid gap-2 rounded-lg bg-slate-800/70 p-3 sm:grid-cols-2 xl:grid-cols-5'>
                <Choice title={'Component '+(i+1)} value={str(c.skuId)} options={itemOptions} onChange={v=>update('components',components.map((a,j)=>j===i?{...a,skuId:v}:a))}/>
                <Field title='Quantity' type='number' value={c.quantity} onChange={v=>update('components',components.map((a,j)=>j===i?{...a,quantity:Number(v)}:a))}/>
                <Field title='UOM' value={c.uom} onChange={v=>update('components',components.map((a,j)=>j===i?{...a,uom:v}:a))}/>
                <Field title='Scrap allowance %' type='number' value={c.scrapPct} onChange={v=>update('components',components.map((a,j)=>j===i?{...a,scrapPct:Number(v)}:a))}/>
                <button type='button' className='min-h-11 self-end rounded-lg border border-red-700/50 px-3 text-sm text-red-300' onClick={()=>update('components',components.filter((_,j)=>j!==i))}>Remove</button>
            </div>)}</div>
            {!items.length&&<p className='mt-2 text-sm text-amber-300'>Create product or intermediate SKU masters first. Raw-material items must reference Inventory.</p>}
        </section>}
        {tab==='routings'&&<section className='rounded-xl border border-slate-700 p-3'>
            <div className='mb-3 flex items-center justify-between gap-3'><h3 className='font-semibold'>Manufacturing operations</h3><Button variant='secondary' type='button' onClick={()=>update('operations',[...operations,{code:'STAGE_'+String(operations.length+1).padStart(2,'0'),name:'',resourceId:'',setupMinutes:0,runMinutesPerUnit:0}])}>Add stage</Button></div>
            <div className='space-y-3'>{operations.map((op,i)=><div key={i} className='grid gap-2 rounded-lg bg-slate-800/70 p-3 md:grid-cols-2 xl:grid-cols-3'>
                <Field title='Stage code' value={op.code} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,code:v}:a))}/>
                <Field title='Stage description' value={op.name} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,name:v}:a))}/>
                <Choice title='Resource' value={op.resourceId} options={resourceOptions} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,resourceId:v}:a))}/>
                <Field title='Setup minutes' type='number' value={op.setupMinutes} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,setupMinutes:Number(v)}:a))}/>
                <Field title='Minutes / unit' type='number' value={op.runMinutesPerUnit} onChange={v=>update('operations',operations.map((a,j)=>j===i?{...a,runMinutesPerUnit:Number(v)}:a))}/>
                <button type='button' className='min-h-11 self-end rounded-lg border border-red-700/50 px-3 text-sm text-red-300' onClick={()=>update('operations',operations.filter((_,j)=>j!==i))}>Remove</button>
            </div>)}</div>
        </section>}
        <p className='text-xs text-amber-200'>Records are saved as drafts. Technical approvals and release of active BOM/routing versions will be introduced with the governed execution workflow; drafts cannot trigger procurement, inventory or accounting postings.</p>
    </div>;
}

export default function ProductionFoundation({module,permissions}:{module:'PLN'|'MFG';permissions:string[]}){
    const [active,setActive]=useState<Tab>(module==='PLN'?'config':'items');
    const [rows,setRows]=useState<Record<Kind,Row[]>>(emptyRows);
    const [draft,setDraft]=useState<Row|null>(null);
    const [config,setConfig]=useState<Config>({horizonDays:90,freezeDays:7,lotPolicy:'LOT_FOR_LOT',strategy:'MTS'});
    const [configRevision,setConfigRevision]=useState(0);
    const [demo,setDemo]=useState<Demo|null>(null);
    const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
    const canEdit=hasPerm(permissions,'MFG.master.edit');
    const canConfig=hasPerm(permissions,'PLN.configure');
    const canSave=canEdit && (active!=='boms'||hasPerm(permissions,'MFG.bom.edit')) && (active!=='recipes'||hasPerm(permissions,'MFG.bom.edit')) && (active!=='routings'||hasPerm(permissions,'MFG.routing.edit'));
    const load=async()=>{
        setLoading(true);setError('');
        try{
            const [datasets,configuration]=await Promise.all([
                Promise.all(kinds.map(kind=>callBackend<{records:Row[]}>('/api/org/pln-mfg/foundation/list',{kind}))),
                callBackend<{config:Config;revision:number}>('/api/org/pln-mfg/foundation/config').catch(()=>null),
            ]);
            const [items,boms,resources,routings]=datasets;
            setRows({items:items.records,boms:boms.records,resources:resources.records,routings:routings.records});
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
    const changeTab=(tab:Tab)=>{setActive(tab);setDraft(null);setError('');setNotice('');};
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
    const preview=async()=>{
        setBusy(true);setError('');
        try{setDemo(await callBackend<Demo>('/api/org/pln-mfg/foundation/demo'));}catch(e){setError(e instanceof Error?e.message:'Could not open pilot data.');}finally{setBusy(false);}
    };
    return <div className='space-y-4'>
        <PageTitle title={module==='PLN'?'Production Planning & MRP':'Manufacturing — Master Data'} subtitle='Phase 1 foundation · universal multi-stage production model · no live production or stock postings' action={<Button variant='secondary' disabled={busy} onClick={()=>void load()}>Refresh</Button>}/>
        <div className='flex gap-2 overflow-x-auto pb-1'>{tabs.map(tab=><button type='button' key={tab.key} aria-current={active===tab.key?'page':undefined} onClick={()=>changeTab(tab.key)} className={'min-h-11 shrink-0 rounded-xl border px-3 text-sm '+(active===tab.key?'border-emerald-500 bg-emerald-500/10 text-emerald-200':'border-slate-700 text-slate-300')}>{tab.label}</button>)}</div>
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
            <div className='flex flex-wrap items-center justify-between gap-2'><p className='text-sm text-amber-200'>Read-only demonstration. No test data is written to a real tenant.</p><Button variant='secondary' disabled={busy} onClick={()=>void preview()}>Load fictional Line 11</Button></div>
            {demo&&<><p className='text-xs text-slate-400'>{demo.label}</p><div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>{([['SKUs',demo.items],['BOMs & recipes',demo.boms],['Resources',demo.resources],['Routings',demo.routings]] as Array<[string,Row[]]>).map(([title,data])=><section className='rounded-lg bg-slate-950 p-3' key={title}><h3 className='mb-2 font-semibold'>{title} ({data.length})</h3>{data.map(r=><div key={r.id} className='border-t border-slate-800 py-2 text-xs'><span className='text-emerald-200'>{r.id}</span><p className='text-slate-300'>{r.name}</p></div>)}</section>)}</div></>}
        </Card>:<>
            <div className='flex flex-wrap items-center justify-between gap-3'><p className='text-sm text-slate-400'>{filtered.length} saved master records · draft versions</p>{canSave&&<Button onClick={()=>setDraft(newRecord(active))}>Add {active==='items'?'SKU':active==='recipes'?'recipe':active==='boms'?'BOM':active==='routings'?'routing':'resource'}</Button>}</div>
            {draft?<Card className='space-y-4'>
                <div className='flex items-center justify-between gap-2'><h2 className='font-semibold'>{draft.revision?'Edit draft':'New master record'}</h2><Button variant='secondary' onClick={()=>setDraft(null)}>Cancel</Button></div>
                <MasterEditor tab={active} draft={draft} onChange={setDraft} items={rows.items} resources={rows.resources}/>
                <div className='flex justify-end'><Button disabled={busy||!canSave} onClick={()=>void save()}>{busy?'Saving...':'Save draft'}</Button></div>
            </Card>:<div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>{filtered.map(row=><Card key={row.id} className='space-y-2'>
                <div className='flex items-start justify-between gap-2'><span className='font-mono text-xs text-emerald-300'>{row.id}</span><span className='rounded-full bg-slate-800 px-2 py-1 text-[11px] uppercase text-slate-300'>{str(row.status)||'draft'}</span></div>
                <h3 className='font-semibold'>{row.name}</h3>
                <p className='text-xs text-slate-400'>{active==='items'?str(row.category)+' · '+str(row.uom):active==='resources'?str(row.type)+' · '+number(row.rate)+'/h':active==='routings'?'Operations: '+asOperations(row.operations).length:'Components: '+asComponents(row.components).length}</p>
                <div className='flex items-center justify-between gap-2'><span className='text-xs text-slate-500'>Revision {row.revision??1}</span>{canSave&&<Button variant='secondary' onClick={()=>setDraft(row)}>Open / edit</Button>}</div>
            </Card>)}</div>}
            {!filtered.length&&!draft&&<Card><p className='text-sm text-slate-400'>No records have been created here yet. Start with products and resources; then define the BOMs and production routings. The fictional pilot is available under Line 11 Pilot Preview.</p></Card>}
        </>}
    </div>;
}
