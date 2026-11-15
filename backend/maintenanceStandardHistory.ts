import {getDoc,listDocs,str,isObj,HttpError,type Doc} from './core';
import {orgRoute,type OrgContext} from './guards';
import {canAt,scopeOf} from './access';
import {spanHours,type Span} from './maintenanceCapacityCore';
const obj=(v:unknown)=>isObj(v)?v:{};
const arr=(v:unknown)=>Array.isArray(v)?v.map(str).filter(Boolean):[];
export type StandardSample={elapsedHours:number;manHours:number;byPerson:Record<string,number>};
export function standardHistory(samples:Pick<StandardSample,'elapsedHours'|'manHours'>[],minimum=5){
 const valid=samples.filter(s=>Number.isFinite(s.elapsedHours)&&s.elapsedHours>0&&Number.isFinite(s.manHours)&&s.manHours>0);
 const median=(a:number[])=>{const s=[...a].sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2};
 return {samples:valid.length,medianDuration:valid.length>=minimum?median(valid.map(x=>x.elapsedHours)):null,medianManHours:valid.length>=minimum?median(valid.map(x=>x.manHours)):null,minimum};
}
/** Comparable closed work only. Exact standard version, team size, known execution interval and measured labour for every performer. */
export function comparableSample(d:Record<string,unknown>,taskId:string,logs:Doc[]):StandardSample|null{
 const e=obj(obj(d.taskExecution)[taskId]),snapshot=obj(obj(d.taskStandardSnapshots)[taskId]),people=[...new Set(arr(e.performers))];
 if(d.status!=='closed'||e.status!=='completed'||!snapshot.templateId||!(Number(snapshot.version)>0)||e.blockReason||e.blockedAt||!people.length||people.length!==Number(snapshot.persons))return null;
 const start=Date.parse(str(e.startedAt)),end=Date.parse(str(e.physicalFinishedAt||e.completedAt));if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return null;
 const used=logs.filter(l=>l.data.classCode==='DIRECT'&&!['superseded','void'].includes(str(l.data.status)));
 if(!used.length||used.some(l=>!['recorded','approved'].includes(str(l.data.status))||!people.includes(str(l.data.uid))))return null;
 let manHours=0;const byPerson:Record<string,number>={};
 for(const uid of people){const intervals:Span[]=used.filter(l=>l.data.uid===uid).map(l=>({start:Date.parse(str(l.data.start)),end:Date.parse(str(l.data.end))}));if(!intervals.length||intervals.some(x=>!Number.isFinite(x.start)||!Number.isFinite(x.end)||x.end<=x.start||x.start<start||x.end>end))return null;const sum=intervals.reduce((n,x)=>n+(x.end-x.start)/3600000,0),union=spanHours(intervals);if(Math.abs(sum-union)>1e-6)return null;manHours+=union;byPerson[uid]=union;}
 return manHours>0?{elapsedHours:(end-start)/3600000,manHours,byPerson}:null;
}
export function linkTimeBookings(logs:Doc[]){const linked=new Map<string,Doc[]>();for(const l of logs){const key=str(l.data.woCode)+'|'+str(l.data.taskId);const a=linked.get(key)||[];a.push(l);linked.set(key,a);}return linked;}
export const maintenanceStandardHistoryRoutes={'POST /api/org/mnt/workforce/standard-history':[orgRoute('org.mnt.workforce.standard_history','MNT.view',async(ctx:OrgContext)=>{
 const b=ctx.body,code=str(b.code),taskId=str(b.taskId),root='organizations/'+ctx.orgId;
 if(!isObj(ctx.org.data.modules)||ctx.org.data.modules.MNT!==true||!/^WO\d{8}(?:_[1-9]\d{0,8})?$/.test(code)||!/^[A-Za-z0-9_-]{1,128}$/.test(taskId))throw new HttpError(400,'Choose an authorized activity.');
 const current=await getDoc(root+'/work_orders/'+code),s=await scopeOf(ctx);if(!current||!canAt(ctx,'MNT.view',arr(current.data.path),s))throw new HttpError(403,'Work order access required.');
 const standard=obj(obj(current.data.taskStandardSnapshots)[taskId]);if(!standard.templateId||!(Number(standard.version)>0))return {standard:null,samples:0,medianDuration:null,medianManHours:null,minimum:5,teamEfficiency:null,coverage:'No approved activity standard was captured for this assessment.'};
 const [orders,logs]=await Promise.all([listDocs(root+'/work_orders'),listDocs(root+'/maintenance_time_bookings')]);const linked=linkTimeBookings(logs);
 const samples:StandardSample[]=[];for(const w of orders){if(w.id===current.id||!canAt(ctx,'MNT.view',arr(w.data.path),s))continue;for(const [id,raw] of Object.entries(obj(w.data.taskStandardSnapshots))){const r=obj(raw);if(r.templateId!==standard.templateId||Number(r.version)!==Number(standard.version))continue;const a=comparableSample(w.data,id,linked.get(w.id+'|'+id)||[]);if(a)samples.push(a);}}
 const own=comparableSample(current.data,taskId,linked.get(current.id+'|'+taskId)||[]),earned=Number(standard.standardManHours);
 return {standard,...standardHistory(samples),teamEfficiency:own&&Number.isFinite(earned)&&earned>0?100*earned/own.manHours:null,actualManHours:own?.manHours??null,coverage:'Comparable closed activities only: exact approved template version, matching team size, recorded direct labour for every performer, known start/finish and no recorded blocking. Advisory only; approved standards are never changed automatically.'};
 })]};
