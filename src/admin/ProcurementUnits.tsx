import { useMemo, useState } from 'react';
import { Save, Undo2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { InfoTip, Screen, messageOf, useConfirm } from '../components/screen';
import { Badge, Button } from './kit';
import { TableToggle } from './browse';

// MEMS staff administration › Modules › PRC › Metadata › Units of measure (PRC.unitsOfMeasure).
// Controlled conversion registry: 1 unit = multiplier × the category's base unit. Units cannot be added, removed
// or recoded here (the server refuses); staff with write access only switch units on or off. Changes are kept
// locally (highlighted) and saved together with Save in the top bar, after a confirmation listing how many units
// get enabled and disabled. The whole list is sent, as the server expects.

export interface UomEntry {
    code: string;
    label: string;
    symbol: string;
    category: string;
    categoryCode: string;
    system: string;
    baseUnit: string;
    multiplier: number;
    active: boolean;
    selectable: boolean;
    color: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function ProcurementUnits({ items, canWrite, onDone, onCancel }: { items: UomEntry[]; canWrite: boolean; onDone: () => void; onCancel: () => void }) {
    const [entries, setEntries] = useState(items);
    const [category, setCategory] = useState('');
    const [error, setError] = useState('');
    const confirm = useConfirm();

    const savedActive = useMemo(() => new Map(items.map((u) => [u.code, u.active !== false])), [items]);
    const categories = useMemo(() => [...new Set(entries.map((u) => u.category))].sort(), [entries]);
    const rows = category ? entries.filter((u) => u.category === category) : entries;
    const changed = entries.filter((u) => (u.active !== false) !== savedActive.get(u.code));
    const enabling = changed.filter((u) => u.active !== false);
    const disabling = changed.filter((u) => u.active === false);
    const enabledCount = entries.filter((u) => u.active !== false).length;

    const setActive = (code: string, active: boolean) => setEntries((prev) => prev.map((x) => (x.code === code ? { ...x, active } : x)));

    const leave = () => {
        if (!changed.length) return onCancel();
        confirm.ask(
            {
                title: 'Discard unsaved changes?',
                message: `${plural(changed.length, 'unit')} changed and not saved. Leaving discards these changes.`,
                confirmLabel: 'Discard and leave',
                tone: 'danger',
            },
            async () => onCancel(),
        );
    };

    const unitList = (list: UomEntry[], tone: 'brand' | 'danger', word: string) =>
        list.length > 0 && (
            <div>
                <p className='mb-1 font-medium text-ink'>
                    {word} ({list.length})
                </p>
                <ul className='max-h-32 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line'>
                    {list.map((u) => (
                        <li key={u.code} className='flex items-center justify-between gap-2 px-3 py-2'>
                            <span className='min-w-0 truncate'>
                                {u.label} <span className='font-mono text-xs text-muted'>{u.symbol}</span>
                            </span>
                            <Badge tone={tone}>{u.category}</Badge>
                        </li>
                    ))}
                </ul>
            </div>
        );

    const save = () =>
        confirm.ask(
            {
                title: `Save ${plural(changed.length, 'unit')} change${changed.length === 1 ? '' : 's'}?`,
                message: (
                    <div className='space-y-3'>
                        <p>
                            {plural(enabling.length, 'unit')} get enabled and {plural(disabling.length, 'unit')} get disabled in PRC.unitsOfMeasure. After saving,{' '}
                            {enabledCount} of {entries.length} units are enabled.
                        </p>
                        {unitList(enabling, 'brand', 'Enable')}
                        {unitList(disabling, 'danger', 'Disable')}
                    </div>
                ),
                confirmLabel: 'Save units',
                acknowledge: disabling.length ? 'I understand disabled units can no longer be chosen for new materials.' : undefined,
            },
            async () => {
                setError('');
                try {
                    await callBackend('/api/admin/modules/metadata/save', {
                        code: 'PRC',
                        list: {
                            key: 'unitsOfMeasure',
                            title: 'Units of measure',
                            description: 'Controlled conversion registry for procurement and materials.',
                            items: entries,
                        },
                    });
                } catch (err) {
                    setError(messageOf(err, 'Unable to save units of measure.'));
                    throw err;
                }
                onDone();
            },
        );

    const columns: Array<Column<UomEntry>> = [
        { key: 'code', label: 'Code', value: (u) => u.code, className: 'font-mono text-xs text-muted' },
        { key: 'label', label: 'Unit', value: (u) => u.label, className: 'font-medium text-ink' },
        { key: 'symbol', label: 'Symbol', value: (u) => u.symbol, className: 'font-mono text-brandsoft' },
        {
            key: 'category',
            label: 'Category',
            value: (u) => u.category,
            render: (u) => (
                <span className='flex items-center gap-2'>
                    <span className='inline-block h-2 w-2 shrink-0 rounded-full' style={{ background: u.color }} />
                    {u.category}
                </span>
            ),
        },
        { key: 'system', label: 'System', value: (u) => u.system },
        { key: 'base', label: 'Base', value: (u) => u.baseUnit, className: 'font-mono' },
        {
            key: 'multiplier',
            label: 'Multiplier',
            type: 'number',
            value: (u) => u.multiplier,
            render: (u) => <span className='font-mono'>{u.multiplier.toLocaleString('en-US', { maximumSignificantDigits: 14 })}</span>,
        },
        {
            key: 'active',
            label: 'Active',
            value: (u) => (u.active !== false ? 'Yes' : 'No'),
            render: (u) =>
                canWrite ? (
                    <TableToggle checked={u.active !== false} onChange={(v) => setActive(u.code, v)} label={`Enable ${u.label}`} />
                ) : (
                    <Badge tone={u.active !== false ? 'brand' : 'danger'}>{u.active !== false ? 'Yes' : 'No'}</Badge>
                ),
        },
    ];

    return (
        <Screen
            title='Units of measure'
            eyebrow='PRC.unitsOfMeasure'
            subtitle={`${entries.length} units · ${categories.length} categories · ${enabledCount} enabled`}
            onBack={leave}
            actions={
                canWrite && (
                    <Button onClick={save} disabled={!changed.length}>
                        <Save className='h-4 w-4' />
                        Save{changed.length ? ` (${changed.length})` : ''}
                    </Button>
                )
            }
            toolbar={
                <div className='flex items-start gap-2'>
                    <select
                        aria-label='Filter unit category'
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className='h-11 min-w-0 flex-1 rounded-xl border border-line bg-panel px-3 text-base text-ink focus:border-brand focus:outline-none'
                    >
                        <option value=''>All categories</option>
                        {categories.map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </select>
                    <InfoTip label='How multipliers work'>
                        Multiplier means: 1 selected unit = multiplier × base unit. Mass uses grams, volume uses litres. Absolute temperatures and variable pack sizes
                        need separate conversion rules.
                    </InfoTip>
                </div>
            }
        >
            {error && <Alert tone='error'>{error}</Alert>}
            {changed.length > 0 && (
                <div className='flex items-center gap-2 rounded-lg bg-amber-500/10 p-2 pl-3 text-sm text-amber-300'>
                    <p role='status' className='min-w-0 flex-1'>
                        {plural(changed.length, 'unsaved change')}: {enabling.length} to enable, {disabling.length} to disable. Save from the top bar.
                    </p>
                    <Button variant='secondary' onClick={() => setEntries(items)}>
                        <Undo2 className='h-4 w-4' />
                        Undo all
                    </Button>
                </div>
            )}
            <RichTable
                id='admin.procurement.units'
                title={category || 'All categories'}
                columns={columns}
                rows={rows}
                rowKey={(u) => u.code}
                rowClassName={(u) => ((u.active !== false) !== savedActive.get(u.code) ? 'bg-amber-500/10' : '')}
                fileName='units-of-measure'
                height={changed.length ? 'h-[calc(100dvh-20rem)]' : 'h-[calc(100dvh-16rem)]'}
                empty='No units of measure. Load the standard UOM catalogue first.'
            />
            {confirm.sheet}
        </Screen>
    );
}
