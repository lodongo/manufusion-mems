import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Check,ChevronRight,Download,MoreVertical} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {messageOf} from '../components/screen';
import Sheet from '../components/Sheet';
import {buildXlsx,downloadBlob} from '../lib/xlsx';
import {flush,track} from '../lib/audit';
import type {PayslipItem} from '../shared/hrPayslip';
import HrPayrollPerson,{type PaySummary} from './HrPayrollPerson';
import {menuRow} from './HrGradeCards';
import {EXPORT_HEADER,countsOf,exportTable,initials,matches,type Emp,type FilterMode,type PayGrade} from './hrPayrollView';

type Loaded={
 entities:Array<{id:string;name:string}>;entity:{id:string;name:string;countryCode:string;currency:string}|null;canManage:boolean;selfUid?:string;
 version?:number;updatedAt?:string;
 source?:{grades:'approved'|'draft';gradesVersion:number;policy:'approved'|'draft';policyVersion:number};
 items?:PayslipItem[];grades?:PayGrade[];employees?:Emp[];
 unplaced?:Array<{uid:string;name:string;employeeNumber:string;reason:'no_entity'|'several_entities'}>;unplacedCount?:number;
};
const btn='flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
const PAGE=20;
const SHOW:Array<[FilterMode,string]>=[['all','All employees'],['below','Salary below the grade minimum'],['none','No salary entered yet'],['attention','Role or grade needs attention'],['details','Bank details or pay items need attention']];
const BANK={none:'No bank details',pending:'Bank details awaiting verification',verified:'Bank details verified'} as const;
const REASON={no_entity:'No primary legal entity',several_entities:'Primary deployments in several legal entities'};

/** One employee: who they are, their role and grade, and what is missing. No salary or pay figure is shown here: those are inside the opened employee. */
function PayrollCard({emp,onOpen}:{emp:Emp;onOpen:()=>void}){
 const waiting=(emp.payBank||'none')!=='verified'||!!emp.payPending;
 return <li className="overflow-hidden rounded-2xl border border-line bg-panel">
  <button type="button" onClick={onOpen} aria-label={'Open payslip for '+emp.name} className="flex min-h-[4.5rem] w-full items-center gap-3 p-3 text-left active:bg-page">
   <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand/15 text-sm font-bold text-brand">{initials(emp.name)}</span>
   <span className="min-w-0 flex-1">
    <span className="block truncate text-base font-semibold text-ink">{emp.name}</span>
    <span className="block truncate font-mono text-[11px] text-muted">{emp.employeeNumber||'No employee number'}{emp.status!=='active'?' · '+emp.status:''}</span>
    <span className={'block truncate text-xs '+(emp.problem?'font-semibold text-amber-600':'text-soft')}>{emp.problem?emp.problemText:emp.roleTitle+' · '+emp.gradeCode+' '+emp.gradeTitle}</span>
    <span className={'block truncate text-xs '+(waiting?'font-semibold text-amber-700':'text-muted')}>{BANK[emp.payBank||'none']}{emp.payItems?' · '+emp.payItems+' personal item'+(emp.payItems===1?'':'s'):''}{emp.payPending?' · '+emp.payPending+' awaiting verification':''}</span>
   </span>
   <ChevronRight className="h-5 w-5 shrink-0 text-muted"/>
  </button>
 </li>;
}

export default function HrPayroll(){
 const [entityId,setEntityId]=useState('');
 const [data,setData]=useState<Loaded|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [menuOpen,setMenuOpen]=useState(false);
 const [mode,setMode]=useState<FilterMode>('all');
 const [slip,setSlip]=useState<Emp|null>(null);
 const [limit,setLimit]=useState(PAGE);
 const end=useRef<HTMLLIElement>(null);

 const load=useCallback(async(id:string)=>{
  setLoading(true);setError('');
  try{
   const r=await callBackend<Loaded>('/api/org/hr/payroll/get',{legalEntityId:id});
   setData(r);setEntityId(r.entity?.id||'');
  }catch(e){setError(messageOf(e,'Payroll could not be loaded.'))}
  finally{setLoading(false)}
 },[]);
 useEffect(()=>{void load('')},[load]);

 const employees=useMemo(()=>data?.employees||[],[data]);
 const grades=useMemo(()=>data?.grades||[],[data]);
 const items=useMemo(()=>data?.items||[],[data]);
 const byGrade=useMemo(()=>new Map(grades.map(g=>[g.code,g])),[grades]);
 const currency=data?.entity?.currency||'';
 const canManage=!!data?.canManage;
 const counts=useMemo(()=>countsOf(employees),[employees]);
 const shown=useMemo(()=>employees.filter(e=>matches(e,mode)),[employees,mode]);
 useEffect(()=>setLimit(PAGE),[mode,entityId]);
 useEffect(()=>{
  const el=end.current;
  if(!el||limit>=shown.length)return;
  if(typeof IntersectionObserver==='undefined'){setLimit(shown.length);return;}
  const watch=new IntersectionObserver(seen=>{if(seen.some(s=>s.isIntersecting))setLimit(n=>n+PAGE)},{rootMargin:'240px'});
  watch.observe(el);
  return()=>watch.disconnect();
 },[limit,shown.length]);
  const setSummary=useCallback((uid:string,pay:PaySummary)=>setData(d=>d?{...d,employees:(d.employees||[]).map(e=>e.uid===uid?{...e,...pay}:e)}:d),[]);
 const editable=(e:Emp)=>canManage&&e.uid!==data?.selfUid;
 const download=()=>{
  if(!data?.entity)return;
  const rows=exportTable(employees);
  const stamp=new Date().toISOString().slice(0,10);
  downloadBlob(buildXlsx('Payroll',EXPORT_HEADER,rows),'Payroll_'+data.entity.name.replace(/[^A-Za-z0-9_-]+/g,'_')+'_'+stamp+'.xlsx');
  track('export','table.export','hr-payroll','Payroll','rows='+rows.length+' columns='+EXPORT_HEADER.length);
  void flush();
 };

 const draftSource=data?.source&&(data.source.grades==='draft'||data.source.policy==='draft');
 const attention=!!draftSource||counts.attention>0||(data?.unplacedCount||0)>0;
 const slipEmp=slip?employees.find(e=>e.uid===slip.uid)||slip:null;
 const slipGrade=slipEmp?byGrade.get(slipEmp.gradeCode):undefined;
 const status:Array<[string,string]>=data?.entity&&data.source?[
  ['Legal entity',data.entity.name],
  ['Draft salaries',data.version?'Version '+data.version+(data.updatedAt?' saved '+data.updatedAt.slice(0,10):''):'None saved yet'],
  ['Job grades used',data.source.grades==='approved'?'Approved, version '+data.source.gradesVersion:'DRAFT (not yet approved)'+(data.source.gradesVersion?', version '+data.source.gradesVersion:'')],
  ['Benefits policy used',data.source.policy==='approved'?'Approved, version '+data.source.policyVersion:'DRAFT (not yet approved)'+(data.source.policyVersion?', version '+data.source.policyVersion:'')],
  ['Employees',String(counts.all)+' on this payroll, '+(counts.all-counts.none)+' with a salary'],
 ]:[];

 return <div className="flex h-full min-h-0 flex-col">
  <div className="shrink-0 space-y-2 border-b border-line bg-page pb-3">
   <div className="flex items-center gap-2">
    <div className="min-w-0 flex-1">
     <h2 className="truncate text-base font-semibold text-ink">Payroll</h2>
     <p className="truncate text-xs text-muted">{data?.entity?.name||''}</p>
    </div>
    <div className="flex shrink-0 items-center gap-2">
     {data?.entity&&<button type="button" aria-label="Payroll menu" aria-haspopup="dialog" onClick={()=>setMenuOpen(true)} className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-line text-ink">
      <MoreVertical className="h-5 w-5"/>{attention&&<span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-amber-500"/>}</button>}
    </div>
   </div>
  </div>

  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3">
   {error&&<p role="alert" className="rounded-xl border border-line bg-danger/10 p-3 text-sm text-danger">{error}</p>}
   {loading&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">Loading payroll…</p>}
   {!loading&&data&&!data.entity&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">Create a legal entity under Organization design before using payroll.</p>}
   {!loading&&data?.entity&&<>
    {draftSource&&<p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700">Payslips use the {data.source?.grades==='draft'&&data.source?.policy==='draft'?'draft job grades and Benefits policy':data.source?.grades==='draft'?'draft job grades':'draft Benefits policy'}, which are not approved yet. They are a preview only.</p>}
    {mode!=='all'&&<p className="text-xs font-semibold text-muted">Showing: {SHOW.find(s=>s[0]===mode)?.[1]} ({shown.length})</p>}
    {!shown.length&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">{employees.length?'No employee matches this view.':'No employees are placed in this legal entity yet.'}</p>}
    <ul className="space-y-2">
     {shown.slice(0,limit).map(e=><PayrollCard key={e.uid} emp={e} onOpen={()=>setSlip(e)}/>)}
     {limit<shown.length&&<li ref={end} className="py-3 text-center text-xs text-muted" aria-live="polite">Loading more employees…</li>}
    </ul>
   </>}
  </div>

  {menuOpen&&data?.entity&&<Sheet title="Payroll" onClose={()=>setMenuOpen(false)}>
   {data.entities.length>1&&<section className="space-y-2" role="radiogroup" aria-label="Legal entity">
    <p className="text-sm font-semibold text-ink">Legal entity</p>
    {data.entities.map(e=>{const on=e.id===entityId;
     return <button key={e.id} type="button" role="radio" aria-checked={on} disabled={!on&&loading} className={menuRow+(on?' bg-brand/5':'')}
      onClick={()=>{setMenuOpen(false);if(!on)void load(e.id)}}><span className="min-w-0 flex-1 truncate">{e.name}</span>{on&&<Check className="h-5 w-5 shrink-0 text-brand"/>}</button>;})}
   </section>}
   <section className="space-y-2" role="radiogroup" aria-label="Show">
    <p className="text-sm font-semibold text-ink">Show</p>
    {SHOW.map(([value,label])=><button key={value} type="button" role="radio" aria-checked={mode===value} className={menuRow+(mode===value?' bg-brand/5':'')}
     onClick={()=>{setMenuOpen(false);setMode(value)}}><span className="min-w-0 flex-1">{label}</span><span className="shrink-0 tabular-nums text-muted">{counts[value]}</span>{mode===value&&<Check className="h-5 w-5 shrink-0 text-brand"/>}</button>)}
   </section>
   <dl className="divide-y divide-line rounded-xl border border-line">
    {status.map(([label,value])=><div key={label} className="px-3 py-2">
     <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
     <dd className="break-words text-sm text-ink">{value}</dd></div>)}
   </dl>
   {(data.unplacedCount||0)>0&&<details className="rounded-xl border border-line bg-amber-500/10 p-3 text-sm">
    <summary className="cursor-pointer font-semibold text-ink">{data.unplacedCount} employee{data.unplacedCount===1?'':'s'} not placed in any one legal entity</summary>
    <p className="mt-1 text-xs text-muted">They cannot be on a payroll until HR gives each exactly one primary legal entity.</p>
    <ul className="mt-2 space-y-1 text-xs text-soft">{(data.unplaced||[]).slice(0,20).map(u=><li key={u.uid}>{u.name}{u.employeeNumber?' ('+u.employeeNumber+')':''} · {REASON[u.reason]}</li>)}</ul>
   </details>}
   <div className="space-y-2">
    {employees.length>0&&<button type="button" className={menuRow} onClick={()=>{setMenuOpen(false);download()}}><Download className="h-5 w-5 text-brand"/>Download Excel</button>}
   </div>
   <section className="space-y-2 rounded-xl border border-line p-3 text-xs text-muted">
    <p className="text-sm font-semibold text-ink">About payroll</p>
    <p>Each employee is shown with the job role they hold and the grade that role has in {data.entity.name}. The payslip comes from that grade's pay model, allowances, benefits, taxes and deductions. Tap an employee to see it.</p>
    <p>No salary or pay figure is shown on this list. Open an employee to see their payslip and basic salary; the salary box there turns red when it is below the grade minimum. The payslip also shows the employee's bank details and their own earnings and deductions, such as check-offs and loans, entered under Pay details and verified by a second person.</p>
    <p>These are draft salaries for review: nothing is paid, posted or filed from here, and a payroll run is not built yet.</p>
    <p>{canManage?'You cannot set your own salary.':'You can review payroll. Entering salaries needs the HR – Payroll Officer role.'}</p>
   </section>
  </Sheet>}

  {slipEmp&&data?.entity&&data.source&&<Sheet title={slipEmp.name} onClose={()=>setSlip(null)} footer={<button type="button" className={btn+' flex-1'} onClick={()=>setSlip(null)}>Close</button>}>
   <p className="font-mono text-xs text-muted">{slipEmp.employeeNumber||'No employee number'} · {slipEmp.problem?slipEmp.problemText:slipEmp.roleTitle+' · '+slipEmp.gradeCode+' '+slipEmp.gradeTitle}</p>
   <HrPayrollPerson key={slipEmp.uid} emp={slipEmp} grade={slipGrade} items={items} entity={data.entity} currency={currency} source={data.source}
    canEditSalary={editable(slipEmp)} onSummary={setSummary}/>
  </Sheet>}
 </div>;
}
