import {useCallback,useEffect,useMemo,useState} from 'react';
import {BadgeCheck,Banknote,BriefcaseBusiness,Lock,Plus,Save,ShieldCheck,Trash2} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {navigate} from '../lib/route';
import {SelectField} from '../components/ui';
import {Segmented,messageOf,useConfirm} from '../components/screen';
import Sheet from '../components/Sheet';
import RichTable,{type Column} from '../components/RichTable';
import {activationProblems,draftIssues} from '../shared/hrJobGradeRules';
import {estimateKenyaMonthly} from './hrPayPreview';
import HrJobGradeApprovals from './HrJobGradeApprovals';
import type {PayConfig} from '../../backend/hrCompensationConfig';

type Grade={code:string;rank:number;title:string;description:string;enabled:boolean;minSalary:number|null;taxCodes:string[];deductionCodes:string[]};
type CatalogueItem={code:string;name:string;category:string;mandatory:boolean;enabled:boolean;description:string};
type Catalogue={taxes:CatalogueItem[];deductions:CatalogueItem[];forcedTaxes:string[];forcedDeductions:string[]};
type RoleRef={code:string;title:string};
type Loaded={
 entities:Array<{id:string;name:string}>;entity:{id:string;name:string;countryCode:string;currency:string}|null;
 financial:boolean;canManage:boolean;canApprove:boolean;
 draft?:{saved:boolean;version:number;updatedAt:string;grades:Grade[];digest:string};
 active?:{version:number;sourceDraftVersion:number;approvalRef:string;activatedAt:string;digest:string}|null;
 changedSinceActive?:boolean;pendingRequestId?:string;catalogue?:Catalogue|null;payConfig?:PayConfig|null;
 roles?:Record<string,RoleRef[]>;
};
const field='min-h-12 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink';
const btn='flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
const primary='flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-3 text-sm font-semibold text-onbrand disabled:opacity-40';
const money=(n:number|null|undefined,c='')=>n===null||n===undefined?'—':(c?c+' ':'')+new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(n);
const key=(g:Grade)=>g.code||'new-'+g.rank;

/** Checklist of catalogue items. Items the law makes mandatory are ticked and locked. */
function CodePicker({title,hint,items,forced,value,onChange,disabled}:{title:string;hint:string;items:CatalogueItem[];forced:string[];value:string[];onChange:(v:string[])=>void;disabled:boolean}){
 const shown=items.filter(i=>i.enabled||value.includes(i.code)||forced.includes(i.code));
 return <fieldset className="space-y-2">
  <legend className="text-sm font-semibold text-ink">{title}</legend>
  <p className="text-xs text-muted">{hint}</p>
  {!shown.length&&<p className="rounded-xl bg-page p-3 text-xs text-amber-600">None are available yet. Configure them in HR Settings → Compensation & Benefits first.</p>}
  <div className="space-y-1">{shown.map(i=>{
   const locked=forced.includes(i.code);const on=locked||value.includes(i.code);
   return <label key={i.code} className={'flex min-h-12 items-start gap-3 rounded-xl border border-line px-3 py-2 '+(on?'bg-brand/5':'bg-page')}>
    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-emerald-500" checked={on} disabled={locked||disabled}
     onChange={e=>onChange(e.target.checked?[...value,i.code]:value.filter(c=>c!==i.code))}/>
    <span className="min-w-0 flex-1 text-sm"><span className="font-medium text-ink">{i.name}</span>
     <span className="block font-mono text-[11px] text-muted">{i.code}</span>
     {locked&&<span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-brand"><Lock className="h-3 w-3"/>Required by law · applies to every grade</span>}
     {!locked&&!i.enabled&&<span className="block text-[11px] text-amber-600">Switched off in Compensation & Benefits</span>}
    </span>
   </label>;})}</div>
 </fieldset>;
}

function TakeHome({gross,config,currency}:{gross:number;config:PayConfig;currency:string}){
 let est:ReturnType<typeof estimateKenyaMonthly>|null=null;
 try{est=gross>0?estimateKenyaMonthly(gross,config):null}catch{est=null}
 if(!est)return null;
 const rows:[string,number,boolean?][]=[['Gross (minimum salary)',est.gross],['NSSF',-est.nssf],['SHIF',-est.shif],['Housing levy',-est.ahl],['PAYE after personal relief',-est.paye],['Indicative take-home',est.net,true]];
 return <div className="rounded-xl border border-line bg-page p-3">
  <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Banknote className="h-4 w-4 text-brand"/>Indicative monthly take-home</p>
  <dl className="mt-2 space-y-1 text-sm">{rows.map(([k,v,total])=><div key={k} className={'flex justify-between gap-3 '+(total?'border-t border-line pt-1 font-semibold text-ink':'text-muted')}><dt>{k}</dt><dd className="tabular-nums">{money(v,currency)}</dd></div>)}</dl>
  <p className="mt-2 text-[11px] text-muted">Reference calculation from the current Compensation & Benefits rates. Not a payroll run.</p>
 </div>;
}

type EditState={index:number;grade:Grade};
export default function HrJobGrades(){
 const [entityId,setEntityId]=useState('');
 const [data,setData]=useState<Loaded|null>(null);
 const [grades,setGrades]=useState<Grade[]>([]);
 const [baseline,setBaseline]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [tab,setTab]=useState<'grades'|'approvals'>('grades');
 const [edit,setEdit]=useState<EditState|null>(null);
 const [submitOpen,setSubmitOpen]=useState(false);
 const [refresh,setRefresh]=useState(0);
 const {ask,sheet}=useConfirm();

 const load=useCallback(async(id:string)=>{
  setLoading(true);setError('');
  try{
   const r=await callBackend<Loaded>('/api/org/hr/job-grades/get',{legalEntityId:id});
   setData(r);setEntityId(r.entity?.id||'');
   const g=r.draft?.grades||[];setGrades(g);setBaseline(JSON.stringify(g));
  }catch(e){setError(messageOf(e,'Job grades could not be loaded.'))}
  finally{setLoading(false)}
 },[]);
 useEffect(()=>{void load('')},[load]);

 const currency=data?.entity?.currency||'';
 const financial=!!data?.financial,canManage=!!data?.canManage;
 const dirty=JSON.stringify(grades)!==baseline;
 const rolesUsing=useMemo(()=>{const roles:Record<string,RoleRef[]>=data?.roles||{};return new Map<string,number>(Object.entries(roles).map(([k,v])=>[k,v.length] as [string,number]))},[data]);
 const draftProblems=useMemo(()=>draftIssues(grades),[grades]);
 const submitProblems=useMemo(()=>financial?activationProblems(grades,currency,rolesUsing):[],[grades,currency,rolesUsing,financial]);
 const pending=data?.pendingRequestId||'';
 useEffect(()=>{
  if(!dirty)return;
  const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[dirty]);

 const save=async()=>{
  if(!data?.entity||!data.draft)return;
  setBusy(true);setError('');setNotice('');
  try{
   const r=await callBackend<{version:number}>('/api/org/hr/job-grades/save',{legalEntityId:data.entity.id,expectedVersion:data.draft.version,grades});
   await load(data.entity.id);setNotice('Draft saved as version '+r.version+'. It does not affect anyone until it is approved.');
  }catch(e){setError(messageOf(e,'Could not save the draft.'))}
  finally{setBusy(false)}
 };
 const addGrade=()=>{
  if(!data?.catalogue)return;
  setEdit({index:-1,grade:{code:'',rank:Math.max(0,...grades.map(g=>g.rank))+1,title:'',description:'',enabled:true,minSalary:null,
   taxCodes:[...data.catalogue.forcedTaxes],deductionCodes:[...data.catalogue.forcedDeductions]}});
 };
 const columns:Column<Grade>[]=useMemo(()=>{
  const name=(items:CatalogueItem[]|undefined,codes:string[])=>codes.map(c=>items?.find(i=>i.code===c)?.name||c).join(', ');
  const cols:Column<Grade>[]=[
   {key:'rank',label:'Grade',type:'number',value:g=>g.rank,className:'min-w-[5rem]',render:g=><span className="text-base font-bold text-ink">{g.rank}</span>},
   {key:'title',label:'Job grade',value:g=>g.title,className:'min-w-[13rem]',render:g=><span className="block py-1"><span className="block text-sm font-semibold text-ink">{g.title||'Untitled'}</span><span className="block font-mono text-[11px] text-muted">{g.code||'Code assigned on save'}</span></span>},
   {key:'status',label:'Status',value:g=>g.enabled?'Enabled':'Disabled',render:g=><span className={'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold '+(g.enabled?'bg-emerald-500/15 text-emerald-500':'bg-amber-500/15 text-amber-500')}>{g.enabled?'Enabled':'Disabled'}</span>},
  ];
  if(financial)cols.push(
   {key:'minSalary',label:'Minimum monthly salary',type:'number',value:g=>g.minSalary,className:'min-w-[10rem]',render:g=><span className={'tabular-nums '+((g.minSalary??0)>0?'font-semibold text-ink':'text-amber-500')}>{(g.minSalary??0)>0?money(g.minSalary):'Not set'}</span>},
   {key:'currency',label:'Currency',value:()=>currency,hidden:true},
   {key:'taxes',label:'Taxes',value:g=>name(data?.catalogue?.taxes,g.taxCodes),className:'min-w-[12rem]'},
   {key:'deductions',label:'Deductions',value:g=>name(data?.catalogue?.deductions,g.deductionCodes),className:'min-w-[12rem]'},
  );
  cols.push({key:'roles',label:'Job roles',type:'number',value:g=>rolesUsing.get(g.code)||0},
   {key:'description',label:'Description',value:g=>g.description,hidden:true});
  return cols;
 },[financial,currency,data?.catalogue,rolesUsing]);

 const apply=(g:Grade)=>{
  if(!edit)return;
  setGrades(list=>edit.index<0?[...list,g]:list.map((x,i)=>i===edit.index?g:x));
  setEdit(null);setNotice('Change applied to the draft. Save the draft to keep it.');
 };
 const removeNew=()=>{
  if(!edit||edit.index<0)return;
  setGrades(list=>list.filter((_,i)=>i!==edit.index));setEdit(null);
 };

 const entityPicker=data&&data.entities.length>1?<SelectField id="grade-entity" label="Legal entity" hideLabel value={entityId} disabled={busy||loading||dirty}
  hint={dirty?'Save or discard your changes before switching legal entity.':undefined}
  onChange={e=>void load(e.target.value)}>
  {data.entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</SelectField>:null;
 const discard=()=>ask({title:'Discard unsaved changes?',tone:'danger',confirmLabel:'Discard changes',
  message:'Your edits since the last saved draft are lost. The saved draft and the active grades are not affected.'},
  async()=>{setGrades(JSON.parse(baseline) as Grade[]);setNotice('Unsaved changes discarded.')});

 return <div className="flex h-full min-h-0 flex-col">
  {sheet}
  <div className="shrink-0 space-y-2 border-b border-line bg-page pb-3">
   <div className="flex items-center gap-2">
    <div className="min-w-0 flex-1">
     <h2 className="flex items-center gap-2 truncate text-base font-semibold text-ink"><BriefcaseBusiness className="h-5 w-5 shrink-0 text-brand"/>Job grades{data?.entity?' · '+data.entity.name:''}</h2>
     <p className="truncate text-xs text-muted">{!data?.draft?'':dirty?'Unsaved changes':data.draft.saved?'Draft v'+data.draft.version+' saved':'Starting from the current grade list'}{data?.active?' · Active v'+data.active.version:' · Nothing approved yet'}{pending?' · Awaiting approval '+pending:''}</p>
    </div>
    {canManage&&data?.draft&&<div className="flex shrink-0 items-center gap-2">
     <button type="button" className={btn} onClick={addGrade} disabled={busy||loading} aria-label="Add a job grade"><Plus className="h-4 w-4"/><span className="hidden sm:inline">Add grade</span></button>
     <button type="button" className={btn} onClick={()=>void save()} disabled={busy||loading||(!dirty&&data.draft.saved)||draftProblems.length>0} aria-label="Save draft"><Save className="h-4 w-4"/><span className="hidden sm:inline">Save draft</span></button>
     <button type="button" className={primary} onClick={()=>setSubmitOpen(true)} disabled={busy||loading||dirty||!data.draft.saved||!!pending||submitProblems.length>0||!data.changedSinceActive} aria-label="Submit for approval"><ShieldCheck className="h-4 w-4"/><span className="hidden sm:inline">Submit</span></button>
    </div>}
   </div>
   {entityPicker}
   {dirty&&canManage&&<button type="button" className="text-xs font-semibold text-danger underline" onClick={discard}>Discard unsaved changes</button>}
   {data?.entity&&(financial||data.canApprove)&&<Segmented label="Job grades view" value={tab} onChange={setTab} options={[{value:'grades',label:'Grades',count:grades.length},{value:'approvals',label:'Approvals'}]}/>}
  </div>

  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3">
   {error&&<p role="alert" className="rounded-xl border border-line bg-danger/10 p-3 text-sm text-danger">{error}</p>}
   {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
   {loading&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">Loading job grades…</p>}
   {!loading&&data&&!data.entity&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">Create a legal entity under Organization design before configuring job grades.</p>}
   {!loading&&data?.entity&&tab==='grades'&&<>
    <section className="rounded-2xl border border-line bg-panel p-3 text-xs text-muted">
     A job grade is an employment band for {data.entity.name}. Grades are allocated to job roles in Organization → Job roles, where each role also gets its minimum level of education.
     {financial?' Taxes and deductions come from Compensation & Benefits; those required by law apply to every grade. Changes are drafted here and only take effect once approved under the Chart of Authority.':' Pay details are visible to job grade maintainers and approvers only.'}
    </section>
    {!canManage&&financial&&<p className="rounded-xl bg-panel p-3 text-xs text-muted">You can review grades. Preparing changes needs the HR – Job Grade Maintainer role.</p>}
    {draftProblems.length>0&&canManage&&<section role="alert" className="rounded-xl border border-line bg-amber-500/10 p-3 text-sm"><p className="font-semibold text-ink">Fix {draftProblems.length} item{draftProblems.length===1?'':'s'} before saving</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-soft">{draftProblems.slice(0,6).map(x=><li key={x}>{x}</li>)}</ul></section>}
    {financial&&canManage&&!dirty&&data.draft&&!data.draft.saved&&<p className="rounded-xl bg-panel p-3 text-xs text-muted">This is the current grade list, not yet saved as a draft. Review it, then save the draft to prepare it for approval.</p>}
    {financial&&canManage&&!dirty&&data.draft?.saved&&!pending&&submitProblems.length>0&&<details className="rounded-xl border border-line bg-panel p-3 text-sm"><summary className="cursor-pointer font-semibold text-ink">{submitProblems.length} thing{submitProblems.length===1?'':'s'} to finish before this can be submitted for approval</summary><ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-soft">{submitProblems.slice(0,10).map(x=><li key={x}>{x}</li>)}</ul></details>}
    <RichTable id="hr-job-grades-v1" title="Job grades" fileName={'Job_grades_'+(data.entity.name||'').replace(/\W+/g,'_')} columns={columns} rows={grades.slice().sort((a,b)=>a.rank-b.rank)} rowKey={key}
     onRowClick={g=>setEdit({index:grades.indexOf(g),grade:{...g,taxCodes:[...g.taxCodes],deductionCodes:[...g.deductionCodes]}})}
     allowExport={financial} height="h-[calc(100dvh-24rem)] min-h-[320px]" empty="No job grades yet."/>
   </>}
   {!loading&&data?.entity&&tab==='approvals'&&<HrJobGradeApprovals legalEntityId={data.entity.id} refreshKey={refresh} onChanged={()=>{setRefresh(k=>k+1);void load(data.entity!.id)}}/>}
   {!loading&&data?.active&&tab==='grades'&&<p className="flex items-center gap-2 text-xs text-muted"><BadgeCheck className="h-4 w-4 shrink-0 text-brand"/>Active version {data.active.version} was approved under {data.active.approvalRef} on {data.active.activatedAt.slice(0,10)}.</p>}
  </div>

  {edit&&data?.entity&&data.catalogue&&<GradeSheet edit={edit} others={grades.filter((_,i)=>i!==edit.index)} data={data} currency={currency} canManage={canManage}
   roles={data.roles?.[edit.grade.code]||[]} onClose={()=>setEdit(null)} onApply={apply} onRemove={edit.index>=0&&!edit.grade.code?removeNew:edit.index<0?()=>setEdit(null):undefined}/>}
  {submitOpen&&data?.entity&&data.draft&&<SubmitSheet currency={currency} entityName={data.entity.name} onClose={()=>setSubmitOpen(false)}
   onSubmit={async(cost,reason)=>{
    await callBackend('/api/org/hr/job-grades/submit',{legalEntityId:data.entity!.id,expectedVersion:data.draft!.version,annualCostImpact:cost,reason,acknowledge:true});
    setSubmitOpen(false);setNotice('Submitted for approval. Nothing changes until every Chart of Authority level approves.');setTab('approvals');setRefresh(k=>k+1);await load(data.entity!.id);
   }}/>}
 </div>;
}

function GradeSheet({edit,others,data,currency,canManage,roles,onClose,onApply,onRemove}:{edit:EditState;others:Grade[];data:Loaded;currency:string;canManage:boolean;roles:RoleRef[];onClose:()=>void;onApply:(g:Grade)=>void;onRemove?:()=>void}){
 const [g,setG]=useState<Grade>(edit.grade);
 const [salary,setSalary]=useState(edit.grade.minSalary===null?'':String(edit.grade.minSalary));
 const [touched,setTouched]=useState(false);
 const cat=data.catalogue!;
 const current:Grade={...g,minSalary:salary.trim()===''?null:Number(salary)};
 const dupRank=others.some(o=>o.rank===current.rank);
 const dupTitle=current.title.trim()!==''&&others.some(o=>o.title.trim().toLowerCase()===current.title.trim().toLowerCase());
 const issues=[...draftIssues([current]),
  ...(dupRank?['Grade number '+current.rank+' is already used by another grade.']:[]),
  ...(dupTitle?['Another grade already has the title "'+current.title.trim()+'".']:[])];
 const salaryBad=salary.trim()!==''&&(!Number.isFinite(Number(salary))||Number(salary)<0||Math.abs(Number(salary)*100-Math.round(Number(salary)*100))>1e-6);
 const set=(patch:Partial<Grade>)=>{setTouched(true);setG(x=>({...x,...patch}))};
 const ro=!canManage;
 return <Sheet title={edit.index<0?'New job grade':'Grade '+edit.grade.rank+' · '+(edit.grade.title||'Untitled')} onClose={onClose}
  footer={ro?<button type="button" className={btn+' flex-1'} onClick={onClose}>Close</button>:<>
   {onRemove&&<button type="button" className={btn} onClick={onRemove} aria-label="Remove this new grade"><Trash2 className="h-4 w-4"/></button>}
   <button type="button" className={primary+' flex-1'} disabled={issues.length>0||salaryBad} onClick={()=>{setTouched(true);if(!issues.length&&!salaryBad)onApply({...current,title:current.title.trim(),description:current.description.trim()})}}>Apply to draft</button>
  </>}>
  {edit.grade.code&&<p className="font-mono text-xs text-muted">{edit.grade.code}</p>}
  <label className="block text-sm font-medium text-ink">Job grade title
   <input className={field+' mt-1'} value={g.title} maxLength={150} disabled={ro} onChange={e=>set({title:e.target.value})} onBlur={()=>setTouched(true)} aria-invalid={touched&&g.title.trim().length<2}/></label>
  <label className="block text-sm font-medium text-ink">Grade number
   <input className={field+' mt-1'} type="number" inputMode="numeric" min={1} max={9999} value={Number.isFinite(g.rank)?g.rank:''} disabled={ro} onChange={e=>set({rank:Number(e.target.value)})}/>
   <span className="mt-1 block text-xs font-normal text-muted">A higher number is a more senior grade. Each number is used once.</span></label>
  <label className="block text-sm font-medium text-ink">Description (optional)
   <input className={field+' mt-1'} value={g.description} maxLength={350} disabled={ro} onChange={e=>set({description:e.target.value})}/></label>
  <label className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3 text-sm">
   <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={g.enabled} disabled={ro} onChange={e=>set({enabled:e.target.checked})}/>
   <span><span className="font-medium text-ink">Enabled</span><span className="block text-xs text-muted">A disabled grade can no longer be given to roles.</span></span></label>
  {!g.enabled&&roles.length>0&&<p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-600">{roles.length} job role{roles.length===1?' uses':'s use'} this grade. Move them to another grade before submitting for approval.</p>}
  <label className="block text-sm font-medium text-ink">Minimum monthly salary ({currency})
   <input className={field+' mt-1'} type="number" inputMode="decimal" min={0} step="0.01" value={salary} disabled={ro} onChange={e=>{setTouched(true);setSalary(e.target.value)}} onBlur={()=>setTouched(true)} aria-invalid={salaryBad}/>
   <span className="mt-1 block text-xs font-normal text-muted">Basic pay before allowances. Required before the grade can be approved, and it must not fall as the grade number rises.</span></label>
  {data.payConfig&&current.minSalary&&current.minSalary>0&&!salaryBad?<TakeHome gross={current.minSalary} config={data.payConfig} currency={currency}/>:null}
  <CodePicker title="Taxes that apply" hint="Chosen from this legal entity's Compensation & Benefits." items={cat.taxes} forced={cat.forcedTaxes} value={g.taxCodes} disabled={ro} onChange={v=>set({taxCodes:v})}/>
  <CodePicker title="Deductions that apply" hint="Statutory deductions are required; add any other deduction this grade carries." items={cat.deductions} forced={cat.forcedDeductions} value={g.deductionCodes} disabled={ro} onChange={v=>set({deductionCodes:v})}/>
  <section className="space-y-1 rounded-xl border border-line p-3">
   <p className="text-sm font-semibold text-ink">Job roles on this grade ({roles.length})</p>
   {roles.length?<ul className="space-y-1 text-xs text-muted">{roles.map(r=><li key={r.code}><span className="font-mono">{r.code}</span> · {r.title}</li>)}</ul>:<p className="text-xs text-muted">No role is allocated to this grade in this legal entity.</p>}
   <button type="button" className="text-xs font-semibold text-brand underline" onClick={()=>navigate('organization_admin/positions')}>Allocate roles to grades (Organization → Job roles)</button>
  </section>
  {touched&&issues.length>0&&<ul role="alert" className="list-disc space-y-0.5 rounded-xl bg-danger/10 p-3 pl-7 text-xs text-danger">{issues.slice(0,5).map(x=><li key={x}>{x}</li>)}</ul>}
 </Sheet>;
}

function SubmitSheet({currency,entityName,onClose,onSubmit}:{currency:string;entityName:string;onClose:()=>void;onSubmit:(cost:number,reason:string)=>Promise<void>}){
 const [cost,setCost]=useState(''),[reason,setReason]=useState(''),[ack,setAck]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const costOk=cost.trim()!==''&&Number.isFinite(Number(cost))&&Number(cost)>=0;
 const ok=costOk&&reason.trim().length>=10&&ack;
 return <Sheet title="Submit job grades for approval" onClose={busy?()=>undefined:onClose}
  footer={<><button type="button" className={btn} onClick={onClose} disabled={busy}>Cancel</button>
   <button type="button" className={primary+' flex-1'} disabled={!ok||busy} onClick={async()=>{setBusy(true);setError('');try{await onSubmit(Number(cost),reason.trim())}catch(e){setError(messageOf(e,'Could not submit.'));setBusy(false)}}}>
    <ShieldCheck className="h-4 w-4"/>{busy?'Submitting…':'Submit for approval'}</button></>}>
  <p className="text-sm text-muted">The saved draft for {entityName} goes to the approvers set by the Chart of Authority for the cost below. You cannot approve it yourself.</p>
  <label className="block text-sm font-medium text-ink">Estimated annual cost impact ({currency})
   <input className={field+' mt-1'} type="number" inputMode="decimal" min={0} value={cost} onChange={e=>setCost(e.target.value)} aria-invalid={cost!==''&&!costOk}/>
   <span className="mt-1 block text-xs font-normal text-muted">The extra yearly payroll cost of these minimum salaries. Enter 0 if there is none. A higher amount needs a higher approval level.</span></label>
  <label className="block text-sm font-medium text-ink">Reason for the change
   <textarea className={field+' mt-1 min-h-24 py-2'} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/>
   <span className="text-xs font-normal text-muted">{reason.trim().length}/10 characters minimum</span></label>
  <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-emerald-500" checked={ack} onChange={e=>setAck(e.target.checked)}/>
   <span>I have reviewed the grades, minimum salaries, taxes and deductions and the cost estimate is reasonable.</span></label>
  {error&&<p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
 </Sheet>;
}
