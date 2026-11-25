import { Link2 } from 'lucide-react';

/**
 * The three linked material numbers, shown the same way everywhere:
 *  - Stores material number: the code used in every warehouse (issued at approval);
 *  - Master data number (MSTD_): the approved master record;
 *  - Request number: NWREQ_ for the creation request, EXREQ_ for each warehouse extension.
 * Earlier numbers the material was known by stay visible as aliases.
 */
export interface MaterialNumbers {
    materialNumber?: string;
    masterDataId?: string;
    requestId?: string;
    id?: string;
    materialNumberAliases?: string[];
    extensionRequests?: Array<{ id: string; warehouseName?: string; status?: string }>;
}

const SYSTEM = /^(?:MSTD|NWREQ|EXREQ)_\d{9}$|^MAT-/;
/** True when the stores number is missing or is a request/master number used in its place. */
export const nonConformingNumber = (n?: string) => !n || SYSTEM.test(n) || !(/^[A-Z0-9]{2,5}-[A-Z0-9]{2,8}-[A-Z0-9]{2,8}-\d{6}$/.test(n) || /^[A-Z0-9]{1,20}\d{6}$/.test(n));

/** Compact one-line identity for tables and lists. */
export function storesNumberText(m: MaterialNumbers): string {
    return m.materialNumber && !nonConformingNumber(m.materialNumber) ? m.materialNumber : m.masterDataId ? 'Number pending sync' : 'Issued at approval';
}

export default function MaterialIdentity({ m, compact = false }: { m: MaterialNumbers; compact?: boolean }) {
    const request = m.requestId || m.id || '';
    const stores = m.materialNumber && !nonConformingNumber(m.materialNumber) ? m.materialNumber : '';
    const rows: Array<[string, string, string]> = [
        ['Stores material number', stores || (m.masterDataId ? 'Not yet synchronised' : 'Issued at final approval'), 'Used in every warehouse, on requisitions, orders and stock'],
        ['Master data number', m.masterDataId || 'Issued at final approval', 'The approved master record'],
        ['Creation request', request, 'NWREQ: the request that created it'],
    ];
    if (compact)
        return (
            <p className='flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-soft'>
                <span className='font-semibold text-ink'>{stores || '—'}</span>
                <Link2 aria-hidden className='h-3 w-3 text-muted' />
                <span>{m.masterDataId || 'MSTD pending'}</span>
                <Link2 aria-hidden className='h-3 w-3 text-muted' />
                <span>{request}</span>
            </p>
        );
    return (
        <section aria-label='Material numbers' className='rounded-2xl border border-line bg-panel p-3'>
            <h2 className='mb-2 flex items-center gap-2 text-sm font-semibold text-ink'>
                <Link2 aria-hidden className='h-4 w-4 text-brand' /> Linked numbers
            </h2>
            <dl className='grid gap-2 sm:grid-cols-3'>
                {rows.map(([label, value, hint]) => (
                    <div key={label} className='min-w-0 rounded-xl bg-page p-3'>
                        <dt className='text-xs text-muted'>{label}</dt>
                        <dd className='mt-1 break-all font-mono text-sm font-semibold text-ink'>{value}</dd>
                        <dd className='mt-1 text-xs text-muted'>{hint}</dd>
                    </div>
                ))}
            </dl>
            {!!m.extensionRequests?.length && (
                <div className='mt-2 rounded-xl bg-page p-3'>
                    <p className='text-xs text-muted'>Extension requests (EXREQ)</p>
                    <ul className='mt-1 space-y-1'>
                        {m.extensionRequests.map((x) => (
                            <li key={x.id} className='flex flex-wrap justify-between gap-2 text-xs'>
                                <span className='font-mono font-semibold text-ink'>{x.id}</span>
                                <span className='text-soft'>
                                    {x.warehouseName} · {(x.status || '').replaceAll('_', ' ')}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {!!m.materialNumberAliases?.length && <p className='mt-2 text-xs text-muted'>Also known as: {m.materialNumberAliases.join(', ')}</p>}
        </section>
    );
}
