import {useEffect,useMemo,useRef,useState} from 'react';
import {Banknote,MoreVertical,Pencil,Search} from 'lucide-react';
import Sheet from '../components/Sheet';
import {buildXlsx,downloadBlob} from '../lib/xlsx';
import {flush,track} from '../lib/audit';
import type {Catalogue,Grade} from './hrGradeTypes';
import {EXPORT_HEADER,exportRows,gradeFacts,money,type RoleRef} from './hrGradeFacts';

/** The grade list on HR → Job Grades: one card per grade, the extra detail behind each card's menu button. */
export const menuRow='flex min-h-12 w-full items-center gap-3 rounded-xl border border-line px-3 text-left text-sm font-semibold text-ink disabled:opacity-40';

/** Excel copy of the list as it is on screen. Values are written as text or numbers, never formulas. The export is audited. */
export function exportGrades(grades:Grade[],cat:Catalogue|null|undefined,currency:string,entityName:string,roles:Record<string,RoleRef[]>){
 const data=exportRows(grades,cat,currency,roles);
 const stamp=new Date().toISOString().slice(0,10);
 downloadBlob(buildXlsx('Job grades',EXPORT_HEADER,data),'Job_grades_'+entityName.replace(/[^A-Za-z0-9_-]+/g,'_')+'_'+stamp+'.xlsx');
 track('export','table.export','hr-job-grades','Job grades','rows='+data.length+' columns='+EXPORT_HEADER.length);
 void flush();
}

const PAGE=20;
const SEARCH_FROM=6;
/** Cards sorted by grade number. Rendered in pages as the list is scrolled, so a long list stays light. */
export function GradeCards({grades,financial,currency,canManage,onOpen,onMore}:{grades:Grade[];financial:boolean;currency:string;canManage:boolean;onOpen:(g:Grade)=>void;onMore:(g:Grade)=>void}){
 const [query,setQuery]=useState('');
 const [limit,setLimit]=useState(PAGE);
 const end=useRef<HTMLLIElement>(null);
 const rows=useMemo(()=>{
  const q=query.trim().toLowerCase();
  const sorted=grades.slice().sort((a,b)=>a.rank-b.rank);
  return q?sorted.filter(g=>[String(g.rank),g.title,g.code,g.description].some(v=>v.toLowerCase().includes(q))):sorted;
 },[grades,query]);
 useEffect(()=>setLimit(PAGE),[query]);
 useEffect(()=>{
  const el=end.current;
  if(!el||limit>=rows.length)return;
  if(typeof IntersectionObserver==='undefined'){setLimit(rows.length);return;}
  const watch=new IntersectionObserver(seen=>{if(seen.some(s=>s.isIntersecting))setLimit(n=>n+PAGE)},{rootMargin:'240px'});
  watch.observe(el);
  return()=>watch.disconnect();
 },[limit,rows.length]);
 const shown=rows.slice(0,limit);
 return <div className="space-y-3">
  {grades.length>SEARCH_FROM&&<label className="relative block">
   <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"/>
   <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search grades" aria-label="Search job grades"
    className="min-h-12 w-full min-w-0 rounded-xl border border-line bg-page pl-10 pr-3 text-base text-ink"/>
  </label>}
  {!rows.length&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">{query.trim()?'No grade matches "'+query.trim()+'".':canManage?'No job grades yet. Tap + to add one.':'No job grades yet.'}</p>}
  <ul className="space-y-2">
   {shown.map(g=>{
    const salaryOk=(g.minSalary??0)>0;
    return <li key={g.code||'new-'+g.rank} className="flex items-stretch overflow-hidden rounded-2xl border border-line bg-panel">
     <button type="button" onClick={()=>onOpen(g)} aria-label={'Open grade '+g.rank+', '+(g.title||'untitled')}
      className="flex min-h-[4.5rem] min-w-0 flex-1 items-center gap-3 p-3 text-left active:bg-page">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-lg font-bold tabular-nums text-brand">{g.rank}</span>
      <span className="min-w-0 flex-1">
       <span className="block truncate text-base font-semibold text-ink">{g.title||'Untitled'}</span>
       <span className="block truncate font-mono text-[11px] text-muted">{g.code||'Code assigned on save'}</span>
       {financial&&<span className={'mt-0.5 block truncate text-sm tabular-nums '+(salaryOk?'text-ink':'text-amber-600')}>{salaryOk?money(g.minSalary,currency)+' a month':'Minimum salary not set'}</span>}
      </span>
      {!g.enabled&&<span className="shrink-0 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-600">Disabled</span>}
     </button>
     <button type="button" onClick={()=>onMore(g)} aria-label={'More about grade '+g.rank} aria-haspopup="dialog"
      className="flex w-12 shrink-0 items-center justify-center border-l border-line text-ink active:bg-page"><MoreVertical className="h-5 w-5"/></button>
    </li>;
   })}
   {shown.length<rows.length&&<li ref={end} className="py-3 text-center text-xs text-muted" aria-live="polite">Loading more grades…</li>}
  </ul>
 </div>;
}

/** The menu behind a card's button: the detail the card leaves out, and what can be done with the grade. */
export function GradeMenu({grade,cat,financial,currency,roles,canManage,onClose,onOpen,onPayslip}:{grade:Grade;cat:Catalogue|null|undefined;financial:boolean;currency:string;roles:RoleRef[];canManage:boolean;onClose:()=>void;onOpen:()=>void;onPayslip:()=>void}){
 const facts=gradeFacts(grade,cat,financial,currency,roles);
 return <Sheet title={'Grade '+grade.rank+' · '+(grade.title||'Untitled')} onClose={onClose}>
  {grade.code&&<p className="font-mono text-xs text-muted">{grade.code}</p>}
  <dl className="divide-y divide-line rounded-xl border border-line">
   {facts.map(f=><div key={f.label} className="px-3 py-2">
    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{f.label}</dt>
    <dd className={'break-words text-sm '+(f.warn?'font-semibold text-amber-600':'text-ink')}>{f.value}</dd>
   </div>)}
  </dl>
  <div className="space-y-2">
   <button type="button" className={menuRow} onClick={onOpen}><Pencil className="h-5 w-5 text-brand"/>{canManage?'Open and edit grade':'Open grade'}</button>
   {financial&&cat&&<button type="button" className={menuRow} onClick={onPayslip}><Banknote className="h-5 w-5 text-brand"/>Preview a payslip</button>}
  </div>
 </Sheet>;
}
