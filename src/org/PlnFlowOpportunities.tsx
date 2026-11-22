import type {FlowAnalysis} from '../shared/mfgFlowCapacity';
const fmt=(value:number)=>new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value);
export default function PlnFlowOpportunities({analysis,heading='Capacity opportunities',showUnresolved=true,units=[]}:{
 analysis:FlowAnalysis|undefined;heading?:string;showUnresolved?:boolean;
 units?:Array<{code:string;label?:string;symbol?:string}>;
}){
 if(!analysis)return null;
 const constrained=analysis.opportunities.filter(x=>x.shortagePerHour>0);
 const unitName=(code:string)=>units.find(x=>x.code===code)?.symbol||units.find(x=>x.code===code)?.label||code;
 return <section className='space-y-2 rounded-xl border border-line bg-panel p-3' aria-live='polite'>
  <div className='flex flex-wrap items-center justify-between gap-2'>
   <h3 className='text-sm font-semibold'>{heading}</h3>
   <span className='text-xs text-muted'>{analysis.comparableLinks} comparable process link(s)</span>
  </div>
  {constrained.length===0&&analysis.comparableLinks>0&&
   <p className='text-xs text-muted'>No rated upstream shortage among comparable links. Verify yields, shared capacity, availability and actual meter readings before relying on the plan.</p>}
  {analysis.comparableLinks===0&&
   <p className='text-xs text-muted'>Enter comparable hourly capacities for connected process stages to see supply constraints and buffer opportunities.</p>}
  {constrained.map(x=><div key={x.upstreamCode+'_'+x.downstreamCode}
    className='space-y-2 rounded-lg border border-amber-500/50 p-3 text-xs'>
   <div className='flex flex-wrap items-center justify-between gap-2'>
    <p className='font-semibold'>{x.upstreamName||x.upstreamCode} → {x.downstreamName||x.downstreamCode}</p>
    <span className='font-semibold text-amber-700'>{fmt(x.shortagePercent)}% upstream shortfall</span>
   </div>
   <p>Upstream can supply <strong>{fmt(x.supplyCoveragePercent)}%</strong> of the required input rate. Supply: <strong>{fmt(x.upstreamRate)} {unitName(x.unitCode)}/h</strong>; required: <strong>{fmt(x.requiredInputRate)} {unitName(x.unitCode)}/h</strong>.</p>
   <p>Missing supply over one uninterrupted hour: <strong>{fmt(x.oneHourShortage)} {unitName(x.unitCode)}</strong>.</p>
   {x.bufferAvailable===null?
    <p>Buffer not specified. The time until interruption cannot be estimated.</p>:
    <p>Usable buffer: <strong>{fmt(x.bufferAvailable)} {unitName(x.unitCode)}</strong>.
     {' '+(x.minutesToDepletion===null?'No depletion estimated.':
     'At the configured rates the buffer would last about '+fmt(x.minutesToDepletion)+' minutes.') }
     {x.riskWithinHour===true?' Potential interruption within one hour if no other supply is available.':
      x.riskWithinHour===false?' Configured buffer covers the one-hour deficit.':''}</p>}
   <p className='text-muted'>{x.assumption}</p>
  </div>)}
  {showUnresolved&&analysis.unresolved.length>0&&<details className='rounded-lg border border-line p-2'>
   <summary className='cursor-pointer text-xs font-semibold'>{analysis.unresolved.length} flow comparison(s) need additional configuration</summary>
   <div className='mt-2 space-y-1'>
    {analysis.unresolved.map((x,i)=><p className='text-xs text-muted' key={i}>
     {x.upstreamCode?x.upstreamCode+' → ':''}{x.downstreamCode}: {x.reason}
    </p>)}
   </div>
  </details>}
  <p className='text-xs text-muted'>Capacity analysis uses configured planning rates and assumes continuous operation. It is a planning opportunity, not a prediction based on live equipment state.</p>
 </section>;
}
