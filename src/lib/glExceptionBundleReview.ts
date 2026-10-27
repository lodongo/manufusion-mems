/** Bulk Finance reference review for the five proposed inventory GL extensions.
 * Pure and non-posting. A reference review never approves account adoption, changes
 * an operational transaction, or sets catalogueRelease to APPROVED.
 */
type Row=Record<string,unknown>;
const obj=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const arr=(v:unknown):Row[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)) as Row[]:[];
const str=(v:unknown)=>typeof v==='string'?v:'';
export const INVENTORY_EXTENSION_GROUPS=[
  {code:'10304080',name:'Safety and PPE Supplies Inventory',category:'MAT-010',count:105},
  {code:'10304090',name:'IT and Telecommunications Supplies Inventory',category:'MAT-012',count:128},
  {code:'10307120',name:'Specialised Industrial and Other Materials Inventory',category:'MAT-020',count:197},
  {code:'10307130',name:'Advanced Electronics and Semiconductor Materials Inventory',category:'MAT-020',count:6},
  {code:'10307140',name:'Scientific and Biofabrication Materials Inventory',category:'MAT-020',count:3},
] as const;
export const EXCEPTION_REFERENCE_STATUS='reference_validated_pending_finance_approval';
export interface ReferenceReview{
  eligible:boolean;recordCount:number;affectedMaterialCount:number;
  byAccount:Array<{code:string;name:string;category:string;expected:number;actual:number;valid:boolean}>;
  errors:string[];warnings:string[];
  bundleId:string;referenceGlVersion:string;
  note:string;
}
const fail=(arr:string[],message:string)=>{if(arr.length<35)arr.push(message);};
export function auditFiveGlExtensions(glDocument:unknown,materialsDocument:unknown):ReferenceReview{
  const gl=obj(glDocument),material=obj(materialsDocument);
  const glFin=obj(gl.financialIntegration),matFin=obj(material.financialIntegration);
  const errors:string[]=[],warnings:string[]=[];
  const accountRows=arr(gl.accounts),materialRows=arr(material.materials);
  const accounts=new Map(accountRows.map(a=>[str(a.code),a]));
  const bundleId=str(glFin.masterBundleId),glVersion=str(glFin.referenceGLVersion);
  if(!bundleId||bundleId!==str(matFin.masterBundleId))fail(errors,'The two files must reference the same non-empty financial master bundle ID.');
  if(!glVersion||glVersion!==str(matFin.referenceGLVersion)||glVersion!==str(gl.version))
    fail(errors,'The material/GL reference version does not match the GL master version.');
  if(!accountRows.length||!materialRows.length)fail(errors,'Upload the complete GL and Materials Master files, not filtered excerpts.');
  if(glFin.catalogueRelease!=='DRAFT_FINANCE_REVIEW'||matFin.catalogueRelease!=='DRAFT_FINANCE_REVIEW'||
     glFin.notAuthorizedForPosting!==true||matFin.notAuthorizedForPosting!==true)
     fail(errors,'This reference workflow accepts Finance-review drafts only, with posting explicitly disabled.');
  const proposed=INVENTORY_EXTENSION_GROUPS.map(group=>{
    const a=accounts.get(group.code),det=obj(a?.accountDetermination);
    if(!a)fail(errors,group.code+': proposed GL account is missing.');
    else {
      if(str(a.name)!==group.name||str(a.groupCode)!==group.code.slice(0,5))
        fail(errors,group.code+': inventory account identity/group differs from the reviewed proposal.');
      if(str(a.normalBalance).toLowerCase()!=='debit'||!str(a.accountType).toLowerCase().includes('balance sheet'))
        fail(errors,group.code+': proposed GL must remain debit-normal, balance-sheet inventory.');
      if(a.pendingFinanceApproval!==true||str(det.mappingStatus)!=='finance_review_required')
        fail(errors,group.code+': expected an unapproved draft GL extension.');
      if(a.usedInProcurement!==false||a.usedInProcurementPosting!==false||a.usedInBudget!==false)
        fail(errors,group.code+': draft inventory account is incorrectly enabled for selection/posting.');
    }
    return {...group,actual:0,valid:!!a};
  });
  const counts=new Map<string,number>(),seen=new Set<string>();
  let exceptions=0;
  for(const item of materialRows){
    const code=str(item.code);
    if(!code||seen.has(code))fail(errors,'Blank or duplicate material code: '+code);
    seen.add(code);
    const accounting=obj(item.accounting),resolution=obj(accounting.glResolution);
    if(resolution.mappingStatus!=='finance_review_required')continue;
    exceptions++;
    const routes=arr(resolution.transactionRoutes);
    const receipt=routes.filter(r=>r.event==='GOODS_RECEIPT'&&r.accountRole==='inventoryReceipt');
    const proposals=routes.filter(r=>r.status==='finance_review_required'||r.proposedAccountExtension===true);
    if(receipt.length!==1||proposals.length!==1||proposals[0]!==receipt[0])
      fail(errors,code+': needs exactly one flagged inventory-receipt route, not expense or service posting.');
    const route=receipt[0]??{},candidate=proposed.find(p=>p.code===str(route.glCode));
    if(!candidate)fail(errors,code+': unrecognized Finance-review route '+str(route.glCode));
    else {
      counts.set(candidate.code,(counts.get(candidate.code)||0)+1);
      if(str(item.categoryCode)!==candidate.category)
        fail(errors,code+': material category and proposed inventory GL are inconsistent.');
      if(str(obj(accounting.suggestedAccounts).inventoryReceipt)!==candidate.code)
        fail(errors,code+': suggested inventory account differs from the proposed receipt route.');
      if(str(route.glName)!==candidate.name)
        fail(errors,code+': proposed GL name differs from registered master.');
    }
    if(resolution.postingEnabled===true||routes.some(r=>r.postingActive===true))
      fail(errors,code+': an unapproved material route was enabled for posting.');
    if(!['MRO','NON_MRO'].includes(str(obj(accounting.catalogueClassification).majorBranch)))
      fail(errors,code+': MRO/Non-MRO classification is missing.');
    if(str(obj(accounting.catalogueClassification).majorBranch)==='MRO' &&
        (resolution.mode!=='work_order_context'||resolution.maintenanceStrategyRequiredForConsumption!==true))
      fail(errors,code+': MRO expense determination must remain work-order context driven.');
  }
  const byAccount=proposed.map(group=>{
    const actual=counts.get(group.code)||0;
    if(actual!==group.count)fail(errors,group.code+': expected '+group.count+' mappings but received '+actual+'.');
    return {code:group.code,name:group.name,category:group.category,expected:group.count,actual,
      valid:group.valid&&actual===group.count};
  });
  if(exceptions!==439)fail(errors,'The expected 439 Finance-reference exceptions were not all present ('+exceptions+' found).');
  if(glFin.mappingReviewRequired!==true||matFin.mappingReviewRequired!==true)
    warnings.push('This is only reference validation; the full master-bundle mapping review must remain required.');
  return {eligible:errors.length===0,recordCount:materialRows.length,affectedMaterialCount:exceptions,
    byAccount,errors,warnings,bundleId,referenceGlVersion:glVersion,
    note:'Reference integrity only. Five GL additions remain unapproved and tenant adoption/posting remain disabled.'};
}

export interface PreparedFiveGlReview{gl:Row;materials:Row;summary:ReferenceReview}
/** Records a deliberate reference-bundle review, not Finance approval or activation.
 * Makes unresolved references distinguishable from structurally validated ones.
 */
export function prepareFiveGlReferenceReview(glDocument:unknown,materialsDocument:unknown,reviewer:string,reason:string):PreparedFiveGlReview{
  const summary=auditFiveGlExtensions(glDocument,materialsDocument);
  if(!summary.eligible)throw new Error(summary.errors.join(' | ')||'Finance reference bundle validation failed.');
  if(reviewer.trim().length<3||reason.trim().length<12)
    throw new Error('Enter a reviewer reference and a review reason of at least twelve characters.');
  const gl=JSON.parse(JSON.stringify(glDocument)) as Row;
  const materials=JSON.parse(JSON.stringify(materialsDocument)) as Row;
  const codes=new Set<string>(INVENTORY_EXTENSION_GROUPS.map(x=>x.code));
  const reviewedAt=new Date().toISOString();
  const referenceReview={status:'REFERENCE_VALIDATED_FINANCE_APPROVAL_REQUIRED',reviewerReference:reviewer.trim().slice(0,120),
    reason:reason.trim().slice(0,500),reviewedAt,masterBundleId:summary.bundleId,matchedMaterials:439,
    proposedInventoryAccountCodes:[...codes],tenantAdoptionRequired:true,doesNotAuthorizePosting:true,
    fiveGlExtensionsStillPendingApproval:true};
  gl.referenceExceptionReview=referenceReview;
  materials.referenceExceptionReview=referenceReview;
  for(const row of arr(gl.accounts))if(codes.has(str(row.code))){
    row.referenceReviewStatus=EXCEPTION_REFERENCE_STATUS;
    row.pendingFinanceApproval=true;
    row.usedInProcurement=false;
    row.usedInProcurementPosting=false;
    row.usedInBudget=false;
    obj(row.accountDetermination).mappingStatus=EXCEPTION_REFERENCE_STATUS;
  }
  for(const item of arr(materials.materials)){
    const accounting=obj(item.accounting),resolution=obj(accounting.glResolution);
    if(resolution.mappingStatus!=='finance_review_required')continue;
    resolution.mappingStatus=EXCEPTION_REFERENCE_STATUS;
    resolution.postingEnabled=false;
    resolution.referenceOnly=true;
    for(const route of arr(resolution.transactionRoutes)){
      if(route.status==='finance_review_required'){
        route.status=EXCEPTION_REFERENCE_STATUS;
        route.postingActive=false;
        route.financialExtensionStillPendingApproval=true;
      }
    }
  }
  // Deliberately leave catalogueRelease=DRAFT_FINANCE_REVIEW and notAuthorizedForPosting=true.
  return {gl,materials,summary};
}
