import { useMemo, useState } from 'react';
import { Plus, RotateCcw, Search, X } from 'lucide-react';

// Edits the transactions that may post to one GL account, relative to a base list (the MEMS default or the derived
// default). The result is a change: transactions removed from the base and transactions added or given another side.

export type Side = 'Dr' | 'Cr' | 'Dr/Cr';
export type Handler = { code: string; side: Side };
export type TxnCode = { code: string; name: string; module: string; areaName?: string; actionName?: string; state: string };
export type Change = { add: Handler[]; remove: string[] };

export const SIDE_LABEL: Record<Side, string> = { Dr: 'Debit', Cr: 'Credit', 'Dr/Cr': 'Debit or credit' };

export function applyChange(base: Handler[], change: Change | null | undefined): Handler[] {
    if (!change) return base;
    const list = base.filter((h) => !change.remove.includes(h.code));
    for (const a of change.add) {
        const i = list.findIndex((h) => h.code === a.code);
        if (i >= 0) list[i] = a;
        else list.push(a);
    }
    return list;
}

export function changeOf(base: Handler[], draft: Handler[]): Change {
    return {
        remove: base.filter((b) => !draft.some((d) => d.code === b.code)).map((b) => b.code),
        add: draft.filter((d) => !base.some((b) => b.code === d.code && b.side === d.side)),
    };
}

export function HandlerList({ items, codes }: { items: Handler[]; codes: Map<string, TxnCode> }) {
    if (!items.length) return <p className='text-sm text-muted'>No transaction.</p>;
    return (
        <ul className='space-y-1'>
            {items.map((h) => (
                <li key={h.code} className='flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm'>
                    <span className='font-mono text-xs font-semibold text-ink'>{h.code}</span>
                    <span className='min-w-0 flex-1 truncate text-soft'>{codes.get(h.code)?.name ?? ''}</span>
                    <span className='shrink-0 text-xs text-muted'>{SIDE_LABEL[h.side]}</span>
                </li>
            ))}
        </ul>
    );
}

export default function GlTxnEditor({ base, draft, onChange, codes, disabled }: { base: Handler[]; draft: Handler[]; onChange: (next: Handler[]) => void; codes: TxnCode[]; disabled?: boolean }) {
    const [q, setQ] = useState('');
    const [side, setSide] = useState<Side>('Dr');
    const byCode = useMemo(() => new Map(codes.map((c) => [c.code, c])), [codes]);
    const options = useMemo(() => {
        const t = q.trim().toLowerCase();
        if (!t) return [];
        return codes.filter((c) => !draft.some((d) => d.code === c.code) && `${c.code} ${c.name} ${c.areaName ?? ''}`.toLowerCase().includes(t)).slice(0, 30);
    }, [q, codes, draft]);
    const removed = base.filter((b) => !draft.some((d) => d.code === b.code));
    return (
        <div className='space-y-2'>
            <ul className='space-y-1'>
                {draft.map((h) => {
                    const added = !base.some((b) => b.code === h.code);
                    const changedSide = !added && base.find((b) => b.code === h.code)?.side !== h.side;
                    return (
                        <li key={h.code} className='flex min-h-12 flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-1 text-sm'>
                            <span className='font-mono text-xs font-semibold text-ink'>{h.code}</span>
                            <span className='min-w-0 flex-1 truncate text-soft'>{byCode.get(h.code)?.name ?? ''}</span>
                            {(added || changedSide) && <span className='rounded-full bg-brand/15 px-2 text-[11px] text-brand'>{added ? 'Added' : 'Side changed'}</span>}
                            <select aria-label={`Side for ${h.code}`} disabled={disabled} value={h.side} onChange={(e) => onChange(draft.map((x) => (x.code === h.code ? { ...x, side: e.target.value as Side } : x)))} className='min-h-11 rounded-lg border border-line bg-panel px-2 text-sm text-ink'>
                                {(Object.keys(SIDE_LABEL) as Side[]).map((s) => (
                                    <option key={s} value={s}>
                                        {SIDE_LABEL[s]}
                                    </option>
                                ))}
                            </select>
                            <button type='button' disabled={disabled} aria-label={`Remove ${h.code}`} onClick={() => onChange(draft.filter((x) => x.code !== h.code))} className='flex h-11 w-11 items-center justify-center rounded-full text-soft active:bg-page disabled:opacity-40'>
                                <X className='h-4 w-4' />
                            </button>
                        </li>
                    );
                })}
                {!draft.length && <li className='rounded-lg border border-red-500/50 p-3 text-sm text-red-300'>Keep at least one transaction.</li>}
            </ul>
            {removed.length > 0 && (
                <div className='space-y-1'>
                    <p className='text-xs text-muted'>Removed from the default (postings by these transactions are refused):</p>
                    <ul className='flex flex-wrap gap-1'>
                        {removed.map((h) => (
                            <li key={h.code}>
                                <button type='button' disabled={disabled} onClick={() => onChange([...draft, h])} className='flex min-h-11 items-center gap-1 rounded-full border border-line px-3 text-xs text-soft line-through active:bg-page'>
                                    <RotateCcw className='h-3 w-3' /> {h.code}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {!disabled && (
                <div className='space-y-2 rounded-xl border border-line bg-page p-3'>
                    <p className='text-xs font-semibold text-soft'>Add a transaction</p>
                    <div className='flex gap-2'>
                        <label className='flex h-12 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-panel px-3'>
                            <Search className='h-4 w-4 text-muted' />
                            <input aria-label='Find a transaction to add' value={q} onChange={(e) => setQ(e.target.value)} placeholder='Code or name' className='h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted' />
                        </label>
                        <select aria-label='Side for the added transaction' value={side} onChange={(e) => setSide(e.target.value as Side)} className='min-h-12 rounded-xl border border-line bg-panel px-2 text-sm text-ink'>
                            {(Object.keys(SIDE_LABEL) as Side[]).map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                    </div>
                    {options.length > 0 && (
                        <ul className='max-h-56 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line bg-panel'>
                            {options.map((c) => (
                                <li key={c.code}>
                                    <button type='button' onClick={() => { onChange([...draft, { code: c.code, side }]); setQ(''); }} className='flex min-h-12 w-full items-center gap-2 px-3 text-left text-sm active:bg-page'>
                                        <Plus className='h-4 w-4 shrink-0 text-brand' />
                                        <span className='font-mono text-xs text-ink'>{c.code}</span>
                                        <span className='min-w-0 flex-1 truncate text-soft'>{c.name}</span>
                                        <span className='shrink-0 text-[11px] text-muted'>{c.state === 'live' ? 'Live' : 'Reserved'}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {q.trim() && !options.length && <p className='text-xs text-muted'>No transaction matches.</p>}
                </div>
            )}
        </div>
    );
}
