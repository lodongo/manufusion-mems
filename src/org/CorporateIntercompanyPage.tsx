import {useEffect,useState} from 'react';
import {ArrowLeftRight,FileCheck2,Landmark,Plus,ShieldCheck} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {SelectField} from '../components/ui';
import {IC_TYPES,IC_ROLES,IC_SETTLEMENT,accountRequirements,
 type IcType,type IcAgreement,type IcVoucher,type IcAccounts,type IcSettlementPlan} from '../../backend/corporateIntercompany';
import {majorFromMinor,currencyDigits} from '../../backend/corporateBudget';

type LE={id:string;code:string;name:string;canView:boolean;canEdit:boolean};
const field='min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink';
const btn='min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
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
 supportingDocumentReferences:'',description:'',
});
const blankSettlement=()=>({voucherId:'',amount:0,plannedDate:'',method:'BANK_TRANSFER',
 paymentReference:'',reason:''});
export default function CorporateIntercompanyPage({canEdit}:{canEdit:boolean}){
 const [entities,setEntities]=useState<LE[]>([]),[leId,setLeId]=useState('');
 const [agreements,setAgreements]=useState<IcAgreement[]>([]);
 const [vouchers,setVouchers]=useState<IcVoucher[]>([]);
 const [settlements,setSettlements]=useState<IcSettlementPlan[]>([]);
 const [tab,setTab]=useState<'agreements'|'voucher'|'matching'|'settlement'>('agreements');
 const [agreement,setAgreement]=useState(blankAgreement());
 const [voucher,setVoucher]=useState(blankVoucher());
 const [settlement,setSettlement]=useState(blankSettlement());
 const [reason,setReason]=useState('');
 const [preview,setPreview]=useState<Record<string,unknown>|null>(null);
 const [error,setError]=useState(''),[info,setInfo]=useState(''),[busy,setBusy]=useState(false);
 const err=(e:unknown)=>e instanceof Error?e.message:'Unable to complete action.';
 const fmt=(minor:number,currency:string)=>{
  let decimals=2;try{decimals=currencyDigits(currency)}catch{}
  return currency+' '+new Intl.NumberFormat('en',{minimumFractionDigits:decimals,maximumFractionDigits:decimals})
   .format(majorFromMinor(minor,currency));
 };
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
    const o=await callBackend<{entities:LE[]}>('/api/org/corporate/ic/options');
    setEntities(o.entities||[]);
    setLeId(o.entities?.find(x=>x.canView)?.id||'');
   }catch(e){setError(err(e))}
  })()
 },[]);
 useEffect(()=>{void refresh()},[leId]);
 const submit=async(path:string,args:Record<string,unknown>)=>{
  if(busy)return;
  setError('');setInfo('');setBusy(true);
  try{
   const r=await callBackend<{id:string}>(path,args);
   setInfo('Finance request '+r.id+' submitted. It requires independent approval under existing Finance authority. No GL posting or cash movement occurred.');
   await refresh();
  }catch(e){setError(err(e))}
  finally{setBusy(false)}
 };
 const select=(id:string,label:string,value:string,set:(v:string)=>void,options:Array<{value:string;label:string}>)=>
  <SelectField id={id} label={label} value={value} disabled={!canEdit} onChange={e=>set(e.target.value)}>
   <option value="">Select</option>{options.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
  </SelectField>;
 const options=entities.map(e=>({value:e.id,label:e.name+' ('+e.code+')'}));
 const selectedAgreement=agreements.find(a=>a.id===voucher.agreementId);
 const rolesNeeded=Array.from(new Set(agreement.allowedTypes.flatMap(x=>accountRequirements(x)[0])));
 const rolesNeededBenef=Array.from(new Set(agreement.allowedTypes.flatMap(x=>accountRequirements(x)[1])));
 const acc=(role:keyof IcAccounts,party:'provider'|'beneficiary')=>
  <label key={role} className="block text-sm text-muted">{role} <span className="text-xs">({IC_ROLES[role]})</span>
   <input className={field} disabled={!canEdit} placeholder="Select configured GL account code" value={(party==='provider'?agreement.providerAccounts:agreement.beneficiaryAccounts)[role]||''}
    onChange={e=>setAgreement(a=>party==='provider'?
     {...a,providerAccounts:{...a.providerAccounts,[role]:e.target.value}}:
     {...a,beneficiaryAccounts:{...a.beneficiaryAccounts,[role]:e.target.value}})}/>
  </label>;
 const textField=(label:string,value:string,set:(value:string)=>void)=>
  <label className="block text-sm text-muted">{label}
   <input className={field} disabled={!canEdit} value={value} onChange={e=>set(e.target.value)}/></label>;
 return <div className="min-w-0 space-y-4">
  <header className="rounded-2xl border border-line bg-panel p-4 space-y-2">
   <h3 className="flex items-center gap-2 font-bold text-lg"><Landmark className="h-5 w-5 text-brand"/>Intercompany & Treasury</h3>
   <p className="text-sm text-muted">P4: bilateral legal-entity financial agreements, transaction matching and planned settlements. GL journals, bank transfers, statutory invoices and intercompany netting are <strong>not executed</strong> in this version.</p>
  </header>
  {error&&<p role="alert" className="rounded-xl border border-line p-3 text-sm text-red-600">{error}</p>}
  {info&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{info}</p>}
  {select('ic-entity','Select finance legal entity',leId,setLeId,options.filter(o=>entities.find(e=>e.id===o.value)?.canView))}
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
   {([['agreements','Agreements'],['voucher','Transactions'],['matching','Matching'],['settlement','Settlement Plans']] as const).map(([code,label])=>
    <button type="button" key={code} className={'min-h-11 rounded-lg border border-line text-xs font-semibold px-2 '+(tab===code?'text-brand bg-brand/10':'bg-panel text-muted')}
     onClick={()=>setTab(code)}>{label}</button>)}
  </div>
  {tab==='agreements'&&<section className="space-y-3">
   <div className="rounded-xl border border-line bg-panel p-3 space-y-2">
    <h4 className="font-semibold">Existing intercompany agreements</h4>
    {agreements.length===0&&<p className="text-sm text-muted">No agreement exists for this entity.</p>}
    {agreements.map(a=><div key={a.id} className="rounded-lg border border-line p-3 space-y-2">
     <strong className="text-sm">{a.code} — {a.name}</strong>
     <p className="text-xs text-muted">{a.provider.legalEntityId} → {a.beneficiary.legalEntityId} · {a.status.replaceAll('_',' ')}</p>
     <p className="text-xs text-muted">Ceiling {fmt(a.ceilingMinor,a.invoiceCurrency)} · {a.allowedTypes.join(', ')}</p>
     <p className="text-xs text-muted">Provider FCR {a.providerApprovalRef||'pending'} · Beneficiary FCR {a.counterpartyApprovalRef||'pending'}</p>
     {canEdit&&a.status==='awaiting_counterparty'&&a.beneficiary.legalEntityId===leId&&
      <button type="button" className={btn} disabled={busy||reason.trim().length<10} onClick={()=>void submit('/api/org/corporate/ic/agreements/accept',{agreementId:a.id,reason})}>
       <FileCheck2 className="inline h-4 w-4 mr-1"/>Submit beneficiary acceptance</button>}
    </div>)}
   </div>
   <div className="rounded-xl border border-line bg-panel p-3 space-y-3">
    <h4 className="font-semibold">Create an agreement for Finance approval</h4>
    {textField('Agreement code',agreement.code,v=>setAgreement(a=>({...a,code:v.toUpperCase()})))}
    {textField('Agreement title',agreement.name,v=>setAgreement(a=>({...a,name:v})))}
    {select('ic-provider','Provider / lending legal entity',agreement.providerId,v=>setAgreement(a=>({...a,providerId:v})),options)}
    {select('ic-beneficiary','Beneficiary / borrowing legal entity',agreement.beneficiaryId,v=>setAgreement(a=>({...a,beneficiaryId:v})),options)}
    <div className="space-y-2">
     <p className="text-sm font-semibold">Permitted transaction types</p>
     {IC_TYPES.map(t=><label key={t.code} className="flex min-h-9 items-center gap-2 text-sm">
      <input type="checkbox" disabled={!canEdit} checked={agreement.allowedTypes.includes(t.code)}
       onChange={e=>setAgreement(a=>({...a,allowedTypes:e.target.checked?[...a.allowedTypes,t.code]:a.allowedTypes.filter(x=>x!==t.code)}))}/>
      {t.label}</label>)}
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
     <label className="text-sm text-muted">Agreement currency
      <input className={field} maxLength={3} value={agreement.invoiceCurrency} disabled={!canEdit}
       onChange={e=>setAgreement(a=>({...a,invoiceCurrency:e.target.value.toUpperCase()}))}/></label>
     <label className="text-sm text-muted">Maximum agreement amount
      <input type="number" min="0" step="any" className={field} disabled={!canEdit} value={agreement.ceiling}
       onChange={e=>setAgreement(a=>({...a,ceiling:Number(e.target.value)}))}/></label>
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
     <label className="text-sm text-muted">Effective from
      <input type="date" className={field} disabled={!canEdit} value={agreement.startDate} onChange={e=>setAgreement(a=>({...a,startDate:e.target.value}))}/></label>
     <label className="text-sm text-muted">Effective to
      <input type="date" className={field} disabled={!canEdit} value={agreement.endDate} onChange={e=>setAgreement(a=>({...a,endDate:e.target.value}))}/></label>
    </div>
    <SelectField id="ic-settle" label="Settlement policy" value={agreement.settlementPolicy} disabled={!canEdit} onChange={e=>setAgreement(a=>({...a,settlementPolicy:e.target.value}))}>
     {IC_SETTLEMENT.map(m=><option key={m.code} value={m.code}>{m.label}</option>)}
    </SelectField>
    <SelectField id="ic-pricing" label="Pricing" value={agreement.pricingPolicy} disabled={!canEdit}
     onChange={e=>setAgreement(a=>({...a,pricingPolicy:e.target.value}))}>
     <option value="AT_COST">At cost</option><option value="CONTRACT">Contract / transfer pricing</option>
    </SelectField>
    {textField('Signed agreement / legal instrument reference',agreement.supportingAgreementReference,v=>setAgreement(a=>({...a,supportingAgreementReference:v})))}
    {textField('Tax treatment and review policy reference',agreement.taxPolicyReference,v=>setAgreement(a=>({...a,taxPolicyReference:v})))}
    {textField('Transfer pricing support reference',agreement.transferPricingReference,v=>setAgreement(a=>({...a,transferPricingReference:v})))}
    <label className="text-sm text-muted">Purpose and business justification
     <textarea className={field+' min-h-20 p-3'} disabled={!canEdit} value={agreement.purpose}
      onChange={e=>setAgreement(a=>({...a,purpose:e.target.value}))}/></label>
    <div className="rounded-xl border border-line p-3 space-y-2">
     <strong className="text-sm">Provider GL mappings (approved chart codes)</strong>
     {rolesNeeded.map(r=>acc(r,'provider'))}
    </div>
    <div className="rounded-xl border border-line p-3 space-y-2">
     <strong className="text-sm">Beneficiary GL mappings (approved chart codes)</strong>
     {rolesNeededBenef.map(r=>acc(r,'beneficiary'))}
    </div>
    {canEdit&&<button type="button" className={btn+' w-full'} disabled={busy||reason.trim().length<10} onClick={()=>void submit('/api/org/corporate/ic/agreements/propose',{
      agreement:{code:agreement.code,name:agreement.name,
       provider:{legalEntityId:agreement.providerId,accounts:agreement.providerAccounts},
       beneficiary:{legalEntityId:agreement.beneficiaryId,accounts:agreement.beneficiaryAccounts},
       allowedTypes:agreement.allowedTypes,invoiceCurrency:agreement.invoiceCurrency,
       ceiling:agreement.ceiling,startDate:agreement.startDate,endDate:agreement.endDate,
       settlementPolicy:agreement.settlementPolicy,pricingPolicy:agreement.pricingPolicy,
       taxPolicyReference:agreement.taxPolicyReference,
       transferPricingReference:agreement.transferPricingReference,
       supportingAgreementReference:agreement.supportingAgreementReference,purpose:agreement.purpose},
      reason,
     })}><Plus className="mr-1 inline h-4 w-4"/>Propose intercompany agreement</button>}
   </div>
  </section>}
  {tab==='voucher'&&<section className="rounded-xl border border-line bg-panel p-3 space-y-3">
   <h4 className="font-semibold">Intercompany transaction voucher</h4>
   <p className="text-xs text-muted">Prepare a matched voucher under an approved bilateral agreement. Submitting it does not create an invoice, GL entry or payment.</p>
   {select('ic-vagr','Approved agreement',voucher.agreementId,v=>setVoucher(a=>({...a,agreementId:v,type:agreements.find(x=>x.id===v)?.allowedTypes[0]||'SERVICE_RECHARGE'})),
    agreements.filter(a=>a.status==='approved_policy'&&a.provider.legalEntityId===leId)
     .map(a=>({value:a.id,label:a.code+' — '+a.name})))}
   {selectedAgreement&&<SelectField id="ic-vtype" label="Transaction type" value={voucher.type} disabled={!canEdit}
     onChange={e=>setVoucher(a=>({...a,type:e.target.value as IcType}))}>
    {selectedAgreement.allowedTypes.map(x=><option key={x} value={x}>{IC_TYPES.find(t=>t.code===x)?.label}</option>)}
   </SelectField>}
   {textField('Source document / invoice / loan instrument reference',voucher.sourceReference,v=>setVoucher(a=>({...a,sourceReference:v})))}
   <label className="text-sm text-muted">Document amount ({selectedAgreement?.invoiceCurrency||'agreement currency'})
    <input type="number" min="0" step="any" className={field} disabled={!canEdit} value={voucher.amount}
     onChange={e=>setVoucher(a=>({...a,amount:Number(e.target.value)}))}/></label>
   <label className="text-sm text-muted">Value date
    <input type="date" className={field} disabled={!canEdit} value={voucher.valueDate}
     onChange={e=>setVoucher(a=>({...a,valueDate:e.target.value}))}/></label>
   {textField('Tax-review evidence / authority reference',voucher.taxReviewReference,v=>setVoucher(a=>({...a,taxReviewReference:v})))}
   {textField('Transfer-pricing support, if contracted',voucher.transferPricingEvidence,v=>setVoucher(a=>({...a,transferPricingEvidence:v})))}
   {textField('Supporting document references (comma separated)',voucher.supportingDocumentReferences,v=>setVoucher(a=>({...a,supportingDocumentReferences:v})))}
   <label className="text-sm text-muted">Transaction narrative
    <textarea className={field+' min-h-20 p-3'} disabled={!canEdit} value={voucher.description}
     onChange={e=>setVoucher(a=>({...a,description:e.target.value}))}/></label>
   {canEdit&&<button type="button" className={btn+' w-full'} disabled={busy||!selectedAgreement||reason.trim().length<10}
    onClick={()=>void submit('/api/org/corporate/ic/vouchers/propose',{
     agreementId:voucher.agreementId,reason,
     voucher:{...voucher,supportingDocumentReferences:voucher.supportingDocumentReferences.split(',').map(x=>x.trim()).filter(Boolean)},
    })}><FileCheck2 className="mr-1 inline h-4 w-4"/>Submit voucher for provider Finance approval</button>}
  </section>}
  {tab==='matching'&&<section className="rounded-xl border border-line bg-panel p-3 space-y-2">
   <h4 className="font-semibold">Provider and beneficiary transaction matching</h4>
   {!vouchers.length&&<p className="text-sm text-muted">No intercompany vouchers recorded for this legal entity.</p>}
   {vouchers.map(v=><div key={v.id} className="rounded-lg border border-line p-3 space-y-2">
    <strong className="text-sm">{v.sourceReference} — {v.type.replaceAll('_',' ')}</strong>
    <p className="text-xs text-muted">{v.providerLegalEntityId} → {v.beneficiaryLegalEntityId} · {fmt(v.amountMinor,v.currency)}</p>
    <p className="text-xs text-muted">Status: {v.status.replaceAll('_',' ')} · Provider approval: {v.providerApprovalRef} · Beneficiary approval: {v.beneficiaryApprovalRef||'Pending'}</p>
    <div className="flex flex-wrap gap-2">
     {canEdit&&v.beneficiaryLegalEntityId===leId&&v.status==='awaiting_counterparty'&&
      <button type="button" className={btn} disabled={busy||reason.trim().length<10} onClick={()=>void submit('/api/org/corporate/ic/vouchers/accept',{voucherId:v.id,reason})}>
       Confirm beneficiary matching</button>}
     {v.providerLegalEntityId===leId&&<button type="button" className={btn} onClick={async()=>{
      try{
       const r=await callBackend<Record<string,unknown>>('/api/org/corporate/ic/vouchers/preview',{voucherId:v.id});
       setPreview(r);setError('');
      }catch(e){setError(err(e))}
     }}>Preview bilateral GL intent</button>}
    </div>
   </div>)}
   {preview&&<section className="rounded-lg border border-line p-3 space-y-2">
    <strong className="text-sm">Unposted journal preview — no ledger entry created</strong>
    {(['provider','beneficiary'] as const).map(party=>{
     const j=preview[party] as {legalEntityId:string;functionalCurrency:string;lines:Array<{side:string;role:string;glCode:string;amountMinor:number}>};
     return j&&<div key={party} className="space-y-1">
      <p className="text-sm font-semibold">{party} · {j.legalEntityId} · {j.functionalCurrency}</p>
      {j.lines.map((x,i)=><p key={i} className="text-xs text-muted">{x.side==='D'?'Dr':'Cr'} {x.glCode} — {x.role}: {fmt(x.amountMinor,j.functionalCurrency)}</p>)}
     </div>;
    })}
   </section>}
  </section>}
  {tab==='settlement'&&<section className="rounded-xl border border-line bg-panel p-3 space-y-3">
   <h4 className="font-semibold">Settlement planning — no cash execution</h4>
   <p className="text-xs text-muted">Schedules are not proof of settlement. A matched voucher has no balance on the GL until a later bilateral posting engine is activated.</p>
   {select('ic-sv','Matched voucher',settlement.voucherId,v=>setSettlement(x=>({...x,voucherId:v})),
     vouchers.filter(v=>v.status==='matched_ready'&&v.beneficiaryLegalEntityId===leId)
      .map(v=>({value:v.id,label:v.sourceReference+' — '+fmt(v.amountMinor,v.currency)})))}
   <label className="block text-sm text-muted">Planned settlement amount
    <input type="number" min="0" step="any" className={field} disabled={!canEdit} value={settlement.amount}
     onChange={e=>setSettlement(x=>({...x,amount:Number(e.target.value)}))}/></label>
   <label className="block text-sm text-muted">Planned date
    <input type="date" className={field} value={settlement.plannedDate} disabled={!canEdit}
     onChange={e=>setSettlement(x=>({...x,plannedDate:e.target.value}))}/></label>
   <SelectField id="ic-method" label="Planned settlement method" value={settlement.method} disabled={!canEdit}
    onChange={e=>setSettlement(x=>({...x,method:e.target.value}))}>
    {['BANK_TRANSFER','INTERCOMPANY_NETTING','CASH_POOL','MANUAL'].map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}
   </SelectField>
   {textField('Treasury / payment instruction reference (not executed)',settlement.paymentReference,v=>setSettlement(x=>({...x,paymentReference:v})))}
   {canEdit&&<button type="button" className={btn+' w-full'} disabled={busy||reason.trim().length<10||!settlement.voucherId}
    onClick={()=>void submit('/api/org/corporate/ic/settlements/propose',{...settlement,reason})}>
    <ArrowLeftRight className="inline h-4 w-4 mr-1"/>Submit settlement plan for approval</button>}
   {settlements.map(s=><div key={s.id} className="rounded-lg border border-line p-3">
    <p className="text-sm font-semibold">{s.paymentReference} · {s.method.replaceAll('_',' ')}</p>
    <p className="text-xs text-muted">{fmt(s.amountMinor,s.currency)} · planned {s.plannedDate}</p>
    <p className="text-xs text-muted">Status: {s.status} · no bank or GL movement</p>
   </div>)}
  </section>}
  <label className="block text-sm text-muted">Reason for Finance approval
   <textarea className={field+' min-h-20 p-3'} disabled={!canEdit} value={reason}
    onChange={e=>setReason(e.target.value)} maxLength={500}/></label>
  <p className="flex gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4 shrink-0 text-brand"/>
   Approvals do not generate statutory invoices or authorize cross-entity bank transfers. Reconciliation and accounting posting are separate gated implementation steps.</p>
 </div>;
}
