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
import { FulfilmentTrack, ResourceStatus, SOURCE_LABEL, useVendors } from './mntSourcing';
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
        next.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
            <p className="whitespace-pre-wrap">{task.description}</p>
            <div className="grid gap-3 sm:grid-cols-2">
                {[
                    ['Work instructions', task.instructions],
                    ['Completion criteria', task.completionCriteria],
                    ['Required skills', task.skills],
                    [
                        'People / estimated labour',
                        `${task.persons} people · ${task.hours} hours · ${Number(task.persons) * Number(task.hours)} labour hours`,
                    ],
                    ['Tools and special equipment', task.tools],
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
        materialId: '',
        warehouseId: '',
        catalogCode: resource.catalogCode || '',
        attributes: { ...resource.attributes },
        dateRequired: resource.requiredDate || resource.executionDate || '',
        urgency: 'medium',
        supplierCategory: previous.sourcing?.supplierCategory || resource.supplierCategory || '',
        preferredVendorId: previous.sourcing?.preferredVendorId || resource.proposedVendorIds?.[0] || '',
        poId: item.orderReady?.id || '',
        lineNo: item.orderReady?.lineNo || '',
        readyAt: resource.executionDate || '',
    });
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
                        Required: {task.persons} people · {task.skills}. Tools: {task.tools || 'None'}.
                    </p>
                    <div className="rounded-xl border border-line p-3">
                        <p className="font-semibold">{workGroup ? workGroup.code+' · '+workGroup.name : 'No work group configured for this cost center'}</p>
                        <p className="mt-1 text-xs text-soft">{people.filter(p=>p.inWorkGroup===true).length} eligible work group members. Outside-group selection is off by default.</p>
                        <div className="mt-3"><MntCheck label="Include employees outside the work group" value={includeOutsideGroup} onChange={setIncludeOutsideGroup}/></div>
                        {!includeOutsideGroup&&outsideSelected.length>0&&<Alert tone="warn">Previously selected outside-group employees are retained for review only. To save them, explicitly enable outside-group selection again, or remove them below.</Alert>}
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
                    <MntCheck
                        label="Required tools, special equipment, documentation and safety equipment are available."
                        value={!!data.toolsReady}
                        onChange={(v) => patch('toolsReady', v)}
                    />
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
                        <label className="block text-sm text-soft">
                            Warehouse that will receive and issue it
                            <select data-native-select="true" className={mntInput} value={data.warehouseId} onChange={(e) => patch('warehouseId', e.target.value)}>
                                <option value="">Choose warehouse</option>
                                {warehouses.map((w) => (
                                    <option key={w.id} value={w.id}>{w.name}</option>
                                ))}
                            </select>
                        </label>
                    )}
                    <MntField label="Date required" type="date" value={data.dateRequired} onChange={(v) => patch('dateRequired', v)} />
                    <MntField label={kind === 'secure_spare' ? 'GL account (used only if a purchase is needed)' : 'Approved GL account for this purchase'} value={data.glCode} onChange={(v) => patch('glCode', v)} />
                    <label className="block text-sm text-soft">
                        Urgency
                        <select data-native-select="true" className={mntInput} value={data.urgency} onChange={(e) => patch('urgency', e.target.value)}>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                        </select>
                    </label>
                    <MntField label="Indicative budget (optional)" type="number" value={data.budget} onChange={(v) => patch('budget', v)} />
                </>
            )}
            {kind === 'service_sourcing' && (
                <>
                    <p className="text-sm text-soft">
                        Choose the supplier category, then an approved vendor qualified for this service. For OEM and OCM, vendors representing the equipment make are listed. If none is suitable, request supplier onboarding.
                    </p>
                    <label className="block text-sm text-soft">
                        Supplier category
                        <select data-native-select="true" className={mntInput} value={data.supplierCategory} onChange={(e) => setData((o) => ({ ...o, supplierCategory: e.target.value, preferredVendorId: '' }))}>
                            <option value="">Choose</option>
                            {vendors.categories.map((c) => (
                                <option key={c.code} value={c.code}>{c.label}</option>
                            ))}
                        </select>
                    </label>
                    {vendors.error && <Alert tone="error">{vendors.error}</Alert>}
                    {data.supplierCategory && !vendors.loading && (
                        <fieldset className="space-y-2">
                            <legend className="text-sm text-soft">Approved vendors ({vendors.vendors.length})</legend>
                            {vendors.vendors.map((v) => (
                                <label key={v.id} className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
                                    <input type="radio" name="vendor" className="mt-1" checked={data.preferredVendorId === v.id} onChange={() => patch('preferredVendorId', v.id)} />
                                    <span className="min-w-0">
                                        <span className="block truncate font-medium">{v.name}</span>
                                        <span className="block truncate text-xs text-muted">{[v.id, v.manufacturerMatch ? 'Represents ' + (vendors.make.manufacturer || vendors.make.brand) : '', v.brands.join(', ')].filter(Boolean).join(' · ')}</span>
                                    </span>
                                </label>
                            ))}
                            <label className="flex items-start gap-3 rounded-xl border border-dashed border-line p-3 text-sm">
                                <input type="radio" name="vendor" className="mt-1" checked={data.preferredVendorId === ''} onChange={() => patch('preferredVendorId', '')} />
                                <span>No suitable approved vendor — request supplier onboarding</span>
                            </label>
                            {vendors.others.length > 0 && <p className="text-xs text-muted">{vendors.others.length} other vendor(s) of this category do not represent the equipment make.</p>}
                        </fieldset>
                    )}
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
                    <label className="block text-sm text-soft">
                        Planned requirement or additional material
                        <select
                            data-native-select="true"
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
                        </select>
                    </label>
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
                    <label className="block text-sm text-soft">
                        Installed as an equipment / assembly component?
                        <select
                            data-native-select="true"
                            className={mntInput}
                            value={consumption[i].installed}
                            onChange={(e) => patch(i, 'installed', e.target.value)}
                        >
                            <option value="">Choose explicitly</option>
                            <option value="yes">Yes, update the task equipment or assembly BOM</option>
                            <option value="no">No, consumable / unused item</option>
                        </select>
                    </label>
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
 const [form,setForm]=useState<MntData>({technicalEvaluation:wo.technicalEvaluation||'',natureCode:wo.natureCode||'',severityCode:wo.severitySetBy?wo.criticalityCode:'',solutionCodes:(wo.solutions||[]).map((s:MntData)=>s.code),maintenanceTypeCode:wo.maintenanceTypeCode||'',priorityCode:wo.priorityCode||'',assemblyId:wo.assemblyId||'',note:wo.assessmentNote||'',scheduledStart:wo.scheduledStart||'',scheduledEnd:wo.scheduledEnd||'',dateChangeReason:''});
 const [busy,setBusy]=useState(false),[err,setErr]=useState('');const set=(k:string,v:any)=>setForm(old=>({...old,[k]:v}));
 const l: MntLists|null|undefined=setup.data?.lists;
 const dateChanged=form.scheduledStart!==wo.scheduledStart||form.scheduledEnd!==wo.scheduledEnd,restricted=!!cycle?.restrictedTypes?.includes(form.maintenanceTypeCode),newAdmission=form.scheduledStart!==wo.scheduledStart||restricted&&!cycle?.restrictedTypes?.includes(wo.maintenanceTypeCode),minDate=newAdmission?(restricted?cycle?.nextStart:cycle?.today):undefined;
 const moves=Math.max(Number(wo.startDateMoves)||0,(wo.dateChanges||[]).filter((x:MntData)=>x.fromStart&&x.fromStart!==x.toStart).length);
 const dateInvalid=(moves>=2&&form.scheduledStart!==wo.scheduledStart)||!form.scheduledStart||!form.scheduledEnd||form.scheduledEnd<form.scheduledStart||!!minDate&&form.scheduledStart<minDate||dateChanged&&form.dateChangeReason.trim().length<10;
 if(!can)return <Card className="space-y-2"><p className="font-semibold">Technical assessment classification</p><p className="text-sm">{wo.technicalEvaluation||'Awaiting assessor'}</p><p className="text-sm text-soft">{[wo.natureLabel,wo.criticalityLabel,wo.maintenanceTypeLabel].filter(Boolean).join(' · ')}</p></Card>;
 if(!l)return <Card><p className="text-sm">{setup.error||'Loading assessment metadata…'}</p></Card>;
 const save=async()=>{setBusy(true);setErr('');try{await callBackend('/api/org/mnt/wo/action',{code:wo.code,action:'assess_header',...form});onDone();}catch(e){setErr(e instanceof Error?e.message:'Unable to save');}finally{setBusy(false);}};
 return <Card className="space-y-3"><p className="font-semibold">1. Technical assessment classification</p><label className="block text-sm">Assembly (optional)<select className={mntInput} disabled={!!wo.assessmentTasks?.length} value={form.assemblyId} onChange={e=>set('assemblyId',e.target.value)}><option value="">Equipment level</option>{options.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}{form.assemblyId&&!options.some(a=>a.id===form.assemblyId)&&<option value={form.assemblyId}>{wo.assemblyName}</option>}</select></label><MntField label="Technical evaluation *" value={form.technicalEvaluation} multiline onChange={v=>set('technicalEvaluation',v)}/><ChoicePicker title="Failure mode" required groups={l.failureModes} selected={form.natureCode?[form.natureCode]:[]} onToggle={v=>set('natureCode',form.natureCode===v?'':v)}/><ChoicePicker title="Solution categories" required multi max={5} groups={l.solutions} selected={form.solutionCodes} onToggle={v=>set('solutionCodes',form.solutionCodes.includes(v)?form.solutionCodes.filter((x:string)=>x!==v):form.solutionCodes.length<5?[...form.solutionCodes,v]:form.solutionCodes)}/>{[['severityCode','Severity *',l.criticality],['maintenanceTypeCode','Maintenance type *',l.maintenanceTypes],['priorityCode','Priority',l.priorities]].map(([key,label,items])=><label key={String(key)} className="block text-sm">{String(label)}<select className={mntInput} disabled={String(key)==='maintenanceTypeCode'&&!!wo.breakIn} value={form[String(key)]} onChange={e=>set(String(key),e.target.value)}><option value="">Select…</option>{String(key)==='maintenanceTypeCode'&&wo.breakIn?<option value="MAI-016">Break-in Maintenance</option>:(items as MntLists['criticality']).map(x=><option key={x.code} value={x.code}>{x.label}</option>)}</select></label>)}<div className="grid grid-cols-2 gap-2"><label className="block text-sm">Start date *<input className={mntInput} type="date" disabled={moves>=2} min={minDate} value={form.scheduledStart} onChange={e=>set('scheduledStart',e.target.value)}/></label><label className="block text-sm">End date *<input className={mntInput} type="date" min={form.scheduledStart} value={form.scheduledEnd} onChange={e=>set('scheduledEnd',e.target.value)}/></label></div><p className="text-xs text-soft">Scheduled start date changes: {moves}/2 {moves>=2?'· locked':''}</p>{minDate&&<p className="text-xs text-soft">Earliest new start: {minDate}</p>}{dateChanged&&<MntField label="Reason for date change *" value={form.dateChangeReason} onChange={v=>set('dateChangeReason',v)}/>}<MntField label="Assessment note" value={form.note} multiline onChange={v=>set('note',v)}/>{err&&<Alert tone="error">{err}</Alert>}<Button testOverride={testOverride} busy={busy} disabled={form.technicalEvaluation.trim().length<20||!form.natureCode||!form.severityCode||!form.solutionCodes.length||!form.maintenanceTypeCode||dateInvalid} onClick={save}>Save technical classification</Button></Card>;
}
export default function MntWorkOrder({ code }: { code: string }) {
    const { data, error, loading, reload } = useLoad(() => mntApi({ action: 'read', code }), [code]);
    const [reviewTab,setReviewTab]=useState<'status'|'details'>('status');
    const [selected, setSelected] = useState(''),
        [tab, setTab] = useState('Details'),
        [assessing, setAssessing] = useState(false),
        [assessmentReviewNote,setAssessmentReviewNote]=useState(''),
        [dialog, setDialog] = useState<MntData | null>(null),
        [message, setMessage] = useState(''),
        [failure, setFailure] = useState(''),
        [busy, setBusy] = useState(false),
        [form, setForm] = useState<MntData>({});
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
    if (assessing)
        return (
            <div className={screen.full ? screen.className + ' overflow-y-auto overscroll-contain' : ''} onFocusCapture={screen.keepInView}>
            {screen.full && (
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-page py-2">
                    <Button variant="secondary" aria-label="Back to work order" onClick={() => setAssessing(false)}>
                        <ArrowLeft size={16} />
                    </Button>
                    <p className="min-w-0 flex-1 truncate font-semibold">{wo.code} · task assessment</p>
                </div>
            )}
            <MntTaskAssessment
                code={code}
                context={{ asset: `${wo.assetTag} · ${wo.assetName || ''}`, assembly: wo.assemblyName, equipment: wo.unitName }}
                recordType="wo"
                breakIn={!!wo.breakIn}
                initial={tasks as any}
                editable
                onSaved={() => {
                    setAssessing(false);
                    reload();
                }}
                onCancel={() => setAssessing(false)}
            />
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
            {data.testModeOverride&&<MntTestDeletion kind="order" code={code} onDeleted={()=>navigate('organization_admin/work_orders')}/>}
            {wo.parentWoCode&&<Card className="space-y-2"><p className="font-semibold">Break-in Maintenance · sub-order</p><Button variant="secondary" onClick={()=>navigate('organization_admin/work_orders/'+wo.parentWoCode)}>Parent {wo.parentWoCode}</Button>{wo.rootWoCode&&wo.rootWoCode!==wo.parentWoCode&&<Button variant="secondary" onClick={()=>navigate('organization_admin/work_orders/'+wo.rootWoCode)}>Original {wo.rootWoCode}</Button>}</Card>}
            {(can.createBreakIn||data.subOrders?.length>0)&&<Card className="space-y-2"><h2 className="font-semibold">Break-in sub-orders</h2>{(data.subOrders||[]).map((x:MntData)=><Button key={x.code} variant="secondary" onClick={()=>navigate('organization_admin/work_orders/'+x.code)}>{x.code} · {x.title} · {x.status}</Button>)}{can.createBreakIn&&<Button onClick={()=>{open('create_break_in');const today=data.maintenanceCycle?.today||new Date().toISOString().slice(0,10);setForm({scheduledStart:today,scheduledEnd:today});}}>Create break-in sub-order</Button>}</Card>}
            <MaintenanceResponsibility record={wo}/>
            <div className="flex gap-2 rounded-xl border border-line p-1"><Button variant={reviewTab==='status'?'primary':'secondary'} onClick={()=>setReviewTab('status')}>Status review</Button><Button variant={reviewTab==='details'?'primary':'secondary'} onClick={()=>setReviewTab('details')}>Work Order details</Button></div>
            {reviewTab==='status'?<MntStatusReview data={data} onRefresh={reload}/>:<>
            {wo.executionMode==='confirmed_request'&&<OrderAssessmentHeader key={wo.code+':'+(wo.assessedAt||'new')} wo={wo} cycle={data.maintenanceCycle} options={data.assemblyOptions||[]} can={wo.status==='planning'&&!!can.assess&&!Object.keys(wo.taskPlanning||{}).length} testOverride={!!data.testModeOverride} onDone={reload}/>}
            {wo.workflowCode&&<Card className="space-y-2"><p className="text-xs text-soft">Operational state · {wo.workflowStatusCode||wo.workflowCode}</p><p className="font-semibold">{wo.workflowLabel}</p><p className="text-sm text-soft">Since {wo.workflowSince?new Date(wo.workflowSince).toLocaleString():'—'}</p>{wo.workflowReason&&<p className="text-sm">{wo.workflowReason}</p>}<details open><summary className="cursor-pointer text-sm font-semibold">State transition history ({(wo.workflowTransitions||[]).length})</summary><ol className="mt-2 space-y-2">{[...(wo.workflowTransitions||[])].reverse().map((e:MntData,i:number)=><li key={i} className="border-l-2 border-line pl-3 text-sm"><p className="font-medium">{e.from?(e.fromStatusCode||e.from)+' → ':''}{e.toStatusCode||e.to} · {e.label}</p><p className="text-xs text-soft">{new Date(e.at).toLocaleString()} · {e.byName||e.by} · {e.source}</p>{e.reason&&<p className="text-xs text-soft">{e.reason}</p>}</li>)}</ol></details></Card>}
            {retrospective&&<Card className="space-y-2"><h2 className="font-semibold">Work completed at request review</h2><p className="text-sm text-soft">Planning, resource preparation and maintenance window are not applicable. This record does not certify prior safety authorization.</p><p className="text-sm">Actual completion: {wo.directCompletion?.performedDate} · {wo.directCompletion?.durationMinutes} minutes</p><p className="text-sm">Performed by: {wo.directCompletion?.executor?.name} · {wo.directCompletion?.executor?.role}</p><p className="text-sm">Work performed: {wo.directCompletion?.reportedWork}</p><p className="text-sm">Maintenance type: {wo.maintenanceTypeLabel}</p><p className="text-sm">Failure mode: {wo.directCompletion?.failureModeLabel} · Cause: {wo.directCompletion?.causeLabel}</p><p className="text-sm">Solution: {(wo.directCompletion?.solutions||[]).map((s:MntData)=>s.label).join('; ')}</p><p className="text-sm text-soft">No spare parts or services declared. Labour valuation is separate from recorded time.{wo.finalCost?.pendingLabourValuation?' Labour valuation pending approved rate.':''}</p></Card>}
            {failure && <MntGateHint message={failure} />}
            {message && <Alert tone="info">{message}</Alert>}
            {can.earlyClose&&data.earlyClosure&&<Card className="space-y-2"><h2 className="font-semibold">Close work order at current stage</h2>{data.earlyClosure.blocked.length?<p className="text-sm text-soft">Committed PO: {data.earlyClosure.blocked.join(', ')}. Complete procurement and normal closure.</p>:<><p className="text-sm text-soft">{data.earlyClosure.started?'Record and reconcile actual work, then obtain safety sign-off. Unstarted tasks will remain unperformed.':'Unstarted scope will remain unperformed. Uncommitted maintenance purchase requirements and reservations will be released.'}</p>{data.earlyClosure.started&&!data.earlyClosure.requested?<Button variant="secondary" onClick={()=>open('prepare_early_close')}>Request early closure</Button>:<Button variant="secondary" onClick={()=>open('early_close')}>Close work order early</Button>}</>}</Card>}
            {wo.closureMode==='early'&&<Card className="space-y-1"><p className="font-semibold">Closed early · {wo.earlyClosure?.outcome==='not_started'?'Work not started':'Work stopped'}</p><p className="text-sm">{wo.earlyClosure?.note}</p><p className="text-xs text-soft">Unperformed tasks: {wo.earlyClosure?.skippedTaskIds?.length||0}</p></Card>}
            <div className="flex flex-wrap gap-2">
                {can.cancel && (
                    <Button testOverride={!!data.testModeOverride} variant="secondary" onClick={() => open('cancel_order')}>
                        Cancel work order
                    </Button>
                )}
                {wo.status === 'planning' && can.assess && (
                    <Button testOverride={!!data.testModeOverride} onClick={() => setAssessing(true)}>
                        <Wrench size={16} />
                        {tasks.length ? 'Edit task assessment' : 'Assess tasks and requirements'}
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
            {tasks.length > 0 && wo.assessmentReviewCurrent && data.checklist && (
                <MntReadiness code={code} wo={wo} cycle={data.maintenanceCycle} checklist={data.checklist} canPlan={!!can.plan} testModeOverride={!!data.testModeOverride} currency={data.currency || ''} onDone={reload} />
            )}
            {!retrospective&&tasks.length>0&&<Card className="space-y-3">
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
                            {(retrospective?['Details','Execution']:['Details', 'Spares', 'Services', 'Personnel & tools', 'Risk assessment', 'Execution']).map((s) => (
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
                                            <p className="break-words text-sm">{s.scope}</p>
                                            <dl className="grid gap-2 text-sm sm:grid-cols-2">
                                                {[
                                                    ['Deliverables', s.deliverables],
                                                    ['Acceptance', s.acceptanceCriteria],
                                                    ['Competencies', [s.qualifications, s.certifications].filter(Boolean).join(' · ')],
                                                    ['People / duration', `${s.personnel ?? '—'} people · ${s.durationHours ?? '—'} h · qty ${s.quantity ?? 1}`],
                                                    ['Execution date', s.executionDate],
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
                                {!task.services?.length && <p>No external services for this task.</p>}
                            </div>
                        )}
                        {tab === 'Personnel & tools' && (
                            <div className="space-y-3">
                                <p>
                                    {task.persons} people · Skills: {task.skills}
                                </p>
                                <p>Tools: {task.tools || 'None'}</p>
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
                                            Allocate personnel and confirm tools
                                        </Button>
                                    )}
                            </div>
                        )}
                        {tab === 'Execution' && (
                            <div className="space-y-4">
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
                            <p className="mt-1 text-soft">{v ? `${v.name} · ${new Date(v.at).toLocaleString()}` : 'Pending'}</p>
                        </div>
                    ))}
                </div>}
                <div className="flex flex-wrap gap-2">
                    {can.safety && wo.status!=='closed' && (
                        <>
                            {!data.windowClosureManaged&&(!retrospective||wo.directCompletion?.reportedWork)&&<Button testOverride={!!data.testModeOverride} variant="secondary" onClick={() => wo.safetySignoff?run('safety_signoff',{}):open('safety_signoff')}>{wo.safetySignoff?'Close work order':'Safety sign-off & close'}</Button>}
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
            {dialog?.kind==='create_break_in'&&<MntDialog title="Create break-in sub-order" onClose={()=>setDialog(null)}><div className="space-y-3"><p className="text-sm">Parent: {wo.code} · {wo.wrCode||'No original request'} · Break-in Maintenance</p>{[['title','Job title','text'],['description','Additional work required','text'],['scheduledStart','Scheduled start','date'],['scheduledEnd','Scheduled finish','date']].map(([k,l,t])=><MntField key={k} label={l} type={t} multiline={k==='description'} value={form[k]} onChange={v=>setForm(old=>({...old,[k]:v}))}/>)}<Button busy={busy} disabled={!form.title||!form.description||!form.scheduledStart||!form.scheduledEnd||form.scheduledEnd<form.scheduledStart} onClick={async()=>{setBusy(true);setFailure('');try{const result=await callBackend<MntData>('/api/org/mnt/wo/action',{code,action:'create_break_in',...form});setDialog(null);navigate('organization_admin/work_orders/'+result.woCode);}catch(e){setFailure(e instanceof Error?e.message:'Unable to create sub-order');}finally{setBusy(false);}}}>Create sub-order</Button>{failure&&<MntGateHint message={failure}/>}</div></MntDialog>}
            {dialog && dialog.kind!=='create_break_in' && (
                <MntDialog title={({ secure_spare: 'Secure spare', service_sourcing: 'Supplier for this service', procure: 'Raise purchase requirement', secure_service: 'Confirm service order' } as Record<string, string>)[dialog.kind] || dialog.kind.replaceAll('_', ' ')} onClose={() => setDialog(null)}>
                    {['allocate', 'match_spare', 'candidate', 'procure', 'secure_spare', 'service_sourcing', 'secure_service'].includes(dialog.kind) ? (
                        <ResourceForm
                            kind={dialog.kind}
                            code={code}
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
                                    <label className="block text-sm">
                                        Incident and near-miss declaration
                                        <select
                                            data-native-select="true"
                                            className={mntInput}
                                            value={form.declaration || ''}
                                            onChange={(e) => setForm({ ...form, declaration: e.target.value })}
                                        >
                                            <option value="">Choose explicitly</option>
                                            <option value="none">No incidents or near misses</option>
                                            <option value="reported">Incident / near miss reported</option>
                                        </select>
                                    </label>
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
                                            <label className="block text-sm">
                                                Cleared incident reference
                                                <select
                                                    className={mntInput}
                                                    data-native-select="true"
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
                                                </select>
                                            </label>
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
