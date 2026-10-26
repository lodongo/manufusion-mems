import {useEffect,useMemo,useRef,useState} from 'react';
import {
 ArrowLeft, Boxes, Building2, ChevronRight, Factory, GitBranch,
 Layers3, MapPin, Network, Search, ShieldCheck, Users, Wrench
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {
 levelLabel,structureIndex,structurePath,subtreeCount,
 type HrStructureNode
} from './hrStructureTree';

const iconFor=(level:string):LucideIcon=>{
 switch(level){
  case 'root': case 'group': case 'corporate': return Layers3;
  case 'legal_entity': case 'business_unit': return Building2;
  case 'site': return MapPin;
  case 'department': case 'division': return Users;
  case 'cost_center': return Network;
  case 'work_center': return Factory;
  case 'asset': case 'equipment': return Wrench;
  case 'assembly': case 'subassembly': return Boxes;
  default: return GitBranch;
 }
};
function StructureCard({node,direct,below,onOpen}:{
 node:HrStructureNode;direct:number;below:number;onOpen:()=>void;
}){
 const Icon=iconFor(node.level);
 return <button type="button" onClick={onOpen}
  aria-label={'Open '+node.name+', '+levelLabel(node.level)}
  className="group flex min-h-24 w-full min-w-0 items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-left text-ink shadow-sm transition-colors hover:border-brand/50 hover:bg-brand/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:p-4">
  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
   <Icon className="h-6 w-6" aria-hidden="true"/>
  </span>
  <span className="min-w-0 flex-1">
   <span className="block text-[11px] font-semibold uppercase tracking-wide text-brand">{levelLabel(node.level)}</span>
   <span className="mt-0.5 block break-words text-base font-bold leading-snug text-ink">{node.name||node.code||'Unnamed unit'}</span>
   <span className="mt-1 block break-all text-xs text-muted">{node.code||node.id}</span>
   <span className="mt-1 block text-xs text-soft">{direct?direct+' direct '+(direct===1?'unit':'units')+(below>direct?' · '+below+' total below':''):'No lower units'}</span>
  </span>
  <ChevronRight className="h-5 w-5 shrink-0 text-brand" aria-hidden="true"/>
 </button>;
}
export default function HrStructureExplorer({nodes}:{nodes:HrStructureNode[]}){
 const [trail,setTrail]=useState<string[]>([]);
 const [search,setSearch]=useState('');
 const topRef=useRef<HTMLDivElement>(null);
 const index=useMemo(()=>structureIndex(nodes),[nodes]);
 const chosenId=trail[trail.length-1];
 const chosen=chosenId?index.byId.get(chosenId):undefined;
 useEffect(()=>{setTrail([]);setSearch('');},[nodes]);
 const children=chosen?(index.children.get(chosen.id)||[]).filter(n=>!trail.includes(n.id)):index.roots;
 const matches=useMemo(()=>{
  const needle=search.trim().toLocaleLowerCase();
  return needle?nodes.filter(n=>[n.name,n.code,n.level,n.id].some(v=>v.toLocaleLowerCase().includes(needle)))
   .sort((a,b)=>(a.name||a.code).localeCompare(b.name||b.code)):null;
 },[nodes,search]);
 const goTo=(id:string)=>{
  setTrail(structurePath(id,index));
  setSearch('');
  topRef.current?.scrollIntoView({block:'nearest',behavior:'smooth'});
 };
 const goUp=()=>{
  setTrail(current=>current.slice(0,-1));
  setSearch('');
 };
 const label=chosen?chosen.name||chosen.code:'Top-level organization units';
 return <section aria-label="Approved organization structure" className="min-w-0 space-y-3">
  <div className="flex items-start gap-3">
   <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
    <Building2 className="h-6 w-6" aria-hidden="true"/>
   </span>
   <div className="min-w-0 flex-1">
    <h2 className="text-base font-bold text-ink">Approved organization structure</h2>
    <p className="mt-1 text-xs text-muted">Browse from the highest available level, then open each unit to view its children.</p>
   </div>
  </div>
  <div className="flex flex-wrap gap-2 text-xs text-muted" aria-label="Organization unit counts">
   <span className="rounded-lg border border-line bg-panel px-2.5 py-1.5">{nodes.filter(n=>n.level==='site').length} sites</span>
   <span className="rounded-lg border border-line bg-panel px-2.5 py-1.5">{nodes.filter(n=>n.level==='department').length} departments</span>
   <span className="rounded-lg border border-line bg-panel px-2.5 py-1.5">{nodes.filter(n=>n.level==='cost_center').length} cost centres</span>
   <span className="rounded-lg border border-line bg-panel px-2.5 py-1.5">{nodes.length} total units</span>
  </div>
  <div className="relative">
   <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted" aria-hidden="true"/>
   <input type="search" aria-label="Find an organization unit" value={search} onChange={e=>setSearch(e.target.value)}
    placeholder="Find a unit by name or code"
    className="h-11 w-full min-w-0 rounded-xl border border-line bg-panel pl-10 pr-3 text-sm text-ink outline-offset-2 placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"/>
  </div>
  <div ref={topRef} className="scroll-mt-4"/>
  {!matches&&<nav aria-label="Organization hierarchy path" className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
   <button type="button" onClick={()=>setTrail([])} aria-current={!chosen?'location':undefined}
    className={'min-h-9 rounded-lg border px-2.5 py-1.5 font-semibold '+(!chosen?'border-brand bg-brand/10 text-brand':'border-line bg-panel text-ink')}>
    All units
   </button>
   {trail.map((id,i)=>{
    const node=index.byId.get(id);
    if(!node)return null;
    return <span key={id} className="inline-flex min-w-0 items-center gap-1">
     <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true"/>
     <button type="button" aria-current={i===trail.length-1?'location':undefined}
      onClick={()=>setTrail(trail.slice(0,i+1))}
      className={'min-h-9 max-w-[12rem] break-words rounded-lg border px-2.5 py-1.5 text-left font-semibold '+(i===trail.length-1?'border-brand bg-brand/10 text-brand':'border-line bg-panel text-ink')}>
      {node.name||node.code}
     </button>
    </span>;
   })}
  </nav>}
  {matches?
   <div className="space-y-2">
    <p className="text-xs font-semibold text-muted">{matches.length} matching {matches.length===1?'unit':'units'}</p>
    <div className="grid gap-2 md:grid-cols-2">
     {matches.map(n=><StructureCard key={n.id} node={n} direct={index.children.get(n.id)?.filter(child=>child.id!==n.id).length||0} below={subtreeCount(n.id,index)} onOpen={()=>goTo(n.id)}/>)}
    </div>
    {!matches.length&&<p className="rounded-xl border border-line bg-panel p-4 text-sm text-muted">No matching organization units.</p>}
   </div>:
   <div className="space-y-3">
    {chosen&&<div className="rounded-2xl border border-brand/25 bg-brand/5 p-3 sm:p-4">
     <div className="flex items-start gap-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
       {(()=>{const Icon=iconFor(chosen.level);return <Icon className="h-5 w-5" aria-hidden="true"/>})()}
      </span>
      <div className="min-w-0 flex-1">
       <p className="text-[11px] font-bold uppercase tracking-wide text-brand">{levelLabel(chosen.level)}</p>
       <h3 className="mt-0.5 break-words text-lg font-bold text-ink">{chosen.name||chosen.code}</h3>
       <p className="mt-1 break-all text-xs text-muted">Code: {chosen.code||chosen.id}</p>
       <p className="mt-1 text-xs text-muted">Status: {chosen.status||'Not recorded'} · {subtreeCount(chosen.id,index)} units below</p>
      </div>
     </div>
    </div>}
    <div className="flex min-w-0 items-center justify-between gap-2">
     <div className="min-w-0">
      <h3 className="break-words text-sm font-bold text-ink">{label}</h3>
      <p className="text-xs text-muted">{chosen?'Immediate child units':'Highest accessible organization units'} · {children.length}</p>
     </div>
     {chosen&&<button type="button" onClick={goUp}
      className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-xl border border-line bg-panel px-3 text-xs font-semibold text-ink hover:bg-brand/10">
      <ArrowLeft className="h-4 w-4" aria-hidden="true"/>Back
     </button>}
    </div>
    <div className="grid min-w-0 gap-2 md:grid-cols-2">
     {children.map(node=><StructureCard key={node.id} node={node}
      direct={(index.children.get(node.id)||[]).filter(child=>child.id!==node.id&&!trail.includes(child.id)).length}
      below={subtreeCount(node.id,index)} onOpen={()=>goTo(node.id)}/>)}
    </div>
    {nodes.length===0&&<div className="rounded-2xl border border-dashed border-line bg-panel p-5 text-sm text-muted">No organization units are available in your authorized scope.</div>}
    {chosen&&children.length===0&&<div className="flex items-start gap-2 rounded-2xl border border-line bg-panel p-4 text-sm text-muted">
     <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true"/>
     <p>This is the lowest available unit in this branch. No child units are configured or accessible.</p>
    </div>}
   </div>}
  <p className="flex items-start gap-2 border-t border-line pt-3 text-xs text-muted">
   <ShieldCheck className="h-4 w-4 shrink-0 text-brand" aria-hidden="true"/>
   Structure is read only and restricted to your authorized organization scope.
  </p>
 </section>;
}
