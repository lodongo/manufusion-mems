import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {BUILT_PERMISSIONS,SOD_RULES,sodConflicts} from '../../backend/permissionPolicy.ts';
import {LEVEL_ROLES} from '../../backend/levelRoles.ts';

test('job grades: draft rules, maker-checker activation under the Chart of Authority and universal role minimum education',()=>{
 const result=spawnSync(process.execPath,
 ['--import','tsx','--import','./tests/helpers/maintenance-register.mjs','./tests/helpers/hr-job-grades-scenario.mjs'],
 {cwd:process.cwd(),encoding:'utf8',timeout:90000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 assert.match(result.stdout,/HR job grades governance, pay rules and universal role minimum education scenario passed/);
});

test('job grade rights exist, are sensitive, and the preparer can never approve',()=>{
 const hrm=BUILT_PERMISSIONS.HRM;
 for(const key of ['HRM.grades.manage','HRM.grades.approve'])assert.ok(hrm.some(p=>p.key===key&&p.sensitive===true),key);
 assert.ok(SOD_RULES.some(r=>r.id==='grades-manage-approve'&&r.a==='HRM.grades.manage'&&r.b==='HRM.grades.approve'));
 assert.equal(sodConflicts(['HRM.grades.manage','HRM.grades.approve']).length>0,true);
 const officer=LEVEL_ROLES.find(r=>r.name==='HR Officer'),manager=LEVEL_ROLES.find(r=>r.name==='HR Manager');
 assert.ok(officer.permissions.includes('HRM.grades.manage')&&!officer.permissions.includes('HRM.grades.approve'));
 assert.ok(manager.permissions.includes('HRM.grades.approve')&&!manager.permissions.includes('HRM.grades.manage'));
 const templates=readFileSync('backend/standardRoleTemplates.ts','utf8');
 assert.match(templates,/std_hrm_grades_maintainer/);
 assert.match(templates,/std_hrm_grades_approver/);
});

test('every job grade action is guarded and audited, and money-bearing activation uses the shared request engine',()=>{
 const src=readFileSync('backend/hrJobGrades.ts','utf8');
 // The route audit reads literal permission strings, so the literal must stay in step with the constant.
 assert.match(src,/JOB_GRADE_MANAGE = 'HRM\.grades\.manage'/);
 assert.match(src,/orgRoute\('org\.hr\.jobgrades\.save', 'HRM\.grades\.manage'/);
 assert.match(src,/orgRoute\('org\.hr\.jobgrades\.submit', 'HRM\.grades\.manage'/);
 assert.match(src,/registerHandler\(JOB_GRADE_REQUEST, \{[\s\S]*?approvePerm: JOB_GRADE_APPROVE,\s*valued: true/);
 for(const action of ['jobgrades.save','jobgrades.submit','jobgrades.activated',"'jobgrades.' + decision",'jobgrades.withdraw'])
  assert.ok(src.includes("hrAudit(ctx, "+(action.startsWith("'")?action:"'"+action+"'")),action+' is audited');
 assert.match(src,/decideRequest\(ctx, id, decision, note/);
 assert.match(src,/writeDoc\(gradeActivePath\(ctx\.orgId, entity\), active/,'activation writes the active policy');
 const index=readFileSync('backend/index.ts','utf8');
 assert.match(index,/\.\.\.hrJobGradeRoutes/);
 const catalogue=readFileSync('backend/transactionCatalogue.ts','utf8');
 assert.match(catalogue,/job-grades\\\/decide\$\/, 'HRM', 'GRD', 'AP'/);
});

test('job grades are no longer edited in education settings and roles require a minimum education',()=>{
 const edu=readFileSync('backend/hrEducationConfig.ts','utf8');
 assert.match(edu,/activeJobGrades/);
 assert.doesNotMatch(edu,/Job grade numbers must be unique/);
 const positions=readFileSync('backend/positions.ts','utf8');
 assert.match(positions,/resolveMinEducation\(/);
 assert.match(positions,/minEducation, staffingPlan/);
 assert.doesNotMatch(positions,/minEducationByLegalEntity, staffingPlan/,'education is no longer stored per legal entity');
 assert.match(positions,/commonEducationLevels\(/);
});

test('the Job Grades screen is wired in, keeps its action bar fixed and verifies before submitting',()=>{
 const shell=readFileSync('src/org/HrShell.tsx','utf8');
 assert.match(shell,/\['HR07','Job Grades'\]/);
 assert.match(shell,/sectionCode==='HR07'&&<HrJobGrades\/>/);
 assert.match(shell,/const FIXED_FRAME[^=]*=\[[^\]]*'HR07'/,'HR07 keeps a fixed frame');
 assert.match(shell,/fixedFrame\?"min-h-0 min-w-0 flex-1 overflow-hidden/,'the page itself does not scroll for fixed-frame sections');
 const home=readFileSync('src/org/OrgHomePage.tsx','utf8');
 assert.match(home,/label: 'Job Grades', path: 'hr\/HR07'/);
 assert.doesNotMatch(home,/Job Grading/);
 const screen=readFileSync('src/org/HrJobGrades.tsx','utf8');
 assert.match(screen,/<RichTable id="hr-job-grades-v1"/);
 assert.match(screen,/allowExport=\{financial\}/,'Excel download only when the viewer may see pay');
 assert.match(screen,/activationProblems\(/);
 assert.match(screen,/draftIssues\(/);
 assert.match(screen,/acknowledge:true/,'submitting needs the acknowledgement');
 assert.match(screen,/overflow-y-auto overscroll-contain/,'only the content scrolls');
 const edu=readFileSync('src/org/HrEducationAdmin.tsx','utf8');
 assert.doesNotMatch(edu,/gradeChange/);
 assert.match(edu,/organization_home\/hr\/HR07/);
 const positions=readFileSync('src/org/PositionsPage.tsx','utf8');
 assert.match(positions,/jobGradeByLegalEntity,minEducation,/);
 assert.doesNotMatch(positions,/minEducationByLegalEntity/,'the role form has one universal education field');
 assert.match(positions,/id='pos-min-education'/);
 assert.match(positions,/Choose the minimum level of education for this role\. It is required when the role has a job grade/);
});
