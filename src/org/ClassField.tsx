import { useState } from 'react';
import { BookOpen, Lock, X } from 'lucide-react';
import AssetDictionaryBrowser, { type ClassDetail } from '../components/AssetDictionaryBrowser';

// Picks an equipment class from the organization's asset catalog (stored in the database).
// Opens the catalog full screen so it is easy to search and browse on a phone.

export default function ClassField({
    label,
    value,
    name,
    locked,
    onChange,
}: {
    label: string;
    value: string;
    name: string;
    locked: boolean;
    onChange: (code: string, name: string, classification: Pick<ClassDetail, 'categoryCode' | 'subcategoryCode'>) => void;
}) {
    const [open, setOpen] = useState(false);
    return (
        <div>
            <span className='mb-1 block text-sm text-slate-300'>{label}</span>
            {locked ? (
                <div className='flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm text-slate-300'>
                    <Lock className='h-4 w-4 shrink-0 text-slate-500' />
                    <span className='min-w-0'>
                        <span className='block font-mono text-xs text-emerald-300'>{value}</span>
                        <span className='block truncate'>{name}</span>
                    </span>
                </div>
            ) : (
                <button type='button' onClick={() => setOpen(true)} className='flex w-full items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-left active:bg-slate-800'>
                    <BookOpen className='h-5 w-5 shrink-0 text-emerald-400' />
                    {value ? (
                        <span className='min-w-0 flex-1'>
                            <span className='block font-mono text-xs text-emerald-300'>{value}</span>
                            <span className='block truncate text-sm text-white'>{name}</span>
                        </span>
                    ) : (
                        <span className='flex-1 text-sm text-slate-400'>Choose from the asset catalog…</span>
                    )}
                    <span className='text-xs text-emerald-300'>{value ? 'Change' : 'Choose'}</span>
                </button>
            )}
            <p className='mt-1 text-xs text-slate-500'>
                {locked ? 'Fixed because the unit already has its asset record.' : 'Category, subcategory and class are chosen here. Technical attributes are configured only in Asset Management.'}
            </p>
            {open && (
                <div className='fixed inset-0 z-50 flex flex-col bg-slate-950'>
                    <div className='flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-3'>
                        <p className='font-semibold text-white'>Choose the equipment class</p>
                        <button type='button' aria-label='Close' onClick={() => setOpen(false)} className='flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-slate-300'>
                            <X className='h-4 w-4' />
                        </button>
                    </div>
                    <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain p-4'>
                        <AssetDictionaryBrowser
                            showAttributes={false}
                            treePath='/api/org/assets/dictionary/tree'
                            classPath='/api/org/assets/dictionary/class'
                            pickLabel='Use this equipment class'
                            onPick={(c) => {
                                onChange(c.code, c.name, { categoryCode: c.categoryCode, subcategoryCode: c.subcategoryCode });
                                setOpen(false);
                            }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
