import {HttpError,getDoc,isObj,listDocs,nowIso,str,writeDoc} from './core';
import {orgRoute,type OrgContext} from './guards';

export type CorporateFunction={
 code:string;name:string;description:string;enabled:boolean;
 headRoleCode:string;reportsToCode:string;oversightEntityIds:string[];
};
export type GovernanceBody={
 code:string;name:string;kind:'board'|'committee'|'council'|'forum';
 description:string;enabled:boolean;chairRoleCode:string;
 scope:'group'|'entities';entityIds:string[];
};
export type CorporateDesign={
 office:{name:string;description:string;parentGroupNodeId:string;enabled:boolean};
 functions:CorporateFunction[];bodies:GovernanceBody[];
 version:number;updatedAt:string;updatedBy:string;
};
const FUNCTION_DEFAULTS:Array<[string,string,string]>= [
 ['FIN','Group Finance','Financial strategy, reporting, treasury and assurance'],
 ['HR','Group Human Resources','People strategy, talent, employee policies and development'],
 ['ENG','Group Engineering','Asset care, reliability, technology and standards'],
 ['PRC','Group Procurement','Category sourcing, suppliers and procurement standards'],
 ['IT','Group IT & Digital','Enterprise systems, information security and digital transformation'],
 ['LEG','Group Legal & Compliance','Legal affairs, compliance and regulatory coordination'],
 ['STR','Group Strategy','Strategy execution, transformation and enterprise performance'],
 ['SUS','Group Sustainability','Climate, environment and sustainability programmes'],
];
const BODY_DEFAULTS:Array<[string,string,GovernanceBody['kind'],string]>= [
 ['BOARD','Group Board of Directors','board','Group oversight and reserved governance matters'],
 ['EXCO','Group Executive Committee','committee','Enterprise coordination and executive decisions'],
 ['AUDIT','Audit & Risk Committee','committee','Financial oversight, internal controls and enterprise risk'],
 ['PEOPLE','People & Remuneration Committee','committee','People policy, succession and remuneration oversight'],
 ['INVEST','Investment & Capital Committee','committee','Capital investment and strategic project oversight'],
 ['SHEQ','Safety, Health, Environment & Quality Committee','committee','Group safety, quality and sustainability governance'],
];
export function corporateDefaults():CorporateDesign {
 return {
  office:{name:'Corporate Office',description:'Group-wide corporate management and shared functional oversight, separate from legal entities.',parentGroupNodeId:'',enabled:true},
  functions:FUNCTION_DEFAULTS.map(([code,name,description])=>({code,name,description,enabled:true,headRoleCode:'',reportsToCode:'',oversightEntityIds:[]})),
  bodies:BODY_DEFAULTS.map(([code,name,kind,description])=>({code,name,kind,description,enabled:true,chairRoleCode:'',scope:'group',entityIds:[]})),
  version:0,updatedAt:'',updatedBy:'',
 };
}
const key=(org:string)=>`organizations/${org}/corporate_governance/default`;
const clean=(v:unknown,max:number)=>str(v).trim().slice(0,max);
const codeOk=(v:string)=>/^[A-Z][A-Z0-9_]{1,19}$/.test(v);
const uniqueCodes=(items:Array<{code:string}>,kind:string)=>{
 if(new Set(items.map(x=>x.code)).size!==items.length)throw new HttpError(400,'Duplicate '+kind+' code.');
};
export function validateCorporateDesign(
 raw:unknown,
 entities:Set<string>,
 groups:Set<string>,
 roles:Set<string>,
):Omit<CorporateDesign,'version'|'updatedAt'|'updatedBy'>{
 if(!isObj(raw)||!isObj(raw.office)||!Array.isArray(raw.functions)||!Array.isArray(raw.bodies)||
   raw.functions.length>60||raw.bodies.length>60)
  throw new HttpError(400,'Provide a Corporate Office with up to 60 functions and 60 governance bodies.');
 const officeName=clean(raw.office.name,120),parent=clean(raw.office.parentGroupNodeId,128);
 if(!officeName)throw new HttpError(400,'Corporate Office name is required.');
 if(parent&&!groups.has(parent))throw new HttpError(400,'Corporate Office group anchor must be an existing active upper-level unit.');
 const oversight=(value:unknown)=>{
  if(!Array.isArray(value)||value.length>200)throw new HttpError(400,'Invalid legal-entity oversight selection.');
  const ids=value.map(x=>clean(x,128));
  if(ids.some(x=>!entities.has(x))||new Set(ids).size!==ids.length)
   throw new HttpError(400,'Oversight must reference distinct active legal entities within this organization.');
  return ids;
 };
 const role=(v:unknown)=>{
  const code=clean(v,65);
  if(code&&!roles.has(code))throw new HttpError(400,'Select a job role from the current organization, or leave vacant.');
  return code;
 };
 const funcs:CorporateFunction[]=raw.functions.map(value=>{
  if(!isObj(value))throw new HttpError(400,'Invalid corporate function.');
  const code=clean(value.code,20).toUpperCase(),name=clean(value.name,120);
  if(!codeOk(code)||!name)throw new HttpError(400,'Each corporate function needs a valid code and name.');
  return {code,name,description:clean(value.description,500),enabled:value.enabled!==false,
   headRoleCode:role(value.headRoleCode),reportsToCode:clean(value.reportsToCode,20).toUpperCase(),
   oversightEntityIds:oversight(value.oversightEntityIds)};
 });
 uniqueCodes(funcs,'corporate function');
 const functionCodes=new Set(funcs.map(x=>x.code));
 const parentMap=new Map(funcs.map(x=>[x.code,x.reportsToCode]));
 for(const f of funcs){
  if(f.reportsToCode&&(!functionCodes.has(f.reportsToCode)||f.reportsToCode===f.code))
   throw new HttpError(400,'Corporate reporting function must refer to another configured function.');
  let current=f.code;
  const seen=new Set<string>();
  while(current){
   if(seen.has(current))throw new HttpError(400,'Corporate function reporting relationships contain a cycle.');
   seen.add(current);current=parentMap.get(current)||'';
  }
 }
 const bodies:GovernanceBody[]=raw.bodies.map(value=>{
  if(!isObj(value))throw new HttpError(400,'Invalid governance body.');
  const code=clean(value.code,20).toUpperCase(),name=clean(value.name,120);
  const kind=clean(value.kind,20) as GovernanceBody['kind'];
  const scope=clean(value.scope,20) as GovernanceBody['scope'];
  if(!codeOk(code)||!name||!['board','committee','council','forum'].includes(kind)||
      !['group','entities'].includes(scope))throw new HttpError(400,'Invalid governance body definition.');
  const entityIds=oversight(value.entityIds);
  if(scope==='entities'&&!entityIds.length)
   throw new HttpError(400,'Legal-entity governance requires selecting one or more active legal entities.');
  return {code,name,kind,scope,description:clean(value.description,500),enabled:value.enabled!==false,
   chairRoleCode:role(value.chairRoleCode),entityIds:scope==='group'?[]:entityIds};
 });
 uniqueCodes(bodies,'governance body');
 return {office:{name:officeName,description:clean(raw.office.description,500),
  parentGroupNodeId:parent,enabled:raw.office.enabled!==false},functions:funcs,bodies};
}
async function references(ctx:OrgContext){
 const [structure,positions]=await Promise.all([
  listDocs(`organizations/${ctx.orgId}/structure`),
  listDocs(`organizations/${ctx.orgId}/positions`),
 ]);
 const entities=structure.filter(x=>str(x.data.level)==='legal_entity'&&str(x.data.status)!=='inactive')
  .map(x=>({id:x.id,name:str(x.data.name),code:str(x.data.code)}))
  .sort((a,b)=>a.name.localeCompare(b.name));
 const groups=structure.filter(x=>str(x.data.level)==='group'&&str(x.data.status)!=='inactive')
  .map(x=>({id:x.id,name:str(x.data.name),code:str(x.data.code)}));
 const roles=positions.map(x=>({code:x.id,title:str(x.data.title),operatingLevel:str(x.data.operatingLevel)}))
  .sort((a,b)=>a.title.localeCompare(b.title));
 return {entities,groups,roles};
}
export const corporateGovernanceRoutes={
 'POST /api/org/corporate/read':[orgRoute('org.corporate.read','ADM.structure',async ctx=>{
  const [doc,refs]=await Promise.all([getDoc(key(ctx.orgId)),references(ctx)]);
  return {config:doc?.data as CorporateDesign|undefined||corporateDefaults(),
   saved:!!doc,entities:refs.entities,groups:refs.groups,roles:refs.roles};
 })],
 'POST /api/org/corporate/save':[orgRoute('org.corporate.save','ADM.structure',async ctx=>{
  const refs=await references(ctx);
  const config=validateCorporateDesign(ctx.body.config,
   new Set(refs.entities.map(x=>x.id)),new Set(refs.groups.map(x=>x.id)),
   new Set(refs.roles.map(x=>x.code)));
  const prior=await getDoc(key(ctx.orgId));
  if(prior&&Number(ctx.body.expectedVersion)!==Number(prior.data.version||0))
   throw new HttpError(409,'Corporate governance was updated elsewhere. Reload before saving changes.');
  if(!prior&&Number(ctx.body.expectedVersion)!==0)
   throw new HttpError(409,'Corporate governance version changed. Reload before saving.');
  const version=Number(prior?.data.version||0)+1;
  const saved:CorporateDesign={...config,version,updatedAt:nowIso(),updatedBy:ctx.uid};
  await writeDoc(key(ctx.orgId),saved);
  return {ok:true,version,config:saved};
 })],
};
