import {useEffect,useId,useState} from 'react';
import {Alert,SelectField} from '../components/ui';
import {callBackend} from '../lib/backend';
import PlnCostCenterSkuSetup from './PlnCostCenterSkuSetup';

type Node={id:string;parentId:string;level:string;name:string;code:string;costType:string;status:string};
type Hierarchy={legalEntities:Node[];sites:Node[];departments:Node[];costCenters:Node[]};
function Choice({label,value,options,onChange,disabled=false}:{
 label:string;value:string;options:Array<[string,string]>;
 onChange:(v:string)=>void;disabled?:boolean;
}){
 const id=useId();
 return <SelectField id={id} label={label} value={value} disabled={disabled}
   onChange={e=>onChange(e.target.value)}>
  {options.map(([id,label])=><option key={id} value={id}>{label}</option>)}
 </SelectField>;
}

/** PLN navigates to a cost centre and reuses its Organization Design gear editor. */
export default function PlnCostCenterSetup(){
 const [data,setData]=useState<Hierarchy|null>(null),[loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [le,setLe]=useState(''),[site,setSite]=useState(''),[dept,setDept]=useState(''),[cc,setCc]=useState('');
 const reload=async()=>{
  setLoading(true);setError('');
  try{setData(await callBackend<Hierarchy>('/api/org/pln/cost-center/hierarchy'));}
  catch(e){setError(e instanceof Error?e.message:'Could not load manufacturing cost centres.');}
  finally{setLoading(false);}
 };
 useEffect(()=>{void reload();},[]);
 const sites=data?.sites.filter(n=>n.parentId===le)??[];
 const depts=data?.departments.filter(n=>n.parentId===site)??[];
 const centers=data?.costCenters.filter(n=>n.parentId===dept)??[];
 return <div className='space-y-4'>
  <div className='flex items-start justify-between gap-3'>
   <div><h2 className='text-lg font-semibold'>Manufacturing cost-centre SKU setup</h2>
    <p className='text-sm text-muted'>Select the manufacturing location. SKU configuration belongs to its cost centre, not to a separate equipment unit.</p>
   </div>
   <button type='button' onClick={()=>void reload()} disabled={loading}
    className='min-h-11 shrink-0 rounded-xl border border-line px-3 text-sm disabled:opacity-50'>Refresh</button>
  </div>
  {error&&<Alert tone='error'>{error}</Alert>}
  {loading?<p className='text-sm text-muted'>Loading cost centres…</p>:<section className='space-y-3 rounded-2xl border border-line bg-panel p-4'>
   <h3 className='font-semibold'>Select planning location</h3>
   <div className='grid gap-3 sm:grid-cols-2'>
    <Choice label='Legal entity' value={le}
     options={[['','Choose legal entity'],...(data?.legalEntities??[]).map(n=>[n.id,n.name+' · '+n.code] as [string,string])]}
     onChange={v=>{setLe(v);setSite('');setDept('');setCc('');}}/>
    <Choice label='Site' value={site} disabled={!le}
     options={[['','Choose site'],...sites.map(n=>[n.id,n.name+' · '+n.code] as [string,string])]}
     onChange={v=>{setSite(v);setDept('');setCc('');}}/>
    <div className='rounded-xl border border-line bg-page p-3'>
     <p className='text-xs text-muted'>Activity / cost-centre type</p>
     <p className='mt-1 font-semibold'>Manufacturing</p>
     <p className='mt-1 text-xs text-muted'>From the adopted Finance cost-centre classification</p>
    </div>
    <Choice label='Department' value={dept} disabled={!site}
     options={[['','Choose department'],...depts.map(n=>[n.id,n.name+' · '+n.code] as [string,string])]}
     onChange={v=>{setDept(v);setCc('');}}/>
    <Choice label='Manufacturing cost centre' value={cc} disabled={!dept}
     options={[['','Choose cost centre'],...centers.map(n=>[n.id,n.name+' · '+n.code] as [string,string])]}
     onChange={setCc}/>
   </div>
   {!data?.costCenters.length&&<p className='text-sm text-muted'>No manufacturing cost centres are accessible. Check Organization Design, Finance's cost-centre type and your access scope.</p>}
  </section>}
  {cc&&<PlnCostCenterSkuSetup key={cc} costCenterId={cc}/>}
 </div>;
}
