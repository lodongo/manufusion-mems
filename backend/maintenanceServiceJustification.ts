import {createHash} from 'node:crypto';
import {HttpError,str,type Obj} from './core';
import {object,rows,texts} from './maintenanceDomain';
import {EXTERNAL_JUSTIFICATION_REASONS} from './maintenanceTaskAssessment';
export const SERVICE_JUSTIFICATION_GATE='MNT.SERVICE.JUSTIFY';
export const SERVICE_JUSTIFICATION_PERMISSION='MNT.service.justificationApprove';
export function validateServiceJustification(reasons:unknown,explanation:unknown){
 const selected=[...new Set(texts(reasons))],note=str(explanation).trim();
 if(!selected.length||selected.some(x=>!EXTERNAL_JUSTIFICATION_REASONS.some(k=>k===x))||note.length<10||note.length>1500)throw new HttpError(400,'Select one or more justification categories and explain the internal gap (10–1500 characters).');
 return {reasons:selected.sort(),explanation:note};
}
export function serviceJustification(d:Obj,t:Obj,s:Obj){
 const required=d.externalServicePolicyVersion===1||Array.isArray(s.justificationReasons);
 const entry=object(object(object(d.externalServiceJustifications)[str(t.id)])[str(s.id)]);
 const reasons=texts(entry.reasons??s.justificationReasons),explanation=str(entry.explanation??s.justification),submittedBy=str(entry.submittedBy)||str(d.assessmentTasksBy);
 const signature=createHash('sha256').update(JSON.stringify([str(t.id),str(s.id),str(s.categoryCode),str(s.subcategoryCode),str(s.classCode),str(s.description),str(s.scope),s.personnel??null,s.durationHours??null,s.quantity??null,s.specialistRequired===true,rows(s.skillRequirements).map(x=>[str(x.skillCode),str(x.level)]).sort(),str(s.qualifications),str(s.certifications),str(s.deliverables),str(s.acceptanceCriteria),reasons.slice().sort(),explanation,submittedBy])).digest('hex');
 const decision=object(entry.decision),current=decision.signature===signature;
 return {required,reasons,explanation,submittedBy,signature,status:!required?'legacy':current&&['approved','returned'].includes(str(decision.status))?str(decision.status):'pending',decision:current?decision:null};
}
