import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface TreeItem {
    id: string;
    parentId: string;
    code: string;
    title: string;
    subtitle?: string;
    color: string;
}

/** A mobile-friendly picture of a hierarchy: boxes joined by connector lines, collapsible per branch. */
export default function VisualTree({ rootTitle, rootSubtitle, items, onSelect }: { rootTitle: string; rootSubtitle?: string; items: TreeItem[]; onSelect?: (id: string) => void }) {
    const byParent = new Map<string, TreeItem[]>();
    const ids = new Set(items.map((i) => i.id));
    for (const item of items) {
        const key = item.parentId && ids.has(item.parentId) ? item.parentId : 'root';
        byParent.set(key, [...(byParent.get(key) ?? []), item]);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.code.localeCompare(b.code));
    const top = byParent.get('root') ?? [];
    return (
        <div className='overflow-x-auto pb-2'>
            <div className='inline-block min-w-full'>
                <div className='inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2'>
                    <span className='h-2.5 w-2.5 rounded-full bg-emerald-400' />
                    <span>
                        <span className='block text-sm font-semibold text-white'>{rootTitle}</span>
                        {rootSubtitle && <span className='block text-[11px] text-slate-500'>{rootSubtitle}</span>}
                    </span>
                </div>
                {top.length > 0 && (
                    <ul className='ml-4 mt-2 space-y-2 border-l border-slate-700'>
                        {top.map((item) => (
                            <Branch key={item.id} item={item} byParent={byParent} depth={0} onSelect={onSelect} />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function Branch({ item, byParent, depth, onSelect }: { item: TreeItem; byParent: Map<string, TreeItem[]>; depth: number; onSelect?: (id: string) => void }) {
    const [open, setOpen] = useState(depth < 3);
    const kids = byParent.get(item.id) ?? [];
    return (
        <li className='relative pl-5'>
            <span className='absolute left-0 top-5 h-px w-5 bg-slate-700' />
            <div className='flex items-stretch gap-1'>
                {kids.length > 0 ? (
                    <button type='button' onClick={() => setOpen(!open)} aria-label={open ? 'Collapse' : 'Expand'} className='flex w-6 shrink-0 items-center justify-center text-slate-500'>
                        {open ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}
                    </button>
                ) : (
                    <span className='w-6 shrink-0' />
                )}
                <button
                    type='button'
                    onClick={() => onSelect?.(item.id)}
                    className='min-w-[11rem] max-w-[18rem] rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-left'
                    style={{ borderLeft: `4px solid ${item.color}` }}
                >
                    <span className='block font-mono text-[11px]' style={{ color: item.color }}>
                        {item.code}
                    </span>
                    <span className='block truncate text-sm text-white'>{item.title}</span>
                    {item.subtitle && <span className='block truncate text-[11px] text-slate-500'>{item.subtitle}</span>}
                    {kids.length > 0 && !open && <span className='block text-[11px] text-slate-500'>{kids.length} below</span>}
                </button>
            </div>
            {open && kids.length > 0 && (
                <ul className='ml-9 mt-2 space-y-2 border-l border-slate-700'>
                    {kids.map((k) => (
                        <Branch key={k.id} item={k} byParent={byParent} depth={depth + 1} onSelect={onSelect} />
                    ))}
                </ul>
            )}
        </li>
    );
}
