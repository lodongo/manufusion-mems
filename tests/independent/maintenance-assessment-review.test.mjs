import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewAssessmentPrerequisites,assessmentReviewCurrent,approvedAssessmentSnapshot} from '../../backend/maintenanceAssessmentReview.ts';
import {ROLE_TEMPLATES,BUILT_PERMISSIONS} from '../../backend/permissionPolicy.ts';
const base=()=>({requestedBy:'requester',assessedBy:'headerAuthor',assessmentTasksBy:'taskAuthor',
 assessmentTasks:[{id:'t1',risk:[{hazard:'energy'}]}],assessmentTasksVersion:2,assessmentTasksAt:'2026-10-19T09:00:00Z',assessedAt:'2026-10-19T08:00:00Z'});
test('reviewer right and security role template are assignable',()=>{
 assert.ok(BUILT_PERMISSIONS.MNT.some(p=>p.key==='MNT.assessment.review'&&p.sensitive));
 assert.deepEqual(ROLE_TEMPLATES.find(t=>t.id==='mnt_assessment_reviewer')?.permissions,['MNT.view','MNT.assessment.review']);
});
test('assessment cannot be self-approved, or approved without task evidence',()=>{
 const b=base();
 for(const uid of ['requester','headerAuthor','taskAuthor'])assert.match(reviewAssessmentPrerequisites(b,uid),/cannot approve/);
 assert.match(reviewAssessmentPrerequisites({...b,assessmentTasks:[]},'independent'),/task-by-task/);
 assert.equal(reviewAssessmentPrerequisites(b,'independent'),'');
});
test('approved review is bound to task and header revision and mapped job role',()=>{
 const b=base();
 const snapshot=approvedAssessmentSnapshot(b,'independent','Supervisor','ROL_000123','2026-10-19T10:00:00Z','Verified tasks, risk and controls');
 assert.equal(assessmentReviewCurrent({...b,assessmentReview:snapshot},'ROL_000123'),true);
 assert.equal(assessmentReviewCurrent({...b,assessmentReview:snapshot,assessmentTasksVersion:3},'ROL_000123'),false);
 assert.equal(assessmentReviewCurrent({...b,assessmentReview:snapshot,assessedAt:'changed'},'ROL_000123'),false);
 assert.equal(assessmentReviewCurrent({...b,assessmentReview:snapshot},'ROL_000456'),false);
 assert.equal(assessmentReviewCurrent({...b,assessmentReview:{status:'changes_requested'}},'ROL_000123'),false);
});
