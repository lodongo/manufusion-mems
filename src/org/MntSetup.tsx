import {useEffect,useState} from 'react';
import {Button,Card,PageTitle,Spinner} from '../admin/kit';
import {Alert} from '../components/ui';
import {callBackend} from '../lib/backend';
type Key='workRequest'|'workOrder'|'technicalClosure';
type Field='maintenanceType'|'priority'|'criticality'|'estimatedCost'|'riskScore'|'requiresSpares'|'requiresExternalService'|'requiresExternalSpecialist';
type Condition={field:Field;op:'eq'|'gte'|'lte';value:string|number|boolean};
type Rule={enabled:boolean;match:'all'|'any';conditions:Condition[]};
type Policy=Record<Key,Rule>&{workOrderStage:string};
type Data={policy:Policy;version:number;updatedAt:string;transactionCodes:Record<Key,string>;activationReady:boolean};
const fieldLabels:Record<Field,string>={maintenanceType:'Maintenance type code',priority:'Priority code',criticality:'Equipment criticality code',estimatedCost:'Estimated cost (LE functional currency)',riskScore:'Risk score',requiresSpares:'Requires spares',requiresExternalService:'Requires external service',requiresExternalSpecialist:'Requires external specialist'};
const stages=[['before_assessment','Before assessment'],['after_assessment','After assessment'],['after_readiness','After resource readiness'],['before_execution','Before execution']];
const approvals:Array<{key:Key;label:string;description:string}>=[{key:'workRequest',label:'Work request approval',description:'Approval before confirmation and conversion to a work order.'},{key:'workOrder',label:'Work order approval',description:'Formal authorization at the selected workflow stage.'},{key:'technicalClosure',label:'Technical closure approval',description:'Technical Lead by default, with alternative roles through Workflow & Roles.'}];
const input='w-full rounded-lg border border-line bg-panel p-2 text-ink';
const numeric=(field:Field)=>field==='estimatedCost'||field==='riskScore';
const resource=(field:Field)=>field.startsWith('requires');
export default function MntSetup(){
 const [data,setData]=useState<Data|null>(null),[policy,setPolicy]=useState<Policy|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{setError('');setBusy(true);try{const d=await callBackend<Data>('/api/org/mnt/setup/governance');setData(d);setPolicy(d.policy);}catch(e){setError(e instanceof Error?e.message:'Unable to load setup');}finally{setBusy(false);}};
 useEffect(()=>{void load();},[]);
 const change=(key:Key,part:Partial<Rule>)=>setPolicy(p=>p?{...p,[key]:{...p[key],...part}}:p);
 const condition=(key:Key,index:number,part:Partial<Condition>)=>setPolicy(p=>p?{...p,[key]:{...p[key],conditions:p[key].conditions.map((c,i)=>i===index?{...c,...part}:c)}}:p);
 const save=async()=>{if(!policy||!data)return;setBusy(true);setError('');setNotice('');try{const d=await callBackend<Data>('/api/org/mnt/setup/governance/save',{policy,reason,expectedVersion:data.version});setData(d);setPolicy(d.policy);setReason('');setNotice('Draft revision '+d.version+' saved. No runtime workflow changes have been applied.');}catch(e){setError(e instanceof Error?e.message:'Save failed');}finally{setBusy(false);}};
 return <div className="space-y-4"><PageTitle title="Maintenance Management · Setup" subtitle="Organization-wide governance"/>
 {error&&<Alert tone="error">{error}</Alert>}{notice&&<Alert tone="info">{notice}</Alert>}
 {!policy||!data?(busy?<Spinner/>:<Button onClick={()=>void load()}>Reload</Button>):<>
 <Alert tone="warn">Configuration draft only. Activation is unavailable until the existing workflow engine, approval stage enforcement, and new-transaction policy snapshots are integrated and verified. Existing work requests and work orders are unchanged.</Alert>
 <Card className="space-y-2"><h2 className="font-semibold">Governance configuration</h2><p className="text-sm text-soft">Organization-wide · Draft version {data.version} · New transactions only after future activation. No separate approval engine is created by this setup.</p></Card>
 {approvals.map(a=><Card key={a.key} className="space-y-3"><label className="flex items-start justify-between gap-3"><span><span className="block font-semibold">{a.label}</span><span className="block text-sm text-soft">{a.description}</span></span><input className="mt-1 h-5 w-5" type="checkbox" checked={policy[a.key].enabled} onChange={e=>change(a.key,{enabled:e.target.checked})}/></label>
 <p className="text-xs text-soft">Existing workflow transaction: {data.transactionCodes[a.key]}</p>
 {policy[a.key].enabled&&<>{a.key==='workOrder'&&<label className="block text-sm">Approval stage<select className={input} value={policy.workOrderStage} onChange={e=>setPolicy(p=>p?{...p,workOrderStage:e.target.value}:p)}>{stages.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>}
 <label className="block text-sm">Apply approval when<select className={input} value={policy[a.key].match} onChange={e=>change(a.key,{match:e.target.value as Rule['match']})}><option value="all">All listed conditions match</option><option value="any">Any listed condition matches</option></select></label>
 {!policy[a.key].conditions.length&&<p className="text-xs text-soft">No conditions: unconditional approval.</p>}
 {policy[a.key].conditions.map((c,i)=><div key={i} className="space-y-2 rounded-lg border border-line p-3"><div className="grid gap-2 sm:grid-cols-2"><select aria-label="Condition field" className={input} value={c.field} onChange={e=>{const field=e.target.value as Field;condition(a.key,i,{field,op:'eq',value:numeric(field)?0:resource(field)?true:''});}}>{Object.entries(fieldLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><select aria-label="Operator" className={input} value={c.op} onChange={e=>condition(a.key,i,{op:e.target.value as Condition['op']})}><option value="eq">Equals</option>{numeric(c.field)&&<><option value="gte">At least</option><option value="lte">At most</option></>}</select></div>
 {resource(c.field)?<select aria-label="Condition value" className={input} value={String(c.value)} onChange={e=>condition(a.key,i,{value:e.target.value==='true'})}><option value="true">Yes</option><option value="false">No</option></select>:<input aria-label="Condition value" className={input} type={numeric(c.field)?'number':'text'} min={numeric(c.field)?0:undefined} value={String(c.value)} onChange={e=>condition(a.key,i,{value:numeric(c.field)?Number(e.target.value):e.target.value})}/>}
 <Button variant="secondary" onClick={()=>change(a.key,{conditions:policy[a.key].conditions.filter((_,j)=>j!==i)})}>Remove condition</Button></div>)}
 <Button variant="secondary" disabled={policy[a.key].conditions.length>=20} onClick={()=>change(a.key,{conditions:[...policy[a.key].conditions,{field:'maintenanceType',op:'eq',value:''}]})}>Add condition</Button></>}
 </Card>)}
 <Card className="space-y-3"><label className="block text-sm">Reason for change<textarea className={input} rows={3} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="flex flex-wrap gap-2"><Button busy={busy} disabled={reason.trim().length<10} onClick={()=>void save()}>Save draft</Button><Button variant="secondary" disabled={busy} onClick={()=>void load()}>Reload saved draft</Button></div></Card>
 </>}</div>;
}
