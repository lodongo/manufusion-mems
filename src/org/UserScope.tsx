import { useState } from 'react';
import { Eye, MapPin, Plus, Trash2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, SelectField } from '../components/ui';
import { Button, Card, Spinner, useLoad } from '../admin/kit';
import { LEVELS, upperName } from './structureDefs';
import type { Position } from './PositionsPage';
import { withSodAcknowledgement } from '../lib/sod';

interface ScopeNode {
    id: string;
    level: string;
    tier: number;
    code: string;
    name: string;
    roleCodes: string[];
}

interface ScopeData {
    assignments: Array<{ positionCode: string; nodeId: string; type?: string; startsOn?: string; endsOn?: string }>;
    extraScopes: string[];
    positions: Position[];
    design: { mode: string; names: string[] };
    nodes: ScopeNode[];
}

/** Organization roles held by a user and where they apply, plus special view access. */
export default function UserScope({ uid }: { uid: string }) {
    const { data, error, loading } = useLoad(() => callBackend<ScopeData>('/api/org/users/scope/get', { uid }), [uid]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the user scope.'}</Alert>;
    return <ScopeForm uid={uid} data={data} />;
}

function ScopeForm({ uid, data }: { uid: string; data: ScopeData }) {
    const [assignments, setAssignments] = useState(data.assignments);
    const [extras, setExtras] = useState(data.extraScopes);
    const [role, setRole] = useState('');
    const [location, setLocation] = useState('');

    
    const [extra, setExtra] = useState('');
    const [temporaryType, setTemporaryType] = useState('acting');
    const [assignmentOpen,setAssignmentOpen]=useState(false);
    const [startsOn, setStartsOn] = useState('');
    const [endsOn, setEndsOn] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const names = data.design.names;

    const nodeLabel = (id: string) => {
        if (id === 'root') return 'Whole organization';
        const n = data.nodes.find((x) => x.id === id);
        if (!n) return id;
        const level = n.level === 'group' ? upperName(names, n.tier) : LEVELS[n.level]?.label ?? n.level;
        return `${n.code} · ${n.name} (${level})`;
    };
    const positionTitle = (code: string) => data.positions.find((p) => p.code === code)?.title ?? code;

    const eligibleNodes = (code:string) => {const p=data.positions.find(x=>x.code===code);if(!p)return [];const upper=/^upper:(\d)$/.exec(p.operatingLevel);return data.nodes.filter(n=>(!p.operatingLevel||n.level===p.operatingLevel||(upper&&n.level==='group'&&n.tier===Number(upper[1]))));};
    const add = () => {
        if (!role || assignments.length >= 2) return;
        if(!eligibleNodes(role).some(n=>n.id===location))return setError('Select a valid operating location for this job role.');
        if (assignments.length && (!startsOn || !endsOn || endsOn < startsOn)) return setError('Choose a valid start and end date for the temporary assignment.');
        if (!assignments.some((a) => a.positionCode === role)) setAssignments([...assignments, { positionCode: role, nodeId: location, type: assignments.length ? temporaryType : 'primary', startsOn: assignments.length ? startsOn : '', endsOn: assignments.length ? endsOn : '' }]);
        setRole('');
        setLocation('');
        setAssignmentOpen(false);
    };

    const save = async () => {
        setBusy(true);
        setError('');
        setInfo('');
        try {
            
            let nextAssignments: ScopeData['assignments'] = [...assignments];
            if (role) {
                if(!eligibleNodes(role).some(n=>n.id===location))throw new Error('Select a valid operating location for this job role.');
                if (nextAssignments.length >= 2) throw new Error('Only one primary and one temporary role are permitted.');
                if (nextAssignments.length && (!startsOn || !endsOn || endsOn < startsOn)) throw new Error('Choose valid dates for the temporary assignment.');
                if (!nextAssignments.some(a => a.positionCode === role)) nextAssignments.push({positionCode:role,nodeId:location,type:nextAssignments.length?temporaryType:'primary',startsOn:nextAssignments.length?startsOn:'',endsOn:nextAssignments.length?endsOn:''});
            }
            const result = await withSodAcknowledgement((extra) => callBackend<{assignments:ScopeData['assignments'];extraScopes:string[]}>('/api/org/users/scope/save', { uid, assignments: nextAssignments, extraScopes: extras, ...extra }));
            setAssignments(result.assignments);
            setExtras(result.extraScopes);
            setRole('');
            setLocation('');
            setAssignmentOpen(false);
            setInfo('Roles and access saved successfully.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
        } finally {
            setBusy(false);
        }
    };

    const options = data.nodes.filter((n) => !extras.includes(n.id));

    return (
        <Card className='mt-4 space-y-4 !border-line !bg-panel !text-ink'>
            <div>
                <h2 className='flex items-center gap-2 font-semibold text-ink'>
                    <MapPin className='h-4 w-4 text-emerald-400' />
                    Job roles and scope
                </h2>
                <p className='text-xs text-muted'>One primary job role and at most one time-limited acting, extended function or secondment assignment. The job role defines the operating level and permissions. Select the user's specific location at that level.</p>
            </div>
            {assignments.length === 0 ? (
                <p className='text-sm text-muted'>No job roles assigned yet.</p>
            ) : (
                <ul className='space-y-2'>
                    {assignments.map((a) => (
                        <li key={`${a.positionCode}@${a.nodeId}`} className='flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2'>
                            <div className='min-w-0 flex-1'>
                                <p className='truncate text-sm text-ink'>{positionTitle(a.positionCode)}</p>
                                <p className='truncate text-xs text-muted'>{a.type === 'primary' || !a.type ? 'Primary' : a.type.replace('_', ' ')} · at {nodeLabel(a.nodeId)} {a.endsOn ? `· ${a.startsOn} to ${a.endsOn}` : ''}</p>
                            </div>
                            <button type='button' aria-label='Remove' onClick={() => setAssignments(assignments.filter((x) => x !== a))} className='text-red-400'>
                                <Trash2 className='h-4 w-4' />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <div className='space-y-3 rounded-xl border border-line bg-panel p-3'>
                <button type='button' aria-expanded={assignmentOpen} onClick={()=>setAssignmentOpen(v=>!v)} className='flex w-full items-center justify-between rounded-xl border border-line bg-panel p-3 text-left font-semibold text-ink'><span>{assignments.length?'Add temporary assignment':'Assign job role'}</span><span aria-hidden='true'>{assignmentOpen?'−':'+'}</span></button>
                {assignmentOpen&&<div className='space-y-3'>
                <SelectField id='scope-role' label='Job role' value={role} onChange={e=>{setRole(e.target.value);setLocation('')}} ><option value=''>Select job role</option>{data.positions.map(p=><option key={p.code} value={p.code}>{p.code} · {p.title}</option>)}</SelectField>
                {role&&<><SelectField id='scope-location' label='Operating location' value={location} onChange={e=>setLocation(e.target.value)}><option value=''>Select applicable location</option>{eligibleNodes(role).map(n=><option key={n.id} value={n.id}>{nodeLabel(n.id)}</option>)}</SelectField>{eligibleNodes(role).length===0&&<p className='text-xs text-red-700'>No matching organizational unit at the configured operating level.</p>}</>}
                {assignments.length===1&&<div className='space-y-2'><SelectField id='scope-temporary-type' label='Additional assignment' value={temporaryType} onChange={e=>setTemporaryType(e.target.value)}><option value='acting'>Acting</option><option value='extended_function'>Extended function</option><option value='secondment'>Secondment</option></SelectField><label className='block text-ink'>Start date<input className='block h-12 w-full rounded-xl border border-line bg-panel px-3 text-ink [color-scheme:light]' type='date' value={startsOn} onChange={e=>setStartsOn(e.target.value)}/></label><label className='block text-ink'>End date<input className='block h-12 w-full rounded-xl border border-line bg-panel px-3 text-ink [color-scheme:light]' type='date' value={endsOn} onChange={e=>setEndsOn(e.target.value)}/></label></div>}
                <Button variant='secondary' className='w-full !border-line !bg-panel !text-ink' disabled={!role||assignments.length>=2||!eligibleNodes(role).some(n=>n.id===location)} onClick={add}><Plus className='h-4 w-4'/>{assignments.length?'Add temporary assignment':'Assign primary role'}</Button>
            </div>
                }</div>
            <div className='border-t border-line pt-4'><h3 className='flex items-center gap-2 text-sm font-semibold text-ink'><Eye className='h-4 w-4'/>Special access (view only)</h3><p className='text-sm text-muted'>Read-only visibility beyond assigned sites.</p>{extras.map(id=><div key={id} className='flex justify-between border-b py-2'><span>{nodeLabel(id)}</span><button onClick={()=>setExtras(extras.filter(x=>x!==id))}>Remove</button></div>)}<div className='mt-2 flex gap-2'><select className='min-w-0 flex-1 rounded-xl border border-line bg-panel p-2 text-ink' value={extra} onChange={e=>setExtra(e.target.value)}><option value=''>Add special access...</option>{!extras.includes('root')&&<option value='root'>Whole organization</option>}{options.map(n=><option key={n.id} value={n.id}>{nodeLabel(n.id)}</option>)}</select><Button variant='secondary' disabled={!extra} onClick={()=>{setExtras([...extras,extra]);setExtra('')}}>Add</Button></div></div>
            {error&&<p role='alert' className='rounded-xl bg-red-50 p-3 text-sm text-red-700'>{error}</p>}{info&&<Alert tone='info'>{info}</Alert>}
            <Button className='w-full !bg-brand !text-onbrand' busy={busy} onClick={save}>Save roles and access</Button>
        </Card>
    );
}
