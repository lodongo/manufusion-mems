import { useEffect, useState } from 'react';
import { Activity, CalendarCheck, Coins, Plus, ScrollText, Trash2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import { Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { useConfirm } from '../components/screen';
import { Card, FIN_API, FinScreen, Facts, Pending, Pill, go, useEntity, type Entity } from './finKit';

type Section = 'status' | 'calendar' | 'authority' | 'roles';

// Finance setup of a legal entity: the financial calendar rules every year is generated from (calendar type such as
// 4-4-5, first month of the year, last day of the week, how the year end is fixed), the year-end adjustment period,
// the finance chart of authority (approval levels by amount) and the finance status of the legal entity (go live,
// block posting, close). Every change is proposed by one person and approved by another.

interface Settings {
    calendarType: string;
    yearStartMonth: number;
    yearNaming: 'start' | 'end';
    weekEndDay: number;
    yearEndRule: 'last' | 'nearest' | 'on_or_after';
    specialPeriods: number;
    extraWeekPeriod: number;
    customWeeks: number[];
    authority: Array<{ from: number; to: number | null; levels: string[] }>;
}
interface SetupData {
    le: { id: string; code: string; name: string; nodeCurrency: string; fiscalYearStart: string };
    status: string;
    statusLabel: string;
    statusHistory: Array<{ at: string; from: string; to: string; byName: string }>;
    functionalCurrency: string;
    goLiveAt: string;
    settings: Settings | null;
    settingsVersion: number;
    settingsApprovedAt: string;
    defaults: Settings;
    calendarTypes: Array<{ code: string; label: string; note: string }>;
    weekdays: string[];
    levels: Array<{ code: string; title: string; mapped: boolean }>;
    statuses: Record<string, string>;
    goLiveProblems: string[];
    pending: Array<{ id: string; typeLabel: string; title: string; makerName: string }>;
    can: Record<string, boolean>;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function Body({ le, onEntityChange, section }: { le: Entity; onEntityChange: () => void; section: Exclude<Section, 'roles'> }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<SetupData>(`${FIN_API}/setup/get`, { leId: le.id }), [le.id]);
    const [s, setS] = useState<Settings | null>(null);
    const [customText,setCustomText] = useState('');
    const [msg, setMsg] = useState('');
    const confirm = useConfirm();
    useEffect(() => {
        if (data) {
            const saved=JSON.parse(JSON.stringify(data.settings ?? data.defaults)) as Settings;
            setS(saved);
            setCustomText((saved.customWeeks??[4,4,5,4,4,5,4,4,5,4,4,5]).join(', '));
        }
    }, [data]);
    if (loading && !data) return <Spinner />;
    if (error || !data || !s) return <Alert tone='error'>{error || 'Could not load the setup.'}</Alert>;
    const d = data;
    const type = d.calendarTypes.find((c) => c.code === s.calendarType);
    const weekBased = s.calendarType !== 'month';
    const canEdit = d.can.setup_manage;
    const set = (p: Partial<Settings>) => setS({ ...s, ...p });
    const bands = s.authority;
    const setBand = (i: number, p: Partial<Settings['authority'][number]>) => set({ authority: bands.map((b, k) => (k === i ? { ...b, ...p } : k === i + 1 && p.to !== undefined ? { ...b, from: p.to ?? b.from } : b)) });
    const problems: string[] = [];
    const customParts=customText.split(',').map(x=>Number(x.trim()));
    const customValid=customParts.length>0&&customParts.length<=52&&customParts.every(n=>Number.isInteger(n)&&n>0&&n<=52)&&customParts.reduce((sum,n)=>sum+n,0)===52;
    if(s.calendarType==='custom'&&!customValid)problems.push('Custom period weeks must be positive whole numbers totaling 52.');
    bands.forEach((b, i) => {
        if (!b.levels.length) problems.push(`Band ${i + 1} needs at least one approval level.`);
        if (i < bands.length - 1 && (b.to === null || b.to <= b.from)) problems.push(`Band ${i + 1} must end above where it starts.`);
        if (i > 0 && b.levels.length < bands[i - 1].levels.length) problems.push(`Band ${i + 1} cannot need fewer approvers than band ${i}.`);
    });
    const changed = JSON.stringify(s) !== JSON.stringify(d.settings);
    const propose = () =>
        confirm.ask(
            { title: 'Propose finance setup', message: `${type?.label}. The year starts in ${MONTHS[s.yearStartMonth - 1]}. A second person with FIN.setup.approve must approve it. Years already initialised keep their dates; new years follow on without a gap.`, confirmLabel: 'Propose', acknowledge: 'The calendar rules match our financial policy and statutory reporting year.', reason: { label: 'Reason', minLength: 10 } },
            async (reason) => {
                await callBackend(`${FIN_API}/setup/propose`, { leId: le.id, settings: s, reason, confirm: true });
                setMsg('Proposed. It applies once approved.');
                reload();
            }
        );
    const status = (to: string, label: string) =>
        confirm.ask({ title: label, message: to === 'active' ? 'From the go-live, every receipt, acceptance, issue and stock count of this legal entity must post to its journal, or it is refused.' : to === 'posting_blocked' ? 'No new postings until it is live again; operations that must post are refused.' : 'The legal entity stops taking postings. Every period must be closed first.', confirmLabel: 'Propose', tone: to === 'active' ? 'primary' : 'danger', reason: { label: 'Reason', minLength: 15 } }, async (reason) => {
            await callBackend(`${FIN_API}/le/status`, { leId: le.id, to, reason });
            setMsg('Proposed. It applies once approved.');
            reload();
            onEntityChange();
        });
    return (
        <>
            {msg && <Alert tone='success'>{msg}</Alert>}
            <Pending items={d.pending} />
            {section === 'status' && (
            <Card title='Finance status of the legal entity' right={<Pill status={d.status} label={d.statusLabel} />}>
                <Facts rows={[['Functional currency', d.functionalCurrency || `${d.le.nodeCurrency || 'not set'} (fixed at go-live)`], ['Went live', d.goLiveAt ? fmtDate(d.goLiveAt) : 'Not yet'], ['Setup version', d.settingsVersion ? `${d.settingsVersion}, approved ${fmtDate(d.settingsApprovedAt)}` : 'Not approved yet']]} />
                {d.status !== 'active' && d.goLiveProblems.length > 0 && (
                    <div className='rounded-lg bg-amber-500/10 p-3 text-xs text-amber-200'>
                        <p className='font-semibold'>Before going live:</p>
                        <ul className='list-disc pl-5'>
                            {d.goLiveProblems.map((p) => (
                                <li key={p}>{p}</li>
                            ))}
                        </ul>
                    </div>
                )}
                {canEdit && (
                    <div className='flex flex-wrap gap-2'>
                        {d.status !== 'active' && (
                            <Button disabled={d.goLiveProblems.length > 0} onClick={() => status('active', d.status === 'not_live' ? 'Go live' : 'Reopen for posting')}>
                                {d.status === 'not_live' ? 'Propose go-live' : 'Propose reopening'}
                            </Button>
                        )}
                        {d.status === 'active' && (
                            <Button variant='secondary' onClick={() => status('posting_blocked', 'Block posting')}>
                                Propose blocking posting
                            </Button>
                        )}
                        {['active', 'posting_blocked'].includes(d.status) && (
                            <Button variant='danger' onClick={() => status('closed', 'Close the legal entity')}>
                                Propose closing
                            </Button>
                        )}
                    </div>
                )}
                {d.statusHistory.length > 0 && (
                    <ul className='text-xs text-muted'>
                        {d.statusHistory.map((h, i) => (
                            <li key={i}>
                                {fmtDate(h.at)}: {h.from} to {h.to} ({h.byName})
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
            )}

            {section === 'calendar' && (
            <Card title='Financial calendar rules'>
                <SelectField id='fs-type' label='Financial year type' value={s.calendarType} disabled={!canEdit} onChange={(e) => set({ calendarType: e.target.value })} hint={type?.note}>
                    {d.calendarTypes.map((c) => (
                        <option key={c.code} value={c.code}>
                            {c.label}
                        </option>
                    ))}
                </SelectField>
                <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                    <SelectField id='fs-start' label='Year starts in' value={String(s.yearStartMonth)} disabled={!canEdit} onChange={(e) => set({ yearStartMonth: Number(e.target.value) })} hint={weekBased ? 'Week-based years start the day after the previous year ends.' : 'The year starts on the 1st of this month.'}>
                        {MONTHS.map((m, i) => (
                            <option key={m} value={i + 1}>
                                {m}
                            </option>
                        ))}
                    </SelectField>
                    <SelectField id='fs-name' label='A year is named by the calendar year it' value={s.yearNaming} disabled={!canEdit} onChange={(e) => set({ yearNaming: e.target.value as Settings['yearNaming'] })} hint={s.yearStartMonth === 1 ? 'With a January start, both are the same.' : `FY 2026 ${s.yearNaming === 'start' ? `starts in ${MONTHS[s.yearStartMonth - 1]} 2026` : `ends in ${MONTHS[(s.yearStartMonth + 10) % 12]} 2026`}.`}>
                        <option value='start'>starts in</option>
                        <option value='end'>ends in</option>
                    </SelectField>
                    {weekBased && (
                        <>
                            <SelectField id='fs-wd' label='Last day of the week' value={String(s.weekEndDay)} disabled={!canEdit} onChange={(e) => set({ weekEndDay: Number(e.target.value) })}>
                                {d.weekdays.map((w, i) => (
                                    <option key={w} value={i}>
                                        {w}
                                    </option>
                                ))}
                            </SelectField>
                            <SelectField id='fs-rule' label='The year ends on' value={s.yearEndRule} disabled={!canEdit} onChange={(e) => set({ yearEndRule: e.target.value as Settings['yearEndRule'] })} hint='Nearest keeps the year end within 3 days of the month end (52/53-week year, as in ISO and the retail 4-5-4 calendar).'>
                                <option value='nearest'>the {d.weekdays[s.weekEndDay]} nearest to the end of {MONTHS[(s.yearStartMonth + 10) % 12]}</option>
                                <option value='last'>the last {d.weekdays[s.weekEndDay]} on or before {MONTHS[(s.yearStartMonth + 10) % 12]} end</option>
                                <option value='on_or_after'>the first {d.weekdays[s.weekEndDay]} on or after {MONTHS[(s.yearStartMonth + 10) % 12]} end</option>
                            </SelectField>
                        </>
                    )}
                    {s.calendarType === 'custom' && (
                        <label className='block text-sm sm:col-span-2'>Custom weeks per period (comma-separated, total 52)
                            <input value={customText} disabled={!canEdit} onChange={e=>{
                                const value=e.target.value;
                                setCustomText(value);
                                const next=value.split(',').map(x=>Number(x.trim()));
                                if(next.length>0&&next.length<=52&&next.every(n=>Number.isInteger(n)&&n>0&&n<=52)&&next.reduce((sum,n)=>sum+n,0)===52)
                                    set({customWeeks:next,extraWeekPeriod:0});
                            }} className='mt-1 w-full rounded-xl border border-line bg-panel p-3 text-base text-ink'
                                placeholder='4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5'/>
                            <span className='block text-xs text-muted'>Enter complete weeks for each accounting period. Leap days are handled by financial-year boundaries.</span>
                        </label>
                    )}
                    {weekBased && s.calendarType !== 'weekly' && (
                        <SelectField id='fs-extra-week' label='53rd week allocation' value={String(s.extraWeekPeriod ?? 0)} disabled={!canEdit} onChange={e=>set({extraWeekPeriod:Number(e.target.value)})} hint='Only used when the boundary rule generates a 53-week year. Automatic assigns the final period.'>
                            <option value='0'>Automatic: last period</option>
                            {Array.from({length:s.calendarType==='13x4'?13:s.calendarType==='quarterly'?4:s.calendarType==='custom'?(s.customWeeks?.length||1):12},(_,i)=><option key={i+1} value={i+1}>Period {i+1}</option>)}
                        </SelectField>
                    )}
                    <SelectField id='fs-sp' label='Year-end adjustment period' value={String(s.specialPeriods)} disabled={!canEdit} onChange={(e) => set({ specialPeriods: Number(e.target.value) })} hint='An extra period dated on the last day of the year, used for the year-end close and audit adjustments.'>
                        <option value='1'>Yes, one adjustment period</option>
                        <option value='0'>No</option>
                    </SelectField>
                </div>
                {weekBased && <p className='text-xs text-muted'>A week-based year has 52 weeks, or 53 when the year-end rule needs it; the extra week is allocated to the configured period. The dates of every period are shown before a year is initialised and must be confirmed.</p>}
                {d.le.fiscalYearStart && <p className='text-xs text-muted'>The legal entity record says its financial year starts: {d.le.fiscalYearStart}.</p>}
            </Card>
            )}

            {section === 'authority' && (
            <Card title='Finance chart of authority' right={<span className='text-xs text-muted'>{d.functionalCurrency || d.le.nodeCurrency}</span>}>
                <p className='text-xs text-soft'>Postings that need approval (reconciliation adjustments, reallocations, opening stock valuation, year-end close) are approved level by level. Levels are the same L1 to L6 job roles as the procurement chart of authority; L1 is the proposer's manager unless mapped.</p>
                <div className='space-y-2'>
                    {bands.map((b, i) => (
                        <div key={i} className='space-y-2 rounded-xl border border-line p-2'>
                            <div className='flex items-end gap-2'>
                                <Field id={`fb-f-${i}`} label='From' inputMode='decimal' value={String(b.from)} disabled />
                                <Field id={`fb-t-${i}`} label={i === bands.length - 1 ? 'To (no limit)' : 'Up to'} inputMode='decimal' value={b.to === null ? '' : String(b.to)} disabled={!canEdit || i === bands.length - 1} onChange={(e) => setBand(i, { to: e.target.value === '' ? null : Number(e.target.value.replace(/[^\d.]/g, '')) })} />
                                {canEdit && bands.length > 1 && (
                                    <button type='button' aria-label='Remove band' onClick={() => set({ authority: bands.filter((_, k) => k !== i).map((x, k, arr) => ({ ...x, from: k === 0 ? 0 : arr[k - 1].to ?? 0, to: k === arr.length - 1 ? null : x.to })) })} className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line text-soft'>
                                        <Trash2 className='h-4 w-4' />
                                    </button>
                                )}
                            </div>
                            <div className='flex flex-wrap gap-1'>
                                {d.levels.map((l) => {
                                    const on = b.levels.includes(l.code);
                                    return (
                                        <button key={l.code} type='button' disabled={!canEdit} onClick={() => setBand(i, { levels: (on ? b.levels.filter((x) => x !== l.code) : [...b.levels, l.code]).sort() })} className={`min-h-11 rounded-full px-3 text-xs ${on ? 'bg-brand text-onbrand' : 'border border-line text-soft'}`}>
                                            {l.code} {l.title}
                                            {!l.mapped && l.code !== 'L1' ? ' (not mapped)' : ''}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
                {canEdit && bands.length < 10 && (
                    <Button variant='secondary' onClick={() => { const last = bands[bands.length - 1]; const from = last.from; set({ authority: [...bands.slice(0, -1), { ...last, to: from + 1_000_000 }, { from: from + 1_000_000, to: null, levels: [...last.levels] }] }); }}>
                        <Plus className='h-4 w-4' /> Add a band
                    </Button>
                )}
            </Card>
            )}
            {canEdit && (section === 'calendar' || section === 'authority') && (
                <div className='space-y-2'>
                    {problems.length > 0 && <Alert tone='warn'>{problems.join(' ')}</Alert>}
                    <Button disabled={!changed || problems.length > 0} onClick={propose}>
                        Propose these settings
                    </Button>
                    {!changed && <p className='text-xs text-muted'>No changes to propose.</p>}
                </div>
            )}
            {confirm.sheet}
        </>
    );
}

interface Rules {
    template: string;
    name: string;
    purpose: string;
    audience: string;
    allows: string;
    never: string;
    limits: string;
    rules: string;
}
interface RoleRow {
    id: string;
    name: string;
    finance: string[];
    jobRoles: string[];
    holders: number;
    doc: { version: number; updatedAt: string; purpose: string } | null;
    canEdit: boolean;
    recommended: (Rules & { match: number }) | null;
}

function RulesView({ r }: { r: Rules }) {
    return (
        <div className='space-y-2 text-sm'>
            <Facts rows={[['Purpose', r.purpose], ['Who should hold it', r.audience], ['What it allows', r.allows], ['Never combine with', r.never], ['Approval and cost limits', r.limits]]} />
            <div>
                <p className='text-xs font-semibold uppercase tracking-wider text-muted'>Rules for the people who hold it</p>
                <p className='whitespace-pre-line text-soft'>{r.rules}</p>
            </div>
        </div>
    );
}

/** Finance security roles with their recommended written rules; applying them saves the role's rules (new version, audited). */
function RolesRules() {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ roles: RoleRow[]; missing: Array<Rules & { permissions: string[] }>; manages: boolean }>(`${FIN_API}/roles/list`));
    const [msg, setMsg] = useState('');
    const confirm = useConfirm();
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the finance roles.'}</Alert>;
    const nextYear = () => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        return d.toISOString().slice(0, 10);
    };
    const apply = (r: RoleRow) =>
        confirm.ask(
            { title: `${r.doc ? 'Replace' : 'Write'} the rules of ${r.name}`, message: `The recommended rules for ${r.recommended!.name} become the written rules of the security role ${r.name} (version ${(r.doc?.version ?? 0) + 1}, review in a year). They guide people; they never change access.`, confirmLabel: r.doc ? 'Replace rules' : 'Save rules', acknowledge: 'I have read the recommended rules and they fit how this role is used here.', reason: { label: 'Reason', minLength: 10 } },
            async (reason) => {
                const rec = r.recommended!;
                await callBackend('/api/org/roles/docs/save', { id: r.id, purpose: rec.purpose, audience: rec.audience, allows: rec.allows, never: rec.never, limits: rec.limits, rules: rec.rules, nextReview: nextYear(), expectedVersion: r.doc?.version ?? 0, reason });
                setMsg(`Written rules saved for ${r.name}.`);
                reload();
            }
        );
    return (
        <>
            {msg && <Alert tone='success'>{msg}</Alert>}
            <p className='text-xs text-soft'>Security roles that carry finance rights, the job roles (ROL_) they are mapped to, and the recommended written rules for each. Rules guide the people who hold the role; access itself comes only from the role's permissions. Rules apply to every legal entity.</p>
            {!data.roles.length && <Alert tone='warn'>No security role carries finance rights yet. Create them from the recommended finance templates in Organization admin › Security roles.</Alert>}
            {data.roles.map((r) => (
                <Card key={r.id} title={r.name} right={<Pill status={r.doc ? 'approved' : 'pending'} label={r.doc ? `Written rules v${r.doc.version}` : 'No written rules'} />}>
                    <Facts rows={[['Security role', r.id], ['Finance rights', r.finance.join(', ')], ['Job roles', r.jobRoles.join('; ') || 'Not mapped to a job role'], ['People holding it', String(r.holders)]]} />
                    {r.recommended ? (
                        <details className='rounded-xl border border-line p-2'>
                            <summary className='flex min-h-11 cursor-pointer items-center text-sm font-medium text-ink'>
                                Recommended rules: {r.recommended.name} ({r.recommended.match}% match)
                            </summary>
                            <RulesView r={r.recommended} />
                        </details>
                    ) : (
                        <p className='text-xs text-muted'>No recommended rules match this role.</p>
                    )}
                    {r.recommended && r.canEdit && (
                        <Button variant={r.doc ? 'secondary' : 'primary'} onClick={() => apply(r)}>
                            {r.doc ? 'Replace with the recommended rules' : 'Use the recommended rules'}
                        </Button>
                    )}
                    {r.recommended && !r.canEdit && <p className='text-xs text-muted'>Saving rules needs the right to manage security roles and to hold this role's rights yourself.</p>}
                </Card>
            ))}
            {data.missing.length > 0 && (
                <Card title='Recommended finance roles not created yet' tone='warn'>
                    <p className='text-xs text-soft'>Create these from the recommended templates in Organization admin › Security roles, map them to job roles (ROL_), then come back here to write their rules.</p>
                    {data.missing.map((m) => (
                        <details key={m.template} className='rounded-xl border border-line p-2'>
                            <summary className='flex min-h-11 cursor-pointer items-center text-sm font-medium text-ink'>{m.name}</summary>
                            <p className='mb-2 text-xs text-muted'>Rights: {m.permissions.join(', ')}</p>
                            <RulesView r={m} />
                        </details>
                    ))}
                </Card>
            )}
            {confirm.sheet}
        </>
    );
}

export default function FinSetup() {
    const ent = useEntity();
    const [section, setSection] = useState<Section>('status');
    return (
        <FinScreen
            title='Finance setup'
            subtitle='Go-live, calendar rules, chart of authority and roles'
            onBack={() => go('module/FIN')}
            entityState={ent}
            nav={[{ value: 'status', label: 'Status and go-live', icon: Activity }, { value: 'calendar', label: 'Calendar rules', icon: CalendarCheck }, { value: 'authority', label: 'Chart of authority', icon: Coins }, { value: 'roles', label: 'Roles and rules', icon: ScrollText }]}
            navValue={section}
            onNav={setSection}
        >
            {(le) => (section === 'roles' ? <RolesRules /> : <Body le={le} onEntityChange={ent.reload} section={section} />)}
        </FinScreen>
    );
}
