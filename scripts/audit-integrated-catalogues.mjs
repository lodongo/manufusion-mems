/** Read-only cross-master validator. Never imports, approves or posts any transaction.
 * Usage: node scripts/audit-integrated-catalogues.mjs GL.json Materials.json Services.json Assets.json [--strict]
 * In strict mode, unresolved Finance-review mappings and nonapproved releases fail.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const KINDS=[['gl','accounts'],['materials','materials'],['services','services'],['assets','assetClasses']];
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const arr=x=>Array.isArray(x)?x:[];
const str=x=>typeof x==='string'?x:'';
const validIndustry=x=>typeof x==='string'&&/^IND-[A-V](-[0-9]{3})?$/.test(x);
const append=(a,s)=>{if(a.length<100)a.push(s);};

/** Can be used from tests without file IO. */
export function auditIntegratedMasterBundle(input,{strict=false}={}){
 const docs=Object.fromEntries(KINDS.map(([k])=>[k,obj(input[k])]));
 const errors=[],warnings=[],counts={},coverage={};
 const bundleIds=new Set(),glVersions=new Set(),industryVersions=new Set();
 for(const [kind,field] of KINDS){
  const d=docs[kind],rows=arr(d[field]),codes=new Set();
  counts[kind]=rows.length;
  if(!rows.length)append(errors,kind+': missing '+field+' records');
  for(const row of rows){
   const code=str(obj(row).code);
   if(!code||codes.has(code))append(errors,kind+': blank or duplicate code '+code);
   codes.add(code);
  }
  const fin=obj(d.financialIntegration),ind=obj(d.industryIntegration);
  if(!str(fin.masterBundleId))append(errors,kind+': missing masterBundleId');
  else bundleIds.add(fin.masterBundleId);
  if(!str(fin.referenceGLVersion))append(errors,kind+': missing referenceGLVersion');
  else glVersions.add(fin.referenceGLVersion);
  if(!str(ind.taxonomyVersion))append(errors,kind+': missing taxonomyVersion');
  else industryVersions.add(ind.taxonomyVersion);
  if(typeof ind.originalEntryCount==='number'&&ind.originalEntryCount!==rows.length)
   append(errors,kind+': record loss/mismatch '+ind.originalEntryCount+' vs '+rows.length);
  if(fin.catalogueRelease!=='APPROVED'||fin.notAuthorizedForPosting===true){
   if(strict)append(errors,kind+': Finance approval required');
   else append(warnings,kind+': unapproved draft; posting prohibited');
  }
 }
 if(bundleIds.size!==1)append(errors,'Four masters must have one bundle identifier');
 if(glVersions.size!==1||str(docs.gl.version)!==[...glVersions][0])append(errors,'GL version mismatch between masters');
 if(industryVersions.size!==1)append(errors,'Industry taxonomy version mismatch');
 const gl=new Map(arr(docs.gl.accounts).map(x=>[str(x.code),x]));
 for(const [kind,field] of KINDS){
  const rows=arr(docs[kind][field]);
  const stats={total:rows.length,common:0,industrySpecific:0,mapped:0,financeReview:0,exceptionReview:0,missingGL:0,mroContextErrors:0};
  for(const entry of rows){
   const x=obj(entry),code=str(x.code);
   if(x.industryScope==='COMMON'){
    stats.common++;
    if(arr(x.industryCodes).length)append(errors,kind+'/'+code+': common entry has industry restrictions');
   }else if(x.industryScope==='INDUSTRY_SPECIFIC'){
    stats.industrySpecific++;
    if(!arr(x.industryCodes).length||arr(x.industryCodes).some(c=>!validIndustry(c)))
     append(errors,kind+'/'+code+': invalid industry-specific code(s)');
   }else append(errors,kind+'/'+code+': industryScope required');
   if(kind==='gl'){
    if(['usedInProcurement','usedInBudget','usedInProcurementPosting'].some(k=>typeof x[k]!=='boolean'))
     append(errors,kind+'/'+code+': procurement and budget flags must be boolean');
    if(!str(obj(x.accountDetermination).mappingStatus))append(errors,kind+'/'+code+': mapping status missing');
    if(x.pendingFinanceApproval===true){
     stats.financeReview++;
     if(x.usedInProcurement===true||x.usedInProcurementPosting===true)
      append(errors,kind+'/'+code+': unapproved GL exposed to procurement');
    }
    continue;
   }
   const accounting=obj(x.accounting),cls=obj(accounting.catalogueClassification),determination=obj(accounting.glResolution),routes=arr(determination.transactionRoutes);
   if(!routes.length||!str(determination.mappingStatus))append(errors,kind+'/'+code+': GL routes or status missing');
   else stats.mapped++;
   if(determination.mappingStatus==='finance_review_required')stats.exceptionReview++;
   if(determination.mappingStatus!=='approved')stats.financeReview++;
   if(kind==='materials'){
    if(!['MRO','NON_MRO'].includes(cls.majorBranch))append(errors,kind+'/'+code+': MRO/Non-MRO branch required');
    if(cls.majorBranch==='MRO'&&(determination.mode!=='work_order_context'||determination.maintenanceStrategyRequiredForConsumption!==true)){
     stats.mroContextErrors++;
     append(errors,kind+'/'+code+': MRO expenses must use Work Order context');
    }
   }
   if(determination.postingEnabled===true&&determination.mappingStatus!=='approved')append(errors,kind+'/'+code+': draft GL resolution enabled');
   for(const route of routes){
    if(!str(route.event)||!str(route.glCode))append(errors,kind+'/'+code+': route missing event/GL');
    if(str(route.glCode)&&!gl.has(route.glCode)){
     stats.missingGL++;
     append(errors,kind+'/'+code+': missing GL '+route.glCode);
    }
    if(route.postingActive===true&&determination.mappingStatus!=='approved')append(errors,kind+'/'+code+': unapproved posting route');
   }
   if(strict&&determination.mappingStatus!=='approved')append(errors,kind+'/'+code+': Finance approval pending');
  }
  coverage[kind]=stats;
 }
 const structurallyValid=errors.length===0;
 const readyForPosting=structurallyValid&&KINDS.every(([k])=>obj(docs[k].financialIntegration).catalogueRelease==='APPROVED')&&KINDS.every(([k])=>coverage[k].financeReview===0);
 return {status:!structurallyValid?'FAILED':readyForPosting?'APPROVED_VALID':'REFERENCE_VALID_FINANCE_REVIEW_REQUIRED',
  structurallyValid,readyForPosting,bundleId:[...bundleIds][0]||'',referenceGLVersion:[...glVersions][0]||'',
  taxonomyVersion:[...industryVersions][0]||'',counts,coverage,errors,warnings};
}
function cli(args){
 const strict=args.includes('--strict'),files=args.filter(a=>a!=='--strict');
 if(files.length!==4){process.stderr.write('Usage: node scripts/audit-integrated-catalogues.mjs GL.json Materials.json Services.json Assets.json [--strict]\n');process.exitCode=2;return;}
 const docs=Object.fromEntries(KINDS.map(([kind],i)=>[kind,JSON.parse(readFileSync(resolve(files[i]),'utf8'))]));
 const result=auditIntegratedMasterBundle(docs,{strict});
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(result.errors.length||strict&&!result.readyForPosting)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)cli(process.argv.slice(2));
