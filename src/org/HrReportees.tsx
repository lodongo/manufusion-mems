import {useEffect,useState} from 'react';
import {ArrowLeft,Network,ShieldCheck,Users} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {navigate} from '../lib/route';
import RichTable from '../components/RichTable';
import {fitLabel,type SkillFit} from './HrRoleSkillFit';
type Reportee={uid:string;name:string;employeeNumber:string;jobRole:string;skillFit?:SkillFit};
const columns=[
 {key:'employeeNumber',label:'Employee No.',value:(p:Reportee)=>p.employeeNumber},
 {key:'name',label:'Name',value:(p:Reportee)=>p.name},
 {key:'jobRole',label:'Assigned role',value:(p:Reportee)=>p.jobRole},
 {key:'fit',label:'Role skill fit',value:(p:Reportee)=>fitLabel(p.skillFit)},
];
export default function HrReportees(){
 const [employees,setEmployees]=useState<Reportee[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let active=true;
  callBackend<{employees:Reportee[]}>('/api/org/hr/reportees').then(r=>{if(active)setEmployees(r.employees)})
   .catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to load reportees.')})
   .finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[]);
 return <div className="min-w-0 space-y-4 px-3 py-4 sm:px-5">
  <header className="flex items-center gap-3">
   <button type="button" onClick={()=>navigate('organization_home/hr/HR01')} aria-label="Back to My HR Portal" className="flex h-11 w-11 items-center justify-center rounded-xl border border-line"><ArrowLeft className="h-5 w-5"/></button>
   <div className="min-w-0 flex-1"><div className="text-xs font-semibold text-brand">HUMAN RESOURCES</div><h1 className="text-lg font-bold">My Reportees</h1></div>
   <div className="rounded-xl bg-brand/10 p-3 text-brand"><Users className="h-5 w-5"/></div>
  </header>
  <section className="rounded-2xl border border-line bg-panel p-3 sm:p-4">
   <p className="mb-3 flex items-center gap-2 text-sm text-muted"><Network className="h-4 w-4"/>Verified direct reporting relationship · {employees.length} employees</p>
   {loading&&<p className="text-sm text-muted">Loading reportees…</p>}
   {error&&<p role="alert" className="text-sm text-red-500">{error}</p>}
   {!loading&&!error&&<div className="mt-3 grid grid-cols-2 gap-2">
     <div className="rounded-xl border border-line bg-page p-3"><p className="text-xs text-muted">Reportees with skills mapped</p>
       <p className="mt-1 text-xl font-bold">{employees.filter(e=>e.skillFit?.percentage!==null&&e.skillFit?.percentage!==undefined).length}/{employees.length}</p></div>
     <div className="rounded-xl border border-line bg-page p-3"><p className="text-xs text-muted">Average confirmed role fit</p>
       <p className="mt-1 text-xl font-bold text-brand">{(()=>{
        const valid=employees.filter(e=>e.skillFit?.percentage!==null&&e.skillFit?.percentage!==undefined);
        return valid.length?Math.round(valid.reduce((n,e)=>n+(e.skillFit?.percentage||0),0)/valid.length)+'%':'Not configured';
       })()}</p></div>
   </div>
   {!loading&&!error&&<RichTable id="hr-my-reportees" columns={columns} rows={employees}
     rowKey={r=>r.uid} onRowClick={r=>navigate('organization_home/hr/HR01/reportee/'+r.uid)}
     allowExport={false} height="h-[65dvh]" empty="No direct reportees are assigned."/>}
  </section>
  <p className="flex items-center gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4"/>Employee information is filtered using HR privacy rules. Confidential family and payslip data is not available to managers.</p>
 </div>;
}
