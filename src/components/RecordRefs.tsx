import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileSearch, Link2, Loader2, Lock, X } from 'lucide-react';
import { SearchField } from './ui';
import { navigate } from '../lib/route';
import { STATUS_TONE, isHit, refsIn, resolveRecord, searchRecords, type RecordCard, type RecordHit, type RecordType } from '../lib/recordRefs';

// Record references in email, chat and To-dos: a picker to find and link any MEMS record, an inline chip and a live
// card (status as it is now, open button). The server decides what each person may see.

const tone = (s: string) => {
    const t = STATUS_TONE(s);
    return t === 'ok' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : t === 'bad' ? 'bg-red-500/15 text-red-700 dark:text-red-400' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
};
const words = (s: string) => s.replace(/_/g, ' ');
export const openRecord = (c: RecordHit) => navigate(`organization_home/${c.link}`);

/** One live record card. */
export function RecordCardView({ card, compact }: { card: RecordCard; compact?: boolean }) {
    if (!isHit(card))
        return (
            <div className='flex min-h-11 items-center gap-2 rounded-xl border border-line bg-page px-3 py-2 text-xs text-muted'>
                <Lock className='h-4 w-4 shrink-0' />
                <span className='min-w-0 truncate'>{card.type} {card.id} · {card.hidden ? 'not available to you' : 'not found'}</span>
            </div>
        );
    return (
        <button type='button' onClick={(e) => { e.stopPropagation(); openRecord(card); }} className='flex w-full min-w-0 items-center gap-3 rounded-xl border border-line bg-page px-3 py-2 text-left hover:border-brand/60'>
            <span className='flex h-9 w-11 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-[0.7rem] font-bold tracking-wide text-brand'>{card.type}</span>
            <span className='min-w-0 flex-1'>
                <span className='flex min-w-0 items-center gap-2'>
                    <span className='truncate text-sm font-semibold text-ink'>{card.ref}</span>
                    {card.status && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tone(card.status)}`}>{words(card.status)}</span>}
                </span>
                <span className='block truncate text-xs text-soft'>{card.title}{card.sub && !compact ? ` · ${card.sub}` : ''}</span>
                {!compact && <span className='block truncate text-xs text-muted'>{card.label} · {card.linkLabel}</span>}
            </span>
            <ExternalLink className='h-4 w-4 shrink-0 text-brand' />
        </button>
    );
}

/** Live cards for every record referenced in a text (email body, chat message, To-do). */
export function RecordCards({ text, compact, max = 6 }: { text: string; compact?: boolean; max?: number }) {
    const refs = useMemo(() => refsIn(text, max), [text, max]);
    const [cards, setCards] = useState<RecordCard[]>([]);
    useEffect(() => {
        let live = true;
        if (!refs.length) {
            setCards([]);
            return;
        }
        void Promise.all(refs.map((r) => resolveRecord(r.type, r.id))).then((c) => live && setCards(c));
        return () => { live = false; };
    }, [refs]);
    if (!refs.length) return null;
    return (
        <div aria-label='Linked MEMS records' className='mt-2 space-y-1.5'>
            {cards.length ? cards.map((c) => <RecordCardView key={`${c.type}:${c.id}`} card={c} compact={compact} />) : <p className='flex items-center gap-1 text-xs text-muted'><Loader2 className='h-3 w-3 animate-spin' /> Loading linked records…</p>}
        </div>
    );
}

/** Inline chip for a token inside text; tapping opens the record when the reader may see it. */
export function RecordChip({ type, id }: { type: string; id: string }) {
    const [card, setCard] = useState<RecordCard | null>(null);
    useEffect(() => { let live = true; void resolveRecord(type, id).then((c) => live && setCard(c)); return () => { live = false; }; }, [type, id]);
    const label = card && isHit(card) ? card.ref : id;
    return (
        <button type='button' onClick={(e) => { e.stopPropagation(); if (card && isHit(card)) openRecord(card); }} className='mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md bg-brand/10 px-1.5 align-baseline text-[0.92em] font-semibold text-brand' title={card && isHit(card) ? `${card.label}: ${card.title}` : `${type} ${id}`}>
            <Link2 className='h-3 w-3 shrink-0' /><span className='truncate'>{type} {label}</span>
        </button>
    );
}

/** Text with record tokens replaced by chips (other text passed to `render`). */
export function withRecordChips(text: string, render: (plain: string, key: string) => React.ReactNode) {
    const out: React.ReactNode[] = [];
    let last = 0;
    let i = 0;
    for (const m of text.matchAll(/\[\[([A-Z]{2,4}):([A-Za-z0-9_.-]{1,100})\]\]/g)) {
        if (m.index! > last) out.push(render(text.slice(last, m.index), `t${i}`));
        out.push(<RecordChip key={`r${i}`} type={m[1]} id={m[2]} />);
        last = m.index! + m[0].length;
        i++;
    }
    if (last < text.length) out.push(render(text.slice(last), `t${i}`));
    return out;
}

function useSearch(q: string, type: string, enabled = true) {
    const [results, setResults] = useState<RecordHit[]>([]);
    const [types, setTypes] = useState<RecordType[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const seq = useRef(0);
    useEffect(() => {
        if (!enabled) return;
        const n = ++seq.current;
        const t = setTimeout(() => {
            setBusy(true);
            searchRecords(q, type ? [type] : [])
                .then((r) => { if (n === seq.current) { setResults(r.results); setTypes(r.types); setError(''); } })
                .catch((e) => n === seq.current && setError(e instanceof Error ? e.message : 'Search failed'))
                .finally(() => n === seq.current && setBusy(false));
        }, 250);
        return () => clearTimeout(t);
    }, [q, type, enabled]);
    return { results, types, busy, error };
}

/** Full-screen (phone) / dialog (desktop) search to link a record. */
export function RecordPicker({ onPick, onClose, title = 'Link a MEMS record' }: { onPick: (hit: RecordHit) => void; onClose: () => void; title?: string }) {
    const [q, setQ] = useState('');
    const [type, setType] = useState('');
    const { results, types, busy, error } = useSearch(q, type, q.trim().length >= 1 || !!type);
    return (
        <div role='dialog' aria-modal='true' aria-label={title} className='fixed inset-0 z-[80] flex items-end justify-center bg-[#000000]/50 sm:items-center' onClick={onClose}>
            <div className='flex h-[88dvh] w-full max-w-xl flex-col rounded-t-2xl bg-panel text-ink sm:h-[80dvh] sm:rounded-2xl' onClick={(e) => e.stopPropagation()}>
                <div className='flex items-center gap-2 border-b border-line p-3'>
                    <FileSearch className='h-5 w-5 shrink-0 text-brand' />
                    <h2 className='min-w-0 flex-1 truncate text-base font-semibold'>{title}</h2>
                    <button type='button' aria-label='Close' onClick={onClose} className='flex h-11 w-11 items-center justify-center rounded-xl border border-line'><X className='h-4 w-4' /></button>
                </div>
                <div className='space-y-2 border-b border-line p-3'>
                    <div className='relative'>
                        <SearchField label='Search records' autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder='Number, supplier, equipment, title… (e.g. po acme)' />
                        {busy && <Loader2 aria-label='Searching' className='absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted' />}
                    </div>
                    <div className='flex gap-1.5 overflow-x-auto pb-1' role='group' aria-label='Record type'>
                        {[{ type: '', label: 'All', module: '' }, ...types].map((t) => (
                            <button key={t.type || 'all'} type='button' aria-pressed={type === t.type} onClick={() => setType(t.type)} className={`min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold ${type === t.type ? 'bg-brand text-onbrand' : 'border border-line text-soft'}`}>{t.label}</button>
                        ))}
                    </div>
                </div>
                <div className='min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-3'>
                    {error && <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>}
                    {!q.trim() && !type && <p className='text-sm text-muted'>Search purchase requirements, requisitions, purchase orders, vendors, supplier invoices, work requests, assessments, work orders, materials, stock takes, stock adjustments, assets and S&OP plans. Only records you may see are shown.</p>}
                    {(q.trim() || type) && !busy && !results.length && !error && <p className='text-sm text-muted'>No records you can see match.</p>}
                    {results.map((r) => (
                        <div key={r.token} className='flex items-center gap-2'>
                            <div className='min-w-0 flex-1'><RecordCardView card={r} /></div>
                            <button type='button' onClick={() => onPick(r)} className='min-h-11 shrink-0 rounded-xl bg-brand px-3 text-sm font-semibold text-onbrand'>Link</button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

/** Inline suggestions while typing "#term" (chat): returns hits for the term after the last #. */
export function useHashSuggestions(text: string) {
    const m = /(?:^|\s)#([A-Za-z0-9][A-Za-z0-9 _.:-]{1,40})$/.exec(text);
    const term = m ? m[1] : '';
    const { results, busy } = useSearch(term, '', term.length >= 2);
    return { term, results: term.length >= 2 ? results.slice(0, 6) : [], busy: term.length >= 2 && busy };
}
