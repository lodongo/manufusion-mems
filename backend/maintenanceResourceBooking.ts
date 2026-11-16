import {str,type Obj} from './core';
import {object,rows,texts} from './maintenanceDomain';
export function resourceWindow(d:Obj){const start=str(d.scheduledStart)||str(d.expectedStart),end=str(d.scheduledEnd)||str(d.expectedEnd)||start;return /^\d{4}-\d{2}-\d{2}$/.test(start)&&/^\d{4}-\d{2}-\d{2}$/.test(end)&&end>=start?{start,end}:null;}
export function bookingConflict(orders:{id:string;data:Obj}[],woId:string,taskId:string,requirementId:string,tag:string,start:string,end:string){
 for(const wo of orders){if(['closed','cancelled'].includes(str(wo.data.status)))continue;for(const [tid,p] of Object.entries(object(wo.data.taskPlanning)))for(const [rid,v] of Object.entries(object(object(p).resourceBookings))){if(wo.id===woId&&tid===taskId&&rid===requirementId)continue;const b=object(v);if(!texts(b.assetTags).includes(tag))continue;const otherStart=str(b.start),otherEnd=str(b.end);if(otherStart&&otherEnd&&start<=otherEnd&&otherStart<=end)return wo.id;}}
 return '';
}
export function requirementCovered(r:Obj,p:Obj,window:{start:string;end:string}|null){
 const b=object(object(p.resourceBookings)[str(r.id)]);if(!window||b.start!==window.start||b.end!==window.end||!b.at)return false;
 return b.source==='registered'&&texts(b.assetTags).length>=Number(r.quantity)||b.source==='external'&&!!str(b.reference)&&Number(b.quantity)>=Number(r.quantity)||!r.assetClassCode&&b.source==='legacy'&&!!str(b.reference)&&Number(b.quantity)>=Number(r.quantity);
}
export function resourceAvailability(d:Obj,t:Obj,p:Obj){
 const requirements=rows(t.toolRequirements),tools=requirements.filter(r=>r.kind==='Tools'),equipment=requirements.filter(r=>r.kind==='Equipment'),setup=object(t.assessmentSetup),allocation=object(p.allocation),window=resourceWindow(d);
 const modern=typeof setup.equipment==='boolean';
 const toolbox=modern?(setup.tools!==true||t.toolboxSufficient!==true||allocation.toolsReady===true):allocation.toolsReady===true;
 return {tools:toolbox&&tools.every(r=>requirementCovered(r,p,window)||!modern&&!r.assetClassCode&&allocation.toolsReady===true),equipment:equipment.every(r=>requirementCovered(r,p,window)||!modern&&!r.assetClassCode&&allocation.toolsReady===true)};
}
