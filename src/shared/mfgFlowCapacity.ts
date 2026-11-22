/** Rate-based process-flow opportunities. No stock moves or production postings.
 * Compare only compatible measurement dimensions and direct, single-input
 * predecessor links. Different processes may require an explicit yield factor.
 */
export type CapacityUnit={code:string;baseUnit:string;categoryCode:string;multiplier:number};
export type CapacityStage={code:string;name:string;dependsOn?:string[];ratePerHour?:number;
 unitCode?:string;bufferAvailable?:number;inputFactor?:number};
export type FlowOpportunity={upstreamCode:string;upstreamName:string;
 downstreamCode:string;downstreamName:string;unitCode:string;
 upstreamRate:number;downstreamRate:number;requiredInputRate:number;
 shortagePerHour:number;shortagePercent:number;supplyCoveragePercent:number;
 oneHourShortage:number;bufferAvailable:number|null;minutesToDepletion:number|null;
 riskWithinHour:boolean|null;status:'constraint'|'buffered'|'balanced'|'surplus';
 assumption:string};
export type FlowUnresolved={upstreamCode?:string;downstreamCode:string;reason:string};
export type FlowAnalysis={opportunities:FlowOpportunity[];unresolved:FlowUnresolved[];
 comparableLinks:number;limitedLinks:number};
const good=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
export function capacityUnitFactor(from:string,to:string,units:CapacityUnit[]):number|null {
 if(!from||!to)return null;
 if(from===to)return 1;
 const a=units.find(x=>x.code===from),b=units.find(x=>x.code===to);
 if(!a||!b||a.categoryCode!==b.categoryCode||a.baseUnit!==b.baseUnit||
  !good(a.multiplier)||!good(b.multiplier)||a.multiplier<=0||b.multiplier<=0)return null;
 return a.multiplier/b.multiplier;
}
const r=(n:number)=>Number(n.toPrecision(10));
export function analyzeFlowCapacity(stages:CapacityStage[],units:CapacityUnit[],horizonHours=1):FlowAnalysis{
 const byCode=new Map(stages.map(x=>[x.code,x])),opportunities:FlowOpportunity[]=[];
 const unresolved:FlowUnresolved[]=[];
 for(const down of stages){
  const dependencies=down.dependsOn||[];
  if(!dependencies.length)continue;
  if(dependencies.length>1){
   unresolved.push({downstreamCode:down.code,
    reason:'Parallel input branches require their individual material ratios; do not assume their capacities can be added.'});
   continue;
  }
  const up=byCode.get(dependencies[0]);
  if(!up){unresolved.push({upstreamCode:dependencies[0],downstreamCode:down.code,reason:'Predecessor stage is missing.'});continue;}
  if(!good(up.ratePerHour)||up.ratePerHour<=0||!good(down.ratePerHour)||down.ratePerHour<=0){
   unresolved.push({upstreamCode:up.code,downstreamCode:down.code,
    reason:'Enter positive hourly capacities on both stages to compare this process connection.'});continue;
  }
  const unitFactor=capacityUnitFactor(up.unitCode||'',down.unitCode||'',units);
  if(unitFactor===null){
   unresolved.push({upstreamCode:up.code,downstreamCode:down.code,
    reason:'Upstream and downstream rate units cannot be converted. Set compatible units or an approved material-equivalence basis.'});continue;
  }
  const inputFactor=down.inputFactor===undefined?1:down.inputFactor;
  if(!good(inputFactor)||inputFactor<=0){
   unresolved.push({upstreamCode:up.code,downstreamCode:down.code,
    reason:'A positive upstream-input quantity per downstream output unit is required.'});continue;
  }
  const supply=r(up.ratePerHour*unitFactor),demand=r(down.ratePerHour);
  const required=r(demand*inputFactor),gap=r(Math.max(0,required-supply));
  const share=required>0?r(100*gap/required):0;
  const buffer=good(up.bufferAvailable)&&up.bufferAvailable>=0?r(up.bufferAvailable*unitFactor):null;
  const minutes=gap>0&&buffer!==null?r(buffer/gap*60):null;
  const riskWithinHour=gap>0&&minutes!==null?minutes<60*horizonHours:null;
  const status=gap>0?(buffer!==null&&buffer>=gap*horizonHours?'buffered':'constraint'):
   supply>required?'surplus':'balanced';
  opportunities.push({
   upstreamCode:up.code,upstreamName:up.name,downstreamCode:down.code,downstreamName:down.name,
   unitCode:down.unitCode||'',upstreamRate:supply,downstreamRate:demand,requiredInputRate:required,
   shortagePerHour:gap,shortagePercent:share,
   supplyCoveragePercent:r(Math.min(100,required>0?100*supply/required:100)),
   oneHourShortage:r(gap*horizonHours),bufferAvailable:buffer,
   minutesToDepletion:minutes,riskWithinHour,status,
   assumption:inputFactor===1?'Assumes one upstream unit supplies one downstream output unit. Verify the recipe/yield.':
     'Uses '+inputFactor+' upstream units per downstream output unit (configure from the approved recipe).',
  });
 }
 return {opportunities,unresolved,comparableLinks:opportunities.length,
  limitedLinks:opportunities.filter(x=>x.shortagePerHour>0).length};
}
