/** Shared controlled knowledge contracts, no autonomous publication or execution. */
export const DRKMS_SPECIAL_TYPES = [
 {code:'SDS',label:'Safety Data Sheet',parentClass:'EXT',owner:'SHEQ',source:'manufacturer'},
 {code:'RCA',label:'Root Cause Analysis',parentClass:'RPT',owner:'MNT',source:'digital'},
 {code:'DYN-FRM',label:'Dynamic Form',parentClass:'FRM',owner:'document_controller',source:'digital'},
 {code:'OCR-SRC',label:'OCR Extraction Source',parentClass:'REC',owner:'document_controller',source:'import'},
] as const;
export const RCA_STAGES = ['draft','investigation','technical_review','awaiting_approval','approved','staged','superseded'] as const;
export const FORM_FIELD_TYPES = ['text','number','date','datetime','boolean','select','multiselect','photo','signature','asset','material','employee','location','risk_score','table'] as const;
export type ProposedFormField = {code:string;label:string;type:typeof FORM_FIELD_TYPES[number];required:boolean;options?:string[]};
export type AiProposal = {kind:'form'|'ocr'|'work_instruction'|'rca_analysis';sourceDocumentIds:string[];fields?:ProposedFormField[];extractedText?:string;confidence?:number;humanReviewStatus:'pending';automatedExecution:false};
export function validateAiProposal(value:AiProposal):boolean{
 return !!value && ['form','ocr','work_instruction','rca_analysis'].includes(value.kind)&&value.humanReviewStatus==='pending'&&value.automatedExecution===false&&
 Array.isArray(value.sourceDocumentIds)&&value.sourceDocumentIds.length>0&&value.sourceDocumentIds.length<=25&&
 value.sourceDocumentIds.every(id=>/^[a-f0-9]{20}$/.test(id))&&
 (value.fields===undefined || (Array.isArray(value.fields)&&value.fields.length<=150))&&
 (value.fields??[]).every(f=>/^[A-Z][A-Z0-9_]{1,30}$/.test(f.code)&&f.label.length>0&&FORM_FIELD_TYPES.some(t=>t===f.type));
}
export function safeSdsUrl(input:string):boolean{
 try{const u=new URL(input);return u.protocol==='https:'&&!u.username&&!u.password&&
  !['localhost','127.0.0.1','0.0.0.0','::1'].includes(u.hostname.toLowerCase())&&
  !u.hostname.toLowerCase().endsWith('.local')&&u.hostname.includes('.');}catch{return false;}
}
