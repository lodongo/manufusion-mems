import {useEffect,useState} from 'react';
import {callBackend} from '../lib/backend';
import {Alert,Field,SelectField} from '../components/ui';
import {Button,Card,Spinner,TextArea,useLoad,Badge} from '../admin/kit';

const CATALOGUES=[['activityClasses','Activity classes'],['machineStatuses','Machine status during execution'],['permitTypes','Permit types'],['hazards','Hazards'],['impacts','Potential impacts'],['hazardousEnergy','Hazardous energy sources'],['controlMeasures','Control measures'],['ppe','Personal protective equipment'],['riskMethods','Risk assessment methods'],['severityLevels','Severity levels'],['likelihoodLevels','Likelihood levels'],['riskAcceptance','Risk acceptance criteria'],['criticalRules','Safety critical rules'],['emergencyScenarios','Emergency scenarios']];
type Entry={code:string;label:string;category:string;subcategory:string;description:string;color?:string};
type AdoptionRow=Entry&{enabled:boolean;masterActive:boolean};
type Adoption={key:string;title:string;version:number;canEdit:boolean;rows:AdoptionRow[]};
type PermitRow=Entry&{adopted:boolean;version:number;configured:boolean;parameterCount?:number};
type Parameter={code:string;section:string;label:string;kind:string;mandatory:boolean;description:string;enabled:boolean;required:boolean;options?:string[];columns?:Array<{code:string;label:string;kind:string;options?:string[];unitOptions?:string[]}>;applicability?:string;source?:string};
type Policy={maxHours:number;allowExtension:boolean;allowShiftHandover:boolean;requireAttachments:boolean};
type Template={permit:PermitRow;fields:Parameter[];version:number;canEdit:boolean;policy:Policy;updatedAt:string;referenceBasis?:string[];schemaRevision?:number};
const check='h-5 w-5 shrink-0 accent-red-600';
const matches=(v:Entry,q:string)=>[v.code,v.label,v.category,v.subcategory,v.description].some(s=>s.toLowerCase().includes(q.toLowerCase().trim()));

export function SafAdoption(){
 const [key,setKey]=useState('machineStatuses'),[query,setQuery]=useState(''),[category,setCategory]=useState(''),[disabled,setDisabled]=useState<string[]>([]),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[success,setSuccess]=useState('');
 const {data,error,loading,reload}=useLoad(()=>callBackend<Adoption>('/api/org/saf/adoption/read',{key}),[key]);
 const current=data?.key===key?data:undefined;
 useEffect(()=>{if(current){setDisabled(current.rows.filter(x=>!x.enabled&&x.masterActive).map(x=>x.code));setReason('');}},[current]);
 const visible=(current?.rows||[]).filter(x=>(!category||x.category===category)&&matches(x,query));
 const [page,setPage]=useState(1);
 useEffect(()=>setPage(1),[key,category,query]);
 const off=new Set(disabled);
 const change=(code:string,on:boolean)=>{setSuccess('');setDisabled(old=>on?old.filter(x=>x!==code):[...new Set([...old,code])]);};
 const dirty=!!current&&current.rows.some(x=>x.masterActive&&x.enabled===off.has(x.code));
 const save=async()=>{if(!current)return;setBusy(true);setFailure('');setSuccess('');try{await callBackend('/api/org/saf/adoption/save',{key,version:current.version,disabledCodes:disabled,reason});setSuccess('Organization adoption saved.');reload();}catch(e){setFailure(e instanceof Error?e.message:'Save failed.');}finally{setBusy(false);}};
 return <div className='space-y-3'>
  <h1 className='text-xl font-semibold text-ink'>Safety metadata adoption</h1>
  <p className='text-sm text-soft'>Select the SAF master values applicable to this organization. Codes and descriptions are controlled by MEMS Admin. Disabling a value limits new selections; it does not erase historical records or authorize unsafe work.</p>
  <SelectField id='saf-catalogue' label='Catalogue' value={key} onChange={e=>{if(dirty&&!window.confirm('Discard unsaved adoption changes?'))return;setKey(e.target.value);setQuery('');setCategory('');setSuccess('');setFailure('');}}>{CATALOGUES.map(([k,label])=><option key={k} value={k}>{label}</option>)}</SelectField>
  {loading&&!current&&<Spinner/>}{error&&<Alert tone='error'>{error}</Alert>}
  {current&&<>
   <Card className='space-y-3'>
    <p className='font-semibold text-ink'>{current.title} · {current.rows.filter(x=>x.masterActive&&!off.has(x.code)).length}/{current.rows.length} enabled</p>
    {!current.canEdit&&<Alert tone='info'>Read only — organization SAF configuration rights are required to change adoption.</Alert>}
    <Field id='saf-adopt-search' label='Search master' placeholder='Code, name or category' value={query} onChange={e=>setQuery(e.target.value)}/>
    <SelectField id='saf-adopt-category' label='Category' value={category} onChange={e=>setCategory(e.target.value)}><option value=''>All categories</option>{[...new Set(current.rows.map(x=>x.category).filter(Boolean))].sort().map(c=><option key={c}>{c}</option>)}</SelectField>
    {current.canEdit&&<div className='flex flex-wrap gap-2'><Button variant='secondary' onClick={()=>setDisabled(old=>old.filter(code=>!visible.some(x=>x.masterActive&&x.code===code)))}>Enable filtered</Button><Button variant='secondary' onClick={()=>{if(window.confirm('Disable the filtered master entries for future use in this organization?'))setDisabled(old=>[...new Set([...old,...visible.filter(x=>x.masterActive).map(x=>x.code)])]);}}>Disable filtered</Button></div>}
   </Card>
   {visible.slice(0,page*40).map(x=><label key={x.code} className='flex items-start gap-3 rounded-xl border border-line bg-panel p-3'>
    <input type='checkbox' className={check} checked={x.masterActive&&!off.has(x.code)} disabled={!current.canEdit||!x.masterActive||busy} onChange={e=>change(x.code,e.target.checked)}/>
    <div className='min-w-0 flex-1'><p className='font-medium text-ink'>{x.color&&<span aria-label={'Category color '+x.color} className='mr-2 inline-block h-3 w-3 rounded border border-line' style={{backgroundColor:x.color}}/>}{x.label}</p><p className='text-xs text-soft'>{x.category} · {x.subcategory} · {x.code}</p>{!x.masterActive&&<p className='text-xs text-red-500'>Disabled in MEMS Admin</p>}</div>
   </label>)}
   {!visible.length&&<p className='text-sm text-soft'>No matching entries.</p>}
   {visible.length>page*40&&<Button variant='secondary' onClick={()=>setPage(p=>p+1)}>Show more ({visible.length-page*40} remaining)</Button>}
   {current.canEdit&&<Card className='sticky bottom-0 space-y-2'><TextArea label='Reason for change *' id='saf-adopt-reason' rows={2} value={reason} onChange={e=>setReason(e.target.value)}/><Button busy={busy} disabled={!dirty||reason.trim().length<10} onClick={save}>Save adoption</Button></Card>}
  </>}
  {failure&&<Alert tone='error'>{failure}</Alert>}{success&&<Alert tone='info'>{success}</Alert>}
 </div>;
}
export function SafPermits(){
 const {data,error,loading,reload}=useLoad(()=>callBackend<{rows:PermitRow[];canEdit:boolean}>('/api/org/saf/permits/list'),[]);
 const [selected,setSelected]=useState(''),[query,setQuery]=useState(''),[onlyAdopted,setOnlyAdopted]=useState(false);
 if(selected)return <PermitEditor key={selected} code={selected} onBack={()=>{setSelected('');reload();}}/>;
 return <div className='space-y-3'><h1 className='text-xl font-semibold text-ink'>Permits to work</h1><Alert tone='info'>Configuration only. These forms are templates, not issued permits or permission to begin work. Permit requests, approval, issuance and field verification will be implemented separately.</Alert>
  <Field id='saf-permit-query' label='Find permit type' value={query} onChange={e=>setQuery(e.target.value)}/>
  <label className='flex items-center gap-2 text-sm'><input type='checkbox' className={check} checked={onlyAdopted} onChange={e=>setOnlyAdopted(e.target.checked)}/>Show adopted types only</label>
  {loading&&!data&&<Spinner/>}{error&&<Alert tone='error'>{error}</Alert>}
  {(data?.rows||[]).filter(x=>(!onlyAdopted||x.adopted)&&matches(x,query)).map(x=><button type='button' key={x.code} className='block w-full rounded-xl border border-line bg-panel p-3 text-left' onClick={()=>setSelected(x.code)}><div className='flex flex-wrap items-center justify-between gap-2'><strong className='text-ink'>{x.label}</strong><Badge tone={x.adopted?'brand':'muted'}>{x.adopted?'Adopted':'Disabled'}</Badge></div><p className='text-xs text-soft'>{x.category} · {x.subcategory} · {x.code}</p><p className='mt-1 text-xs text-soft'>{x.configured?'Configured · v'+x.version:'Standard form · review and configure'} · {x.parameterCount||0} parameters</p></button>)}
 </div>;
}
function PermitEditor({code,onBack}:{code:string;onBack:()=>void}){
 const {data,error,loading,reload}=useLoad(()=>callBackend<Template>('/api/org/saf/permits/template/read',{code}),[code]);
 const [fields,setFields]=useState<Parameter[]>([]),[policy,setPolicy]=useState<Policy>({maxHours:8,allowExtension:false,allowShiftHandover:false,requireAttachments:false});
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[success,setSuccess]=useState(''),[preview,setPreview]=useState(false);
 const [parameterQuery,setParameterQuery]=useState(''),[showOptions,setShowOptions]=useState<Record<string,boolean>>({});
 useEffect(()=>{if(data){setFields(data.fields);setPolicy(data.policy);setReason('');}},[data]);
 const patch=(code:string,next:Partial<Parameter>)=>setFields(old=>old.map(f=>f.code===code?{...f,...next}:f));
 const save=async()=>{if(!data)return;setBusy(true);setFailure('');setSuccess('');try{await callBackend('/api/org/saf/permits/template/save',{code,version:data.version,fields:fields.map(({code,enabled,required})=>({code,enabled,required})),policy,reason});setSuccess('Permit template version saved.');reload();}catch(e){setFailure(e instanceof Error?e.message:'Save failed.');}finally{setBusy(false);}};
 const edit=!!data?.canEdit;
 const sections=[...new Set(fields.map(x=>x.section))];
 return <div className='space-y-3'>
  <div className='flex items-start gap-2'><Button variant='secondary' onClick={()=>{if(!reason.trim()||window.confirm('Leave this template? Unsaved changes will be lost.'))onBack();}}>← Back</Button><div className='min-w-0 flex-1'><h1 className='font-semibold text-ink'>{data?.permit.label||code}</h1><p className='text-xs text-soft'>Permit form configuration · {data?.version?'Version '+data.version:'Standard draft'}</p></div></div>
  {loading&&!data&&<Spinner/>}{error&&<Alert tone='error'>{error}</Alert>}
  {data&&<>
   <Alert tone='info'>Proposed international benchmark template — not a compliance certificate. Competent safety authority must validate jurisdiction, limits, applicable conditional controls and site procedures before use. Core parameters cannot be disabled.</Alert>
   <Card className='space-y-1'><p className='font-semibold text-ink'>Reference basis · schema revision {data.schemaRevision||1}</p><p className='text-xs text-soft'>{data.referenceBasis?.join(' · ')||'HSE HSG250'}</p><p className='text-xs text-soft'>Core control means a mandatory form parameter, not a completed verification. A justified N/A is subject to competent review.</p></Card>
   {!data.permit.adopted&&<Alert tone='warn'>This permit type is disabled for the organization. You may configure its template; adopt it in Safety metadata adoption before use.</Alert>}
   <Card className='space-y-2'><h2 className='font-semibold text-ink'>Proposed validity and handover policy</h2><Field id='permit-max-hours' type='number' min={1} max={168} label='Maximum validity (hours)' disabled={!edit} value={String(policy.maxHours)} onChange={e=>setPolicy(p=>({...p,maxHours:Number(e.target.value)}))}/>
    {([['allowExtension','Allow documented extension and revalidation'],['allowShiftHandover','Allow documented shift handover / revalidation'],['requireAttachments','Require supporting attachment']] as const).map(([k,label])=><label key={k} className='flex items-center gap-2 text-sm'><input className={check} type='checkbox' disabled={!edit} checked={policy[k]} onChange={e=>setPolicy(p=>({...p,[k]:e.target.checked}))}/>{label}</label>)}
   </Card>
   <div className='flex flex-wrap items-center justify-between gap-2'><p className='text-sm font-semibold text-ink'>{fields.filter(f=>f.enabled).length} of {fields.length} parameters enabled</p><Button variant='secondary' onClick={()=>setPreview(x=>!x)}>{preview?'Configure parameters':'Preview form'}</Button></div>
   {preview&&<p className='text-xs text-soft'>Read-only preview of the configured form structure. No actual permit is created.</p>}
   <Field id='saf-param-search' label='Find parameter' placeholder='Name, code or section' value={parameterQuery} onChange={e=>setParameterQuery(e.target.value)}/>
   {sections.map(section=><Card key={section} className='space-y-2'><h2 className='font-semibold text-ink'>{section}</h2>{fields.filter(f=>f.section===section&&(!preview||f.enabled)&&[f.label,f.code,f.section,f.description].some(v=>v.toLowerCase().includes(parameterQuery.toLowerCase().trim()))).map(f=><div key={f.code} className='space-y-2 rounded-lg border border-line p-3'><div className='flex flex-wrap items-center justify-between gap-2'><strong className='text-sm text-ink'>{f.label}{f.required?' *':''}</strong><span className='text-xs text-soft'>{f.kind} · {f.mandatory?'Core control':f.required?'Required':'Optional'}</span></div><p className='text-xs text-soft'>{f.description}</p>
    {f.applicability&&<p className='text-xs text-soft'>When applicable: {f.applicability}</p>}
    {f.source&&<p className='text-xs text-muted'>Reference: {f.source}</p>}
    {(!!f.options?.length||!!f.columns?.length)&&<div className='space-y-1'><button type='button' className='text-xs font-semibold text-brand underline' onClick={()=>setShowOptions(old=>({...old,[f.code]:!old[f.code]}))}>{showOptions[f.code]?'Hide':'View'} {f.options?.length?f.options.length+' choices':f.columns?.length+' structured columns'}</button>{showOptions[f.code]&&<div className='rounded-lg border border-line p-2 text-xs text-soft'>{f.options?.map(o=><p key={o}>• {o}</p>)}{f.columns?.map(col=><div className='py-1' key={col.code}><strong>{col.label}</strong> · {col.kind}{col.options?.length?<p>{col.options.join(' · ')}</p>:null}</div>)}</div>}</div>}
    {!preview?<div className='flex flex-wrap gap-4 text-sm'><label className='flex items-center gap-2'><input type='checkbox' className={check} disabled={!edit||f.mandatory} checked={f.enabled} onChange={e=>patch(f.code,{enabled:e.target.checked,...(!e.target.checked?{required:false}:{})})}/>Enabled</label><label className='flex items-center gap-2'><input type='checkbox' className={check} disabled={!edit||f.mandatory||!f.enabled} checked={f.required} onChange={e=>patch(f.code,{required:e.target.checked})}/>Required</label></div>:<div className='rounded-md border border-dashed border-line bg-page p-2 text-xs text-muted'>{f.kind==='table'?'Structured record / repeatable rows':f.kind==='select'?'Controlled dropdown — '+(f.options?.length||0)+' choices':f.kind==='employee'?'Employee selector':f.kind==='attachment'?'Document attachment':f.kind==='checkbox'?'Verification checkbox':f.kind==='datetime'?'Date and time':f.kind==='textarea'?'Detailed response':'Response field'}</div>}
   </div>)}</Card>)}
   {edit&&!preview&&<Card className='sticky bottom-0 space-y-2'><TextArea id='permit-template-reason' label='Reason for configuration / change *' rows={2} value={reason} onChange={e=>setReason(e.target.value)}/><Button busy={busy} disabled={reason.trim().length<10||!Number.isFinite(policy.maxHours)||policy.maxHours<=0||policy.maxHours>168} onClick={save}>Save template version</Button></Card>}
  </>}
  {failure&&<Alert tone='error'>{failure}</Alert>}{success&&<Alert tone='info'>{success}</Alert>}
 </div>;
}
