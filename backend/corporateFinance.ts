import {HttpError,getDoc,isObj,listDocs,nowIso,str,writeDoc} from './core';
import {orgRoute,type OrgContext} from './guards';

export type CorporateFundingMethod='corporate_budget'|'shareholder_funding'|'service_recharge'|'hybrid';
export type CorporateCostClass='shareholder'|'shared_service'|'direct_service'|'mixed';
export type AllocationBasis='fixed_percent'|'time'|'headcount'|'usage'|'transactions'|'revenue'|'direct';
export type CorporateAllocation={
 legalEntityId:string;costCenterId:string;percentage:number;
};
export type CorporateFunctionFunding={
 functionCode:string;homeDepartmentId:string;homeCostCenterId:string;
 costClass:CorporateCostClass;fundingMethod:CorporateFundingMethod;
 allocationBasis:AllocationBasis;allocations:CorporateAllocation[];
 rationale:string;serviceAgreementRef:string;allocationEvidence:string;
 budgetReference:string;effectiveFrom:string;
};
export type CorporateFinancialHome={
 legalEntityId:string;headquartersSiteId:string;
 functions:CorporateFunctionFunding[];
 status:'draft';version:number;updatedAt:string;updatedBy:string;
};
export type FinanceNode={id:string;name:string;code:string;level:string;parentId:string;status:string;};
export type FinanceReferences={
 legalEntities:FinanceNode[];
 sites:FinanceNode[];
 departments:FinanceNode[];
 costCenters:FinanceNode[];
 functions:Array<{code:string;name:string;enabled:boolean}>;
};
const key=(org:string)=>`organizations/${org}/corporate_finance/home`;
const short=(x:unknown,max=300)=>str(x).trim().slice(0,max);
const validDate=(s:string)=>!s||/^\d{4}-\d{2}-\d{2}$/.test(s);
const checkSum=(rows:CorporateAllocation[])=>Math.abs(rows.reduce((a,b)=>a+b.percentage,0)-100)<0.0001;
export function defaultCorporateFinancialHome():CorporateFinancialHome{
 return {legalEntityId:'',headquartersSiteId:'',functions:[],status:'draft',version:0,updatedAt:'',updatedBy:''};
}
const pathToEntity=(id:string,nodes:Map<string,FinanceNode>)=>{
 let cursor=id;const visited=new Set<string>();
 while(cursor&&!visited.has(cursor)){
  visited.add(cursor);const n=nodes.get(cursor);
  if(!n||n.status==='inactive')return '';
  if(n.level==='legal_entity')return n.id;
  cursor=n.parentId;
 }
 return '';
};
const belongs=(nodeId:string,ancestorId:string,nodes:Map<string,FinanceNode>)=>{
 let id=nodeId;const seen=new Set<string>();
 while(id&&!seen.has(id)){
  if(id===ancestorId)return true;
  seen.add(id);id=nodes.get(id)?.parentId||'';
 }
 return false;
};
export function validateCorporateFinancialHome(
 raw:unknown,refs:FinanceReferences,
):Omit<CorporateFinancialHome,'version'|'updatedAt'|'updatedBy'>{
 if(!isObj(raw)||!Array.isArray(raw.functions)||raw.functions.length>60)
  throw new HttpError(400,'Provide a financial home and at most 60 corporate function mappings.');
 const nodeList=[...refs.legalEntities,...refs.sites,...refs.departments,...refs.costCenters];
 const nodes=new Map(nodeList.map(x=>[x.id,x]));
 const entity=short(raw.legalEntityId,128),site=short(raw.headquartersSiteId,128);
 if(!refs.legalEntities.some(e=>e.id===entity))
  throw new HttpError(400,'Select an existing registered legal entity as the Corporate Office financial home.');
 if(!refs.sites.some(n=>n.id===site)||!belongs(site,entity,nodes))
  throw new HttpError(400,'Select a headquarters site belonging to the corporate employing legal entity.');
 const enabledFunctions=new Set(refs.functions.filter(f=>f.enabled).map(f=>f.code));
 const mappings:CorporateFunctionFunding[]=raw.functions.map(value=>{
  if(!isObj(value))throw new HttpError(400,'Invalid corporate function funding row.');
  const code=short(value.functionCode,20);
  if(!enabledFunctions.has(code))throw new HttpError(400,'Funding may only reference an enabled configured corporate function.');
  const dept=short(value.homeDepartmentId,128),cost=short(value.homeCostCenterId,128);
  const costClass=short(value.costClass,30) as CorporateCostClass;
  const fundingMethod=short(value.fundingMethod,30) as CorporateFundingMethod;
  const allocationBasis=short(value.allocationBasis,30) as AllocationBasis;
  if(!['shareholder','shared_service','direct_service','mixed'].includes(costClass)||
    !['corporate_budget','shareholder_funding','service_recharge','hybrid'].includes(fundingMethod)||
    !['fixed_percent','time','headcount','usage','transactions','revenue','direct'].includes(allocationBasis))
    throw new HttpError(400,'Choose valid corporate cost type, funding and allocation methods.');
  if(!refs.departments.some(n=>n.id===dept)||!belongs(dept,site,nodes)||
     !refs.costCenters.some(n=>n.id===cost&&n.parentId===dept))
    throw new HttpError(400,'Each function must use a real Department and Cost Centre under the Corporate HQ site.');
  const rawAllocation=value.allocations;
  if(!Array.isArray(rawAllocation)||rawAllocation.length>50||!rawAllocation.length)
   throw new HttpError(400,'Enter at least one funding beneficiary. Total distribution must equal 100%.');
  const allocations=rawAllocation.map(row=>{
   if(!isObj(row))throw new HttpError(400,'Invalid corporate funding beneficiary.');
   const legalEntityId=short(row.legalEntityId,128),costCenterId=short(row.costCenterId,128);
   if(!refs.legalEntities.some(n=>n.id===legalEntityId))
    throw new HttpError(400,'All funding beneficiaries must be active legal entities of this organization.');
   if(costCenterId&&(!refs.costCenters.some(n=>n.id===costCenterId)||
      pathToEntity(costCenterId,nodes)!==legalEntityId))
    throw new HttpError(400,'Each beneficiary Cost Centre must belong to the selected benefiting legal entity.');
   const percentage=Number(row.percentage);
   if(!Number.isFinite(percentage)||percentage<0||percentage>100)
    throw new HttpError(400,'Funding allocation percentage must be between 0 and 100.');
   return {legalEntityId,costCenterId,percentage};
  });
  if(!checkSum(allocations))
   throw new HttpError(400,'Corporate function cost allocation must total 100%.');
  const unique=new Set(allocations.map(a=>a.legalEntityId+'|'+a.costCenterId));
  if(unique.size!==allocations.length)throw new HttpError(400,'Each beneficiary Cost Centre may appear only once.');
  const crossCompany=allocations.some(a=>a.legalEntityId!==entity&&a.percentage>0);
  if(costClass==='shareholder'&&(crossCompany||fundingMethod==='service_recharge'))
   throw new HttpError(400,'Shareholder-only governance activity cannot be recharged to operating subsidiaries.');
  if(['corporate_budget','shareholder_funding'].includes(fundingMethod)&&crossCompany)
   throw new HttpError(400,'Corporate-budget-funded costs must remain in the legal employing entity. Choose service recharge or hybrid instead.');
  const agreement=short(value.serviceAgreementRef,180),evidence=short(value.allocationEvidence,300);
  if(crossCompany&&(!agreement||!evidence))
   throw new HttpError(400,'Cross-entity funding requires a service agreement reference and documented benefit/allocation evidence.');
  const effectiveFrom=short(value.effectiveFrom,10);
  if(!validDate(effectiveFrom))throw new HttpError(400,'Choose a valid funding start date.');
  return {functionCode:code,homeDepartmentId:dept,homeCostCenterId:cost,costClass,fundingMethod,allocationBasis,allocations,
   serviceAgreementRef:agreement,allocationEvidence:evidence,
   rationale:short(value.rationale,500),budgetReference:short(value.budgetReference,160),effectiveFrom};
 });
 if(new Set(mappings.map(x=>x.functionCode)).size!==mappings.length)
  throw new HttpError(400,'Each corporate function must have only one current financial home mapping.');
 return {legalEntityId:entity,headquartersSiteId:site,functions:mappings,status:'draft'};
}
async function references(ctx:OrgContext):Promise<FinanceReferences>{
 const [docs,corp]=await Promise.all([
  listDocs(`organizations/${ctx.orgId}/structure`),
  getDoc(`organizations/${ctx.orgId}/corporate_governance/default`),
 ]);
 const nodes=docs.filter(d=>str(d.data.status)!=='inactive')
  .map(d=>({id:d.id,name:str(d.data.name),code:str(d.data.code),level:str(d.data.level),
   parentId:str(d.data.parentId),status:str(d.data.status)}));
 const funcs=Array.isArray(corp?.data.functions)?corp.data.functions.filter(isObj)
  .map(f=>({code:str(f.code),name:str(f.name),enabled:f.enabled!==false})):[];
 return {legalEntities:nodes.filter(x=>x.level==='legal_entity'),
 sites:nodes.filter(x=>x.level==='site'),
 departments:nodes.filter(x=>x.level==='department'),
 costCenters:nodes.filter(x=>x.level==='cost_center'),functions:funcs};
}
export const corporateFinanceRoutes={
 'POST /api/org/corporate/finance/read':[orgRoute('org.corporate.finance.read','ADM.structure',async ctx=>{
  const [d,refs]=await Promise.all([getDoc(key(ctx.orgId)),references(ctx)]);
  return {config:d?.data as CorporateFinancialHome|undefined||defaultCorporateFinancialHome(),
   saved:!!d,references:refs};
 })],
 'POST /api/org/corporate/finance/save':[orgRoute('org.corporate.finance.save','ADM.structure',async ctx=>{
  const refs=await references(ctx);
  const config=validateCorporateFinancialHome(ctx.body.config,refs);
  const prior=await getDoc(key(ctx.orgId));
  const oldVersion=Number(prior?.data.version||0);
  if(Number(ctx.body.expectedVersion)!==oldVersion)
   throw new HttpError(409,'Corporate financial home was updated elsewhere. Reload before saving.');
  const version=oldVersion+1;
  const saved:CorporateFinancialHome={...config,version,updatedAt:nowIso(),updatedBy:ctx.uid};
  await writeDoc(key(ctx.orgId),saved);
  return {ok:true,config:saved,status:'draft',
   warning:'This is a governed planning configuration, not payroll allocation, an approved budget or an intercompany invoice.'};
 })],
};
