import {useId,useMemo,useState} from 'react';
import {ArrowLeft,ChevronRight,Package} from 'lucide-react';
import {SelectField} from '../components/ui';

type Attribute={key:string;label:string;required:boolean;choices:string[]};
export type MfgContainerMetadataRow={
    code:string;label:string;category:string;categoryCode?:string;
    subcategory?:string;subcategoryCode?:string;attributes?:Attribute[];
    sectors?:string[];active?:boolean;selectable?:boolean;
};
export default function MfgContainerMetadataBrowser({items,onBack}:{
    items:MfgContainerMetadataRow[];onBack:()=>void;
}){
    const [category,setCategory]=useState(''),[selected,setSelected]=useState('');
    const id=useId();
    const categories=useMemo(()=>[...new Map(items.map(i=>[i.categoryCode||i.category,
        {code:i.categoryCode||i.category,label:i.category}])).values()].sort((a,b)=>a.label.localeCompare(b.label)),[items]);
    const shown=items.filter(i=>(!category||(i.categoryCode||i.category)===category)&&i.active!==false);
    const chosen=items.find(i=>i.code===selected);
    return <div className='space-y-4 text-ink'>
        <div className='flex items-center gap-3'>
            <button type='button' aria-label='Back to Manufacturing metadata'
                onClick={onBack} className='flex h-11 w-11 items-center justify-center rounded-xl border border-line'>
                <ArrowLeft className='h-5 w-5'/>
            </button>
            <div>
                <h2 className='text-lg font-semibold'>Primary Container Types</h2>
                <p className='text-xs text-muted'>MEMS Manufacturing master data · Category → Subcategory</p>
            </div>
        </div>
        {chosen?<div className='rounded-2xl border border-line bg-panel p-4'>
            <button type='button' onClick={()=>setSelected('')}
                className='mb-3 min-h-11 rounded-xl border border-line px-3 text-sm'>Back to types</button>
            <h3 className='font-semibold'>{chosen.label}</h3>
            <p className='mt-1 text-xs text-muted'>{chosen.category} / {chosen.subcategory||chosen.label} · {chosen.code}</p>
            <h4 className='mt-4 text-sm font-semibold'>Configured attributes ({(chosen.attributes||[]).length}/5)</h4>
            {(chosen.attributes||[]).map(a=><div key={a.key} className='mt-2 rounded-xl border border-line p-3'>
                <p className='text-sm font-medium'>{a.label}{a.required?' *':''}</p>
                <p className='mt-1 text-xs text-muted'>{a.choices.join(' · ')}</p>
            </div>)}
            {(chosen.attributes||[]).length===0&&<p className='mt-2 text-sm text-muted'>No additional attributes required</p>}
            <p className='mt-4 text-xs text-muted'>Organizations adopt this code and select the required controlled attributes.</p>
        </div>:<>
            <SelectField label='Category' id={id} value={category} onChange={e=>setCategory(e.target.value)}>
                <option value=''>All categories</option>
                {categories.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}
            </SelectField>
            <div className='space-y-2'>
                {shown.map(item=><button key={item.code} type='button' onClick={()=>setSelected(item.code)}
                    className='flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left'>
                    <span className='flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand'>
                        <Package className='h-5 w-5'/>
                    </span>
                    <span className='min-w-0 flex-1'><span className='block text-sm font-semibold'>{item.label}</span>
                        <span className='block text-xs text-muted'>{item.subcategoryCode||item.code}</span></span>
                    <ChevronRight className='h-5 w-5 text-muted'/>
                </button>)}
            </div>
        </>}
    </div>;
}
