import {useEffect,useState} from 'react';
import {callBackend} from '../lib/backend';
type Line={skuId:string;skuName:string;commissionedRatePerHour:number;rateUom:string};
type Data={configured:boolean;costCenterId?:string;unitId?:string;revision?:number;updatedAt?:string;lines:Line[]};
export default function PlnAssetCapacityView({assetTag}:{assetTag:string}){
 const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{
  let live=true;setLoading(true);setError('');setData(null);
  callBackend<Data>('/api/org/pln/equipment/asset-view',{assetTag})
   .then(x=>{if(live)setData(x);}).catch(e=>{if(live)setError(e instanceof Error?e.message:'Unavailable');})
   .finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[assetTag]);
 return <section className='rounded-2xl border border-line bg-panel p-4 text-ink'>
  <h2 className='font-semibold'>Production Planning & MRP</h2>
  <p className='mt-1 text-xs text-muted'>Read-only planning designation. Select the equipment and map SKUs under Production Planning & MRP.</p>
  {loading?<p className='mt-3 text-sm text-muted'>Checking planning linkage…</p>:
   error?<p role='alert' className='mt-3 text-sm text-muted'>{error}</p>:
   !data?.configured?<p className='mt-3 text-sm text-muted'>This asset is not currently designated as the planning equipment for its manufacturing cost centre.</p>:
   <div className='mt-3 space-y-2'>
    <p className='text-xs text-muted'>Cost centre {data.costCenterId} · Equipment {data.unitId} · Revision {data.revision} · {data.updatedAt?.slice(0,10)}</p>
    {data.lines.map(line=><div key={line.skuId} className='rounded-lg border border-line p-3'>
      <p className='text-sm font-semibold'>{line.skuName}</p>
      <p className='text-xs text-muted'>{line.skuId}</p>
      <p className='text-sm tabular-nums'>{new Intl.NumberFormat(undefined,{maximumFractionDigits:3}).format(line.commissionedRatePerHour)} {line.rateUom}/hour commissioned</p>
    </div>)}
   </div>}
 </section>;
}
