/** Work assessments own every task and its resources, not work order header. */
export interface AssessedSpare {id:string;source:'warehouse'|'catalog'|'description';materialId:string;warehouseId:string;catalogCode:string;description:string;qty:number;uom:string;unitCost:number|null;specifications?:string;attributes?:Record<string,string>;photoPath?:string;}
export interface AssessedService {id:string;categoryCode:string;subcategoryCode:string;classCode:string;catalogCode:string;description:string;attributes:Record<string,string>;proposedVendorIds:string[];scope?:string;deliverables?:string;quantity?:number;qualifications?:string;expectedCost?:number|null;acceptanceCriteria?:string;}
export interface AssessedRisk {hazard:string;impact:string;controls:string;before:string;after:string;permit:string;beforeRatings?:Record<string,number>;afterRatings?:Record<string,number>;exposedPersonnel?:string;responsiblePerson?:string;precautions?:string;energyCode?:string;}
export interface AssessedTask {id:string;description:string;disciplineCode:string;resourceTypeCode:string;persons:number;hours:number;rate:number;tools:string;spares:AssessedSpare[];services:AssessedService[];risk:AssessedRisk[];templateStatus:'pending_validation'|'existing';skillCodes?:string[];title?:string;equipmentId?:string;assemblyId?:string;instructions?:string;skills?:string;priority?:string;dependencies?:string[];isolation?:string;completionCriteria?:string;documentation?:string;safetyEquipment?:string;internalRoles?:string[];externalResource?:{type:string;persons:number;notes:string};lotoRequired?:boolean;liveEquipment?:boolean;energySourceCodes?:string[];permitCodes?:string[];}
export function validateAssessmentTasks(raw:unknown):AssessedTask[]{
 if(!Array.isArray(raw)||raw.length<1||raw.length>40)throw Error('Add between 1 and 40 assessed tasks.');
 const text=(v:unknown,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
 const number=(v:unknown,min:number,max:number)=>{const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)throw Error('Invalid task resource quantity or cost.');return n;};
 const ids=new Set<string>();
 const tasks:AssessedTask[]=raw.map((x,i)=>{
  if(!x||typeof x!=='object'||Array.isArray(x))throw Error('Invalid task.');
  const t=x as Record<string,unknown>,id=text(t.id,50)||'task_'+(i+1);
  if(!/^[A-Za-z0-9_-]{1,50}$/.test(id))throw Error('Invalid task identifier.');
  if(ids.has(id))throw Error('Duplicate task identifier.');ids.add(id);
  const desc=text(t.description,300);if(desc.length<3)throw Error('Task '+(i+1)+': provide a description.');
  const risk=Array.isArray(t.risk)?t.risk:[];
  if(!risk.length||risk.length>50)throw Error('Task '+(i+1)+': complete a risk assessment.');
  const normalizedRisk=risk.map((r,j)=>{
   const a=(r&&typeof r==='object'&&!Array.isArray(r)?r:{}) as Record<string,unknown>;
   const hazard=text(a.hazard),impact=text(a.impact),controls=text(a.controls,1200),before=text(a.before,60),after=text(a.after,60),permit=text(a.permit,120);
   const beforeRatings=a.beforeRatings&&typeof a.beforeRatings==='object'&&!Array.isArray(a.beforeRatings)?a.beforeRatings as Record<string,number>:undefined;
   const afterRatings=a.afterRatings&&typeof a.afterRatings==='object'&&!Array.isArray(a.afterRatings)?a.afterRatings as Record<string,number>:undefined;
   if(!hazard||!impact||controls.length<10||(!before&&!beforeRatings)||(!after&&!afterRatings))
     throw Error('Task '+(i+1)+', risk '+(j+1)+': hazard, impact, initial/residual risk and controls are required.');
   return {hazard,impact,controls,before,after,permit,beforeRatings,afterRatings,exposedPersonnel:text(a.exposedPersonnel),responsiblePerson:text(a.responsiblePerson),precautions:text(a.precautions,1000),energyCode:text(a.energyCode,80)};
  });
  const rawSpares=Array.isArray(t.spares)?t.spares:[];
  if(rawSpares.length>60)throw Error('Maximum 60 spares per task.');
  const spares=rawSpares.map((s,j)=>{
   const a=(s&&typeof s==='object'&&!Array.isArray(s)?s:{}) as Record<string,unknown>;
   const source:AssessedSpare['source']=a.source==='warehouse'?'warehouse':a.source==='catalog'?'catalog':'description';
   const description=text(a.description,200),materialId=text(a.materialId,100),warehouseId=text(a.warehouseId,100),catalogCode=text(a.catalogCode,80);
   if((description.length<2&&!text(a.photoPath,300))||source==='warehouse'&&(!materialId||!warehouseId)||source==='catalog'&&!catalogCode)throw Error('Task '+(i+1)+', spare '+(j+1)+': select a source and item.');
   return {id:text(a.id,50)||'spare_'+(j+1),source,description:description||'Spare identified by photo — specification pending',photoPath:text(a.photoPath,300),materialId,warehouseId,catalogCode,qty:number(a.qty,0.001,1000000),uom:text(a.uom,12)||'EA',specifications:text(a.specifications,2000),attributes:(a.attributes&&typeof a.attributes==='object'?Object.fromEntries(Object.entries(a.attributes).slice(0,40).map(([k,v])=>[text(k,80),text(v,500)])):{}),unitCost:source==='warehouse'&&a.unitCost!==null&&a.unitCost!==undefined?number(a.unitCost,0,1e9):null};
  });
  const rawServices=Array.isArray(t.services)?t.services:[];
  if(rawServices.length>20)throw Error('Maximum 20 services per task.');
  const services=rawServices.map((s,j)=>{
   const a=(s&&typeof s==='object'&&!Array.isArray(s)?s:{}) as Record<string,unknown>;
   const proposedVendorIds=Array.isArray(a.proposedVendorIds)?[...new Set(a.proposedVendorIds.map(v=>text(v,100)).filter(Boolean))]:[];
   if(proposedVendorIds.length>3)throw Error('Task '+(i+1)+': select up to 3 proposed vendors.');
   const description=text(a.description,200),categoryCode=text(a.categoryCode,80),subcategoryCode=text(a.subcategoryCode,80),classCode=text(a.classCode,80);
   if(description.length<3||!categoryCode||!subcategoryCode||!classCode)throw Error('Task '+(i+1)+', service '+(j+1)+': category, subcategory, class and description are required.');
   const attributes:Record<string,string>={};
   if(a.attributes&&typeof a.attributes==='object'&&!Array.isArray(a.attributes))for(const [key,value] of Object.entries(a.attributes as Record<string,unknown>).slice(0,40))attributes[text(key,80)]=text(value,200);
   return {id:text(a.id,50)||'service_'+(j+1),description,categoryCode,subcategoryCode,classCode,catalogCode:text(a.catalogCode,80),attributes,proposedVendorIds,scope:text(a.scope,2000),deliverables:text(a.deliverables,1000),quantity:number(a.quantity??1,0.001,1000000),qualifications:text(a.qualifications,1000),expectedCost:a.expectedCost==null?null:number(a.expectedCost,0,1e9),acceptanceCriteria:text(a.acceptanceCriteria,1000)};
  });
  const internalRoles=Array.isArray(t.internalRoles)?[...new Set(t.internalRoles.map(v=>text(v,30)).filter(Boolean))]:[];
  if(internalRoles.some(v=>!['operator','technician','specialist','engineer'].includes(v)))throw Error('Choose a valid internal resource type.');
  const externalRaw=(t.externalResource&&typeof t.externalResource==='object'&&!Array.isArray(t.externalResource)?t.externalResource:{}) as Record<string,unknown>;
  const externalType=text(externalRaw.type,40);
  if(externalType&&!['OEM','OCM','verified_supplier','other'].includes(externalType))throw Error('Choose a valid external resource type.');
  const externalResource=externalType?{type:externalType,persons:number(externalRaw.persons??1,1,50),notes:text(externalRaw.notes,1200)}:undefined;
  if(externalType==='other'&&!externalResource?.notes)throw Error('Describe the other external resource.');
  const lotoRequired=t.lotoRequired===true,liveEquipment=t.liveEquipment===true;
  const energySourceCodes=Array.isArray(t.energySourceCodes)?[...new Set(t.energySourceCodes.map(v=>text(v,80)).filter(Boolean))]:[];
  const permitCodes=Array.isArray(t.permitCodes)?[...new Set(t.permitCodes.map(v=>text(v,80)).filter(Boolean))]:[];
  if(lotoRequired&&!energySourceCodes.length)throw Error('Identify at least one hazardous energy source when LOTO is required.');
  if(!lotoRequired&&energySourceCodes.length)throw Error('Hazardous energy selections require the LOTO flag.');
  if(energySourceCodes.length>120||permitCodes.length>80)throw Error('Too many safety source or permit selections.');
  return {id,internalRoles,externalResource,lotoRequired,liveEquipment,energySourceCodes,permitCodes,skillCodes:Array.isArray(t.skillCodes)?[...new Set(t.skillCodes.map(v=>text(v,80)).filter(Boolean))].slice(0,40):[],title:text(t.title,120)||desc,equipmentId:text(t.equipmentId,120),assemblyId:text(t.assemblyId,120),instructions:text(t.instructions,3000),skills:text(t.skills,1000),priority:text(t.priority,40)||'normal',dependencies:Array.isArray(t.dependencies)?[...new Set(t.dependencies.map(v=>text(v,50)).filter(Boolean))]:[],isolation:text(t.isolation,2000),completionCriteria:text(t.completionCriteria,2000),documentation:text(t.documentation,2000),safetyEquipment:text(t.safetyEquipment,1000),description:desc,disciplineCode:text(t.disciplineCode,80),resourceTypeCode:text(t.resourceTypeCode,80),
   persons:number(t.persons??1,1,50),hours:number(t.hours??1,0.25,2000),rate:number(t.rate??0,0,1000000),
   tools:text(t.tools,1000),spares,services,risk:normalizedRisk,templateStatus:t.templateStatus==='existing'?'existing':'pending_validation'};
 });
 const visit=(id:string,stack=new Set<string>(),done=new Set<string>())=>{if(stack.has(id))throw Error('Task dependency cycle detected.');if(done.has(id))return;stack.add(id);for(const dep of tasks.find(t=>t.id===id)?.dependencies||[]){if(!ids.has(dep))throw Error('Task dependency must refer to another assessment task.');visit(dep,stack,done);}stack.delete(id);done.add(id);};
 tasks.forEach(t=>{for(const kind of ['spares','services'] as const){const values=t[kind].map(x=>x.id);if(new Set(values).size!==values.length||values.some(x=>!/^[-A-Za-z0-9_]{1,50}$/.test(x)))throw Error('Invalid or duplicate resource identifier.');}visit(t.id);});
 return tasks;
}
export function summarizeAssessmentTasks(tasks:AssessedTask[]){
 return {taskCount:tasks.length,spareCount:tasks.reduce((n,t)=>n+t.spares.length,0),serviceCount:tasks.reduce((n,t)=>n+t.services.length,0),
  riskCount:tasks.reduce((n,t)=>n+t.risk.length,0)};
}


/** Legacy summary fields stay readable; technical resources have one canonical task snapshot. */
export function assessmentTaskSummaries(tasks:AssessedTask[]){return tasks.map(({id,description,disciplineCode,resourceTypeCode,persons,hours,rate})=>({id,description,disciplineCode,resourceTypeCode,persons,hours,rate}));}
