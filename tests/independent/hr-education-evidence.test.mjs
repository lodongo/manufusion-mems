import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hrMayAccess,hrRules,hrVisibleTabs} from '../../backend/hrPrivacyRules.ts';
import {BUILT_PERMISSIONS} from '../../backend/permissionPolicy.ts';
import {standardRoleTemplates} from '../../backend/standardRoleTemplates.ts';

const src=(name)=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
test('employee Records tab remains available for own submitted evidence under legacy policies',()=>{
 const rules=hrRules({schemaVersion:2,selfTabs:['education','basic'],managerTabs:['basic'],hrTabs:['basic']});
 assert.equal(hrMayAccess('self','records',rules),true);
 assert.equal(hrMayAccess('manager','records',rules),false);
 assert.ok(hrVisibleTabs('superadmin',rules).includes('records'));
});
test('independent HR verifier is a dedicated, configurable permission role',()=>{
 const keys=BUILT_PERMISSIONS.HRM.map(p=>p.key);
 assert.ok(keys.includes('HRM.records.verify'));
 const template=standardRoleTemplates([{module:'HRM',permissions:BUILT_PERMISSIONS.HRM}])
  .find(t=>t.id==='std_hrm_education_verifier');
 assert.ok(template);
 assert.deepEqual(template.permissions,['HRM.shell.view','HRM.records.verify']);
 assert.equal(template.permissions.includes('HRM.skills.manage'),false);
});
test('private qualification uploads are immutable, segregated by organization and not self-verifiable',()=>{
 const api=src('backend/hrEducationEvidenceRoutes.ts');
 assert.match(api,/storage\.writeImmutable/);
 assert.match(api,/ctx\.uid===uid\)throw new HttpError\(403/);
 assert.match(api,/str\(existing\.data\.uploadedBy\)===ctx\.uid/);
 assert.match(api,/organizations\/.*hr_evidence/);
 assert.match(api,/commitChecked/);
 assert.match(api,/sha256/);
 assert.match(api,/status:'pending'/);
 assert.match(api,/decision==='rejected'/);
});
test('Deployment has moved to Profile, and Records are a real tab rather than an empty placeholder',()=>{
 const portal=src('src/org/HrEmployeePortal.tsx');
 const profile=src('src/org/HrProfileOverview.tsx');
 assert.equal(portal.includes("{key:'deployment',label:'Deployment'"),false);
 assert.equal(portal.includes("tab==='deployment'"),false);
 assert.match(profile,/Deployment details/);
 assert.match(profile,/positionCode/);
 assert.match(portal,/tab==='records'&&<HrEvidenceRecords/);
});
test('Education cards link submitted supporting files to persisted qualification IDs',()=>{
 const edu=src('src/org/HrEducationRecords.tsx');
 assert.match(edu,/educationId:stored\.id/);
 assert.match(edu,/readEvidenceFile/);
 const categories=src('src/org/HrEvidenceRecords.tsx');
 assert.match(categories,/degree_certificate/);
 assert.match(categories,/transcript/);
 assert.match(edu,/await loadEvidence/);
});
