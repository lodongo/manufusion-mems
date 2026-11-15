/** Organization defaults and scoped overrides; no invented KPI targets. */
export const KPI_TARGETS={wrCohortRate:'percent',wrThroughputRate:'ratio',wrTurnaroundHours:'hours',woScheduleCompliance:'percent',woTurnaroundHours:'hours',woOverdue:'count',woBacklog:'count'} as const;
export type TargetKey=keyof typeof KPI_TARGETS;
export type TargetValues=Partial<Record<TargetKey,number>>;
export type TargetRule={scope:string;values:TargetValues};
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function validateTargetValues(v:unknown):TargetValues{
 const o=obj(v),out:TargetValues={};
 for(const [k,n] of Object.entries(o)){if(!(k in KPI_TARGETS))throw Error('Unknown KPI target.');const key=k as TargetKey,type=KPI_TARGETS[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0||type==='percent'&&n>100||type==='count'&&!Number.isSafeInteger(n)||n>1000000000)throw Error('Invalid '+k+' target.');out[key]=n;}
 return out;
}
export function resolveTargets(rules:TargetRule[],scopeChain:string[]){
 const result:Partial<Record<TargetKey,{value:number;source:string}>>={};
 for(const scope of [...new Set(['org',...scopeChain])]){const rule=rules.find(r=>r.scope===scope);if(!rule)continue;for(const [k,v] of Object.entries(rule.values))if(v!==undefined)result[k as TargetKey]={value:v,source:scope};}
 return result;
}
export const DASHBOARD_CARDS=['kpis','trend','states','age','dwell','compare','people'] as const;
export type SharedLayout={name:string;role:string;isDefault:boolean;settings:{period:string;kind:'wr'|'wo';cards:string[];dimension:string}};
export function validateSharedLayout(raw:unknown):SharedLayout{
 const r=obj(raw),s=obj(r.settings),name=typeof r.name==='string'?r.name.trim():'',role=typeof r.role==='string'?r.role.trim():'';
 if(!name||name.length>80||!(/^[a-zA-Z0-9_-]{1,80}$/.test(role)||role==='*'))throw Error('Name the layout and specify an organization security role.');
 if(!['today','yesterday','current_week','last_week','current_month','last_month','current_year','last_year'].includes(String(s.period)))throw Error('Shared layouts use a relative reporting period.');
 if(!['wr','wo'].includes(String(s.kind))||!Array.isArray(s.cards)||s.cards.some(k=>!DASHBOARD_CARDS.includes(k as typeof DASHBOARD_CARDS[number]))||!['group','legal_entity','site','department','cost_center','work_center','equipment','assembly','employee','country'].includes(String(s.dimension)))throw Error('Invalid shared layout.');
 return {name,role,isDefault:r.isDefault===true,settings:{period:String(s.period),kind:s.kind as 'wr'|'wo',cards:[...new Set(s.cards as string[])],dimension:String(s.dimension)}};
}
