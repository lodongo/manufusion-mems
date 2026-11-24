import {useId} from 'react';
import { SelectField, Field } from '../components/ui';

type Source={id:string;name:string;type:string;siteId?:string;rateUom?:string;
 meterReference?:string;unitCost?:number|null;currency?:string;notes?:string};
export type SupplyProfile={productionMode?:string;handlingMode?:string;
 qualitySpecification?:string;sources?:Source[]};
type Site={id:string;name:string};
type Unit={code:string;label:string;symbol:string;categoryCode:string;baseUnit?:string};
const sourceTypes:Array<[string,string]>=[
 ['PURCHASED','Purchased / supplier'],['EXTRACTED','Extracted / withdrawn at source'],
 ['MANUFACTURED','Produced on site'],['RECOVERED','Recovered / recycled'],
 ['EXTERNAL','Other external supply'],['OTHER','Other source'],
];
function Pick({title,value,options,onChange}:{title:string;value:string;options:Array<[string,string]>;
 onChange:(v:string)=>void}){
 const id=useId();
 return <SelectField id={id} label={title} value={value}
  onChange={event=>onChange(event.target.value)}>
  {options.map(([id,label])=><option key={id} value={id}>{label}</option>)}
 </SelectField>;
}
function Input({title,value,onChange,type='text',placeholder}:{
 title:string;value:string|number;onChange:(v:string)=>void;type?:string;placeholder?:string}){
 const id=useId();
 return <Field label={title} id={id} aria-labelledby={id+'-label'} type={type} min={type==='number'?'0':undefined} step={type==='number'?'any':undefined} placeholder={placeholder} value={value} onChange={e=>onChange(e.target.value)}/>;
}
/** Configuration only: saved source rates never post invoices or inventory movements. */
export default function PlnMaterialSupplyProfile({value,onChange,sites,units,materialUom}:{
 value:SupplyProfile;onChange:(v:SupplyProfile)=>void;sites:Site[];units:Unit[];materialUom:string;
}){
 const profile=value||{},sources=profile.sources||[];
 const patch=(part:Partial<SupplyProfile>)=>onChange({...profile,...part});
 const editSource=(id:string,part:Partial<Source>)=>
  patch({sources:sources.map(x=>x.id===id?{...x,...part}:x)});
 const addSource=()=>{
  let n=1;
  while(sources.some(x=>x.id==='SRC_'+String(n).padStart(4,'0')))n++;
  patch({sources:[...sources,{id:'SRC_'+String(n).padStart(4,'0'),name:'',type:'PURCHASED',
   siteId:'',rateUom:materialUom,unitCost:null,currency:'',meterReference:''}]});
 };
 return <details className='rounded-xl border border-line bg-panel p-3'>
  <summary className='cursor-pointer text-sm font-semibold text-ink'>
   Material supply, continuous flow & buffers
   <span className='block pt-1 text-xs font-normal text-muted'>Optional for existing SKUs · configure how the same material can be produced, purchased, piped or stored</span>
  </summary>
  <div className='mt-3 space-y-3'>
   <p className='text-xs text-muted'>This describes the material, not a new SKU per supply source. Inline and bulk materials do not require commercial or transport packaging. Stock or non-stock treatment stays under the existing inventory configuration.</p>
   <div className='grid gap-3 sm:grid-cols-2'>
    <Pick title='How is this material produced?' value={profile.productionMode||''}
     options={[['','Not specified'],['CONTINUOUS','Continuously / inline'],
      ['BATCH','In batches'],['DISCRETE','Individual items'],
      ['NOT_PRODUCED','Purchased or obtained without in-house production']]}
     onChange={productionMode=>patch({productionMode})}/>
    <Pick title='How is the material handled?' value={profile.handlingMode||''}
     options={[['','Not specified'],['INLINE','Directly through a pipe or process'],
      ['BUFFERED_BULK','Continuously supplied with an intermediate buffer'],
      ['BULK_STORAGE','Bulk storage / tanks / silos'],['PACKAGED','Packaged units'],
      ['CYLINDER','Canister / cylinder supply']]}
     onChange={handlingMode=>patch({handlingMode})}/>
   </div>
   <Input title='Quality or grade specification (optional)' value={profile.qualitySpecification||''}
    placeholder='Define the accepted material specification, not its source'
    onChange={qualitySpecification=>patch({qualitySpecification})}/>
   <div className='flex flex-wrap items-center justify-between gap-2'>
    <div>
     <h3 className='text-sm font-semibold'>Independent supply sources & tariffs</h3>
     <p className='text-xs text-muted'>Each source can have its own site, meter and price. Real volumes must come from measured readings; no weighted cost is invented.</p>
    </div>
    <button type='button' className='min-h-11 rounded-xl border border-line px-3 text-xs font-semibold disabled:opacity-50'
     disabled={sources.length>=30} onClick={addSource}>Add source</button>
   </div>
   {sources.map((source,i)=><section className='space-y-3 rounded-xl border border-line bg-page p-3' key={source.id}>
    <div className='flex items-center justify-between gap-2'>
     <h4 className='text-sm font-semibold'>Supply source {i+1}</h4>
     <button type='button' className='min-h-10 rounded-lg border border-line px-3 text-xs'
      onClick={()=>patch({sources:sources.filter(x=>x.id!==source.id)})}>Remove</button>
    </div>
    <div className='grid gap-3 sm:grid-cols-2'>
     <Input title='Source name' value={source.name} placeholder='Enter the supplier, intake or generator name'
      onChange={name=>editSource(source.id,{name})}/>
     <Pick title='Source category' value={source.type} options={sourceTypes}
      onChange={type=>editSource(source.id,{type})}/>
     <Pick title='Site / supply location' value={source.siteId||''}
      options={[['','Organization-wide source'],...sites.map(x=>[x.id,x.name] as [string,string])]}
      onChange={siteId=>editSource(source.id,{siteId})}/>
     <Input title='Meter / source reference (optional)' value={source.meterReference||''}
      onChange={meterReference=>editSource(source.id,{meterReference})}/>
     <Input title='Cost per measurement unit (optional)' type='number'
      value={source.unitCost??''} onChange={s=>editSource(source.id,{unitCost:s===''?null:Number(s)})}/>
     <Pick title='Cost measurement unit' value={source.rateUom||materialUom}
      options={[['','Choose unit'],...units.map(u=>[u.code,u.label+' ('+u.symbol+')'] as [string,string])]}
      onChange={rateUom=>editSource(source.id,{rateUom})}/>
     <Input title='Currency code (e.g. ISO 4217)' value={source.currency||''}
      onChange={currency=>editSource(source.id,{currency:currency.toUpperCase()})}/>
     <Input title='Notes' value={source.notes||''} onChange={notes=>editSource(source.id,{notes})}/>
    </div>
   </section>)}
   <p className='text-xs text-muted'>Meter references and source tariffs are configuration metadata. They do not automatically create meter readings, invoice charges, inventory receipts or actual production costs. Actual costing requires measured source quantities and the appropriate finance/utility integration.</p>
  </div>
 </details>;
}
