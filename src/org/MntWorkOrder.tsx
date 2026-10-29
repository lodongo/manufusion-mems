import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Package, ShieldCheck, Wrench, CalendarClock, CheckCircle2, ChevronDown } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { workspaceNavigate as navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { Button, Card, Spinner, useLoad } from '../admin/kit';
import { WorkOrderVouchers } from './StoresIssueVouchers';
import MntTaskAssessment, { WarehouseSparePicker, CatalogPicker } from './MntTaskAssessment';
import { FulfilmentTrack, ResourceStatus, SOURCE_LABEL, useVendors } from './mntSourcing';
import { useFullScreen } from './mntShared';
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
    item?: MntData;
    onRun: (action: string, b?: MntData) => Promise<boolean>;
    onClose: () => void;
}) {
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
        if (kind === 'secure_spare' && needsWarehouse && !data.warehouseId) return setError('Choose the warehouse.');
        if (kind === 'procure' && (!data.glCode || !data.dateRequired)) return setError('Enter the GL account and the date required.');
        setBusy(true);
        if (await onRun(kind, { taskId: task.id, resourceId: resource.id, ...data })) onClose();
        setBusy(false);
    };
    return (
        <div className="space-y-4">
            {kind === 'allocate' && (
                <>
                    <p className="text-sm text-soft">
                        Required: {task.persons} people · {task.skills}. Tools: {task.tools || 'None'}.
                    </p>
                    <fieldset className="grid gap-2 sm:grid-cols-2">
                        <legend>Allocate execution personnel</legend>
                        {people.map((p) => (
                            <MntCheck
                                key={p.id}
                                label={p.name}
                                value={data.personnel.includes(p.id)}
                                onChange={(v) =>
                                    patch('personnel', v ? [...data.personnel, p.id] : data.personnel.filter((id: string) => id !== p.id))
                                }
                            />
                        ))}
                    </fieldset>
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

function FeedbackForm({ task, execution, onSubmit }: { task: MntData; execution: MntData; onSubmit: (d: MntData) => void }) {
    const [f, setF] = useState<MntData>({ services: (task.services || []).map((s: MntData) => ({ id: s.id, accepted: false })) });
    const patch = (k: string, v: any) => setF((old) => ({ ...old, [k]: v }));
    return (
        <div className="space-y-3">
            <p className="text-sm text-soft">
                Started {execution.startedAt ? new Date(execution.startedAt).toLocaleString() : '—'}. Complete each result explicitly.
            </p>
            {(
                [
                    ['workPerformed', 'Work performed'],
                    ['findings', 'Technical findings'],
                    ['results', 'Actual work results'],
                    ['outstandingDefects', 'Outstanding defects (enter None if clear)'],
                    ['remarks', 'Completion remarks'],
                    ['measurements', 'Measurements (where applicable)'],
                    ['evidence', 'Execution evidence / reference'],
                    ['followUp', 'Follow-up actions and references (enter None if clear)'],
                ] as const
            ).map(([k, l]) => (
                <MntField key={k} label={l} value={f[k]} multiline onChange={(v) => patch(k, v)} />
            ))}
            <MntField label="Actual labour hours worked" type="number" value={f.actualHours} onChange={(v) => patch('actualHours', v)} />
            <MntCheck
                label="The work deviated from the assessed technical scope."
                value={!!f.scopeDeviation}
                onChange={(v) => patch('scopeDeviation', v)}
            />
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
            <Button onClick={() => onSubmit({ feedback: f })}>Confirm task completion</Button>
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

export default function MntWorkOrder({ code }: { code: string }) {
    const { data, error, loading, reload } = useLoad(() => mntApi({ action: 'read', code }), [code]);
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
                        {wo.code} · {wo.status.replaceAll('_', ' ')}
                    </p>
                    <h1 className="mt-1 text-2xl font-semibold">{wo.title}</h1>
                    <p className="mt-1 text-sm text-soft">
                        {wo.unitName} · {wo.assemblyName} · {wo.assetTag}
                    </p>
                </div>
                <Button variant="secondary" onClick={() => navigate('organization_admin/maintenance_windows')}>
                    <CalendarClock size={17} />
                    Maintenance windows
                </Button>
            </div>
            {failure && <MntGateHint message={failure} />}
            {message && <Alert tone="info">{message}</Alert>}
            <div className="flex flex-wrap gap-2">
                {can.cancel && (
                    <Button variant="secondary" onClick={() => open('cancel_order')}>
                        Cancel work order
                    </Button>
                )}
                {wo.status === 'planning' && can.assess && (
                    <Button onClick={() => setAssessing(true)}>
                        <Wrench size={16} />
                        {tasks.length ? 'Edit task assessment' : 'Assess tasks and requirements'}
                    </Button>
                )}

                {can.plan &&
                    tasks.length > 0 &&
                    !['closed', 'cancelled'].includes(wo.status) &&
                    !Object.values(wo.taskExecution || {}).some((e: any) => e.startedAt) && (
                        <Button variant="secondary" onClick={() => open('reassess')}>
                            Controlled reassessment
                        </Button>
                    )}
            </div>
            {tasks.length > 0 && wo.assessmentReviewCurrent && data.checklist && (
                <MntReadiness code={code} wo={wo} checklist={data.checklist} canPlan={!!can.plan} currency={data.currency || ''} onDone={reload} />
            )}
            {tasks.length>0&&<Card className="space-y-3">
                <p className="font-semibold">Independent work assessment review</p>
                <p className="text-sm">{wo.assessmentReviewCurrent?'Approved by '+(wo.assessmentReview.name||'reviewer'):'Awaiting approval of current task assessment'}</p>
                {wo.assessmentReview?.note&&<p className="text-sm text-soft">Review notes: {wo.assessmentReview.note}</p>}
                {wo.status==='planning'&&can.reviewAssessment&&<div className="space-y-2">
                    <label className="block text-sm">Technical verification / correction notes (minimum 10 characters)
                        <textarea rows={3} value={assessmentReviewNote} onChange={e=>setAssessmentReviewNote(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-transparent p-3 text-base" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                        <Button busy={busy} disabled={assessmentReviewNote.trim().length<10} onClick={async()=>{if(await legacy('review_assessment',{note:assessmentReviewNote}))setAssessmentReviewNote('');}}>Approve assessment</Button>
                        <Button variant="secondary" busy={busy} disabled={assessmentReviewNote.trim().length<10} onClick={async()=>{if(await legacy('return_assessment',{note:assessmentReviewNote}))setAssessmentReviewNote('');}}>Return for correction</Button>
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
                                {task.priority || 'normal'} priority · {task.hours} estimated hours
                            </p>
                        </div>
                        <nav aria-label="Task sections" className="flex gap-2 overflow-auto pb-1">
                            {['Details', 'Spares', 'Services', 'Personnel & tools', 'Risk assessment', 'Execution'].map((s) => (
                                <button
                                    key={s}
                                    className={`shrink-0 rounded-xl px-3 py-2 text-sm ${tab === s ? 'bg-brand text-onbrand' : 'border border-line text-soft'}`}
                                    onClick={() => setTab(s)}
                                >
                                    {s}
                                </button>
                            ))}
                        </nav>
                        {tab === 'Details' && <Details task={task} />}
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
                                                        <Button onClick={() => open('secure_spare', s, p)}>
                                                            {r.status === 'awaiting_verification' ? 'Verify and submit requirement' : 'Reserve and cover shortage'}
                                                        </Button>
                                                    )}
                                                    {r.status === 'received_reserve' && (
                                                        <Button busy={busy} onClick={() => run('reserve', { taskId: task.id, resourceId: s.id })}>
                                                            Reserve received stock
                                                        </Button>
                                                    )}
                                                    {!hasCode && (
                                                        <Button disabled={!!p.materialDraftId} onClick={() => open('candidate', s, p)}>
                                                            Send for material creation
                                                        </Button>
                                                    )}
                                                    {!hasCode && !p.materialDraftId && (
                                                        <Button variant="secondary" onClick={() => open('match_spare', s, p)}>
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
                                                        <Button variant={p.sourcing ? 'secondary' : 'primary'} onClick={() => open('service_sourcing', s, p)}>
                                                            {p.sourcing ? 'Change supplier' : 'Choose supplier'}
                                                        </Button>
                                                    )}
                                                    {p.sourcing && !p.requirementId && (
                                                        <Button onClick={() => open('procure', s, p)}>Raise purchase requirement</Button>
                                                    )}
                                                    {p.requirementId && p.status !== 'secured' && (
                                                        <Button variant={r.orderReady ? 'primary' : 'secondary'} onClick={() => open('secure_service', s, { ...p, item: r })}>
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
                                        <Button variant="secondary" onClick={() => open('allocate', {}, planning.allocation || {})}>
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
                                    Actual start: {execution.startedAt || 'Pending'} · Completion: {execution.completedAt || 'Pending'}
                                </p>
                                {can.execute && !wo.safetySignoff && !['closed', 'cancelled'].includes(wo.status) && (
                                    <div className="flex flex-wrap gap-2">
                                        {execution.status !== 'completed' && (
                                            <Button busy={busy} onClick={() => run('start_task', { taskId: task.id })}>
                                                {execution.status === 'blocked' ? 'Resume task' : 'Start task'}
                                            </Button>
                                        )}
                                        {['in_progress', 'blocked'].includes(execution.status) && (
                                            <>
                                                <Button variant="secondary" onClick={() => open('feedback')}>
                                                    Record completion feedback
                                                </Button>
                                                <Button variant="secondary" onClick={() => open('block_task')}>
                                                    Mark blocked
                                                </Button>
                                            </>
                                        )}
                                        {execution.status === 'completed' && !execution.reconciled && (
                                            <Button variant="secondary" onClick={() => open('consumption')}>
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
                                            <Button busy={busy} onClick={() => run('reconcile_task', { taskId: task.id })}>
                                                Stores: reconcile returns and update BOM
                                            </Button>
                                        )}
                                    </div>
                                )}
                                <WorkOrderVouchers code={code} />
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
                                        Actual spares reconciled ·{' '}
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
                    Safety, handover and final closure
                </h2>
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                    {[
                        ['Safety sign-off', wo.safetySignoff],
                        ['Equipment handover', wo.handover],
                        ['Technical Manager closure', wo.technicalClosure],
                    ].map(([label, v]) => (
                        <div key={label} className="rounded-xl border border-line p-3">
                            <p className="font-semibold">{label}</p>
                            <p className="mt-1 text-soft">{v ? `${v.name} · ${new Date(v.at).toLocaleString()}` : 'Pending'}</p>
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap gap-2">
                    {can.safety && !wo.safetySignoff && (
                        <>
                            <Button variant="secondary" onClick={() => open('safety_signoff')}>
                                Safety sign-off
                            </Button>
                            <Button variant="secondary" onClick={() => open('report_incident')}>
                                Report incident / near miss
                            </Button>
                        </>
                    )}
                    {can.handover && wo.safetySignoff && !wo.handover && (
                        <Button onClick={() => open('handover')}>Accept equipment handover</Button>
                    )}
                    {can.close && wo.status !== 'closed' && (
                        <Button onClick={() => open('technical_close')}>Technical Manager final closure</Button>
                    )}
                </div>
                {data.incidents.map((i: MntData) => (
                    <div key={i.id} className="rounded-xl border border-line p-3 text-sm">
                        <p className="font-semibold">
                            {i.id} · {i.classification} · {i.status}
                        </p>
                        <p>{i.narrative}</p>
                        {can.safety && i.status === 'open' && (
                            <Button variant="secondary" onClick={() => open('clear_incident', i)}>
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
            {dialog && (
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
                            onRun={run}
                            onClose={() => setDialog(null)}
                        />
                    ) : dialog.kind === 'feedback' ? (
                        <FeedbackForm
                            task={task}
                            execution={execution}
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
                            {dialog.kind === 'handover' && (
                                <>
                                    {[
                                        ['functionalChecks', 'Operational testing and functional checks'],
                                        ['condition', 'Equipment condition'],
                                        ['restrictions', 'Outstanding restrictions (enter None if clear)'],
                                    ].map(([k, l]) => (
                                        <MntField
                                            key={k}
                                            label={l}
                                            value={form[k]}
                                            multiline
                                            onChange={(v) => setForm({ ...form, [k]: v })}
                                        />
                                    ))}
                                    <MntCheck
                                        label="Equipment is ready for operation."
                                        value={!!form.ready}
                                        onChange={(v) => setForm({ ...form, ready: v })}
                                    />
                                    <MntCheck
                                        label="I accept the equipment handover as the authorized receiving employee."
                                        value={!!form.accepted}
                                        onChange={(v) => setForm({ ...form, accepted: v })}
                                    />
                                </>
                            )}
                            {dialog.kind === 'cancel_order' && (
                                <MntField
                                    label={'Type ' + code + ' to confirm cancellation'}
                                    value={form.confirm}
                                    onChange={(v) => setForm({ ...form, confirm: v })}
                                />
                            )}
                            {dialog.kind === 'technical_close' && (
                                <MntCheck
                                    label="Outstanding technical issues and follow-up actions have been reviewed and formally accepted."
                                    value={!!form.outstandingAccepted}
                                    onChange={(v) => setForm({ ...form, outstandingAccepted: v })}
                                />
                            )}
                            {dialog.kind !== 'report_incident' && dialog.kind !== 'handover' && (
                                <MntField
                                    label="Review notes / reason"
                                    value={form.note}
                                    multiline
                                    onChange={(v) => setForm({ ...form, note: v })}
                                />
                            )}
                            <Button
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
        </div>
    );
}
