import {useId,useState} from 'react';
import {ArrowLeft,ChevronRight,Layers3} from 'lucide-react';
import {SelectField} from '../components/ui';

export type PackagingMetadataRow={
    code:string;label:string;category:string;subcategory?:string;
    level:string;containedUnit:string;description?:string;active?:boolean;
};
export default function MfgPackagingMetadataBrowser({items,onBack}:{
    items:PackagingMetadataRow[];onBack:()=>void;
}){
    const [category,setCategory]=useState(''),[selected,setSelected]=useState('');
    const categoryId=useId();
    const categories=[...new Set(items.map(x=>x.category))].sort();
    const current=items.find(x=>x.code===selected);
    const visible=items.filter(x=>x.active!==false&&(!category||x.category===category));
    return <section className='space-y-4 text-ink'>
        <header className='flex items-center gap-3'>
            <button type='button' className='flex h-11 w-11 items-center justify-center rounded-xl border border-line'
                aria-label='Back to Manufacturing metadata' onClick={onBack}>
                <ArrowLeft className='h-5 w-5'/>
            </button>
            <div><h2 className='text-lg font-semibold'>Container Packaging Types</h2>
                <p className='text-xs text-muted'>Secondary · Tertiary · Transport · Bulk · Returnable</p>
            </div>
        </header>
        {current?<div className='space-y-2 rounded-2xl border border-line bg-panel p-4'>
            <button type='button' className='mb-2 min-h-11 rounded-xl border border-line px-3 text-sm'
                onClick={()=>setSelected('')}>Back to packaging types</button>
            <h3 className='font-semibold'>{current.label}</h3>
            <p className='text-sm text-muted'>{current.code} · {current.category}</p>
            <p className='text-sm'>{current.description||current.subcategory}</p>
            <p className='text-sm text-muted'>Level: {current.level}</p>
            <p className='text-sm text-muted'>Contents: {current.containedUnit==='PACKAGING'
                ?'Lower-level packaged units (for example, cases on a pallet)'
                :'Primary containers (for example, bottles in a case)'}</p>
            <p className='text-xs text-muted'>Organization setup determines the name, description, units per layer and layers.</p>
        </div>:<>
            <SelectField id={categoryId} label='Packaging category' value={category}
                onChange={e=>setCategory(e.target.value)}>
                <option value=''>All packaging types</option>
                {categories.map(name=><option key={name} value={name}>{name}</option>)}
            </SelectField>
            <div className='space-y-2'>
                {visible.map(item=><button key={item.code} type='button' onClick={()=>setSelected(item.code)}
                    className='flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left'>
                    <span className='flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand'>
                        <Layers3 className='h-5 w-5'/>
                    </span>
                    <span className='min-w-0 flex-1'>
                        <span className='block text-sm font-semibold'>{item.label}</span>
                        <span className='block text-xs text-muted'>{item.code} · {item.level}</span>
                    </span>
                    <ChevronRight className='h-5 w-5 text-muted'/>
                </button>)}
            </div>
        </>}
    </section>;
}
