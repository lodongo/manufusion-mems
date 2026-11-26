import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {downloadBlob} from '../lib/xlsx';
import {Card,Spinner,useLoad} from './kit';
type Question={question_id:string;question:string;accountability:string;weight_percent:number};
type Profile={profile_id:string;name:string;categories:{category_id:string;name:string;weight_percent:number;questions:Question[]}[]};
type Status={loaded:boolean;version:string;questionCount:number;sha256:string;loadedAt:string;profiles:{id:string;name:string;categoryCount:number;questionCount:number;weight:number}[]};
const api='/api/admin/procurement/srm-template';
export default function SupplierRelationshipAdmin({canWrite}:{canWrite:boolean}){
 const {data,error,loading,reload}=useLoad(()=>callBackend<Status>(api+'/status',{}),[]);
 const [busy,setBusy]=useState(false),[issue,setIssue]=useState(''),[profiles,setProfiles]=useState<Profile[]>([]);
 async function run(action:'publish'|'preview'|'download'){
  setBusy(true);setIssue('');
  try{
   if(action==='publish'){await callBackend(api+'/publish',{});reload();}
   else {
    const result=await callBackend<{json:string}>(api+'/export',{});
    if(action==='download')downloadBlob(new Blob([result.json],{type:'application/json'}),'Supplier_Relationship_Evaluation_Template.json');
    else setProfiles(JSON.parse(result.json).evaluation_profiles);
   }
  }catch(e){setIssue(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 return <div className="space-y-3"><Card><h2 className="font-semibold">Supplier relationship evaluation</h2>
 <p className="text-sm text-slate-400">Global procurement evaluation master for projects, materials and services. Each profile totals 100 points.</p>
 {loading&&<Spinner/>}{error&&<p className="text-red-400">{String(error)}</p>}{issue&&<p className="text-red-400">{issue}</p>}
 {data&&<><p className="my-2 text-sm">{data.loaded?'Loaded and verified in database':'Not yet loaded in database'}</p>
 {data.loaded&&<><p className="text-sm">Version {data.version} · {data.questionCount} questions · {data.loadedAt}</p><p className="break-all text-xs text-slate-400">SHA-256: {data.sha256}</p>
 <div className="space-y-2 my-3">{data.profiles.map(p=><div key={p.id} className="rounded border border-slate-600 p-2"><strong>{p.name}</strong><p className="text-sm">{p.categoryCount} categories · {p.questionCount} questions · {p.weight}%</p></div>)}</div></>}
 <div className="flex flex-wrap gap-2">{canWrite&&!data.loaded&&<button type="button" className="rounded border px-3 py-2" disabled={busy} onClick={()=>void run('publish')}>Load into database</button>}
 {data.loaded&&<><button type="button" className="rounded border px-3 py-2" disabled={busy} onClick={()=>void run('preview')}>View questions</button><button type="button" className="rounded border px-3 py-2" disabled={busy} onClick={()=>void run('download')}>Download JSON</button></>}</div></>}
 </Card>{profiles.map(p=><Card key={p.profile_id}><details><summary className="font-semibold cursor-pointer">{p.name}</summary>{p.categories.map(c=><details key={c.category_id} className="my-2 border-b border-slate-600 pb-2"><summary className="cursor-pointer">{c.name} · {c.weight_percent}%</summary>{c.questions.map(q=><div key={q.question_id} className="py-2 text-sm"><p>{q.question_id} · {q.question}</p><p className="text-slate-400">{q.accountability} · {q.weight_percent}%</p></div>)}</details>)}</details></Card>)}</div>;
}
