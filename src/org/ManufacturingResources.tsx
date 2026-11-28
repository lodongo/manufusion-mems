import {useEffect,useState,type ReactNode} from 'react';
import {callBackend} from '../lib/backend';
import { Alert, Field, SelectField, TextArea } from '../components/ui';
import PlnCostCenterSkuSetup from './PlnCostCenterSkuSetup';
import {COST_CENTER_CATEGORIES,costCenterCategoryLabel,costCenterSubcategories,costCenterSubcategoriesLabel} from '../shared/costCenterTaxonomy';

type ScopePart={id:string;name:string;code:string;level:string};
type Unit={code:string;name:string;symbol:string;category:string};
type Resource={id:string;name:string;rateUom:string;rateTimeUom:string;productClassification:string;notes:string;revision:number;active?:boolean};
type CostCenter={
 costCenterId:string;costCenterCode:string;costCenterName:string;
 siteId:string;legalEntityId:string;departmentId:string;
 costCenterCategory:string;costCenterSubcategories:string[];
 path:ScopePart[];resource:Resource|null;canConfigure:boolean;
};
type ListData={costCenters:CostCenter[];highestPermittedScope:ScopePart|null;unitOptions:Unit[];testOverride?:boolean};
type DetailData={location:{costCenterId:string;code:string;name:string;siteId:string;
 costCenterCategory:string;costCenterSubcategories:string[]};
 resource:Resource|null;canConfigure:boolean;unitOptions:Unit[];testOverride?:boolean};
const actionClass='min-h-11 rounded-xl border border-line px-4 py-2 text-sm font-semibold disabled:opacity-50';
function Text({children}:{children:ReactNode}){return <p className='text-xs text-muted'>{children}</p>;}
const defaultRateUnit=(options:Unit[])=>options.find(u=>u.name.toLowerCase()==='each')?.code||
 options.find(u=>u.code==='UOM-20-001')?.code||options.find(u=>u.category==='Count')?.code||options[0]?.code||'';

export function ManufacturingResourceDetail({costCenterId,initialTab='core',initialSkuId='',onBack,onSaved,onEditSku}:{
 costCenterId:string;initialTab?:'core'|'sku';initialSkuId?:string;
 onBack?:()=>void;onSaved?:()=>void;onEditSku?:(skuId:string)=>void;
}){
 const [data,setData]=useState<DetailData|null>(null),[loading,setLoading]=useState(true);
 const [tab,setTab]=useState<'core'|'sku'>(initialTab);
 const [name,setName]=useState(''),[rateUom,setRateUom]=useState(''),[notes,setNotes]=useState('');
 const [classification,setClassification]=useState(''),[rateCategory,setRateCategory]=useState(''),[rateTimeUom,setRateTimeUom]=useState('');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false);
 const load=async()=>{
  setLoading(true);setError('');
  try{
   const d=await callBackend<DetailData>('/api/org/pln/resource/get',{costCenterId});
   setData(d);setName(d.resource?.name||d.location.name);
   const currentUnit=d.resource?.rateUom||defaultRateUnit(d.unitOptions);
   setRateUom(currentUnit);setRateCategory(d.unitOptions.find(u=>u.code===currentUnit)?.category||'');
   setClassification(d.resource?.productClassification||'');setRateTimeUom(d.resource?.rateTimeUom||'');
   setNotes(d.resource?.notes||'');
  }catch(e){setError(e instanceof Error?e.message:'Could not load production resource.');}
  finally{setLoading(false);}
 };
 useEffect(()=>{void load();},[costCenterId]);
 const save=async()=>{
  if(!data?.canConfigure)return;
  setSaving(true);setError('');setNotice('');
  try{
   const result=await callBackend<{resource:Resource}>('/api/org/pln/resource/save',{
    costCenterId,name,rateUom,rateTimeUom,productClassification:classification,notes,expectedRevision:data.resource?.revision??0,
   });
   setData(v=>v?{...v,resource:result.resource}:v);
   setNotice('Resource core information saved. SKU allocations are updated through the shared cost-centre setup.');
   onSaved?.();
  }catch(e){setError(e instanceof Error?e.message:'Could not save resource core information.');}
  finally{setSaving(false);}
 };
 const title=data?.resource?.name||data?.location.name||'Manufacturing resource';
 const overrideOutline=data?.testOverride?' border-2 border-blue-500':'';
 const uomOptions=data?.unitOptions||[];
 const categories=[...new Set(uomOptions.filter(x=>x.category!=='Time').map(x=>x.category))].sort();
 return <section className='space-y-4'>
  <div className='flex flex-wrap items-start justify-between gap-2'>
   <div className='min-w-0'>
    <h2 className='break-words text-lg font-semibold text-ink'>{title}</h2>
    <Text>Production cost centre {data?.location.code||costCenterId} · One shared SKU allocation and rating configuration</Text>
    {data&&<Text>Category: {costCenterCategoryLabel(data.location.costCenterCategory)} · Subcategories: {costCenterSubcategoriesLabel(data.location.costCenterCategory,{costSubcategories:data.location.costCenterSubcategories})}</Text>}
   </div>
   {onBack&&<button type='button' className={actionClass} onClick={onBack}>Back to resources</button>}
  </div>
  <div role='tablist' aria-label='Manufacturing resource configuration' className='flex gap-2 overflow-x-auto rounded-xl bg-page p-1'>
   <button type='button' role='tab' aria-selected={tab==='core'}
    onClick={()=>setTab('core')} className={actionClass+(tab==='core'?' border-brand text-brand':'')}>
    Core information</button>
   <button type='button' role='tab' aria-selected={tab==='sku'}
    onClick={()=>setTab('sku')} className={actionClass+(tab==='sku'?' border-brand text-brand':'')}>
    SKU allocation</button>
  </div>
  {error&&<Alert tone='error'>{error}</Alert>}
  {notice&&<p role='status' className='rounded-xl border border-line p-3 text-sm text-ink'>{notice}</p>}
  {loading&&!data&&<p role='status' className='text-sm text-muted'>Loading production resource…</p>}
  {data&&tab==='core'&&<section role='tabpanel' className='space-y-4 rounded-2xl border border-line bg-panel p-3 sm:p-5'>
   <h3 className='font-semibold text-ink'>Core information</h3>
   <Text>Name, product classification and rate unit are common resource settings. Commissioned speed, physical container, package and logistics ratings belong to individual mapped SKUs.</Text>
   <Field id={'resource-name-'+costCenterId} label='Name' value={name}
    disabled={!data.canConfigure||saving} maxLength={160} onChange={e=>setName(e.target.value)}/>
   <SelectField id={'resource-classification-'+costCenterId} label='Resource product classification' value={classification}
    disabled={!data.canConfigure||saving} onChange={e=>setClassification(e.target.value)}>
    <option value=''>Choose product classification</option>
    <option value='INTERMEDIATE'>Intermediate products</option><option value='FINISHED'>Finished products</option>
   </SelectField>
   <Text>Existing allocations remain available for review if the classification changes.</Text>
   <SelectField id={'resource-unit-category-'+costCenterId} label='Rate unit category' value={rateCategory}
    disabled={!data.canConfigure||saving} onChange={e=>{setRateCategory(e.target.value);setRateUom('');}}>
    <option value=''>Choose unit category</option>
    {categories.map(category=><option key={category} value={category}>{category}</option>)}
   </SelectField>
   <SelectField id={'resource-rate-unit-'+costCenterId} label='Rate unit' value={rateUom}
    disabled={!data.canConfigure||saving||!rateCategory} onChange={e=>setRateUom(e.target.value)}>
    <option value=''>Choose unit of measure</option>
    {uomOptions.filter(u=>u.category===rateCategory).map(u=>
      <option key={u.code} value={u.code}>{u.name} ({u.symbol})</option>)}
   </SelectField>
   <SelectField id={'resource-rate-time-'+costCenterId} label='Per time unit' value={rateTimeUom}
    disabled={!data.canConfigure||saving} onChange={e=>setRateTimeUom(e.target.value)}>
    <option value=''>Choose time unit</option>
    {uomOptions.filter(u=>u.category==='Time').map(u=><option key={u.code} value={u.code}>{u.name} ({u.symbol})</option>)}
   </SelectField>
   {rateUom&&rateTimeUom&&<Text>Rate unit: {uomOptions.find(u=>u.code===rateUom)?.name} per {uomOptions.find(u=>u.code===rateTimeUom)?.name}</Text>}
   <TextArea label='Notes' rows={4} maxLength={600} value={notes} disabled={!data.canConfigure||saving} onChange={e=>setNotes(e.target.value)} placeholder='Operating context, constraints and reference notes'/>
   <Text>Resource ID: {data.resource?.id||'Allocated automatically on save'} · Production cost centre: {data.location.name}</Text>
   {data.canConfigure&&<div className='flex flex-wrap justify-end gap-2'>
    <button type='button' disabled={saving||name.trim().length<2||!rateUom||!classification||!rateTimeUom}
     className={actionClass+' bg-brand text-onbrand'+overrideOutline} onClick={()=>void save()}>
     {saving?'Saving…':'Save core information'}</button>
   </div>}
   {!data.canConfigure&&<Text>You have read access. Editing requires the applicable manufacturing, planning or organization-design permission.</Text>}
  </section>}
  {data&&tab==='sku'&&<section role='tabpanel' className='space-y-3'>
   <p className='rounded-xl border border-line p-3 text-sm text-soft'>
    The SKU allocation screen is the same editor used by Materials &amp; Products and Organization Design.
    All views read and save one record in the manufacturing cost-centre capacity master.
   </p>
   <PlnCostCenterSkuSetup costCenterId={costCenterId} initialSkuId={initialSkuId}
    onMappingsChanged={onSaved} onEditSku={onEditSku}/>
  </section>}
 </section>;
}

function ScopeChoice({label,value,items,onChange}:{
 label:string;value:string;items:ScopePart[];onChange:(value:string)=>void;
}){
 return <SelectField id={'resource-scope-'+label.replaceAll(' ','-')} label={label} value={value}
  onChange={e=>onChange(e.target.value)}>
  <option value=''>All accessible</option>
  {items.map(x=><option key={x.id} value={x.id}>{x.name} · {x.code}</option>)}
 </SelectField>;
}

/** Scope-filtered manufacturing resources. Newly added cost centres disappear
 * from the available list and open the same shared detail editor as an asset. */
export default function ManufacturingResources({onChanged,onEditSku,defaultCategory='MFG',defaultSubcategory=''}:{
 onChanged?:()=>void;onEditSku?:(skuId:string)=>void;defaultCategory?:string;defaultSubcategory?:string;
}={}){
 const [data,setData]=useState<ListData|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [le,setLe]=useState(''),[site,setSite]=useState(''),[department,setDepartment]=useState(''),[cc,setCc]=useState('');
 const [category,setCategory]=useState(defaultCategory),[subcategory,setSubcategory]=useState(defaultSubcategory);
 const [selected,setSelected]=useState<string[]>([]);
 const [showAdd,setShowAdd]=useState(false);
 const [opened,setOpened]=useState('');
 const closeAdd=()=>{
  setShowAdd(false);setLe('');setSite('');setDepartment('');setCc('');setSelected([]);
  setCategory(defaultCategory);setSubcategory(defaultSubcategory);
 };
 const load=async()=>{
  setLoading(true);setError('');
  try{setData(await callBackend<ListData>('/api/org/pln/resource/list'));}
  catch(e){setError(e instanceof Error?e.message:'Unable to list manufacturing resources.');}
  finally{setLoading(false);}
 };
 useEffect(()=>{void load();},[]);
 const all=data?.costCenters||[];
 const overrideOutline=data?.testOverride?' border-2 border-blue-500':'';
 const filtered=all.filter(x=>
    (!le||x.legalEntityId===le)&&(!site||x.siteId===site)&&
    (!department||x.departmentId===department)&&(!cc||x.costCenterId===cc)&&
    (!category||x.costCenterCategory===category)&&
    (!subcategory||x.costCenterSubcategories.includes(subcategory)));
 const categoryCodes=[...new Set([defaultCategory,...all.map(x=>x.costCenterCategory)].filter(Boolean))];
 const categoryChoices=categoryCodes.map(code=>({
  code,label:COST_CENTER_CATEGORIES.find(x=>x.code===code)?.label||code,
 }));
 const subcategoryChoices=category?costCenterSubcategories(category):[];
 const scope=(level:string,parent?:string):ScopePart[]=>{
  const seen=new Map<string,ScopePart>();
  for(const center of all){
   const found=center.path.find(x=>x.level===level);
   if(!found)continue;
   if(parent){
    const idx=center.path.findIndex(x=>x.id===found.id);
    if(!center.path.slice(0,idx).some(x=>x.id===parent))continue;
   }
   seen.set(found.id,found);
  }
  return [...seen.values()].sort((a,b)=>a.name.localeCompare(b.name));
 };
 const available=filtered.filter(x=>!x.resource?.active);
 // The added-resource list is always visible across the full authorized scope.
 // Add-form filters must not hide resources after the form is dismissed.
 const configured=all.filter(x=>x.resource?.active);
 const selectedVisible=new Set(selected.filter(id=>available.some(x=>x.costCenterId===id)));
 const add=async()=>{
  if(!data||!selectedVisible.size)return;
  setBusy(true);setError('');setNotice('');
  let count=0;const faults:string[]=[];
  const rateUom=defaultRateUnit(data.unitOptions);
  for(const id of selectedVisible){
   const target=available.find(x=>x.costCenterId===id);
   if(!target?.canConfigure){faults.push((target?.costCenterName||id)+': no configuration permission');continue;}
   try{
    await callBackend('/api/org/pln/resource/save',{
     costCenterId:id,name:target.costCenterName,rateUom,notes:'',
     expectedRevision:target.resource?.revision||0,
    });
    count++;
   }catch(e){faults.push(target.costCenterName+': '+(e instanceof Error?e.message:'save failed'));}
  }
  setSelected([]);
  try{await load();}catch{ /* list refresh reports its own error */ }
  if(count)onChanged?.();
  setNotice(count+' resource(s) added. Click a resource to configure its core and allocate SKUs.');
  if(faults.length)setError('Not added: '+faults.join('; '));
  else if(count)closeAdd();
  setBusy(false);
 };
 const remove=async(x:CostCenter)=>{
  if(!x.resource?.active)return;
  if(!window.confirm('Remove '+x.resource.name+' from Manufacturing Resources? SKU ratings remain in the shared cost-centre setup.'))return;
  setBusy(true);setError('');
  try{
   await callBackend('/api/org/pln/resource/remove',{
    costCenterId:x.costCenterId,expectedRevision:x.resource.revision});
   await load();onChanged?.();
   setNotice('Resource removed. Shared SKU allocation and capacity records remain intact.');
  }catch(e){setError(e instanceof Error?e.message:'Resource could not be removed.');}
  finally{setBusy(false);}
 };
 if(opened)return <ManufacturingResourceDetail key={opened} costCenterId={opened} onEditSku={onEditSku}
    onBack={()=>{setOpened('');void load();}} onSaved={()=>{
     void load();onChanged?.();
    }}/>;
 return <div className='space-y-4'>
  <div className='flex flex-wrap items-center justify-between gap-2'>
   <div><h2 className='text-lg font-semibold text-ink'>Manufacturing Resources</h2>
    <Text>Adopt resources from production cost centres within your authorized organization scope.</Text></div>
   <div className='flex flex-wrap gap-2'>
    {!showAdd&&<button type='button' disabled={loading||busy} className={actionClass+' bg-brand text-onbrand'+overrideOutline}
     onClick={()=>{setCategory(defaultCategory);setSubcategory(defaultSubcategory);setShowAdd(true);setError('');setNotice('');}}>Add resources</button>}
    <button type='button' disabled={loading||busy} className={actionClass} onClick={()=>void load()}>Refresh resources</button>
   </div>
  </div>
  {error&&<Alert tone='error'>{error}</Alert>}
  {notice&&<p role='status' className='rounded-xl border border-line p-3 text-sm text-ink'>{notice}</p>}
  {loading&&!data&&<p className='text-sm text-muted'>Loading permitted production cost centres…</p>}
  {data&&<>
   {showAdd&&<>
    <div className='flex flex-wrap items-center justify-between gap-2'>
     <h3 className='font-semibold text-ink'>Add manufacturing resources</h3>
     <button type='button' disabled={busy} className={actionClass} onClick={closeAdd}>Cancel</button>
    </div>
   <div className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
    <p className='text-sm font-semibold text-ink'>Highest permitted scope: {data.highestPermittedScope?.name||'Accessible organization locations'}</p>
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
     <SelectField id='resource-cost-category' label='Cost-centre category' value={category}
      onChange={e=>{setCategory(e.target.value);setSubcategory('');setCc('');setSelected([]);}}>
      <option value=''>All production categories</option>
      {categoryChoices.map(c=><option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}
     </SelectField>
     <SelectField id='resource-cost-subcategory' label='Cost-centre subcategory' value={subcategory}
      onChange={e=>{setSubcategory(e.target.value);setCc('');setSelected([]);}}>
      <option value=''>All subcategories</option>
      {subcategoryChoices.map(c=><option key={c.code} value={c.code}>{c.label} · {c.code}</option>)}
     </SelectField>
     <ScopeChoice label='Legal entity' value={le} items={scope('legal_entity')}
      onChange={v=>{setLe(v);setSite('');setDepartment('');setCc('');}}/>
     <ScopeChoice label='Site' value={site} items={scope('site',le||undefined)}
      onChange={v=>{setSite(v);setDepartment('');setCc('');}}/>
     <ScopeChoice label='Department' value={department} items={scope('department',site||undefined)}
      onChange={v=>{setDepartment(v);setCc('');}}/>
     <ScopeChoice label='Production cost centre' value={cc} items={scope('cost_center',department||undefined)}
      onChange={setCc}/>
    </div>
    <Text>Category and subcategory come from the same Finance cost-centre classification used in Organization Design. A cost centre may have multiple subcategories. These filters only change the selection list, never existing cost-centre or SKU records.</Text>
   </div>
   <section className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
    <div className='flex flex-wrap items-center justify-between gap-2'>
     <h3 className='font-semibold text-ink'>Available production resources ({available.length})</h3>
     {available.length>0&&<button type='button' className={actionClass} onClick={()=>
      setSelected(available.filter(x=>x.canConfigure).map(x=>x.costCenterId))}>
      Select all permitted</button>}
    </div>
    <Text>Select any number of accessible production cost centres. Added resources disappear from this list automatically.</Text>
    {available.map(x=><label key={x.costCenterId}
     className='flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-line p-3'>
     <input type='checkbox' checked={selectedVisible.has(x.costCenterId)}
      disabled={!x.canConfigure||busy}
      onChange={e=>setSelected(v=>e.target.checked?[...new Set([...v,x.costCenterId])]:
       v.filter(id=>id!==x.costCenterId))}/>
     <span className='min-w-0'>
      <span className='block break-words text-sm font-semibold'>{x.costCenterName} · {x.costCenterCode}</span>
      <span className='block text-xs text-muted'>{x.path.map(p=>p.name).join(' / ')}</span>
      <span className='block text-xs text-muted'>{costCenterCategoryLabel(x.costCenterCategory)} · {costCenterSubcategoriesLabel(x.costCenterCategory,{costSubcategories:x.costCenterSubcategories})}</span>
     </span>
    </label>)}
    {!available.length&&<Text>All production cost centres in this scope are already added, or none are accessible.</Text>}
    <div className='flex flex-wrap items-center justify-between gap-2'>
     <Text>{selectedVisible.size} cost centre(s) selected</Text>
     <button type='button' className={actionClass+' bg-brand text-onbrand'+overrideOutline}
      disabled={busy||!selectedVisible.size} onClick={()=>void add()}>
      {busy?'Adding…':'Add selected resources'}</button>
    </div>
   </section>
   </>}
   <section className='space-y-3'>
    <h3 className='font-semibold text-ink'>Added manufacturing resources ({configured.length})</h3>
    <div className='grid gap-3 md:grid-cols-2'>
     {configured.map(x=><article key={x.costCenterId} className='rounded-2xl border border-line bg-panel p-3'>
      <button type='button' className='w-full text-left' onClick={()=>setOpened(x.costCenterId)}>
       <p className='font-semibold text-ink'>{x.resource!.name}</p>
       <Text>{x.costCenterName} · {x.costCenterCode} · {x.resource!.id}</Text>
       <Text>{costCenterCategoryLabel(x.costCenterCategory)} · {costCenterSubcategoriesLabel(x.costCenterCategory,{costSubcategories:x.costCenterSubcategories})}</Text>
       <Text>Product classification: {x.resource!.productClassification==='FINISHED'?'Finished products':x.resource!.productClassification==='INTERMEDIATE'?'Intermediate products':'Not yet classified'}</Text>
       <Text>Click to open Core information and SKU allocation</Text>
      </button>
      <div className='mt-3 flex flex-wrap gap-2'>
       <button type='button' className={actionClass} onClick={()=>setOpened(x.costCenterId)}>Open resource</button>
       {x.canConfigure&&<button type='button' className={actionClass+' text-red-600'+overrideOutline}
        disabled={busy} onClick={()=>void remove(x)}>Remove</button>}
      </div>
     </article>)}
    </div>
    {!configured.length&&<Text>No production resources added in this scope.</Text>}
   </section>
  </>}
 </div>;
}
