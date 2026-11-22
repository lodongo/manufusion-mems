import {useEffect,useState} from 'react';
import {Alert,Field,SelectField} from '../components/ui';
import {callBackend} from '../lib/backend';
import {AssetForm} from './AssetRegister';
import AssetUtilitySupplies from './AssetUtilitySupplies';
import UtilityBrowser,{type Utility} from '../admin/UtilityBrowser';
import type {UtilityCapacityReview} from '../shared/utilityDistributionCapacity';

type Source={assetTag:string;allocatedCapacity:number|null};
type Item={code:string;label:string;values:Record<string,string|number>;sources:Source[];
 capacity:number|null;ready:boolean;review:UtilityCapacityReview|null;legacy?:boolean};
type DraftItem=Pick<Item,'code'|'label'|'values'|'sources'>;
type Asset={tag:string;name:string;status:string;nodeId:string;rating:{
 key:string;unit:string;capacity:number|null}|null};
type Data={costCenterId:string;costCenterName:string;siteId:string;revision:number;canEdit:boolean;
 items:Item[];catalogue:Utility[];assets:Asset[]};
const num=(n:number|null|undefined)=>n==null?'Not configured':new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(n);
const textInput='min-h-11 w-full rounded-xl border border-line bg-panel px-3 text-sm text-ink';
/** Utilities belong to the cost centre; equipment draws from its distribution, never directly from this form. */
export default function CostCenterUtilitySupplies({costCenterId,onBack}:{
 costCenterId:string;onBack?:()=>void;
}){
 const [data,setData]=useState<Data|null>(null);
 const [draft,setDraft]=useState<DraftItem[]>([]);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [browse,setBrowse]=useState(false),[editing,setEditing]=useState('');
 const [assets,setAssets]=useState<Asset[]>([]);
 const [assetForm,setAssetForm]=useState(false);
 const [ratingAsset,setRatingAsset]=useState('');
 const load=async()=>{
  setLoading(true);setError('');
  try{
   const next=await callBackend<Data>('/api/org/ast/cost-center-utilities/read',{costCenterId});
   setData(next);
   setDraft(next.items.map(x=>({code:x.code,label:x.label,values:{...x.values},
    sources:x.sources.map(a=>({...a}))})));
  }catch(e){setError(e instanceof Error?e.message:'Could not read cost-centre utility supplies.');}
  finally{setLoading(false);}
 };
 useEffect(()=>{void load();},[costCenterId]);
 const modify=(code:string,update:(item:DraftItem)=>DraftItem)=>
  setDraft(rows=>rows.map(item=>item.code===code?update(item):item));
 const choose=async(code:string)=>{
  setEditing(code);setAssetForm(false);setRatingAsset('');
  try{
   const result=await callBackend<{assets:Asset[]}>('/api/org/ast/cost-center-utilities/asset-options',{costCenterId,code});
   setAssets(result.assets);
  }catch(e){setError(e instanceof Error?e.message:'Cannot load source assets for this utility.');}
 };
 const add=(u:Utility)=>{
  setDraft(rows=>[...rows.filter(x=>x.code!==u.code),{
   code:u.code,label:u.label,values:{},sources:[]}]);
  setBrowse(false);void choose(u.code);
 };
 const submit=async()=>{
  if(!data||!data.canEdit)return;
  setSaving(true);setError('');setNotice('');
  try{
   const result=await callBackend<{revision:number}>('/api/org/ast/cost-center-utilities/save',{
    costCenterId,version:data.revision,items:draft});
   setNotice('Cost-centre utility distribution saved · revision '+result.revision+'.');
   await load(); // Refresh rated asset capacity and all equipment demand
  }catch(e){setError(e instanceof Error?e.message:'Utility supply could not be saved.');}
  finally{setSaving(false);}
 };
 const active=data?.catalogue.find(u=>u.code===editing);
 const current=draft.find(x=>x.code===editing);
 const saved=data?.items.find(x=>x.code===editing);
 const determinant=saved?.review?.determinant||active?.attributes?.find(a=>
  ['current','flow','feed','power','force','mass'].includes(a.key)&&a.type==='number');
 if(browse&&data)return <UtilityBrowser items={data.catalogue.filter(u=>!draft.some(d=>d.code===u.code))}
  onBack={()=>setBrowse(false)} onChoose={add}/>;
 if(assetForm)return <AssetForm onCancel={()=>setAssetForm(false)} onDone={tag=>{
  setAssetForm(false);
  // An asset created in the inline flow is immediately proposed as a supply
  // source. Source rating and allocated capacity still require confirmation.
  modify(editing,row=>({...row,sources:[...row.sources.filter(s=>s.assetTag!==tag),
   {assetTag:tag,allocatedCapacity:null}]}));
  void choose(editing).then(()=>setRatingAsset(tag));
 }}/>;
 return <section className='space-y-4'>
  <div className='flex flex-wrap items-start justify-between gap-2'>
   <div><h2 className='text-lg font-semibold text-ink'>Utility supply &amp; distribution</h2>
    <p className='text-xs text-muted'>{data?.costCenterName||costCenterId} · Asset-backed supply to all equipment in this cost centre</p></div>
   {onBack&&<button type='button' className='min-h-11 rounded-xl border border-line px-3 text-sm'
    onClick={onBack}>Back to cost centre</button>}
  </div>
  <p className='text-sm text-muted'>Add each utility once at the cost centre, choose its supplying assets, allocate usable supply capacity and specify conditions such as voltage, pressure or quality. Equipment automatically inherits this utility supply through its cost centre. Loads such as current and flow are summed; voltage and other delivery conditions are checked for compatibility, not added together.</p>
  {error&&<Alert tone='error'>{error}</Alert>}
  {notice&&<p role='status' className='rounded-xl border border-line p-3 text-sm'>{notice}</p>}
  {loading?<p role='status' className='text-sm text-muted'>Reading utility supplies and equipment requirements…</p>:
   !data?<p className='text-sm text-muted'>No utility configuration is available.</p>:
   <>
    <div className='flex flex-wrap gap-2'>
     {data.canEdit&&<button type='button' className='min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand'
      onClick={()=>setBrowse(true)} disabled={draft.length>=80}>Add utility supply</button>}
     <button type='button' className='min-h-11 rounded-xl border border-line px-4 text-sm'
      onClick={()=>void load()}>Recalculate equipment demand</button>
    </div>
    {draft.map(item=>{
     const latest=data.items.find(x=>x.code===item.code);
     const review=latest?.review;
     const opened=editing===item.code;
     const config=data.catalogue.find(x=>x.code===item.code);
     return <article className='space-y-3 rounded-xl border border-line bg-panel p-3' key={item.code}>
      <div className='flex flex-wrap items-center justify-between gap-2'>
       <div><h3 className='font-semibold text-ink'>{config?.label||item.label}</h3>
        <p className='text-xs text-muted'>{item.code} · {item.sources.length} source asset(s)</p></div>
       <div className='flex gap-2'>
        <button type='button' className='min-h-10 rounded-lg border border-line px-3 text-sm'
         onClick={()=>opened?setEditing(''):void choose(item.code)}>
         {opened?'Close':'Configure / review'}</button>
        {data.canEdit&&<button type='button' className='min-h-10 rounded-lg border border-line px-3 text-sm'
         onClick={()=>{setDraft(rows=>rows.filter(x=>x.code!==item.code));if(opened)setEditing('');}}>Remove</button>}
       </div>
      </div>
      {review&&<div className='space-y-2 rounded-lg bg-page p-3 text-xs'>
       <div className='flex flex-wrap justify-between gap-2'>
        <span className='font-semibold'>Equipment demand: {num(review.demand)} {review.determinant?.unit||''}</span>
        <span>Available: {num(review.capacity)} {review.determinant?.unit||''}</span>
       </div>
       {review.percentage!==null&&<div className='space-y-1'>
        <p>Supply loading: <strong>{num(review.percentage)}%</strong>
         {' · '}{review.status==='overload'?'OVER CAPACITY':review.status==='warning'?'Approaching capacity':
          review.status==='incompatible'?'Incompatible supply conditions':review.status==='normal'?'Within capacity':'Needs configuration'}</p>
        <div className='h-2 w-full overflow-hidden rounded-full bg-panel'>
         <div className={'h-full '+(review.percentage>100?'bg-red-500':review.percentage>84?'bg-amber-500':'bg-emerald-500')}
          style={{width:Math.min(100,review.percentage)+'%'}}/>
        </div>
       </div>}
       <p>Equipment served: {review.consumers.length} · Unknown demand: {review.unknown}
        {review.remaining!==null?' · Remaining capacity: '+num(review.remaining)+' '+review.determinant?.unit:''}</p>
       {review.gaps.length>0&&<div className='space-y-1'>
        {review.gaps.slice(0,8).map((g,i)=><p className='text-amber-600' key={g.equipmentId+'-'+g.key+'-'+i}>
         {g.equipmentId}: {g.message}</p>)}
       </div>}
      </div>}
      {opened&&<>
       <div className='space-y-2'>
        <h4 className='text-sm font-semibold'>Cost-centre supply conditions</h4>
        <p className='text-xs text-muted'>Enter the actual supplied characteristics. Voltage, phase, pressure and quality are checked against individual equipment; they are not added to the total load.</p>
        <div className='grid gap-3 sm:grid-cols-2'>
         {(config?.attributes||[]).filter(a=>a.key!==(review?.determinant?.key||determinant?.key)).map(attr=>
          <label key={attr.key} className='space-y-1'>
           <span className='block text-xs font-semibold'>{attr.label}{attr.unit?' ('+attr.unit+')':''}</span>
           {attr.type==='select'?<select className={textInput} disabled={!data.canEdit}
            value={String(item.values[attr.key]??'')}
            onChange={e=>modify(item.code,x=>({...x,values:{...x.values,[attr.key]:e.target.value}}))}>
            <option value=''>Choose supplied value</option>
            {(attr.options||[]).map(o=><option key={o} value={o}>{o}</option>)}
           </select>:
            <input className={textInput} type={attr.type==='number'?'number':'text'} step='any'
             disabled={!data.canEdit} value={item.values[attr.key]??''}
             onChange={e=>modify(item.code,x=>({...x,values:{
              ...x.values,[attr.key]:attr.type==='number'&&e.target.value!==''?Number(e.target.value):e.target.value}}))}/>}
          </label>)}
        </div>
       </div>
       <div className='space-y-2'>
        <h4 className='text-sm font-semibold'>Supplying assets and allocated capacity</h4>
        {item.sources.map((source,i)=>{
         const asset=assets.find(a=>a.tag===source.assetTag);
         return <div className='grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2' key={source.assetTag+'-'+i}>
          <SelectField id={'cc-utility-asset-'+i} label='Registered supply asset' disabled={!data.canEdit}
           value={source.assetTag} onChange={e=>modify(item.code,x=>({...x,sources:x.sources.map((v,j)=>j===i?
            {assetTag:e.target.value,allocatedCapacity:null}:v)}))}>
           <option value=''>Choose available asset</option>
           {assets.map(a=><option key={a.tag} value={a.tag}>{a.tag} · {a.name}</option>)}
          </SelectField>
          {determinant&&<Field id={'cc-utility-cap-'+i} label={'Allocated usable capacity ('+(determinant.unit||'')+')'}
           type='number' step='any' disabled={!data.canEdit} value={source.allocatedCapacity??''}
           onChange={e=>modify(item.code,x=>({...x,sources:x.sources.map((v,j)=>j===i?
            {...v,allocatedCapacity:e.target.value?Number(e.target.value):null}:v)}))}/>}
          <p className='text-xs text-muted'>Asset rating: {num(asset?.rating?.capacity)} {asset?.rating?.unit||determinant?.unit||''}</p>
          {data.canEdit&&<button type='button' className='min-h-10 rounded-lg border border-line px-3 text-xs'
           onClick={()=>modify(item.code,x=>({...x,sources:x.sources.filter((_,j)=>j!==i)}))}>Remove source</button>}
          {source.assetTag&&<button type='button' className='min-h-10 rounded-lg border border-line px-3 text-xs'
           onClick={()=>setRatingAsset(ratingAsset===source.assetTag?'':source.assetTag)}>
           {ratingAsset===source.assetTag?'Hide':'Configure'} source asset rating</button>}
          {ratingAsset===source.assetTag&&<div className='sm:col-span-2'>
           <AssetUtilitySupplies assetTag={source.assetTag}/></div>}
         </div>;
        })}
        {data.canEdit&&<div className='flex flex-wrap gap-2'>
         <button type='button' className='min-h-11 rounded-xl border border-line px-3 text-sm'
          disabled={item.sources.length>=12} onClick={()=>modify(item.code,x=>({...x,sources:[
           ...x.sources,{assetTag:'',allocatedCapacity:null}]}))}>Add another supplying asset</button>
         <button type='button' className='min-h-11 rounded-xl border border-line px-3 text-sm'
          onClick={()=>setAssetForm(true)}>Create supply asset if missing</button>
        </div>}
        {!assets.length&&<Alert tone='warn'>No eligible supplying assets found at this site. Create and rate an asset, then assign it to this cost-centre utility.</Alert>}
       </div>
       {review?.consumers.length?<details className='rounded-lg border border-line p-3'>
        <summary className='cursor-pointer text-sm font-semibold'>Equipment demand breakdown ({review.consumers.length})</summary>
        <div className='mt-2 space-y-2'>
         {review.consumers.map(c=><div className='rounded-lg bg-page p-2 text-xs' key={c.equipmentId}>
          <p className='font-semibold'>{c.name} · {c.equipmentId}</p>
          <p>{num(c.demand)} {review.determinant?.unit||''} · {c.legacy?'Historical direct supply; migration needed':'Cost-centre distribution'}</p>
          {c.gaps.map((g,i)=><p className='text-amber-600' key={i}>{g.message}</p>)}
         </div>)}
        </div>
       </details>:<p className='text-xs text-muted'>No equipment is connected yet. Configure utilities on equipment after saving this supply.</p>}
      </>}
     </article>;
    })}
    {!draft.length&&<p className='rounded-xl border border-line p-3 text-sm text-muted'>No utility supply configured. Select Add utility supply, then link a suitable source asset and define available capacity and delivery conditions.</p>}
    {data.canEdit&&<div className='sticky bottom-0 z-10 rounded-xl border border-line bg-panel p-3'>
     <button type='button' className='min-h-11 w-full rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand disabled:opacity-50'
      disabled={saving} onClick={()=>void submit()}>{saving?'Saving…':'Save cost-centre utility supplies'}</button>
    </div>}
   </>}
 </section>;
}
