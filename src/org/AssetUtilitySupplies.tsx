import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Alert,Field,SelectField} from '../components/ui';
import {Button,Card,Spinner,useLoad} from '../admin/kit';
type Determinant={key:string;label:string;unit:string};
export type SupplySummary={code:string;label:string;determinant:Determinant|null;capacity:number|null;total:number;ownDemand:number;unknown:number;count:number;percent:number|null;status:string;consumers?:{name:string;code?:string;demand:number|null}[]};
export type SourceOption=SupplySummary&{tag:string;name:string;className:string;assetStatus:string};
const fmt=(n:number)=>n.toLocaleString(undefined,{maximumFractionDigits:2});
export function CapacityLine({supply,projected}:{supply:SupplySummary;projected?:number}){
    if(!supply.determinant)return <span className='block text-xs text-muted'>Linked consumers: {supply.count} · no additive capacity metric</span>;
    const total=projected??supply.total, cap=supply.capacity, percent=cap?total/cap*100:null;
    const tone=percent!==null&&percent>100?'text-red-400':percent!==null&&percent>84?'text-amber-400':supply.unknown||percent===null?'text-muted':'text-emerald-400';
    return <span className='block space-y-1 text-xs'><span className='block text-soft'>{projected===undefined?'Allocated demand':'Projected demand'}: {fmt(total)} / {cap===null?'not rated':fmt(cap)} {supply.determinant.unit} · {supply.count} linked</span>
        {percent!==null&&<span className='block h-2 overflow-hidden rounded bg-slate-700'><span className={'block h-2 '+(percent>100?'bg-red-500':percent>84?'bg-amber-500':'bg-emerald-500')} style={{width:Math.min(100,Math.max(0,percent))+'%'}}/></span>}
        <span className={'block font-semibold '+tone}>{percent===null?'Supply capacity not configured':fmt(percent)+'% '+(percent>100?'OVER CAPACITY':percent>84?'WARNING · exceeds 84%':'allocated')}{supply.unknown?' · missing demand on '+supply.unknown+' connection(s)':''}</span>
        {cap!==null&&<span className='block text-muted'>Remaining {fmt(cap-total)} {supply.determinant.unit} · configured demand, not live metering</span>}
    </span>;
}
export default function AssetUtilitySupplies({assetTag}:{assetTag:string}){
    const {data,error,loading,reload}=useLoad(()=>callBackend<{supplies:SupplySummary[];catalogue:{code:string;label:string;determinant:Determinant|null}[];canEdit:boolean}>('/api/org/ast/utilities/read',{assetTag}),[assetTag]);
    const [code,setCode]=useState(''),[rating,setRating]=useState(''),[busy,setBusy]=useState(false),[problem,setProblem]=useState('');
    const def=data?.catalogue.find(d=>d.code===code),existing=data?.supplies.find(s=>s.code===code);
    const select=(next:string)=>{setCode(next);const s=data?.supplies.find(s=>s.code===next);setRating(s?.capacity==null?'':String(s.capacity));setProblem('');};
    const save=async()=>{if(!def)return;setBusy(true);setProblem('');try{await callBackend('/api/org/ast/utilities/save',{assetTag,code,capacity:def.determinant?Number(rating):null,expectedRating:existing&&(existing.capacity!==null||!existing.determinant)?{key:existing.determinant?.key??'',unit:existing.determinant?.unit??'',capacity:existing.capacity}:null});setCode('');setRating('');reload();}catch(e){setProblem(e instanceof Error?e.message:'Could not save rating.');}finally{setBusy(false);}};
    return <Card className='space-y-3'><h2 className='font-semibold text-ink'>Utilities supplied · capacity & connected equipment</h2>
    {loading&&<Spinner/>}{error&&<Alert tone='error'>{error} <Button variant='secondary' onClick={reload}>Retry</Button></Alert>}
    {data&&!data.supplies.length&&<p className='text-xs text-muted'>No supply ratings or equipment connections recorded.</p>}
    {data?.supplies.map(s=><div key={s.code} className='space-y-2 rounded-xl border border-line p-3'><div className='flex items-center justify-between gap-2'><span className='font-semibold'>{s.label}</span>{data.canEdit&&data.catalogue.some(d=>d.code===s.code)&&<Button variant='secondary' onClick={()=>select(s.code)}>Edit capacity</Button>}</div><CapacityLine supply={s}/>{s.consumers?.map((c,i)=><div className='flex justify-between gap-2 text-xs text-muted' key={i}><span>{c.code?c.code+' · ':''}{c.name}</span><span>{c.demand===null?'—':fmt(c.demand)+' '+(s.determinant?.unit??'')}</span></div>)}</div>)}
    {data?.canEdit&&<div className='space-y-2'><SelectField id='asset-supplied-utility' label='Configure a supplied utility' value={code} onChange={e=>select(e.target.value)}><option value=''>Select…</option>{data.catalogue.map(d=><option key={d.code} value={d.code}>{d.label}</option>)}</SelectField>
    {def?.determinant&&<Field id='asset-supply-capacity' label={'Usable capacity · '+def.determinant.label+' ('+def.determinant.unit+')'} inputMode='decimal' value={rating} onChange={e=>setRating(e.target.value)}/>}
    {def&&<Button busy={busy} disabled={!!def.determinant&&(!(Number(rating)>0)||!Number.isFinite(Number(rating)))} onClick={()=>void save()}>Save supplied utility</Button>}{problem&&<Alert tone='error'>{problem}</Alert>}</div>}
    <Button variant='secondary' onClick={reload}>Refresh capacity</Button></Card>;
}
