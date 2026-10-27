import {useEffect,useMemo,useState} from 'react';
import {ArrowLeftRight,FileCheck2,Landmark,Plus,ShieldCheck} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {SelectField} from '../components/ui';
import RichTable,{type Column} from '../components/RichTable';
import {Segmented,useConfirm} from '../components/screen';
import {IC_TYPES,IC_ROLES,IC_SETTLEMENT,accountRequirements,
 type IcType,type IcAgreement,type IcVoucher,type IcAccounts,type IcSettlementPlan} from '../../backend/corporateIntercompany';
import {majorFromMinor,currencyDigits} from '../../backend/corporateBudget';
import type {PostedIcReport} from '../../backend/corporateIntercompanyPostedReport';
import type {P6Readiness} from '../../backend/corporateIntercompanyReadiness';
import type {IcStagingReport} from '../../backend/corporateIntercompanyReconciliation';

type LE={id:string;code:string;name:string;canView:boolean;canEdit:boolean};
type Tab='agreements'|'voucher'|'matching'|'settlement'|'reconciliation';
const field='min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink';
const btn='min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
const primary='flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand disabled:opacity-40';
const TABLE_HEIGHT='h-[60dvh] min-h-[320px]';
const CODE=/^[A-Z][A-Z0-9_-]{2,29}$/;
const blankAgreement=()=>({
 code:'',name:'',providerId:'',beneficiaryId:'',allowedTypes:['SERVICE_RECHARGE'] as IcType[],
 invoiceCurrency:'KES',ceiling:0,startDate:'',endDate:'',
 settlementPolicy:'MONTHLY',pricingPolicy:'AT_COST',taxPolicyReference:'',
 transferPricingReference:'',supportingAgreementReference:'',purpose:'',
 providerAccounts:{} as IcAccounts,beneficiaryAccounts:{} as IcAccounts,
});
const blankVoucher=()=>({
 agreementId:'',sourceReference:'',type:'SERVICE_RECHARGE' as IcType,
 amount:0,valueDate:'',taxReviewReference:'',transferPricingEvidence:'',
 supportingDocumentReferences:'',description:'',providerCostCenterId:'',beneficiaryCostCenterId:'',
});
const blankSettlement=()=>({voucherId:'',amount:0,plannedDate:'',method:'BANK_TRANSFER',
 paymentReference:'',reason:''});
const label=(x:string)=>x.replaceAll('_',' ');
function Issues({items}:{items:string[]}){
 if(!items.length)return null;
 return <ul role="status" className="list-disc space-y-0.5 rounded-xl border border-line bg-amber-500/10 p-3 pl-7 text-xs text-soft">
  {items.map(x=><li key={x}>{x}</li>)}
 </ul>;
}
export default function CorporateIntercompanyPage({canEdit}:{canEdit:boolean}){
 const [entities,setEntities]=useState<LE[]>([]),[leId,setLeId]=useState('');
 const [centers,setCenters]=useState<Array<{id:string;name:string;code:string;legalEntityId:string}>>([]);
 const [postingEnabled,setPostingEnabled]=useState(false);
 const [postedReport,setPostedReport]=useState<PostedIcReport|null>(null);
 const [agreements,setAgreements]=useState<IcAgreement[]>([]);
 const [vouchers,setVouchers]=useState<IcVoucher[]>([]);
 const [settlements,setSettlements]=useState<IcSettlementPlan[]>([]);
 const [tab,setTab]=useState<Tab>('agreements');
 const [agreement,setAgreement]=useState(blankAgreement());
 const [voucher,setVoucher]=useState(blankVoucher());
 const [settlement,setSettlement]=useState(blankSettlement());
 const [selectedAgreementId,setSelectedAgreementId]=useState('');
 const [selectedVoucherId,setSelectedVoucherId]=useState('');
 const [preview,setPreview]=useState<Record<string,unknown>|null>(null);
 const [readiness,setReadiness]=useState<P6Readiness|null>(null);
 const [report,setReport]=useState<IcStagingReport|null>(null);
 const [error,setError]=useState(''),[info,setInfo]=useState('');
 const {ask,sheet}=useConfirm();
 const err=(e:unknown)=>e instanceof Error?e.message:'Unable to complete action.';
 const fmt=(minor:number,currency:string)=>{
  let decimals=2;try{decimals=currencyDigits(currency)}catch{}
  return currency+' '+new Intl.NumberFormat('en',{minimumFractionDigits:decimals,maximumFractionDigits:decimals})
   .format(majorFromMinor(minor,currency));
 };
 const major=(minor:number,currency:string)=>{try{return majorFromMinor(minor,currency)}catch{return minor/100}};
 const refresh=async()=>{
  if(!leId)return;
  try{
   const [a,v,s]=await Promise.all([
    callBackend<{agreements:IcAgreement[]}>('/api/org/corporate/ic/agreements',{legalEntityId:leId}),
    callBackend<{vouchers:IcVoucher[]}>('/api/org/corporate/ic/vouchers',{legalEntityId:leId}),
    callBackend<{plans:IcSettlementPlan[]}>('/api/org/corporate/ic/settlements',{legalEntityId:leId}),
   ]);
   setAgreements(a.agreements||[]);setVouchers(v.vouchers||[]);setSettlements(s.plans||[]);
  }catch(e){setError(err(e))}
 };
 useEffect(()=>{
  void (async()=>{
   try{
    const [o,options,state]=await Promise.all([
     callBackend<{entities:LE[]}>('/api/org/corporate/ic/options'),
     callBackend<{costCenters:typeof centers}>('/api/org/corporate/allocation/options'),
     callBackend<{postingEnabled:boolean}>('/api/org/corporate/ic/post/status'),
    ]);
    setEntities(o.entities||[]);setCenters(options.costCenters||[]);setPostingEnabled(!!state.postingEnabled);
    setLeId(o.entities?.find(x=>x.canView)?.id||'');
   }catch(e){setError(err(e))}
  })();
 },[]);
 useEffect(()=>{setSelectedAgreementId('');setSelectedVoucherId('');setReport(null);setPostedReport(null);void refresh()},[leId]);
 // Edit rights are per legal entity, not just the Finance permission.
 const entityEdit=canEdit&&!!entities.find(e=>e.id===leId)?.canEdit;
 /** Every Finance request asks for its own reason at the moment of submission (min. 10 characters). */
 const submit=(title:string,confirmLabel:string,message:string,path:string,args:Record<string,unknown>,after?:()=>void)=>{
  setError('');setInfo('');
  ask({title,confirmLabel,message,reason:{label:'Reason for Finance approval',minLength:10,placeholder:'Why is this needed? This is stored with the request and the audit trail.'}},
   async reason=>{
    const r=await callBackend<{id:string}>(path,{...args,reason});
    setInfo('Finance request '+r.id+' submitted for independent approval under Finance authority. No GL posting or cash movement occurred.');
    after?.();
    await refresh();
   });
 };
 const select=(id:string,text:string,value:string,set:(v:string)=>void,options:Array<{value:string;label:string}>,disabled=!entityEdit)=>
  <SelectField id={id} label={text} value={value} disabled={disabled} onChange={e=>set(e.target.value)}>
   <option value="">Select</option>{options.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
  </SelectField>;
 const options=entities.map(e=>({value:e.id,label:e.name+' ('+e.code+')'}));
 const entityName=(id:string)=>entities.find(e=>e.id===id)?.name||id;
 const selectedAgreement=agreements.find(a=>a.id===voucher.agreementId);
 const rolesNeeded=Array.from(new Set(agreement.allowedTypes.flatMap(x=>accountRequirements(x)[0])));
 const rolesNeededBenef=Array.from(new Set(agreement.allowedTypes.flatMap(x=>accountRequirements(x)[1])));
 const acc=(role:keyof IcAccounts,party:'provider'|'beneficiary')=>
  <label key={role} className="block text-sm text-muted">{role} <span className="text-xs">({IC_ROLES[role]})</span>
   <input className={field+' font-mono'} disabled={!entityEdit} placeholder="Approved chart GL code" spellCheck={false}
    value={(party==='provider'?agreement.providerAccounts:agreement.beneficiaryAccounts)[role]||''}
    onChange={e=>{const v=e.target.value.trim();setAgreement(a=>party==='provider'?
     {...a,providerAccounts:{...a.providerAccounts,[role]:v}}:
     {...a,beneficiaryAccounts:{...a.beneficiaryAccounts,[role]:v}});}}/>
  </label>;
 const textField=(text:string,value:string,set:(value:string)=>void,required=false)=>
  <label className="block text-sm text-muted">{text}{required&&' *'}
   <input className={field} disabled={!entityEdit} value={value} maxLength={200} onChange={e=>set(e.target.value)}/></label>;

 // ---- Form verification (mirrors server rules so problems are fixed before submission) ----
 const agreementIssues=useMemo(()=>{
  const out:string[]=[];const a=agreement;
  if(!CODE.test(a.code))out.push('Agreement code: 3–30 capitals, digits, _ or -, starting with a letter.');
  if(!a.name.trim())out.push('Agreement title is required.');
  if(!a.providerId||!a.beneficiaryId)out.push('Select both provider and beneficiary legal entities.');
  else if(a.providerId===a.beneficiaryId)out.push('Provider and beneficiary must be different legal entities.');
  if(!a.allowedTypes.length)out.push('Select at least one permitted transaction type.');
  if(!/^[A-Z]{3}$/.test(a.invoiceCurrency))out.push('Agreement currency must be a 3-letter ISO code.');
  if(!(a.ceiling>0))out.push('Maximum agreement amount must be greater than zero.');
  if(!a.startDate||!a.endDate)out.push('Effective from and to dates are required.');
  else if(a.endDate<a.startDate)out.push('Effective to date must be on or after the start date.');
  if(!a.supportingAgreementReference.trim())out.push('Signed agreement reference is required.');
  if(rolesNeeded.some(r=>!a.providerAccounts[r])||rolesNeededBenef.some(r=>!a.beneficiaryAccounts[r]))
   out.push('Map every required provider and beneficiary GL account.');
  return out;
 },[agreement,rolesNeeded,rolesNeededBenef]);
 const voucherIssues=useMemo(()=>{
  const out:string[]=[];const v=voucher;
  if(!selectedAgreement)return ['Select an approved agreement.'];
  if(!v.providerCostCenterId||!v.beneficiaryCostCenterId)out.push('Select provider and beneficiary cost centres.');
  if(!v.sourceReference.trim())out.push('Source document reference is required.');
  if(!(v.amount>0))out.push('Document amount must be greater than zero.');
  else if(v.amount>major(selectedAgreement.ceilingMinor,selectedAgreement.invoiceCurrency))out.push('Amount exceeds the agreement ceiling.');
  if(!v.valueDate)out.push('Value date is required.');
  else if(v.valueDate<selectedAgreement.startDate||v.valueDate>selectedAgreement.endDate)out.push('Value date is outside the agreement period.');
  if(!v.description.trim())out.push('Transaction narrative is required.');
  return out;
 },[voucher,selectedAgreement]);
 const settlementVoucher=vouchers.find(v=>v.id===settlement.voucherId);
 const settlementIssues=useMemo(()=>{
  const out:string[]=[];
  if(!settlementVoucher)return ['Select a matched voucher.'];
  if(!(settlement.amount>0))out.push('Planned amount must be greater than zero.');
  else if(settlement.amount>major(settlementVoucher.amountMinor,settlementVoucher.currency))out.push('Planned amount exceeds the voucher amount.');
  if(!settlement.plannedDate)out.push('Planned date is required.');
  if(!settlement.paymentReference.trim())out.push('Treasury / payment instruction reference is required.');
  return out;
 },[settlement,settlementVoucher]);

 // ---- Registers ----
 const agreementColumns:Column<IcAgreement>[]=[
  {key:'code',label:'Code',value:a=>a.code},
  {key:'name',label:'Agreement',value:a=>a.name},
  {key:'provider',label:'Provider',value:a=>entityName(a.provider.legalEntityId)},
  {key:'beneficiary',label:'Beneficiary',value:a=>entityName(a.beneficiary.legalEntityId)},
  {key:'status',label:'Status',value:a=>label(a.status)},
  {key:'currency',label:'Currency',value:a=>a.invoiceCurrency},
  {key:'ceiling',label:'Ceiling',type:'number',value:a=>major(a.ceilingMinor,a.invoiceCurrency)},
  {key:'types',label:'Types',value:a=>a.allowedTypes.map(label).join(', '),hidden:true},
  {key:'start',label:'From',type:'date',value:a=>a.startDate,hidden:true},
  {key:'end',label:'To',type:'date',value:a=>a.endDate,hidden:true},
  {key:'providerFcr',label:'Provider FCR',value:a=>a.providerApprovalRef||'Pending',hidden:true},
  {key:'beneficiaryFcr',label:'Beneficiary FCR',value:a=>a.counterpartyApprovalRef||'Pending',hidden:true},
 ];
 const voucherColumns:Column<IcVoucher>[]=[
  {key:'ref',label:'Reference',value:v=>v.sourceReference},
  {key:'type',label:'Type',value:v=>label(v.type)},
  {key:'provider',label:'Provider',value:v=>entityName(v.providerLegalEntityId)},
  {key:'beneficiary',label:'Beneficiary',value:v=>entityName(v.beneficiaryLegalEntityId)},
  {key:'currency',label:'Currency',value:v=>v.currency},
  {key:'amount',label:'Amount',type:'number',value:v=>major(v.amountMinor,v.currency)},
  {key:'status',label:'Status',value:v=>label(v.status)},
  {key:'providerFcr',label:'Provider approval',value:v=>v.providerApprovalRef||'Pending',hidden:true},
  {key:'beneficiaryFcr',label:'Beneficiary approval',value:v=>v.beneficiaryApprovalRef||'Pending',hidden:true},
  {key:'journals',label:'Posted journals',value:v=>[v.providerJournalId,v.beneficiaryJournalId].filter(Boolean).join(' / '),hidden:true},
 ];
 const settlementColumns:Column<IcSettlementPlan>[]=[
  {key:'ref',label:'Payment reference',value:s=>s.paymentReference},
  {key:'method',label:'Method',value:s=>label(s.method)},
  {key:'currency',label:'Currency',value:s=>s.currency},
  {key:'amount',label:'Amount',type:'number',value:s=>major(s.amountMinor,s.currency)},
  {key:'date',label:'Planned date',type:'date',value:s=>s.plannedDate},
  {key:'status',label:'Status',value:s=>label(s.status)},
 ];
 type ReconRow=IcStagingReport['rows'][number];
 const reconColumns:Column<ReconRow>[]=[
  {key:'ref',label:'Reference',value:r=>r.reference},
  {key:'stage',label:'Stage',value:r=>label(r.stage)},
  {key:'provider',label:'Provider',value:r=>entityName(r.providerLegalEntityId)},
  {key:'beneficiary',label:'Beneficiary',value:r=>entityName(r.beneficiaryLegalEntityId)},
  {key:'currency',label:'Currency',value:r=>r.currency},
  {key:'amount',label:'Amount',type:'number',value:r=>major(r.amountMinor,r.currency)},
  {key:'exception',label:'Exception',value:r=>r.exception||''},
 ];
 type PostedRow=PostedIcReport['rows'][number];
 const postedColumns:Column<PostedRow>[]=[
  {key:'ref',label:'Reference',value:r=>r.sourceReference},
  {key:'status',label:'Status',value:r=>label(r.status)},
  {key:'providerJournal',label:'Provider journal',value:r=>r.providerJournalId},
  {key:'beneficiaryJournal',label:'Beneficiary journal',value:r=>r.beneficiaryJournalId},
  {key:'currency',label:'Currency',value:r=>r.currency},
  {key:'amount',label:'Amount',type:'number',value:r=>major(r.documentAmountMinor,r.currency)},
  {key:'exception',label:'Exception',value:r=>r.exception||''},
  {key:'action',label:'Consolidation action',value:r=>r.consolidationAction,hidden:true},
 ];
 const chosenAgreement=agreements.find(a=>a.id===selectedAgreementId);
 const chosenVoucher=vouchers.find(v=>v.id===selectedVoucherId);

 return <div className="min-w-0 space-y-3">
  {sheet}
  <header className="flex items-start gap-2">
   <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-brand"/>
   <p className="text-xs text-muted"><strong className="text-sm text-ink">Intercompany & Treasury.</strong> Agreements, matching and planned settlements between legal entities. Bank transfers, invoices and netting are <strong>not executed</strong> here.</p>
  </header>
  {error&&<p role="alert" className="rounded-xl border border-line bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
  {info&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{info}</p>}
  {select('ic-entity','Finance legal entity',leId,setLeId,options.filter(o=>entities.find(e=>e.id===o.value)?.canView),false)}
  {leId&&!entityEdit&&<p className="text-xs text-muted">Read-only: you do not hold Finance edit rights for this legal entity.</p>}
  <Segmented label="Intercompany sections" value={tab} onChange={v=>{setTab(v);setPreview(null);setReadiness(null);}} options={[
   {value:'agreements',label:'Agreements',count:agreements.length},{value:'voucher',label:'New transaction'},
   {value:'matching',label:'Matching',count:vouchers.length},{value:'settlement',label:'Settlements',count:settlements.length},
   {value:'reconciliation',label:'Reconciliation'},
  ]}/>

  {tab==='agreements'&&<section className="space-y-3">
   {chosenAgreement&&<div className="space-y-2 rounded-xl border border-line bg-panel p-3">
    <strong className="text-sm">{chosenAgreement.code} — {chosenAgreement.name}</strong>
    <p className="text-xs text-muted">{entityName(chosenAgreement.provider.legalEntityId)} → {entityName(chosenAgreement.beneficiary.legalEntityId)} · {label(chosenAgreement.status)} · ceiling {fmt(chosenAgreement.ceilingMinor,chosenAgreement.invoiceCurrency)}</p>
    <p className="text-xs text-muted">Provider FCR {chosenAgreement.providerApprovalRef||'pending'} · Beneficiary FCR {chosenAgreement.counterpartyApprovalRef||'pending'}</p>
    {entityEdit&&chosenAgreement.status==='awaiting_counterparty'&&chosenAgreement.beneficiary.legalEntityId===leId&&
     <button type="button" className={btn} onClick={()=>submit('Accept '+chosenAgreement.code+'?','Submit acceptance',
      'Submits the beneficiary acceptance of this agreement for independent Finance approval.',
      '/api/org/corporate/ic/agreements/accept',{agreementId:chosenAgreement.id})}>
      <FileCheck2 className="mr-1 inline h-4 w-4"/>Submit beneficiary acceptance</button>}
   </div>}
   <RichTable id="corp-ic-agreements" title="Intercompany agreements" fileName="Intercompany_agreements" columns={agreementColumns}
    rows={agreements} rowKey={a=>a.id} onRowClick={a=>setSelectedAgreementId(a.id===selectedAgreementId?'':a.id)}
    rowClassName={a=>a.id===selectedAgreementId?'bg-brand/10':''} height={TABLE_HEIGHT} empty="No agreement exists for this entity."/>
   {entityEdit&&<details className="rounded-xl border border-line bg-panel p-3">
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold"><Plus className="h-4 w-4 text-brand"/>Create an agreement for Finance approval</summary>
    <div className="mt-3 space-y-3">
     {textField('Agreement code',agreement.code,v=>setAgreement(a=>({...a,code:v.toUpperCase().replace(/[^A-Z0-9_-]/g,'')})),true)}
     {textField('Agreement title',agreement.name,v=>setAgreement(a=>({...a,name:v})),true)}
     {select('ic-provider','Provider / lending legal entity *',agreement.providerId,v=>setAgreement(a=>({...a,providerId:v})),options)}
     {select('ic-beneficiary','Beneficiary / borrowing legal entity *',agreement.beneficiaryId,v=>setAgreement(a=>({...a,beneficiaryId:v})),options.filter(o=>o.value!==agreement.providerId))}
     <fieldset className="space-y-1">
      <legend className="text-sm font-semibold">Permitted transaction types *</legend>
      {IC_TYPES.map(t=><label key={t.code} className="flex min-h-11 items-center gap-2 text-sm">
       <input type="checkbox" className="h-5 w-5 accent-brand" checked={agreement.allowedTypes.includes(t.code)}
        onChange={e=>setAgreement(a=>({...a,allowedTypes:e.target.checked?[...a.allowedTypes,t.code]:a.allowedTypes.filter(x=>x!==t.code)}))}/>
       {t.label}</label>)}
     </fieldset>
     <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-sm text-muted">Agreement currency *
       <input className={field} maxLength={3} value={agreement.invoiceCurrency}
        onChange={e=>setAgreement(a=>({...a,invoiceCurrency:e.target.value.toUpperCase().replace(/[^A-Z]/g,'')}))}/></label>
      <label className="text-sm text-muted">Maximum agreement amount *
       <input type="number" inputMode="decimal" min="0" step="any" className={field} value={agreement.ceiling||''}
        onChange={e=>setAgreement(a=>({...a,ceiling:Number(e.target.value)}))}/></label>
     </div>
     <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-sm text-muted">Effective from *
       <input type="date" className={field} value={agreement.startDate} onChange={e=>setAgreement(a=>({...a,startDate:e.target.value}))}/></label>
      <label className="text-sm text-muted">Effective to *
       <input type="date" className={field} min={agreement.startDate||undefined} value={agreement.endDate} onChange={e=>setAgreement(a=>({...a,endDate:e.target.value}))}/></label>
     </div>
     <SelectField id="ic-settle" label="Settlement policy" value={agreement.settlementPolicy} onChange={e=>setAgreement(a=>({...a,settlementPolicy:e.target.value}))}>
      {IC_SETTLEMENT.map(m=><option key={m.code} value={m.code}>{m.label}</option>)}
     </SelectField>
     <SelectField id="ic-pricing" label="Pricing" value={agreement.pricingPolicy}
      onChange={e=>setAgreement(a=>({...a,pricingPolicy:e.target.value}))}>
      <option value="AT_COST">At cost</option><option value="CONTRACT">Contract / transfer pricing</option>
     </SelectField>
     {textField('Signed agreement / legal instrument reference',agreement.supportingAgreementReference,v=>setAgreement(a=>({...a,supportingAgreementReference:v})),true)}
     {textField('Tax treatment and review policy reference',agreement.taxPolicyReference,v=>setAgreement(a=>({...a,taxPolicyReference:v})))}
     {textField('Transfer pricing support reference',agreement.transferPricingReference,v=>setAgreement(a=>({...a,transferPricingReference:v})))}
     <label className="block text-sm text-muted">Purpose and business justification
      <textarea className={field+' min-h-20 p-3'} maxLength={500} value={agreement.purpose}
       onChange={e=>setAgreement(a=>({...a,purpose:e.target.value}))}/></label>
     <div className="space-y-2 rounded-xl border border-line p-3">
      <strong className="text-sm">Provider GL mappings (approved chart codes) *</strong>
      {rolesNeeded.map(r=>acc(r,'provider'))}
     </div>
     <div className="space-y-2 rounded-xl border border-line p-3">
      <strong className="text-sm">Beneficiary GL mappings (approved chart codes) *</strong>
      {rolesNeededBenef.map(r=>acc(r,'beneficiary'))}
     </div>
     <Issues items={agreementIssues}/>
     <button type="button" className={primary} disabled={agreementIssues.length>0} onClick={()=>submit('Propose agreement '+agreement.code+'?','Submit for approval',
      'The agreement goes to the provider entity for independent Finance approval, then to the beneficiary for acceptance.',
      '/api/org/corporate/ic/agreements/propose',{
       agreement:{code:agreement.code,name:agreement.name.trim(),
        provider:{legalEntityId:agreement.providerId,accounts:agreement.providerAccounts},
        beneficiary:{legalEntityId:agreement.beneficiaryId,accounts:agreement.beneficiaryAccounts},
        allowedTypes:agreement.allowedTypes,invoiceCurrency:agreement.invoiceCurrency,
        ceiling:agreement.ceiling,startDate:agreement.startDate,endDate:agreement.endDate,
        settlementPolicy:agreement.settlementPolicy,pricingPolicy:agreement.pricingPolicy,
        taxPolicyReference:agreement.taxPolicyReference,
        transferPricingReference:agreement.transferPricingReference,
        supportingAgreementReference:agreement.supportingAgreementReference,purpose:agreement.purpose},
      },()=>setAgreement(blankAgreement()))}><Plus className="h-4 w-4"/>Propose intercompany agreement</button>
    </div>
   </details>}
  </section>}

  {tab==='voucher'&&<section className="space-y-3 rounded-xl border border-line bg-panel p-3">
   <h4 className="font-semibold">Intercompany transaction voucher</h4>
   <p className="text-xs text-muted">Prepare a voucher under an approved bilateral agreement. Submitting it does not create an invoice, GL entry or payment.</p>
   {select('ic-vagr','Approved agreement *',voucher.agreementId,v=>setVoucher(a=>({...a,agreementId:v,type:agreements.find(x=>x.id===v)?.allowedTypes[0]||'SERVICE_RECHARGE'})),
    agreements.filter(a=>a.status==='approved_policy'&&a.provider.legalEntityId===leId)
     .map(a=>({value:a.id,label:a.code+' — '+a.name})))}
   {selectedAgreement&&<>
    <SelectField id="ic-vtype" label="Transaction type" value={voucher.type} disabled={!entityEdit}
      onChange={e=>setVoucher(a=>({...a,type:e.target.value as IcType}))}>
     {selectedAgreement.allowedTypes.map(x=><option key={x} value={x}>{IC_TYPES.find(t=>t.code===x)?.label}</option>)}
    </SelectField>
    {select('ic-provider-cc','Provider service cost centre *',voucher.providerCostCenterId,v=>setVoucher(a=>({...a,providerCostCenterId:v})),centers.filter(c=>c.legalEntityId===selectedAgreement.provider.legalEntityId).map(c=>({value:c.id,label:c.name+' ('+c.code+')'})))}
    {select('ic-beneficiary-cc','Beneficiary service cost centre *',voucher.beneficiaryCostCenterId,v=>setVoucher(a=>({...a,beneficiaryCostCenterId:v})),centers.filter(c=>c.legalEntityId===selectedAgreement.beneficiary.legalEntityId).map(c=>({value:c.id,label:c.name+' ('+c.code+')'})))}
    <p className="text-xs text-muted">Agreement ceiling {fmt(selectedAgreement.ceilingMinor,selectedAgreement.invoiceCurrency)} · valid {selectedAgreement.startDate} to {selectedAgreement.endDate}</p>
   </>}
   {textField('Source document / invoice / loan instrument reference',voucher.sourceReference,v=>setVoucher(a=>({...a,sourceReference:v})),true)}
   <label className="block text-sm text-muted">Document amount ({selectedAgreement?.invoiceCurrency||'agreement currency'}) *
    <input type="number" inputMode="decimal" min="0" step="any" className={field} disabled={!entityEdit} value={voucher.amount||''}
     onChange={e=>setVoucher(a=>({...a,amount:Number(e.target.value)}))}/></label>
   <label className="block text-sm text-muted">Value date *
    <input type="date" className={field} disabled={!entityEdit} value={voucher.valueDate}
     min={selectedAgreement?.startDate} max={selectedAgreement?.endDate}
     onChange={e=>setVoucher(a=>({...a,valueDate:e.target.value}))}/></label>
   {textField('Tax-review evidence / authority reference',voucher.taxReviewReference,v=>setVoucher(a=>({...a,taxReviewReference:v})))}
   {textField('Transfer-pricing support, if contracted',voucher.transferPricingEvidence,v=>setVoucher(a=>({...a,transferPricingEvidence:v})))}
   {textField('Supporting document references (comma separated)',voucher.supportingDocumentReferences,v=>setVoucher(a=>({...a,supportingDocumentReferences:v})))}
   <label className="block text-sm text-muted">Transaction narrative *
    <textarea className={field+' min-h-20 p-3'} disabled={!entityEdit} maxLength={500} value={voucher.description}
     onChange={e=>setVoucher(a=>({...a,description:e.target.value}))}/></label>
   {entityEdit&&<>
    <Issues items={voucherIssues}/>
    <button type="button" className={primary} disabled={voucherIssues.length>0}
     onClick={()=>submit('Submit voucher '+voucher.sourceReference+'?','Submit for approval',
      'The voucher goes to the provider entity for independent Finance approval. No invoice, GL entry or payment is created.',
      '/api/org/corporate/ic/vouchers/propose',{
       agreementId:voucher.agreementId,
       voucher:{...voucher,supportingDocumentReferences:voucher.supportingDocumentReferences.split(',').map(x=>x.trim()).filter(Boolean)},
      },()=>setVoucher(blankVoucher()))}><FileCheck2 className="h-4 w-4"/>Submit voucher for provider Finance approval</button>
   </>}
  </section>}

  {tab==='matching'&&<section className="space-y-3">
   <p className="text-xs text-muted">Tap a transaction to confirm matching, request posting, or review readiness.</p>
   {chosenVoucher&&<div className="space-y-2 rounded-xl border border-line bg-panel p-3">
    <strong className="text-sm">{chosenVoucher.sourceReference} — {label(chosenVoucher.type)}</strong>
    <p className="text-xs text-muted">{entityName(chosenVoucher.providerLegalEntityId)} → {entityName(chosenVoucher.beneficiaryLegalEntityId)} · {fmt(chosenVoucher.amountMinor,chosenVoucher.currency)} · {label(chosenVoucher.status)}</p>
    {chosenVoucher.status==='posted'&&<p className="text-xs text-muted">Posted journals: {chosenVoucher.providerJournalId} / {chosenVoucher.beneficiaryJournalId}</p>}
    {chosenVoucher.status==='matched_ready'&&!postingEnabled&&<p className="text-xs text-muted">Bilateral GL posting is not activated for this organization yet, so posting cannot be requested.</p>}
    <div className="flex flex-wrap gap-2">
     {entityEdit&&chosenVoucher.beneficiaryLegalEntityId===leId&&chosenVoucher.status==='awaiting_counterparty'&&
      <button type="button" className={btn} onClick={()=>submit('Confirm matching for '+chosenVoucher.sourceReference+'?','Confirm matching',
       'Confirms the beneficiary side of this transaction for independent Finance approval.',
       '/api/org/corporate/ic/vouchers/accept',{voucherId:chosenVoucher.id})}>Confirm beneficiary matching</button>}
     {entityEdit&&chosenVoucher.status==='matched_ready'&&chosenVoucher.providerLegalEntityId===leId&&
      <button type="button" className={btn} disabled={!postingEnabled} title={postingEnabled?'':'Bilateral posting is not activated for this organization'}
       onClick={()=>submit('Request GL posting for '+chosenVoucher.sourceReference+'?','Request posting',
        'Requests an atomic bilateral GL posting. It runs only after independent Finance approval.',
        '/api/org/corporate/ic/post/propose',{voucherId:chosenVoucher.id})}>Request bilateral GL posting</button>}
     <button type="button" className={btn} onClick={async()=>{
       try{setReadiness(await callBackend<P6Readiness>('/api/org/corporate/ic/post/readiness',{voucherId:chosenVoucher.id}));setError('')}
       catch(e){setError(err(e))}
     }}>Release readiness</button>
     {chosenVoucher.providerLegalEntityId===leId&&<button type="button" className={btn} onClick={async()=>{
      try{setPreview(await callBackend<Record<string,unknown>>('/api/org/corporate/ic/vouchers/preview',{voucherId:chosenVoucher.id}));setError('')}
      catch(e){setError(err(e))}
     }}>Preview GL intent</button>}
    </div>
   </div>}
   <RichTable id="corp-ic-vouchers" title="Intercompany transactions" fileName="Intercompany_transactions" columns={voucherColumns}
    rows={vouchers} rowKey={v=>v.id} onRowClick={v=>{setSelectedVoucherId(v.id===selectedVoucherId?'':v.id);setPreview(null);setReadiness(null);}}
    rowClassName={v=>v.id===selectedVoucherId?'bg-brand/10':''} height={TABLE_HEIGHT} empty="No intercompany vouchers recorded for this legal entity."/>
   {readiness&&<section className="space-y-2 rounded-xl border border-line bg-panel p-3">
    <strong className="text-sm">Release preflight · {readiness.voucherId}</strong>
    <p className="text-xs text-muted">{readiness.readyForApplicationTest?'Automated technical checks passed':'Technical checks need attention'} · Business authorization: not yet certified</p>
    {readiness.checks.map(c=><p key={c.code} className={'text-xs '+(c.passed?'text-muted':'font-semibold text-red-500')}>{c.passed?'✓':'!'} {c.detail}</p>)}
    <strong className="text-xs">Mandatory Finance/Tax release steps</strong>
    {readiness.manualReleaseGates.map(x=><p key={x} className="text-xs text-muted">• {x}</p>)}
    <p className="text-xs text-muted">This check reads configuration only. It never posts, approves, invoices or transfers funds.</p>
   </section>}
   {preview&&<section className="space-y-2 rounded-xl border border-line bg-panel p-3">
    <strong className="text-sm">Unposted journal preview — no ledger entry created</strong>
    {(['provider','beneficiary'] as const).map(party=>{
     const j=preview[party] as {legalEntityId:string;functionalCurrency:string;lines:Array<{side:string;role:string;glCode:string;amountMinor:number}>};
     return j&&<div key={party} className="space-y-1">
      <p className="text-sm font-semibold">{party} · {entityName(j.legalEntityId)} · {j.functionalCurrency}</p>
      {j.lines.map((x,i)=><p key={i} className="text-xs text-muted">{x.side==='D'?'Dr':'Cr'} {x.glCode} — {x.role}: {fmt(x.amountMinor,j.functionalCurrency)}</p>)}
     </div>;
    })}
   </section>}
  </section>}

  {tab==='settlement'&&<section className="space-y-3">
   <RichTable id="corp-ic-settlements" title="Settlement plans" fileName="Intercompany_settlement_plans" columns={settlementColumns}
    rows={settlements} rowKey={s=>s.id} height={TABLE_HEIGHT} empty="No settlement plans yet."/>
   {entityEdit&&<details className="rounded-xl border border-line bg-panel p-3">
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold"><ArrowLeftRight className="h-4 w-4 text-brand"/>Plan a settlement (no cash execution)</summary>
    <div className="mt-3 space-y-3">
     <p className="text-xs text-muted">Schedules are not proof of settlement. A matched voucher has no GL balance until bilateral posting is activated.</p>
     {select('ic-sv','Matched voucher *',settlement.voucherId,v=>setSettlement(x=>({...x,voucherId:v})),
       vouchers.filter(v=>v.status==='matched_ready'&&v.beneficiaryLegalEntityId===leId)
        .map(v=>({value:v.id,label:v.sourceReference+' — '+fmt(v.amountMinor,v.currency)})))}
     <label className="block text-sm text-muted">Planned settlement amount *
      <input type="number" inputMode="decimal" min="0" step="any" className={field} value={settlement.amount||''}
       onChange={e=>setSettlement(x=>({...x,amount:Number(e.target.value)}))}/></label>
     <label className="block text-sm text-muted">Planned date *
      <input type="date" className={field} value={settlement.plannedDate}
       onChange={e=>setSettlement(x=>({...x,plannedDate:e.target.value}))}/></label>
     <SelectField id="ic-method" label="Planned settlement method" value={settlement.method}
      onChange={e=>setSettlement(x=>({...x,method:e.target.value}))}>
      {['BANK_TRANSFER','INTERCOMPANY_NETTING','CASH_POOL','MANUAL'].map(x=><option key={x} value={x}>{label(x)}</option>)}
     </SelectField>
     {textField('Treasury / payment instruction reference (not executed)',settlement.paymentReference,v=>setSettlement(x=>({...x,paymentReference:v})),true)}
     <Issues items={settlementIssues}/>
     <button type="button" className={primary} disabled={settlementIssues.length>0}
      onClick={()=>submit('Submit settlement plan?','Submit for approval',
       'The plan goes for independent Finance approval. No bank transfer or GL movement happens.',
       '/api/org/corporate/ic/settlements/propose',{...settlement},()=>setSettlement(blankSettlement()))}>
      <ArrowLeftRight className="h-4 w-4"/>Submit settlement plan for approval</button>
    </div>
   </details>}
  </section>}

  {tab==='reconciliation'&&<section className="space-y-3">
   <p className="text-xs text-muted">Reconciles approved voucher and settlement-plan information, and separately the posted bilateral journals. Neither reads bank receipts or cash.</p>
   <div className="grid gap-2 sm:grid-cols-2">
    <button type="button" className={btn} disabled={!leId} onClick={async()=>{
     try{setReport(await callBackend<IcStagingReport>('/api/org/corporate/ic/reconciliation',{legalEntityId:leId}));setError('')}
     catch(e){setError(err(e))}
    }}>Refresh matching and settlement coverage</button>
    <button type="button" className={btn} disabled={!leId} onClick={async()=>{
     try{setPostedReport(await callBackend<PostedIcReport>('/api/org/corporate/ic/posted-reconciliation',{legalEntityId:leId}));setError('')}
     catch(e){setError(err(e))}
    }}>Reconcile posted bilateral journals</button>
   </div>
   {report&&<>
    <p className="text-sm">Matched, unposted: <strong>{report.readyUnpostedCount}</strong> · Pending or needing review: <strong>{report.unmatchedCount}</strong></p>
    <div className="grid gap-2 sm:grid-cols-2">{report.currencies.map(r=><div key={r.currency} className="space-y-1 rounded-xl border border-line bg-panel p-3">
     <strong className="text-sm">{r.currency}</strong>
     <p className="text-xs text-muted">Matched but unposted: {fmt(r.matchedUnpostedMinor,r.currency)}</p>
     <p className="text-xs text-muted">Awaiting beneficiary: {fmt(r.awaitingMinor,r.currency)}</p>
     <p className="text-xs text-muted">Planned settlement (not paid): {fmt(r.plannedSettlementMinor,r.currency)}</p>
     <p className="text-xs text-muted">Without settlement plan: {fmt(r.unplannedMinor,r.currency)}</p>
    </div>)}</div>
    <RichTable id="corp-ic-reconciliation" title="Intercompany reconciliation" fileName="Intercompany_reconciliation" columns={reconColumns}
     rows={report.rows} rowKey={r=>r.voucherId} height={TABLE_HEIGHT} rowClassName={r=>r.exception?'text-red-500':''}/>
    <p className="text-xs text-muted">{report.warning}</p>
   </>}
   {postedReport&&<>
    <p className="text-sm font-semibold">Posted pairs: {postedReport.postedCount} · Exceptions: {postedReport.exceptions}</p>
    <RichTable id="corp-ic-posted" title="Posted bilateral journals" fileName="Intercompany_posted_journals" columns={postedColumns}
     rows={postedReport.rows} rowKey={r=>r.voucherId} height={TABLE_HEIGHT} rowClassName={r=>r.exception?'text-red-500':''}/>
    <p className="text-xs text-muted">{postedReport.note}</p>
   </>}
  </section>}

  <p className="flex gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4 shrink-0 text-brand"/>
   Each submission asks for its own reason and goes to independent Finance approval under the Chart of Authority. Approvals do not create statutory invoices or bank transfers.</p>
 </div>;
}
