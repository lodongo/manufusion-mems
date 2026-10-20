/** Structured RCA and AI-assisted draft capture. Review and CoA publication are external gates. */
import {HttpError,getDoc,listDocs,nowIso,randomId,str,writeDoc} from './core';
import {orgRoute} from './guards';
import {record} from './org';
import {validateDocumentLocation} from './drkmsHierarchy';
import {canAt,scopeOf,nodePath} from './access';
import {validateAiProposal,type AiProposal} from './drkmsKnowledgeContracts';
import {validateRcaAnalysis,type RcaAiAnalysis} from './drkmsRcaAi';
const docs=(org:string,id:string)=>`organizations/${org}/drkms_documents/${id}`;
const idOk=(s:string)=>/^[a-f0-9]{20}$/.test(s);
export const drkmsDigitalRoutes={
 'POST /api/org/drkms/rca/create':[
  orgRoute('drkms.rca.create','ADM.document_registry',async ctx=>{
   const title=str(ctx.body.title).trim(),incidentReference=str(ctx.body.incidentReference).trim(),
    problem=str(ctx.body.problemStatement).trim(),scopeNodeId=str(ctx.body.scopeNodeId);
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
     representation:'digital_structured',status:'draft',rcaStage:'investigation',
     incidentReference,problemStatement:problem,rootCauses:[],correctiveActions:[],
     effectivenessChecks:[],scope:{nodeId:scopeNodeId,level:str(node.data.level),name:str(node.data.name),ancestorIds:ancestry},
     revision:'00',effectiveRevisionId:'',verified:false,
     securityClass:'internal',createdBy:ctx.uid,ownerUid:ctx.uid,createdAt:nowIso(),updatedAt:nowIso()};
   if(!(await writeDoc(docs(ctx.orgId,id),entry,{exists:false})))throw new HttpError(409,'Try again.');
   await record(ctx,'drkms.rca.create',id,incidentReference);
   return {document:entry,stagingEnabled:false};
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
