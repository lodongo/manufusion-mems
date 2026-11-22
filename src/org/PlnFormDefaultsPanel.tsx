import {useEffect,useId,useState} from 'react';
import {Alert,Field,SelectField} from '../components/ui';
import {callBackend} from '../lib/backend';
import {DEFAULT_FORM_DEFAULTS,formDefaultsFor,type FormDefaults} from './plnFormDefaults';
import {COST_CENTER_CATEGORIES,costCenterSubcategories,type CostCenterCategory} from '../shared/costCenterTaxonomy';

type Site={id:string;name:string;code:string};
type Props={initial:FormDefaults;revision:number;sites:Site[];canEdit:boolean;
 onSaved:(value:FormDefaults,revision:number)=>void};

function Choice({title,value,options,onChange,disabled}:{
 title:string;value:string;options:Array<[string,string]>;
 onChange:(v:string)=>void;disabled:boolean;
}){
 const id=useId();
 return <SelectField id={id} label={title} value={value} disabled={disabled}
  onChange={e=>onChange(e.target.value)}>
  {options.map(([code,name])=><option key={code} value={code}>{name}</option>)}
 </SelectField>;
}
function Quantity({title,value,onChange,disabled,min='0'}:{
 title:string;value:number;onChange:(v:number)=>void;disabled:boolean;min?:string;
}){
 const id=useId();
 return <Field id={id} type='number' min={min} label={title} value={value}
  disabled={disabled} onChange={e=>onChange(Number(e.target.value))}/>;
}
export default function PlnFormDefaultsPanel({initial,revision,sites,canEdit,onSaved}:Props){
 const [draft,setDraft]=useState<FormDefaults>(()=>formDefaultsFor(initial));
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [costCategories,setCostCategories]=useState<CostCenterCategory[]>(COST_CENTER_CATEGORIES);
 useEffect(()=>{
  let mounted=true;
  void callBackend<{types:CostCenterCategory[]}>('/api/org/reference/cost-center-types')
   .then(x=>{if(mounted&&x.types?.length)setCostCategories(x.types);})
   .catch(()=>{/* Shared taxonomy remains the fallback. */});
  return ()=>{mounted=false;};
 },[]);
 // Manufacturing resources can be adopted only from Production/Manufacturing cost centres.
 const resourceCategories=costCategories.filter(c=>c.code==='MFG'||
  /\b(manufactur(?:e|ing)?|production|factory)\b/i.test(c.label));
 const resourceSubcategories=costCategories.find(c=>c.code===draft.resourceCostCenterCategory)?.subcategories||
  costCenterSubcategories(draft.resourceCostCenterCategory);
 useEffect(()=>{setDraft(formDefaultsFor(initial));setError('');setNotice('');},[initial,revision]);
 const change=<K extends keyof FormDefaults>(key:K,value:FormDefaults[K])=>
  setDraft(old=>({...old,[key]:value}));
 const invalid=()=>{
  if(!Number.isFinite(draft.bomOutputQty)||draft.bomOutputQty<=0)return 'BOM output quantity must be greater than zero.';
  if(!resourceCategories.some(c=>c.code===draft.resourceCostCenterCategory))
   return 'Choose a Manufacturing/Production cost-centre category from the shared cost-centre types.';
  if(draft.resourceCostCenterSubcategory&&!resourceSubcategories.some(x=>x.code===draft.resourceCostCenterSubcategory))
   return 'Choose a subcategory belonging to the selected cost-centre category.';
  if(!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(draft.routingAlternativeCode))
   return 'Alternative code must contain 1–32 uppercase letters, digits, underscores or hyphens.';
  if(!Number.isFinite(draft.demandQuantity)||draft.demandQuantity<=0)
   return 'Demand quantity must be greater than zero.';
  if(!Number.isInteger(draft.demandLeadDays)||draft.demandLeadDays<0||draft.demandLeadDays>3650)
   return 'Demand lead time must be 0–3,650 whole calendar days.';
  if(draft.defaultSiteId&&!sites.some(s=>s.id===draft.defaultSiteId))
   return 'Selected site is no longer accessible. Choose a different site or Automatic.';
  return '';
 };
 const save=async()=>{
  if(!canEdit||busy)return;
  const problem=invalid();
  if(problem){setError(problem);setNotice('');return;}
  setBusy(true);setError('');setNotice('');
  try{
   const result=await callBackend<{formDefaults:FormDefaults;revision:number}>(
    '/api/org/pln-mfg/foundation/form-defaults/save',
    {formDefaults:draft,expectedRevision:revision});
   setDraft(result.formDefaults);onSaved(result.formDefaults,result.revision);
   setNotice('Form defaults saved (revision '+result.revision+'). New forms will use these values. Existing records remain unchanged.');
  }catch(e){setError(e instanceof Error?e.message:'Could not save form defaults.');}
  finally{setBusy(false);}
 };
 const siteOptions:Array<[string,string]>=[['','Automatic · only when one site is accessible'],
  ...sites.map(s=>[s.id,s.name+(s.code?' · '+s.code:'')] as [string,string])];
 if(draft.defaultSiteId&&!sites.some(s=>s.id===draft.defaultSiteId))
  siteOptions.push([draft.defaultSiteId,'Previously configured site · no longer accessible']);
 const action='min-h-11 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50';
 return <section className='min-w-0 space-y-4 rounded-2xl border border-line bg-panel p-3 sm:p-4'>
  <div>
   <h2 className='text-lg font-semibold'>Form Defaults</h2>
   <p className='mt-1 text-sm text-muted'>Suggested values for new records in Production Planning & MRP. Configure once, then change individual forms when needed.</p>
   <p className='mt-2 text-xs text-muted'>Status: {revision>0?'Saved · revision '+revision:'Suggested values · not yet saved'}</p>
  </div>
  {error&&<Alert tone='error'>{error}</Alert>}
  {notice&&<p role='status' className='rounded-xl border border-line p-3 text-sm'>{notice}</p>}
  <div className='space-y-3'>
   <details open className='rounded-xl border border-line p-3'>
    <summary className='cursor-pointer font-semibold'>1. Default location and product type</summary>
    <div className='mt-3 grid gap-3 sm:grid-cols-2'>
     <Choice title='Default production site' value={draft.defaultSiteId} options={siteOptions}
      disabled={!canEdit||busy} onChange={v=>change('defaultSiteId',v)}/>
     <Choice title='New material/SKU category' value={draft.skuCategory}
      options={ [['FINISHED','Finished goods'],['INTERMEDIATE','Intermediate/WIP'],
       ['RAW','Raw material'],['PACKAGING','Packaging component']] }
      disabled={!canEdit||busy} onChange={v=>change('skuCategory',v as FormDefaults['skuCategory'])}/>
    </div>
    <p className='mt-2 text-xs text-muted'>The site applies only when accessible to the current user. If there is more than one accessible site and no default, selection remains required.</p>
   </details>
   <details className='rounded-xl border border-line p-3'>
    <summary className='cursor-pointer font-semibold'>2. BOM and process routing</summary>
    <div className='mt-3 grid gap-3 sm:grid-cols-2'>
     <Quantity title='BOM standard output quantity' value={draft.bomOutputQty}
      min='0.000001' disabled={!canEdit||busy} onChange={v=>change('bomOutputQty',v)}/>
     <label className='block text-xs font-medium text-soft'>
      <span className='mb-1 block'>BOM/routing alternative code</span>
      <input className='min-h-11 w-full rounded-xl border border-line bg-panel px-3 text-sm text-ink'
       value={draft.routingAlternativeCode} disabled={!canEdit||busy} maxLength={32}
       onChange={e=>change('routingAlternativeCode',e.target.value.toUpperCase())}/>
     </label>
    </div>
   </details>
   <details className='rounded-xl border border-line p-3'>
    <summary className='cursor-pointer font-semibold'>3. Manufacturing resources · cost-centre classification</summary>
    <div className='mt-3 grid gap-3 sm:grid-cols-2'>
     <Choice title='Default cost-centre category' value={draft.resourceCostCenterCategory}
      options={resourceCategories.map(c=>[c.code,c.code+' · '+c.label] as [string,string])}
      disabled={!canEdit||busy} onChange={v=>setDraft(old=>({...old,resourceCostCenterCategory:v,resourceCostCenterSubcategory:''}))}/>
     <Choice title='Default cost-centre subcategory' value={draft.resourceCostCenterSubcategory}
      options={[['','All subcategories'],...resourceSubcategories.map(x=>[x.code,x.label+' · '+x.code] as [string,string])]}
      disabled={!canEdit||busy} onChange={v=>change('resourceCostCenterSubcategory',v)}/>
    </div>
    <p className='mt-2 text-xs text-muted'>These are optional filters when adopting manufacturing resources from authorized production cost centres. Actual categories and subcategories are owned by Organization Design → Cost Centres. Resource defaults never change cost-centre classifications, equipment types or commissioned SKU speeds.</p>
   </details>
   <details className='rounded-xl border border-line p-3'>
    <summary className='cursor-pointer font-semibold'>4. Demand & S&amp;OP</summary>
    <div className='mt-3 grid gap-3 sm:grid-cols-2'>
     <Choice title='Default demand type' value={draft.demandType}
      options={ [['FORECAST','Forecast'],['FIRM_ORDER','Firm customer order']] }
      disabled={!canEdit||busy} onChange={v=>change('demandType',v as FormDefaults['demandType'])}/>
     <Quantity title='Default demand quantity' value={draft.demandQuantity}
      min='0.000001' disabled={!canEdit||busy} onChange={v=>change('demandQuantity',v)}/>
     <Quantity title='Required-date lead time (calendar days)' value={draft.demandLeadDays}
      min='0' disabled={!canEdit||busy} onChange={v=>change('demandLeadDays',v)}/>
    </div>
    <p className='mt-2 text-xs text-muted'>Required date is calculated from the user's local calendar at the moment a new demand form is opened. Quantity units follow the selected SKU.</p>
   </details>
  </div>
  <p className='text-xs text-muted'>This is an optional foundation step. It does not block Product Configuration, and saving it does not mark Planning Configuration as complete or alter existing approved masters.</p>
  <div className='flex flex-col gap-2 sm:flex-row sm:justify-end'>
   <button type='button' className={action+' border border-line'} disabled={!canEdit||busy}
    onClick={()=>{setDraft({...DEFAULT_FORM_DEFAULTS});setError('');setNotice('Suggested defaults loaded. Save to apply them.');}}>
    Restore suggested defaults
   </button>
   <button type='button' className={action+' bg-brand text-onbrand'} disabled={!canEdit||busy}
    onClick={()=>void save()}>{busy?'Saving…':'Save form defaults'}</button>
  </div>
  {!canEdit&&<p className='text-xs text-muted'>You have read access. Saving organization-wide defaults requires PLN.configure permission.</p>}
 </section>;
}
