import { useMemo, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import InventoryMaterialDetail from './InventoryMaterialDetail';

// Inventory on hand (INV): every published material in every warehouse the person can access
// (one row per material × warehouse: master warehouse, pushed warehouse or approved extension).
// The stock quantity is shown only where the server reports a stock ledger for the row (stockLedgerAvailable);
// otherwise the row says the stock is not yet tracked rather than showing a misleading zero.
// Tapping a row opens the material detail for that warehouse (stock position, settings, bins, journal).
// Mobile layout: the page has no header or toolbar of its own. The search box and ONE menu button are the action bar
// (always visible); the menu holds the warehouse choice, refresh, status and every table tool. The table fills the
// rest of the screen and only its content scrolls.

interface Item {
    id: string;
    materialNumber: string;
    name: string;
    shortText: string;
    categoryCode: string;
    subcategoryCode: string;
    familyCode: string;
    materialCode: string;
    uom: string;
    supplyType: string;
    partNumber: string;
    warehouseId: string;
    warehouseName: string;
    warehouseCode: string;
    status: string;
    quantityOnHand: number;
    stockLedgerAvailable: boolean;
    createdAt: string;
}

interface Warehouse {
    id: string;
    name: string;
    code: string;
}

/** Quantity on hand, or null when the server has no stock ledger for this material in this warehouse. */
const onHand = (x: Item): number | null => (x.stockLedgerAvailable && Number.isFinite(Number(x.quantityOnHand)) ? Number(x.quantityOnHand) : null);

const COLUMNS: Array<Column<Item>> = [
    { key: 'materialNumber', label: 'Material number', value: (x) => x.materialNumber, render: (x) => <span className='font-mono font-semibold text-brandsoft'>{x.materialNumber}</span> },
    { key: 'name', label: 'Material', value: (x) => x.name, render: (x) => <span className='font-medium text-ink'>{x.name}</span> },
    { key: 'shortText', label: 'Description', value: (x) => x.shortText },
    { key: 'partNumber', label: 'Part number', value: (x) => x.partNumber || '—' },
    { key: 'categoryCode', label: 'Category', value: (x) => x.categoryCode },
    { key: 'subcategoryCode', label: 'Subcategory', value: (x) => x.subcategoryCode },
    { key: 'familyCode', label: 'Family', value: (x) => x.familyCode },
    { key: 'materialCode', label: 'Material code', value: (x) => x.materialCode, hidden: true },
    { key: 'warehouseName', label: 'Warehouse', value: (x) => x.warehouseName },
    { key: 'warehouseCode', label: 'Warehouse code', value: (x) => x.warehouseCode, hidden: true },
    { key: 'uom', label: 'UoM', value: (x) => x.uom || '—' },
    {
        key: 'quantityOnHand',
        label: 'On hand',
        type: 'number',
        value: (x) => onHand(x),
        render: (x) => {
            const q = onHand(x);
            return q === null ? <span className='text-muted'>—</span> : <span className='font-semibold tabular-nums text-ink'>{q.toLocaleString()}</span>;
        },
    },
    {
        key: 'stockStatus',
        label: 'Stock status',
        value: (x) => (x.stockLedgerAvailable ? 'Tracked' : 'Not yet tracked'),
        render: (x) => <Badge tone={x.stockLedgerAvailable ? 'brand' : 'warn'}>{x.stockLedgerAvailable ? 'Tracked' : 'Not yet tracked'}</Badge>,
    },
    { key: 'supplyType', label: 'Supply type', value: (x) => x.supplyType, hidden: true },
    { key: 'status', label: 'Material status', value: (x) => x.status, hidden: true },
    { key: 'createdAt', label: 'Created', type: 'date', value: (x) => x.createdAt, render: (x) => fmtDate(x.createdAt), hidden: true },
];

export default function InventoryOnHand() {
    const { data, loading, error, reload } = useLoad(() => callBackend<{ items: Item[]; warehouses: Warehouse[] }>('/api/org/inventory/on-hand'));
    const [warehouse, setWarehouse] = useState('all');
    const [detail, setDetail] = useState<Item | null>(null);

    const warehouses = data?.warehouses || [];
    // A saved choice that is no longer accessible falls back to all warehouses instead of showing an empty table.
    const chosen = warehouses.find((w) => w.id === warehouse);
    const rows = useMemo(() => (data?.items || []).filter((x) => !chosen || x.warehouseId === chosen.id), [data, chosen]);
    const tracked = rows.filter((x) => x.stockLedgerAvailable).length;

    if (detail) {
        return (
            <InventoryMaterialDetail
                id={detail.id}
                warehouseId={detail.warehouseId}
                onBack={() => {
                    setDetail(null);
                    reload();
                }}
            />
        );
    }

    const label = (w: Warehouse) => `${w.name}${w.code && w.code !== w.name ? ` (${w.code})` : ''}`;
    const choices: Array<{ id: string; text: string }> = [{ id: 'all', text: 'All accessible warehouses' }, ...warehouses.map((w) => ({ id: w.id, text: label(w) }))];
    const row = 'flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:opacity-40';

    return (
        <div className='flex h-[calc(100dvh-7rem)] min-h-0 flex-col'>
            {loading && <Spinner />}
            {!loading && error && (
                <div className='space-y-3'>
                    <Alert tone='error'>{error}</Alert>
                    <Button variant='secondary' onClick={reload}>
                        <RefreshCw className='h-4 w-4' />
                        Try again
                    </Button>
                </div>
            )}
            {!loading && !error && (
                <RichTable<Item>
                    id='inv.onhand'
                    title={chosen ? `Inventory on hand · ${chosen.name}` : 'Inventory on hand'}
                    menuTitle='Inventory on hand'
                    columns={COLUMNS}
                    rows={rows}
                    rowKey={(x) => `${x.id}|${x.warehouseId}`}
                    onRowClick={setDetail}
                    empty='No published materials in the selected accessible warehouses.'
                    fileName='inventory-on-hand'
                    height='h-full'
                    menuTop={(close) => (
                        <div className='space-y-3'>
                            {warehouses.length > 1 && (
                                <section role='radiogroup' aria-label='Warehouse' className='space-y-1'>
                                    <p className='px-1 text-xs font-semibold uppercase tracking-wide text-slate-400'>Warehouse</p>
                                    <div className='max-h-56 space-y-1 overflow-y-auto overscroll-contain'>
                                        {choices.map((c) => {
                                            const on = c.id === (chosen ? chosen.id : 'all');
                                            return (
                                                <button
                                                    key={c.id}
                                                    type='button'
                                                    role='radio'
                                                    aria-checked={on}
                                                    onClick={() => {
                                                        setWarehouse(c.id);
                                                        close();
                                                    }}
                                                    className={`${row} ${on ? 'bg-emerald-500/10' : ''}`}
                                                >
                                                    <span className='min-w-0 flex-1 truncate'>{c.text}</span>
                                                    {on && <Check className='h-5 w-5 shrink-0 text-emerald-300' />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>
                            )}
                            <p className='px-1 text-xs text-slate-400'>
                                {rows.length} materials · {warehouses.length} warehouses · {tracked} with stock ledger
                            </p>
                            <button
                                type='button'
                                onClick={() => {
                                    close();
                                    reload();
                                }}
                                className={row}
                            >
                                <RefreshCw className='h-5 w-5 shrink-0 text-emerald-300' />
                                <span className='flex-1'>Refresh</span>
                            </button>
                        </div>
                    )}
                />
            )}
        </div>
    );
}
