/** AI-supported RCA analysis is advisory and evidence-traceable. */
export type RcaHypothesis={id:string;statement:string;category:string;sourceIds:string[];confidence:number;status:'candidate'|'investigator_confirmed'|'rejected'};
export type RcaAiAnalysis={documentId:string;mode:'five_whys'|'fishbone'|'fault_tree'|'causal_timeline'|'corrective_actions';sourceIds:string[];hypotheses:RcaHypothesis[];limitations:string[];humanValidated:false;publishable:false};
export function validateRcaAnalysis(x:RcaAiAnalysis):boolean{
 return !!x&&['five_whys','fishbone','fault_tree','causal_timeline','corrective_actions'].includes(x.mode)&&
 Array.isArray(x.sourceIds)&&x.sourceIds.length>0&&x.sourceIds.length<=50&&
 Array.isArray(x.hypotheses)&&x.hypotheses.length>0&&x.hypotheses.length<=50&&
 x.hypotheses.every(h=>!!h.id&&h.statement.length>=10&&h.statement.length<=2000&&
 Array.isArray(h.sourceIds)&&h.sourceIds.length>0&&h.sourceIds.every(id=>x.sourceIds.includes(id))&&
 Number.isFinite(h.confidence)&&h.confidence>=0&&h.confidence<=1&&h.status==='candidate')&&
 Array.isArray(x.limitations)&&x.humanValidated===false&&x.publishable===false;
}
