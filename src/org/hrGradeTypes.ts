/** Shapes the Job Grades screens share. They mirror what /api/org/hr/job-grades/get returns. */
export type GradeLeaveUnit='working_days'|'calendar_days'|'months';
export type GradeValue={amount?:number;rate?:number};
export type GradeLeave={code:string;daysPerYear:number;accrueMonthly:boolean;unit:GradeLeaveUnit;carryForwardDays:number};
export type Grade={
 code:string;rank:number;title:string;description:string;enabled:boolean;minSalary:number|null;
 taxCodes:string[];deductionCodes:string[];
 /** The one pay model of the grade ('' until chosen). */
 payModelCode:string;
 /** Overtime, allowances, benefits and incentives the grade gets. */
 benefitCodes:string[];
 /** Per-grade amount or rate where the grade differs from the catalogue. */
 benefitValues:Record<string,GradeValue>;
 leave:GradeLeave[];
};
export type CatalogueItem={code:string;name:string;category:string;mandatory:boolean;enabled:boolean;description:string;method:string;amount:number;rate:number;taxable:boolean};
export type CatalogueLeave=CatalogueItem&{defaults:Omit<GradeLeave,'code'>};
export type Catalogue={
 countryCode:string;taxes:CatalogueItem[];deductions:CatalogueItem[];forcedTaxes:string[];forcedDeductions:string[];
 payModels:CatalogueItem[];benefits:CatalogueItem[];leave:CatalogueLeave[];forcedLeave:string[];
 leaveFloors:Record<string,{days:number;unit:GradeLeaveUnit}>;
};

/** Older drafts and viewers without pay access come without a package; give every grade the same shape. */
export const withPackage=(g:Partial<Grade>&Pick<Grade,'code'|'rank'|'title'|'description'|'enabled'|'minSalary'|'taxCodes'|'deductionCodes'>):Grade=>({
 ...g,
 payModelCode:typeof g.payModelCode==='string'?g.payModelCode:'',
 benefitCodes:Array.isArray(g.benefitCodes)?g.benefitCodes:[],
 benefitValues:g.benefitValues&&typeof g.benefitValues==='object'?g.benefitValues:{},
 leave:Array.isArray(g.leave)?g.leave:[],
});

/** Leave a new grade starts with: every type the law requires, at the catalogue default. */
export const defaultLeave=(cat:Catalogue):GradeLeave[]=>
 cat.leave.filter(l=>cat.forcedLeave.includes(l.code)).map(l=>({code:l.code,...l.defaults}));

/** The only enabled pay model, so a new grade needs no choice; '' when there are none or several. */
export const soleModel=(cat:Catalogue)=>{
 const on=cat.payModels.filter(p=>p.enabled);
 return on.length===1?on[0].code:'';
};

export const clonePackage=(g:Grade):Grade=>({
 ...g,taxCodes:[...g.taxCodes],deductionCodes:[...g.deductionCodes],benefitCodes:[...g.benefitCodes],
 benefitValues:Object.fromEntries(Object.entries(g.benefitValues).map(([k,v])=>[k,{...v}])),
 leave:g.leave.map(l=>({...l})),
});
