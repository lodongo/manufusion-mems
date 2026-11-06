import {useEffect,useMemo,useRef,useState} from 'react';
import {Eye,EyeOff,Landmark,Pencil,Plus,ShieldCheck,Trash2} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {messageOf,useConfirm} from '../components/screen';
import Sheet from '../components/Sheet';
import SearchableSelect from '../components/SearchableSelect';
import {Choice,NumField,btn,field,primary} from './hrFormParts';
import {ACCOUNT_NUMBER,MAX_TERM,SUGGESTED_ACCOUNT,accountKindOf,emptyItem,finishMonth,instalmentFor,itemProblem,lastInstalment,monthLabel,normalAccountNumber,scheduledFor,termMonths,typeOf,typesFor,type PayItemKind,type PayItemType,type PersonalItem} from '../shared/hrPayItems';
import type {PayAccount} from '../shared/hrPayAccounts';
import {fmtMoney} from './hrPayDocument';

export type PersonBank={bankId:string;bankName:string;branch:string;accountName:string;accountMasked:string;status:'pending'|'verified';changedByName:string;changedAt:string;verifiedByName:string;verifiedAt:string;canVerify:boolean;nameMatch:boolean};
export type PersonItem=PersonalItem&{changedByName:string;verifiedByName:string;canVerify:boolean};
export type PersonPay={
 employer:{name:string;displayName:string;tradingName:string;registrationNumber:string;taxNumber:string;address:string;phone:string;email:string;logoUrl:string};
 bank:PersonBank|null;items:PersonItem[];version:number;isSelf:boolean;canManage:boolean;canVerify:boolean;
 /** The draft basic monthly salary of this one employee (null when none), read only when the employee is opened. */
 salary:number|null;
};

const day=(iso:string)=>iso?iso.slice(0,10):'';
const SENT=['id','kind','type','label','reference','amount','taxable','principal','glAccount','startMonth','endMonth'] as const;
export type Accounts={payable:PayAccount[];receivable:PayAccount[]};
const sendable=(i:PersonalItem)=>Object.fromEntries(SENT.map(k=>[k,i[k]]));

function Status({status,by,at,waiting}:{status:'pending'|'verified';by:string;at:string;waiting?:string}){
 return status==='verified'
  ?<span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Verified{by?' by '+by:''}{at?' · '+day(at):''}</span>
  :<span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Awaiting verification{waiting?' · entered by '+waiting:''}</span>;
}

function Text({label,value,onChange,error,hint,mode,max=80,type='text',autoComplete}:{label:string;value:string;onChange:(v:string)=>void;error?:string;hint?:string;mode?:'numeric'|'text';max?:number;type?:string;autoComplete?:string}){
 return <label className="block space-y-1">
  <span className="text-sm font-medium text-ink">{label}</span>
  <input className={field+(error?' border-red-500':'')} type={type} value={value} maxLength={max} inputMode={mode} autoComplete={autoComplete??'off'} aria-invalid={!!error} onChange={e=>onChange(e.target.value)}/>
  {error?<span role="alert" className="block text-xs text-red-600">{error}</span>:hint?<span className="block text-xs text-muted">{hint}</span>:null}
 </label>;
}

/** Bank details of one employee: bank from the platform list, branch, account name and the account number typed twice. */
function BankSheet({entity,uid,version,current,onClose,onSaved}:{entity:{id:string;countryCode:string};uid:string;version:number;current:PersonBank|null;onClose:()=>void;onSaved:(note:string)=>void}){
 const [banks,setBanks]=useState<Array<{id:string;name:string}>>([]);
 const [bankId,setBankId]=useState(current?.bankId||'');
 const [branch,setBranch]=useState(current?.branch||'');
 const [accountName,setAccountName]=useState(current?.accountName||'');
 const [number,setNumber]=useState(''),[again,setAgain]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  callBackend<{banks:Array<{id:string;name:string}>}>('/api/org/reference/banks',{countryCode:entity.countryCode}).then(r=>setBanks(r.banks)).catch(()=>setBanks([]));
 },[entity.countryCode]);
 const normal=normalAccountNumber(number);
 const problems={
  bank:bankId?'':'Choose the bank.',
  name:accountName.trim().length>=2?'':'Enter the account name as the bank holds it.',
  number:!number?'Enter the account number.':ACCOUNT_NUMBER.test(normal)?'':'The account number is 4 to 34 letters and numbers.',
  again:!again?'Type the account number again to confirm it.':normalAccountNumber(again)===normal?'':'The two account numbers are different.',
 };
 const valid=!problems.bank&&!problems.name&&!problems.number&&!problems.again;
 const save=async()=>{
  setBusy(true);setError('');
  try{
   await callBackend('/api/org/hr/payroll/person/save',{legalEntityId:entity.id,uid,expectedVersion:version,bank:{bankId,branch,accountName,accountNumber:number,confirmAccountNumber:again}});
   onSaved('Bank details saved. They count as verified once a different person verifies them.');
  }catch(e){setError(messageOf(e,'The bank details could not be saved.'));}
  finally{setBusy(false);}
 };
 return <Sheet title={current?'Change bank details':'Add bank details'} onClose={onClose} footer={<>
  <button type="button" className={btn+' flex-1'} onClick={onClose} disabled={busy}>Cancel</button>
  <button type="button" className={primary+' flex-1'} onClick={()=>void save()} disabled={busy||!valid}>Save bank details</button></>}>
  {error&&<p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
  <p className="rounded-xl bg-page p-3 text-xs text-muted">The account number is never shown again in full after saving. A different person must verify these details before they count as verified. Changing them later starts the verification again.</p>
  <SearchableSelect id="pay-bank" label="Bank" value={bankId} onChange={e=>setBankId(e.target.value)} error={bankId?'':problems.bank}>
   <option value="">Choose the bank</option>
   {banks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
  </SearchableSelect>
  <Text label="Branch (optional)" value={branch} onChange={setBranch} max={60}/>
  <Text label="Account name" value={accountName} onChange={setAccountName} error={accountName?problems.name:''} hint="Exactly as the bank holds it."/>
  <Text label="Account number" value={number} onChange={setNumber} error={number?problems.number:''} max={40} autoComplete="off"/>
  <Text label="Confirm account number" value={again} onChange={setAgain} error={again?problems.again:''} max={40}/>
 </Sheet>;
}

/**
 * One personal earning or deduction, with a live line showing what it comes to on the chosen payslip month.
 * A deduction that repays a total (a bank check-off, a SACCO or staff loan, a salary advance, a court order) is set either by
 * the monthly amount or by the number of months, and it stops by itself when the total is repaid. Every deduction names the
 * ledger account it is posted against: a payable for money owed to a bank or other receiver, a receivable for a staff loan or advance.
 */
function ItemSheet({start,month,currency,accounts,accountsError,saving,error,onClose,onSave}:{start:PersonalItem;month:string;currency:string;accounts:Accounts|null;accountsError:string;saving:boolean;error:string;onClose:()=>void;onSave:(i:PersonalItem)=>void}){
 const [item,setItem]=useState<PersonalItem>(start);
 const [by,setBy]=useState<'amount'|'months'>('amount');
 const [months,setMonths]=useState('');
 const set=(patch:Partial<PersonalItem>)=>setItem(x=>({...x,...patch}));
 const t=typeOf(item.kind,item.type);
 const isDeduction=item.kind==='deduction';
 const need=accountKindOf(item.kind,item.type);
 const list=need&&accounts?accounts[need]:[];
 const hasTotal=isDeduction&&!!t?.schedule&&item.principal>0;
 const count=Number(months);
 const monthsProblem=hasTotal&&by==='months'?(!months?'Enter the number of months.':!Number.isInteger(count)||count<1||count>MAX_TERM?`The number of months is a whole number from 1 to ${MAX_TERM}.`:''):'';
 const eff:PersonalItem=hasTotal&&by==='months'&&!monthsProblem?{...item,amount:instalmentFor(item.principal,count)}:item;
 const gone=isDeduction&&!!item.glAccount&&!!accounts&&!list.some(a=>a.code===item.glAccount);
 const problem=monthsProblem||itemProblem(eff)||(gone?'That ledger account is no longer available for this legal entity. Choose another.':'');
 const shown=!problem?scheduledFor(eff,month):null;
 const term=hasTotal&&Number.isFinite(eff.amount)?termMonths(eff.principal,eff.amount):0;

 // When the accounts arrive, pre-select the usual account for the type if the legal entity has adopted it.
 useEffect(()=>{
  if(!accounts||!isDeduction||item.glAccount||!need)return;
  const sug=SUGGESTED_ACCOUNT[item.type];
  if(sug&&accounts[need].some(a=>a.code===sug))set({glAccount:sug});
 },[accounts]);// eslint-disable-line react-hooks/exhaustive-deps

 const pick=(x:PayItemType)=>{
  const wanted=item.kind==='deduction'?x.account:undefined;
  const next=wanted&&accounts?accounts[wanted]:[];
  const custom=!!item.glAccount&&item.glAccount!==SUGGESTED_ACCOUNT[item.type]&&next.some(a=>a.code===item.glAccount);
  const sug=SUGGESTED_ACCOUNT[x.code];
  set({type:x.code,taxable:item.kind==='earning'?x.taxable:false,principal:x.schedule?item.principal:0,label:item.label||x.label,
   glAccount:item.kind!=='deduction'?'':custom?item.glAccount:sug&&next.some(a=>a.code===sug)?sug:''});
 };
 const repayBy=(v:'amount'|'months')=>{
  if(v==='amount'&&Number.isFinite(eff.amount))set({amount:eff.amount});
  if(v==='months'&&Number.isFinite(item.amount)){const n=termMonths(item.principal,item.amount);if(n>=1&&n<=MAX_TERM)setMonths(String(n));}
  setBy(v);
 };
 const groups=[...new Set(list.map(a=>a.group||''))];

 return <Sheet title={(start.id?'Change ':'Add ')+(item.kind==='earning'?'earning':'deduction')} onClose={onClose} footer={<>
  <button type="button" className={btn+' flex-1'} onClick={onClose} disabled={saving}>Cancel</button>
  <button type="button" className={primary+' flex-1'} onClick={()=>onSave({...eff,label:eff.label.trim(),reference:eff.reference.trim()})} disabled={saving||!!problem}>Save</button></>}>
  {error&&<p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
  <div role="radiogroup" aria-label="Type" className="flex flex-wrap gap-2">
   {typesFor(item.kind).map(x=><button key={x.code} type="button" role="radio" aria-checked={item.type===x.code} onClick={()=>pick(x)}
    className={'min-h-11 rounded-xl border px-3 text-sm font-semibold '+(item.type===x.code?'border-brand bg-brand/10 text-brand':'border-line text-ink')}>{x.label}</button>)}
  </div>
  <Text label="Name on the payslip" value={item.label} onChange={v=>set({label:v})} max={60} error={item.label&&!/^[\p{L}\p{N} _.,;:/()#&+'’-]{2,60}$/u.test(item.label.trim())?'2 to 60 letters, numbers or . , ; : / ( ) # & + -':''}/>
  <Text label={item.type==='loan'||item.type==='advance'?'Loan or advance number (optional)':item.type==='court'?'Case number (optional)':item.type==='sacco'||item.type==='checkoff'?'Member number (optional)':'Reference (optional)'} value={item.reference} onChange={v=>set({reference:v})} max={40}/>

  {isDeduction&&t?.schedule&&<NumField label={(item.type==='loan'||item.type==='advance'?'Amount lent, the total to repay':'Total to deduct')+' ('+currency+', optional)'} value={item.principal>0?item.principal:NaN} optional onChange={n=>set({principal:Number.isNaN(n)?0:n,endMonth:Number.isNaN(n)?item.endMonth:''})}
   hint="Leave empty for a deduction with no end. With a total, the deduction reduces it every month, the payslip shows the instalment and the balance, and it stops by itself when the total is repaid."/>}
  {hasTotal&&<Choice<'amount'|'months'> label="Repay by" value={by} onChange={repayBy} options={[{value:'amount',label:'Monthly amount'},{value:'months',label:'Number of months'}]}/>}
  {hasTotal&&by==='months'
   ?<Text label="Number of months" value={months} mode="numeric" max={3} onChange={v=>setMonths(v.replace(/\D/g,''))} error={months?monthsProblem:''} hint={`1 to ${MAX_TERM} months.`}/>
   :<NumField label={'Amount per month ('+currency+')'} value={item.amount} optional onChange={n=>set({amount:n})} invalid={Number.isFinite(item.amount)&&!!problem&&/amount|decimals|months to repay/i.test(problem)} hintTone="normal"/>}
  {hasTotal&&!monthsProblem&&Number.isFinite(eff.amount)&&eff.amount>0&&term>0&&<p className="rounded-xl bg-page p-3 text-xs text-muted">
   {by==='months'&&<>Monthly deduction <b className="text-ink">{currency} {fmtMoney(eff.amount)}</b>. </>}
   Repaid in <b className="text-ink">{term} month{term===1?'':'s'}</b>{term>1&&lastInstalment(eff.principal,eff.amount)!==eff.amount?<>, the last instalment being {currency} {fmtMoney(lastInstalment(eff.principal,eff.amount))}</>:''}
   {finishMonth(eff.startMonth,eff.principal,eff.amount)?<>, finishing in <b className="text-ink">{monthLabel(finishMonth(eff.startMonth,eff.principal,eff.amount))}</b></>:''}.</p>}

  {isDeduction&&need&&<div className="space-y-1">
   <SearchableSelect id="pay-gl" label={need==='receivable'?'Receivable account (what the employee owes the company)':'Payable account (where the money is owed until paid out)'} value={item.glAccount} onChange={e=>set({glAccount:e.target.value})}
    error={gone?'No longer available. Choose another.':''} hint={need==='receivable'?'Repaying reduces this account.':'The amount taken from the pay is owed from this account to the bank, SACCO, court or other receiver.'}>
    <option value="">{accounts?'Choose the account':'Loading the accounts…'}</option>
    {groups.map(g=>g?<optgroup key={g} label={g}>{list.filter(a=>a.group===g).map(a=><option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</optgroup>
     :list.filter(a=>!a.group).map(a=><option key={a.code} value={a.code}>{a.code} · {a.name}</option>))}
   </SearchableSelect>
   {accountsError&&<p role="alert" className="text-xs text-red-600">{accountsError}</p>}
   {accounts&&!list.length&&<p role="alert" className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-800">{need==='receivable'
    ?'Finance has not adopted an employee loan or salary advance receivable account for this legal entity yet.'
    :'Finance has not adopted a payable account for payroll deductions for this legal entity yet.'} Ask Finance to adopt one, then add this deduction.</p>}
  </div>}

  {item.kind==='earning'&&<label className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3">
   <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={item.taxable} onChange={e=>set({taxable:e.target.checked})}/>
   <span className="text-sm text-ink">Taxable<span className="block text-xs text-muted">A taxable earning is taxed and counts for the statutory contributions.</span></span></label>}
  <div className={hasTotal?'':'grid grid-cols-2 gap-3'}>
   <Text label="First month" type="month" value={item.startMonth} onChange={v=>set({startMonth:v})} max={7}/>
   {!hasTotal&&<Text label="Last month (optional)" type="month" value={item.endMonth} onChange={v=>set({endMonth:v})} max={7} hint="Empty: until removed."/>}
  </div>
  {problem&&<p role="alert" className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-800">{problem}</p>}
  {!problem&&<p className="rounded-xl bg-page p-3 text-xs text-muted">{shown
   ?<>On the {monthLabel(month)} payslip: <b className="text-ink">{currency} {fmtMoney(shown.amount)}</b>{shown.installment?` (instalment ${shown.installment} of ${shown.installments}, ${currency} ${fmtMoney(shown.balance||0)} still owed afterwards)`:''}.</>
   :<>It does not apply to the {monthLabel(month)} payslip.</>} A different person must verify it before it counts as verified.</p>}
 </Sheet>;
}

/** Bank details and personal earnings and deductions of one employee, with verification by a second person. */
export default function HrPayDetails({entity,uid,person,month,currency,onChanged}:{entity:{id:string;countryCode:string};uid:string;person:PersonPay;month:string;currency:string;onChanged:(note?:string)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [bankOpen,setBankOpen]=useState(false);
 const [editing,setEditing]=useState<PersonalItem|null>(null);
 const [itemError,setItemError]=useState('');
 const [accounts,setAccounts]=useState<Accounts|null>(null),[accountsError,setAccountsError]=useState('');
 const [revealed,setRevealed]=useState('');
 const timer=useRef(0);
 const {ask,sheet}=useConfirm();
 useEffect(()=>()=>window.clearTimeout(timer.current||undefined),[]);
 // The ledger accounts are fetched only when they are needed: the deduction form is open, or a deduction shows its account.
 const wantAccounts=!!editing||person.items.some(i=>i.kind==='deduction'&&!!i.glAccount);
 useEffect(()=>{
  if(!wantAccounts||accounts)return;
  let live=true;
  setAccountsError('');
  callBackend<Accounts>('/api/org/hr/payroll/accounts',{legalEntityId:entity.id}).then(r=>{if(live)setAccounts(r);}).catch(e=>{if(live)setAccountsError(messageOf(e,'The ledger accounts could not be loaded.'));});
  return ()=>{live=false;};
 },[wantAccounts,accounts,entity.id]);
 const accountName=(i:PersonalItem)=>{
  if(!i.glAccount)return '';
  const found=[...(accounts?.payable||[]),...(accounts?.receivable||[])].find(a=>a.code===i.glAccount);
  return found?found.code+' · '+found.name:i.glAccount;
 };

 const waiting=useMemo(()=>({bank:!!person.bank?.canVerify&&person.canVerify,items:person.items.filter(i=>i.canVerify&&person.canVerify)}),[person]);
 const run=async(path:string,body:Record<string,unknown>,done:string)=>{
  setBusy(true);setError('');setNotice('');
  try{await callBackend(path,{legalEntityId:entity.id,uid,expectedVersion:person.version,...body});setNotice(done);onChanged(done);return true;}
  catch(e){setError(messageOf(e,'That could not be saved.'));return false;}
  finally{setBusy(false);}
 };
 const saveItems=async(next:PersonalItem[],done:string)=>{
  setItemError('');
  setBusy(true);setError('');
  try{
   await callBackend('/api/org/hr/payroll/person/save',{legalEntityId:entity.id,uid,expectedVersion:person.version,items:next.map(sendable)});
   setNotice(done);setEditing(null);onChanged(done);
  }catch(e){setItemError(messageOf(e,'The item could not be saved.'));}
  finally{setBusy(false);}
 };
 const upsert=(i:PersonalItem)=>saveItems(i.id?person.items.map(x=>x.id===i.id?i:x):[...person.items,i],i.id?'Item changed. A different person must verify it.':'Item added. A different person must verify it.');
 const remove=(i:PersonalItem)=>ask({title:'Remove “'+i.label+'”?',tone:'danger',confirmLabel:'Remove',message:'It stops applying to every payslip. The removal is kept in the history and audited.'},
  async()=>{await saveItems(person.items.filter(x=>x.id!==i.id),'Item removed.');});
 const verifyAll=()=>ask({title:'Verify these pay details?',confirmLabel:'Verify',
  message:'You confirm that you checked '+[waiting.bank?'the bank details':'',waiting.items.length?waiting.items.length+' pay item'+(waiting.items.length===1?'':'s'):''].filter(Boolean).join(' and ')+' against the supporting documents.'},
  async()=>{await run('/api/org/hr/payroll/person/verify',{bank:waiting.bank,itemIds:waiting.items.map(i=>i.id)},'Verified.');});
 const reveal=async()=>{
  setBusy(true);setError('');
  try{
   const r=await callBackend<{accountNumber:string}>('/api/org/hr/payroll/person/reveal',{legalEntityId:entity.id,uid});
   setRevealed(r.accountNumber);window.clearTimeout(timer.current||undefined);timer.current=window.setTimeout(()=>setRevealed(''),30000);
  }catch(e){setError(messageOf(e,'The account number could not be shown.'));}
  finally{setBusy(false);}
 };

 const b=person.bank;
 const group=(kind:PayItemKind)=>person.items.filter(i=>i.kind===kind);
 return <div className="space-y-4">
  {sheet}
  {error&&<p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
  {person.isSelf&&<p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-800">These are your own pay details. You cannot change or verify them; ask another payroll officer.</p>}

  <section className="space-y-2 rounded-xl border border-line p-3">
   <div className="flex items-center gap-2"><Landmark className="h-5 w-5 text-brand"/><h3 className="min-w-0 flex-1 text-sm font-semibold text-ink">Bank details</h3>
    {person.canManage&&<button type="button" className={btn} onClick={()=>setBankOpen(true)} aria-label={b?'Change bank details':'Add bank details'}>{b?<Pencil className="h-4 w-4"/>:<Plus className="h-4 w-4"/>}{b?'Change':'Add'}</button>}</div>
   {!b&&<p className="text-sm text-muted">No bank details yet. The payslip prints “No bank details on file”.</p>}
   {b&&<>
    <Status status={b.status} by={b.verifiedByName} at={b.verifiedAt} waiting={b.changedByName}/>
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
     <div><dt className="text-[11px] uppercase text-muted">Bank</dt><dd className="break-words font-semibold text-ink">{b.bankName}</dd></div>
     <div><dt className="text-[11px] uppercase text-muted">Branch</dt><dd className="break-words font-semibold text-ink">{b.branch||'-'}</dd></div>
     <div><dt className="text-[11px] uppercase text-muted">Account name</dt><dd className="break-words font-semibold text-ink">{b.accountName}</dd></div>
     <div><dt className="text-[11px] uppercase text-muted">Account number</dt><dd className="break-all font-mono font-semibold text-ink">{revealed||b.accountMasked}</dd></div>
    </dl>
    {!b.nameMatch&&<p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-800">The account name does not look like the employee’s name. Check it against the bank’s letter before verifying.</p>}
    {person.canVerify&&<button type="button" className={btn+' w-full'} disabled={busy} onClick={()=>revealed?setRevealed(''):void reveal()}>
     {revealed?<EyeOff className="h-4 w-4"/>:<Eye className="h-4 w-4"/>}{revealed?'Hide the account number':'Show the full account number (audited)'}</button>}
   </>}
  </section>

  {(['earning','deduction'] as PayItemKind[]).map(kind=><section key={kind} className="space-y-2 rounded-xl border border-line p-3">
   <div className="flex items-center gap-2"><h3 className="min-w-0 flex-1 text-sm font-semibold text-ink">{kind==='earning'?'Personal earnings':'Personal deductions'}</h3>
    {person.canManage&&<button type="button" className={btn} disabled={person.items.length>=30} onClick={()=>{setItemError('');setEditing(emptyItem(kind,month));}} aria-label={'Add '+kind}><Plus className="h-4 w-4"/>Add</button>}</div>
   <p className="text-xs text-muted">{kind==='earning'?'Acting allowance, bonus, commission, arrears. Paid on top of the grade’s pay.':'Check-off, SACCO, staff loan, salary advance, court order. Taken after tax.'}</p>
   {!group(kind).length&&<p className="text-sm text-muted">None.</p>}
   <ul className="space-y-2">{group(kind).map(i=>{
    const s=scheduledFor(i,month);
    return <li key={i.id} className="space-y-1 rounded-xl border border-line bg-page p-3">
     <div className="flex items-start justify-between gap-3"><p className="min-w-0 break-words text-sm font-semibold text-ink">{i.label}<span className="block text-xs font-normal text-muted">{typeOf(i.kind,i.type)?.label}{i.reference?' · '+i.reference:''}{i.kind==='earning'?(i.taxable?' · taxable':' · not taxed'):''}</span></p>
      <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">{currency} {fmtMoney(i.amount)}<span className="block text-right text-[11px] font-normal text-muted">a month</span></p></div>
     <p className="text-xs text-muted">From {monthLabel(i.startMonth)}{i.endMonth?' to '+monthLabel(i.endMonth):''}{i.principal>0?` · total ${fmtMoney(i.principal)} over ${termMonths(i.principal,i.amount)} month${termMonths(i.principal,i.amount)===1?'':'s'}, ends ${monthLabel(finishMonth(i.startMonth,i.principal,i.amount))}`:''}
      {s?.installment?` · this month: instalment ${s.installment} of ${s.installments}, ${fmtMoney(s.balance||0)} owed afterwards`:s?'':' · not on the '+monthLabel(month)+' payslip'}</p>
     {i.kind==='deduction'&&(i.glAccount
      ?<p className="break-words text-xs text-muted">{accountKindOf(i.kind,i.type)==='receivable'?'Repays':'Owed to the receiver in'} {accountName(i)}</p>
      :<p className="text-xs font-semibold text-amber-700">No ledger account yet. Change this deduction to choose one.</p>)}
     <Status status={i.status} by={i.verifiedByName} at={i.verifiedAt} waiting={i.changedByName}/>
     {(person.canManage||(person.canVerify&&i.canVerify))&&<div className="flex gap-2 pt-1">
      {person.canManage&&<button type="button" className={btn+' flex-1'} disabled={busy} onClick={()=>{setItemError('');setEditing(i);}}><Pencil className="h-4 w-4"/>Change</button>}
      {person.canManage&&<button type="button" className={btn+' flex-1 text-danger'} disabled={busy} onClick={()=>remove(i)}><Trash2 className="h-4 w-4"/>Remove</button>}
     </div>}
    </li>;})}</ul>
  </section>)}

  {(waiting.bank||waiting.items.length>0)&&<button type="button" className={primary+' w-full'} disabled={busy} onClick={verifyAll}><ShieldCheck className="h-5 w-5"/>Verify what is waiting ({(waiting.bank?1:0)+waiting.items.length})</button>}
  {person.canVerify&&!waiting.bank&&!waiting.items.length&&(person.items.some(i=>i.status==='pending')||b?.status==='pending')&&
   <p className="rounded-xl bg-page p-3 text-xs text-muted">What is still waiting was entered by you, so another person must verify it.</p>}
  {!person.canManage&&!person.canVerify&&!person.isSelf&&<p className="rounded-xl bg-page p-3 text-xs text-muted">You can view pay details. Entering them needs the HR – Payroll Officer role and verifying them needs the HR – Payroll Verifier role.</p>}

  {bankOpen&&<BankSheet entity={entity} uid={uid} version={person.version} current={b} onClose={()=>setBankOpen(false)} onSaved={n=>{setBankOpen(false);setNotice(n);setRevealed('');onChanged(n);}}/>}
  {editing&&<ItemSheet start={editing} month={month} currency={currency} accounts={accounts} accountsError={accountsError} saving={busy} error={itemError} onClose={()=>setEditing(null)} onSave={i=>void upsert(i)}/>}
 </div>;
}
