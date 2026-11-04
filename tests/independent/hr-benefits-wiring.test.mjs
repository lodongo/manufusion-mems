import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=file=>readFileSync(file,'utf8');

test('Education and Benefits are HR sections for their maintainers, not admin pages',()=>{
 const shell=read('src/org/HrShell.tsx');
 assert.match(shell,/\['HR18','Education'\],\['HR19','Benefits'\]/);
 assert.match(shell,/sectionCode==='HR18'&&<HrEducationAdmin\/>/);
 assert.match(shell,/sectionCode==='HR19'&&<HrBenefits\/>/);
 assert.match(shell,/const FIXED_FRAME[^=]*=\[[^\]]*'HR18'[^\]]*'HR19'/,'both keep a fixed top bar; only their content scrolls');
 assert.match(shell,/NOT_LISTED[^=]*=\[[^\]]*'HR18'/,'they open from the HR menu by permission, not from the landing list');
 const home=read('src/org/OrgHomePage.tsx');
 assert.match(home,/label: 'Education', path: 'hr\/HR18', permission: 'HRM\.education\.manage'/);
 assert.match(home,/label: 'Benefits', path: 'hr\/HR19', permission: 'HRM\.benefits\.manage'/);
 assert.match(home,/id === 'HR18' && hasPerm\(data\.permissions,'HRM\.education\.manage'\)/);
 assert.match(home,/id === 'HR19' && \(hasPerm\(data\.permissions,'HRM\.benefits\.manage'\)\|\|hasPerm\(data\.permissions,'HRM\.compensation\.approve'\)\)/);
 const admin=read('src/org/OrgShell.tsx');
 assert.doesNotMatch(admin,/key: 'hr_education_config'/,'no longer an admin menu item');
 assert.doesNotMatch(admin,/import\('\.\/HrEducationAdmin'\)/);
 assert.match(admin,/organization_home\/hr\/HR18/,'old bookmarks are pointed to the new place');
});

test('HR11 is not a dead end: it links to the setup screens the viewer may open',()=>{
 const shell=read('src/org/HrShell.tsx');
 assert.match(shell,/sectionCode==='HR11'&&setup\.length>0&&<Panel title="Set up">/);
 const home=read('src/org/OrgHomePage.tsx');
 assert.match(home,/hasPerm\(data\.permissions,'HRM\.benefits\.manage'\) \? \[\{label:'Benefits'/);
 assert.match(home,/path:'hr\/HR19'/);
});

test('Education keeps only education and has no pay content',()=>{
 const edu=read('src/org/HrEducationAdmin.tsx');
 assert.doesNotMatch(edu,/HrCompensationAdmin|Compensation & Benefits/);
 assert.match(edu,/overflow-y-auto overscroll-contain/,'only the content scrolls');
 assert.match(edu,/disabled=\{busy\|\|loading\|\|dirty\}/,'the legal entity cannot change under unsaved edits');
 assert.match(edu,/organization_home\/hr\/HR07/);
});

test('Benefits is menu driven, drafts and verifies before submitting, and has no Kenya simulation',()=>{
 const src=read('src/org/HrBenefits.tsx');
 assert.doesNotMatch(src,/estimateKenyaMonthly|hrPayPreview|Kenya illustrative/,'the Kenya simulation is gone');
 assert.doesNotMatch(src,/comp-section-select/,'the section is chosen from a menu, not a dropdown');
 assert.match(src,/<Segmented label="Benefits menu"/);
 assert.match(src,/<RichTable key=\{view\}/);
 assert.match(src,/allowExport/,'Excel download');
 assert.match(src,/overflow-y-auto overscroll-contain/,'only the content scrolls');
 assert.match(src,/EXCEPTION_CATEGORIES/);
 assert.match(src,/acknowledge:true/,'submitting needs the acknowledgement');
 assert.match(src,/Chart of Authority/);
 assert.match(src,/isHttps\(/,'references must be https');
 assert.equal(existsOrNot('src/org/HrCompensationAdmin.tsx'),false,'the old combined screen is removed');
 assert.equal(existsOrNot('src/org/hrPayPreview.ts'),false);
});

test('The grade form picks pay, benefits and leave from menus and previews the payslip',()=>{
 const grades=read('src/org/HrJobGrades.tsx');
 assert.match(grades,/<PayTab /);
 assert.match(grades,/<LeaveTab /);
 assert.match(grades,/<PayslipSimulator /);
 assert.match(grades,/packageIssues\(/);
 assert.match(grades,/activationProblems\(grades,currency,rolesUsing,needs\)/);
 assert.doesNotMatch(grades,/estimateKenyaMonthly|TakeHome/);
 const pack=read('src/org/HrGradePackage.tsx');
 assert.match(pack,/role="radiogroup" aria-label="Pay model"/,'the pay model is a single choice');
 assert.match(pack,/type="checkbox"[^>]*checked=\{on\}/,'benefits are a multiple choice');
 assert.match(pack,/Earned month by month/);
 assert.match(pack,/accrueMonthly/);
 assert.match(pack,/leaveFloors/);
 assert.doesNotMatch(pack,/<select|SelectField/,'no dropdowns for benefits');
 const sim=read('src/org/HrPayslipSimulator.tsx');
 assert.match(sim,/computePayslip\(/);
 assert.match(sim,/availableCircumstances\(/);
 assert.match(sim,/not a payroll run/);
});

test('The shared payslip engine has no framework or server imports, so the browser and tests run the same code',()=>{
 const engine=read('src/shared/hrPayslip.ts');
 assert.doesNotMatch(engine,/^import /m);
});

function existsOrNot(file){
 try{readFileSync(file);return true}catch{return false}
}
