import {AlertTriangle,Building2} from 'lucide-react';
import {employerTitle,fmtMoney,type DocLine,type PayslipModel} from './hrPayDocument';

/**
 * The payslip as it is printed: employer with logo, employee, job role, employee number, bank details, earnings,
 * deductions, net pay. Always drawn as white paper with dark ink so it reads the same in any theme and matches the PDF.
 */
function Rows({lines,small}:{lines:DocLine[];small?:boolean}){
 return <ul className="divide-y divide-slate-200">
  {lines.map((l,i)=><li key={l.label+i} className="py-1.5">
   <div className={'flex items-start justify-between gap-3 '+(small?'text-xs':'text-sm')}>
    <span className="min-w-0 break-words">{l.label}</span>
    <span className="shrink-0 tabular-nums">{fmtMoney(l.amount)}</span>
   </div>
   {l.note&&<p className={'mt-0.5 text-[11px] '+(/Awaiting verification/.test(l.note)?'text-amber-700':'text-slate-500')}>{l.note}</p>}
  </li>)}
 </ul>;
}
function Heading({children,currency}:{children:string;currency:string}){
 return <div className="flex items-baseline justify-between gap-3 border-b-2 border-slate-900 pb-1">
  <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{children}</h4>
  <span className="text-[10px] text-slate-500">Amount ({currency})</span>
 </div>;
}
function Fact({label,value}:{label:string;value:string}){
 return <div className="min-w-0"><dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="break-words text-sm font-semibold">{value||'-'}</dd></div>;
}

export default function PayslipDocument({model}:{model:PayslipModel}){
 const e=model.employer,emp=model.employee,b=model.bank;
 const title=employerTitle(e);
 const sub=[e.tradingName&&e.tradingName!==title?'t/a '+e.tradingName:'',e.address].filter(Boolean).join(' · ');
 const ids=[e.registrationNumber&&'Reg no '+e.registrationNumber,e.taxNumber&&'Tax PIN '+e.taxNumber,e.phone,e.email].filter(Boolean).join(' · ');
 return <article aria-label={'Payslip '+model.periodLabel+' '+emp.name} className="space-y-4 rounded-xl border border-slate-300 bg-white p-4 text-slate-900">
  <header className="flex items-start gap-3 border-b-2 border-slate-900 pb-3">
   <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white">
    {e.logoUrl?<img src={e.logoUrl} alt={title+' logo'} className="h-full w-full object-contain"/>:<Building2 aria-hidden="true" className="h-6 w-6 text-slate-400"/>}
   </div>
   <div className="min-w-0 flex-1">
    <p className="break-words text-base font-bold leading-tight">{title}</p>
    {sub&&<p className="break-words text-[11px] text-slate-500">{sub}</p>}
    {ids&&<p className="break-words text-[11px] text-slate-500">{ids}</p>}
   </div>
   <div className="shrink-0 text-right"><p className="text-lg font-extrabold tracking-wide">PAYSLIP</p><p className="text-xs text-slate-500">{model.periodLabel}</p></div>
  </header>

  {model.preview&&<p className="rounded-lg bg-amber-50 p-2 text-[11px] font-semibold text-amber-800">Preview. This is not a payroll run: nothing has been paid, posted or filed.</p>}
  {model.unverified>0&&<p role="status" className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800"><AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0"/>
   <span>{model.unverified} item{model.unverified===1?'':'s'} on this payslip {model.unverified===1?'is':'are'} awaiting verification by a second person.</span></p>}

  <div className="grid gap-4 sm:grid-cols-2">
   <dl className="space-y-2">
    <Fact label="Employee" value={emp.name}/>
    <Fact label="Employee number" value={emp.employeeNumber}/>
    <Fact label="Job role" value={emp.roleTitle+(emp.roleCode?' ('+emp.roleCode+')':'')}/>
    <Fact label="Grade" value={[emp.gradeCode,emp.gradeTitle].filter(Boolean).join(' ')}/>
    <Fact label="Site / unit" value={emp.unitName}/>
   </dl>
   <dl className="space-y-2">
    {b?<>
     <Fact label="Bank" value={b.bankName}/>
     <Fact label="Branch" value={b.branch}/>
     <Fact label="Account name" value={b.accountName}/>
     <Fact label="Account number" value={b.accountMasked}/>
     <Fact label="Bank details" value={b.status==='verified'?'Verified':'Awaiting verification'}/>
    </>:<Fact label="Bank" value="No bank details on file"/>}
   </dl>
  </div>

  <section><Heading currency={model.currency}>Earnings</Heading><Rows lines={model.earnings}/>
   <p className="mt-1 flex justify-between border-t border-slate-300 pt-1.5 text-sm font-bold"><span>Gross pay</span><span className="tabular-nums">{fmtMoney(model.gross)}</span></p></section>

  <section><Heading currency={model.currency}>Deductions</Heading>
   {model.deductions.length?<Rows lines={model.deductions}/>:<p className="py-2 text-sm text-slate-500">None</p>}
   <p className="mt-1 flex justify-between border-t border-slate-300 pt-1.5 text-sm font-bold"><span>Total deductions</span><span className="tabular-nums">{fmtMoney(model.totalDeductions)}</span></p></section>

  <p className="flex items-center justify-between gap-3 rounded-lg bg-slate-900 px-3 py-3 text-white"><span className="text-sm font-bold tracking-wide">NET PAY</span>
   <span className="break-words text-right text-base font-extrabold tabular-nums">{model.currency} {fmtMoney(model.net)}</span></p>

  {(model.employerCosts.length>0||model.benefitsInKind.length>0||model.taxablePay>0)&&<section>
   <h4 className="border-b border-slate-300 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">For information (not taken from pay)</h4>
   <Rows small lines={[...(model.taxablePay>0?[{label:'Taxable pay',amount:model.taxablePay}]:[]),...model.benefitsInKind.map(l=>({...l,label:l.label+' (benefit in kind)'})),...model.employerCosts]}/>
  </section>}

  {model.warnings.length>0&&<ul role="alert" className="space-y-1 rounded-lg bg-red-50 p-2 text-[11px] text-red-700">{model.warnings.map(w=><li key={w}>{w}</li>)}</ul>}
 </article>;
}
