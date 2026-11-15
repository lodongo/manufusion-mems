import {TIME_CLASSES} from './maintenanceTimeCore';
export type TimeClass={code:string;label:string;productive:boolean;requiresOrder:boolean;delayOwner:string};
export type TimePolicy={version:number;approvalEnabled:boolean;classes:TimeClass[]};
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function defaultTimePolicy():TimePolicy{return {version:0,approvalEnabled:false,classes:TIME_CLASSES.map(c=>({...c,delayOwner:c.code==='WAITING'?'Unassigned delay':''}))};}
export function validateTimePolicy(raw:unknown):Omit<TimePolicy,'version'>{
 const r=obj(raw);if(typeof r.approvalEnabled!=='boolean'||!Array.isArray(r.classes)||r.classes.length<1||r.classes.length>40)throw Error('Configure up to 40 time classifications.');
 const used=new Set<string>(),classes=r.classes.map(v=>{const c=obj(v),code=typeof c.code==='string'?c.code.trim().toUpperCase():'',label=typeof c.label==='string'?c.label.trim():'',delayOwner=typeof c.delayOwner==='string'?c.delayOwner.trim():'';
 if(!/^[A-Z][A-Z0-9_]{1,29}$/.test(code)||used.has(code)||!label||label.length>80||typeof c.productive!=='boolean'||delayOwner.length>80)throw Error('Time classifications require unique codes, labels and productive flags.');
 used.add(code);return {code,label,productive:code==='DIRECT'?true:c.productive,requiresOrder:code==='DIRECT',delayOwner:code==='DIRECT'?'':delayOwner};});
 if(!used.has('DIRECT'))throw Error('The DIRECT execution classification cannot be removed.');
 return {approvalEnabled:r.approvalEnabled,classes};
}
export const completedStatus=(approvalRequired:boolean)=>approvalRequired?'pending_approval':'recorded';
