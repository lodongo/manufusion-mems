// Shared browser/server helpers. Keep the historical singular impact for compatibility,
// while impactCodes is the authoritative multi-injury selection when present.
export function injuryCodes(row:{impact?:unknown;impactCodes?:unknown}):string[]{
 const values=Array.isArray(row.impactCodes)?row.impactCodes:[row.impact];
 return [...new Set(values.filter((v):v is string=>typeof v==='string'&&v.trim().length>0).map(v=>v.trim()))];
}
type Injury={code:string;label:string;mechanism:string;effective:boolean};
type Control={code:string;label:string;mechanism:string;effective:boolean;guidance?:boolean};
type Layer={measures:Control[]};
type Profile={injuries:Injury[];layers:Layer[]};
// Each outcome belongs to an exposure mechanism. Offer the union, not the intersection,
// of the associated control options. Guidance is retained even when not selectable.
export function combinedControlCodes(profile:Profile,codes:readonly string[]):Set<string>{
 if(!codes.length)return new Set();
 const selected=profile.injuries.filter(i=>codes.includes(i.code));
 const mechanisms=new Set(selected.map(i=>i.mechanism));
 const historical=codes.some(c=>!profile.injuries.some(i=>i.code===c));
 return new Set(profile.layers.flatMap(l=>l.measures.filter(m=>m.effective&&!m.guidance&&(historical||mechanisms.has(m.mechanism))).map(m=>m.code)));
}
