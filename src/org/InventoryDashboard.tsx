import type { ReactNode } from 'react';
import { Boxes, PackageOpen, RefreshCw, TrendingUp } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Screen } from '../components/screen';
import { Button, Spinner, useLoad } from '../admin/kit';

// Inventory dashboard (INV): headline figures for the warehouses the person can access.
//   stock value   physical stock × unit price from procurement settings, per price currency
//   empty bins    linked physical locations whose reconciled stock is zero
//   overstock     quantity above each material's configured maximum level
// Materials without a valid unit cost or with unreconciled journals are left out of the valuation (shown in a note).

interface Totals {
    stockValue: number;
    overstockValue: number;
    stockQuantity: number;
    overstockQuantity: number;
}

interface DashboardData {
    emptyBins: number;
    overstockQuantity: number;
    overstockCount: number;
    byCurrency: Record<string, Totals>;
    unvalued: number;
    unreconciled: number;
}

const qty = (n: number) => Number(n || 0).toLocaleString();
const money = (n: number, currency: string) => `${currency} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** One headline figure; values wrap instead of overflowing on narrow phones. */
function StatCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
    return (
        <article className='rounded-2xl border border-line bg-panel p-4'>
            <div className='flex items-center gap-2 text-sm font-medium text-soft'>
                <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brandsoft'>{icon}</span>
                <h2>{title}</h2>
            </div>
            <div className='mt-3 space-y-2'>{children}</div>
        </article>
    );
}

function Figure({ value, caption }: { value: string; caption?: string }) {
    return (
        <div className='min-w-0'>
            <strong className='block break-words text-2xl font-semibold tabular-nums text-ink'>{value}</strong>
            {caption && <p className='text-sm text-muted'>{caption}</p>}
        </div>
    );
}

export default function InventoryDashboard() {
    const { data, loading, error, reload } = useLoad(() => callBackend<DashboardData>('/api/org/inventory/dashboard'));
    const currencies = Object.entries(data?.byCurrency || {});

    return (
        <Screen
            title='Inventory dashboard'
            eyebrow='INV'
            subtitle='Stock value, empty bins and overstock in your warehouses'
            actions={
                <Button variant='secondary' onClick={reload} disabled={loading} aria-label='Refresh dashboard'>
                    <RefreshCw className='h-4 w-4' />
                    <span className='hidden sm:inline'>Refresh</span>
                </Button>
            }
        >
            {loading && <Spinner />}
            {!loading && error && <Alert tone='error'>{error}</Alert>}
            {!loading && !error && data && (
                <>
                    <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
                        <StatCard icon={<TrendingUp className='h-5 w-5' />} title='Stock value'>
                            {currencies.length ? (
                                currencies.map(([currency, totals]) => (
                                    <Figure key={currency} value={money(totals.stockValue, currency)} caption={`Quantity ${qty(totals.stockQuantity)}`} />
                                ))
                            ) : (
                                <Figure value='No valued stock' />
                            )}
                        </StatCard>
                        <StatCard icon={<PackageOpen className='h-5 w-5' />} title='Empty bins'>
                            <Figure value={qty(data.emptyBins)} caption='Linked physical locations with zero stock' />
                        </StatCard>
                        <StatCard icon={<Boxes className='h-5 w-5' />} title='Overstock'>
                            <Figure value={qty(data.overstockQuantity)} caption={`Excess quantity · ${qty(data.overstockCount)} materials`} />
                            {currencies.map(([currency, totals]) => (
                                <p key={currency} className='break-words text-base font-semibold tabular-nums text-amber-300'>
                                    {money(totals.overstockValue, currency)}
                                </p>
                            ))}
                        </StatCard>
                    </div>
                    {(!!data.unvalued || !!data.unreconciled) && (
                        <Alert tone='warn'>
                            Valuation excludes {qty(data.unvalued)} materials without a valid unit cost and {qty(data.unreconciled)} unreconciled material balances.
                        </Alert>
                    )}
                </>
            )}
        </Screen>
    );
}
