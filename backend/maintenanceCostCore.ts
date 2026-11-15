export const COST_CATEGORIES=['materials','services','specialists','labour','tools','overhead','other'] as const;
export type CostCategory=typeof COST_CATEGORIES[number];
export type CostLine={category:CostCategory;currency:string;amount:number;kind:'posted'|'committed'|'estimate'|'operational';source:string;date:string};
export const money=(n:number)=>Math.round(n*100)/100;
export function amount(v:unknown){return typeof v==='number'&&Number.isFinite(v)?v:null;}
export function reconcileCost(lines:CostLine[],terminal:boolean){
 const buckets=new Map<string,{currency:string;category:CostCategory;posted:number;committed:number;estimate:number|null;operational:number;forecast:number|null}>();
 const add=(l:CostLine)=>{if(!/^[A-Z]{3}$/.test(l.currency)||!Number.isFinite(l.amount))return;const key=l.currency+'|'+l.category,v=buckets.get(key)||{currency:l.currency,category:l.category,posted:0,committed:0,estimate:null,operational:0,forecast:null};if(l.kind==='estimate')v.estimate=(v.estimate??0)+l.amount;else v[l.kind]+=l.amount;buckets.set(key,v);};
 lines.forEach(add);return [...buckets.values()].map(v=>{const actualAndOutstanding=v.posted+v.committed;
 // Operational labour is a cost model, never an accounting posting. Posted labour takes precedence where available.
 const known=actualAndOutstanding+(v.category==='labour'&&v.posted===0?v.operational:0);
 const forecast=terminal?known:v.estimate===null?known:Math.max(v.estimate,known);
 return {...v,posted:money(v.posted),committed:money(v.committed),estimate:v.estimate===null?null:money(v.estimate),operational:money(v.operational),forecast:money(forecast)};});
}
