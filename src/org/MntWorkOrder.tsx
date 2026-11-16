import MntResourceBooking from './MntResourceBooking';
import {ToolRequirementReview} from './MntToolCatalogue';
import {legacySteps,OrderedStepReview} from './MntOrderedSteps';
import {appConfirm} from '../components/dialogs';
import MntExpectedDates,{ExpectedDateHelp} from './MntExpectedDates';
import MntSelect from './MntSelect';
import MntTestDeletion from './MntTestDeletion';
import MntStatusReview from './MntStatusReview';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Package, ShieldCheck, Wrench, CalendarClock, CheckCircle2, ChevronDown } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { workspaceNavigate as navigate } from '../lib/route';
import { Alert, SelectField } from '../components/ui';
import { Button, Card, Spinner, useLoad } from '../admin/kit';
import { WorkOrderVouchers } from './StoresIssueVouchers';
import MntTaskAssessment, { WarehouseSparePicker, CatalogPicker } from './MntTaskAssessment';
import { FulfilmentTrack, ResourceStatus, SOURCE_LABEL, serviceJustificationLabels, useVendors } from './mntSourcing';
import { useFullScreen,MaintenanceResponsibility,ChoicePicker,type MntLists,type MntSetup } from './mntShared';
import MntGateHint from './MntGateHint';
import MntReadiness from './MntReadiness';

export type MntData = Record<string, any>;
export const mntInput = 'mt-1 w-full rounded-xl border border-line bg-panel p-3 text-base text-ink';
export const mntApi = (body: MntData) => {
    const next = { ...body };
    if (['save_window', 'preview_window'].includes(body.action)) {
        for (const key of ['start', 'end'])
            if (body[key] && Number.isFinite(Date.parse(body[key]))) next[key] = new Date(body[key]).toISOString();
        next.timeZone = body.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    return callBackend<MntData>('/api/org/mnt/operations', next);
};
export function MntField({
    label,
    value,
    onChange,
    type = 'text',
    multiline = false,
}: {
    label: string;
    value: any;
    onChange: (v: string) => void;
    type?: string;
    multiline?: boolean;
}) {
    return (
        <label className="block text-sm text-soft">
            {label}
            {multiline ? (
                <textarea className={mntInput} rows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
            ) : (
                <input className={mntInput} type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
            )}
        </label>
    );
}
export function MntCheck({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={value} onChange={(e) => onChange(e.target.checked)} />
            {label}
        </label>
    );
}
export function MntDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
            role="dialog"
            aria-modal="true"
            aria-label={title}
        >
            <section className="max-h-[90dvh] w-full max-w-3xl overflow-auto rounded-2xl border border-line bg-panel p-5 text-ink">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">{title}</h2>
                    <button className="rounded-lg border border-line px-3 py-2" onClick={onClose} aria-label="Close dialog">
                        Close
                    </button>
                </div>
                {children}
            </section>
        </div>
    );
}
function Details({ task }: { task: MntData }) {
    return (
        <div className="space-y-4">
            <OrderedStepReview label='Subtasks' values={legacySteps(task.subtasks,task.description)}/><ToolRequirementReview values={task.toolRequirements} legacyNotes={task.tools}/>
            <div className="grid gap-3 sm:grid-cols-2">
                {[
                    ['Work instructions', task.instructions],
                    ['Completion criteria', task.completionCriteria],
                    ['Required skills', task.skills],
                    [
                        'People / estimated labour',
                        `${task.persons} people · ${task.hours} hours · ${Array.isArray(task.internalRoleRequirements)?task.internalRoleRequirements.reduce((n:number,r:MntData)=>n+Number(r.persons)*Number(r.hours),0):Number(task.persons)*Number(task.hours)} labour hours`,
                    ],
                    
                    ['Safety equipment', task.safetyEquipment],
                    ['Isolation', task.isolation],
                    ['Technical documentation', task.documentation],
                    ['Dependencies', (task.dependencies || []).join(', ')],
                ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-line p-3">
                        <p className="text-xs font-semibold uppercase text-muted">{label}</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm">{value || 'None specified'}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}
export function MntRiskTable({ risks }: { risks: MntData[] }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
                <thead>
                    <tr>
                        {[
                            'Hazard / consequence',
                            'Initial risk',
                            'Controls and precautions',
                            'Residual risk',
                            'Permit / responsible person',
                        ].map((h) => (
                            <th key={h} className="border border-line p-3">
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {risks.map((r, i) => (
                        <tr key={i}>
                            <td className="border border-line p-3">
                                {r.hazard}
                                <p className="mt-1 text-soft">{r.impact}</p>
                                {r.exposedPersonnel && <p>Exposed: {r.exposedPersonnel}</p>}
                            </td>
                            <td className="border border-line p-3">{r.before}</td>
                            <td className="border border-line p-3">
                                {r.controls}
                                <p>{r.precautions}</p>
                            </td>
                            <td className="border border-line p-3">{r.after}</td>
                            <td className="border border-line p-3">
                                {r.permit || 'None'}
                                <p>{r.responsiblePerson}</p>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ResourceForm({
    kind,
    code,
    expectedStart,
    task,
    resource,
    previous,
    people,
    workGroup,
    item = {},
    onRun,
    onClose,
}: {
    kind: string;
    code: string;
    expectedStart?:string;
    task: MntData;
    resource: MntData;
    previous: MntData;
    people: MntData[];
    workGroup?: MntData | null;
    item?: MntData;
    onRun: (action: string, b?: MntData) => Promise<boolean>;
    onClose: () => void;
}) {
    const [includeOutsideGroup, setIncludeOutsideGroup] = useState(false);
    const [data, setData] = useState<MntData>({
        personnel: previous.personnel || [],
        overheadRoles: previous.overheadRoles ?? task.overheadRoles ?? [],
        materialId: '',
        warehouseId: '',
        catalogCode: resource.catalogCode || '',
        attributes: { ...resource.attributes },
        dateRequired: previous.executionDate || resource.requiredDate || resource.executionDate || expectedStart || '',
        budget:previous.expectedCost??resource.expectedCost??'',
        urgency: 'medium',
        supplierCategory: previous.sourcing?.supplierCategory || resource.supplierCategory || '',
        preferredVendorId: previous.sourcing?.preferredVendorId || '',
        shortlistedVendorIds:previous.sourcing?.shortlistedVendorIds||[],
        poId: item.orderReady?.id || '',
        lineNo: item.orderReady?.lineNo || '',
        readyAt: resource.executionDate || '',
    });
    const executionRoles=useLoad(()=>callBackend<{executionRoles?:Array<{code:string;label:string}>}>('/api/org/mnt/assessment/options',{code}),[code]);
    const directRows: MntData[]=Array.isArray(task.subtaskRoles)?task.subtaskRoles.flat():task.internalRoleRequirements||[];
    const directPeople=Array.isArray(task.subtaskRoles)?Array.from(new Set(directRows.map(r=>r.roleCode))).reduce((n,k)=>n+Math.max(...directRows.filter(r=>r.roleCode===k).map(r=>Number(r.persons)||0)),0):Number(task.persons)||0;
    const isGroupMember = (id:string) => people.some(p=>p.id===id && p.inWorkGroup===true);
    const outsideSelected=(data.personnel as string[]).filter(id=>!isGroupMember(id));
    const availablePeople=people.filter(p=>p.inWorkGroup===true||includeOutsideGroup);
    // Refreshing the allocation context (or reopening the dialog) never retains the opt-in.
    useEffect(()=>{setIncludeOutsideGroup(false);},[code,task.id,people,workGroup]);
    const isService = !!resource.scope || 'acceptanceCriteria' in resource;
    const vendors = useVendors(kind === 'service_sourcing' ? code : '', data.supplierCategory, resource.categoryCode || '', resource.subcategoryCode || '');
    const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
    const needsWarehouse = kind === 'secure_spare' && !previous.warehouseId && !resource.warehouseId;
    useEffect(() => {
        if (!needsWarehouse) return;
        callBackend<{ warehouses: Array<{ id: string; name: string }> }>('/api/org/mnt/warehouse-spares/search', { mode: 'warehouses' })
            .then((r) => setWarehouses(r.warehouses || []))
            .catch(() => setWarehouses([]));
    }, [needsWarehouse]);
    const [spec, setSpec] = useState<MntData | null>(null),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false);
    const patch = (k: string, v: any) => setData((old) => ({ ...old, [k]: v }));
    const pickSpec = async (item: MntData) => {
        patch('catalogCode', item.code);
        try {
            const r = await mntApi({ action: 'catalog_spec', code, kind: 'materials', catalogCode: item.code });
            setSpec(r.spec);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load catalogue specification.');
        }
    };
    const submit = async () => {
        setError('');
        if (kind === 'service_sourcing' && !data.supplierCategory) return setError('Choose the supplier category.');
        if (kind === 'service_sourcing' && !data.preferredVendorId && (String(data.suggestedVendor || '').trim().length < 3 || String(data.onboardingReason || '').trim().length < (vendors.vendors.length ? 20 : 10)))
            return setError('Give the suggested supplier and the reason for onboarding.');
        if (kind === 'allocate' && outsideSelected.length && !includeOutsideGroup) return setError('Enable outside-work-group selection to keep the selected outside employees, or remove them.');
        if (kind === 'secure_spare' && needsWarehouse && !data.warehouseId) return setError('Choose the warehouse.');
        if (kind === 'procure' && (!data.glCode || !data.dateRequired)) return setError('Enter the GL account and the date required.');
        setBusy(true);
        if (await onRun(kind, { taskId: task.id, resourceId: resource.id, ...data, ...(kind==='allocate'?{includeOutsideGroup}: {}) })) onClose();
        setBusy(false);
    };
    return (
        <div className="space-y-4">
            {kind === 'allocate' && (
                <>
                    <p className="text-sm text-soft">
                        Required: {directPeople} direct + {(data.overheadRoles as MntData[]).reduce((n,r)=>n+Number(r.persons),0)} overhead people · {task.skills}.
                    </p>
                    <section className="rounded-xl border border-line p-3 space-y-3"><h3 className="font-semibold">Additional overhead resources</h3><p className="text-xs text-soft">Planning only. Add supporting roles and time independently of assessed subtasks.</p>{(data.overheadRoles as MntData[]).map((r,i)=><div key={r.roleCode} className="rounded-lg border border-line p-3 space-y-2"><b>{r.roleLabel||r.roleCode}</b><div className="flex flex-wrap gap-3 items-end"><div><span className="block text-xs text-soft">People</span><div className="flex items-center gap-2"><button type="button" aria-label="Decrease overhead headcount" disabled={r.persons<=1} className="min-h-11 min-w-11 rounded-lg border border-line disabled:opacity-40" onClick={()=>patch('overheadRoles',data.overheadRoles.map((x:MntData,j:number)=>j===i?{...x,persons:Math.max(1,x.persons-1)}:x))}>&lt;</button><b>{r.persons}</b><button type="button" aria-label="Increase overhead headcount" disabled={r.persons>=50} className="min-h-11 min-w-11 rounded-lg border border-line disabled:opacity-40" onClick={()=>patch('overheadRoles',data.overheadRoles.map((x:MntData,j:number)=>j===i?{...x,persons:Math.min(50,x.persons+1)}:x))}>&gt;</button></div></div><label className="text-xs text-soft">Hours per person<input type="number" min=".25" max="2000" step=".25" className={mntInput+' max-w-32'} value={r.hours} onChange={e=>patch('overheadRoles',data.overheadRoles.map((x:MntData,j:number)=>j===i?{...x,hours:Number(e.target.value)}:x))}/></label></div><div className="flex items-center justify-between text-sm"><span>{(Number(r.persons)*Number(r.hours)).toFixed(1)} person-hours</span><button type="button" className="min-h-11 text-rose-400" onClick={()=>patch('overheadRoles',data.overheadRoles.filter((_:MntData,j:number)=>j!==i))}>Remove</button></div></div>)}<SelectField id="mnt-overhead-role" label="Add overhead role" value="" onChange={e=>{const role=executionRoles.data?.executionRoles?.find(r=>r.code===e.target.value);if(role)patch('overheadRoles',[...data.overheadRoles,{roleCode:role.code,roleLabel:role.label,persons:1,hours:1}]);}}><option value="">Choose work group role</option>{executionRoles.data?.executionRoles?.filter(r=>!data.overheadRoles.some((x:MntData)=>x.roleCode===r.code)).map(r=><option key={r.code} value={r.code}>{r.label}</option>)}</SelectField></section>
                    <div className="rounded-xl border border-line p-3">
                        <p className="font-semibold">{workGroup ? workGroup.code+' · '+workGroup.name : 'No work group configured for this cost center'}</p>
                        <p className="mt-1 text-xs text-soft">{people.filter(p=>p.inWorkGroup===true).length} eligible work group members. Outside-group selection is off by default.</p>
                        <div className="mt-3"><MntCheck label="Include employees outside the work group" value={includeOutsideGroup} onChange={setIncludeOutsideGroup}/></div>
                        {!includeOutsideGroup&&outsideSelected.length>0&&<Alert tone="warn">Previously selected outside-group employees are retained for review only. To save them, explicitly enable outside-group selection again, or remove them below.</Alert>}
                        <MntResourceRecommendations code={code} taskId={task.id} hours={Number(task.hours)||1} outside={includeOutsideGroup} existing={data.personnel} onPick={id=>patch('personnel',[...new Set([...data.personnel,id])])}/>
                        <div className="mt-3 space-y-2">{(data.personnel as string[]).map(id=>{const p=people.find(x=>x.id===id);return <div key={id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-2 text-sm"><span>{p?.name||id}{!isGroupMember(id)?' · Outside group':''}</span><button type="button" className="min-h-10 px-2 text-rose-400" onClick={()=>patch('personnel',(data.personnel as string[]).filter(x=>x!==id))}>Remove</button></div>;})}</div>
                        <div className="mt-3"><SelectField id="mnt-allocate-person" label="Add execution personnel" value="" disabled={!availablePeople.some(p=>!data.personnel.includes(p.id))} onChange={e=>{if(e.target.value&&!data.personnel.includes(e.target.value))patch('personnel',[...data.personnel,e.target.value]);}}>
                            <option value="">Choose employee</option>
                            <optgroup label="Work group team">{availablePeople.filter(p=>p.inWorkGroup===true&&!data.personnel.includes(p.id)).map(p=><option key={p.id} value={p.id}>{p.name}{p.genericTitles?.length?' · '+p.genericTitles.join(', '):''}</option>)}</optgroup>
                            {includeOutsideGroup&&<optgroup label="Outside work group">{availablePeople.filter(p=>p.inWorkGroup!==true&&!data.personnel.includes(p.id)).map(p=><option key={p.id} value={p.id}>{p.name} · Outside group</option>)}</optgroup>}
                        </SelectField></div>
                    </div>
                    <MntCheck
                        label="The allocated personnel have the required skills and competencies."
                        value={!!data.competenciesConfirmed}
                        onChange={(v) => patch('competenciesConfirmed', v)}
                    />
                    {(task.assessmentSetup?.equipment===undefined||task.toolboxSufficient===true)&&<MntCheck
                        label="Assigned toolbox / legacy tool availability confirmed (where applicable)."
                        value={!!data.toolsReady}
                        onChange={(v) => patch('toolsReady', v)}
                    />}
                </>
            )}
            {kind === 'match_spare' && (
                <>
                    <p>Review technical equivalence before matching this requirement.</p>
                    <WarehouseSparePicker
                        onSelect={(item) =>
                            setData((old) => ({
                                ...old,
                                materialId: item.materialId,
                                warehouseId: item.warehouseId,
                                selectedName: item.name,
                            }))
                        }
                    />
                    {data.selectedName && <p className="rounded-lg border border-line p-3">{data.selectedName}</p>}
                </>
            )}
            {kind === 'candidate' && (
                <>
                    <p className="text-sm text-soft">
                        Submit this assessed spare as a material-creation candidate. Procurement / Materials Master will complete the technical specification and create a draft through the existing approval workflow. You do not need permission to create materials.
                    </p>
                    <CatalogPicker kind="materials" onSelect={pickSpec} />
                    <Button variant="secondary" onClick={() => pickSpec({ code: data.catalogCode })} disabled={!data.catalogCode}>
                        Load required specification attributes
                    </Button>
                    <MntField label='Planner review and missing technical details' value={data.note} onChange={(v)=>patch('note',v)} multiline />
                    {!data.catalogCode&&<p className='text-xs text-amber-500'>Description-only spare: submit now for specification by the Materials Master maintainer, or select a catalogue item above.</p>}
                    {spec && (
                        <>
                            <h3 className="font-semibold">{spec.name}</h3>
                            {spec.attributes?.map((a: MntData) => (
                                <MntField
                                    key={a.code}
                                    label={a.name + (a.required ? ' *' : '') + (a.unit ? ' (' + a.unit + ')' : '')}
                                    value={data.attributes[a.code]}
                                    onChange={(v) => patch('attributes', { ...data.attributes, [a.code]: v })}
                                />
                            ))}
                        </>
                    )}
                </>
            )}
            {(kind === 'procure' || kind === 'secure_spare') && (
                <>
                    <p className="text-sm text-soft">
                        {kind === 'secure_spare'
                            ? 'Usable stock is reserved first. Only the shortage is covered: by an open replenishment when one already covers it, otherwise by a purchase requirement that follows manager approval and the chart of authority.'
                            : isService
                              ? 'The requirement carries the scope, acceptance criteria, supplier category and preferred vendor into the standard approval and procurement process.'
                              : 'Only the shortage is requested. An open replenishment that covers it is linked instead of buying twice.'}
                    </p>
                    {needsWarehouse && (
                        <div className="block text-sm text-soft"><MntSelect label="Receive/issue warehouse" className={mntInput} value={data.warehouseId} onChange={(e) => patch('warehouseId', e.target.value)}>
                                <option value="">Choose warehouse</option>
                                {warehouses.map((w) => (
                                    <option key={w.id} value={w.id}>{w.name}</option>
                                ))}
                            </MntSelect></div>
                    )}
                    {expectedStart&&<p className="text-xs text-soft">Original resource availability target: {expectedStart}. A later delivery date does not change this target.</p>}<MntField label={isService?'Planned execution date':'Date required'} type="date" value={data.dateRequired} onChange={(v) => patch('dateRequired', v)} />
                    <MntField label={kind === 'secure_spare' ? 'GL account (used only if a purchase is needed)' : 'Approved GL account for this purchase'} value={data.glCode} onChange={(v) => patch('glCode', v)} />
                    <div className="block text-sm text-soft"><MntSelect label="Urgency" className={mntInput} value={data.urgency} onChange={(e) => patch('urgency', e.target.value)}>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                        </MntSelect></div>
                    <MntField label={isService?'Estimated service cost (optional)':'Indicative budget (optional)'} type="number" value={data.budget} onChange={(v) => patch('budget', v)} />
                </>
            )}
            {kind === 'service_sourcing' && (
                <>
                    <p className="text-sm text-soft">
                        Choose the supplier category, then an approved vendor qualified for this service. For OEM and OCM, vendors representing the equipment make are listed. If none is suitable, request supplier onboarding.
                    </p>
                    <div className="block text-sm text-soft"><MntSelect label="Supplier category" className={mntInput} value={data.supplierCategory} onChange={(e) => setData((o) => ({ ...o, supplierCategory: e.target.value, preferredVendorId: '', shortlistedVendorIds:[] }))}>
                            <option value="">Choose</option>
                            {vendors.categories.map((c) => (
                                <option key={c.code} value={c.code}>{c.label}</option>
                            ))}
                        </MntSelect></div>
                    {vendors.error && <Alert tone="error">{vendors.error}</Alert>}
                    {data.supplierCategory && !vendors.loading && (
                        <fieldset className="space-y-2">
                            <legend className="text-sm text-soft">Approved vendors ({vendors.vendors.length})</legend>
                            {vendors.vendors.map((v) => (
                                <label key={v.id} className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
                                    <input type="radio" name="vendor" className="mt-1" checked={data.preferredVendorId === v.id} onChange={() => setData(old=>({...old,preferredVendorId:v.id,shortlistedVendorIds:(old.shortlistedVendorIds||[]).filter((id:string)=>id!==v.id).slice(0,2)}))} />
                                    <span className="min-w-0">
                                        <span className="block truncate font-medium">{v.name}</span>
                                        <span className="block truncate text-xs text-muted">{[v.id, v.manufacturerMatch ? 'Represents ' + (vendors.make.manufacturer || vendors.make.brand) : '', v.brands.join(', ')].filter(Boolean).join(' · ')}</span>
                                    </span>
                                </label>
                            ))}
                            <label className="flex items-start gap-3 rounded-xl border border-dashed border-line p-3 text-sm">
                                <input type="radio" name="vendor" className="mt-1" checked={data.preferredVendorId === ''} onChange={() => setData(old=>({...old,preferredVendorId:'',shortlistedVendorIds:[]}))} />
                                <span>No suitable approved vendor — request supplier onboarding</span>
                            </label>
                            {vendors.others.length > 0 && <p className="text-xs text-muted">{vendors.others.length} other vendor(s) of this category do not represent the equipment make.</p>}
                        </fieldset>
                    )}
                    {data.preferredVendorId&&vendors.vendors.some(v=>v.id===data.preferredVendorId)&&<fieldset className="space-y-2 rounded-xl border border-line p-3"><legend className="text-sm text-soft">Alternate qualified vendors (optional, up to two)</legend>{vendors.vendors.filter(v=>v.id!==data.preferredVendorId).map(v=><label key={v.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.shortlistedVendorIds.includes(v.id)} disabled={!data.shortlistedVendorIds.includes(v.id)&&data.shortlistedVendorIds.length>=2} onChange={e=>patch('shortlistedVendorIds',e.target.checked?[...data.shortlistedVendorIds,v.id]:data.shortlistedVendorIds.filter((id:string)=>id!==v.id))}/>{v.name}</label>)}<p className="text-xs text-soft">The shortlist includes the preferred vendor. Final purchase decisions remain in Procurement.</p></fieldset>}
                    {data.supplierCategory && data.preferredVendorId === '' && (
                        <div className="space-y-3 rounded-xl border border-line p-3">
                            <MntField label="Suggested supplier name" value={data.suggestedVendor} onChange={(v) => patch('suggestedVendor', v)} />
                            <MntField label="Contact (optional)" value={data.suggestedContact} onChange={(v) => patch('suggestedContact', v)} />
                            <MntField
                                label={vendors.vendors.length ? 'Why none of the approved vendors is suitable (20+ characters)' : 'Why this supplier is needed (10+ characters)'}
                                value={data.onboardingReason}
                                onChange={(v) => patch('onboardingReason', v)}
                                multiline
                            />
                            <p className="text-xs text-muted">Procurement registers and approves the supplier. No purchase order can go to an unapproved vendor.</p>
                        </div>
                    )}
                </>
            )}
            {kind === 'secure_service' && (
                <>
                    {item.orderReady && <p className="rounded-lg bg-page p-3 text-sm">Order {item.orderReady.number} line {item.orderReady.lineNo} was raised from this task requirement.</p>}
                    <MntField label="Approved purchase order number" value={data.poId} onChange={(v) => patch('poId', v)} />
                    <MntField label="Purchase order line number" type="number" value={data.lineNo} onChange={(v) => patch('lineNo', v)} />
                    <MntField label="Service ready on" type="date" value={data.readyAt} onChange={(v) => patch('readyAt', v)} />
                </>
            )}
            {!['candidate', 'procure', 'secure_spare', 'service_sourcing'].includes(kind) && (
                <MntField
                    label={kind === 'allocate' ? 'Allocation and competency evidence' : 'Review notes'}
                    value={data.note}
                    onChange={(v) => patch('note', v)}
                    multiline
                />
            )}
            {error && <Alert tone="error">{error}</Alert>}
            <Button busy={busy} onClick={submit}>
                {kind === 'candidate'
                    ? 'Submit material creation candidate'
                    : kind === 'procure'
                      ? 'Submit purchase requirement'
                      : kind === 'secure_spare'
                        ? 'Reserve and cover the shortage'
                        : kind === 'service_sourcing'
                          ? data.preferredVendorId
                              ? 'Confirm supplier'
                              : 'Request supplier onboarding'
                          : 'Save task resource plan'}
            </Button>
        </div>
    );
}

function FeedbackForm({ task, execution, wo, onSubmit }: { task: MntData; execution: MntData; wo:MntData; onSubmit: (d: MntData) => void }) {
    const [reportNames,setReportNames]=useState<MntData>(wo.serviceReports?.[task.id]||{}),[uploadError,setUploadError]=useState(''),[uploading,setUploading]=useState(false);
    const upload=async(serviceId:string,file:File)=>{setUploading(true);setUploadError('');try{if(file.size>1500000)throw Error('PDF report must be at most 1.5 MB.');const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});await mntApi({code:wo.code,action:'upload_service_report',taskId:task.id,serviceId,data,filename:file.name});setReportNames(old=>({...old,[serviceId]:{filename:file.name}}));}catch(e){setUploadError(e instanceof Error?e.message:'Upload failed');}finally{setUploading(false);}};
    const retrospective=wo.executionMode==='request_closure';
    const setup=useLoad(()=>retrospective?Promise.resolve(null):callBackend<MntSetup>('/api/org/mnt/setup',{}),[retrospective]);
    const today=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
    const [f, setF] = useState<MntData>({ ...(retrospective?{workPerformed:execution.reportedWork,actualHours:Number(execution.actualMinutes)/60}:{closureFieldsVersion:1,failureModeCode:wo.failureModeCode||wo.natureCode||'',causeCode:wo.causeCode||'',solutionCodes:(wo.solutions||[]).map((s:MntData)=>s.code),dateClosed:today,durationMinutes:''}),services: (task.services || []).map((s: MntData) => ({ id: s.id, accepted: false })) });
    const patch = (k: string, v: any) => setF((old) => ({ ...old, [k]: v }));
    return (
        <div className="space-y-3">
            <p className="text-sm text-soft">
                {retrospective?'Verify the details already recorded on the Work Request.':'Record the work done and actual time. Add further detail only when useful.'}
            </p>
            {retrospective?<div className="space-y-2 rounded-xl border border-line p-3 text-sm">
                <p className="font-semibold">Work Request completion details</p>
                {[
                    ['Failure mode',wo.directCompletion?.failureModeLabel],
                    ['Failure cause',wo.directCompletion?.causeLabel],
                    ['Solution types',(wo.directCompletion?.solutions||[]).map((s:MntData)=>[s.group,s.label].filter(Boolean).join(' · ')).join('; ')],
                    ['What was done?',execution.reportedWork],
                    ['Type of maintenance',wo.maintenanceTypeLabel],
                    ['Closure date',execution.performedDate],
                    ['Actual time taken (minutes)',execution.actualMinutes],
                    ['Closed by',wo.directCompletion?.executor?.name],
                ].map(([label,value])=><p key={label}><span className="font-semibold">{label}: </span>{value||'—'}</p>)}
            </div>:<>{setup.data?.lists?<><ChoicePicker title="Failure mode" required groups={setup.data.lists.failureModes} selected={f.failureModeCode?[f.failureModeCode]:[]} onToggle={v=>patch('failureModeCode',f.failureModeCode===v?'':v)}/>
                <ChoicePicker title="Failure cause" required groups={setup.data.lists.rootCauses} selected={f.causeCode?[f.causeCode]:[]} onToggle={v=>patch('causeCode',f.causeCode===v?'':v)}/>
                <ChoicePicker title="Solution types" required multi max={5} groups={setup.data.lists.solutions} selected={f.solutionCodes} onToggle={v=>patch('solutionCodes',f.solutionCodes.includes(v)?f.solutionCodes.filter((x:string)=>x!==v):f.solutionCodes.length<5?[...f.solutionCodes,v]:f.solutionCodes)}/></>:<p className="text-sm text-soft">{setup.error||'Loading maintenance closure classifications…'}</p>}
                <MntField label="What was done? *" value={f.workPerformed} multiline onChange={v=>patch('workPerformed',v)}/>
                <p className="text-sm"><span className="font-semibold">Type of maintenance: </span>{task.maintenanceTypeLabel||wo.maintenanceTypeLabel||'—'}</p>
                <MntField label="Closure date *" type="date" value={f.dateClosed} onChange={v=>patch('dateClosed',v)}/>
                <MntField label="Actual time taken (minutes) *" type="number" value={f.durationMinutes} onChange={v=>patch('durationMinutes',v)}/>
                <p className="text-sm"><span className="font-semibold">Closed by: </span>Signed-in employee (recorded automatically)</p>
                <details className="rounded-xl border border-line p-3"><summary className="cursor-pointer text-sm font-medium">Additional technical details (optional)</summary>
                    {([['findings','Technical findings'],['results','Actual work results'],['measurements','Measurements'],['evidence','Execution evidence / reference']] as const).map(([k,l])=><MntField key={k} label={l} value={f[k]} multiline onChange={v=>patch(k,v)}/>)}
                    <MntField label="Outstanding work / follow-up (if any)" value={f.followUp} multiline onChange={v=>patch('followUp',v)}/>
                    <div className="block text-sm"><MntSelect label="Execution quality (optional)" className={mntInput} value={f.qualityOutcome||'not_assessed'} onChange={e=>patch('qualityOutcome',e.target.value)}><option value="not_assessed">Not assessed</option><option value="first_pass">Accepted first pass</option><option value="rework_completed">Rework completed</option><option value="follow_up">Follow-up required</option></MntSelect></div>
                    {['rework_completed','follow_up'].includes(f.qualityOutcome)&&<MntField label="Rework / follow-up description" value={f.qualityNote} multiline onChange={v=>patch('qualityNote',v)}/>}
                </details>
            </>}
            {retrospective?<><MntCheck label="I confirm no spare parts or external services were used." value={!!f.noSparesOrServicesConfirmed} onChange={v=>patch('noSparesOrServicesConfirmed',v)}/></>:null}
            {(task.services || []).map((s: MntData, i: number) => (
                <fieldset key={s.id} className="space-y-3 rounded-xl border border-line p-3">
                    <legend className="font-semibold">Service execution: {s.description}</legend>
                    {[
                        ['provider', 'Service provider'],
                        ['scopeDelivered', 'Actual scope delivered'],
                        ['results', 'Technical results'],
                        ['acceptance', 'Acceptance findings'],
                        ['outstandingIssues', 'Outstanding service issues'],
                    ].map(([key, label]) => (
                        <MntField
                            key={key}
                            label={label}
                            value={f.services[i][key]}
                            onChange={(v) =>
                                patch(
                                    'services',
                                    f.services.map((x: MntData, j: number) => (j === i ? { ...x, [key]: v } : x)),
                                )
                            }
                        />
                    ))}
                    <MntField
                        label="Service completed on"
                        type="datetime-local"
                        value={f.services[i].completedAt}
                        onChange={(v) =>
                            patch(
                                'services',
                                f.services.map((x: MntData, j: number) => (j === i ? { ...x, completedAt: v } : x)),
                            )
                        }
                    />
                    <label className="block text-sm font-semibold">Service report (PDF) *<input className={mntInput} type="file" accept="application/pdf,.pdf" disabled={uploading} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(s.id,file);}}/></label>
                    {reportNames[s.id]&&<p className="text-sm text-brand">{reportNames[s.id].filename} · attached</p>}
                    {uploadError&&<Alert tone="error">{uploadError}</Alert>}
                    <MntCheck
                        label="Service delivered and technically accepted."
                        value={!!f.services[i].accepted}
                        onChange={(v) =>
                            patch(
                                'services',
                                f.services.map((x: MntData, j: number) => (j === i ? { ...x, accepted: v } : x)),
                            )
                        }
                    />
                </fieldset>
            ))}
            <Button disabled={uploading||(task.services||[]).some((s:MntData)=>!reportNames[s.id])||(retrospective?!f.noSparesOrServicesConfirmed:!setup.data?.lists||!f.failureModeCode||!f.causeCode||!f.solutionCodes.length||!f.dateClosed||!String(f.workPerformed||'').trim()||!Number.isInteger(Number(f.durationMinutes))||!(Number(f.durationMinutes)>0))} onClick={() => onSubmit({ feedback: f })}>{retrospective?'Confirm recorded work':'Complete task'}</Button>
        </div>
    );
}
function ConsumptionForm({ task, issues, onSubmit }: { task: MntData; issues: MntData[]; onSubmit: (d: MntData) => void }) {
    const lines = issues
        .filter((i) => i.taskId === task.id)
        .flatMap((i) => i.lines.map((l: MntData) => ({ ...l, issueId: i.id, issueLineId: i.id + '_' + l.no })));
    const [consumption, setConsumption] = useState<MntData[]>(
        lines.map((l) => ({ issueLineId: l.issueLineId, consumed: '', returned: '', installed: '', spareId: '', remarks: '' })),
    );
    const [dispositions, setDispositions] = useState<MntData[]>((task.spares || []).map((s: MntData) => ({ spareId: s.id, reason: '' })));
    const patch = (i: number, k: string, v: any) => setConsumption((old) => old.map((c, j) => (i === j ? { ...c, [k]: v } : c)));
    return (
        <div className="space-y-4">
            <p className="text-sm text-soft">
                Confirm actual usage from each task issue. Unused stock is returned through the stores and finance posting controls. Planned
                quantities are shown for reference.
            </p>
            {lines.map((l, i) => (
                <fieldset key={l.issueLineId} className="space-y-3 rounded-xl border border-line p-3">
                    <legend className="font-semibold">
                        {l.materialNumber} · {l.name}
                    </legend>
                    <p className="text-sm">
                        Issued: {l.qty} {l.uom} · {l.issueId}
                    </p>
                    <div className="block text-sm text-soft"><MntSelect label="Material requirement"
                           
                            className={mntInput}
                            value={consumption[i].spareId}
                            onChange={(e) => patch(i, 'spareId', e.target.value)}
                        >
                            <option value="">Additional / unplanned material</option>
                            {(task.spares || []).map((s: MntData) => (
                                <option key={s.id} value={s.id}>
                                    {s.description} · planned {s.qty} {s.uom}
                                </option>
                            ))}
                        </MntSelect></div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <MntField
                            label="Actual quantity consumed"
                            type="number"
                            value={consumption[i].consumed}
                            onChange={(v) => patch(i, 'consumed', v)}
                        />
                        <MntField
                            label="Unused quantity returned to stores"
                            type="number"
                            value={consumption[i].returned}
                            onChange={(v) => patch(i, 'returned', v)}
                        />
                    </div>
                    <div className="block text-sm text-soft"><MntSelect label="Installed as component"
                           
                            className={mntInput}
                            value={consumption[i].installed}
                            onChange={(e) => patch(i, 'installed', e.target.value)}
                        >
                            <option value="">Choose explicitly</option>
                            <option value="yes">Yes, update the task equipment or assembly BOM</option>
                            <option value="no">No, consumable / unused item</option>
                        </MntSelect></div>
                    <MntField
                        label="Material reconciliation remarks"
                        value={consumption[i].remarks}
                        onChange={(v) => patch(i, 'remarks', v)}
                    />
                </fieldset>
            ))}
            {(task.spares || [])
                .filter((s: MntData) => !consumption.some((c) => c.spareId === s.id))
                .map((s: MntData) => (
                    <MntField
                        key={s.id}
                        label={`Why was planned spare not used? ${s.description} (${s.qty} ${s.uom})`}
                        value={dispositions.find((d) => d.spareId === s.id)?.reason}
                        onChange={(v) => setDispositions((old) => old.map((d) => (d.spareId === s.id ? { ...d, reason: v } : d)))}
                    />
                ))}
            {!lines.length && <p>No material issues are recorded for this task. Confirm reasons for unused planned spares.</p>}
            <Button
                onClick={() =>
                    onSubmit({
                        consumption: consumption.map((c) => ({
                            ...c,
                            installed: c.installed === 'yes' ? true : c.installed === 'no' ? false : null,
                        })),
                        dispositions: dispositions.filter((d) => !consumption.some((c) => c.spareId === d.spareId)),
                    })
                }
            >
                Confirm actual material usage
            </Button>
        </div>
    );
}

/** Task picker as a menu above the task (replaces the side column), so the task content gets the full width. */
function TaskMenu({ tasks, current, executions, onPick }: { tasks: MntData[]; current: MntData; executions: MntData; onPick: (id: string) => void }) {
    const [open, setOpen] = useState(false);
    const index = tasks.indexOf(current);
    const codeOf = (t: MntData, i: number) => t.code || 'ASSMTASK_' + (i + 1);
    return (
        <div className="relative">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-line bg-panel px-4 text-left"
            >
                <span className="min-w-0 flex-1">
                    <span className="block font-mono text-xs text-muted">
                        {codeOf(current, index)} · task {index + 1} of {tasks.length}
                    </span>
                    <span className="block truncate font-semibold">{current.title || current.description}</span>
                </span>
                <ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <>
                    <button type="button" aria-label="Close task menu" className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} />
                    <ul role="listbox" aria-label="Maintenance tasks" className="absolute left-0 right-0 z-30 mt-1 max-h-[60dvh] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-panel p-1 shadow-xl">
                        {tasks.map((t, i) => {
                            const e = executions[t.id] || {};
                            return (
                                <li key={t.id}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={t.id === current.id}
                                        onClick={() => {
                                            onPick(t.id);
                                            setOpen(false);
                                        }}
                                        className={`w-full rounded-xl px-3 py-3 text-left ${t.id === current.id ? 'bg-brand/10' : 'active:bg-page'}`}
                                    >
                                        <span className="block font-mono text-xs text-muted">
                                            {codeOf(t, i)} · {e.status?.replaceAll('_', ' ') || 'Not started'}
                                            {e.reconciled ? ' · reconciled' : ''}
                                        </span>
                                        <span className="block truncate font-medium">{t.title || t.description}</span>
                                        <span className="block text-xs text-soft">
                                            {t.spares?.length || 0} spares · {t.services?.length || 0} services · {t.risk?.length || 0} risks
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </div>
    );
}

function OrderAssessmentHeader({wo,options,can,onDone,testOverride,cycle}:{wo:MntData;options:MntData[];can:boolean;onDone:()=>void;testOverride:boolean;cycle?:MntData}){
 const setup=useLoad(()=>callBackend<MntSetup>('/api/org/mnt/setup',{}),[]);
 const [form,setForm]=useState<MntData>({technicalEvaluation:wo.technicalEvaluation||'',natureCode:wo.natureCode||'',severityCode:wo.severitySetBy?wo.criticalityCode:'',solutionCodes:(wo.solutions||[]).map((s:MntData)=>s.code),maintenanceTypeCode:wo.maintenanceTypeCode||'',priorityCode:wo.priorityCode||'',assemblyId:wo.assemblyId||'',note:wo.assessmentNote||'',expectedStart:wo.expectedStart||'',expectedEnd:wo.expectedEnd||'',scheduledStart:wo.scheduledStart||'',scheduledEnd:wo.scheduledEnd||'',dateChangeReason:'',...(wo.assessmentDraft?.header||{})});
 const [busy,setBusy]=useState(false),[err,setErr]=useState('');const set=(k:string,v:any)=>setForm(old=>({...old,[k]:v}));
 const l: MntLists|null|undefined=setup.data?.lists;
 const dateChanged=form.scheduledStart!==(wo.scheduledStart||'')||form.scheduledEnd!==(wo.scheduledEnd||''),restricted=!!cycle?.restrictedTypes?.includes(form.maintenanceTypeCode),newAdmission=form.scheduledStart!==wo.scheduledStart||restricted&&!cycle?.restrictedTypes?.includes(wo.maintenanceTypeCode),minDate=newAdmission?(restricted?cycle?.nextStart:cycle?.today):undefined;
 const moves=Math.max(Number(wo.startDateMoves)||0,(wo.dateChanges||[]).filter((x:MntData)=>x.fromStart&&x.fromStart!==x.toStart).length);
 const expectedChanged=form.expectedStart!==wo.expectedStart||form.expectedEnd!==wo.expectedEnd||form.maintenanceTypeCode!==wo.maintenanceTypeCode;
 const cycleEnd=cycle?.nextStart?new Date(Date.parse(cycle.nextStart+'T00:00:00Z')+6*86400000).toISOString().slice(0,10):undefined;
 const expectedInvalid=!wo.expectedDatesLocked&&(!form.expectedStart||!form.expectedEnd||form.expectedEnd<form.expectedStart||expectedChanged&&(restricted?!!cycle?.nextStart&&(form.expectedStart<cycle.nextStart||!!cycleEnd&&form.expectedEnd>cycleEnd):!!cycle?.today&&form.expectedStart<cycle.today));
 const dateInvalid=expectedInvalid||(moves>=2&&form.scheduledStart!==wo.scheduledStart)||!form.scheduledStart||!form.scheduledEnd||form.scheduledEnd<form.scheduledStart||!!minDate&&form.scheduledStart<minDate||dateChanged&&form.dateChangeReason.trim().length<10;
 if(!can)return <Card className="space-y-2"><p className="font-semibold">Technical assessment classification</p><p className="text-sm">{wo.technicalEvaluation||'Awaiting assessor'}</p><p className="text-sm text-soft">{[wo.natureLabel,wo.criticalityLabel,wo.maintenanceTypeLabel].filter(Boolean).join(' · ')}</p><MntExpectedDates start={wo.expectedStart} end={wo.expectedEnd} source={wo.expectedDateSource} locked={wo.expectedDatesLocked}/><p className="text-xs text-soft">Scheduled: {wo.scheduledStart||'—'} to {wo.scheduledEnd||'—'}</p></Card>;
 if(!l)return <Card><p className="text-sm">{setup.error||'Loading assessment metadata…'}</p></Card>;
 const saveDraft=async()=>{setBusy(true);setErr('');try{await callBackend('/api/org/mnt/wo/action',{code:wo.code,action:'save_assessment_draft',header:form});onDone();}catch(e){setErr(e instanceof Error?e.message:'Unable to save draft');}finally{setBusy(false);}};
 const save=async()=>{setBusy(true);setErr('');try{await callBackend('/api/org/mnt/wo/action',{code:wo.code,action:'assess_header',...form});onDone();}catch(e){setErr(e instanceof Error?e.message:'Unable to save');}finally{setBusy(false);}};
 return <Card className="space-y-3"><p className="font-semibold">1. Technical assessment classification</p><div className="block text-sm"><MntSelect label="Assembly (optional)" className={mntInput} disabled={!!wo.assessmentTasks?.length} value={form.assemblyId} onChange={e=>set('assemblyId',e.target.value)}><option value="">Equipment level</option>{options.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}{form.assemblyId&&!options.some(a=>a.id===form.assemblyId)&&<option value={form.assemblyId}>{wo.assemblyName}</option>}</MntSelect></div><MntField label="Technical evaluation *" value={form.technicalEvaluation} multiline onChange={v=>set('technicalEvaluation',v)}/><ChoicePicker title="Failure mode" required groups={l.failureModes} selected={form.natureCode?[form.natureCode]:[]} onToggle={v=>set('natureCode',form.natureCode===v?'':v)}/><ChoicePicker title="Solution categories" required multi max={5} groups={l.solutions} selected={form.solutionCodes} onToggle={v=>set('solutionCodes',form.solutionCodes.includes(v)?form.solutionCodes.filter((x:string)=>x!==v):form.solutionCodes.length<5?[...form.solutionCodes,v]:form.solutionCodes)}/>{[['severityCode','Severity *',l.criticality],['maintenanceTypeCode','Maintenance type *',l.maintenanceTypes],['priorityCode','Priority',l.priorities]].map(([key,label,items])=><div key={String(key)} className="block text-sm"><MntSelect label={String(label)} className={mntInput} disabled={String(key)==='maintenanceTypeCode'&&!!wo.breakIn} value={form[String(key)]} onChange={e=>set(String(key),e.target.value)}><option value="">Select…</option>{String(key)==='maintenanceTypeCode'&&wo.breakIn?<option value="MAI-016">Break-in Maintenance</option>:(items as MntLists['criticality']).map(x=><option key={x.code} value={x.code}>{x.label}</option>)}</MntSelect></div>)}{wo.expectedDatesLocked?<MntExpectedDates start={wo.expectedStart} end={wo.expectedEnd} source={wo.expectedDateSource}/>:<div className="space-y-2 rounded-xl border border-line bg-page p-3"><ExpectedDateHelp/><div className="grid grid-cols-2 gap-2"><label className="block text-sm">Expected start date *<input type="date" className={mntInput} min={restricted?cycle?.nextStart:cycle?.today} max={restricted?cycleEnd:undefined} value={form.expectedStart} onChange={e=>set('expectedStart',e.target.value)}/></label><label className="block text-sm">Expected end date *<input type="date" className={mntInput} min={form.expectedStart} max={restricted?cycleEnd:undefined} value={form.expectedEnd} onChange={e=>set('expectedEnd',e.target.value)}/></label></div><p className="text-xs text-soft">Editable during assessment. Permanently locked on completion.</p>{restricted&&<p className="text-xs text-soft">Next maintenance cycle: {cycle?.nextStart} — {cycleEnd}</p>}</div>}<p className="text-sm font-semibold">Scheduled dates</p><div className="grid grid-cols-2 gap-2"><label className="block text-sm">Scheduled start date *<input className={mntInput} type="date" disabled={moves>=2} min={minDate} value={form.scheduledStart} onChange={e=>set('scheduledStart',e.target.value)}/></label><label className="block text-sm">Scheduled end date *<input className={mntInput} type="date" min={form.scheduledStart} value={form.scheduledEnd} onChange={e=>set('scheduledEnd',e.target.value)}/></label></div><p className="text-xs text-soft">Scheduled start date changes: {moves}/2 {moves>=2?'· locked':''}</p>{minDate&&<p className="text-xs text-soft">Earliest new start: {minDate}</p>}{dateChanged&&<MntField label="Reason for scheduled date change *" value={form.dateChangeReason} onChange={v=>set('dateChangeReason',v)}/>}<MntField label="Assessment note" value={form.note} multiline onChange={v=>set('note',v)}/>{err&&<Alert tone="error">{err}</Alert>}<Button testOverride={testOverride} busy={busy} disabled={form.technicalEvaluation.trim().length<20||!form.natureCode||!form.severityCode||!form.solutionCodes.length||!form.maintenanceTypeCode||dateInvalid} onClick={save} >Save technical classification</Button><Button variant="secondary" busy={busy} onClick={()=>void saveDraft()}>Save draft</Button>{wo.assessmentDraft?.header&&<p className="text-xs text-soft">Technical classification draft saved. Complete it before submission.</p>}</Card>;
}
import MntApprovalProgress from './MntApprovalProgress';
import MntPersonalTime from './MntPersonalTime';
import MntResourceRecommendations from './MntResourceRecommendations';
import MntStandardHistory from './MntStandardHistory';
export default function MntWorkOrder({ code }: { code: string }) {
    const { data, error, loading, reload } = useLoad(() => mntApi({ action: 'read', code }), [code]);
    const [reviewTab,setReviewTab]=useState<'status'|'details'>('status');
    const [selected, setSelected] = useState(''),
        [tab, setTab] = useState('Details'),
        [assessing, setAssessing] = useState(false),
        [assessmentSection,setAssessmentSection]=useState<'classification'|'tasks'>('classification'),
        [assessmentReviewNote,setAssessmentReviewNote]=useState(''),
        [dialog, setDialog] = useState<MntData | null>(null),
        [message, setMessage] = useState(''),
        [failure, setFailure] = useState(''),
        [busy, setBusy] = useState(false),
        [form, setForm] = useState<MntData>({});
    const [assessmentDirty,setAssessmentDirty]=useState(false);
    const leaveAssessment=async()=>{if(assessmentDirty&&!(await appConfirm('There are unsaved assessment changes. Leave without saving them?')))return;setAssessing(false);setAssessmentDirty(false);reload();};
    const screen = useFullScreen(assessing);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone="error">{error || 'Work order unavailable.'}</Alert>;
    const wo = data.wo,
        retrospective=wo.executionMode==='request_closure',
        tasks: MntData[] = wo.assessmentTasks || [],
        task = tasks.find((t) => t.id === selected) || tasks[0],
        execution = wo.taskExecution?.[task?.id] || {},
        planning = wo.taskPlanning?.[task?.id] || {},
        can = data.permissions;
    const run = async (action: string, body: MntData = {}) => {
        setBusy(true);
        setFailure('');
        setMessage('');
        try {
            const result = await mntApi({ code, action, ...body });
            setMessage(
                result.kind === 'replenishment'
                    ? 'Shortage linked to the open replenishment ' + result.requirementId + '; no duplicate purchase was raised.'
                    : result.shortage === 0
                      ? 'Reserved in full from the warehouse.'
                      : result.requirementId
                    ? 'Purchase requirement ' + result.requirementId + ' is in approval.'
                    : result.materialDraftId
                      ? 'Material draft ' + result.materialDraftId + ' created. Open Materials Master to complete and submit it.'
                      : 'Saved.',
            );
            reload();
            return true;
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'Unable to save.');
            return false;
        } finally {
            setBusy(false);
        }
    };
    const legacy = async (action: string, body: MntData = {}) => {
        setBusy(true);
        setFailure('');
        try {
            await callBackend('/api/org/mnt/wo/action', { code, action, ...body });
            reload();
            return true;
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'Unable to submit plan.');
            return false;
        } finally {
            setBusy(false);
        }
    };
    const open = (kind: string, resource: MntData = {}, previous: MntData = {}) => {
        setForm({});
        setDialog({ kind, resource, previous });
    };
    const submitDialog = async (action: string, body: MntData) => {
        if (action === 'cancel_order') {
            if (await legacy('cancel', body)) setDialog(null);
        } else if (await run(action, body)) setDialog(null);
    };
    const openAssessment=()=>{setAssessmentSection(wo.executionMode==='confirmed_request'&&(!wo.assessedAt||wo.assessmentDraft?.header)?'classification':'tasks');setAssessing(true);};
    if (assessing&&can.assess)
        return (
            <div className={screen.full ? screen.className + ' overflow-y-auto overscroll-contain' : ''} onFocusCapture={screen.keepInView}>
            {screen.full && (
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-page py-2">
                    <Button variant="secondary" aria-label="Back to work order" onClick={()=>void leaveAssessment()}>
                        <ArrowLeft size={16} />
                    </Button>
                    <p className="min-w-0 flex-1 truncate font-semibold">{wo.code} · task assessment</p>
                </div>
            )}
            {wo.executionMode==='confirmed_request'&&<div className="mb-3 flex flex-wrap gap-2"><Button variant={assessmentSection==='classification'?'primary':'secondary'} onClick={()=>{if(!assessmentDirty)setAssessmentSection('classification');else void appConfirm('Leave unsaved task changes? Save draft first if needed.').then(ok=>{if(ok){setAssessmentDirty(false);setAssessmentSection('classification');}});}}>Technical classification</Button><Button variant={assessmentSection==='tasks'?'primary':'secondary'} onClick={()=>setAssessmentSection('tasks')}>Tasks &amp; requirements</Button></div>}
            {assessmentSection==='classification'&&wo.executionMode==='confirmed_request'?<><OrderAssessmentHeader key={wo.code+':'+(wo.assessedAt||'new')+':'+(wo.assessmentDraft?.updatedAt||'')} wo={wo} options={data.assemblyOptions||[]} cycle={data.maintenanceCycle} can={!!can.assess} testOverride={!!data.testModeOverride} onDone={reload}/><Button variant="secondary" onClick={()=>setAssessmentSection('tasks')}>Continue to tasks</Button></>:<MntTaskAssessment
                code={code}
                context={{ asset: `${wo.assetTag} · ${wo.assetName || ''}`, assembly: wo.assemblyName, equipment: wo.unitName }}
                recordType="wo"
                breakIn={!!wo.breakIn}
                initial={(wo.assessmentDraft?.tasks??tasks) as any}
                hasSavedDraft={Array.isArray(wo.assessmentDraft?.tasks)}
                editable
                onSaved={() => {
                    setAssessing(false);setAssessmentDirty(false);
                    reload();
                }}
                onDirtyChange={setAssessmentDirty}
                onCancel={() => {setAssessing(false);setAssessmentDirty(false);reload();}}
            />}
            </div>
        );
    return (
        <div className="space-y-5 text-ink">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <button
                        onClick={() => navigate('organization_admin/work_orders')}
                        className="mb-2 flex items-center gap-2 text-sm text-soft"
                    >
                        <ArrowLeft size={16} />
                        Work orders
                    </button>
                    <p className="font-mono text-xs text-muted">
                        {wo.code} · {wo.workflowStatusCode||wo.workflowCode||''} · {wo.workflowLabel||(retrospective&&wo.status==='in_progress'?'Awaiting safety sign-off':wo.status.replaceAll('_', ' '))}
                    </p>
                    <h1 className="mt-1 text-2xl font-semibold">{wo.title}</h1>
                    <p className="mt-1 text-sm text-soft">
                        {wo.unitName} · {wo.assemblyName} · {wo.assetTag}
                    </p>
                </div>
                {wo.wrCode&&<Button variant="secondary" onClick={()=>navigate('organization_admin/work_requests/'+wo.wrCode)}>{wo.wrCode}</Button>}{!retrospective&&<Button variant="secondary" onClick={() => navigate('organization_admin/maintenance_windows')}>
                    <CalendarClock size={17} />
                    Maintenance windows
                </Button>}
            </div>
            {!!wo.orderApprovalStage&&<Card className="space-y-2"><p className="font-semibold">Work order approval · {wo.orderApprovalLabel}</p><p className="text-sm text-soft">{wo.orderStageApprovalPending?(wo.orderStageApprovalReached?'Awaiting independent approval':'Approval will be available at the configured stage'):'Approved · '+(wo.stageApproval?.name||'')}</p>{can.approveOrderStage&&<><textarea className="w-full rounded-lg border border-line bg-panel p-2 text-ink" placeholder="Approval notes (minimum 10 characters)" value={assessmentReviewNote} onChange={e=>setAssessmentReviewNote(e.target.value)}/><Button busy={busy} disabled={assessmentReviewNote.trim().length<10} onClick={async()=>{if(await run('approve_order_stage',{note:assessmentReviewNote}))setAssessmentReviewNote('');}}>Approve work order</Button></>}</Card>}
            {!!wo.technicalClosurePending?.at&&<Card className="space-y-2"><p className="font-semibold">Awaiting technical closure approval</p><p className="text-sm text-soft">Applicable safety sign-off and closure checks recorded. Independent technical approval is required before final closure.</p>{can.technicalApprove&&<><textarea className="w-full rounded-lg border border-line bg-panel p-2 text-ink" placeholder="Technical approval notes (minimum 10 characters)" value={assessmentReviewNote} onChange={e=>setAssessmentReviewNote(e.target.value)}/><Button busy={busy} disabled={assessmentReviewNote.trim().length<10} onClick={async()=>{if(await run('technical_close',{note:assessmentReviewNote}))setAssessmentReviewNote('');}}>Approve technical closure</Button></>}</Card>}
            <MntApprovalProgress preview={wo.approvalPreview}/>
            {!wo.approvalPreview&&<MntApprovalProgress title='Work order approval history' evidence={wo.stageApproval?.flow||wo.assessmentReview?.flow}/>}
            {wo.technicalClosure?.flow&&<MntApprovalProgress title='Technical closure approval history' evidence={wo.technicalClosure.flow}/>}
            {data.testModeOverride&&<MntTestDeletion kind="order" code={code} onDeleted={()=>navigate('organization_admin/work_orders')}/>}
            {wo.parentWoCode&&<Card className="space-y-2"><p className="font-semibold">Break-in Maintenance · sub-order</p><Button variant="secondary" onClick={()=>navigate('organization_admin/work_orders/'+wo.parentWoCode)}>Parent {wo.parentWoCode}</Button>{wo.rootWoCode&&wo.rootWoCode!==wo.parentWoCode&&<Button variant="secondary" onClick={()=>navigate('organization_admin/work_orders/'+wo.rootWoCode)}>Original {wo.rootWoCode}</Button>}</Card>}
            {(can.createBreakIn||data.subOrders?.length>0)&&<Card className="space-y-2"><h2 className="font-semibold">Break-in sub-orders</h2>{(data.subOrders||[]).map((x:MntData)=><Button key={x.code} variant="secondary" onClick={()=>navigate('organization_admin/work_orders/'+x.code)}>{x.code} · {x.title} · {x.status}</Button>)}{can.createBreakIn&&<Button onClick={()=>{open('create_break_in');const today=data.maintenanceCycle?.today||new Date().toISOString().slice(0,10);setForm({scheduledStart:today,scheduledEnd:today});}}>Create break-in sub-order</Button>}</Card>}
            <MaintenanceResponsibility record={wo}/>
            <div className="flex gap-2 rounded-xl border border-line p-1"><Button variant={reviewTab==='status'?'primary':'secondary'} onClick={()=>setReviewTab('status')}>Status review</Button><Button variant={reviewTab==='details'?'primary':'secondary'} onClick={()=>setReviewTab('details')}>Work Order details</Button></div>
            {!retrospective&&(wo.workflowCode==='WO010'||wo.workflowCode==='WO015'||wo.status==='planning'&&can.assess)&&<Card className="space-y-2"><p className="font-semibold">Assessment {wo.assessmentDraft?'· Draft saved':wo.assessedAt&&!wo.assessmentReady?'· In progress':''}</p>{wo.assessmentDraft?.updatedAt?<p className="text-xs text-soft">Last saved {new Date(wo.assessmentDraft.updatedAt).toLocaleString()}</p>:!wo.assessmentReady&&<p className="text-sm text-soft">No saved draft is required. You can start or restart this assessment.</p>}<div className="flex flex-wrap gap-2"><Button testOverride={!!data.testModeOverride} disabled={!can.assess} onClick={openAssessment}><Wrench size={16}/>{wo.assessmentReady?'Edit assessment':'Continue assessment'}</Button></div>{!can.assess&&<p role="status" className="rounded-lg border border-line bg-page p-2 text-sm text-soft">{data.assessmentBlockReason||'Assessment editing requires the configured Work Group assessor at this location. Check your assigned job role and scope.'}</p>}</Card>}
            {!retrospective&&tasks.some(t=>(t.services||[]).length)&&((wo.assessmentApprovalRequired!==false&&!wo.assessmentReviewCurrent)||wo.orderStageApprovalPending)&&<Card className="space-y-3"><h3 className="font-semibold">External services · assessment review</h3><p className="text-sm text-soft">Review these technical requirements and outsourcing justification as part of the configured approval. Supplier selection and commercial planning follow the assessment.</p>{tasks.filter(t=>(t.services||[]).length).map(t=><section key={t.id} className="space-y-2"><p className="text-sm font-medium">{t.title||t.description}</p>{(t.services||[]).map((s:MntData)=><div key={s.id} className="space-y-1 rounded-lg border border-line p-3 text-sm"><p className="font-medium">{s.description}</p><OrderedStepReview label='Scope' values={legacySteps(s.scopeSteps,s.scope,s.instructions)}/><OrderedStepReview label='Deliverables' values={legacySteps(s.deliverableItems,s.deliverables)}/><OrderedStepReview label='Certifications' values={legacySteps(s.certificationItems,s.certifications)}/>{s.acceptanceCriteria&&<p>Acceptance: {s.acceptanceCriteria}</p>}{!!s.skillRequirements?.length?<p>Required skills: {s.skillRequirements.map((r:MntData)=>(r.skillLabel||r.skillCode)+' · '+r.level).join('; ')}</p>:s.qualifications&&<p>Previous competencies: {s.qualifications}</p>}<div className="rounded-lg bg-page p-2"><p className="font-medium">External service justification</p><p>{serviceJustificationLabels(s.justificationReasons)||'Not recorded'}</p>{s.justification&&<p className="whitespace-pre-wrap break-words">{s.justification}</p>}{!!s.missingToolRequirements?.length&&<ToolRequirementReview values={s.missingToolRequirements}/>}{!!s.missingSkillCodes?.length&&<p>Missing skills: {(s.skillRequirements||[]).filter((r:MntData)=>s.missingSkillCodes.includes(r.skillCode)).map((r:MntData)=>r.skillLabel||r.skillCode).join('; ')}</p>}</div><p>{s.quantity??1} required · {s.personnel??'—'} people · {s.durationHours??'—'} h</p>{s.specialistRequired&&<p>External specialist support: {(s.skillRequirements||[]).map((r:MntData)=>(r.skillLabel||r.skillCode)+' · '+r.level).join('; ')}</p>}</div>)}</section>)}</Card>}
            {reviewTab==='status'?<MntStatusReview data={data} onRefresh={reload}/>:<>
            {wo.executionMode==='confirmed_request'&&<OrderAssessmentHeader key={wo.code+':'+(wo.assessedAt||'new')} wo={wo} cycle={data.maintenanceCycle} options={data.assemblyOptions||[]} can={wo.status==='planning'&&!!can.assess&&!Object.keys(wo.taskPlanning||{}).length} testOverride={!!data.testModeOverride} onDone={reload}/>}
            {wo.workflowCode&&<Card className="space-y-2"><p className="text-xs text-soft">Operational state · {wo.workflowStatusCode||wo.workflowCode}</p><p className="font-semibold">{wo.workflowLabel}</p><p className="text-sm text-soft">Since {wo.workflowSince?new Date(wo.workflowSince).toLocaleString():'—'}</p>{wo.workflowReason&&<p className="text-sm">{wo.workflowReason}</p>}<details open><summary className="cursor-pointer text-sm font-semibold">State transition history ({(wo.workflowTransitions||[]).length})</summary><ol className="mt-2 space-y-2">{[...(wo.workflowTransitions||[])].reverse().map((e:MntData,i:number)=><li key={i} className="border-l-2 border-line pl-3 text-sm"><p className="font-medium">{e.from?(e.fromStatusCode||e.from)+' → ':''}{e.toStatusCode||e.to} · {e.label}</p><p className="text-xs text-soft">{new Date(e.at).toLocaleString()} · {e.byName||e.by} · {e.source}</p>{e.reason&&<p className="text-xs text-soft">{e.reason}</p>}</li>)}</ol></details></Card>}
            {retrospective&&<Card className="space-y-2"><h2 className="font-semibold">Work completed at request review</h2><p className="text-sm text-soft">Planning, resource preparation and maintenance window are not applicable. This record does not certify prior safety authorization.</p><p className="text-sm">Actual completion: {wo.directCompletion?.performedDate} · {wo.directCompletion?.durationMinutes} minutes</p><p className="text-sm">Performed by: {wo.directCompletion?.executor?.name} · {wo.directCompletion?.executor?.role}</p><p className="text-sm">Work performed: {wo.directCompletion?.reportedWork}</p><p className="text-sm">Maintenance type: {wo.maintenanceTypeLabel}</p><p className="text-sm">Failure mode: {wo.directCompletion?.failureModeLabel} · Cause: {wo.directCompletion?.causeLabel}</p><p className="text-sm">Solution: {(wo.directCompletion?.solutions||[]).map((s:MntData)=>s.label).join('; ')}</p><p className="text-sm text-soft">No spare parts or services declared. Labour valuation is separate from recorded time.{wo.finalCost?.pendingLabourValuation?' Labour valuation pending approved rate.':''}</p></Card>}
            {failure && <MntGateHint message={failure} />}
            {message && <Alert tone="info">{message}</Alert>}
            {can.earlyClose&&data.earlyClosure&&<Card className="space-y-2"><h2 className="font-semibold">Close work order at current stage</h2>{data.earlyClosure.blocked.length?<p className="text-sm text-soft">Committed PO: {data.earlyClosure.blocked.join(', ')}. Complete procurement and normal closure.</p>:<><p className="text-sm text-soft">{data.earlyClosure.started?'Record and reconcile actual work, then obtain safety sign-off. Unstarted tasks will remain unperformed.':'Unstarted scope will remain unperformed. Uncommitted maintenance purchase requirements and reservations will be released.'}</p>{data.earlyClosure.started?(data.earlyClosure.requested?<p className="text-sm font-medium">Early closure requested. Complete actual feedback, reconciliation and safety sign-off below.</p>:<Button variant="secondary" onClick={()=>open('prepare_early_close')}>Request early closure</Button>):<Button variant="secondary" onClick={()=>open('early_close')}>Close work order early</Button>}</>}</Card>}
            {wo.closureMode==='early'&&<Card className="space-y-1"><p className="font-semibold">Closed early · {wo.earlyClosure?.outcome==='not_started'?'Work not started':'Work stopped'}</p><p className="text-sm">{wo.earlyClosure?.note}</p><p className="text-xs text-soft">Unperformed tasks: {wo.earlyClosure?.skippedTaskIds?.length||0}</p></Card>}
            <div className="flex flex-wrap gap-2">
                {can.cancel && !can.earlyClose && (
                    <Button testOverride={!!data.testModeOverride} variant="secondary" onClick={() => open('cancel_order')}>
                        Cancel work order
                    </Button>
                )}


                {can.plan&&wo.status==='released'&&<Button variant="secondary" onClick={()=>open('return_to_planning')}>Return to planning / change dates</Button>}
                {can.plan &&
                    tasks.length > 0 &&
                    ['planning','plan_ready','released'].includes(wo.status) &&
                    !Object.values(wo.taskExecution || {}).some((e: any) => e.startedAt) && (
                        <Button testOverride={!!data.testModeOverride} variant="secondary" onClick={() => open('reassess')}>
                            Controlled reassessment
                        </Button>
                    )}
            </div>
            {tasks.length > 0 && (wo.assessmentReady??wo.assessmentReviewCurrent) && data.checklist && (
                <MntReadiness code={code} wo={wo} cycle={data.maintenanceCycle} checklist={data.checklist} canPlan={!!can.plan} testModeOverride={!!data.testModeOverride} currency={data.currency || ''} onDone={reload} />
            )}
            {!retrospective&&tasks.length>0&&wo.assessmentApprovalRequired!==false&&<Card className="space-y-3">
                <p className="font-semibold">Independent work assessment review</p>
                <p className="text-sm">{wo.assessmentReviewCurrent?'Approved by '+(wo.assessmentReview.name||'reviewer'):'Awaiting approval of current task assessment'}</p>
                {wo.assessmentReview?.note&&<p className="text-sm text-soft">Review notes: {wo.assessmentReview.note}</p>}
                {wo.status==='planning'&&can.reviewAssessment&&<div className="space-y-2">
                    <label className="block text-sm">Technical verification / correction notes (minimum 10 characters)
                        <textarea rows={3} value={assessmentReviewNote} onChange={e=>setAssessmentReviewNote(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-transparent p-3 text-base" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                        <Button testOverride={!!data.testModeOverride} busy={busy} disabled={assessmentReviewNote.trim().length<10} onClick={async()=>{if(await legacy('review_assessment',{note:assessmentReviewNote}))setAssessmentReviewNote('');}}>Approve assessment</Button>
                        <Button testOverride={!!data.testModeOverride} variant="secondary" busy={busy} disabled={assessmentReviewNote.trim().length<10} onClick={async()=>{if(await legacy('return_assessment',{note:assessmentReviewNote}))setAssessmentReviewNote('');}}>Return for correction</Button>
                    </div>
                </div>}
            </Card>}
            {!retrospective&&tasks.length>0&&wo.assessmentApprovalRequired===false&&<p className="text-sm text-soft">Independent assessment approval is not required by this work order's governance policy.</p>}
            {!tasks.length ? (
                <Card>
                    <p>Technical task assessment is required before planning and execution.</p>
                    {(wo.tasks?.length || wo.spares?.length) > 0 && (
                        <details className="mt-3">
                            <summary>Previous maintenance record</summary>
                            <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">
                                {JSON.stringify({ tasks: wo.tasks, spares: wo.spares, services: wo.services, tools: wo.tools }, null, 2)}
                            </pre>
                        </details>
                    )}
                </Card>
            ) : (
                <div className="space-y-3">
                    <TaskMenu
                        tasks={tasks}
                        current={task}
                        executions={wo.taskExecution || {}}
                        onPick={(id) => {
                            setSelected(id);
                            setTab('Details');
                        }}
                    />
                    <Card className="min-w-0 space-y-4">
                        <div>
                            <p className="font-mono text-xs font-semibold text-brandsoft">{task.code || 'ASSMTASK_' + (tasks.indexOf(task) + 1)}</p>
                            <h2 className="text-lg font-semibold">{task.title || task.description}</h2>
                            <p className="text-xs text-soft">
                                {retrospective?'Actual work · no prospective plan':`${task.priority || 'normal'} priority · ${task.hours} estimated hours`}
                            </p>
                        </div>
                        <nav aria-label="Task sections" className="flex gap-2 overflow-auto pb-1">
                            {(retrospective?['Details','Execution']:['Details', 'Spares', 'Services', 'Personnel', 'Tools', 'Equipment', 'Risk assessment', 'Execution']).map((s) => (
                                <button
                                    key={s}
                                    className={`shrink-0 rounded-xl px-3 py-2 text-sm ${tab === s ? 'bg-brand text-onbrand' : 'border border-line text-soft'}`}
                                    onClick={() => setTab(s)}
                                >
                                    {s}
                                </button>
                            ))}
                        </nav>
                        {tab === 'Details' && (retrospective?<p className="whitespace-pre-wrap">{task.description}</p>:<Details task={task}/>)}
                        {tab === 'Risk assessment' && <MntRiskTable risks={task.risk || []} />}
                        {tab === 'Spares' && (
                            <div className="space-y-3">
                                {(task.spares || []).map((s: MntData) => {
                                    const r = data.readiness.items.find((r: MntData) => r.taskId === task.id && r.spareId === s.id) || {},
                                        p = planning[s.id] || {};
                                    const editable = can.plan && ['planning', 'plan_ready', 'released', 'scheduled', 'in_progress'].includes(wo.status) && !execution.startedAt;
                                    const hasCode = !!(p.materialId || ['warehouse', 'material'].includes(s.source));
                                    return (
                                        <section key={s.id} className="min-w-0 space-y-3 rounded-xl border border-line p-4">
                                            <div className="flex flex-wrap items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <h3 className="break-words font-semibold">{s.description}</h3>
                                                    <p className="text-xs text-soft">
                                                        {SOURCE_LABEL[s.source] || s.source} · required {s.qty} {s.uom}
                                                        {s.requiredDate ? ' by ' + s.requiredDate : ''}
                                                    </p>
                                                </div>
                                                <ResourceStatus status={r.status} />
                                            </div>
                                            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                                                {[
                                                    ['Usable in warehouse', r.available ?? '—'],
                                                    ['Reserved / issued', r.reserved ?? 0],
                                                    ['Shortage', r.shortage ?? s.qty],
                                                    ['Unit cost', r.unitCost ?? 'Pending sourcing'],
                                                ].map(([k, v]) => (
                                                    <div key={k} className="min-w-0">
                                                        <p className="truncate text-xs text-muted">{k}</p>
                                                        <p className="mt-1 font-semibold tabular-nums">{v}</p>
                                                    </div>
                                                ))}
                                            </div>
                                            {(s.specifications || s.function) && (
                                                <p className="break-words text-sm text-soft">
                                                    {s.function ? 'Function: ' + s.function + '. ' : ''}
                                                    {s.specifications}
                                                </p>
                                            )}
                                            {r.supply?.kind === 'replenishment' && (
                                                <p className="text-xs text-soft">Shortage of {r.supply.qty} is covered by the open replenishment {r.supply.requirementId}; no second purchase was raised.</p>
                                            )}
                                            <FulfilmentTrack procurement={r.procurement} onOpen={(id) => navigate('organization_admin/purchase_requirements/' + id)} />
                                            {p.candidateId && !p.materialDraftId && (
                                                <p className="text-xs text-amber-500">
                                                    Material candidate queued for Materials Master review ({String(p.status || 'pending').replaceAll('_', ' ')}).
                                                </p>
                                            )}
                                            {p.materialDraftId && !p.materialId && (
                                                <button className="text-sm underline" onClick={() => navigate('organization_admin/material_catalog')}>
                                                    Material draft {p.materialDraftId} in approval
                                                </button>
                                            )}
                                            {editable && (
                                                <div className="flex flex-wrap gap-2">
                                                    {hasCode && r.shortage > 0 && !['awaiting_procurement', 'linked_replenishment', 'received_reserve'].includes(r.status) && (
                                                        <Button testOverride={!!data.testModeOverride} onClick={() => open('secure_spare', s, p)}>
                                                            {r.status === 'awaiting_verification' ? 'Verify and submit requirement' : 'Reserve and cover shortage'}
                                                        </Button>
                                                    )}
                                                    {r.status === 'received_reserve' && (
                                                        <Button testOverride={!!data.testModeOverride} busy={busy} onClick={() => run('reserve', { taskId: task.id, resourceId: s.id })}>
                                                            Reserve received stock
                                                        </Button>
                                                    )}
                                                    {!hasCode && (
                                                        <Button testOverride={!!data.testModeOverride} disabled={!!p.materialDraftId} onClick={() => open('candidate', s, p)}>
                                                            Send for material creation
                                                        </Button>
                                                    )}
                                                    {!hasCode && !p.materialDraftId && (
                                                        <Button testOverride={!!data.testModeOverride} variant="secondary" onClick={() => open('match_spare', s, p)}>
                                                            Match an approved stock material
                                                        </Button>
                                                    )}
                                                </div>
                                            )}
                                        </section>
                                    );
                                })}
                                {!task.spares?.length && <p>No spare requirements for this task.</p>}
                            </div>
                        )}
                        {tab === 'Services' && (
                            <div className="space-y-3">
                                {(task.services || []).map((s: MntData) => {
                                    const p = planning[s.id] || {},
                                        r = data.readiness.items.find((x: MntData) => x.taskId === task.id && x.serviceId === s.id) || {};
                                    const editable = can.plan && ['planning', 'plan_ready', 'released', 'scheduled', 'in_progress'].includes(wo.status) && !execution.startedAt;
                                    return (
                                        <section key={s.id} className="min-w-0 space-y-3 rounded-xl border border-line p-4">
                                            <div className="flex flex-wrap items-start justify-between gap-2">
                                                <h3 className="min-w-0 break-words font-semibold">{s.description}</h3>
                                                <ResourceStatus status={r.status || 'awaiting_sourcing'} />
                                            </div>
                                            <OrderedStepReview label='Scope' values={legacySteps(s.scopeSteps,s.scope,s.instructions)}/>{(s.justification||s.justificationReasons?.length>0)&&<div className="rounded-lg bg-page p-2 text-sm"><p className="font-medium">External service justification</p><p>{serviceJustificationLabels(s.justificationReasons)}</p><p className="whitespace-pre-wrap break-words">{s.justification}</p>{!!s.missingSkillCodes?.length&&<p>Missing skills: {(s.skillRequirements||[]).filter((r:MntData)=>s.missingSkillCodes.includes(r.skillCode)).map((r:MntData)=>r.skillLabel||r.skillCode).join('; ')}</p>}</div>}{s.specialistRequired&&<div className="text-sm text-soft"><p>External specialist support</p>{s.skillRequirements?.map((r:MntData)=><p key={r.skillCode}>{r.skillLabel||r.skillCode} · {r.level}</p>)}</div>}
                                            <dl className="grid gap-2 text-sm sm:grid-cols-2">
                                                {[
                                                    ['Deliverables', s.deliverables],
                                                    ['Acceptance', s.acceptanceCriteria],
                                                    ['Competencies', s.qualifications],['Certifications',s.certifications],
                                                    ['People / duration', `${s.personnel ?? '—'} people · ${s.durationHours ?? '—'} h · qty ${s.quantity ?? 1}`],
                                                    ['Planned execution date', p.executionDate||s.executionDate],
                                                    ['Estimated service cost', p.expectedCost??s.expectedCost??'Not estimated'],
                                                    ['Supplier', p.sourcing ? `${p.sourcing.supplierCategoryLabel}${p.sourcing.preferredVendorName ? ' · ' + p.sourcing.preferredVendorName : ' · onboarding requested (' + (p.sourcing.suggestedVendor || '') + ')'}` : s.supplierCategoryLabel || s.supplierCategory || 'Not confirmed'],
                                                ].map(([k, v]) => (
                                                    <div key={k} className="min-w-0 rounded-lg bg-page p-2">
                                                        <dt className="text-xs text-muted">{k}</dt>
                                                        <dd className="break-words">{v || '—'}</dd>
                                                    </div>
                                                ))}
                                            </dl>
                                            <FulfilmentTrack procurement={r.procurement} onOpen={(id) => navigate('organization_admin/purchase_requirements/' + id)} />
                                            {p.status === 'secured' && <p className="text-xs text-soft">Secured on {p.poId} line {p.lineNo}{p.vendorName ? ' · ' + p.vendorName : ''} · ready {p.readyAt}</p>}
                                            {editable && (
                                                <div className="flex flex-wrap gap-2">
                                                    {!p.requirementId && (
                                                        <Button testOverride={!!data.testModeOverride} variant={p.sourcing ? 'secondary' : 'primary'} onClick={() => open('service_sourcing', s, p)}>
                                                            {p.sourcing ? 'Change supplier' : 'Choose supplier'}
                                                        </Button>
                                                    )}
                                                    {p.sourcing && !p.requirementId && (
                                                        <Button testOverride={!!data.testModeOverride} onClick={() => open('procure', s, p)}>Raise purchase requirement</Button>
                                                    )}
                                                    {p.requirementId && p.status !== 'secured' && (
                                                        <Button testOverride={!!data.testModeOverride} variant={r.orderReady ? 'primary' : 'secondary'} onClick={() => open('secure_service', s, { ...p, item: r })}>
                                                            Confirm service order
                                                        </Button>
                                                    )}
                                                </div>
                                            )}
                                        </section>
                                    );
                                })}
                                {task.externalResource?.type&&<section className="rounded-xl border border-line p-3 space-y-2"><h3 className="font-semibold">External specialist support</h3><p className="text-sm">{task.externalResource.persons} people · {task.externalResource.hours??'—'} hours per person</p><p className="text-sm text-soft">{task.externalResource.notes}</p>{task.externalResource.skillRequirements?.map((r:MntData)=><p key={r.skillCode} className="text-sm">{r.skillLabel||r.skillCode} · {r.level}</p>)}<p className="text-xs text-soft">Confirm provider, availability and booking evidence in the Planning Readiness Checklist.</p></section>}{!task.services?.length&&!task.externalResource?.type && <p>No external services for this task.</p>}
                            </div>
                        )}
                        {tab === 'Personnel' && (
                            <div className="space-y-3">
                                <p>
                                    {task.persons} people · Skills: {task.skills}{Array.isArray(task.internalRoleRequirements)&&task.internalRoleRequirements.map((r:MntData)=><span key={r.roleCode} className='block text-xs text-soft'>{r.roleLabel||r.roleCode} · {r.persons} people × {Number(r.hours).toFixed(1)} hours</span>)}
                                </p>
                                {wo.taskStandardSnapshots?.[task.id]&&<MntStandardHistory key={wo.code+':'+task.id} code={wo.code} taskId={task.id} standard={wo.taskStandardSnapshots[task.id]}/>}
                                <section className='rounded-xl border border-line p-3 text-sm space-y-1'><b>Planning overhead</b>{(planning.allocation?.overheadRoles??task.overheadRoles??[]).map((r:MntData)=><p key={r.roleCode}>{r.roleLabel||r.roleCode} · {r.persons} × {Number(r.hours).toFixed(1)} h · {(Number(r.persons)*Number(r.hours)).toFixed(1)} person-hours</p>)}{!(planning.allocation?.overheadRoles??task.overheadRoles??[]).length&&<p className='text-soft'>No additional overhead resources.</p>}</section>
                                <p>
                                    Allocated:{' '}
                                    {(planning.allocation?.personnel || [])
                                        .map((id: string) => data.people.find((p: MntData) => p.id === id)?.name || id)
                                        .join(', ') || 'Pending'}
                                </p>
                                {can.plan &&
                                    ['planning', 'plan_ready', 'released', 'scheduled', 'in_progress'].includes(wo.status) &&
                                    !execution.startedAt && (
                                        <Button testOverride={!!data.testModeOverride} variant="secondary" onClick={() => open('allocate', {}, planning.allocation || {})}>
                                            Allocate personnel
                                        </Button>
                                    )}
                            </div>
                        )}
                        {(tab==='Tools'||tab==='Equipment')&&<MntResourceBooking key={task.id+':'+tab} code={code} kind={tab} task={task as any} planning={planning} canPlan={!!can.plan&&!execution.startedAt&&['planning','plan_ready','released','scheduled','in_progress'].includes(wo.status)} onRun={run}/>}
                        {tab === 'Execution' && (
                            <div className="space-y-4">
                                {!retrospective&&<MntPersonalTime key={wo.code+':'+task.id} woCode={wo.code} taskId={task.id}/>}
                                <p className="text-sm">
                                    Status: {execution.status?.replaceAll('_', ' ') || 'Not started'}
                                    {execution.blockReason ? ' · ' + execution.blockReason : ''}
                                </p>
                                <p className="text-xs text-soft">
                                    {retrospective?'Actual work date: '+execution.performedDate+' · '+execution.actualMinutes+' minutes':`Actual start: ${execution.startedAt || 'Pending'} · Completion: ${execution.completedAt || 'Pending'}`}
                                </p>
                                {can.execute && !wo.safetySignoff && !['closed', 'cancelled'].includes(wo.status) && (
                                    <div className="flex flex-wrap gap-2">
                                        
                                        {!retrospective&&!wo.earlyClosureRequest&&(!execution.status||execution.status==='blocked') && (
                                            <Button testOverride={!!data.testModeOverride} busy={busy} onClick={() => run('start_task', { taskId: task.id })}>
                                                {execution.status === 'blocked' ? 'Resume task' : 'Start task'}
                                            </Button>
                                        )}
                                        {!retrospective&&execution.status==='in_progress'&&<Button testOverride={!!data.testModeOverride} variant="secondary" busy={busy} onClick={()=>run('finish_task_execution',{taskId:task.id})}>Physical work complete</Button>}
                                        {!retrospective&&['in_progress', 'blocked','awaiting_feedback'].includes(execution.status) && (
                                            <>
                                                <Button testOverride={!!data.testModeOverride} variant="secondary" onClick={() => open('feedback')}>
                                                    Record completion feedback
                                                </Button>
                                                {execution.status!=='awaiting_feedback'&&<Button testOverride={!!data.testModeOverride} variant="secondary" onClick={() => open('block_task')}>Mark blocked</Button>}
                                            </>
                                        )}
                                        {execution.status === 'completed' && !execution.reconciled && (
                                            <Button testOverride={!!data.testModeOverride} variant="secondary" onClick={() => open('consumption')}>
                                                <Package size={16} />
                                                Confirm actual spares and BOM
                                            </Button>
                                        )}
                                    </div>
                                )}
                                {execution.consumptionProposal && (
                                    <div className="space-y-2 rounded-xl border border-line p-3">
                                        <p className="font-semibold">Actual usage confirmed by task executor</p>
                                        {execution.consumptionProposal.consumption.map((c: MntData) => (
                                            <p key={c.issueLineId} className="text-sm">
                                                {c.description}: issued {c.issued} · consumed {c.consumed} · returned {c.returned} {c.uom} ·{' '}
                                                {c.installed ? 'Installed BOM component' : 'Consumable / unused'}
                                            </p>
                                        ))}
                                        {can.reconcile && !execution.reconciled && (
                                            <Button testOverride={!!data.testModeOverride} busy={busy} onClick={() => run('reconcile_task', { taskId: task.id })}>
                                                Stores: reconcile returns and update BOM
                                            </Button>
                                        )}
                                    </div>
                                )}
                                {!retrospective&&<WorkOrderVouchers code={code} />}
                                {(task.services||[]).map((s:MntData)=>{const report=wo.serviceReports?.[task.id]?.[s.id];return report?<p key={s.id} className="text-sm"><a className="underline" target="_blank" rel="noreferrer" href={data.serviceReportUrls?.[report.path]}>{s.description} · {report.filename}</a></p>:execution.status==='completed'&&wo.status!=='closed'&&can.execute?<label key={s.id} className="block text-sm">Missing report: {s.description}<input type="file" accept=".pdf,application/pdf" className={mntInput} disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>1500000)throw Error('PDF must be at most 1.5 MB.');const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});await run('upload_service_report',{taskId:task.id,serviceId:s.id,data,filename:file.name});}catch(err){setFailure(err instanceof Error?err.message:'Upload failed');}}}/></label>:null;})}
                                {execution.feedback && (
                                    <div className="space-y-2 rounded-xl border border-line p-3">
                                        {Object.entries(execution.feedback)
                                            .filter(([k, v]) => typeof v === 'string' && v)
                                            .map(([k, v]) => (
                                                <p key={k} className="text-sm">
                                                    <span className="font-semibold">{k.replace(/([A-Z])/g, ' $1')}: </span>
                                                    {String(v)}
                                                </p>
                                            ))}
                                    </div>
                                )}
                                {execution.reconciled && (
                                    <p className="text-sm text-emerald-500">
                                        {retrospective?'No spare parts or external services confirmed · ': 'Actual spares reconciled · '}
                                        {execution.bomUpdated
                                            ? 'Installed materials mapped to BOM'
                                            : 'BOM reviewed; no installed component changes'}
                                    </p>
                                )}
                            </div>
                        )}
                    </Card>
                </div>
            )}
            <Card className="space-y-4">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <ShieldCheck size={19} />
                    {data.windowClosureManaged?'Maintenance window closure':'Closure'}
                </h2>
                {data.windowClosureManaged?<div className="space-y-2"><p className="text-sm text-soft">Safety sign-off closes the work orders through the maintenance window. Record task feedback and reconcile materials here.</p><Button variant="secondary" onClick={()=>navigate('organization_admin/maintenance_windows')}>Open maintenance windows</Button></div>:<div className="grid gap-2 text-sm sm:grid-cols-3">
                    {[
                        ['Safety sign-off', wo.safetySignoff],
                    ].map(([label, v]) => (
                        <div key={label} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
                            <p className="font-semibold">{label}</p>
                            <p className="mt-1 text-soft">{v ? `${v.name} · ${new Date(v.at).toLocaleString()}` : ['closed','cancelled'].includes(wo.status)&&wo.earlyClosure?.outcome==='not_started'?'Not applicable — no work performed':'Pending'}</p>
                        </div>
                    ))}
                </div>}
                <div className="flex flex-wrap gap-2">
                    {can.safety && wo.status!=='closed' && (
                        <>
                            {can.signoff&&!data.windowClosureManaged&&(!retrospective||wo.directCompletion?.reportedWork)&&<Button testOverride={!!data.testModeOverride} variant="secondary" onClick={() => wo.safetySignoff?run('safety_signoff',{}):open('safety_signoff')}>{wo.safetySignoff?'Close work order':'Safety sign-off & close'}</Button>}
                            <Button testOverride={!!data.testModeOverride} variant="secondary" onClick={() => open('report_incident')}>
                                Report incident / near miss
                            </Button>
                        </>
                    )}
                </div>
                {data.incidents.map((i: MntData) => (
                    <div key={i.id} className="rounded-xl border border-line p-3 text-sm">
                        <p className="font-semibold">
                            {i.id} · {i.classification} · {i.status}
                        </p>
                        <p>{i.narrative}</p>
                        {can.safety && i.status === 'open' && (
                            <Button testOverride={!!data.testModeOverride} variant="secondary" onClick={() => open('clear_incident', i)}>
                                Record independent safety clearance
                            </Button>
                        )}
                    </div>
                ))}
            </Card>
            <details className="rounded-2xl border border-line bg-panel p-4">
                <summary className="cursor-pointer font-semibold">Audit history</summary>
                <ol className="mt-3 space-y-3">
                    {(wo.history || []).map((h: MntData, i: number) => (
                        <li key={i} className="border-b border-line pb-2 text-sm">
                            <p>
                                {h.action} · {h.name}
                            </p>
                            <p className="text-xs text-soft">
                                {h.at} · {h.note}
                            </p>
                        </li>
                    ))}
                </ol>
            </details>
            {dialog?.kind==='create_break_in'&&<MntDialog title="Create break-in sub-order" onClose={()=>setDialog(null)}><div className="space-y-3"><p className="text-sm">Parent: {wo.code} · {wo.wrCode||'No original request'} · Break-in Maintenance</p><ExpectedDateHelp/><p className="text-xs text-soft">Scheduled dates initially match expected dates.</p>{[['title','Job title','text'],['description','Additional work required','text'],['scheduledStart','Expected start date','date'],['scheduledEnd','Expected end date','date']].map(([k,l,t])=><MntField key={k} label={l} type={t} multiline={k==='description'} value={form[k]} onChange={v=>setForm(old=>({...old,[k]:v}))}/>)}<Button busy={busy} disabled={!form.title||!form.description||!form.scheduledStart||!form.scheduledEnd||form.scheduledEnd<form.scheduledStart} onClick={async()=>{setBusy(true);setFailure('');try{const result=await callBackend<MntData>('/api/org/mnt/wo/action',{code,action:'create_break_in',...form});setDialog(null);navigate('organization_admin/work_orders/'+result.woCode);}catch(e){setFailure(e instanceof Error?e.message:'Unable to create sub-order');}finally{setBusy(false);}}}>Create sub-order</Button>{failure&&<MntGateHint message={failure}/>}</div></MntDialog>}
            {dialog && dialog.kind!=='create_break_in' && (
                <MntDialog title={({ secure_spare: 'Secure spare', service_sourcing: 'Supplier for this service', procure: 'Raise purchase requirement', secure_service: 'Confirm service order' } as Record<string, string>)[dialog.kind] || dialog.kind.replaceAll('_', ' ')} onClose={() => setDialog(null)}>
                    {['allocate', 'match_spare', 'candidate', 'procure', 'secure_spare', 'service_sourcing', 'secure_service'].includes(dialog.kind) ? (
                        <ResourceForm
                            kind={dialog.kind}
                            code={code}
                            expectedStart={wo.expectedStart||wo.initialScheduledStart||wo.scheduledStart}
                            task={task}
                            resource={dialog.resource}
                            previous={dialog.previous}
                            item={dialog.previous?.item || data.readiness.items.find((x: MntData) => x.taskId === task.id && (x.spareId === dialog.resource?.id || x.serviceId === dialog.resource?.id)) || {}}
                            people={data.people}
                            workGroup={data.workGroup}
                            onRun={run}
                            onClose={() => setDialog(null)}
                        />
                    ) : dialog.kind === 'feedback' ? (
                        <FeedbackForm
                            task={task}
                            execution={execution}
                            wo={wo}
                            onSubmit={(body) => submitDialog('complete_task', { taskId: task.id, ...body })}
                        />
                    ) : dialog.kind === 'consumption' ? (
                        <ConsumptionForm
                            task={task}
                            issues={data.issues}
                            onSubmit={(body) => submitDialog('confirm_consumption', { taskId: task.id, ...body })}
                        />
                    ) : (
                        <div className="space-y-3">
                            {dialog.kind === 'safety_signoff' && (
                                <>
                                    <div className="block text-sm"><MntSelect label="Incident and near-miss declaration"
                                           
                                            className={mntInput}
                                            value={form.declaration || ''}
                                            onChange={(e) => setForm({ ...form, declaration: e.target.value })}
                                        >
                                            <option value="">Choose explicitly</option>
                                            <option value="none">No incidents or near misses</option>
                                            <option value="reported">Incident / near miss reported</option>
                                        </MntSelect></div>
                                    {form.declaration === 'none' && (
                                        <MntCheck
                                            label="No safety incidents or near misses occurred during this maintenance activity."
                                            value={!!form.noIncidentsConfirmed}
                                            onChange={(v) => setForm({ ...form, noIncidentsConfirmed: v })}
                                        />
                                    )}
                                </>
                            )}
                            {(dialog.kind === 'report_incident' ||
                                (dialog.kind === 'safety_signoff' && form.declaration === 'reported')) && (
                                <>
                                    {['classification', 'narrative', 'immediateControls', 'followUp', 'peopleOrRoles'].map((k) => (
                                        <MntField
                                            key={k}
                                            label={k.replace(/([A-Z])/g, ' $1')}
                                            value={form[k]}
                                            multiline
                                            onChange={(v) => setForm({ ...form, [k]: v })}
                                        />
                                    ))}
                                    <MntField
                                        label="Occurred at"
                                        type="datetime-local"
                                        value={form.occurredAt}
                                        onChange={(v) => setForm({ ...form, occurredAt: v })}
                                    />
                                    {dialog.kind === 'safety_signoff' && (
                                        <>
                                            <div className="block text-sm"><MntSelect label="Cleared incident reference"
                                                    className={mntInput}
                                                   
                                                    value={form.incidentId || ''}
                                                    onChange={(e) => setForm({ ...form, incidentId: e.target.value })}
                                                >
                                                    <option value="">Choose cleared incident</option>
                                                    {data.incidents
                                                        .filter((i: MntData) => i.status === 'cleared')
                                                        .map((i: MntData) => (
                                                            <option key={i.id} value={i.id}>
                                                                {i.id} · {i.classification}
                                                            </option>
                                                        ))}
                                                </MntSelect></div>
                                            <MntCheck
                                                label="Incident containment and safety clearance are confirmed."
                                                value={!!form.clearanceConfirmed}
                                                onChange={(v) => setForm({ ...form, clearanceConfirmed: v })}
                                            />
                                        </>
                                    )}
                                </>
                            )}
                            {dialog.kind==='early_close'&&<><MntField label={'Confirm order '+code} value={form.confirm} onChange={v=>setForm({...form,confirm:v})}/><MntCheck label="I confirm this is early closure, no PO commitment remains, and unfinished work is not certified complete." value={!!form.noCommitmentConfirmed} onChange={v=>setForm({...form,noCommitmentConfirmed:v})}/></>}
                            {dialog.kind === 'cancel_order' && (
                                <MntField
                                    label={'Type ' + code + ' to confirm cancellation'}
                                    value={form.confirm}
                                    onChange={(v) => setForm({ ...form, confirm: v })}
                                />
                            )}
                            {dialog.kind !== 'report_incident' && (
                                <MntField
                                    label="Review notes / reason"
                                    value={form.note}
                                    multiline
                                    onChange={(v) => setForm({ ...form, note: v })}
                                />
                            )}
                            <Button testOverride={!!data.testModeOverride}
                                busy={busy}
                                onClick={() =>
                                    submitDialog(dialog.kind, {
                                        ...form,
                                        taskId: task?.id,
                                        receivingParty: data.currentUserId,
                                        incidentId: dialog.kind === 'clear_incident' ? dialog.resource.id : form.incidentId,
                                    })
                                }
                            >
                                Confirm {dialog.kind.replaceAll('_', ' ')}
                            </Button>
                        </div>
                    )}
                    {failure && (
                        <div className="mt-3">
                            <MntGateHint message={failure} />
                        </div>
                    )}
                </MntDialog>
            )}
            </>}
        </div>
    );
}
