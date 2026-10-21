/** Structured RCA and AI-assisted draft capture. Review and CoA publication are external gates. */
import {HttpError,getDoc,listDocs,nowIso,randomId,str,writeDoc} from './core';
import {orgRoute} from './guards';
import {record} from './org';
import {validateDocumentLocation} from './drkmsHierarchy';
import {canAt,scopeOf,nodePath} from './access';
import {validateAiProposal,type AiProposal} from './drkmsKnowledgeContracts';
import {validateRcaAnalysis,type RcaAiAnalysis} from './drkmsRcaAi';
import {DOC_DEFAULT_LISTS} from './docDefaults';
import {RCA_METHODS,RCA_METADATA_LISTS} from './docRcaDefaults';
const DMAIC_PHASES=['DEFINE','MEASURE','ANALYZE','IMPROVE','CONTROL'] as const;
const PHASE_FIELDS:Record<string,string[]>={
 DEFINE:['problem','impact','scope'],MEASURE:['baseline','evidence'],ANALYZE:['causalAnalysis','validatedCauses','methodAnalysis'],IMPROVE:['correctiveActions','actionOwners'],CONTROL:['effectivenessCriteria','monitoringPlan']
};
const master=async(key:string)=>{
 const source=await getDoc(`module_workspaces/DOC/metadata/${key}`);
 const fallback=[...DOC_DEFAULT_LISTS,...RCA_METADATA_LISTS].find(list=>list.key===key);
 return (Array.isArray(source?.data.items)?source.data.items:fallback?.items??[]) as Array<{code:string;label:string;active?:boolean}>;
};
const allowedMethod=async(code:string)=>(await master('rcaMethods')).some(item=>item.code===code&&item.active!==false);
const docs=(org:string,id:string)=>`organizations/${org}/drkms_documents/${id}`;
const idOk=(s:string)=>/^[a-f0-9]{20}$/.test(s);
export const drkmsDigitalRoutes={
 'POST /api/org/drkms/rca/reference':[
  orgRoute('drkms.rca.reference','ADM.document_registry',async ()=>{
   const keys=['rcaMethods','rcaFrameworks','rca5m1wFactors','rcaDmaicStages','rcaCauseTypes','rcaActionTypes'] as const;
   const fallback=(await import('./docRcaDefaults')).RCA_METADATA_LISTS;
   const lists=await Promise.all(keys.map(async key=>{
     const stored=await getDoc(`module_workspaces/DOC/metadata/${key}`);
     const def=fallback.find(x=>x.key===key);
     const items=Array.isArray(stored?.data.items)?stored.data.items:def?.items??[];
     return {key,items:items.filter((v):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)).filter(v=>v.active!==false).map(v=>({code:str(v.code),label:str(v.label),description:str(v.description)}))};
   }));
   return {lists};
  }),
 ],

 'POST /api/org/drkms/rca/masters':[
  orgRoute('drkms.rca.masters','ADM.document_registry',async()=>{
   const keys=['rcaMethods','rcaDmaicStages','rcaFrameworks','rca5m1wFactors','rca5w1h','rcaCauseTypes','rcaActionTypes','rcaVerification'];
   const entries=await Promise.all(keys.map(async key=>[key,(await master(key)).filter(item=>item.active!==false)] as const));
   return {masters:Object.fromEntries(entries)};
  }),
 ],
 'POST /api/org/drkms/rca/workspace':[
  orgRoute('drkms.rca.workspace','ADM.document_registry',async ctx=>{
   const id=str(ctx.body.documentId);
   if(!idOk(id))throw new HttpError(400,'Invalid RCA identifier.');
   const doc=await getDoc(docs(ctx.orgId,id));
   if(!doc||str(doc.data.subtypeCode)!=='RCA'||str(doc.data.createdBy)!==ctx.uid)throw new HttpError(403,'Only the investigator may edit this RCA.');
   return {documentId:id,title:doc.data.title,rcaMethodCode:doc.data.rcaMethodCode,rcaDmaic:doc.data.rcaDmaic};
  }),
 ],

 'POST /api/org/drkms/rca/create':[
  orgRoute('drkms.rca.create','ADM.document_registry',async ctx=>{
   const title=str(ctx.body.title).trim(),incidentReference=str(ctx.body.incidentReference).trim(),
    problem=str(ctx.body.problemStatement).trim(),scopeNodeId=str(ctx.body.scopeNodeId),
    methodCode=str(ctx.body.methodCode||'5WHY'),frameworkCode=str(ctx.body.frameworkCode||'5M1W');
   const methodList=await getDoc('module_workspaces/DOC/metadata/rcaMethods');
   const frameworkList=await getDoc('module_workspaces/DOC/metadata/rcaFrameworks');
   const permitted=(doc:typeof methodList,code:string,fallbackCodes:readonly string[])=>{
     if(!Array.isArray(doc?.data.items))return fallbackCodes.includes(code);
     return doc.data.items.some(x=>x&&typeof x==='object'&&!Array.isArray(x)&&str(x.code)===code&&x.active!==false);
   };
   if(!permitted(methodList,methodCode,RCA_METHODS.map(m=>m[0])))throw new HttpError(400,'Choose an enabled RCA method in MEMS Admin.');
   if(!permitted(frameworkList,frameworkCode,['5M1E','5M1W','6M','4M','5W2H','ISNOT','6W']))
     throw new HttpError(400,'Choose an enabled reference framework in MEMS Admin.');
   if(title.length<3||title.length>200||problem.length<20||problem.length>8000||incidentReference.length>100)
    throw new HttpError(400,'Provide an RCA title, incident reference and substantive problem statement.');
   const node=await getDoc(`organizations/${ctx.orgId}/structure/${scopeNodeId}`);
   if(!node||!['legal_entity','site','department','cost_center'].includes(str(node.data.level))||
     str(node.data.status)==='inactive')throw new HttpError(400,'Choose an active organization location.');
   const nodes=await listDocs(`organizations/${ctx.orgId}/structure`);
   let ancestry:string[];
   try{ancestry=validateDocumentLocation(scopeNodeId,nodes.map(n=>({id:n.id,level:str(n.data.level),parentId:str(n.data.parentId),status:str(n.data.status)})));}
   catch{throw new HttpError(400,'RCA location has an invalid organizational hierarchy.');}
   if(!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,scopeNodeId),await scopeOf(ctx)))
     throw new HttpError(403,'You do not have document access at this organizational location.');
   const id=randomId(10);
   const entry={tenantId:ctx.orgId,documentId:id,title,classCode:'RPT',subtypeCode:'RCA',
     representation:'digital_structured',status:'draft',rcaStage:'DEFINE',rcaMethodCode:methodCode,rcaDmaic:{currentPhase:'DEFINE',completedPhases:[],phases:{}},
     incidentReference,problemStatement:problem,methodCode,frameworkCode,dmaicStage:'DEFINE',dmaicStages:{},rootCauses:[],correctiveActions:[],
     effectivenessChecks:[],scope:{nodeId:scopeNodeId,level:str(node.data.level),name:str(node.data.name),ancestorIds:ancestry},
     revision:'00',effectiveRevisionId:'',verified:false,
     securityClass:'internal',createdBy:ctx.uid,ownerUid:ctx.uid,createdAt:nowIso(),updatedAt:nowIso()};
   if(!(await writeDoc(docs(ctx.orgId,id),entry,{exists:false})))throw new HttpError(409,'Try again.');
   await record(ctx,'drkms.rca.create',id,incidentReference);
   return {document:entry,stagingEnabled:false};
  }),
 ],
 'POST /api/org/drkms/rca/dmaic/save':[
  orgRoute('drkms.rca.dmaic.save','ADM.document_registry',async ctx=>{
   const documentId=str(ctx.body.documentId),phase=str(ctx.body.phase).toUpperCase();
   if(!idOk(documentId)||!DMAIC_PHASES.includes(phase as typeof DMAIC_PHASES[number]))throw new HttpError(400,'Invalid RCA or DMAIC phase.');
   const doc=await getDoc(docs(ctx.orgId,documentId));
   if(!doc||str(doc.data.subtypeCode)!=='RCA'||str(doc.data.status)!=='draft')throw new HttpError(409,'Only draft RCA investigations may be edited.');
   if(str(doc.data.createdBy)!==ctx.uid)throw new HttpError(403,'Only the investigator may update the RCA.');
   const state=(doc.data.rcaDmaic??{}) as Record<string,unknown>;
   const current=str(state.currentPhase)||'DEFINE';
   if(phase!==current)throw new HttpError(409,'Complete the current DMAIC phase first.');
   const fields=ctx.body.fields;
   if(!fields||typeof fields!=='object'||Array.isArray(fields)||JSON.stringify(fields).length>18000)
    throw new HttpError(400,'Invalid DMAIC phase data.');
   const data=fields as Record<string,unknown>;
   if(!Object.keys(data).every(k=>PHASE_FIELDS[phase].includes(k)))throw new HttpError(400,'Unexpected DMAIC fields.');
   if(phase==='ANALYZE' && data.methodAnalysis!==undefined){
     const rows=data.methodAnalysis;
     if(!Array.isArray(rows)||rows.length>40||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)
       ||typeof row.key!=='string'||row.key.length>40||typeof row.text!=='string'||row.text.length>2000))
       throw new HttpError(400,'Provide valid method-specific analysis entries.');
     const keys=rows.map(row=>row.key as string);
     if(new Set(keys).size!==keys.length)throw new HttpError(400,'Duplicate method analysis steps.');
     const method=str(doc.data.rcaMethodCode);
     if(method==='5WHY'&&keys.some(k=>!/^WHY-[1-9][0-9]?$/.test(k)))throw new HttpError(400,'Five Whys needs numbered Why steps.');
     if(method==='ISH'){
       const controlled=(await master('rca5m1wFactors')).filter(item=>item.active!==false).map(item=>item.code);
       if(keys.some(k=>!controlled.includes(k)))throw new HttpError(400,'Fishbone entries must use enabled MEMS Admin 5M1E categories.');
     }
   }
   const existing=state.phases&&typeof state.phases==='object'?state.phases as Record<string,unknown>:{};
   const phaseData={...(existing[phase]&&typeof existing[phase]==='object'?existing[phase] as Record<string,unknown>:{}),...data};
   const completed=Array.isArray(state.completedPhases)?state.completedPhases.filter(v=>typeof v==='string') as string[]:[];
   const advance=ctx.body.complete===true;
   if(advance&&phase==='ANALYZE'&&(!Array.isArray(phaseData.methodAnalysis)||phaseData.methodAnalysis.filter((r:unknown)=>!!r && typeof r==='object' && String((r as Record<string,unknown>).text??'').trim().length>=10).length<2))
     throw new HttpError(400,'Record at least two substantive entries using the selected RCA method before advancing.');
   if(advance && PHASE_FIELDS[phase].some(key=>typeof phaseData[key]!=='string'||String(phaseData[key]).trim().length<12))
     throw new HttpError(400,'Complete every required phase field (at least 12 characters) before advancing.');
   const next=advance?DMAIC_PHASES[DMAIC_PHASES.indexOf(phase as typeof DMAIC_PHASES[number])+1]??'CONTROL':phase;
   const updated={currentPhase:next,completedPhases:advance?[...completed.filter(p=>p!==phase),phase]:completed,phases:{...existing,[phase]:phaseData}};
   await writeDoc(docs(ctx.orgId,documentId),{...doc.data,rcaDmaic:updated,rcaStage:next,updatedAt:nowIso()});
   await record(ctx,'drkms.rca.dmaic.save',documentId,phase);
   return {currentPhase:next,completedPhases:updated.completedPhases};
  }),
 ],
 'POST /api/org/drkms/rca/evidence':[
  orgRoute('drkms.rca.evidence','ADM.document_registry',async ctx=>{
   const documentId=str(ctx.body.documentId);
   if(!idOk(documentId))throw new HttpError(400,'Invalid RCA document.');
   const doc=await getDoc(docs(ctx.orgId,documentId));
   if(!doc||str(doc.data.subtypeCode)!=='RCA'||str(doc.data.status)!=='draft')
     throw new HttpError(409,'Evidence can only be appended to a draft RCA.');
   if(str(doc.data.createdBy)!==ctx.uid)throw new HttpError(403,'Only the responsible investigator can register evidence.');
   const type=str(ctx.body.type),description=str(ctx.body.description).trim(),reference=str(ctx.body.reference).trim();
   if(!['observation','inspection','measurement','interview','maintenance_record','alarm','photo_reference','manual_reference'].includes(type)
      ||description.length<10||description.length>4000||reference.length>200)
     throw new HttpError(400,'Provide a valid evidence type, description and reference.');
   const id=randomId(10);
   const evidence={id,documentId,tenantId:ctx.orgId,type,description,reference,createdBy:ctx.uid,createdAt:nowIso(),verificationStatus:'unverified'};
   if(!(await writeDoc(`${docs(ctx.orgId,documentId)}/evidence/${id}`,evidence,{exists:false})))
      throw new HttpError(409,'Evidence identifier conflict.');
   await record(ctx,'drkms.rca.evidence',documentId,id);
   return {evidenceId:id,verificationStatus:'unverified'};
  }),
 ],
 'POST /api/org/drkms/rca/ai-analysis':[
  orgRoute('drkms.rca.ai_analysis','ADM.document_registry',async ctx=>{
   const documentId=str(ctx.body.documentId);
   if(!idOk(documentId))throw new HttpError(400,'Invalid RCA document identifier.');
   const doc=await getDoc(docs(ctx.orgId,documentId));
   if(!doc||str(doc.data.subtypeCode)!=='RCA'||str(doc.data.status)!=='draft')
     throw new HttpError(409,'A draft digital RCA is required.');
   if(str(doc.data.createdBy)!==ctx.uid)throw new HttpError(403,'Only the investigator may add AI analysis proposals.');
   const proposal=ctx.body.analysis as RcaAiAnalysis;
   if(!proposal||proposal.documentId!==documentId||!validateRcaAnalysis(proposal)||JSON.stringify(proposal).length>50000)
     throw new HttpError(400,'AI analysis requires traceable evidence, candidate-only hypotheses and human validation.');
   const allowedEvidence=await listDocs(`${docs(ctx.orgId,documentId)}/evidence`);
   const evidenceIds=new Set(allowedEvidence.map(e=>e.id));
   if(!proposal.sourceIds.every(sourceId=>evidenceIds.has(sourceId)))
     throw new HttpError(400,'The RCA analysis refers to evidence that is not registered for this investigation.');
   const id=randomId(10);
   const candidate={...proposal,id,createdBy:ctx.uid,createdAt:nowIso(),status:'candidate',humanValidated:false,publishable:false};
   if(!(await writeDoc(`${docs(ctx.orgId,documentId)}/rca_ai_analysis/${id}`,candidate,{exists:false})))
     throw new HttpError(409,'AI proposal conflict.');
   await record(ctx,'drkms.rca.ai_candidate',documentId,proposal.mode);
   return {analysisId:id,status:'candidate',needsInvestigatorValidation:true};
  }),
 ],
 'POST /api/org/drkms/ai/proposal':[
  orgRoute('drkms.ai.proposal','ADM.document_registry',async ctx=>{
   const documentId=str(ctx.body.documentId);
   if(!idOk(documentId))throw new HttpError(400,'Invalid document.');
   const doc=await getDoc(docs(ctx.orgId,documentId));
   if(!doc||str(doc.data.createdBy)!==ctx.uid||str(doc.data.status)!=='draft')
     throw new HttpError(403,'Only the author of an active draft can save a proposal.');
   const input=ctx.body.proposal as AiProposal;
   if(!input||!validateAiProposal(input)||JSON.stringify(input).length>25000)
     throw new HttpError(400,'Invalid human-review-required AI proposal.');
   const sources=await Promise.all(input.sourceDocumentIds.map(id=>getDoc(docs(ctx.orgId,id))));
   if(sources.some(source=>!source || str(source.data.status)!=='effective'))
     throw new HttpError(400,'AI extraction requires verified, published source document revisions.');
   const id=randomId(10);
   const recordData={...input,id,documentId,createdBy:ctx.uid,createdAt:nowIso(),
     status:'candidate',humanReviewStatus:'pending',automatedExecution:false};
   if(!(await writeDoc(`${docs(ctx.orgId,documentId)}/ai_proposals/${id}`,recordData,{exists:false})))
      throw new HttpError(409,'Could not register proposal.');
   await record(ctx,'drkms.ai.proposal',documentId,input.kind);
   return {proposalId:id,status:'candidate',publishEnabled:false};
  }),
 ],
};
