import {scoreMaintenanceRisk,type RiskMatrix} from '../../backend/maintenanceTaskRisk';
import {ACTIVITY_CLASSES} from '../../backend/safActivityClasses';
export type Reference={code:string;label:string;category?:string;hierarchyCode?:string;rank?:number};
type Rating={ratings:Record<string,number>;matrixVersion?:number};
export type RiskRow={hazard:string;hazardCodes?:string[];impact:string;impactCodes?:string[];impactLabels?:string[];controls:string[];before:Rating;after:Rating};
export type Baseline={code:string;version:number;rows:RiskRow[];permitCodes:string[];energyTags?:string[]};
export type ReportTask={taskId:string;name:string;classCodes:string[];rows:RiskRow[];classBaseline?:Baseline[];permitCodes:string[];energyPlan?:{state:string;tag?:string;label?:string}[];status:string;noAdditionalRisks?:boolean};
export type ReportData={equipmentName:string;tasks:ReportTask[];classes:{code:string;label:string;requiredPermits:string[];baseline:Baseline}[];matrix:RiskMatrix|null;canEdit:boolean;reportReferences:{hazards:Reference[];injuries:Reference[];controls:Reference[];hierarchy:Reference[];permits:Reference[]}|null};
type Score=ReturnType<typeof scoreMaintenanceRisk>;
export type ReportRow={id:string;taskId:string;task:string;classes:string;source:string;hazards:string;injuries:string;initial:Score|null;residual:Score|null;mitigation:string[];requirements:string[];review:string[];status:string};
const unique=(xs:string[])=>[...new Set(xs.filter(Boolean))];
const names=(refs:Reference[],codes:string[])=>unique(codes.map(c=>refs.find(r=>r.code===c)?.label||c)).join('; ');
const fingerprint=(r:RiskRow)=>JSON.stringify([...( [r.hazardCodes?.length?r.hazardCodes:[r.hazard],r.impactCodes?.length?r.impactCodes:[r.impact],r.controls].map(x=>[...x].sort())),...([r.before,r.after].map(x=>Object.entries(x?.ratings||{}).sort(([a],[b])=>a.localeCompare(b))))]);
function calculate(matrix:RiskMatrix|null,r:Rating|undefined){if(!matrix||!r)return null;try{return scoreMaintenanceRisk(matrix,r.ratings)}catch{return null}}
export function assembleTaskRiskReport(data:ReportData):ReportRow[]{
 const refs=data.reportReferences||{hazards:[],injuries:[],controls:[],hierarchy:[],permits:[]},matrix=data.matrix;
 const className=(code:string)=>data.classes.find(c=>c.code===code)?.label||ACTIVITY_CLASSES.find(c=>c.code===code)?.label||code;
 return data.tasks.flatMap<ReportRow>(t=>{
  const codes=t.classCodes||[],classes=codes.map(className).join('; '),review:string[]=[];
  const entries=new Map<string,{row:RiskRow;sources:string[]}>();
  const add=(r:RiskRow,source:string)=>{const key=fingerprint(r),found=entries.get(key);if(found)found.sources=unique([...found.sources,source]);else entries.set(key,{row:r,sources:[source]});};
  const baselines=codes.map(code=>{const live=data.classes.find(c=>c.code===code)?.baseline,old=t.classBaseline?.find(b=>b.code===code);if(!live){review.push('Class adoption changed: '+className(code));return old;}if((old?.version||0)!==live.version)review.push('Class baseline changed: '+className(code));return live;}).filter((b):b is Baseline=>!!b);
  baselines.forEach(b=>(b.rows||[]).forEach(r=>add(r,'Global: '+className(b.code))));
  (t.rows||[]).forEach(r=>add(r,'Activity-specific'));
  const hazardsSeen=new Map<string,number>();for(const {row} of entries.values())for(const h of unique(row.hazardCodes?.length?row.hazardCodes:[row.hazard]))hazardsSeen.set(h,(hazardsSeen.get(h)||0)+1);
  const req:string[]=[];
  if(codes.includes('AC02'))req.push('Short Intervention Control — verify eligibility and equipment safeguards; not a substitute for required LOTO.');
  if(codes.includes('AC03'))req.push('Full LOTO — isolate hazardous energy and verify zero energy.');
  else if(codes.includes('AC06'))req.push('Partial LOTO — isolate applicable energy and review retained energy.');
  else if(t.energyPlan?.some(p=>p.state==='isolate')||t.permitCodes?.includes('SAF_08_01_003')||baselines.some(b=>b.permitCodes?.includes('SAF_08_01_003')))req.push('LOTO — applicable isolation and verification.');
  const tags=unique([...(t.energyPlan||[]).filter(p=>p.state==='isolate').map(p=>p.tag||p.label||''),...baselines.flatMap(b=>b.energyTags||[])]);
  if(tags.length)req.push('Affected / isolation points — '+tags.join('; '));
  const permits=unique([...(t.permitCodes||[]),...baselines.flatMap(b=>b.permitCodes||[]),...codes.flatMap(c=>ACTIVITY_CLASSES.find(x=>x.code===c)?.requiredPermits||[])]);
  permits.forEach(p=>req.push('Permit required — '+names(refs.permits,[p])));
  if(permits.some(p=>!(t.permitCodes||[]).includes(p)))review.push('Review newly inherited or required permits.');
  const shared={taskId:t.taskId,task:t.name,classes,requirements:req,status:t.status};
  if(!entries.size)return [{...shared,id:t.taskId+'-pending',source:'—',hazards:'—',injuries:'—',initial:null,residual:null,mitigation:[],review:[...review,codes.includes('AC01')&&codes.length===1?'No Risk classification — verify screening; no numerical rating.':'Assessment pending — no risk rows recorded.']}];
  return [...entries.values()].map(({row:r,sources},i)=>{
   const initial=calculate(matrix,r.before),residual=calculate(matrix,r.after),warnings=[...review];
   if(!initial||!residual)warnings.push('Ratings incomplete or incompatible with current matrix.');
   if(matrix&&[r.before,r.after].some(x=>x?.matrixVersion!==matrix.version))warnings.push('Matrix revision changed or unrecorded — reassess; displayed scores are recalculated.');
   if((r.hazardCodes?.length?r.hazardCodes:[r.hazard]).some(h=>(hazardsSeen.get(h)||0)>1))warnings.push('Overlapping hazards have distinct recorded assessments; review, do not assume equivalence.');
   if(matrix&&matrix.severityOverride>0&&matrix.factors.some(f=>f.code==='S'&&f.enabled)&&[initial,residual].some(x=>(x?.ratings.S||0)>=matrix.severityOverride))warnings.push('Severity escalation required.');
   if(residual?.tolerability==='Intolerable')warnings.push('Stop work; further controls and reassessment required.');
   if(t.status==='task_assessment_pending')warnings.push('Activity assessment pending.');
   const mitigation=(r.controls||[]).map(code=>{const c=refs.controls.find(x=>x.code===code),layer=refs.hierarchy.find(x=>x.code===c?.hierarchyCode),rank=layer?.rank||Number(c?.hierarchyCode?.slice(2))||99;return {rank,label:(layer?.label||c?.category||'Recorded control')+' — '+(c?.label||code)};}).sort((a,b)=>a.rank-b.rank||a.label.localeCompare(b.label)).map(x=>x.label);
   return {...shared,id:t.taskId+'-'+i,source:sources.join('; '),hazards:names(refs.hazards,r.hazardCodes?.length?r.hazardCodes:[r.hazard]),injuries:r.impactLabels?.length?r.impactLabels.join('; '):names(refs.injuries,r.impactCodes?.length?r.impactCodes:[r.impact]),initial,residual,mitigation:unique(mitigation),review:unique(warnings)};
  });
 });
}
