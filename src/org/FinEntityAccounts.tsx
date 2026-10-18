import {useEffect,useMemo,useState} from 'react';
import {callBackend} from '../lib/backend';
import {Alert} from '../components/ui';
import {Button,Spinner,useLoad} from '../admin/kit';
import {useConfirm} from '../components/screen';
import {Card,FIN_API,type Entity} from './finKit';

type Account={code:string;name:string;classCode:string;className:string;categoryCode:string;categoryName:string;groupCode:string;groupName:string};
type Config={configured:boolean;selected:string[];eligible:Account[];version:number;pending:Array<{id:string;title:string}>;can:Record<string,boolean>};
type Tri='all'|'none'|'some';

export default function FinEntityAccounts({le,entities}:{le:Entity;entities:Entity[]}){
  const {data,error,loading,reload}=useLoad(()=>callBackend<Config>(`${FIN_API}/chart/scope/get`,{leId:le.id}),[le.id]);
  const [codes,setCodes]=useState<string[]>([]);
  const [q,setQ]=useState('');
  const [from,setFrom]=useState('');
  const [msg,setMsg]=useState('');
  const [busy,setBusy]=useState(false);
  const confirm=useConfirm();
  useEffect(()=>{if(data)setCodes(data.selected);},[data]);
  const selected=useMemo(()=>new Set(codes),[codes]);
  const eligible=data?.eligible||[];
  const classes=useMemo(()=>Array.from(new Map(eligible.map(a=>[a.classCode,a.className||a.classCode])).entries()),[data]);
  const state=(items:Account[]):Tri=>{
    const n=items.filter(a=>selected.has(a.code)).length;
    return n===0?'none':n===items.length?'all':'some';
  };
  const toggle=(items:Account[])=>{
    const set=new Set(codes);
    const shouldAdd=state(items)!=='all';
    for(const a of items)shouldAdd?set.add(a.code):set.delete(a.code);
    setCodes([...set]);
  };
  const check=(items:Account[],label:string)=>(
    <input type='checkbox' checked={state(items)==='all'} disabled={!data?.can.gl_manage||!items.length}
      aria-label={label} ref={el=>{if(el)el.indeterminate=state(items)==='some';}}
      onClick={e=>e.stopPropagation()} onChange={()=>toggle(items)}
      className='h-4 w-4 shrink-0 accent-emerald-600'/>
  );
  const choices=eligible.filter(a=>!q.trim()||`${a.code} ${a.name} ${a.className} ${a.categoryName} ${a.groupName}`.toLowerCase().includes(q.toLowerCase()));
  const changed=data?JSON.stringify([...codes].sort())!==JSON.stringify([...data.selected].sort()):false;
  if(loading&&!data)return <Spinner/>;
  if(error||!data)return <Alert tone='error'>{error||'Cannot read legal entity account configuration.'}</Alert>;
  return <div className='space-y-4'>
    <Card title='Legal entity approved GL account selection'>
      <p className='text-sm text-soft'>Choose the posting accounts that {le.code} can use. This is a separate approved selection from the MEMS master GL chart. Categories and subcategories select their eligible descendants; existing financial control accounts are protected.</p>
      <div className='mt-3 flex flex-wrap items-center gap-2'>
        <span className='text-sm text-ink'>{codes.length} / {eligible.length} accounts selected</span>
        <span className='text-xs text-muted'>{data.configured?'Approved selection exists':'Using legacy unrestricted approved chart until first scope approval'}</span>
      </div>
      {!!data.pending?.length&&<Alert tone='info'>{data.pending.length} account selection proposal(s) awaiting approval.</Alert>}
    </Card>
    {msg&&<Alert tone='info'>{msg}</Alert>}
    <label className='block text-sm'>Search codes and categories
      <input type='search' value={q} onChange={e=>setQ(e.target.value)} placeholder='Search without losing your selections'
        className='mt-1 w-full rounded-xl border border-line bg-panel p-3 text-base text-ink'/>
    </label>
    <div className='flex flex-wrap items-center gap-2'>
      <Button variant='secondary' disabled={!data.can.gl_manage} onClick={()=>setCodes(eligible.map(a=>a.code))}>Select all eligible</Button>
      <Button variant='secondary' disabled={!data.can.gl_manage} onClick={()=>setCodes([])}>Clear draft</Button>
      <Button variant='secondary' disabled={!changed} onClick={()=>setCodes(data.selected)}>Discard edits</Button>
    </div>
    <div className='max-h-[65vh] space-y-2 overflow-y-auto overscroll-contain'>
      {classes.map(([classCode,className])=>{
        const all=choices.filter(a=>a.classCode===classCode);
        if(!all.length)return null;
        return <details key={classCode} className='rounded-xl border border-line bg-panel p-3'>
          <summary className='flex cursor-pointer items-center gap-2'>
            {check(all,`Select class ${className}`)}
            <span className='flex-1 font-semibold text-ink'>{classCode} · {className}</span>
            <span className='text-xs text-muted'>{all.filter(a=>selected.has(a.code)).length}/{all.length}</span>
          </summary>
          {Array.from(new Map(all.map(a=>[a.categoryCode,a.categoryName||a.categoryCode])).entries()).map(([cat,catName])=>{
            const catItems=all.filter(a=>a.categoryCode===cat);
            return <details key={cat} className='ml-3 mt-2 rounded-lg border border-line p-2'>
              <summary className='flex cursor-pointer items-center gap-2'>
                {check(catItems,`Select category ${catName}`)}
                <span className='flex-1 text-sm font-medium text-ink'>{cat} · {catName}</span>
                <span className='text-xs text-muted'>{catItems.filter(a=>selected.has(a.code)).length}/{catItems.length}</span>
              </summary>
              {Array.from(new Map(catItems.map(a=>[a.groupCode,a.groupName||a.groupCode])).entries()).map(([grp,grpName])=>{
                const grpItems=catItems.filter(a=>a.groupCode===grp);
                return <details key={grp} className='ml-3 mt-2 rounded-lg border border-line p-2'>
                  <summary className='flex cursor-pointer items-center gap-2'>
                    {check(grpItems,`Select group ${grpName}`)}
                    <span className='flex-1 text-sm text-ink'>{grp} · {grpName}</span>
                    <span className='text-xs text-muted'>{grpItems.filter(a=>selected.has(a.code)).length}/{grpItems.length}</span>
                  </summary>
                  {grpItems.map(a=><label key={a.code} className='ml-3 flex min-h-9 items-center gap-2 text-sm'>
                    <input type='checkbox' checked={selected.has(a.code)} disabled={!data.can.gl_manage} onChange={e=>setCodes(cur=>e.target.checked?Array.from(new Set([...cur,a.code])):cur.filter(c=>c!==a.code))}/>
                    <span className='font-mono text-xs text-muted'>{a.code}</span><span className='text-ink'>{a.name}</span>
                  </label>)}
                </details>;
              })}
            </details>;
          })}
        </details>;
      })}
      {!choices.length&&<p className='p-4 text-sm text-muted'>No accounts match this search.</p>}
    </div>
    {data.can.gl_manage&&<Card title='Copy legal entity account selection as a draft'>
      <label className='block text-sm'>Source legal entity
        <select value={from} onChange={e=>setFrom(e.target.value)} className='mt-1 w-full rounded-xl border border-line bg-panel p-3'>
          <option value=''>Choose</option>
          {entities.filter(x=>x.id!==le.id).map(x=><option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
        </select>
      </label>
      <div className='mt-2 flex flex-wrap gap-2'>
        <Button variant='secondary' disabled={!from||busy} onClick={async()=>{
          setBusy(true);
          try{
            const result=await callBackend<Config>(`${FIN_API}/chart/scope/get`,{leId:from});
            const valid=new Set(eligible.map(a=>a.code));
            setCodes(result.selected.filter(c=>valid.has(c)));
            setMsg('Copied eligible accounts into this draft. Review, then propose approval.');
          }catch(e){setMsg(e instanceof Error?e.message:'Unable to copy.');}
          finally{setBusy(false);}
        }}>Copy / replace draft</Button>
      </div>
    </Card>}
    {data.can.gl_manage&&<Button disabled={!codes.length||(!changed&&data.configured)}
      onClick={()=>confirm.ask({
        title:`Approve GL scope for ${le.code}`,
        message:`Submit ${codes.length} selected posting GL accounts for approval. Removing an in-use or required finance account will be rejected. The current approved scope remains in force until approval.`,
        confirmLabel:'Propose for approval',reason:{label:'Reason',minLength:10}
      },async reason=>{
        await callBackend(`${FIN_API}/chart/scope/propose`,{leId:le.id,codes,reason});
        setMsg('Submitted for finance approval. The active selection is unchanged until approved.');
        reload();
      })}>Propose {codes.length} accounts for approval</Button>}
    {confirm.sheet}
  </div>;
}
