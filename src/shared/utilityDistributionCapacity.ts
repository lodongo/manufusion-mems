/** Cost-centre utility network analysis.
 * An additive determinant (e.g. current/flow) is summed at coincident peak.
 * Voltage, phase and other delivery characteristics are compatibility checks,
 * never sum/min/max aggregation of unrelated physical units.
 */
export type UtilityAttribute={key:string;label?:string;type?:string;unit?:string;required?:boolean;options?:string[]};
export type UtilityDefinition={code:string;label?:string;attributes?:UtilityAttribute[]};
export type UtilityConsumer={equipmentId:string;name?:string;values:Record<string,unknown>;legacy?:boolean;hasAsset?:boolean};
export type UtilityGap={equipmentId:string;key:string;label:string;message:string;expected?:unknown;actual?:unknown};
export type UtilityCapacityReview={
 determinant:{key:string;label:string;unit:string}|null;
 capacity:number|null;demand:number;unknown:number;percentage:number|null;remaining:number|null;
 status:'normal'|'warning'|'overload'|'incompatible'|'incomplete';
 gaps:UtilityGap[];consumers:Array<{equipmentId:string;name:string;demand:number|null;legacy:boolean;hasAsset:boolean;gaps:UtilityGap[]}>;
};
const ADDITIVE=new Set(['current','flow','feed','power','force','mass']);
const MINIMUM=new Set(['pressure','supplypressure','supplyflowpressure']);
const BETTER_LOWER=new Set(['particle','water','oil']);
const numeric=(v:unknown):number|null=>{
 const n=typeof v==='number'?v:typeof v==='string'&&v.trim()?Number(v):NaN;
 return Number.isFinite(n)?n:null;
};
export function utilityDeterminant(def:UtilityDefinition){
 const attrs=def.attributes||[];
 const key=['current','flow','feed','power','force','mass'].find(k=>attrs.some(a=>a.key===k&&a.type==='number'));
 const a=attrs.find(x=>x.key===key);
 return a?{key:a.key,label:a.label||a.key,unit:a.unit||''}:null;
}
function compareAttribute(a:UtilityAttribute,provided:unknown,required:unknown):string{
 const label=a.label||a.key;
 if(provided===undefined||provided===null||provided==='')return 'Set the cost-centre supply '+label+'.';
 const p=numeric(provided),r=numeric(required);
 const kind=a.key.toLowerCase();
 if(BETTER_LOWER.has(kind)&&p!==null&&r!==null)return p<=r?'':'Supplied '+label+' is worse than equipment requirement.';
 if(MINIMUM.has(kind)&&p!==null&&r!==null)return p>=r?'':'Supplied '+label+' is below equipment minimum.';
 if(p!==null&&r!==null){
  // No arbitrary operational tolerances: differing setpoints need explicit design acceptance.
  return Math.abs(p-r)<=1e-9*Math.max(1,Math.abs(r))?'':'Supplied '+label+' does not match equipment requirement.';
 }
 return String(provided).trim()===String(required).trim()?'':'Supplied '+label+' does not match equipment requirement.';
}
export function reviewUtilityDistribution(def:UtilityDefinition,supplyValues:Record<string,unknown>,
 capacity:number|null, consumers:UtilityConsumer[]):UtilityCapacityReview{
 const determinant=utilityDeterminant(def);
 const gaps:UtilityGap[]=[];
 let demand=0,unknown=0;
 const reviewed=consumers.map(c=>{
  const problems:UtilityGap[]=[];
  const needs=determinant?numeric(c.values[determinant.key]):null;
  const valid=needs!==null&&needs>0?needs:null;
  if(determinant){
   if(valid===null){unknown++;problems.push({equipmentId:c.equipmentId,key:determinant.key,
    label:determinant.label,message:'Enter a positive equipment demand in '+determinant.unit+'.'});}
   else demand+=valid;
  }
  for(const a of def.attributes||[]){
   if(ADDITIVE.has(a.key.toLowerCase()))continue;
   const required=c.values[a.key];
   if(required===undefined||required===null||required===''){
    if(a.required)problems.push({equipmentId:c.equipmentId,key:a.key,label:a.label||a.key,
     message:'Equipment '+(a.label||a.key)+' is not configured.'});
    continue;
   }
   const problem=compareAttribute(a,supplyValues[a.key],required);
   if(problem)problems.push({equipmentId:c.equipmentId,key:a.key,label:a.label||a.key,
    message:problem,expected:required,actual:supplyValues[a.key]});
  }
  if(c.legacy)problems.push({equipmentId:c.equipmentId,key:'migration',label:'Supply allocation',
   message:'Historical direct-to-asset link: reassign through the cost centre.'});
  if(c.hasAsset===false)problems.push({equipmentId:c.equipmentId,key:'asset',label:'Equipment asset',
   message:'This equipment has no linked asset. Add or attribute one in Asset Management.'});
  gaps.push(...problems);
  return {equipmentId:c.equipmentId,name:c.name||c.equipmentId,demand:valid,
   legacy:!!c.legacy,hasAsset:c.hasAsset!==false,gaps:problems};
 });
 const percentage=determinant&&capacity!==null&&capacity>0?demand/capacity*100:null;
 const remaining=determinant&&capacity!==null?capacity-demand:null;
 const hard=gaps.some(g=>g.key!=='migration'&&g.key!=='asset'&&g.key!==determinant?.key);
 const status:UtilityCapacityReview['status']=percentage!==null&&percentage>100+1e-8?'overload':
  hard?'incompatible':(determinant&&(unknown>0||capacity===null))?'incomplete':
  percentage!==null&&percentage>84?'warning':
  gaps.some(g=>g.key==='migration'||g.key==='asset')?'incomplete':'normal';
 return {determinant,capacity:determinant?capacity:null,demand,unknown,percentage,remaining,status,gaps,consumers:reviewed};
}
export function canDistributeUtility(review:UtilityCapacityReview):boolean{
 return review.status!=='overload'&&review.status!=='incompatible'&&review.status!=='incomplete'&&
  review.unknown===0;
}
/** Only compare explicit flow units; a normal cubic metre is not a standard cubic metre. */
export function normalizedMaterialFlow(value:number,unit:string,capacityUnit:string):number|null{
 if(!(Number.isFinite(value)&&value>=0))return null;
 const canon=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,'').replace(/³/g,'3').replace(/\u00b3/g,'3');
 const from=canon(unit).replace(/\/h$/,'');
 const to=canon(capacityUnit).replace(/\/h$/,'');
 if(from===to)return value;
 const volumes:Record<string,number>={l:1,litre:1,liter:1,ml:0.001,m3:1000};
 if(from in volumes&&to in volumes)return value*volumes[from]/volumes[to];
 const masses:Record<string,number>={kg:1,g:0.001,tonne:1000,t:1000};
 if(from in masses&&to in masses)return value*masses[from]/masses[to];
 return null;
}
