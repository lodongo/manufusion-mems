import { useMemo, useState } from 'react';
import {callBackend} from '../lib/backend';
import RichTable, { type Column } from '../components/RichTable';
import { Screen, Segmented } from '../components/screen';
import { Badge, Button, Empty, Toggle } from './kit';
import { Breadcrumb, DetailRow, DetailSheet, GroupList, type Crumb } from './browse';

// MEMS staff administration › Modules › SAF › Metadata › <list> (e.g. Hazards master). Read-only.
// Browse Category → Subcategory → Entry (or every entry in one table) and tap an entry for its description.
// Disabled entries are hidden unless "Include disabled" is on.

type Item = { code: string; label: string; category?: string; subcategory?: string; description?: string; active?: boolean; color?:string };

type View = 'browse' | 'all';

const catOf = (x: Item) => x.category || 'Other';
const subOf = (x: Item) => x.subcategory || 'General';
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export default function SafMetadataBrowser({ title, items, onCancel, canWrite=false, hazardColors=false }: { title: string; items: Item[]; onCancel: () => void; canWrite?:boolean; hazardColors?:boolean }) {
    const [colors,setColors]=useState<Record<string,string>>(()=>Object.fromEntries(items.map(x=>[catOf(x),x.color||'#D97706'])));
    const [saving,setSaving]=useState(false),[colorError,setColorError]=useState(''),[colorNotice,setColorNotice]=useState('');
    const saveColor=async(c:string)=>{setSaving(true);setColorError('');setColorNotice('');try{await callBackend('/api/admin/modules/metadata/hazard-colors',{category:c,color:colors[c]});setColorNotice(c+' color saved.');}catch(e){setColorError(e instanceof Error?e.message:'Unable to save color.');}finally{setSaving(false);}};
    const [view, setView] = useState<View>('browse');
    const [category, setCategory] = useState('');
    const [subcategory, setSubcategory] = useState('');
    const [showDisabled, setShowDisabled] = useState(false);
    const [openCode, setOpenCode] = useState('');
    const noun = title === 'Hazards master' ? 'Hazard' : 'Entry';

    const filtered = useMemo(() => items.filter((x) => showDisabled || x.active !== false), [items, showDisabled]);
    const tree = useMemo(() => {
        const map = new Map<string, Map<string, Item[]>>();
        for (const x of filtered) {
            const subs = map.get(catOf(x)) ?? new Map<string, Item[]>();
            subs.set(subOf(x), [...(subs.get(subOf(x)) ?? []), x]);
            map.set(catOf(x), subs);
        }
        return map;
    }, [filtered]);
    const subsOf = (c: string) => tree.get(c) ?? new Map<string, Item[]>();
    const leafRows = category && subcategory ? subsOf(category).get(subcategory) ?? [] : [];
    const disabledCount = items.filter((x) => x.active === false).length;
    const opened = openCode ? items.find((x) => x.code === openCode) ?? null : null;

    const back = () => {
        if (view === 'browse' && subcategory) setSubcategory('');
        else if (view === 'browse' && category) setCategory('');
        else onCancel();
    };
    const toCategories = () => {
        setCategory('');
        setSubcategory('');
    };
    const trail: Crumb[] = [{ label: 'Categories', onClick: category ? toCategories : undefined }];
    if (category) trail.push({ label: category, onClick: subcategory ? () => setSubcategory('') : undefined });
    if (subcategory) trail.push({ label: subcategory });

    const columns: Array<Column<Item>> = [
        { key: 'code', label: 'Code', value: (x) => x.code, className: 'font-mono text-xs' },
        { key: 'label', label: noun, value: (x) => x.label, className: 'font-semibold text-ink' },
        { key: 'category', label: 'Category', value: catOf, hidden: view === 'browse' },
        { key: 'subcategory', label: 'Subcategory', value: subOf, hidden: view === 'browse' },
        { key: 'description', label: 'Description', value: (x) => x.description ?? '', className: 'text-muted' },
        {
            key: 'status',
            label: 'Status',
            value: (x) => (x.active === false ? 'Disabled' : 'Enabled'),
            render: (x) => <Badge tone={x.active === false ? 'danger' : 'brand'}>{x.active === false ? 'Disabled' : 'Enabled'}</Badge>,
        },
    ];
    const emptyHint = !showDisabled && disabledCount ? ' Turn on "Include disabled" to see disabled entries.' : '';

    const table = (rows: Item[], tableTitle: string) => (
        <RichTable
            id={view === 'all' ? 'admin.saf.metadata.all' : 'admin.saf.metadata'}
            title={tableTitle}
            columns={columns}
            rows={rows}
            rowKey={(x) => x.code}
            onRowClick={(x) => setOpenCode(x.code)}
            rowClassName={(x) => (x.active === false ? 'opacity-60' : '')}
            fileName={`saf-${slug(title)}${view === 'all' ? '' : `-${slug(subcategory)}`}`}
            height='h-[calc(100dvh-22rem)]'
            empty={`No ${showDisabled ? '' : 'enabled '}entries here.${emptyHint}`}
        />
    );

    return (
        <Screen
            title={title}
            eyebrow='SAF metadata'
            subtitle={`${plural(filtered.length, 'entry', 'entries')} shown · Category › Subcategory › ${noun} › Description`}
            onBack={back}
            toolbar={
                <div className='space-y-1'>
                    <div className='flex items-center gap-2'>
                        <div className='min-w-0 flex-1'>
                            <Segmented<View>
                                label='Metadata view'
                                value={view}
                                onChange={setView}
                                options={[
                                    { value: 'browse', label: 'Browse' },
                                    { value: 'all', label: 'All entries', count: filtered.length },
                                ]}
                            />
                        </div>
                        <label className='flex min-h-[44px] shrink-0 items-center gap-2 text-sm text-soft'>
                            <Toggle checked={showDisabled} onChange={setShowDisabled} label='Include disabled entries' />
                            <span>Include disabled</span>
                        </label>
                    </div>
                    {view === 'browse' && <Breadcrumb label='Metadata breadcrumb' trail={trail} />}
                </div>
            }
        >
            {hazardColors&&!category&&view==='browse'&&<div className='mb-3 space-y-3 rounded-xl border border-line bg-panel p-3'><p className='font-semibold text-ink'>Hazard category colors</p><p className='text-xs text-soft'>MEMS display palette inspired by international safety colors. These colors do not replace standardized signage or risk ratings.</p>{[...tree.keys()].sort().map(c=><div key={c} className='flex flex-wrap items-center gap-2 border-b border-line pb-2'><span className='min-w-0 flex-1 text-sm'>{c}</span><input aria-label={c+' color selector'} type='color' disabled={!canWrite} className='h-11 w-14 rounded-lg border border-line' value={/^#[0-9a-fA-F]{6}$/.test(colors[c]||'')?colors[c]:'#D97706'} onChange={e=>setColors(old=>({...old,[c]:e.target.value}))}/><input aria-label={c+' hex color'} disabled={!canWrite} className='w-24 rounded-lg border border-line bg-panel p-2 font-mono text-xs' value={colors[c]||''} onChange={e=>setColors(old=>({...old,[c]:e.target.value}))}/>{canWrite&&<Button variant='secondary' disabled={saving||!/^#[0-9a-fA-F]{6}$/.test(colors[c]||'')} onClick={()=>saveColor(c)}>Save</Button>}</div>)}{colorError&&<p role='alert' className='text-red-500'>{colorError}</p>}{colorNotice&&<p className='text-green-600'>{colorNotice}</p>}</div>}
            {filtered.length === 0 ? (
                <Empty>{items.length ? `No enabled entries in this list.${emptyHint}` : 'This list has no entries yet.'}</Empty>
            ) : view === 'all' ? (
                table(filtered, 'All entries')
            ) : !category ? (
                <GroupList
                    groups={[...tree.keys()].sort().map((c) => {
                        const subs = subsOf(c);
                        const count = [...subs.values()].reduce((n, list) => n + list.length, 0);
                        return { key: c, title: c, meta: `${plural(count, 'entry', 'entries')} · ${plural(subs.size, 'subcategory', 'subcategories')}` };
                    })}
                    onOpen={(c) => {
                        setCategory(c);
                        setSubcategory('');
                    }}
                />
            ) : !subcategory ? (
                subsOf(category).size === 0 ? (
                    <Empty>{`No ${showDisabled ? '' : 'enabled '}entries in ${category}.${emptyHint}`}</Empty>
                ) : (
                    <GroupList
                        groups={[...subsOf(category).entries()]
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([sub, list]) => ({ key: sub, title: sub, meta: plural(list.length, 'entry', 'entries') }))}
                        onOpen={setSubcategory}
                    />
                )
            ) : (
                table(leafRows, `${category} › ${subcategory}`)
            )}

            <DetailSheet
                open={!!opened}
                title={opened?.label ?? ''}
                eyebrow={opened?.code}
                onClose={() => setOpenCode('')}
                footer={
                    <Button variant='secondary' className='flex-1' onClick={() => setOpenCode('')}>
                        Close
                    </Button>
                }
            >
                {opened && (
                    <>
                        <p className='leading-relaxed text-ink'>{opened.description || 'No description configured.'}</p>
                        <div>
                            <DetailRow label='Category'>{catOf(opened)}</DetailRow>
                            <DetailRow label='Subcategory'>{subOf(opened)}</DetailRow>
                            <DetailRow label='Status'>
                                <Badge tone={opened.active === false ? 'danger' : 'brand'}>{opened.active === false ? 'Disabled' : 'Enabled'}</Badge>
                            </DetailRow>
                        </div>
                    </>
                )}
            </DetailSheet>
        </Screen>
    );
}
