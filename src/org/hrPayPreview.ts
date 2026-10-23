import type {PayConfig,PayItem} from '../../backend/hrCompensationConfig';
/** Indicative Kenya reference calculation only. Not a payroll run, approval or filing.
 * Does not include contracts, leave, bonus, benefits, secondary employment,
 * certified exemptions, pension schemes or irregular remuneration.
 */
const round=(x:number)=>Math.round(x*100)/100;
const find=(items:PayItem[],code:string)=>items.find(x=>x.code===code&&x.enabled);
const percent=(base:number,entry?:PayItem)=>{
 if(!entry)return 0;
 return round(Math.max(entry.minimum,Math.min(entry.maximum||Number.POSITIVE_INFINITY,base*entry.rate)));
};
export type KenyaEstimate={gross:number;nssf:number;shif:number;ahl:number;taxable:number;
 payeBeforeRelief:number;personalRelief:number;paye:number;net:number;
 employerNssf:number;employerAhl:number;nita:number;employerTotal:number};
export function estimateKenyaMonthly(gross:number,config:PayConfig,resident=true):KenyaEstimate{
 if(config.countryCode!=='KE')throw new Error('Kenya example requires a KE legal entity.');
 if(!Number.isFinite(gross)||gross<0||gross>100000000)throw new Error('Enter a valid illustrative gross monthly salary.');
 const nssfDef=find(config.items,'KE_NSSF'),shifDef=find(config.items,'KE_SHIF'),ahlDef=find(config.items,'KE_AHL');
 const payeDef=find(config.items,'KE_PAYE');
 const nssf=percent(gross,nssfDef),shif=percent(gross,shifDef),ahl=percent(gross,ahlDef);
 const taxable=round(Math.max(0,gross-nssf-shif-ahl));
 let previous=0,payeBeforeRelief=0;
 for(const band of payeDef?.bands||[]){
  const end=band.upTo??Infinity;
  if(end<=previous)throw new Error('Tax bands must increase in value.');
  const slice=Math.max(0,Math.min(taxable,end)-previous);
  payeBeforeRelief+=slice*band.rate;
  previous=end;
  if(taxable<=end)break;
 }
 payeBeforeRelief=round(payeBeforeRelief);
 const personalRelief=resident?(find(config.items,'KE_PERSONAL_RELIEF')?.amount||0):0;
 const paye=round(Math.max(0,payeBeforeRelief-personalRelief));
 const employerNssf=round(gross*(nssfDef?.employerRate||0));
 const employerAhl=round(gross*(ahlDef?.employerRate||0));
 const nita=find(config.items,'KE_NITA')?.amount||0;
 return {gross:round(gross),nssf,shif,ahl,taxable,payeBeforeRelief,personalRelief,
  paye,net:round(gross-nssf-shif-ahl-paye),
  employerNssf:round(Math.min(nssfDef?.maximum||Infinity,employerNssf)),
  employerAhl,nita,employerTotal:round(gross+Math.min(nssfDef?.maximum||Infinity,employerNssf)+employerAhl+nita)};
}