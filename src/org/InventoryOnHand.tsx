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
// Net available and stock value are read from posted, reconciled stock journals only.
// Missing/unreconciled balances never masquerade as zero; money is shown only
// when the purchase unit matches the stock UOM and a unit price exists.
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
    quantityOnHand: number | null;
    netAvailable: number | null;
    netStockValue: number | null;
    stockCurrency: string;
    stockStatus: 'Not yet tracked'|'Unreconciled'|'Empty bin'|'Overstock'|'Understock'|'Within limits';
    stockLedgerAvailable: boolean;
    createdAt: string;
}

interface Warehouse {
    id: string;
    name: string;
    code: string;
}

/** Quantity on hand, or null when the server has no stock ledger for this material in this warehouse. */
const onHand = (x: Item): number | null => (x.stockLedgerAvailable && x.quantityOnHand !== null && Number.isFinite(x.quantityOnHand) ? x.quantityOnHand : null);
const netAvailable = (x: Item): number | null => (x.stockLedgerAvailable && x.netAvailable !== null && Number.isFinite(x.netAvailable) ? x.netAvailable : null);
const numText = (n: number) => n.toLocaleString(undefined,{maximumFractionDigits:3});
const stockColour = (s: Item['stockStatus']) => s==='Overstock'?
    'bg-red-100 text-red-900 border-red-300':s==='Understock'?
    'bg-yellow-100 text-yellow-900 border-yellow-300':s==='Empty bin'?
    'bg-orange-100 text-orange-900 border-orange-300':
    s==='Unreconciled'?'bg-rose-100 text-rose-900 border-rose-300':
    s==='Not yet tracked'?'bg-slate-100 text-slate-700 border-slate-300':
    'bg-emerald-100 text-emerald-900 border-emerald-300';

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
        key: 'netAvailable',
        label: 'Net available',
        type: 'number',
        value: (x) => netAvailable(x),
        render: (x) => {
            const q=netAvailable(x);
            return q===null?<span className='text-muted'>—</span>:
                <span className={'font-semibold tabular-nums '+(x.stockStatus==='Overstock'?'text-red-700':
                    x.stockStatus==='Understock'?'text-yellow-700':x.stockStatus==='Empty bin'?'text-orange-700':'text-ink')}>{numText(q)}</span>;
        },
    },
    {
        key: 'quantityOnHand',
        label: 'Physical on hand',
        type: 'number',
        hidden: true,
        value: (x) => onHand(x),
        render: (x) => onHand(x)===null?<span className='text-muted'>—</span>:
            <span className='tabular-nums text-ink'>{numText(onHand(x)!)}</span>,
    },
    {
        key: 'netStockValue',
        label: 'Net stock value',
        type: 'number',
        value: (x) => x.netStockValue,
        render: (x) => x.netStockValue===null||!Number.isFinite(x.netStockValue)?
            <span className='text-muted' title='Needs a reconciled stock ledger and unit price in the same UOM as inventory'>—</span>:
            <span className='font-semibold tabular-nums text-ink'>
                {x.stockCurrency?x.stockCurrency+' ':''}{x.netStockValue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
            </span>,
    },
    {
        key: 'stockStatus',
        label: 'Stock status',
        value: (x) => x.stockStatus,
        render: (x) => <span className={'inline-flex rounded-full border px-2 py-1 text-xs font-semibold '+stockColour(x.stockStatus)}>{x.stockStatus}</span>,
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
                                {rows.length} materials · {warehouses.length} warehouses · {tracked} with reconciled stock ledger
                                <span className='mt-1 block'>Overstock: red · Understock: yellow · Empty bin: orange. Net available excludes reserved, quarantined, damaged and expired stock.</span>
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
