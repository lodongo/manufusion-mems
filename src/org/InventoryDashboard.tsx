import { useState, type ReactNode } from 'react';
import { Boxes, PackageOpen, RefreshCw, TrendingUp } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, SelectField } from '../components/ui';
import { Screen } from '../components/screen';
import { Button, Spinner, useLoad } from '../admin/kit';

// Inventory dashboard draws on the same reconciled material × warehouse snapshot
// as Inventory on Hand. Display currencies may change, never the stored supplier price.
// Quantity totals are grouped by UoM; adding kg, tonnes and pieces is invalid.

interface CurrencyTotals {
    stockValue: number;
    overstockValue: number;
    valued: number;
}
interface QuantityTotals {
    uom: string;
    netAvailable: number;
    overstockQuantity: number;
}
interface DashboardData {
    warehouses: Array<{ id: string; name: string; code: string }>;
    currencies: Array<{ code: string; rate: number }>;
    warehouseId: string;
    displayCurrency: string;
    totalRows: number;
    tracked: number;
    valued: number;
    unvalued: number;
    missingExchangeRate: number;
    unreconciled: number;
    notTracked: number;
    emptyBins: number;
    linkedBins: number;
    overstockCount: number;
    withoutMaximum: number;
    byCurrency: Record<string, CurrencyTotals>;
    quantities: QuantityTotals[];
}

const qty=(n:number)=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:3});
const money=(n:number,currency:string)=>`${currency} ${Number(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;

function StatCard({icon,title,children}:{icon:ReactNode;title:string;children:ReactNode}){
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
function Figure({value,caption}:{value:string;caption?:string}){
    return <div className='min-w-0'>
        <strong className='block break-words text-2xl font-semibold tabular-nums text-ink'>{value}</strong>
        {caption&&<p className='text-sm text-muted'>{caption}</p>}
    </div>;
}

export default function InventoryDashboard(){
    const [warehouseId,setWarehouseId]=useState('all');
    const [displayCurrency,setDisplayCurrency]=useState('');
    const {data,loading,error,reload}=useLoad(
        ()=>callBackend<DashboardData>('/api/org/inventory/dashboard',{warehouseId,displayCurrency}),
        [warehouseId,displayCurrency],
    );
    const currencies=Object.entries(data?.byCurrency||{});
    const uomValues=data?.quantities||[];
    return (
        <Screen
            title='Inventory dashboard'
            eyebrow='INV'
            subtitle='Reconciled net stock value, linked empty bins and overstock'
            actions={
                <Button variant='secondary' onClick={reload} disabled={loading} aria-label='Refresh dashboard'>
                    <RefreshCw className='h-4 w-4' />
                    <span className='hidden sm:inline'>Refresh</span>
                </Button>
            }
        >
            <section className='grid grid-cols-1 gap-3 sm:grid-cols-2' aria-label='Inventory dashboard filters'>
                <SelectField id='inv-dashboard-warehouse' label='Warehouse' value={warehouseId}
                    onChange={e=>setWarehouseId(e.target.value)}>
                    <option value='all'>All accessible warehouses</option>
                    {(data?.warehouses||[]).map(w=>
                        <option key={w.id} value={w.id}>{w.name}{w.code&&w.code!==w.name?` (${w.code})`:''}</option>
                    )}
                </SelectField>
                <SelectField id='inv-dashboard-currency' label='Display currency' value={displayCurrency}
                    onChange={e=>setDisplayCurrency(e.target.value)}>
                    <option value=''>Legal entity local currencies (default)</option>
                    {(data?.currencies||[]).map(c=><option key={c.code} value={c.code}>{c.code}</option>)}
                </SelectField>
            </section>
            {loading&&<Spinner/>}
            {!loading&&error&&<Alert tone='error'>{error}</Alert>}
            {!loading&&!error&&data&&(
                <>
                    <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
                        <StatCard icon={<TrendingUp className='h-5 w-5'/>} title='Net stock value'>
                            {currencies.length?currencies.map(([currency,totals])=>
                                <Figure key={currency} value={money(totals.stockValue,currency)}
                                    caption={`${qty(totals.valued)} valued material locations`}/>
                            ):<Figure value='No valued stock'/>}
                            <p className='text-xs text-muted'>Net available stock × normalized cost per stock unit. Values from reconciled journals only.</p>
                            {!displayCurrency&&currencies.length>1&&<p className='text-xs text-muted'>Local currencies are shown separately. Select a common currency to combine them.</p>}
                        </StatCard>
                        <StatCard icon={<PackageOpen className='h-5 w-5'/>} title='Empty bins'>
                            <Figure value={qty(data.emptyBins)} caption={`Of ${qty(data.linkedBins)} linked material bin locations`}/>
                            <p className='text-xs text-muted'>A linked bin counts as empty only when its reconciled physical balance is zero.</p>
                        </StatCard>
                        <StatCard icon={<Boxes className='h-5 w-5'/>} title='Overstock'>
                            <Figure value={qty(data.overstockCount)} caption='Material locations above configured maximum'/>
                            {currencies.map(([currency,totals])=>
                                <p key={currency} className='break-words text-base font-semibold tabular-nums text-ink'>
                                    {money(totals.overstockValue,currency)} excess value
                                </p>
                            )}
                            {!!data.withoutMaximum&&<p className='text-xs text-muted'>{qty(data.withoutMaximum)} tracked locations have no maximum level configured.</p>}
                        </StatCard>
                    </div>
                    <section className='rounded-2xl border border-line bg-panel p-4' aria-label='Stock quantities by unit of measure'>
                        <h2 className='font-semibold text-ink'>Stock quantities by unit of measure</h2>
                        <p className='mt-1 text-xs text-muted'>Quantities with different units cannot be added together. Overstock is physical quantity above the configured maximum.</p>
                        {uomValues.length?
                            <div className='mt-3 space-y-2'>
                                {uomValues.map(x=>
                                    <div key={x.uom} className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-2 text-sm'>
                                        <span className='font-medium text-ink'>{x.uom}</span>
                                        <span className='tabular-nums text-ink'>{qty(x.netAvailable)} net available
                                            {x.overstockQuantity>0&&<span className='ml-2 text-amber-600'>· {qty(x.overstockQuantity)} excess</span>}
                                        </span>
                                    </div>
                                )}
                            </div>:<p className='mt-3 text-sm text-muted'>No reconciled material quantities in the selected scope.</p>
                        }
                    </section>
                    {(data.unvalued>0||data.unreconciled>0||data.notTracked>0)&&(
                        <Alert tone='warn'>
                            Valued {qty(data.valued)} of {qty(data.totalRows)} material locations.
                            {data.unvalued>0?` ${qty(data.unvalued)} could not be valued.`:''}
                            {data.missingExchangeRate>0?` ${qty(data.missingExchangeRate)} need a configured exchange rate for the selected display currency.`:''}
                            {data.unreconciled>0?` ${qty(data.unreconciled)} have unreconciled journals.`:''}
                            {data.notTracked>0?` ${qty(data.notTracked)} have no stock journal yet.`:''}
                            {' '}Displayed totals exclude these unvalued balances.
                        </Alert>
                    )}
                </>
            )}
        </Screen>
    );
}
