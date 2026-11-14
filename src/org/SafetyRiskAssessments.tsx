import {useState} from 'react';
import {ChevronRight,Cog,Home} from 'lucide-react';
import {Alert} from '../components/ui';
import {Button,Card,PageTitle,Spinner,useLoad} from '../admin/kit';
import {callBackend} from '../lib/backend';
import {navigate} from '../lib/route';
import {LEVELS,upperName} from './structureDefs';
import {EquipmentEnergySources,ActivityClassRisks} from './SafEquipment';
import EquipmentLoto from './EquipmentLoto';
import EquipmentSafetyDevices from './EquipmentSafetyDevices';
import EquipmentTasks from './EquipmentTasks';
import ActivityRiskLegacy from './ActivityRiskLegacy';
import ActivityRiskReview from './ActivityRiskReview';

type Unit={id:string;level:string;tier:number;parentId:string;code:string;name:string;status:string};
type Hierarchy={node:Unit|null;ancestors:Unit[];children:Unit[];design:{names:string[]}};
const SECTIONS=[
 {key:'hazardous-energy',label:'Hazardous Energy Sources',hint:'Adopted sources, equipment tags and photos',color:'text-amber-500'},
 {key:'short-intervention',label:'Short Intervention Program',hint:'Documented alternative safeguarding · review required',color:'text-blue-500'},
 {key:'loto-program',label:'LOTO Program',hint:'Energy isolation register and locking responsibilities',color:'text-blue-500'},
 {key:'equipment-safety-devices',label:'Equipment Interlocks and Safety Devices',hint:'Register, tag and configure Short Intervention devices',color:'text-blue-500'},
 {key:'class-risk',label:'Task Class Risk Assessment',hint:'Adopted task classes and optional global risk assessments',color:'text-orange-400'},
 {key:'equipment-tasks',label:'Tasks',hint:'Existing task register · skills, permits and risk classification',color:'text-blue-500'},
] as const;
type Panel=typeof SECTIONS[number]['key']|'activity-risk'|'activity-risk-review';
export default function SafetyRiskAssessments({nodeId,routeBase}:{nodeId?:string;routeBase:string}){
 const id=nodeId||'root';
 return <HierarchyNode key={id} id={id} routeBase={routeBase}/>;
}
function HierarchyNode({id,routeBase}:{id:string;routeBase:string}){
 const {data,loading,error}=useLoad(()=>callBackend<Hierarchy>('/api/org/structure/node',{id,safetyOnly:true}),[id]);
 const [panel,setPanel]=useState<Panel|null>(null);
 const open=(target:string)=>navigate(target==='root'?routeBase:routeBase+'/'+target);
 const back=()=>setPanel(null);
 if(loading&&!data)return <Spinner/>;
 if(error||!data)return <div className='space-y-3'><Button variant='secondary' onClick={()=>open('root')}>← Organization</Button><Alert tone='error'>{error||'Could not load the organization hierarchy.'}</Alert></div>;
 const node=data.node;
 const path=[...data.ancestors,...(node?[node]:[])];
 const level=(n:Unit)=>n.level==='group'?upperName(data.design.names,n.tier):LEVELS[n.level]?.label||n.level;
 const crumb=<nav aria-label='Organization hierarchy' className='flex flex-wrap items-center gap-1 text-sm'><button onClick={()=>open('root')} className='flex items-center gap-1 rounded-lg px-2 py-1 text-brand'><Home className='h-4 w-4'/>Organization</button>{path.map(n=><span key={n.id} className='flex items-center gap-1'><ChevronRight className='h-3.5 w-3.5 text-muted'/><button className='rounded-lg px-2 py-1 font-mono text-xs text-brand' onClick={()=>{if(n.id===id)back();else open(n.id);}} title={n.name}>{n.code}</button></span>)}</nav>;
 if(node?.level==='work_center'&&panel){
  const workCenterId=node.id;
  const hierarchy=path.map(n=>({level:n.level,code:n.code,name:n.name}));
  let content;
  switch(panel){
   case 'hazardous-energy':content=<EquipmentEnergySources workCenterId={workCenterId} onBack={back}/>;break;
   case 'short-intervention':content=<EquipmentSafetyDevices workCenterId={workCenterId} program onBack={back} onConfigure={()=>setPanel('equipment-safety-devices')}/>;break;
   case 'loto-program':content=<EquipmentLoto workCenterId={workCenterId} onBack={back} onConfigure={()=>setPanel('hazardous-energy')}/>;break;
   case 'equipment-safety-devices':content=<EquipmentSafetyDevices workCenterId={workCenterId} onBack={back} onConfigure={()=>setPanel('short-intervention')}/>;break;
   case 'class-risk':content=<ActivityClassRisks workCenterId={workCenterId} onBack={back} onLegacy={()=>setPanel('activity-risk')}/>;break;
   case 'equipment-tasks':content=<EquipmentTasks workCenterId={workCenterId} onBack={back} allowCreate={false}/>;break;
   case 'activity-risk':content=<ActivityRiskLegacy workCenterId={workCenterId} hierarchy={hierarchy} onBack={()=>setPanel('class-risk')} onReview={()=>setPanel('activity-risk-review')}/>;break;
   case 'activity-risk-review':content=<ActivityRiskReview workCenterId={workCenterId} hierarchy={hierarchy} onBack={()=>setPanel('activity-risk')}/>;break;
  }
  return <section className='space-y-3'>{crumb}{content}</section>;
 }
 return <section className='space-y-3'><PageTitle title='Risk Assessments' subtitle='Select the organization hierarchy down to an equipment unit. Safety and Organization Design share the same equipment records.'/>{crumb}
 {node&&<Card><p className='font-mono text-xs text-brand'>{node.code}</p><p className='font-semibold text-ink'>{node.name}</p><p className='text-xs text-muted'>{level(node)}{node.status==='inactive'?' · inactive':''}</p></Card>}
 {node?.level==='work_center'?<Card><ul className='divide-y divide-line'>{SECTIONS.map(s=><li key={s.key}><button type='button' onClick={()=>setPanel(s.key)} className='flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left'><Cog className={'h-5 w-5 shrink-0 '+s.color}/><span className='min-w-0 flex-1'><span className='block text-sm text-ink'>{s.label}</span><span className='block text-xs text-muted'>{s.hint}</span></span><ChevronRight className='h-4 w-4 shrink-0 text-muted'/></button></li>)}</ul></Card>:<Card><div className='space-y-2'>{data.children.map(n=><button key={n.id} type='button' onClick={()=>open(n.id)} className='flex min-h-14 w-full items-center gap-3 rounded-xl border border-line px-3 py-2 text-left'><span className='min-w-0 flex-1'><span className='block font-mono text-xs text-brand'>{n.code}</span><span className='block font-medium text-ink'>{n.name}</span><span className='block text-xs text-muted'>{level(n)}{n.status==='inactive'?' · inactive':''}</span></span><ChevronRight className='h-5 w-5 shrink-0 text-muted'/></button>)}{!data.children.length&&<p className='text-sm text-muted'>No equipment in your Safety access scope at this level.</p>}</div></Card>}
 </section>;
}
