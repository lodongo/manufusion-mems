import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Screen, Segmented } from '../components/screen';
import { Badge, Button } from './kit';
import { Breadcrumb, DetailSheet, GroupList, type Crumb } from './browse';

// Utility supplies catalogue (AST.utilitySupplies): Category › Subcategory › Utility › Attributes.
// Used in two places:
//   MEMS staff administration › Modules › AST › Metadata (read-only browse, no onChoose)
//   Organisation › equipment utilities (EquipmentUtilities): onChoose adds the tapped utility to the equipment
// Tap a utility to see its description and attributes (and "Add this utility" when choosing).

type Attr = { code: string; key: string; label: string; type: string; unit: string; required: boolean; options: string[] };
export type Utility = { code: string; label: string; category: string; subcategory: string; description: string; active: boolean; attributes: Attr[] };

type View = 'browse' | 'all';

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const attrType = (a: Attr) => (a.type === 'select' ? `List: ${(a.options ?? []).join(', ')}` : a.type === 'number' ? 'Number' : 'Text');
/** Attributes of a utility (tolerates records saved without the list). */
const attrsOf = (x: Utility): Attr[] => x.attributes ?? [];

export default function UtilityBrowser({ items, onChoose, onBack }: { items: Utility[]; onChoose?: (x: Utility) => void; onBack: () => void }) {
    const [view, setView] = useState<View>('browse');
    const [cat, setCat] = useState('');
    const [sub, setSub] = useState('');
    const [openCode, setOpenCode] = useState('');

    const tree = useMemo(() => {
        const map = new Map<string, Map<string, Utility[]>>();
        for (const x of items) {
            const subs = map.get(x.category) ?? new Map<string, Utility[]>();
            subs.set(x.subcategory, [...(subs.get(x.subcategory) ?? []), x]);
            map.set(x.category, subs);
        }
        return map;
    }, [items]);
    const subsOf = (c: string) => tree.get(c) ?? new Map<string, Utility[]>();
    const leafRows = cat && sub ? subsOf(cat).get(sub) ?? [] : [];
    const opened = openCode ? items.find((x) => x.code === openCode) ?? null : null;

    const back = () => {
        if (view === 'browse' && sub) setSub('');
        else if (view === 'browse' && cat) setCat('');
        else onBack();
    };
    const toCategories = () => {
        setCat('');
        setSub('');
    };
    const trail: Crumb[] = [{ label: 'Categories', onClick: cat ? toCategories : undefined }];
    if (cat) trail.push({ label: cat, onClick: sub ? () => setSub('') : undefined });
    if (sub) trail.push({ label: sub });

    const columns: Array<Column<Utility>> = [
        { key: 'code', label: 'Code', value: (x) => x.code, className: 'font-mono text-xs' },
        { key: 'label', label: 'Utility', value: (x) => x.label, className: 'font-semibold text-ink' },
        { key: 'category', label: 'Category', value: (x) => x.category, hidden: view === 'browse' },
        { key: 'subcategory', label: 'Subcategory', value: (x) => x.subcategory, hidden: view === 'browse' },
        { key: 'attributes', label: 'Attributes', type: 'number', value: (x) => attrsOf(x).length },
        { key: 'required', label: 'Required', type: 'number', value: (x) => attrsOf(x).filter((a) => a.required).length, hidden: true },
        { key: 'description', label: 'Description', value: (x) => x.description, className: 'text-muted' },
        {
            key: 'status',
            label: 'Status',
            value: (x) => (x.active === false ? 'Disabled' : 'Enabled'),
            render: (x) => <Badge tone={x.active === false ? 'danger' : 'brand'}>{x.active === false ? 'Disabled' : 'Enabled'}</Badge>,
        },
    ];

    const table = (rows: Utility[], title: string) => (
        <RichTable
            id={view === 'all' ? 'admin.utilities.all' : 'admin.utilities'}
            title={title}
            columns={columns}
            rows={rows}
            rowKey={(x) => x.code}
            onRowClick={(x) => setOpenCode(x.code)}
            fileName='utility-supplies'
            height='h-[calc(100dvh-22rem)]'
            empty='No utilities in this subcategory.'
        />
    );

    return (
        <Screen
            title='Utility supplies'
            eyebrow='AST.utilitySupplies'
            subtitle={`${plural(items.length, 'utility', 'utilities')} · Category › Subcategory › Utility › Attributes`}
            onBack={back}
            toolbar={
                items.length > 0 && (
                    <div className='space-y-1'>
                        <Segmented<View>
                            label='Utilities view'
                            value={view}
                            onChange={setView}
                            options={[
                                { value: 'browse', label: 'Browse' },
                                { value: 'all', label: 'All utilities', count: items.length },
                            ]}
                        />
                        {view === 'browse' && <Breadcrumb label='Utility breadcrumb' trail={trail} />}
                    </div>
                )
            }
        >
            {items.length === 0 ? (
                <Alert tone='warn'>
                    {onChoose
                        ? 'No more utilities to add: every utility in the catalogue is already on this equipment, or the AST Utility supplies list has no records yet.'
                        : 'No utility records found in AST metadata. Load Utility supplies master defaults.'}
                </Alert>
            ) : view === 'all' ? (
                table(items, 'All utilities')
            ) : !cat ? (
                <GroupList
                    groups={[...tree.keys()].sort().map((c) => {
                        const subs = subsOf(c);
                        const count = [...subs.values()].reduce((n, list) => n + list.length, 0);
                        return { key: c, title: c, meta: `${plural(count, 'utility', 'utilities')} · ${plural(subs.size, 'subcategory', 'subcategories')}` };
                    })}
                    onOpen={(c) => {
                        setCat(c);
                        setSub('');
                    }}
                />
            ) : !sub ? (
                <GroupList
                    groups={[...subsOf(cat).entries()]
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([s, list]) => ({ key: s, title: s, meta: plural(list.length, 'utility', 'utilities') }))}
                    onOpen={setSub}
                />
            ) : (
                table(leafRows, `${cat} › ${sub}`)
            )}

            <DetailSheet
                open={!!opened}
                title={opened?.label ?? ''}
                eyebrow={opened ? `${opened.code} · ${opened.category} › ${opened.subcategory}` : undefined}
                onClose={() => setOpenCode('')}
                footer={
                    <>
                        <Button variant='secondary' className='flex-1' onClick={() => setOpenCode('')}>
                            Close
                        </Button>
                        {onChoose && opened && (
                            <Button className='flex-1' onClick={() => onChoose(opened)}>
                                <Plus className='h-4 w-4' />
                                Add this utility
                            </Button>
                        )}
                    </>
                }
            >
                {opened && (
                    <>
                        <p className='leading-relaxed text-ink'>{opened.description || 'No description configured.'}</p>
                        <h3 className='pt-1 text-xs font-semibold uppercase tracking-wide text-muted'>Attributes ({attrsOf(opened).length})</h3>
                        {attrsOf(opened).length === 0 ? (
                            <p className='text-muted'>No attributes configured.</p>
                        ) : (
                            <ul className='space-y-2'>
                                {attrsOf(opened).map((a) => (
                                    <li key={a.code} className='rounded-lg border border-line bg-page p-3'>
                                        <span className='block text-ink'>
                                            {a.label}
                                            {a.required && <span className='text-amber-300'> *</span>}
                                        </span>
                                        <span className='block text-xs text-muted'>
                                            {attrType(a)}
                                            {a.unit && ` · ${a.unit}`}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {attrsOf(opened).some((a) => a.required) && <p className='text-xs text-muted'>* required</p>}
                    </>
                )}
            </DetailSheet>
        </Screen>
    );
}
