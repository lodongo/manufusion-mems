import { callBackend } from './backend';

// Linking MEMS records in email, chat and To-dos: a message carries [[TYPE:ID]]; readers see a live card. The server
// filters every result and card by the reader's own access (backend/recordSearch.ts).

export interface RecordHit { type: string; id: string; label: string; module: string; ref: string; title: string; sub: string; status: string; updatedAt: string; link: string; linkLabel: string; token: string }
export type RecordCard = RecordHit | { type: string; id: string; label: string; hidden?: boolean; missing?: boolean };
export interface RecordType { type: string; label: string; module: string }

export const REF_RE = /\[\[([A-Z]{2,4}):([A-Za-z0-9_.-]{1,100})\]\]/g;
export const tokenOf = (type: string, id: string) => `[[${type}:${id}]]`;
export function refsIn(text: string, limit = 12): Array<{ type: string; id: string }> {
    const out: Array<{ type: string; id: string }> = [];
    const seen = new Set<string>();
    for (const m of text.matchAll(REF_RE)) {
        const k = `${m[1]}:${m[2]}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ type: m[1], id: m[2] });
        if (out.length >= limit) break;
    }
    return out;
}
export const isHit = (c: RecordCard): c is RecordHit => 'ref' in c;

export async function searchRecords(q: string, types: string[] = []) {
    return callBackend<{ results: RecordHit[]; types: RecordType[] }>('/api/org/records/search', { q, types });
}

// Live cards are cached briefly and requested in one batch per moment, so a chat full of references makes one call.
const cache = new Map<string, { at: number; card: RecordCard }>();
let pending: Array<{ key: string; resolve: (c: RecordCard) => void }> = [];
let timer: ReturnType<typeof setTimeout> | null = null;
function flush() {
    const batch = pending.splice(0, 30);
    timer = pending.length ? setTimeout(flush, 30) : null;
    const keys = [...new Set(batch.map((b) => b.key))];
    callBackend<{ cards: RecordCard[] }>('/api/org/records/resolve', { refs: keys.map((k) => ({ type: k.split(':')[0], id: k.slice(k.indexOf(':') + 1) })) })
        .then((r) => {
            for (const c of r.cards) cache.set(`${c.type}:${c.id}`, { at: Date.now(), card: c });
            for (const b of batch) b.resolve(cache.get(b.key)?.card ?? { type: b.key.split(':')[0], id: b.key.split(':')[1], label: '', missing: true });
        })
        .catch(() => batch.forEach((b) => b.resolve({ type: b.key.split(':')[0], id: b.key.split(':')[1], label: '', missing: true })));
}
export function resolveRecord(type: string, id: string): Promise<RecordCard> {
    const key = `${type}:${id}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 30_000) return Promise.resolve(hit.card);
    return new Promise((resolve) => {
        pending.push({ key, resolve });
        if (!timer) timer = setTimeout(flush, 40);
    });
}
export const STATUS_TONE = (s: string) => (/(approved|open|active|released|posted|paid|completed|closed|acknowledged|converted|effective)/.test(s) ? 'ok' : /(reject|cancel|declin|expired|returned)/.test(s) ? 'bad' : 'wait');
/** A message preview with record tokens shown as 'PO PO000123'. */
export const plainRefs = (text: string) => text.replace(REF_RE, '$1 $2');
