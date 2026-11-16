import MntSelect from './MntSelect';
import {useEffect,useState} from 'react';
import {MntTaskCatalogueAdoption} from './MntTaskCatalogue';
import {MntToolAdoption} from './MntToolCatalogue';
import {Button,Card,PageTitle,Spinner} from '../admin/kit';
import {Alert} from '../components/ui';
import {callBackend} from '../lib/backend';
import {workspaceNavigate} from '../lib/route';
import type {MntSetup as AdoptedSetup} from './mntShared';
type Key='workRequest'|'workOrder'|'technicalClosure';
type Field='maintenanceType'|'priority'|'criticality'|'estimatedCost'|'riskScore'|'requiresSpares'|'requiresExternalService'|'requiresExternalSpecialist';
type Condition={field:Field;op:'eq'|'gte'|'lte';value:string|number|boolean};
type Step={stream:string;level:number;quorum:{mode:'any'|'all'|'count'|'percent';value?:number};approverUids:string[]};
type Alternate={principalUid:string;alternateUid:string;mode:'delegation'|'escalation';startsAt:string;endsAt:string;afterHours:number};
type Flow={steps:Step[];alternates:Alternate[]};
type Rule={enabled:boolean;match:'all'|'any';conditions:Condition[];flow?:Flow};
type Policy=Record<Key,Rule>&{workOrderStage:string};
type Data={employees?:{uid:string;name:string}[];policy:Policy;version:number;updatedAt:string;transactionCodes:Record<Key,string>;activationReady:boolean;activationBlockers:string[];active:{version:number;activatedAt:string;policy:Policy}|null};
const fieldLabels:Record<Field,string>={maintenanceType:'Maintenance type code',priority:'Priority code',criticality:'Equipment criticality code',estimatedCost:'Estimated cost (LE functional currency)',riskScore:'Maximum initial risk score',requiresSpares:'Requires spares',requiresExternalService:'Requires external service',requiresExternalSpecialist:'Requires external specialist'};
const stages=[['before_assessment','Before assessment'],['after_assessment','After assessment'],['after_readiness','After resource readiness'],['before_execution','Before execution']];
const approvals:Array<{key:Key;label:string;description:string}>=[{key:'workRequest',label:'Work request approval',description:'Approval before confirmation and conversion to a work order.'},{key:'workOrder',label:'Work order approval',description:'Formal authorization at the selected workflow stage.'},{key:'technicalClosure',label:'Technical closure approval',description:'Technical Lead by default, with alternative roles through Workflow & Roles.'}];
const input='w-full rounded-lg border border-line bg-panel p-2 text-ink';
const numeric=(field:Field)=>field==='estimatedCost'||field==='riskScore';
const resource=(field:Field)=>field.startsWith('requires');
const newStep=():Step=>({stream:'main',level:1,quorum:{mode:'any'},approverUids:[]});
const dateValue=(v:string)=>v?new Date(v).toISOString().slice(0,16):'';
export default function MntSetup(){
 const [data,setData]=useState<Data|null>(null),[policy,setPolicy]=useState<Policy|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[activationText,setActivationText]=useState('');
 const [adopted,setAdopted]=useState<AdoptedSetup['lists']>(null);
 useEffect(()=>{callBackend<AdoptedSetup>('/api/org/mnt/setup',{}).then(d=>setAdopted(d.lists)).catch(()=>setAdopted(null));},[]);
 const choices=(field:Field)=>field==='maintenanceType'?adopted?.maintenanceTypes:field==='priority'?adopted?.priorities:adopted?.criticality;
 const load=async()=>{setError('');setBusy(true);try{const d=await callBackend<Data>('/api/org/mnt/setup/governance');setData(d);setPolicy(d.policy);}catch(e){setError(e instanceof Error?e.message:'Unable to load setup');}finally{setBusy(false);}};
 useEffect(()=>{void load();},[]);
 const change=(key:Key,part:Partial<Rule>)=>setPolicy(p=>p?{...p,[key]:{...p[key],...part}}:p);
 const condition=(key:Key,index:number,part:Partial<Condition>)=>setPolicy(p=>p?{...p,[key]:{...p[key],conditions:p[key].conditions.map((c,i)=>i===index?{...c,...part}:c)}}:p);
 const dirty=!!data&&!!policy&&JSON.stringify(data.policy)!==JSON.stringify(policy);
 const activate=async()=>{if(!data||dirty||!data.activationReady)return;setBusy(true);setError('');setNotice('');try{const d=await callBackend<Data>('/api/org/mnt/setup/governance/activate',{expectedVersion:data.version,expectedActiveVersion:data.active?.version||0,confirm:activationText,reason});setData(d);setPolicy(d.policy);setReason('');setActivationText('');setNotice('Active version '+d.active?.version+' will apply only to newly created transactions.');}catch(e){setError(e instanceof Error?e.message:'Activation failed');}finally{setBusy(false);}};
 const save=async()=>{if(!policy||!data)return;setBusy(true);setError('');setNotice('');try{const d=await callBackend<Data>('/api/org/mnt/setup/governance/save',{policy,reason,expectedVersion:data.version});setData(d);setPolicy(d.policy);setReason('');setNotice('Draft revision '+d.version+' saved. No runtime workflow changes have been applied.');}catch(e){setError(e instanceof Error?e.message:'Save failed');}finally{setBusy(false);}};
 return <div className="space-y-4"><PageTitle title="Maintenance Management · Setup" subtitle="Organization-wide governance" action={<Button variant='secondary' onClick={()=>workspaceNavigate('organization_admin/mnt_dashboard')}>Dashboard & KPI targets</Button>}/>
 <MntTaskCatalogueAdoption/>
 <MntToolAdoption/>
 {error&&<Alert tone="error">{error}</Alert>}{notice&&<Alert tone="info">{notice}</Alert>}
 {!policy||!data?(busy?<Spinner/>:<Button onClick={()=>void load()}>Reload</Button>):<>
 <Alert tone="info">Existing work requests and work orders retain their original governance. Newly activated policies apply only to new transactions. If a condition cannot be evaluated from trusted facts at its approval stage, approval is required conservatively.</Alert>
 {!!data.activationBlockers?.length&&<Alert tone="warn">{data.activationBlockers.join(' ')}</Alert>}
 <Card className="space-y-2"><h2 className="font-semibold">Governance configuration</h2><p className="text-sm text-soft">Organization-wide · Draft version {data.version} · {data.active?'Active version '+data.active.version:'Default v0 · optional approvals off for new transactions'} · New transactions only.</p></Card>
 {approvals.map(a=><Card key={a.key} className="space-y-3"><label className="flex items-start justify-between gap-3"><span><span className="block font-semibold">{a.label}</span><span className="block text-sm text-soft">{a.description}</span></span><input className="mt-1 h-5 w-5" type="checkbox" checked={policy[a.key].enabled} onChange={e=>change(a.key,{enabled:e.target.checked})}/></label>
 <p className="text-xs text-soft">Existing workflow transaction: {data.transactionCodes[a.key]}</p>
 {policy[a.key].enabled&&<>{a.key==='workOrder'&&<div className="block text-sm"><MntSelect label="Approval stage" className={input} value={policy.workOrderStage} onChange={e=>setPolicy(p=>p?{...p,workOrderStage:e.target.value}:p)}>{stages.map(([v,l])=><option key={v} value={v}>{l}</option>)}</MntSelect></div>}
 <div className="block text-sm"><MntSelect label="Apply approval when" className={input} value={policy[a.key].match} onChange={e=>change(a.key,{match:e.target.value as Rule['match']})}><option value="all">All listed conditions match</option><option value="any">Any listed condition matches</option></MntSelect></div>
 {!policy[a.key].conditions.length&&<p className="text-xs text-soft">No conditions: unconditional approval.</p>}
 {policy[a.key].conditions.map((c,i)=><div key={i} className="space-y-2 rounded-lg border border-line p-3"><div className="grid gap-2 sm:grid-cols-2"><MntSelect label="Condition field" className={input} value={c.field} onChange={e=>{const field=e.target.value as Field;condition(a.key,i,{field,op:'eq',value:numeric(field)?0:resource(field)?true:''});}}>{Object.entries(fieldLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</MntSelect><MntSelect label="Operator" className={input} value={c.op} onChange={e=>condition(a.key,i,{op:e.target.value as Condition['op']})}><option value="eq">Equals</option>{numeric(c.field)&&<><option value="gte">At least</option><option value="lte">At most</option></>}</MntSelect></div>
 {resource(c.field)?<MntSelect label="Condition value" className={input} value={String(c.value)} onChange={e=>condition(a.key,i,{value:e.target.value==='true'})}><option value="true">Yes</option><option value="false">No</option></MntSelect>:numeric(c.field)?<input aria-label="Condition value" className={input} type="number" min={0} value={String(c.value)} onChange={e=>condition(a.key,i,{value:Number(e.target.value)})}/>:<MntSelect label="Adopted condition value" className={input} value={String(c.value)} onChange={e=>condition(a.key,i,{value:e.target.value})}><option value="">Choose from adopted setup</option>{(choices(c.field)||[]).map(x=><option key={x.code} value={x.code}>{x.code} · {x.label}</option>)}{String(c.value)&&!(choices(c.field)||[]).some(x=>x.code===c.value)&&<option value={String(c.value)} disabled>{String(c.value)} · legacy / not adopted</option>}</MntSelect>}
 <Button variant="secondary" onClick={()=>change(a.key,{conditions:policy[a.key].conditions.filter((_,j)=>j!==i)})}>Remove condition</Button></div>)}
 <Button variant="secondary" disabled={policy[a.key].conditions.length>=20} onClick={()=>change(a.key,{conditions:[...policy[a.key].conditions,{field:'maintenanceType',op:'eq',value:''}]})}>Add condition</Button>
 <div className="border-t border-line pt-3"><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!policy[a.key].flow} onChange={e=>change(a.key,{flow:e.target.checked?{steps:[newStep()],alternates:[]}:undefined})}/> Advanced approval workflow</label>
 {policy[a.key].flow&&<FlowEditor flow={policy[a.key].flow!} employees={data.employees||[]} onChange={flow=>change(a.key,{flow})}/>}</div></>}
 </Card>)}
 <Card className="space-y-3"><label className="block text-sm">Reason for change<textarea className={input} rows={3} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="flex flex-wrap gap-2"><Button busy={busy} disabled={reason.trim().length<10} onClick={()=>void save()}>Save draft</Button><Button variant="secondary" disabled={busy} onClick={()=>void load()}>Reload saved draft</Button></div></Card>
 <Card className="space-y-3"><h2 className="font-semibold">Activate saved policy</h2><p className="text-sm text-soft">The saved policy can be activated for new transactions only. Save your changes before activating.</p>{data.active&&<p className="text-sm text-soft">Active version {data.active.version} · {new Date(data.active.activatedAt).toLocaleString()}</p>}<label className="block text-sm">Type ACTIVATE FOR NEW TRANSACTIONS<input className={input} value={activationText} onChange={e=>setActivationText(e.target.value)}/></label><Button disabled={busy||dirty||!data.activationReady||reason.trim().length<10||activationText!=='ACTIVATE FOR NEW TRANSACTIONS'} onClick={()=>void activate()}>Activate for new transactions</Button></Card>
 </>}</div>;
}

function FlowEditor({flow,employees,onChange}:{flow:Flow;employees:{uid:string;name:string}[];onChange:(f:Flow)=>void}){
 const step=(i:number,patch:Partial<Step>)=>onChange({...flow,steps:flow.steps.map((s,j)=>i===j?{...s,...patch}:s)});
 const alternate=(i:number,patch:Partial<Alternate>)=>onChange({...flow,alternates:flow.alternates.map((s,j)=>i===j?{...s,...patch}:s)});
 const options=<><option value="">Choose employee</option>{employees.map(e=><option key={e.uid} value={e.uid}>{e.name} · {e.uid}</option>)}</>;
 return <div className="mt-3 space-y-3">
 <p className="text-xs text-soft">Levels in the same stream are sequential; distinct streams operate in parallel. Named employees must already hold the configured approval role and location scope. Empty employee selection uses all eligible scoped role holders.</p>
 {flow.steps.map((s,i)=><div key={i} className="space-y-2 rounded-lg border border-line p-3"><div className="grid grid-cols-2 gap-2"><label className="text-sm">Stream<input className={input} value={s.stream} onChange={e=>step(i,{stream:e.target.value})}/></label><label className="text-sm">Level<input className={input} type="number" min={1} max={12} value={s.level} onChange={e=>step(i,{level:Number(e.target.value)})}/></label></div>
 <div className="block text-sm"><MntSelect label="Approval threshold" className={input} value={s.quorum.mode} onChange={e=>step(i,{quorum:{mode:e.target.value as Step['quorum']['mode'],...(['count','percent'].includes(e.target.value)?{value:1}:{})}})}><option value="any">Any one</option><option value="all">All</option><option value="count">Minimum number</option><option value="percent">Minimum percentage</option></MntSelect></div>
 {['count','percent'].includes(s.quorum.mode)&&<input className={input} aria-label="Threshold value" type="number" min={1} max={100} value={s.quorum.value||1} onChange={e=>step(i,{quorum:{...s.quorum,value:Number(e.target.value)}})}/>}
 <MntSelect label="Add named approver" className={input} value="" onChange={e=>{if(e.target.value&&!s.approverUids.includes(e.target.value))step(i,{approverUids:[...s.approverUids,e.target.value]});}}>{options}</MntSelect>
 {s.approverUids.map(uid=><div className="flex items-center justify-between gap-2 text-sm" key={uid}><span>{employees.find(e=>e.uid===uid)?.name||uid}</span><Button variant="secondary" onClick={()=>step(i,{approverUids:s.approverUids.filter(x=>x!==uid)})}>Remove</Button></div>)}
 <Button variant="secondary" disabled={flow.steps.length<=1} onClick={()=>onChange({...flow,steps:flow.steps.filter((_,j)=>j!==i)})}>Remove approval level</Button></div>)}
 <Button variant="secondary" disabled={flow.steps.length>=12} onClick={()=>onChange({...flow,steps:[...flow.steps,{...newStep(),level:Math.max(0,...flow.steps.filter(s=>s.stream==='main').map(s=>s.level))+1}]})}>Add approval level</Button>
 <h3 className="font-semibold">Delegation and escalation</h3><p className="text-xs text-soft">An authorized alternate may vote for one principal during a defined UTC interval or after a configured number of elapsed hours. This does not create additional votes or grant any new permissions.</p>
 {flow.alternates.map((a,i)=><div className="space-y-2 rounded-lg border border-line p-3" key={i}><div className="block text-sm"><MntSelect label="Principal" className={input} value={a.principalUid} onChange={e=>alternate(i,{principalUid:e.target.value})}>{options}</MntSelect></div><div className="block text-sm"><MntSelect label="Alternate approver" className={input} value={a.alternateUid} onChange={e=>alternate(i,{alternateUid:e.target.value})}>{options}</MntSelect></div><MntSelect label="Alternate mode" className={input} value={a.mode} onChange={e=>alternate(i,{mode:e.target.value as Alternate['mode']})}><option value="delegation">Temporary delegation</option><option value="escalation">Escalation after delay</option></MntSelect>
 {a.mode==='delegation'?<div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">Start (UTC)<input className={input} type="datetime-local" value={dateValue(a.startsAt)} onChange={e=>alternate(i,{startsAt:e.target.value?e.target.value+':00Z':''})}/></label><label className="text-sm">End (UTC)<input className={input} type="datetime-local" value={dateValue(a.endsAt)} onChange={e=>alternate(i,{endsAt:e.target.value?e.target.value+':00Z':''})}/></label></div>:<label className="block text-sm">Elapsed hours<input className={input} type="number" min={1} max={8760} value={a.afterHours} onChange={e=>alternate(i,{afterHours:Number(e.target.value)})}/></label>}
 <Button variant="secondary" onClick={()=>onChange({...flow,alternates:flow.alternates.filter((_,j)=>j!==i)})}>Remove alternate</Button></div>)}
 <Button variant="secondary" disabled={flow.alternates.length>=30} onClick={()=>onChange({...flow,alternates:[...flow.alternates,{principalUid:'',alternateUid:'',mode:'delegation',startsAt:'',endsAt:'',afterHours:24}]})}>Add alternate approver</Button>
 </div>;
}
