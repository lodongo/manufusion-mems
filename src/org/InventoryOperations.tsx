import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, SelectField } from '../components/ui';
import { Screen, Segmented } from '../components/screen';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';

// Inventory operations (INV): the stock movement journal and the stock alerts for the warehouses the person can access.
//   movements   material journal entries (newest first, up to 1000), with physical and reserved quantity changes
//   alerts      derived from reconciled balances: below minimum, overstock, negative available, unreconciled journals
// Opened from the INV module as mode='movements' or mode='alerts'; the segmented switch moves between both views.
// Warehouse and type filters sit in the toolbar; search, column filters, sorting and Excel export come from RichTable.

type View = 'alerts' | 'movements';

interface Warehouse {
    id: string;
    name: string;
}

interface Movement {
    id: string;
    warehouseId: string;
    warehouse: string;
    materialNumber: string;
    materialName: string;
    type: string;
    status: string;
    reconciled: boolean;
    reference: string;
    date: string;
    physicalDelta: number;
    reservedDelta: number;
}

interface StockAlert {
    id: string;
    warehouseId: string;
    warehouse: string;
    materialNumber: string;
    materialName: string;
    kind: string;
    message: string;
    quantity: number;
    available: number;
    limit?: number;
}

interface OperationsData {
    warehouses: Warehouse[];
    movements: Movement[];
    alerts: StockAlert[];
    journalDiagnostics?: { accessibleWarehouses: number; visibleJournalEntries: number };
}

const TABLE_HEIGHT = 'h-[calc(100dvh-21rem)]';
const words = (s: string) => (s || '').replace(/_/g, ' ');
const signed = (n: number) => `${n > 0 ? '+' : ''}${Number(n || 0).toLocaleString()}`;

function alertTone(kind: string): 'danger' | 'warn' | 'muted' {
    if (kind === 'Below Minimum' || kind === 'Negative Available') return 'danger';
    if (kind === 'Overstock') return 'warn';
    return 'muted';
}

const MOVEMENT_COLUMNS: Array<Column<Movement>> = [
    { key: 'date', label: 'Date', type: 'date', value: (x) => x.date, render: (x) => fmtDate(x.date) },
    { key: 'materialNumber', label: 'Material', value: (x) => x.materialNumber, render: (x) => <span className='font-mono text-brandsoft'>{x.materialNumber}</span> },
    { key: 'materialName', label: 'Description', value: (x) => x.materialName },
    { key: 'warehouse', label: 'Warehouse', value: (x) => x.warehouse },
    { key: 'type', label: 'Movement', value: (x) => words(x.type) },
    {
        key: 'physicalDelta',
        label: 'Quantity change',
        type: 'number',
        value: (x) => x.physicalDelta,
        render: (x) => <span className={`font-semibold tabular-nums ${x.physicalDelta < 0 ? 'text-red-300' : 'text-ink'}`}>{signed(x.physicalDelta)}</span>,
    },
    { key: 'reservedDelta', label: 'Reserved change', type: 'number', value: (x) => x.reservedDelta, render: (x) => signed(x.reservedDelta), hidden: true },
    { key: 'status', label: 'Status', value: (x) => words(x.status) },
    { key: 'reconciled', label: 'Reconciled', value: (x) => (x.reconciled ? 'Yes' : 'No'), render: (x) => <Badge tone={x.reconciled ? 'brand' : 'warn'}>{x.reconciled ? 'Reconciled' : 'Pending'}</Badge> },
    { key: 'reference', label: 'Reference', value: (x) => x.reference || '—' },
];

const ALERT_COLUMNS: Array<Column<StockAlert>> = [
    { key: 'materialNumber', label: 'Material', value: (x) => x.materialNumber, render: (x) => <span className='font-mono text-brandsoft'>{x.materialNumber}</span> },
    { key: 'materialName', label: 'Description', value: (x) => x.materialName },
    { key: 'warehouse', label: 'Warehouse', value: (x) => x.warehouse },
    { key: 'kind', label: 'Alert', value: (x) => x.kind, render: (x) => <Badge tone={alertTone(x.kind)}>{x.kind}</Badge> },
    { key: 'message', label: 'Message', value: (x) => x.message },
    { key: 'quantity', label: 'On hand', type: 'number', value: (x) => x.quantity, render: (x) => Number(x.quantity || 0).toLocaleString() },
    { key: 'available', label: 'Available', type: 'number', value: (x) => x.available, render: (x) => Number(x.available || 0).toLocaleString() },
    { key: 'limit', label: 'Limit', type: 'number', value: (x) => x.limit ?? null, render: (x) => (x.limit === undefined || x.limit === null ? '—' : x.limit.toLocaleString()) },
];

/** Bottom sheet (phone) / dialog (desktop) with the full record of a tapped row. */
function DetailSheet({ title, rows, onClose }: { title: string; rows: Array<[string, ReactNode]>; onClose: () => void }) {
    return (
        <div className='fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4' role='presentation'>
            <button type='button' aria-label='Close details' className='absolute inset-0 bg-black/60' onClick={onClose} />
            <div role='dialog' aria-modal='true' aria-label={title} className='relative flex max-h-[85dvh] w-full flex-col rounded-t-2xl border border-line bg-panel sm:max-w-md sm:rounded-2xl'>
                <div className='flex items-center gap-2 border-b border-line p-4'>
                    <h2 className='min-w-0 flex-1 truncate text-base font-semibold text-ink'>{title}</h2>
                    <button type='button' aria-label='Close' onClick={onClose} className='-m-2 flex h-11 w-11 items-center justify-center rounded-full text-muted active:bg-page'>
                        <X className='h-5 w-5' />
                    </button>
                </div>
                <dl className='min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]'>
                    {rows.map(([label, value]) => (
                        <div key={label} className='flex items-start justify-between gap-3 py-3 text-sm'>
                            <dt className='shrink-0 text-muted'>{label}</dt>
                            <dd className='min-w-0 break-words text-right text-ink'>{value}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </div>
    );
}

export default function InventoryOperations({ mode }: { mode: 'alerts' | 'movements' }) {
    const { data, loading, error, reload } = useLoad(() => callBackend<OperationsData>('/api/org/inventory/operations'));
    const [view, setView] = useState<View>(mode);
    const [warehouse, setWarehouse] = useState('');
    const [kind, setKind] = useState('');
    const [movement, setMovement] = useState<Movement | null>(null);
    const [alert, setAlert] = useState<StockAlert | null>(null);

    // The module menu reuses this screen for both routes: follow the route when it changes.
    useEffect(() => setView(mode), [mode]);
    // Movement types and alert kinds differ, so the type filter resets with the view.
    useEffect(() => setKind(''), [view]);

    const movements = useMemo(
        () => (data?.movements || []).filter((x) => (!warehouse || x.warehouseId === warehouse) && (!kind || x.type === kind)),
        [data, warehouse, kind],
    );
    const alerts = useMemo(
        () => (data?.alerts || []).filter((x) => (!warehouse || x.warehouseId === warehouse) && (!kind || x.kind === kind)),
        [data, warehouse, kind],
    );
    const kinds = useMemo(
        () => Array.from(new Set(view === 'alerts' ? (data?.alerts || []).map((x) => x.kind) : (data?.movements || []).map((x) => x.type))).filter(Boolean).sort(),
        [data, view],
    );

    const filtered = !!(warehouse || kind);
    const diagnostics = data?.journalDiagnostics;
    const movementsEmpty = filtered
        ? 'No movements match the warehouse or type filter. Clear the filters to see all accessible movements.'
        : diagnostics?.accessibleWarehouses === 0
          ? 'No accessible warehouses were found for your account. Check your warehouse access.'
          : diagnostics?.visibleJournalEntries === 0
            ? 'No journal entries were found in your accessible warehouses. This does not confirm deletion; check the source journal and warehouse mapping.'
            : 'No movements to display.';
    const alertsEmpty = filtered ? 'No alerts match the warehouse or type filter.' : 'No stock alerts in your accessible warehouses.';

    const toolbar = (
        <div className='space-y-2'>
            <Segmented<View>
                label='Inventory operations view'
                value={view}
                onChange={setView}
                options={[
                    { value: 'movements', label: 'Stock movements', count: data ? movements.length : undefined },
                    { value: 'alerts', label: 'Alerts', count: data ? alerts.length : undefined },
                ]}
            />
            <div className='grid grid-cols-2 gap-2'>
                <SelectField id='ops-warehouse' label='Warehouse' value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
                    <option value=''>All accessible</option>
                    {(data?.warehouses || []).map((w) => (
                        <option key={w.id} value={w.id}>
                            {w.name}
                        </option>
                    ))}
                </SelectField>
                <SelectField id='ops-kind' label={view === 'alerts' ? 'Alert type' : 'Movement type'} value={kind} onChange={(e) => setKind(e.target.value)}>
                    <option value=''>All types</option>
                    {kinds.map((k) => (
                        <option key={k} value={k}>
                            {words(k)}
                        </option>
                    ))}
                </SelectField>
            </div>
        </div>
    );

    return (
        <Screen
            title={view === 'alerts' ? 'Inventory alerts' : 'Stock movements'}
            eyebrow='INV'
            actions={
                <Button variant='secondary' onClick={reload} disabled={loading} aria-label='Refresh'>
                    <RefreshCw className='h-4 w-4' />
                    <span className='hidden sm:inline'>Refresh</span>
                </Button>
            }
            toolbar={toolbar}
        >
            {loading && <Spinner />}
            {!loading && error && <Alert tone='error'>{error}</Alert>}
            {!loading && !error && view === 'movements' && (
                <RichTable<Movement>
                    id='inv.ops.movements'
                    title='Stock movements'
                    columns={MOVEMENT_COLUMNS}
                    rows={movements}
                    rowKey={(x) => x.id}
                    onRowClick={setMovement}
                    empty={movementsEmpty}
                    fileName='stock-movements'
                    height={TABLE_HEIGHT}
                />
            )}
            {!loading && !error && view === 'alerts' && (
                <RichTable<StockAlert>
                    id='inv.ops.alerts'
                    title='Inventory alerts'
                    columns={ALERT_COLUMNS}
                    rows={alerts}
                    rowKey={(x) => `${x.id}|${x.kind}`}
                    onRowClick={setAlert}
                    empty={alertsEmpty}
                    fileName='inventory-alerts'
                    height={TABLE_HEIGHT}
                    rowClassName={(x) => (alertTone(x.kind) === 'danger' ? 'bg-red-500/10' : '')}
                />
            )}

            {movement && (
                <DetailSheet
                    title={`${words(movement.type)} · ${movement.materialNumber}`}
                    onClose={() => setMovement(null)}
                    rows={[
                        ['Date', fmtDate(movement.date)],
                        ['Material', `${movement.materialNumber} · ${movement.materialName}`],
                        ['Warehouse', movement.warehouse],
                        ['Movement', words(movement.type)],
                        ['Quantity change', signed(movement.physicalDelta)],
                        ['Reserved change', signed(movement.reservedDelta)],
                        ['Status', words(movement.status)],
                        ['Reconciled', movement.reconciled ? 'Yes' : 'No'],
                        ['Reference', movement.reference || '—'],
                    ]}
                />
            )}
            {alert && (
                <DetailSheet
                    title={`${alert.kind} · ${alert.materialNumber}`}
                    onClose={() => setAlert(null)}
                    rows={[
                        ['Material', `${alert.materialNumber} · ${alert.materialName}`],
                        ['Warehouse', alert.warehouse],
                        ['Alert', alert.kind],
                        ['Message', alert.message],
                        ['On hand', Number(alert.quantity || 0).toLocaleString()],
                        ['Available', Number(alert.available || 0).toLocaleString()],
                        ['Limit', alert.limit === undefined || alert.limit === null ? '—' : alert.limit.toLocaleString()],
                    ]}
                />
            )}
        </Screen>
    );
}
