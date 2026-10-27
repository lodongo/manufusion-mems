/** Integrated master release gate.
 * A JSON label alone is never enough to lift pending GL Finance-review restrictions.
 * This gate is called by both Proc/Finance and Asset dictionary importers before
 * any approved integrated master is persisted.
 */
type Data=Record<string,unknown>;
const object=(v:unknown):Data=>v&&typeof v==='object'&&!Array.isArray(v)?v as Data:{};
const entries=(v:unknown):Data[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)) as Data[]:[];
const text=(v:unknown)=>typeof v==='string'?v:'';
export type IntegratedMasterKind='gl_accounts'|'materials'|'services'|'assets';
export function integratedReleaseProblems(kind:IntegratedMasterKind,raw:unknown):string[]{
 const doc=object(raw),fin=object(doc.financialIntegration);
 if(!Object.keys(fin).length)return [];
 const problems:string[]=[];
 const fail=(s:string)=>{if(problems.length<15)problems.push(s);};
 if(fin.catalogueRelease!=='APPROVED')fail('Finance review draft cannot replace the live catalogue.');
 // A reviewed reference alone must never lift an import restriction.
 if(fin.notAuthorizedForPosting===true||fin.mappingReviewRequired===true)
  fail('Financial master still requires Finance approval and posting controls.');
 const approval=object(fin.financeReleaseApproval);
 if(!text(approval.approvedBy)||!text(approval.approvedAt)||!text(approval.approvalReference))
  fail('Approved release requires a traceable Finance sign-off reference.');
 const key=kind==='gl_accounts'?'accounts':kind==='materials'?'materials':kind==='services'?'services':'assetClasses';
 const rows=entries(doc[key]);
 if(!rows.length)fail('No approved entries are present.');
 for(const row of rows){
  const code=text(row.code),resolution=object(object(row.accounting).glResolution);
  const determination=object(row.accountDetermination);
  if(kind==='gl_accounts'){
   if(row.pendingFinanceApproval===true||determination.mappingStatus!=='approved'){
    fail(code+': unapproved GL account still in the master.');continue;
   }
   if(row.usedInProcurementPosting===true&&row.usedInProcurement!==true)
    fail(code+': procurement posting flag requires procurement eligibility.');
  }else{
   if(resolution.mappingStatus!=='approved')fail(code+': unapproved financial mapping remains.');
   if(resolution.referenceOnly===true&&resolution.postingEnabled===true)
    fail(code+': reference-only catalogue cannot authorise posting.');
   if(entries(resolution.transactionRoutes).some(r=>r.postingActive===true &&
      r.status!=='approved'))
     fail(code+': unapproved route is marked active.');
  }
 }
 return problems;
}
