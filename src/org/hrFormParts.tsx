import {useEffect,useRef,useState} from 'react';

export const field='min-h-12 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink';
export const btn='flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
export const primary='flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-3 text-sm font-semibold text-onbrand disabled:opacity-40';
export const fmt=(n:number)=>new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(n);
export const pct=(x:number)=>Number((x*100).toFixed(5));

/** A number box that keeps what the person typed. An empty or invalid box reports NaN so the form can refuse it. */
export function NumField({label,value,onChange,disabled,hint,percent,max,placeholder,optional}:{label:string;value:number;onChange:(n:number)=>void;disabled?:boolean;hint?:string;percent?:boolean;max?:number;placeholder?:string;optional?:boolean}){
 const show=(v:number)=>Number.isNaN(v)?'':String(percent?pct(v):v);
 const [text,setText]=useState(show(value));
 const last=useRef(value);
 useEffect(()=>{if(!Object.is(value,last.current)){last.current=value;setText(show(value))}},[value]);// eslint-disable-line react-hooks/exhaustive-deps
 const bad=optional&&Number.isNaN(value)?false:!Number.isFinite(value)||value<0||(max!==undefined&&value>max);
 return <label className="block min-w-0 text-sm text-muted">{label}
  <input className={field+' mt-1'} type="number" inputMode="decimal" min={0} step="any" value={text} disabled={disabled} placeholder={placeholder} aria-invalid={bad}
   onChange={e=>{
    const t=e.target.value;setText(t);
    const n=t.trim()===''?NaN:Number(t);
    const v=Number.isFinite(n)&&percent?Number((n/100).toFixed(8)):n;
    last.current=v;onChange(v);
   }}/>
  {hint&&<span className="mt-0.5 block text-xs font-normal">{hint}</span>}
 </label>;
}

/** Pick one from a short list. A row of buttons instead of a dropdown, so it is quick on a phone. */
export function Choice<T extends string>({label,value,options,onChange,disabled,locked}:{label:string;value:T;options:Array<{value:T;label:string;hint?:string}>;onChange:(v:T)=>void;disabled?:boolean;locked?:boolean}){
 const current=options.find(o=>o.value===value);
 return <fieldset className="space-y-1.5">
  <legend className="text-sm font-medium text-ink">{label}</legend>
  <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">{options.map(o=>
   <button key={o.value} type="button" role="radio" aria-checked={value===o.value} disabled={disabled||(locked&&value!==o.value)} onClick={()=>onChange(o.value)}
    className={'min-h-11 rounded-xl border px-3 text-sm disabled:opacity-60 '+(value===o.value?'border-brand bg-brand/10 font-semibold text-brand':'border-line text-soft')}>{o.label}</button>)}</div>
  {current?.hint&&<p className="text-xs text-muted">{current.hint}</p>}
 </fieldset>;
}
