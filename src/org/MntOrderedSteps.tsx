import {Button} from '../admin/kit';
export function legacySteps(values:unknown,...fallback:unknown[]):string[]{
 if(Array.isArray(values))return values.filter((x):x is string=>typeof x==='string');
 return fallback.flatMap(x=>typeof x==='string'?x.split(/\r?\n/).filter(v=>v.trim()):[]);
}
export function OrderedStepReview({label,values}:{label:string;values:string[]}){
 return <div className='space-y-1 text-sm'><p className='font-medium'>{label}</p>{values.length?<ol className='list-decimal space-y-1 pl-5'>{values.map((v,i)=><li key={i} className='whitespace-pre-wrap break-words'>{v}</li>)}</ol>:<p className='text-soft'>Not recorded</p>}</div>;
}
export default function MntOrderedSteps({label,itemLabel,values,onChange}:{label:string;itemLabel:string;values:string[];onChange:(v:string[])=>void}){
 const move=(i:number,delta:number)=>{const j=i+delta;if(j<0||j>=values.length)return;const next=[...values];[next[i],next[j]]=[next[j],next[i]];onChange(next);};
 return <section className='space-y-2'><p className='text-sm font-semibold'>{label} *</p><p className='text-xs text-soft'>Enter one {itemLabel} at a time, then arrange the execution sequence.</p>{values.map((v,i)=><div key={i} className='rounded-xl border border-line bg-page p-2 space-y-2'><label className='block text-sm'> {i+1}. {itemLabel}<textarea aria-label={itemLabel+' '+(i+1)} className='mt-1 w-full rounded-lg border border-line bg-panel p-2 text-base' rows={2} maxLength={500} value={v} onChange={e=>onChange(values.map((x,j)=>i===j?e.target.value:x))}/></label><div className='flex flex-wrap gap-2'><button type='button' className='min-h-10 rounded-lg border border-line px-3 text-sm disabled:opacity-40' disabled={i===0} onClick={()=>move(i,-1)} aria-label={'Move '+itemLabel+' '+(i+1)+' up'}>↑ Up</button><button type='button' className='min-h-10 rounded-lg border border-line px-3 text-sm disabled:opacity-40' disabled={i===values.length-1} onClick={()=>move(i,1)} aria-label={'Move '+itemLabel+' '+(i+1)+' down'}>↓ Down</button><button type='button' className='min-h-10 px-2 text-sm text-red-500' onClick={()=>onChange(values.filter((_,j)=>j!==i))}>Remove</button></div></div>)}<Button variant='secondary' disabled={values.length>=100||values.some(x=>x.trim().length<3)} onClick={()=>onChange([...values,''])}>+ Add {itemLabel}</Button></section>;
}
