import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, SelectField } from '../components/ui';
import { Screen } from '../components/screen';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import InventoryMaterialDetail from './InventoryMaterialDetail';

// Inventory on hand (INV): every published material in every warehouse the person can access
// (one row per material × warehouse: master warehouse, pushed warehouse or approved extension).
// The stock quantity is shown only where the server reports a stock ledger for the row (stockLedgerAvailable);
// otherwise the row says the stock is not yet tracked rather than showing a misleading zero.
// Tapping a row opens the material detail for that warehouse (stock position, settings, bins, journal).

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

    const rows = useMemo(() => (data?.items || []).filter((x) => warehouse === 'all' || x.warehouseId === warehouse), [data, warehouse]);
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

    return (
        <Screen
            title='Inventory on hand'
            eyebrow='INV'
            subtitle={data ? `${rows.length} materials · ${data.warehouses.length} warehouses · ${tracked} with stock ledger` : 'Published materials in your accessible warehouses'}
            actions={
                <Button variant='secondary' onClick={reload} disabled={loading} aria-label='Refresh'>
                    <RefreshCw className='h-4 w-4' />
                    <span className='hidden sm:inline'>Refresh</span>
                </Button>
            }
            toolbar={
                <SelectField id='onhand-warehouse' label='Warehouse' value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
                    <option value='all'>All accessible warehouses</option>
                    {(data?.warehouses || []).map((w) => (
                        <option key={w.id} value={w.id}>
                            {w.name}
                            {w.code && w.code !== w.name ? ` (${w.code})` : ''}
                        </option>
                    ))}
                </SelectField>
            }
        >
            {loading && <Spinner />}
            {!loading && error && <Alert tone='error'>{error}</Alert>}
            {!loading && !error && (
                <RichTable<Item>
                    id='inv.onhand'
                    title='Materials on hand'
                    columns={COLUMNS}
                    rows={rows}
                    rowKey={(x) => `${x.id}|${x.warehouseId}`}
                    onRowClick={setDetail}
                    empty='No published materials in the selected accessible warehouses.'
                    fileName='inventory-on-hand'
                    height='h-[calc(100dvh-19rem)]'
                />
            )}
        </Screen>
    );
}
