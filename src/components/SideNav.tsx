import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';

export interface NavItem {
    key: string;
    label: string;
    Icon: LucideIcon;
}

export interface NavGroup {
    title: string;
    items: NavItem[];
}

/**
 * Grouped side menu used by the MEMS admin and organization admin shells.
 * With `collapsible`, every section with more than one entry starts collapsed. The section of the page you are on
 * opens when you arrive on it, and any section can be opened or closed with its header.
 */
export default function SideNav({ groups, active, onSelect, collapsible = false }: { groups: NavGroup[]; active: string; onSelect: (key: string) => void; collapsible?: boolean }) {
    const activeGroup = groups.find((g) => g.items.some((i) => i.key === active))?.title ?? '';
    const [open, setOpen] = useState<string[]>(() => (activeGroup ? [activeGroup] : []));
    useEffect(() => {
        if (activeGroup) setOpen((cur) => (cur.includes(activeGroup) ? cur : [...cur, activeGroup]));
    }, [activeGroup]);
    const toggle = (title: string) => setOpen((cur) => (cur.includes(title) ? cur.filter((t) => t !== title) : [...cur, title]));
    return (
        <div className='flex-1 overflow-y-auto overscroll-contain px-2 pb-2'>
            {groups
                .filter((g) => g.items.length > 0)
                .map((g) => {
                    const folds = collapsible && g.items.length > 1;
                    const expanded = !folds || open.includes(g.title);
                    const id = `nav-${g.title.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}`;
                    return (
                        <div key={g.title} className='mb-1'>
                            {folds ? (
                                <button
                                    type='button'
                                    aria-expanded={expanded}
                                    aria-controls={id}
                                    onClick={() => toggle(g.title)}
                                    className='flex min-h-11 w-full items-center gap-2 rounded-lg px-3 pt-1 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 hover:bg-slate-800/40 active:bg-slate-800'
                                >
                                    {expanded ? <ChevronDown className='h-4 w-4 shrink-0' /> : <ChevronRight className='h-4 w-4 shrink-0' />}
                                    <span className='min-w-0 flex-1 truncate'>{g.title}</span>
                                    <span className='rounded-full bg-slate-800 px-2 text-[11px] font-medium normal-case tracking-normal text-slate-400'>{g.items.length}</span>
                                </button>
                            ) : (
                                <p className='px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-slate-500'>{g.title}</p>
                            )}
                            {expanded && (
                                <ul id={id} className={`space-y-0.5 ${folds ? 'pb-1' : ''}`}>
                                    {g.items.map(({ key, label, Icon }) => (
                                        <li key={key || 'home'}>
                                            <button
                                                onClick={() => onSelect(key)}
                                                aria-current={active === key ? 'page' : undefined}
                                                className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm ${
                                                    active === key ? 'bg-emerald-500/10 font-medium text-emerald-300' : 'text-slate-300 hover:bg-slate-800/60 active:bg-slate-800'
                                                }`}
                                            >
                                                <Icon className='h-[18px] w-[18px] shrink-0' />
                                                <span className='truncate'>{label}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    );
                })}
        </div>
    );
}
