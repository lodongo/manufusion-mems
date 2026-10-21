/** Structured RCA and AI-assisted draft capture. Review and CoA publication are external gates. */
import {HttpError,getDoc,listDocs,nowIso,randomId,str,writeDoc} from './core';
import {orgRoute} from './guards';
import {record} from './org';
import {validateDocumentLocation} from './drkmsHierarchy';
import {canAt,scopeOf,nodePath} from './access';
import {validateAiProposal,type AiProposal} from './drkmsKnowledgeContracts';
import {validateRcaAnalysis,type RcaAiAnalysis} from './drkmsRcaAi';
import {RCA_METHODS} from './docRcaDefaults';
const RCA_METHODS=new Set(['5WHY','ISH','FTA','FMEA','PARETO','8D','KT','BOWTIE','CHANGE','EVENT','TRIPOD','APOLLO','BARRIER','C&E']);
const DMAIC_PHASES=['DEFINE','MEASURE','ANALYZE','IMPROVE','CONTROL'] as const;
const PHASE_FIELDS:Record<string,string[]>={
 DEFINE:['problem','impact','scope'],MEASURE:['baseline','evidence'],ANALYZE:['causalAnalysis','validatedCauses'],IMPROVE:['correctiveActions','actionOwners'],CONTROL:['effectivenessCriteria','monitoringPlan']
};
const docs=(org:string,id:string)=>`organizations/${org}/drkms_documents/${id}`;
const idOk=(s:string)=>/^[a-f0-9]{20}$/.test(s);
export const drkmsDigitalRoutes={
 'POST /api/org/drkms/rca/create':[
  orgRoute('drkms.rca.create','ADM.document_registry',async ctx=>{
   const title=str(ctx.body.title).trim(),incidentReference=str(ctx.body.incidentReference).trim(),
    problem=str(ctx.body.problemStatement).trim(),scopeNodeId=str(ctx.body.scopeNodeId),
    methodCode=str(ctx.body.methodCode||'5WHY'),frameworkCode=str(ctx.body.frameworkCode||'5M1W');
   if(!RCA_METHODS.some(m=>m[0]===methodCode))throw new HttpError(400,'Select a recognized RCA method.');
   if(!['5M1E','5M1W','6M','4M','5W2H','ISNOT','6W'].includes(frameworkCode))throw new HttpError(400,'Select a recognized causal reference framework.');
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
   const methodCode=str(ctx.body.methodCode).trim().toUpperCase();
   if(!RCA_METHODS.has(methodCode))throw new HttpError(400,'Select a recognized RCA analysis method from MEMS Admin DOC metadata.');
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
   const existing=state.phases&&typeof state.phases==='object'?state.phases as Record<string,unknown>:{};
   const phaseData={...(existing[phase]&&typeof existing[phase]==='object'?existing[phase] as Record<string,unknown>:{}),...data};
   const completed=Array.isArray(state.completedPhases)?state.completedPhases.filter(v=>typeof v==='string') as string[]:[];
   const advance=ctx.body.complete===true;
   if(advance && PHASE_FIELDS[phase].some(key=>typeof phaseData[key]!=='string'||String(phaseData[key]).trim().length<12))
     throw new HttpError(400,'Complete every required phase field (at least 12 characters) before advancing.');
   const next=advance?DMAIC_PHASES[DMAIC_PHASES.indexOf(phase as typeof DMAIC_PHASES[number])+1]??'CONTROL':phase;
   const updated={currentPhase:next,completedPhases:advance?[...completed.filter(p=>p!==phase),phase]:completed,phases:{...existing,[phase]:phaseData}};
   await writeDoc(docs(ctx.orgId,documentId),{...doc.data,rcaDmaic:updated,rcaStage:next,updatedAt:nowIso()});
   await record(ctx,'drkms.rca.dmaic.save',documentId,phase);
   return {currentPhase:next,completedPhases:updated.completedPhases};
  }),
 ],
 'POST /api/org/drkms/rca/stage':[
  orgRoute('drkms.rca.stage','ADM.document_registry',async ctx=>{
   const documentId=str(ctx.body.documentId),stage=str(ctx.body.stage).toUpperCase();
   if(!idOk(documentId))throw new HttpError(400,'Invalid RCA document.');
   const doc=await getDoc(docs(ctx.orgId,documentId));
   if(!doc||str(doc.data.subtypeCode)!=='RCA'||str(doc.data.status)!=='draft')
     throw new HttpError(409,'Only draft RCA investigations can be progressed.');
   if(str(doc.data.createdBy)!==ctx.uid)throw new HttpError(403,'Only the responsible investigator may update DMAIC.');
   const order=['DEFINE','MEASURE','ANALYZE','IMPROVE','CONTROL'];
   const current=str(doc.data.dmaicStage||'DEFINE');
   if(!order.includes(stage)||order.indexOf(stage)>order.indexOf(current)+1)
     throw new HttpError(409,'Complete DMAIC stages in sequence.');
   const statement=str(ctx.body.findings).trim(),references=ctx.body.evidenceIds;
   if(statement.length<20||statement.length>8000||!Array.isArray(references)||references.length>100||
       references.some(x=>typeof x!=='string'))
     throw new HttpError(400,'Record substantive findings and valid evidence identifiers.');
   const registered=await listDocs(`${docs(ctx.orgId,documentId)}/evidence`);
   const valid=new Set(registered.map(x=>x.id));
   if(references.some(x=>!valid.has(x)))throw new HttpError(400,'Evidence must belong to this RCA.');
   const prior=(doc.data.dmaicStages&&typeof doc.data.dmaicStages==='object'&&!Array.isArray(doc.data.dmaicStages)?doc.data.dmaicStages:{}) as Record<string,unknown>;
   // Advancing requires a completed stage; editing the current phase never skips quality gates.
   if(order.indexOf(stage)>order.indexOf(current)){
     const previous=prior[current] as Record<string,unknown>|undefined;
     if(!previous||str(previous.findings).length<20)
       throw new HttpError(409,'Complete the current DMAIC stage before advancing.');
     if(current==='MEASURE'&&(!Array.isArray(previous.evidenceIds)||previous.evidenceIds.length===0))
       throw new HttpError(409,'Measure requires registered supporting evidence.');
     if(current==='ANALYZE'&&(!Array.isArray(previous.evidenceIds)||previous.evidenceIds.length===0))
       throw new HttpError(409,'Analyze requires evidence for verified causal reasoning.');
   }
   const updated={...prior,[stage]:{findings:statement,evidenceIds:references,updatedBy:ctx.uid,updatedAt:nowIso()}};
   await writeDoc(docs(ctx.orgId,documentId),{...doc.data,dmaicStages:updated,dmaicStage:stage,updatedAt:nowIso()});
   await record(ctx,'drkms.rca.stage',documentId,stage);
   return {documentId,dmaicStage:stage,methodCode:doc.data.methodCode,frameworkCode:doc.data.frameworkCode};
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
