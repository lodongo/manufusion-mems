import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Alert,SelectField} from '../components/ui';
import {Button,Card,Spinner,useLoad} from '../admin/kit';
type Ref={code:string;label:string;category:string;subcategory?:string;color?:string};
export type TaskRiskRow={hazard:string;impact:string;controls:string[];before:Record<string,number>;after:Record<string,number>};
export type TaskRiskMatrix={factors:{code:string;label:string;max:number;enabled:boolean}[]}|null;
type Profile={hazardEnabled:boolean;injuries:{code:string;label:string;effective:boolean}[];layers:{code:string;rank:number;label:string;measures:{code:string;label:string;effective:boolean;guidance?:boolean}[]}[]};
export const emptyRisk=():TaskRiskRow=>({hazard:'',impact:'',controls:[],before:{},after:{}});
const pick=(a:string[],c:string)=>a.includes(c)?a.filter(x=>x!==c):[...a,c];
export function HazardRows({rows,onChange,hazards,legacyImpacts=[],legacyControls=[],matrix,readOnly=false}:{rows:TaskRiskRow[];onChange:(v:TaskRiskRow[])=>void;hazards:Ref[];legacyImpacts?:Ref[];legacyControls?:Ref[];matrix:TaskRiskMatrix;readOnly?:boolean}){
 return <div className='space-y-3'>{rows.map((r,i)=><HazardRow key={i+':'+r.hazard} row={r} index={i} hazards={hazards} legacyImpacts={legacyImpacts} legacyControls={legacyControls} matrix={matrix} readOnly={readOnly} onChange={v=>onChange(rows.map((x,j)=>j===i?v:x))} onRemove={()=>onChange(rows.filter((_,j)=>i!==j))}/>)}{!readOnly&&<Button variant='secondary' onClick={()=>onChange([...rows,emptyRisk()])}>+ Add hazard / injury</Button>}</div>;
}
function HazardRow({row:r,index,hazards,legacyImpacts,legacyControls,matrix,readOnly,onChange,onRemove}:{row:TaskRiskRow;index:number;hazards:Ref[];legacyImpacts:Ref[];legacyControls:Ref[];matrix:TaskRiskMatrix;readOnly:boolean;onChange:(v:TaskRiskRow)=>void;onRemove:()=>void}){
 const [category,setCategory]=useState(hazards.find(h=>h.code===r.hazard)?.category||'');
 const [sub,setSub]=useState(hazards.find(h=>h.code===r.hazard)?.subcategory||'');
 const {data,error,loading}=useLoad(()=>r.hazard?callBackend<Profile>('/api/org/saf/hazard-profile/read',{code:r.hazard}):Promise.resolve(null),[r.hazard]);
 const profile=data&&r.hazard?data:null;
 const allowed=profile?.injuries.filter(i=>i.effective)||[];
 const historicalInjury=r.impact&&!allowed.some(i=>i.code===r.impact)?legacyImpacts.find(i=>i.code===r.impact):undefined;
 const legacy=legacyControls.filter(c=>r.controls.includes(c.code)&&!profile?.layers.some(l=>l.measures.some(m=>m.code===c.code)));
 const options=hazards.filter(h=>h.code===r.hazard||category&&sub&&h.category===category&&h.subcategory===sub);
 const change=(p:Partial<TaskRiskRow>)=>onChange({...r,...p});
 return <Card className='space-y-3'><div className='flex justify-between gap-2'><strong>Hazard / injury {index+1}</strong>{!readOnly&&<Button variant='secondary' onClick={onRemove}>Remove</Button>}</div>
 <SelectField id={'haz-cat-'+index} label='Hazard category' value={category} disabled={readOnly} onChange={e=>{setCategory(e.target.value);setSub('');}}><option value=''>Select category…</option>{[...new Set(hazards.map(h=>h.category))].sort().map(c=><option key={c}>{c}</option>)}</SelectField>
 <SelectField id={'haz-sub-'+index} label='Subcategory' value={sub} disabled={!category||readOnly} onChange={e=>setSub(e.target.value)}><option value=''>Select subcategory…</option>{[...new Set(hazards.filter(h=>h.category===category).map(h=>h.subcategory||'General'))].sort().map(s=><option key={s}>{s}</option>)}</SelectField>
 <SelectField id={'haz-'+index} label='Hazard *' value={r.hazard} disabled={readOnly||!category||!sub} onChange={e=>change({hazard:e.target.value,impact:'',controls:[],before:{},after:{}})}><option value=''>Select adopted hazard</option>{options.map(h=><option key={h.code} value={h.code}>{h.label}</option>)}{r.hazard&&!options.some(h=>h.code===r.hazard)&&<option value={r.hazard}>{r.hazard} (historical)</option>}</SelectField>
 {r.hazard&&<>{loading&&<Spinner/>}{error&&<Alert tone='error'>{error}</Alert>}{profile&&<><SelectField id={'inj-'+index} label='Nature of potential injury / illness *' value={r.impact} disabled={readOnly} onChange={e=>change({impact:e.target.value})}><option value=''>Select adopted injury</option>{allowed.map(x=><option key={x.code} value={x.code}>{x.label}</option>)}{r.impact&&!allowed.some(x=>x.code===r.impact)&&<option value={r.impact}>{historicalInjury?.label||r.impact} (historical / unavailable)</option>}</SelectField>
 {r.impact&&<><h3 className='font-semibold'>Mitigation hierarchy *</h3>{profile.layers.map(l=><details key={l.code} className='rounded-lg border border-line p-3' open={l.measures.some(m=>r.controls.includes(m.code))||undefined}><summary className='cursor-pointer font-medium'>{l.rank}. {l.label} · {l.measures.filter(m=>r.controls.includes(m.code)).length} selected</summary>{l.measures.filter(m=>m.effective||m.guidance||r.controls.includes(m.code)).map(m=><label key={m.code} className='mt-2 flex items-start gap-2 text-sm'>{!m.guidance&&<input type='checkbox' checked={r.controls.includes(m.code)} disabled={readOnly||!m.effective&&!r.controls.includes(m.code)} onChange={()=>change({controls:pick(r.controls,m.code)})}/>}<span>{m.label}{m.guidance?' (guidance only)':!m.effective?' (no longer adopted)':''}</span></label>)}{!l.measures.some(m=>m.effective)&&<p className='text-xs text-soft'>No adopted measures at this level.</p>}</details>)}{legacy.map(m=><label key={m.code} className='flex gap-2 text-sm'><input type='checkbox' checked disabled={readOnly} onChange={()=>change({controls:pick(r.controls,m.code)})}/>{m.label} (historical selection)</label>)}
 {(['before','after'] as const).map(k=><div key={k} className='space-y-2 rounded-lg border border-line p-2'><strong>{k==='before'?'Initial risk':'Residual risk'}</strong>{matrix?.factors.filter(f=>f.enabled).map(f=><SelectField key={f.code} id={index+'-'+k+'-'+f.code} label={f.label} disabled={readOnly} value={String(r[k][f.code]||'')} onChange={e=>change({[k]:{...r[k],[f.code]:Number(e.target.value)}})}><option value=''>Select rating</option>{Array.from({length:f.max},(_,j)=><option key={j+1} value={j+1}>{j+1}</option>)}</SelectField>)}</div>)}</>}</>}</>}
 </Card>;
}
