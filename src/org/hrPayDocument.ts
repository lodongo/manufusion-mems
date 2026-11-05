import type {Payslip,PayslipLine} from '../shared/hrPayslip';

/**
 * The payslip as a document: the parts a printed payslip has, in the order it has them. Built once from the engine's
 * result so the screen and the PDF can never show different figures.
 */
export type DocLine={label:string;amount:number;note?:string};
export type EmployerBlock={name:string;displayName:string;tradingName:string;registrationNumber:string;taxNumber:string;address:string;phone:string;email:string;logoUrl:string};
export type EmployeeBlock={name:string;employeeNumber:string;roleTitle:string;roleCode:string;gradeCode:string;gradeTitle:string;unitName:string};
export type BankBlock={bankName:string;branch:string;accountName:string;accountMasked:string;status:'pending'|'verified'};
export type PayslipModel={
 employer:EmployerBlock;employee:EmployeeBlock;bank:BankBlock|null;
 periodLabel:string;currency:string;
 earnings:DocLine[];gross:number;
 deductions:DocLine[];totalDeductions:number;
 net:number;
 benefitsInKind:DocLine[];employerCosts:DocLine[];taxablePay:number;
 warnings:string[];notes:string[];
 /** Personal lines and bank details still waiting for a second person. */
 unverified:number;
 /** True while no payroll run exists: the document says so. */
 preview:boolean;
};

const r2=(n:number)=>Math.round((Number.isFinite(n)?n:0)*100)/100;
export const fmtMoney=(n:number)=>new Intl.NumberFormat('en',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
const take=(p:Payslip,...sections:PayslipLine['section'][])=>p.lines.filter(l=>sections.includes(l.section));
const asLine=(l:PayslipLine):DocLine=>({label:l.label,amount:l.amount,note:l.note});

/** Earnings, deductions, net pay and the memo sections of a payslip. */
export function payslipTables(p:Payslip){
 const earnings=take(p,'earnings').filter(l=>l.code!=='GROSS').map(asLine);
 const statutory=take(p,'preTax').map(asLine);
 const taxLine=take(p,'tax')[0];
 const paye:DocLine[]=taxLine?[{label:taxLine.label.replace(/ before relief$/i,''),amount:p.tax,
  note:p.reliefTotal>0?`Tax before relief ${fmtMoney(p.taxBeforeRelief)} less relief ${fmtMoney(p.reliefTotal)}`:undefined}]:[];
 const other=take(p,'deductions').map(asLine);
 const deductions=[...statutory,...paye,...other];
 return {
  earnings,gross:p.grossCash,
  deductions,totalDeductions:r2(p.grossCash-p.net),
  net:p.net,
  benefitsInKind:take(p,'noncash').map(asLine),
  employerCosts:take(p,'employer').map(asLine),
  taxablePay:p.taxablePay,
  warnings:p.warnings,notes:p.notes,
 };
}

/** Everything the screen and the PDF draw. */
export function payslipModel(input:{payslip:Payslip;employer:EmployerBlock;employee:EmployeeBlock;bank:BankBlock|null;periodLabel:string;currency:string;unverified:number;preview:boolean}):PayslipModel{
 return {
  employer:input.employer,employee:input.employee,bank:input.bank,periodLabel:input.periodLabel,currency:input.currency,
  ...payslipTables(input.payslip),unverified:input.unverified,preview:input.preview,
 };
}

/** The name the payslip header shows: the legal entity's registered name, else the organization's display name. */
export const employerTitle=(e:EmployerBlock)=>e.name||e.displayName||'Employer';
