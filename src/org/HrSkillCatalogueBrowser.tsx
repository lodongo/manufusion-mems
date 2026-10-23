import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, BookOpenText, CheckCircle2, ChevronRight, CircleOff, FolderTree, Pencil, Search, X } from 'lucide-react';
import { SelectField } from '../components/ui';
import { browseSkills, skillCategories, skillSubcategories, type BrowseSkill } from './hrSkillBrowse';

const PAGE_SIZE = 36;
const button='min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink';
export default function HrSkillCatalogueBrowser({
 skills, canManage, onEdit,
}: {skills:BrowseSkill[];canManage:boolean;onEdit:(skill:BrowseSkill)=>void}){
 const [category,setCategory]=useState('');
 const [subcategory,setSubcategory]=useState('');
 const [search,setSearch]=useState('');
 const [showAll,setShowAll]=useState(false);
 const [limit,setLimit]=useState(PAGE_SIZE);
 const [detailCode,setDetailCode]=useState('');
 const categories=useMemo(()=>skillCategories(skills),[skills]);
 const subcategories=useMemo(()=>skillSubcategories(skills,category),[skills,category]);
 const matches=useMemo(()=>browseSkills(skills,category,subcategory,search),[skills,category,subcategory,search]);
 const detail=useMemo(()=>skills.find(s=>s.code===detailCode),[skills,detailCode]);
 const listing=Boolean(category||search.trim()||showAll);
 const shown=listing?matches.slice(0,limit):[];
 const setCategoryAndReset=(value:string)=>{setCategory(value);setSubcategory('');setLimit(PAGE_SIZE);setShowAll(!!value)};
 const setSubcategoryAndReset=(value:string)=>{setSubcategory(value);setLimit(PAGE_SIZE)};
 useEffect(()=>{setLimit(PAGE_SIZE)},[search]);
 useEffect(()=>{
  if(!detail)return;
  const old=document.body.style.overflow;
  document.body.style.overflow='hidden';
  const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setDetailCode('')};
  document.addEventListener('keydown',close);
  return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',close)};
 },[detail]);
 const reset=()=>{setCategory('');setSubcategory('');setSearch('');setShowAll(false);setLimit(PAGE_SIZE)};
 return <div className="min-w-0 space-y-3">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <div className="min-w-0">
    <h3 className="text-base font-bold">Browse skills</h3>
    <p className="text-xs text-muted">{skills.length.toLocaleString()} skills · {categories.length} categories</p>
   </div>
   {listing&&<button type="button" onClick={reset} className={button}><ArrowLeft className="mr-1 inline h-4 w-4"/>All categories</button>}
  </div>

  <label className="relative block">
   <span className="sr-only">Search skill name, code or description</span>
   <Search className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-muted"/>
   <input type="search" value={search} onChange={e=>setSearch(e.target.value)}
    placeholder="Search name, code or description" autoComplete="off"
    className="min-h-12 w-full rounded-xl border border-line bg-page py-2 pl-10 pr-3 text-base text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand"/>
  </label>

  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
   <SelectField id="hr-skills-category" label="Category" value={category} onChange={e=>setCategoryAndReset(e.target.value)}>
    <option value="">All categories</option>
    {categories.map(x=><option key={x.name} value={x.name}>{x.name} ({x.count})</option>)}
   </SelectField>
   <SelectField id="hr-skills-subcategory" label="Subcategory" value={subcategory}
    disabled={!category} onChange={e=>setSubcategoryAndReset(e.target.value)}>
    <option value="">All subcategories</option>
    {subcategories.map(x=><option key={x.name} value={x.name}>{x.name} ({x.count})</option>)}
   </SelectField>
  </div>

  {!listing&&<>
   <div className="flex items-center justify-between gap-2">
    <h4 className="text-sm font-semibold">Select a category</h4>
    <button type="button" onClick={()=>{setShowAll(true);setLimit(PAGE_SIZE)}} className="min-h-11 text-sm font-semibold text-brand">View all skills <ChevronRight className="inline h-4 w-4"/></button>
   </div>
   <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
    {categories.map(x=><button key={x.name} type="button" onClick={()=>setCategoryAndReset(x.name)}
     className="flex min-h-16 min-w-0 items-center gap-3 rounded-xl border border-line bg-page p-3 text-left transition hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"><FolderTree className="h-5 w-5"/></span>
      <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold text-ink">{x.name}</span><span className="mt-1 block text-xs text-muted">{x.count.toLocaleString()} skills</span></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted"/>
     </button>)}
   </div>
  </>}

  {listing&&<>
   {category&&subcategories.length>1&&!subcategory&&<section aria-label="Skill subcategories" className="space-y-2">
    <h4 className="text-sm font-semibold">Subcategories in {category}</h4>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
     {subcategories.map(x=><button key={x.name} type="button" onClick={()=>setSubcategoryAndReset(x.name)}
      className="flex min-h-12 min-w-0 items-center gap-2 rounded-xl border border-line bg-page px-3 text-left text-sm hover:border-brand">
      <FolderTree className="h-4 w-4 shrink-0 text-brand"/><span className="min-w-0 flex-1 break-words">{x.name}</span><span className="shrink-0 text-xs text-muted">{x.count}</span><ChevronRight className="h-4 w-4 shrink-0 text-muted"/>
     </button>)}
    </div>
   </section>}
   <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
    <p className="min-w-0 text-xs text-muted"><strong className="text-ink">{matches.length.toLocaleString()}</strong> matching skills
     {category?' · '+category:''}{subcategory?' / '+subcategory:''}</p>
    {subcategory&&<button type="button" className="min-h-10 text-sm text-brand" onClick={()=>setSubcategoryAndReset('')}>All subcategories</button>}
   </div>
   {matches.length===0&&<p className="rounded-xl border border-dashed border-line bg-page p-4 text-sm text-muted">No skills match these selections. Try another category or search term.</p>}
   <div className="grid min-w-0 gap-2 xl:grid-cols-2">
    {shown.map(skill=><button key={skill.code} type="button" onClick={()=>setDetailCode(skill.code)}
     aria-label={`View ${skill.name}, code ${skill.code}`}
     className="min-w-0 rounded-xl border border-line bg-panel p-3 text-left transition hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
     <div className="flex min-w-0 items-start justify-between gap-2">
      <div className="min-w-0 flex-1"><h4 className="break-words text-sm font-bold text-ink">{skill.name}</h4>
       <p className="mt-1 break-all font-mono text-xs font-semibold text-brand">{skill.code}</p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted"/>
     </div>
     <p className="mt-2 line-clamp-2 break-words text-xs leading-relaxed text-soft">{skill.description?.trim()||'No description recorded'}</p>
     <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
      <span>{skill.category||'Uncategorized'}</span><span>·</span><span>{skill.subcategory||'Uncategorized'}</span>
      {!skill.enabled&&<span className="rounded-lg border border-line px-2 py-0.5">Disabled</span>}
     </div>
    </button>)}
   </div>
   {matches.length>limit&&<button type="button" onClick={()=>setLimit(n=>n+PAGE_SIZE)}
    className="min-h-12 w-full rounded-xl border border-line bg-panel text-sm font-semibold text-brand">
    Show more skills ({Math.min(matches.length-limit,PAGE_SIZE)} more)
   </button>}
   {matches.length>0&&<p className="text-center text-xs text-muted">Showing {Math.min(matches.length,limit).toLocaleString()} of {matches.length.toLocaleString()}</p>}
  </>}

  {detail&&createPortal(<div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-5">
   <button type="button" className="absolute inset-0 cursor-default" onClick={()=>setDetailCode('')} aria-label="Close skill detail"/>
   <section role="dialog" aria-modal="true" aria-labelledby="hr-skill-detail-title"
    className="relative z-10 flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-line bg-panel text-ink shadow-2xl sm:rounded-2xl">
    <header className="flex shrink-0 items-center gap-3 border-b border-line p-4">
     <BookOpenText className="h-6 w-6 shrink-0 text-brand"/>
     <h3 id="hr-skill-detail-title" className="min-w-0 flex-1 text-base font-bold">Skill details</h3>
     <button type="button" onClick={()=>setDetailCode('')} aria-label="Close skill details" className="flex h-11 w-11 items-center justify-center rounded-xl border border-line"><X className="h-5 w-5"/></button>
    </header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
     <h4 className="break-words text-lg font-bold">{detail.name}</h4>
     <div className="grid gap-2 sm:grid-cols-2">
      {([['Skill code',detail.code],['Category',detail.category||'Uncategorized'],['Subcategory',detail.subcategory||'Uncategorized']] as const).map(([label,value])=>
       <div key={label} className="min-w-0 rounded-xl border border-line bg-page p-3"><p className="text-xs text-muted">{label}</p><p className={`mt-1 break-words text-sm font-semibold ${label==='Skill code'?'font-mono text-brand':'text-ink'}`}>{value}</p></div>)}
      <div className="rounded-xl border border-line bg-page p-3"><p className="text-xs text-muted">Status</p>
       <p className="mt-1 flex items-center gap-2 text-sm font-semibold">{detail.enabled?<CheckCircle2 className="h-4 w-4 text-emerald-500"/>:<CircleOff className="h-4 w-4 text-muted"/>}{detail.enabled?'Enabled':'Disabled'}</p>
      </div>
     </div>
     <div className="rounded-xl border border-line bg-page p-3"><p className="mb-2 text-xs font-medium text-muted">Description</p>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{detail.description?.trim()||'No description recorded for this skill.'}</p>
     </div>
    </div>
    <footer className="flex shrink-0 gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
     <button type="button" onClick={()=>setDetailCode('')} className="min-h-12 flex-1 rounded-xl border border-line font-semibold">Back to skills</button>
     {canManage&&<button type="button" onClick={()=>{setDetailCode('');onEdit(detail)}}
      className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-3 font-semibold text-onbrand"><Pencil className="h-4 w-4"/>Edit skill</button>}
    </footer>
   </section>
  </div>,document.body)}
 </div>;
}
