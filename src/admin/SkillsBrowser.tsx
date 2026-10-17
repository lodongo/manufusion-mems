import { useMemo, useState } from 'react';
import { Save, Undo2, DatabaseZap } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Screen, Segmented, messageOf, useConfirm } from '../components/screen';
import { Badge, Button, Empty } from './kit';
import { Breadcrumb, DetailRow, DetailSheet, GroupList, TableToggle, type Crumb } from './browse';

// MEMS staff administration › Modules › HRM › Metadata › Skills master (HRM.skillsMaster).
// This is the list organisations pick skills from (module_workspaces/HRM/metadata/skillsMaster).
// Browse Category → Subcategory → Skill (or every skill in one table) and tap a skill for its description.
// Skills cannot be added, removed or recoded here. Staff with write access switch skills on or off; changes are
// kept locally (highlighted) and saved together with Save in the top bar, after a confirmation that shows how many
// skills get enabled and disabled. The server accepts up to 500 changes per save.

type Skill = { code: string; label: string; category?: string; subcategory?: string; description?: string; active?: boolean };

type View = 'browse' | 'all';

const MAX_CHANGES = 500;

const catOf = (s: Skill) => s.category || 'Other';
const subOf = (s: Skill) => s.subcategory || 'General';
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export default function SkillsBrowser({ items, canWrite, canReplace = false, onDone, onCancel }: { items: Skill[]; canWrite: boolean; canReplace?: boolean; onDone: () => void; onCancel: () => void }) {
    const [view, setView] = useState<View>('browse');
    const [category, setCategory] = useState('');
    const [subcategory, setSubcategory] = useState('');
    /** Pending status per skill code; only real changes (different from the saved status) are kept. */
    const [changes, setChanges] = useState<Record<string, boolean>>({});
    const [openCode, setOpenCode] = useState('');
    const [error, setError] = useState('');
    const [replacing, setReplacing] = useState(false);
    const confirm = useConfirm();

    const saved = (s: Skill) => s.active !== false;
    const isActive = (s: Skill) => changes[s.code] ?? saved(s);
    const setActive = (s: Skill, value: boolean) =>
        setChanges((prev) => {
            const next = { ...prev };
            if (value === saved(s)) delete next[s.code];
            else next[s.code] = value;
            return next;
        });

    // category → subcategory → skills
    const tree = useMemo(() => {
        const map = new Map<string, Map<string, Skill[]>>();
        for (const s of items) {
            const subs = map.get(catOf(s)) ?? new Map<string, Skill[]>();
            subs.set(subOf(s), [...(subs.get(subOf(s)) ?? []), s]);
            map.set(catOf(s), subs);
        }
        return map;
    }, [items]);
    const byCode = useMemo(() => new Map(items.map((s) => [s.code, s])), [items]);

    const changeList = Object.entries(changes);
    const enabling = changeList.filter(([, active]) => active).length;
    const disabling = changeList.length - enabling;
    const tooMany = changeList.length > MAX_CHANGES;
    const enabledCount = items.filter(isActive).length;
    const opened = openCode ? byCode.get(openCode) ?? null : null;

    const subsOf = (c: string) => tree.get(c) ?? new Map<string, Skill[]>();
    const leafRows = category && subcategory ? subsOf(category).get(subcategory) ?? [] : [];

    const leave = () => {
        if (!changeList.length) return onCancel();
        confirm.ask(
            {
                title: 'Discard unsaved changes?',
                message: `${plural(changeList.length, 'skill status change')} will be lost.`,
                confirmLabel: 'Discard and leave',
                tone: 'danger',
            },
            async () => onCancel(),
        );
    };

    const back = () => {
        if (view === 'browse' && subcategory) setSubcategory('');
        else if (view === 'browse' && category) setCategory('');
        else leave();
    };

    const save = () =>
        confirm.ask(
            {
                title: `Save ${plural(changeList.length, 'status change')}?`,
                message: (
                    <div className='space-y-2'>
                        <p>
                            {plural(enabling, 'skill')} enabled · {plural(disabling, 'skill')} disabled in HRM.skillsMaster, the list every organisation picks
                            skills from.
                        </p>
                        <ul className='max-h-48 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line'>
                            {changeList.map(([code, active]) => (
                                <li key={code} className='flex items-center justify-between gap-2 px-3 py-2'>
                                    <span className='min-w-0 truncate'>
                                        <span className='font-mono text-xs text-muted'>{code}</span> {byCode.get(code)?.label}
                                    </span>
                                    <Badge tone={active ? 'brand' : 'danger'}>{active ? 'Enable' : 'Disable'}</Badge>
                                </li>
                            ))}
                        </ul>
                    </div>
                ),
                confirmLabel: 'Save changes',
                acknowledge: disabling ? 'I understand disabled skills are switched off for every organisation using this list.' : undefined,
            },
            async () => {
                setError('');
                try {
                    await callBackend('/api/admin/modules/metadata/skills/status', { changes: changeList.map(([code, active]) => ({ code, active })) });
                } catch (err) {
                    setError(messageOf(err, 'Unable to save skill status.'));
                    throw err;
                }
                onDone();
            },
        );

    const freshStart = async () => {
        if (Object.keys(changes).length) {
            setError('Save or undo pending skill status changes before replacing the catalogue.');
            return;
        }
        const acknowledgement = window.prompt(
            `Replace all ${items.length} existing HRM skills with the new 2,600-skill universal master?\n\n` +
            'MEMS will back up the old catalogue first. Existing role references keep their legacy codes but should be reviewed.\n\n' +
            'Type REPLACE SKILLS MASTER to confirm:'
        );
        if (acknowledgement !== 'REPLACE SKILLS MASTER') return;
        setError('');
        setReplacing(true);
        try {
            const outcome = await callBackend<{success:boolean;total:number;categories:number;subcategories:number;backupId:string}>(
                '/api/admin/modules/metadata/skills/fresh-start', { confirm: acknowledgement });
            if (!outcome.success || outcome.total < 2000) throw new Error('Catalogue refresh could not be verified.');
            onDone();
        } catch (e) {
            setError(messageOf(e,'Could not replace Skills Master. The original catalogue remains available unless the server confirms success.'));
        } finally {
            setReplacing(false);
        }
    };

    const columns: Array<Column<Skill>> = [
        { key: 'code', label: 'Code', value: (s) => s.code, className: 'font-mono text-xs' },
        { key: 'label', label: 'Skill', value: (s) => s.label, className: 'font-semibold text-ink' },
        { key: 'category', label: 'Category', value: catOf, hidden: view === 'browse' },
        { key: 'subcategory', label: 'Subcategory', value: subOf, hidden: view === 'browse' },
        { key: 'description', label: 'Description', value: (s) => s.description ?? '', className: 'text-muted' },
        {
            key: 'status',
            label: 'Enabled',
            value: (s) => (isActive(s) ? 'Enabled' : 'Disabled') + (s.code in changes ? ' (unsaved)' : ''),
            render: (s) =>
                canWrite ? (
                    <TableToggle checked={isActive(s)} onChange={(v) => setActive(s, v)} label={`Enable ${s.label}`} />
                ) : (
                    <Badge tone={isActive(s) ? 'brand' : 'danger'}>{isActive(s) ? 'Enabled' : 'Disabled'}</Badge>
                ),
        },
    ];

    const toCategories = () => {
        setCategory('');
        setSubcategory('');
    };
    const trail: Crumb[] = [{ label: 'Categories', onClick: category ? toCategories : undefined }];
    if (category) trail.push({ label: category, onClick: subcategory ? () => setSubcategory('') : undefined });
    if (subcategory) trail.push({ label: subcategory });

    const table = (rows: Skill[], title: string) => (
        <RichTable
            id={view === 'all' ? 'admin.hrm.skills.all' : 'admin.hrm.skills'}
            title={title}
            columns={columns}
            rows={rows}
            rowKey={(s) => s.code}
            onRowClick={(s) => setOpenCode(s.code)}
            rowClassName={(s) => (s.code in changes ? 'bg-amber-500/10' : isActive(s) ? '' : 'opacity-60')}
            fileName={view === 'all' ? 'hrm-skills-master' : `hrm-skills-${slug(subcategory)}`}
            height={changeList.length ? 'h-[calc(100dvh-24rem)]' : 'h-[calc(100dvh-19rem)]'}
            empty='No skills in this subcategory.'
        />
    );

    return (
        <Screen
            title='Skills master'
            eyebrow='HRM.skillsMaster'
            subtitle={`${items.length} skills · ${enabledCount} enabled`}
            onBack={back}
            actions={
                <div className='flex flex-wrap items-center gap-2'>
                    {canReplace && <Button variant='secondary' busy={replacing} onClick={freshStart}>
                        <DatabaseZap className='h-4 w-4' /> Replace catalogue
                    </Button>}
                    {canWrite && <Button onClick={save} disabled={!changeList.length || tooMany || replacing}>
                        <Save className='h-4 w-4' />
                        Save{changeList.length ? ` (${changeList.length})` : ''}
                    </Button>}
                </div>
            }
            toolbar={
                <div className='space-y-1'>
                    <Segmented<View>
                        label='Skills view'
                        value={view}
                        onChange={setView}
                        options={[
                            { value: 'browse', label: 'Browse' },
                            { value: 'all', label: 'All skills', count: items.length },
                        ]}
                    />
                    {view === 'browse' && <Breadcrumb label='Skill breadcrumb' trail={trail} />}
                </div>
            }
        >
            {error && <Alert tone='error'>{error}</Alert>}
            {changeList.length > 0 && (
                <div className='flex items-center gap-2 rounded-lg bg-amber-500/10 p-2 pl-3 text-sm text-amber-300'>
                    <p role='status' className='min-w-0 flex-1'>
                        {plural(changeList.length, 'unsaved change')}: {enabling} to enable, {disabling} to disable. Save from the top bar.
                        {tooMany && ` Save at most ${MAX_CHANGES} changes at a time.`}
                    </p>
                    <Button variant='secondary' onClick={() => setChanges({})}>
                        <Undo2 className='h-4 w-4' />
                        Undo all
                    </Button>
                </div>
            )}

            {items.length === 0 ? (
                <Empty>No skills in this list. Load the HRM Skills Master defaults first.</Empty>
            ) : view === 'all' ? (
                table(items, 'All skills')
            ) : !category ? (
                <GroupList
                    groups={[...tree.keys()].sort().map((c) => {
                        const subs = subsOf(c);
                        const skills = [...subs.values()].flat();
                        return { key: c, title: c, meta: `${plural(skills.length, 'skill')} · ${plural(subs.size, 'subcategory', 'subcategories')} · ${skills.filter(isActive).length} enabled` };
                    })}
                    onOpen={(c) => {
                        setCategory(c);
                        setSubcategory('');
                    }}
                />
            ) : !subcategory ? (
                <GroupList
                    groups={[...subsOf(category).entries()]
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([sub, skills]) => ({ key: sub, title: sub, meta: `${plural(skills.length, 'skill')} · ${skills.filter(isActive).length} enabled` }))}
                    onOpen={setSubcategory}
                />
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
                            <DetailRow label='Saved status'>{saved(opened) ? 'Enabled' : 'Disabled'}</DetailRow>
                        </div>
                        {canWrite ? (
                            <div className='flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-line p-3'>
                                <span>
                                    <span className='block font-medium text-ink'>Enabled</span>
                                    <span className='block text-xs text-muted'>{opened.code in changes ? 'Unsaved change. Save from the top bar.' : 'Changes are saved with Save in the top bar.'}</span>
                                </span>
                                <TableToggle checked={isActive(opened)} onChange={(v) => setActive(opened, v)} label={`Enable ${opened.label}`} />
                            </div>
                        ) : (
                            <Badge tone={isActive(opened) ? 'brand' : 'danger'}>{isActive(opened) ? 'Enabled' : 'Disabled'}</Badge>
                        )}
                    </>
                )}
            </DetailSheet>
            {confirm.sheet}
        </Screen>
    );
}
