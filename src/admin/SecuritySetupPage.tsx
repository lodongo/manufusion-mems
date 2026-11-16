import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import { appConfirm } from '../components/dialogs';
import { Badge, Button, Card, PageTitle, Spinner, TextArea, useLoad } from './kit';

interface OverrideView {
    environmentAllowed: boolean;
    environment: string;
    phrase: string;
    maxHours: number;
    cleanupPhrase:string;
    cleanup:Array<{orgId:string;enabled:boolean;version:number;expiresAt:string;enabledByEmail:string;reason:string}>;
    override: {
        enabled: boolean;
        expired: boolean;
        orgIds: string[];
        expiresAt: string;
        reason: string;
        enabledByEmail: string;
        enabledAt: string;
        version: number;
        tenants: Array<{ orgId: string; name: string; active: boolean }>;
    };
}
interface TenantRow { id: string; name: string; domain: string; status: string }

const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString() : '');

/**
 * MEMS Admin > Security setup > Platform testing override.
 * Development only: lets the organization super admin of named tenants complete a workflow end to end alone.
 */
export default function SecuritySetupPage({ isSuper }: { isSuper: boolean }) {
    const { data, setData, error, loading, reload } = useLoad(() => callBackend<OverrideView>('/api/admin/security/testing-override'));
    const tenants = useLoad(() => callBackend<{ tenants: TenantRow[] }>('/api/admin/tenants/list'));
    const [chosen, setChosen] = useState<string[]>([]);
    const [hours, setHours] = useState('8');
    const [reason, setReason] = useState('');
    const [phrase, setPhrase] = useState('');
    const [offReason, setOffReason] = useState('');
    const [search, setSearch] = useState('');
    const [tried, setTried] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const [done, setDone] = useState('');

    const [clock,setClock]=useState(Date.now());
    useEffect(()=>{const t=window.setInterval(()=>setClock(Date.now()),1000);return()=>window.clearInterval(t);},[]);
    const active = !!data?.override.enabled && !data.override.expired && data.environmentAllowed && Date.parse(data.override.expiresAt)>clock;
    const [cleanupOrg,setCleanupOrg]=useState(''),[cleanupReason,setCleanupReason]=useState(''),[cleanupPhrase,setCleanupPhrase]=useState(''),[cleanupBusy,setCleanupBusy]=useState(false),[cleanupError,setCleanupError]=useState('');
    const cleanupTenant=data?.override.tenants.find(t=>t.orgId===cleanupOrg&&t.active);
    const cleanupState=data?.cleanup?.find(t=>t.orgId===cleanupOrg);
    const cleanupActive=!!(active&&cleanupState?.enabled&&Date.parse(cleanupState.expiresAt)>clock);
    const saveCleanup=async(enabled:boolean)=>{if(!data||!cleanupTenant)return;setCleanupError('');setCleanupBusy(true);try{const next=await callBackend<OverrideView>('/api/admin/security/database-cleanup/save',{orgId:cleanupOrg,enabled,reason:cleanupReason.trim(),confirmation:cleanupPhrase,expectedVersion:cleanupState?.version??0});setData(next);setClock(Date.now());setCleanupReason('');setCleanupPhrase('');}catch(e){setCleanupError(e instanceof Error?e.message:String(e));reload();}finally{setCleanupBusy(false);}};
    const list = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (tenants.data?.tenants ?? []).filter((t) => t.status === 'active' && (!q || `${t.name} ${t.domain} ${t.id}`.toLowerCase().includes(q)));
    }, [tenants.data, search]);

    const h = Number(hours);
    const errors = {
        tenants: chosen.length < 1 ? 'Choose at least one tenant.' : chosen.length > 20 ? 'Choose up to 20 tenants.' : '',
        hours: !Number.isInteger(h) || h < 1 || h > (data?.maxHours ?? 168) ? `Enter whole hours from 1 to ${data?.maxHours ?? 168}.` : '',
        reason: reason.trim().length < 20 ? 'Give a reason of at least 20 characters.' : '',
        phrase: phrase.trim() !== (data?.phrase ?? '') ? `Type ${data?.phrase ?? ''} exactly.` : '',
    };
    const invalid = Object.values(errors).some(Boolean);

    const save = async (enable: boolean) => {
        setFailure('');
        setDone('');
        if (enable) {
            setTried(true);
            if (invalid) return;
            if (!(await appConfirm(`Switch on test mode for ${chosen.length} tenant(s) for ${h} hour(s)? Maker-checker will be relaxed for their organization super admin.`))) return;
        } else {
            if (offReason.trim().length < 10) return setFailure('Give a reason of at least 10 characters for switching test mode off.');
        }
        setBusy(true);
        try {
            const next = await callBackend<OverrideView>('/api/admin/security/testing-override/save', enable
                ? { enabled: true, orgIds: chosen, hours: h, reason: reason.trim(), confirmation: phrase.trim(), expectedVersion: data?.override.version ?? 0 }
                : { enabled: false, reason: offReason.trim(), expectedVersion: data?.override.version ?? 0 });
            setData(next);
            setDone(enable ? 'Test mode is on. Every relaxed control is written to the audit trail of the tenant.' : 'Test mode is off. All controls are enforced again.');
            setPhrase('');
            setOffReason('');
            setTried(false);
        } catch (e) {
            setFailure(e instanceof Error ? e.message : String(e));
            reload();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
            <PageTitle title='Security setup' subtitle='Platform-wide security switches. Changes are audited and visible to the affected tenants.' />
            {error && <Alert tone='error'>{error}</Alert>}
            {loading && !data ? <Spinner /> : data && (
                <div className='space-y-4'>
                    <Card>
                        <div className='flex items-start gap-3'>
                            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/10 text-emerald-300'}`}>
                                {active ? <ShieldAlert className='h-5 w-5' /> : <ShieldCheck className='h-5 w-5' />}
                            </span>
                            <div className='min-w-0 flex-1'>
                                <div className='flex flex-wrap items-center gap-2'>
                                    <h2 className='text-base font-semibold text-white'>Platform testing override</h2>
                                    <Badge tone={active ? 'warn' : 'brand'}>{active ? 'On' : 'Off'}</Badge>
                                    <Badge tone={data.environmentAllowed ? 'muted' : 'danger'}>{data.environmentAllowed ? 'Development server' : 'Protected server'}</Badge>
                                </div>
                                <p className='mt-1 text-sm text-slate-400'>
                                    For development only. While on, the organization super admin of the chosen tenants can complete procurement
                                    (requirement to order, receipt and service acceptance) and maintenance (request to technical closure) alone:
                                    maker-checker, job-role holding and chart-of-authority position checks are relaxed for that one user.
                                    Status, quantity, money, stock and document checks are never relaxed, configuration is still required,
                                    and each relaxed control is audited.
                                </p>
                            </div>
                        </div>
                        {active && (
                            <dl className='mt-4 grid gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm sm:grid-cols-2'>
                                <div><dt className='text-xs text-slate-400'>Tenants</dt><dd className='text-white'>{data.override.tenants.map((t) => t.name).join(', ')}</dd></div>
                                <div><dt className='text-xs text-slate-400'>Ends</dt><dd className='text-white'>{fmt(data.override.expiresAt)}</dd></div>
                                <div><dt className='text-xs text-slate-400'>Switched on by</dt><dd className='text-white'>{data.override.enabledByEmail} · {fmt(data.override.enabledAt)}</dd></div>
                                <div><dt className='text-xs text-slate-400'>Reason</dt><dd className='break-words text-white'>{data.override.reason}</dd></div>
                            </dl>
                        )}
                        {data.override.enabled && data.override.expired && <p className='mt-3 text-sm text-slate-400'>The last override expired on {fmt(data.override.expiresAt)}. Controls are enforced.</p>}
                    </Card>


                    <Card>
                        <div className='flex items-start gap-3'>
                            <span className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400'><ShieldAlert className='h-5 w-5'/></span>
                            <div className='min-w-0 flex-1 space-y-2'>
                                <div className='flex flex-wrap items-center gap-2'><h2 className='text-base font-semibold text-white'>Database Cleanup Mode</h2><Badge tone={active&&data.cleanup?.some(c=>c.enabled&&Date.parse(c.expiresAt)>clock)?'danger':'muted'}>{active&&data.cleanup?.some(c=>c.enabled&&Date.parse(c.expiresAt)>clock)?'Enabled for selected tenant(s)':'Off'}</Badge></div>
                                <p className='text-sm text-slate-400'>Separate development-only permission for permanent maintenance test record deletion. Expires after a maximum of 60 minutes or when Test Mode ends. Organization Super Admin must still authorize the login and preview each deletion. Posted stock and financial records remain protected.</p>
                                {active&&data.cleanup?.filter(c=>c.enabled&&Date.parse(c.expiresAt)>clock).map(c=><p key={c.orgId} className='break-words text-xs text-red-300'>{data.override.tenants.find(t=>t.orgId===c.orgId)?.name||c.orgId} · Enabled until {fmt(c.expiresAt)} · {c.enabledByEmail}</p>)}
                            </div>
                        </div>
                        {!data.environmentAllowed?<Alert tone='info'>Unavailable outside isolated development.</Alert>:!active?<p className='mt-3 text-sm text-slate-400'>Switch Test Mode on for the intended tenant first.</p>:!isSuper?<p className='mt-3 text-sm text-slate-400'>Only a MEMS Super Admin may change this permission.</p>:<div className='mt-4 space-y-3'>
                            <SelectField id='cleanup-tenant' label='Tenant' value={cleanupOrg} disabled={cleanupBusy} onChange={e=>{setCleanupOrg(e.target.value);setCleanupReason('');setCleanupPhrase('');setCleanupError('');}}><option value=''>Choose a tenant in Test Mode</option>{data.override.tenants.filter(t=>t.active).map(t=><option key={t.orgId} value={t.orgId}>{t.name}</option>)}</SelectField>
                            {cleanupTenant&&<><p className='text-sm text-slate-300'>{cleanupActive?'Enabled until '+fmt(cleanupState?.expiresAt||''):'Disabled for this tenant'}</p><TextArea id='cleanup-reason' label='Reason (10–500 characters)' value={cleanupReason} onChange={e=>setCleanupReason(e.target.value)}/>{!cleanupActive&&<Field id='cleanup-confirm' label={'Type '+data.cleanupPhrase+' to confirm'} autoComplete='off' value={cleanupPhrase} onChange={e=>setCleanupPhrase(e.target.value)}/>}<Button variant='danger' busy={cleanupBusy} disabled={cleanupReason.trim().length<10||cleanupReason.trim().length>500||(!cleanupActive&&cleanupPhrase!==data.cleanupPhrase)} onClick={()=>void saveCleanup(!cleanupActive)}>{cleanupActive?'Disable Database Cleanup':'Enable Database Cleanup'}</Button></>}
                            {cleanupError&&<Alert tone='error'>{cleanupError}</Alert>}
                        </div>}
                    </Card>

                    {failure && <Alert tone='error'>{failure}</Alert>}
                    {done && <Alert tone='success'>{done}</Alert>}

                    {!isSuper ? (
                        <Alert tone='info'>Only a MEMS super admin can change the platform testing override.</Alert>
                    ) : !data.environmentAllowed ? (
                        <Alert tone='info'>This server is not the development environment, so test mode cannot be switched on here.</Alert>
                    ) : active ? (
                        <Card>
                            <h3 className='text-sm font-semibold text-white'>Switch test mode off now</h3>
                            <div className='mt-3 space-y-3'>
                                <TextArea id='off-reason' label='Reason' value={offReason} onChange={(e) => setOffReason(e.target.value)} placeholder='Testing finished' />
                                <Button variant='danger' busy={busy} onClick={() => save(false)}>Switch off</Button>
                            </div>
                        </Card>
                    ) : (
                        <Card>
                            <h3 className='flex items-center gap-2 text-sm font-semibold text-white'><FlaskConical className='h-4 w-4' /> Switch test mode on</h3>
                            <div className='mt-3 space-y-4'>
                                <div>
                                    <p className='mb-1 text-sm text-slate-300'>Tenants ({chosen.length} chosen)</p>
                                    <label className='relative block'>
                                        <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500' />
                                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Search active tenants' aria-label='Search tenants'
                                            className='h-11 w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none' />
                                    </label>
                                    <div className='mt-2 max-h-64 space-y-1 overflow-y-auto overscroll-contain rounded-xl border border-slate-800 p-1'>
                                        {tenants.loading && !tenants.data ? <Spinner /> : list.length ? list.map((t) => {
                                            const on = chosen.includes(t.id);
                                            return (
                                                <button key={t.id} type='button' role='checkbox' aria-checked={on} onClick={() => setChosen((c) => (on ? c.filter((x) => x !== t.id) : [...c, t.id]))}
                                                    className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${on ? 'bg-emerald-500/10 text-white' : 'text-slate-300 active:bg-slate-800'}`}>
                                                    <span className='min-w-0'><span className='block truncate font-medium'>{t.name}</span><span className='block truncate text-xs text-slate-500'>@{t.domain}</span></span>
                                                    <span className={`h-5 w-5 shrink-0 rounded-md border ${on ? 'border-emerald-500 bg-emerald-500' : 'border-slate-600'}`} />
                                                </button>
                                            );
                                        }) : <p className='p-3 text-sm text-slate-500'>No active tenants match.</p>}
                                    </div>
                                    {tried && errors.tenants && <p className='mt-1 text-xs text-red-400'>{errors.tenants}</p>}
                                </div>
                                <Field id='tm-hours' label={`Duration in hours (1 to ${data.maxHours})`} inputMode='numeric' value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9]/g, ''))} error={tried ? errors.hours : ''} />
                                <div>
                                    <TextArea id='tm-reason' label='Reason (at least 20 characters)' value={reason} onChange={(e) => setReason(e.target.value)} placeholder='End-to-end test of procurement and maintenance closure on the development tenant' />
                                    {tried && errors.reason && <p className='mt-1 text-xs text-red-400'>{errors.reason}</p>}
                                </div>
                                <Field id='tm-phrase' label={`Type ${data.phrase} to confirm`} autoComplete='off' value={phrase} onChange={(e) => setPhrase(e.target.value)} error={tried ? errors.phrase : ''} />
                                <Button busy={busy} onClick={() => save(true)} disabled={tried && invalid}>Switch test mode on</Button>
                            </div>
                        </Card>
                    )}
                </div>
            )}
        </div>
    );
}
