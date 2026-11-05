import type {DocLine,PayslipModel} from '../org/hrPayDocument';
import {employerTitle,fmtMoney} from '../org/hrPayDocument';
import {downloadBlob} from './xlsx';

/**
 * The payslip as a PDF. Built in the browser from the figures already on the screen; nothing is sent anywhere.
 * pdf-lib is loaded only when a PDF is asked for. The builder takes the library as a parameter so it can be tested
 * without a browser.
 */
type PdfLib=typeof import('pdf-lib');

const A4:[number,number]=[595.28,841.89];
const M=40;

export async function buildPayslipPdf(model:PayslipModel,lib:PdfLib,logoDataUrl=''):Promise<Uint8Array>{
 const {PDFDocument,StandardFonts,rgb}=lib;
 const pdf=await PDFDocument.create();
 pdf.setTitle(`Payslip ${model.periodLabel} ${model.employee.name}`.slice(0,120));
 pdf.setCreator('MEMS');
 pdf.setProducer('MEMS');
 const font=await pdf.embedFont(StandardFonts.Helvetica);
 const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const known=new Set(font.getCharacterSet());
 /** The built-in fonts only cover Latin-1 and a few symbols; anything else becomes ? so the text never turns into garbage. */
 const safe=(s:string)=>Array.from(String(s??'').replace(/[\r\n\t]+/g,' ').replace(/•/g,'*')).map(ch=>known.has(ch.codePointAt(0)!)?ch:'?').join('');
 const ink=rgb(0.09,0.11,0.15),muted=rgb(0.4,0.45,0.52),hair=rgb(0.82,0.85,0.89),amber=rgb(0.72,0.4,0.02),red=rgb(0.75,0.12,0.12);
 const W=A4[0]-M*2;

 let page=pdf.addPage(A4);
 let y=A4[1]-M;
 const newPage=()=>{page=pdf.addPage(A4);y=A4[1]-M;};
 const ensure=(need:number)=>{if(y-need<M+28)newPage();};
 const width=(s:string,size:number,f=font)=>f.widthOfTextAtSize(safe(s),size);
 const wrap=(s:string,size:number,max:number,f=font):string[]=>{
  const words=safe(s).split(' ').filter(Boolean),out:string[]=[];
  let line='';
  for(const w of words){
   const test=line?line+' '+w:w;
   if(f.widthOfTextAtSize(test,size)<=max||!line)line=test;else{out.push(line);line=w;}
  }
  if(line)out.push(line);
  return out.length?out:[''];
 };
 const draw=(s:string,x:number,top:number,size:number,f=font,color=ink)=>page.drawText(safe(s),{x,y:top-size,size,font:f,color});
 const right=(s:string,xRight:number,top:number,size:number,f=font,color=ink)=>draw(s,xRight-width(s,size,f),top,size,f,color);
 const rule=(top:number,color=hair,thickness=0.6)=>page.drawLine({start:{x:M,y:top},end:{x:M+W,y:top},thickness,color});

 // ---- header: logo, employer, title ---------------------------------------------------------------
 let textX=M;
 let headerH=44;
 if(logoDataUrl){
  try{
   const bytes=Uint8Array.from(atob(logoDataUrl.slice(logoDataUrl.indexOf(',')+1)),c=>c.charCodeAt(0));
   const image=logoDataUrl.startsWith('data:image/png')?await pdf.embedPng(bytes):await pdf.embedJpg(bytes);
   const scale=Math.min(120/image.width,48/image.height,1);
   const w=image.width*scale,h=image.height*scale;
   page.drawImage(image,{x:M,y:y-h,width:w,height:h});
   textX=M+w+12;headerH=Math.max(headerH,h);
  }catch{/* a logo that cannot be read is left out; the employer name still prints */}
 }
 const title=employerTitle(model.employer);
 let hy=y;
 draw(title,textX,hy,13,bold);hy-=17;
 const sub=[model.employer.tradingName&&model.employer.tradingName!==title?'t/a '+model.employer.tradingName:'',model.employer.address].filter(Boolean).join(' · ');
 const ids=[model.employer.registrationNumber&&'Reg no '+model.employer.registrationNumber,model.employer.taxNumber&&'Tax PIN '+model.employer.taxNumber,model.employer.phone,model.employer.email].filter(Boolean).join(' · ');
 for(const t of [sub,ids])if(t)for(const line of wrap(t,8.5,W-170-(textX-M))){draw(line,textX,hy,8.5,font,muted);hy-=11;}
 right('PAYSLIP',M+W,y,18,bold);
 right(model.periodLabel,M+W,y-24,10.5,font,muted);
 y=Math.min(hy,y-headerH)-8;
 rule(y,ink,1);y-=10;

 if(model.preview){
  draw('PREVIEW. This is not a payroll run: nothing has been paid, posted or filed.',M,y,8.5,bold,amber);y-=13;
 }
 if(model.unverified>0){
  draw(`${model.unverified} item${model.unverified===1?'':'s'} on this payslip ${model.unverified===1?'is':'are'} awaiting verification by a second person.`,M,y,8.5,font,amber);y-=13;
 }

 // ---- employee and bank ---------------------------------------------------------------------------
 const colW=(W-20)/2;
 const block=(x:number,rows:Array<[string,string]>,top:number)=>{
  let by=top;
  for(const [k,v] of rows){
   draw(k.toUpperCase(),x,by,7,bold,muted);by-=10;
   for(const line of wrap(v||'-',9.5,colW,bold)){draw(line,x,by,9.5,bold);by-=12;}
   by-=3;
  }
  return by;
 };
 ensure(130);
 const e=model.employee,b=model.bank;
 const left=block(M,[['Employee',e.name],['Employee number',e.employeeNumber],['Job role',e.roleTitle+(e.roleCode?' ('+e.roleCode+')':'')],['Grade',[e.gradeCode,e.gradeTitle].filter(Boolean).join(' ')],['Site / unit',e.unitName]],y);
 const rightCol=b
  ?block(M+colW+20,[['Bank',b.bankName],['Branch',b.branch],['Account name',b.accountName],['Account number',b.accountMasked],['Bank details',b.status==='verified'?'Verified':'Awaiting verification']],y)
  :block(M+colW+20,[['Bank','No bank details on file']],y);
 y=Math.min(left,rightCol)-2;
 rule(y);y-=12;

 // ---- tables --------------------------------------------------------------------------------------
 const labelW=W-110;
 const rows=(list:DocLine[],size=9.5)=>{
  for(const l of list){
   const label=wrap(l.label,size,labelW);
   const note=l.note?wrap(l.note,7.5,labelW):[];
   ensure(label.length*(size+3)+note.length*9.5+8);
   const top=y;
   for(const line of label){draw(line,M,y,size);y-=size+3;}
   right(fmtMoney(l.amount),M+W,top,size);
   for(const line of note){draw(line,M,y,7.5,font,muted);y-=9.5;}
   page.drawLine({start:{x:M,y:y-2},end:{x:M+W,y:y-2},thickness:0.3,color:hair});
   y-=6;
  }
 };
 const heading=(t:string)=>{ensure(40);draw(t.toUpperCase(),M,y,8.5,bold,muted);right(`Amount (${model.currency})`,M+W,y,7.5,font,muted);y-=14;rule(y+4,ink,0.8);y-=4;};
 const total=(label:string,amount:number)=>{
  ensure(24);
  draw(label,M,y,10.5,bold);right(fmtMoney(amount),M+W,y,10.5,bold);y-=18;
 };

 heading('Earnings');rows(model.earnings);total('Gross pay',model.gross);
 y-=4;
 heading('Deductions');
 if(model.deductions.length)rows(model.deductions);else{draw('None',M,y,9.5,font,muted);y-=16;}
 total('Total deductions',model.totalDeductions);

 ensure(46);
 y-=2;
 page.drawRectangle({x:M,y:y-30,width:W,height:30,color:rgb(0.09,0.11,0.15)});
 draw('NET PAY',M+12,y-8,12,bold,rgb(1,1,1));
 right(`${model.currency} ${fmtMoney(model.net)}`,M+W-12,y-8,13,bold,rgb(1,1,1));
 y-=46;

 if(model.employerCosts.length||model.benefitsInKind.length||model.taxablePay>0){
  ensure(40);
  draw('FOR INFORMATION (NOT TAKEN FROM PAY)',M,y,8.5,bold,muted);y-=14;rule(y+4,hair);y-=4;
  if(model.taxablePay>0)rows([{label:'Taxable pay',amount:model.taxablePay}],8.5);
  if(model.benefitsInKind.length)rows(model.benefitsInKind.map(l=>({...l,label:l.label+' (benefit in kind)'})),8.5);
  if(model.employerCosts.length)rows(model.employerCosts,8.5);
 }
 for(const w of model.warnings){
  for(const line of wrap(w,8,W)){ensure(12);draw(line,M,y,8,font,red);y-=11;}
 }

 // ---- footer on every page ------------------------------------------------------------------------
 const pages=pdf.getPages();
 const stamp=new Date().toISOString().slice(0,16).replace('T',' ');
 pages.forEach((p,i)=>{
  p.drawLine({start:{x:M,y:M+14},end:{x:M+W,y:M+14},thickness:0.4,color:hair});
  p.drawText(safe(`Confidential: personal pay information. ${title}. Generated ${stamp} UTC by MEMS.`),{x:M,y:M+3,size:7,font,color:muted});
  const label=`Page ${i+1} of ${pages.length}`;
  p.drawText(label,{x:M+W-font.widthOfTextAtSize(label,7),y:M+3,size:7,font,color:muted});
 });
 return pdf.save();
}

/** Builds the payslip PDF in the browser and hands it to the person. */
export async function downloadPayslipPdf(model:PayslipModel,logoDataUrl:string,fileName:string){
 const lib=await import('pdf-lib');
 const bytes=await buildPayslipPdf(model,lib,logoDataUrl);
 downloadBlob(new Blob([bytes as BlobPart],{type:'application/pdf'}),fileName.replace(/[^A-Za-z0-9_-]+/g,'_')+'.pdf');
}
