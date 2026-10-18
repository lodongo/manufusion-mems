import {useEffect,useMemo,useState} from 'react';
import type {GranularVariant} from './FinGranularTransactionCatalog';
import {callBackend} from '../lib/backend';
import {Button,useLoad} from '../admin/kit';
import {Alert} from '../components/ui';
type Rule={id:string;event:string;role:string;account:string;categoryCode:string;costCenterId:string;priority:number;enabled:boolean};
type Event={code:string;label:string;roles:readonly string[];implemented:boolean};
type Acc={code:string;name:string;statement:string};
type Role={code:string;statement:'BS'|'PL';label:string};
type Simulation={covered:boolean;implemented:boolean;note:string;lines:Array<{role:string;code:string;accountName:string;source:string;status:string;matchedRuleId:string}>};
export default function FinAccountRuleManager(props:{
  leId:string;rules:Rule[];setRules:(next:Rule[])=>void;
  events:Event[];roles:Role[];accounts:Acc[];categories:Array<{code:string;name:string}>;
  canEdit:boolean; mapping:{roles:Record<string,string>;byCategory:Record<string,unknown>};
  prefill:GranularVariant|null;
}){
  const {rules,setRules,events,roles,accounts,categories,canEdit,mapping,leId,prefill}=props;
  const centers=useLoad(()=>callBackend<{costCenters:Array<{id:string;code:string;name:string}>}>('/api/org/fin/cc/list',{leId}),[leId]);
  const [event,setEvent]=useState('GR_STOCK'),[role,setRole]=useState('INVENTORY');
  const [account,setAccount]=useState(''),[category,setCategory]=useState('');
  const [costCenter,setCostCenter]=useState(''),[preview,setPreview]=useState<Simulation|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{if(prefill){setEvent(prefill.event);setRole(prefill.role);setAccount(prefill.accountCode);setCategory('');setCostCenter('');setPreview(null);setMessage('GL transaction selected. Add the draft rule, then submit the mapping for approval.');}},[prefill]);
  const selectedEvent=events.find(e=>e.code===event);
  const effectiveRole=selectedEvent?.roles.includes(role)?role:(selectedEvent?.roles[0]||'');
  const statement=roles.find(r=>r.code===effectiveRole)?.statement;
  const usable=accounts.filter(a=>a.statement===statement);
  const visibleRules=useMemo(()=>rules.filter(r=>r.event===event),[rules,event]);
  const add=()=>{
    if(!account||!effectiveRole)return setMessage('Choose an account and accounting role.');
    if(rules.some(r=>r.event===event&&r.role===effectiveRole&&r.categoryCode===category&&r.costCenterId===costCenter&&r.priority===100))
      return setMessage('An identical event, role and condition already exists.');
    const item:Rule={id:`determination-${Date.now()}-${rules.length}`,event,role:effectiveRole,account,categoryCode:category,costCenterId:costCenter.trim(),priority:100,enabled:true};
    setRules([...rules,item]);setAccount('');setPreview(null);setMessage('Added to draft; submit the whole mapping for approval below.');
  };
  const test=async()=>{
    setBusy(true);setMessage('');
    try{
      const result=await callBackend<Simulation>('/api/org/fin/mapping/simulate',{
        leId,event,categoryCode:category,costCenterId:costCenter.trim(),
        mapping:{...mapping,rules}
      });
      setPreview(result);
    }catch(e){setMessage(e instanceof Error?e.message:'Simulation failed.');}
    finally{setBusy(false);}
  };
  return <section id='fin-rule-config' className='space-y-3 rounded-xl border border-line p-4'>
    <div><h3 className='font-semibold text-ink'>Transaction-specific account determination</h3>
      <p className='text-sm text-muted'>Optional rules refine the default GL mappings. Organizations may use different accounts for the same transaction type or material category without creating duplicate transaction handlers. These rules apply only after approval.</p>
    </div>
    <label className='block text-sm'>Transaction event
      <select data-native-select='true' value={event} className='mt-1 w-full rounded-lg border border-line bg-panel p-3 text-ink' onChange={e=>{const v=e.target.value;setEvent(v);setRole(events.find(t=>t.code===v)?.roles[0]||'');setAccount('');setPreview(null);}}>
        {events.map(e=><option key={e.code} value={e.code}>{e.code} · {e.label} {e.implemented?'':'(planned)'}</option>)}
      </select>
    </label>
    <div className='grid gap-2 sm:grid-cols-2'>
      <label className='block text-sm'>Accounting role
        <select data-native-select='true' value={effectiveRole} className='mt-1 w-full rounded-lg border border-line bg-panel p-3 text-ink' onChange={e=>{setRole(e.target.value);setAccount('');}}>
          {selectedEvent?.roles.map(r=><option key={r} value={r}>{roles.find(x=>x.code===r)?.label||r}</option>)}
        </select>
      </label>
      <label className='block text-sm'>Material category (optional)
        <select data-native-select='true' value={category} className='mt-1 w-full rounded-lg border border-line bg-panel p-3 text-ink' onChange={e=>setCategory(e.target.value)}>
          <option value=''>Any material category</option>
          {categories.map(c=><option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
        </select>
      </label>
      <label className='block text-sm'>Approved GL account
        <select data-native-select='true' value={account} disabled={!canEdit} className='mt-1 w-full rounded-lg border border-line bg-panel p-3 text-ink' onChange={e=>setAccount(e.target.value)}>
          <option value=''>Select an approved account</option>
          {usable.map(a=><option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
        </select>
      </label>
      <label className='block text-sm'>Cost center (optional)
        <select data-native-select='true' value={costCenter} disabled={!canEdit} className='mt-1 w-full rounded-lg border border-line bg-panel p-3 text-ink' onChange={e=>setCostCenter(e.target.value)}>
          <option value=''>All cost centers</option>
          {centers.data?.costCenters.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
        </select>
      </label>
    </div>
    <div className='flex flex-wrap gap-2'>
      <Button variant='secondary' disabled={!canEdit||!selectedEvent?.implemented||!effectiveRole||!account} onClick={add}>Add draft rule</Button>
      <Button variant='secondary' disabled={busy||!selectedEvent?.roles.length} onClick={test}>{busy?'Testing…':'Simulate current draft'}</Button>
    </div>
    {message&&<Alert tone='info'>{message}</Alert>}
    {visibleRules.length>0&&<div className='space-y-2'>
      <h4 className='font-semibold text-sm'>Configured rules for {event}</h4>
      {visibleRules.map(r=><div key={r.id} className='flex flex-wrap items-center gap-2 rounded-lg border border-line p-2 text-xs'>
        <span className='font-medium text-ink'>{r.role}</span>
        <span className='font-mono'>{r.account}</span>
        <span>{r.categoryCode||'All categories'}</span>
        <span>{r.costCenterId||'All cost centers'}</span>
        {canEdit&&<button type='button' className='ml-auto text-red-400 underline' onClick={()=>setRules(rules.filter(x=>x.id!==r.id))}>Remove from draft</button>}
      </div>)}
    </div>}
    {preview&&<div className='space-y-2 rounded-xl border border-line p-3'>
      <h4 className='font-semibold'>Account determination preview · {preview.covered?'Resolved':'Needs configuration'}</h4>
      {preview.lines.map((x,i)=><p key={i} className='text-sm'><strong>{x.role}:</strong> {x.code||'Not mapped'} {x.accountName} — {x.source} ({x.status})</p>)}
      <p className='text-xs text-muted'>{preview.note}</p>
    </div>}
  </section>;
}
