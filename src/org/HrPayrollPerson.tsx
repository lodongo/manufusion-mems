import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Download,FileText} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {flush,track} from '../lib/audit';
import {Segmented,messageOf} from '../components/screen';
import {computePayslip,type PayslipItem} from '../shared/hrPayslip';
import {linesForMonth,monthLabel,shiftMonth} from '../shared/hrPayItems';
import PayslipSimulator from './HrPayslipSimulator';
import PayslipDocument from './HrPayslipDocument';
import HrPayDetails,{type PersonPay} from './HrPayDetails';
import {NumField,btn,primary} from './hrFormParts';
import {withPackage} from './hrGradeTypes';
import {money} from './hrGradeFacts';
import {payslipModel} from './hrPayDocument';
import {belowMin,salaryIssue,toGrade,type Emp,type PayGrade,type SalaryState} from './hrPayrollView';

type Tab='payslip'|'details'|'test';
type Entity={id:string;name:string;countryCode:string};
type Source={grades:'approved'|'draft';gradesVersion:number;policy:'approved'|'draft';policyVersion:number};
export type PaySummary=Partial<{payBank:'none'|'pending'|'verified';payItems:number;payPending:number;salary:SalaryState}>;

const thisMonth=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');};
const LOWEST='2020-01',HIGHEST='2100-12';

/**
 * Everything about one employee's pay in one sheet: the payslip as a document (with PDF), the employee's bank details
 * and personal earnings and deductions, and the test cases that were here before.
 *
 * The basic salary lives here and only here: the employee list never carries it. It is read with the employee's pay
 * details when the sheet opens (the read is audited) and saved for this one employee, with the salary the sheet opened
 * with sent back so a change made by someone else in the meantime is not overwritten silently.
 */
export default function HrPayrollPerson({emp,grade,items,entity,currency,source,canEditSalary,onSummary}:{
 emp:Emp;grade?:PayGrade;items:PayslipItem[];entity:Entity;currency:string;source:Source;canEditSalary:boolean;
 onSummary:(uid:string,s:PaySummary)=>void;
}){
 const [tab,setTab]=useState<Tab>('payslip');
 const [month,setMonth]=useState(thisMonth);
 const [person,setPerson]=useState<PersonPay|null>(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 // The salary: what was saved when the sheet opened (base), and what is typed now (NaN when the box is empty).
 const [draft,setDraft]=useState<number>(NaN);
 const [base,setBase]=useState<number|null>(null);
 const [salaryReady,setSalaryReady]=useState(false),[savingSalary,setSavingSalary]=useState(false);
 const first=useRef(true);

 const load=useCallback(async()=>{
  setError('');
  try{
   const r=await callBackend<PersonPay>('/api/org/hr/payroll/person/get',{legalEntityId:entity.id,uid:emp.uid});
   setPerson(r);
   if(first.current){first.current=false;setBase(r.salary);setDraft(r.salary===null?NaN:r.salary);setSalaryReady(true);}
   onSummary(emp.uid,{payBank:r.bank?r.bank.status:'none',payItems:r.items.length,payPending:r.items.filter(i=>i.status==='pending').length});
  }catch(e){setError(messageOf(e,'The pay details could not be loaded.'));}
  finally{setLoading(false);}
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[entity.id,emp.uid]);
 useEffect(()=>{setLoading(true);void load();},[load]);

 const basic=draft;
 const personal=useMemo(()=>linesForMonth(person?.items||[],month),[person,month]);
 const result=useMemo(()=>{
  if(!grade||!Number.isFinite(basic)||basic<=0)return {p:null,error:''};
  try{
   return {p:computePayslip(toGrade(grade),items,{basicSalary:basic,circumstances:[],declared:{},otherDeductions:{},
    personalEarnings:personal.earnings,personalDeductions:personal.deductions}),error:''};
  }catch(e){return {p:null,error:messageOf(e,'The payslip could not be calculated.')};}
 },[grade,items,basic,personal]);

 const model=useMemo(()=>result.p&&person?payslipModel({
  payslip:result.p,employer:person.employer,
  employee:{name:emp.name,employeeNumber:emp.employeeNumber,roleTitle:emp.roleTitle,roleCode:emp.roleCode,gradeCode:emp.gradeCode,gradeTitle:emp.gradeTitle,unitName:emp.unitName||''},
  bank:person.bank?{bankName:person.bank.bankName,branch:person.bank.branch,accountName:person.bank.accountName,accountMasked:person.bank.accountMasked,status:person.bank.status}:null,
  periodLabel:monthLabel(month),currency,unverified:personal.pending+(person.bank?.status==='pending'?1:0),preview:true,
 }):null,[result.p,person,emp,month,currency,personal.pending]);

 const download=async()=>{
  if(!model)return;
  setBusy(true);setError('');
  try{
   const logo=await callBackend<{logo:string}>('/api/org/hr/payroll/logo',{legalEntityId:entity.id}).then(r=>r.logo).catch(()=>'');
   const {downloadPayslipPdf}=await import('../lib/payslipPdf');
   await downloadPayslipPdf(model,logo,'Payslip_'+(emp.employeeNumber||emp.uid)+'_'+month);
   track('export','payslip.export','hr-payroll','Payslip','month='+month);
   void flush();
  }catch(e){setError(messageOf(e,'The PDF could not be made.'));}
  finally{setBusy(false);}
 };
 const step=(by:number)=>{const next=shiftMonth(month,by);if(next>=LOWEST&&next<=HIGHEST)setMonth(next);};
 const below=belowMin(basic,emp.minSalary);
 const issue=salaryIssue(basic);
 const dirty=salaryReady&&!Object.is(draft,base===null?NaN:base);
 const saveSalary=async()=>{
  if(!canEditSalary||!dirty||issue)return;
  const value=Number.isNaN(draft)?null:draft;
  setSavingSalary(true);setError('');setNotice('');
  try{
   await callBackend('/api/org/hr/payroll/save',{legalEntityId:entity.id,salaries:{[emp.uid]:value},expected:{[emp.uid]:base}});
   setBase(value);
   onSummary(emp.uid,{salary:value===null?'none':belowMin(value,emp.minSalary)?'below':'ok'});
   setNotice(value===null?'The salary was cleared.':'Salary saved as a draft.'+(belowMin(value,emp.minSalary)?' It is below the grade minimum.':''));
  }catch(e){setError(messageOf(e,'The salary could not be saved.'));}
  finally{setSavingSalary(false);}
 };
 const pending=(person?.items.filter(i=>i.status==='pending').length||0)+(person?.bank?.status==='pending'?1:0);

 return <div className="space-y-3">
  <Segmented<Tab> label="Employee pay" value={tab} onChange={setTab} options={[
   {value:'payslip',label:'Payslip'},{value:'details',label:'Pay details',count:pending||undefined},{value:'test',label:'Test cases'}]}/>
  {error&&<p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}

  {tab==='payslip'&&<div className="space-y-3">
   <div className="flex items-center gap-2">
    <button type="button" className={btn+' h-11 w-11 shrink-0 px-0'} aria-label="Previous month" onClick={()=>step(-1)}><ChevronLeft className="h-5 w-5"/></button>
    <p className="min-w-0 flex-1 text-center text-sm font-semibold text-ink" aria-live="polite">{monthLabel(month)}</p>
    <button type="button" className={btn+' h-11 w-11 shrink-0 px-0'} aria-label="Next month" onClick={()=>step(1)}><ChevronRight className="h-5 w-5"/></button>
   </div>
   <div className="space-y-2">
    <NumField label={'Basic monthly salary ('+currency+')'} value={basic} optional onChange={n=>{setDraft(n);setNotice('');}} disabled={!canEditSalary||!salaryReady||savingSalary} invalid={below||!!issue} hintTone={below||issue?'danger':'normal'}
     hint={issue||(below?'Below the grade minimum of '+money(emp.minSalary,currency):emp.minSalary>0?'Grade minimum '+money(emp.minSalary,currency):emp.gradeCode?'This grade has no minimum salary set yet.':'No grade, so there is no minimum to check.')}/>
    {!salaryReady&&!loading&&<button type="button" className={btn+' w-full'} onClick={()=>{setLoading(true);void load();}}>Try loading the salary again</button>}
    {dirty&&<p className="text-xs font-semibold text-amber-700">Not saved yet. The payslip below uses the amount you typed.</p>}
    {canEditSalary&&<button type="button" className={primary+' w-full'} disabled={!dirty||!!issue||savingSalary} onClick={()=>void saveSalary()}>{savingSalary?'Saving…':'Save salary'}</button>}
    {!canEditSalary&&<p className="text-xs text-muted">{person?.isSelf?'You cannot set your own salary. Ask another payroll officer.':'You can view the salary. Entering it needs the HR – Payroll Officer role.'}</p>}
   </div>
   {(source.grades==='draft'||source.policy==='draft')&&<p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700">Built from the {source.grades==='draft'&&source.policy==='draft'?'draft job grades and Benefits policy':source.grades==='draft'?'draft job grades':'draft Benefits policy'}, which are not approved yet.</p>}
   {emp.problem&&<p className="rounded-xl bg-amber-500/10 p-3 text-xs font-semibold text-amber-700">{emp.problemText}. A payslip needs a job role with a grade in this legal entity.</p>}
   {loading&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">Loading the payslip…</p>}
   {!loading&&!person&&!error&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">The employer and bank details could not be loaded.</p>}
   {result.error&&<p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{result.error}</p>}
   {!loading&&person&&!model&&!result.error&&!emp.problem&&<p className="rounded-xl bg-panel p-3 text-sm text-muted"><FileText className="mr-2 inline h-4 w-4"/>Enter the basic salary above to see the payslip.</p>}
   {model&&<>
    <PayslipDocument model={model}/>
    <button type="button" className={primary+' w-full'} disabled={busy} onClick={()=>void download()}><Download className="h-5 w-5"/>{busy?'Making the PDF…':'Download PDF'}</button>
   </>}
  </div>}

  {tab==='details'&&(person
   ?<HrPayDetails entity={entity} uid={emp.uid} person={person} month={month} currency={currency} onChanged={()=>void load()}/>
   :<p className="rounded-xl bg-panel p-3 text-sm text-muted">{loading?'Loading…':'The pay details could not be loaded.'}</p>)}

  {tab==='test'&&(grade
   ?<PayslipSimulator key={emp.uid} grade={withPackage({...grade,description:''})} items={items} currency={currency} policyVersion={source.policyVersion}
     basic={basic} onBasicChange={canEditSalary?setDraft:()=>undefined}
     note={'Test cases for the grade: overtime, exceptions and claims. Not this employee’s payslip. Built from the '+source.grades+' job grade and the '+source.policy+' Benefits policy (v'+source.policyVersion+').'}/>
   :<p className="rounded-xl bg-panel p-3 text-sm text-muted">This employee has no grade, so there is nothing to test.</p>)}
 </div>;
}
