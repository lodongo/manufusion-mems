/** Independent approval snapshot tied to the exact assessment revision. */
export interface AssessmentRecord {
 assessmentTasks?: unknown; assessmentTasksVersion?: unknown; assessmentTasksAt?: unknown;
 assessedAt?: unknown; assessmentReview?: unknown; requestedBy?: unknown;
 createdBy?: unknown; assessedBy?: unknown; assessmentTasksBy?: unknown;
}
type Fields = Record<string,unknown>;
const item=(v:unknown):Fields=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Fields:{};
const value=(v:unknown)=>typeof v==='string'?v:'';
export function reviewAssessmentPrerequisites(record:AssessmentRecord,reviewerId:string):string {
 if(!reviewerId)return 'A signed-in reviewer is required.';
 if([record.requestedBy,record.createdBy,record.assessedBy,record.assessmentTasksBy].some(id=>value(id)===reviewerId))
  return 'The requester, work order creator or assessment author cannot approve their own assessment.';
 if(!Array.isArray(record.assessmentTasks)||record.assessmentTasks.length===0)
  return 'Complete the task-by-task work assessment before review.';
 if(!Number.isInteger(Number(record.assessmentTasksVersion))||Number(record.assessmentTasksVersion)<1||!value(record.assessmentTasksAt))
  return 'Save the latest complete task assessment before review.';
 return '';
}
export function assessmentReviewCurrent(record:AssessmentRecord,assignedJobRole?:string):boolean {
 const review=item(record.assessmentReview);
 return review.status==='approved' && Number(review.version)>0
  && Number(review.version)===Number(record.assessmentTasksVersion)
  && value(review.assessmentTasksAt)===value(record.assessmentTasksAt)
  && value(review.assessedAt)===value(record.assessedAt)
  && !!value(review.by) && !!value(review.jobRole)
  && (!assignedJobRole||value(review.jobRole)===assignedJobRole);
}
export function approvedAssessmentSnapshot(record:AssessmentRecord,by:string,name:string,jobRole:string,at:string,note:string):Fields {
 const problem=reviewAssessmentPrerequisites(record,by);
 if(problem)throw new Error(problem);
 if(!jobRole)throw new Error('Configure the assessment reviewer organizational job role.');
 if(note.trim().length<10)throw new Error('Write review notes of at least 10 characters.');
 return {status:'approved',version:Number(record.assessmentTasksVersion),assessmentTasksAt:value(record.assessmentTasksAt),
  assessedAt:value(record.assessedAt),by,name,jobRole,at,note:note.trim().slice(0,500)};
}
