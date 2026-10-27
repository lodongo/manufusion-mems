import {industrySectionOf} from './industryCatalog';
/** Additive financial metadata: no legacy catalogue field is discarded. */
type D=Record<string,unknown>;
const obj=(v:unknown):D=>v&&typeof v==='object'&&!Array.isArray(v)?v as D:{};
const str=(v:unknown)=>typeof v==='string'?v:'';
const arr=(v:unknown):D[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)) as D[]:[];
export function catalogueFinanceSummary(value:unknown){
 const item=obj(value),accounting=obj(item.accounting),resolution=obj(accounting.glResolution);
 const classification=obj(accounting.catalogueClassification),determination=obj(item.accountDetermination);
 const routes=arr(resolution.transactionRoutes);
 return {
  industryScope:item.industryScope==='INDUSTRY_SPECIFIC'?'INDUSTRY_SPECIFIC':'COMMON',
  industryCodes:Array.isArray(item.industryCodes)?item.industryCodes.filter(v=>typeof v==='string'):[],
  mappingStatus:str(resolution.mappingStatus)||str(determination.mappingStatus)||'not_configured',
  glRouteCount:routes.length,
  primaryGlCode:str(routes[0]?.glCode),
  majorBranch:str(classification.majorBranch),
  storesClassCode:str(classification.storesClassCode),
  storesClassName:str(classification.storesClassName),
  usedInProcurement:typeof item.usedInProcurement==='boolean'?item.usedInProcurement:null,
  usedInBudget:typeof item.usedInBudget==='boolean'?item.usedInBudget:null,
  usedInProcurementPosting:typeof item.usedInProcurementPosting==='boolean'?item.usedInProcurementPosting:null,
 };
}
export function catalogueFinanceDetail(value:unknown){
 const item=obj(value),a=obj(item.accounting),gl=obj(a.glResolution),rules=obj(item.accountDetermination);
 const cls=obj(a.catalogueClassification);
 return {
  ...catalogueFinanceSummary(value),
  determinationMode:str(gl.mode)||str(rules.procurementSelectionMode),
  accountPurpose:str(rules.accountPurpose),
  costObjectRequirement:str(gl.costObjectRequirement)||str(rules.costObjectRequirement),
  legalEntityApplicability:str(rules.legalEntityApplicability),
  corporateApplicability:str(rules.corporateApplicability),
  classificationEvidence:str(cls.classificationEvidence),
  materialNumberPattern:str(cls.numberingPattern),
  routes:arr(gl.transactionRoutes).map(r=>({
   event:str(r.event),glCode:str(r.glCode),glName:str(r.glName),status:str(r.status),systemDerived:r.systemDerived===true
  })),
  pendingFinanceApproval:item.pendingFinanceApproval===true,
  sourceOfEligibility:str(rules.sourceOfEligibility),
 };
}
/** Reject malformed new-model catalogues without changing legacy-import validity. */
export function catalogueFinanceErrors(kind:'materials'|'services'|'gl_accounts'|'assets',entries:unknown[],integrated:boolean,requireIndustry=false){
 if(!integrated)return [];
 const errors:string[]=[];
 for(const raw of entries){
  const x=obj(raw),code=str(x.code)||'(unknown)';
  if(integrated){
   if(requireIndustry&&!['COMMON','INDUSTRY_SPECIFIC'].includes(str(x.industryScope)))errors.push(code+': common or industry-specific scope required.');
   else if(x.industryScope!==undefined&&!['COMMON','INDUSTRY_SPECIFIC'].includes(str(x.industryScope)))errors.push(code+': invalid industry scope.');
   if(x.industryScope==='COMMON'&&Array.isArray(x.industryCodes)&&x.industryCodes.length)errors.push(code+': common entry cannot restrict industries.');
   if(x.industryScope==='INDUSTRY_SPECIFIC'&&(!Array.isArray(x.industryCodes)||!x.industryCodes.length||x.industryCodes.some(c=>typeof c!=='string'||!/^IND-[A-V](-[0-9]{3})?$/.test(c)||!industrySectionOf(c))))errors.push(code+': industry-specific record requires valid industry codes.');
  }
  if(kind==='gl_accounts'){
   if(typeof x.usedInProcurement!=='boolean'||typeof x.usedInBudget!=='boolean'||typeof x.usedInProcurementPosting!=='boolean')
    errors.push(code+': procurement/budget/posting fields must be booleans.');
   if(!str(obj(x.accountDetermination).mappingStatus))errors.push(code+': GL mapping status missing.');
   if(x.pendingFinanceApproval===true&&(x.usedInProcurement===true||x.usedInProcurementPosting===true))
    errors.push(code+': proposed Finance account cannot be procurement enabled.');
  }else{
   const a=obj(x.accounting),resolution=obj(a.glResolution),routes=arr(resolution.transactionRoutes);
   if(!str(resolution.mappingStatus)||!routes.length)errors.push(code+': GL routes/status missing.');
   if(routes.some(r=>!str(r.event)||!str(r.glCode)))errors.push(code+': route missing event or GL.');
   if(kind==='materials'&&!['MRO','NON_MRO'].includes(str(obj(a.catalogueClassification).majorBranch)))
    errors.push(code+': MRO / NON_MRO branch missing.');
  }
  if(errors.length>=60)break;
 }
 return errors;
}
