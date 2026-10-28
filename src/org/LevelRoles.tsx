import { useMemo, useState } from 'react';
import { ArrowRight, Check, Layers, Shuffle } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field } from '../components/ui';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { Screen, messageOf, useConfirm } from '../components/screen';
import { ConfirmBox, StepSection } from './materialCreateUi';

// Standard level roles: one short ladder per module (Viewer … Administrator) instead of many single-purpose roles.
// Install levels for the modules your organization uses, then consolidate older roles into them. The server decides
// what may be installed or moved and audits every change; this screen only presents it.

interface Level {
    id: string; module: string; moduleName: string; rank: number; level: string; name: string; description: string; never: string;
    permissions: string[]; available: boolean; installed: boolean; grantable: boolean; users: number; jobRoles: string[];
}
interface Existing {
    id: string; name: string; permissions: number; users: number; jobRoles: string[];
    target: { id: string; name: string } | null; lost: string[]; gained: string[];
}
interface LevelsResponse { levels: Level[]; existing: Existing[]; canConsolidate: boolean; confirmPhrase: string }

const BASE = 'organization_admin/roles';

export default function LevelRoles() {
    const { data, error, loading, reload } = useLoad(() => callBackend<LevelsResponse>('/api/org/roles/levels'));
    const [tab, setTab] = useState<'levels' | 'consolidate'>('levels');
    const [picked, setPicked] = useState<string[]>([]);
    const [info, setInfo] = useState('');
    const [problem, setProblem] = useState('');
    const { ask, sheet } = useConfirm();
    const modules = useMemo(() => {
        const out = new Map<string, Level[]>();
        for (const l of data?.levels ?? []) out.set(l.module, [...(out.get(l.module) ?? []), l]);
        return [...out.entries()].map(([module, list]) => ({ module, name: list[0].moduleName, list: list.sort((a, b) => a.rank - b.rank) }));
    }, [data]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load level roles.'}</Alert>;

    const installable = (l: Level) => !l.installed && l.available && l.grantable;
    const install = () =>
        ask(
            { title: `Install ${picked.length} level role${picked.length === 1 ? '' : 's'}?`, message: 'Each level is created with its default rights and written rules. Nobody receives it until you map it to a job role or assign it to a user.', confirmLabel: 'Install' },
            async () => {
                const r = await callBackend<{ created: string[]; skipped: Array<{ id: string; reason: string }> }>('/api/org/roles/levels/install', { ids: picked });
                setInfo(`Installed ${r.created.length} level role(s).${r.skipped.length ? ` Skipped ${r.skipped.length}: ${r.skipped.map((x) => x.reason).join(' ')}` : ''}`);
                setPicked([]);
                reload();
            },
        );

    return (
        <Screen
            title='Standard level roles'
            subtitle='One ladder per module, from Viewer to Administrator, with maker-checker built in.'
            onBack={() => navigate(BASE)}
            actions={tab === 'levels' ? <Button onClick={install} disabled={!picked.length}>Install {picked.length || ''}</Button> : undefined}
            toolbar={
                <div role='tablist' className='grid grid-cols-2 gap-1 rounded-xl border border-line p-1'>
                    {([['levels', 'Levels', Layers], ['consolidate', `Consolidate (${data.existing.length})`, Shuffle]] as const).map(([k, label, Icon]) => (
                        <button key={k} role='tab' aria-selected={tab === k} type='button' onClick={() => { setTab(k); setInfo(''); setProblem(''); }}
                            className={`flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium ${tab === k ? 'bg-brand text-onbrand' : 'text-soft'}`}>
                            <Icon className='h-4 w-4' />{label}
                        </button>
                    ))}
                </div>
            }
        >
            {info && <Alert tone='success'>{info}</Alert>}
            {problem && <Alert tone='error'>{problem}</Alert>}
            {tab === 'levels' ? (
                <>
                    <div className='flex gap-2'>
                        <Button variant='secondary' className='flex-1' onClick={() => setPicked(data.levels.filter(installable).map((l) => l.id))}>Select all available</Button>
                        <Button variant='secondary' className='flex-1' onClick={() => setPicked([])}>Clear</Button>
                    </div>
                    {modules.map((m) => (
                        <StepSection key={m.module} title={m.name} hint={`${m.list.length} levels · ${m.list.filter((l) => l.installed).length} installed`}
                            aside={<span className='rounded-lg bg-page px-2 py-1 font-mono text-xs text-brand'>{m.module}</span>}>
                            <ol className='space-y-2'>
                                {m.list.map((l) => {
                                    const why = l.installed ? '' : !l.available ? 'Module not adopted' : !l.grantable ? 'Carries rights you do not hold' : '';
                                    const on = picked.includes(l.id);
                                    return (
                                        <li key={l.id} className={`rounded-xl border p-3 ${on ? 'border-brand bg-brand/5' : 'border-line bg-page'} ${why ? 'opacity-60' : ''}`}>
                                            <label className={`flex items-start gap-3 ${l.installed || why ? '' : 'cursor-pointer'}`}>
                                                {l.installed ? (
                                                    <span className='mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-onbrand'><Check className='h-3.5 w-3.5' /></span>
                                                ) : (
                                                    <input type='checkbox' className='mt-1 h-5 w-5 shrink-0 accent-emerald-500' disabled={!!why} checked={on} onChange={() => setPicked((p) => (on ? p.filter((x) => x !== l.id) : [...p, l.id]))} />
                                                )}
                                                <span className='min-w-0 flex-1'>
                                                    <span className='flex flex-wrap items-center gap-2'>
                                                        <span className='rounded bg-panel px-1.5 py-0.5 font-mono text-[10px] text-brand'>L{l.rank}</span>
                                                        <span className='text-sm font-semibold text-ink'>{l.name}</span>
                                                        {l.installed && <Badge tone='brand'>Installed</Badge>}
                                                        {why && <Badge tone='muted'>{why}</Badge>}
                                                    </span>
                                                    <span className='mt-1 block text-xs text-soft'>{l.description}</span>
                                                    <span className='mt-1 block text-xs text-amber-400'>{l.never}</span>
                                                    <span className='mt-1 block text-[11px] text-muted'>{l.permissions.length} permissions{l.installed ? ` · ${l.users} user(s) · ${l.jobRoles.length} job role(s)` : ''}</span>
                                                </span>
                                            </label>
                                            {l.installed && <button type='button' onClick={() => navigate(`${BASE}/${l.id}`)} className='mt-2 min-h-9 text-xs font-medium text-brand'>Open role</button>}
                                        </li>
                                    );
                                })}
                            </ol>
                        </StepSection>
                    ))}
                </>
            ) : (
                <Consolidate data={data} onDone={(m) => { setInfo(m); reload(); }} onError={setProblem} />
            )}
            {sheet}
        </Screen>
    );
}

function Consolidate({ data, onDone, onError }: { data: LevelsResponse; onDone: (m: string) => void; onError: (m: string) => void }) {
    const installedLevels = data.levels.filter((l) => l.installed && l.available);
    const [targets, setTargets] = useState<Record<string, string>>(() => Object.fromEntries(data.existing.filter((e) => e.target).map((e) => [e.id, e.target!.id])));
    const [picked, setPicked] = useState<string[]>([]);
    const [reason, setReason] = useState('');
    const [phrase, setPhrase] = useState('');
    const [acceptLoss, setAcceptLoss] = useState(false);
    const [tried, setTried] = useState(false);
    const [busy, setBusy] = useState(false);
    if (!data.canConsolidate) return <Alert tone='info'>Only an organization super admin can consolidate security roles.</Alert>;
    if (!installedLevels.length) return <Alert tone='info'>Install the level roles first (Levels tab). Older roles are then matched to the closest level.</Alert>;
    if (!data.existing.length) return <Alert tone='success'>There are no older roles left. Every security role is a standard level or a system role.</Alert>;
    const chosen = data.existing.filter((e) => picked.includes(e.id) && targets[e.id]);
    const losing = chosen.filter((e) => e.target?.id === targets[e.id] ? e.lost.length > 0 : true);
    const problems = [
        ...(chosen.length ? [] : ['Choose at least one role with a target level.']),
        ...(reason.trim().length >= 20 ? [] : ['Give a reason of at least 20 characters.']),
        ...(phrase.trim() === data.confirmPhrase ? [] : [`Type ${data.confirmPhrase} to confirm.`]),
        ...(losing.length && !acceptLoss ? ['Accept that holders of some roles lose rights the target level does not include.'] : []),
    ];
    const run = async () => {
        setTried(true);
        onError('');
        if (problems.length) return;
        setBusy(true);
        try {
            const r = await callBackend<{ done: Array<{ from: string; to: string; jobRoles: number; users: number }>; skipped: Array<{ id: string; reason: string }> }>('/api/org/roles/levels/consolidate', {
                moves: chosen.map((e) => ({ from: e.id, to: targets[e.id] })), reason: reason.trim(), confirmation: phrase.trim(), acceptLoss,
            });
            onDone(`${r.done.length} role(s) consolidated.${r.skipped.length ? ` ${r.skipped.length} skipped: ${r.skipped.map((x) => x.reason).join(' ')}` : ''}`);
            setPicked([]); setPhrase(''); setTried(false);
        } catch (e) {
            onError(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <>
            <StepSection title='Older roles' hint='Each role is matched to the lowest level of its module that covers its rights. Job roles and users holding it move to that level, then the older role is removed. Moves that would combine duties that must stay apart are refused.'>
                <div className='mb-2 flex gap-2'>
                    <Button variant='secondary' className='flex-1' onClick={() => setPicked(data.existing.filter((e) => targets[e.id]).map((e) => e.id))}>Select all matched</Button>
                    <Button variant='secondary' className='flex-1' onClick={() => setPicked([])}>Clear</Button>
                </div>
                <ul className='space-y-2'>
                    {data.existing.map((e) => {
                        const on = picked.includes(e.id);
                        const target = targets[e.id] ?? '';
                        const suggested = e.target?.id === target;
                        return (
                            <li key={e.id} className={`rounded-xl border p-3 ${on ? 'border-brand bg-brand/5' : 'border-line bg-page'}`}>
                                <label className='flex items-start gap-3'>
                                    <input type='checkbox' className='mt-1 h-5 w-5 shrink-0 accent-emerald-500' disabled={!target} checked={on} onChange={() => setPicked((p) => (on ? p.filter((x) => x !== e.id) : [...p, e.id]))} />
                                    <span className='min-w-0 flex-1'>
                                        <span className='block text-sm font-semibold text-ink'>{e.name}</span>
                                        <span className='block text-[11px] text-muted'>{e.permissions} permissions · {e.users} user(s) · {e.jobRoles.length} job role(s)</span>
                                    </span>
                                </label>
                                <div className='mt-2 flex items-center gap-2 pl-8'>
                                    <ArrowRight className='h-4 w-4 shrink-0 text-muted' />
                                    <select data-native-select='true' aria-label={`Target level for ${e.name}`} value={target} onChange={(ev) => setTargets((t) => ({ ...t, [e.id]: ev.target.value }))}
                                        className='min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-panel px-3 text-sm text-ink'>
                                        <option value=''>Choose a level</option>
                                        {installedLevels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                                    </select>
                                </div>
                                {suggested && (e.lost.length > 0 || e.gained.length > 0) && (
                                    <div className='mt-2 space-y-1 pl-8 text-[11px]'>
                                        {e.lost.length > 0 && <p className='text-red-400'>Would lose: {e.lost.join(', ')}</p>}
                                        {e.gained.length > 0 && <p className='text-amber-400'>Would gain: {e.gained.join(', ')}</p>}
                                    </div>
                                )}
                                {target && !suggested && <p className='mt-2 pl-8 text-[11px] text-amber-400'>Chosen manually: the server checks the rights lost and gained.</p>}
                            </li>
                        );
                    })}
                </ul>
            </StepSection>
            <StepSection title='Confirm' hint='Audited role by role. Users and job roles keep working throughout; access is recalculated within a minute.'>
                <div className='space-y-3'>
                    <Field id='lvl-reason' label='Reason (at least 20 characters)' maxLength={300} value={reason} error={tried && reason.trim().length < 20 ? 'At least 20 characters' : ''} onChange={(ev) => setReason(ev.target.value)} />
                    {losing.length > 0 && <ConfirmBox checked={acceptLoss} onChange={setAcceptLoss}>Holders of {losing.length} selected role(s) may lose rights the target level does not include.</ConfirmBox>}
                    <Field id='lvl-phrase' label={`Type ${data.confirmPhrase}`} autoComplete='off' value={phrase} error={tried && phrase.trim() !== data.confirmPhrase ? 'Type it exactly' : ''} onChange={(ev) => setPhrase(ev.target.value)} />
                    {tried && problems.length > 0 && <Alert tone='warn'>{problems[0]}</Alert>}
                    <Button busy={busy} onClick={() => void run()}>Consolidate {chosen.length || ''}</Button>
                </div>
            </StepSection>
            <p className='px-1 text-xs text-muted'>Tip: map level roles to job roles under Organization design so people get them through their position.</p>
        </>
    );
}
