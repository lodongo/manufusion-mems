import { useState } from 'react';
import { FileSpreadsheet, FileText, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { downloadBlob } from '../lib/xlsx';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Button, Card, Spinner, useLoad } from '../admin/kit';
import { Screen, Segmented, messageOf } from '../components/screen';

// Activity-based risk review for one equipment unit (read only).
//   Assessments  one row per hazard–impact pair: activity, hazard, impact, initial risk, controls, residual risk.
//                Tap a row for the full ratings. The Excel and PDF reports (with metadata, completion and
//                signature lines) are the formal record; the table's own Excel download is the quick extract.
//   Completion   configuration / assessment completion per activity and for the whole asset.
// Rendered standalone from StructurePage (with Back) and embedded in the activity risk assessment screen.
// Band colours come from the configured SAF risk matrix and are applied as inline styles.

interface Ref {
    code: string;
    label: string;
    category: string;
    subcategory: string;
    description: string;
}
type Risk = { ratings: Record<string, number>; score: number; band: string; color: string; matrixVersion: number } | null;
interface Impact {
    code: string;
    controls: string[];
    initialRisk?: Risk;
    residualRisk?: Risk;
}
interface Entry {
    id: string;
    energyCode: string;
    utilityCode: string;
    assemblyName?: string;
    activityType?: string;
    maintenanceType?: string;
    hazards: Array<{ code: string; impacts: Impact[] }>;
}
interface Config {
    factors: Array<{ code: string; label: string }>;
    tolerableMax?: number;
    bands: Array<{ max: number }>;
}
interface Response {
    catalogue: { energy: Ref[]; hazards: Ref[]; impacts: Ref[]; controls: Ref[] };
    utilities: Array<{ code: string; label: string }>;
    items: Entry[];
    updatedAt?: string;
    updatedBy?: string;
    updatedByName?: string;
    downloadedByName?: string;
    riskConfiguration?: Config;
}
interface HierarchyNode {
    level: string;
    code: string;
    name: string;
}
interface ReviewRow {
    key: string;
    source: Entry;
    hazard: string;
    impact: Impact;
}
interface SourceProgress {
    id: string;
    label: string;
    configuration: number;
    assessment: number;
    overall: number;
    configured: number;
    required: number;
    assessed: number;
    assessRequired: number;
}
interface Completion {
    configuration: number;
    assessment: number;
    overall: number;
}
type Catalogue = keyof Response['catalogue'];
type View = 'assessments' | 'completion';

const DEFAULT_FACTORS = [
    { code: 'P', label: 'Probability' },
    { code: 'S', label: 'Severity' },
    { code: 'E', label: 'Exposure' },
    { code: 'A', label: 'People affected' },
];
const FALLBACK_COLOR = '#64748b';

function tolerability(risk: Risk, threshold: number): string {
    if (!risk) return 'Not assessed';
    return risk.score > threshold ? 'Intolerable' : 'Tolerable';
}

function progressOf(source: Entry, name: string): SourceProgress {
    const impacts = source.hazards.flatMap((h) => h.impacts);
    const withControls = impacts.filter((i) => i.controls.length > 0).length;
    const configured = source.hazards.filter((h) => h.impacts.length > 0).length + withControls;
    const required = source.hazards.length + Math.max(impacts.length, 1);
    const assessed = impacts.reduce((n, i) => n + Number(!!i.initialRisk?.score) + Number(!!i.residualRisk?.score), 0);
    const assessRequired = impacts.length * 2;
    const configuration = source.hazards.length ? Math.round((100 * configured) / required) : 0;
    const assessment = impacts.length ? Math.round((100 * assessed) / assessRequired) : 0;
    return { id: source.id, label: name, configuration, assessment, overall: Math.round((configuration + assessment) / 2), configured, required, assessed, assessRequired };
}

function completionOf(list: SourceProgress[]): Completion {
    const required = list.reduce((n, s) => n + s.required, 0);
    const assessRequired = list.reduce((n, s) => n + s.assessRequired, 0);
    const configuration = required ? Math.round((100 * list.reduce((n, s) => n + s.configured, 0)) / required) : 0;
    const assessment = assessRequired ? Math.round((100 * list.reduce((n, s) => n + s.assessed, 0)) / assessRequired) : 0;
    return { configuration, assessment, overall: Math.round((configuration + assessment) / 2) };
}

// ---------------------------------------------------------------------------
// Formal reports (Excel with styling + completion sheet, A3 PDF). Same content as before the rework.
// ---------------------------------------------------------------------------

interface ReportInput {
    format: 'excel' | 'pdf';
    data: Response;
    rows: ReviewRow[];
    factors: Array<{ code: string; label: string }>;
    threshold: number;
    hierarchy: HierarchyNode[];
    workCenterId: string;
    completion: Completion;
    sourceProgress: SourceProgress[];
    label: (kind: Catalogue, code: string) => string;
}

async function downloadReport(input: ReportInput): Promise<void> {
    const { format, data, rows, factors, threshold, hierarchy, workCenterId, completion, sourceProgress, label } = input;
    const now = new Date();
    const metadata: Array<[string, string]> = [
        ['ACTIVITY BASED RISK ASSESSMENT', ''],
        ...hierarchy.map((n): [string, string] => [n.level.replace(/_/g, ' ').toUpperCase(), `${n.name} (${n.code})`]),
        ['Equipment unit', workCenterId],
        ['Last updated', data.updatedAt ? new Date(data.updatedAt).toLocaleString() : 'Not recorded'],
        ['Updated by', data.updatedByName || data.updatedBy || 'Not recorded'],
        ['Downloaded', now.toLocaleString()],
        ['Downloaded by', data.downloadedByName || 'Current authenticated user'],
        ['Tolerable cutoff', String(threshold)],
        ['Configuration completion', `${completion.configuration}%`],
        ['Assessment completion', `${completion.assessment}%`],
        ['Overall completion', `${completion.overall}%`],
    ];
    const headings = [
        'Activity / Source',
        'Hazard',
        'Impact',
        ...factors.map((f) => `Before ${f.label}`),
        'Before score',
        'Before tolerability',
        'Mitigation',
        ...factors.map((f) => `After ${f.label}`),
        'After score',
        'After tolerability',
    ];
    const riskCells = (risk: Risk) => [...factors.map((f) => risk?.ratings?.[f.code] ?? ''), risk?.score ?? '', tolerability(risk, threshold)];
    const sourceText = (source: Entry) => {
        const utility = source.utilityCode ? data.utilities.find((u) => u.code === source.utilityCode)?.label || source.utilityCode : '';
        return label('energy', source.energyCode) + (utility ? ` (Assembly: ${utility})` : ' (Independent)');
    };
    const values = rows.map((r) => [
        sourceText(r.source),
        label('hazards', r.hazard),
        label('impacts', r.impact.code),
        ...riskCells(r.impact.initialRisk || null),
        r.impact.controls.map((c) => label('controls', c)).join('; '),
        ...riskCells(r.impact.residualRisk || null),
    ]);
    const file = `activity-risk-review-${workCenterId}`;
    const before = 3 + factors.length;
    const after = before + factors.length + 3;

    if (format === 'excel') {
        const ExcelJS = (await import('exceljs')).default;
        const wb = new ExcelJS.Workbook();
        wb.creator = 'MEMS';
        wb.created = now;
        const ws = wb.addWorksheet('Risk review', { views: [{ state: 'frozen', ySplit: metadata.length + 2 }] });
        const navy = '17365D';
        const thin = { style: 'thin', color: { argb: 'FFD0D7E2' } };
        const border = { top: thin, left: thin, bottom: thin, right: thin } as any;
        for (const [k, v] of metadata) {
            const rr = ws.addRow([k, v]);
            rr.getCell(1).font = { bold: true, color: { argb: 'FF17365D' } };
            rr.getCell(2).font = { color: { argb: 'FF334155' } };
            ws.mergeCells(rr.number, 2, rr.number, Math.max(2, headings.length));
            rr.height = 19;
        }
        ws.addRow([]);
        const headerRow = ws.addRow(headings);
        headerRow.height = 36;
        headerRow.eachCell((cell: any) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${navy}` } };
            cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
            cell.border = border;
        });
        for (let i = 0; i < values.length; i++) {
            const rr = ws.addRow(values[i]);
            rr.height = 45;
            rr.eachCell({ includeEmpty: true }, (cell: any, col: number) => {
                cell.border = border;
                cell.alignment = { vertical: 'middle', wrapText: true };
                if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                // ExcelJS columns are 1-based: score and tolerability follow the factor ratings.
                if ([before + 1, before + 2, after + 1, after + 2].includes(col)) {
                    const risk = col <= before + 2 ? rows[i].impact.initialRisk : rows[i].impact.residualRisk;
                    if (risk) {
                        const hex = (risk.color || FALLBACK_COLOR).replace('#', '').toUpperCase();
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } };
                        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    }
                }
            });
        }
        ws.columns = headings.map((_, i) => ({ width: i === 0 ? 38 : i === 1 || i === 2 ? 32 : i === 3 + factors.length + 2 ? 42 : 18 }));
        ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number + values.length, column: headings.length } };
        for (const title of ['Prepared by', 'Reviewed by', 'Approved by']) {
            ws.addRow([]);
            const rr = ws.addRow([title, 'Signature: _____________________', 'Date: __________']);
            rr.getCell(1).font = { bold: true };
        }
        const summary = wb.addWorksheet('Completion');
        summary.columns = [{ width: 45 }, { width: 25 }, { width: 25 }, { width: 25 }];
        summary.addRow(['SOURCE COMPLETION', 'CONFIGURATION %', 'ASSESSMENT %', 'OVERALL %']);
        for (const s of sourceProgress) summary.addRow([s.label, s.configuration, s.assessment, s.overall]);
        summary.addRow(['ASSET TOTAL', completion.configuration, completion.assessment, completion.overall]);
        summary.eachRow((rr: any, index: number) =>
            rr.eachCell((cell: any) => {
                cell.border = border;
                cell.alignment = { vertical: 'middle' };
                if (index === 1) {
                    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${navy}` } };
                }
            }),
        );
        const buffer = await wb.xlsx.writeBuffer();
        downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${file}.xlsx`);
        return;
    }

    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
    pdf.setFontSize(16);
    pdf.text('ACTIVITY BASED RISK ASSESSMENT', 12, 14);
    pdf.setFontSize(9);
    let y = 21;
    for (const [k, v] of metadata) {
        pdf.text(`${k}: ${v}`, 12, y);
        y += 5;
    }
    autoTable(pdf, {
        head: [headings],
        body: values.map((row) => row.map(String)),
        startY: y + 5,
        theme: 'grid',
        styles: { fontSize: 6, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [30, 58, 91], textColor: 255 },
        didParseCell: (hook: any) => {
            if (hook.section !== 'body') return;
            // autoTable columns are 0-based: score at `before`/`after`, tolerability right after.
            const col = hook.column.index;
            if (![before, after, before + 1, after + 1].includes(col)) return;
            const row = rows[hook.row.index];
            const assessment = col <= before + 1 ? row?.impact.initialRisk : row?.impact.residualRisk;
            if (!assessment) return;
            const hex = assessment.color || FALLBACK_COLOR;
            hook.cell.styles.fillColor = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
            hook.cell.styles.textColor = [255, 255, 255];
        },
    });
    const finalY = (pdf as any).lastAutoTable?.finalY || y + 20;
    pdf.setFontSize(9);
    pdf.text('Prepared by: __________________ Signature: __________________ Date: __________', 12, Math.min(finalY + 12, 280));
    pdf.text('Reviewed by: __________________ Signature: __________________ Date: __________', 12, Math.min(finalY + 20, 288));
    pdf.text('Approved by: __________________ Signature: __________________ Date: __________', 12, Math.min(finalY + 28, 296));
    downloadBlob(pdf.output('blob'), `${file}.pdf`);
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** Score and band on the band colour from the risk matrix. */
function RiskChip({ risk }: { risk: Risk }) {
    if (!risk) return <span className='text-xs text-muted'>Not assessed</span>;
    return (
        <span className='inline-flex min-h-[28px] items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold' style={{ backgroundColor: risk.color || FALLBACK_COLOR, color: '#ffffff' }}>
            {risk.score}
            {risk.band ? ` · ${risk.band}` : ''}
        </span>
    );
}

function TolerabilityText({ risk, threshold }: { risk: Risk; threshold: number }) {
    const text = tolerability(risk, threshold);
    const tone = text === 'Intolerable' ? 'text-red-300' : text === 'Tolerable' ? 'text-emerald-300' : 'text-muted';
    return <span className={`text-xs font-medium ${tone}`}>{text}</span>;
}

function Progress({ value }: { value: number }) {
    return (
        <span className='block h-2 w-full overflow-hidden rounded-full bg-line' aria-hidden='true'>
            <span className='block h-full rounded-full bg-brand' style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
        </span>
    );
}

function CompletionCard({ completion, count, threshold }: { completion: Completion; count: number; threshold: number }) {
    return (
        <Card className='space-y-2 p-3'>
            <div className='flex items-baseline justify-between gap-2'>
                <p className='text-sm font-semibold text-ink'>Asset completion {completion.overall}%</p>
                <p className='text-xs text-muted'>Tolerable up to {threshold}</p>
            </div>
            <Progress value={completion.overall} />
            <p className='text-xs text-soft'>
                Configuration {completion.configuration}% · Assessment {completion.assessment}% · {count} impact assessments
            </p>
        </Card>
    );
}

function RatingsBlock({ title, risk, factors, threshold }: { title: string; risk: Risk; factors: Array<{ code: string; label: string }>; threshold: number }) {
    return (
        <div className='space-y-2 rounded-xl border border-line p-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
                <p className='text-sm font-semibold text-ink'>{title}</p>
                <RiskChip risk={risk} />
            </div>
            <dl className='grid grid-cols-2 gap-2'>
                {factors.map((f) => (
                    <div key={f.code}>
                        <dt className='text-xs text-muted'>
                            {f.label} ({f.code})
                        </dt>
                        <dd className='text-sm text-ink'>{risk?.ratings?.[f.code] ?? '—'}</dd>
                    </div>
                ))}
            </dl>
            <p className='text-xs text-soft'>
                <TolerabilityText risk={risk} threshold={threshold} />
                {risk?.matrixVersion ? ` · matrix v${risk.matrixVersion}` : ''}
            </p>
        </div>
    );
}

/** Full detail of one hazard–impact pair (bottom sheet on phones). */
function ImpactSheet({
    row,
    factors,
    threshold,
    label,
    onClose,
}: {
    row: ReviewRow;
    factors: Array<{ code: string; label: string }>;
    threshold: number;
    label: (kind: Catalogue, code: string) => string;
    onClose: () => void;
}) {
    const context = [row.source.assemblyName, row.source.activityType, row.source.maintenanceType].filter(Boolean).join(' · ') || 'Assembly activity';
    return (
        <div className='fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4' role='presentation'>
            <button type='button' aria-label='Close details' className='absolute inset-0 bg-black/60' onClick={onClose} />
            <section role='dialog' aria-modal='true' aria-label='Impact assessment details' className='relative flex max-h-[88dvh] w-full flex-col rounded-t-2xl border border-line bg-panel sm:max-w-lg sm:rounded-2xl'>
                <header className='flex items-start gap-3 border-b border-line p-4'>
                    <div className='min-w-0 flex-1'>
                        <p className='truncate text-xs text-muted'>{label('energy', row.source.energyCode)}</p>
                        <h2 className='text-base font-semibold text-ink'>{label('impacts', row.impact.code)}</h2>
                        <p className='text-xs text-soft'>Hazard: {label('hazards', row.hazard)}</p>
                    </div>
                    <button type='button' aria-label='Close' onClick={onClose} className='-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-page'>
                        <X className='h-5 w-5' />
                    </button>
                </header>
                <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]'>
                    <p className='text-xs text-muted'>{context}</p>
                    <RatingsBlock title='Before mitigation' risk={row.impact.initialRisk ?? null} factors={factors} threshold={threshold} />
                    <div className='rounded-xl border border-line p-3'>
                        <p className='text-sm font-semibold text-ink'>Mitigations ({row.impact.controls.length})</p>
                        {row.impact.controls.length ? (
                            <ul className='mt-2 space-y-1 text-sm text-soft'>
                                {row.impact.controls.map((c) => (
                                    <li key={c}>{label('controls', c)}</li>
                                ))}
                            </ul>
                        ) : (
                            <p className='mt-1 text-sm text-muted'>No mitigations selected.</p>
                        )}
                    </div>
                    <RatingsBlock title='After mitigation' risk={row.impact.residualRisk ?? null} factors={factors} threshold={threshold} />
                </div>
            </section>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ActivityRiskReview({
    workCenterId,
    onBack,
    embedded = false,
    hierarchy = [],
}: {
    workCenterId: string;
    onBack?: () => void;
    embedded?: boolean;
    hierarchy?: HierarchyNode[];
}) {
    const { data, error, loading } = useLoad(() => callBackend<Response>('/api/org/activity-risk/legacy-read', { workCenterId }), [workCenterId]);
    const [view, setView] = useState<View>('assessments');
    const [selected, setSelected] = useState<ReviewRow | null>(null);
    const [exporting, setExporting] = useState<'' | 'excel' | 'pdf'>('');
    const [exportError, setExportError] = useState('');

    const label = (kind: Catalogue, code: string) => data?.catalogue[kind].find((x) => x.code === code)?.label || code;
    const rows: ReviewRow[] = (data?.items ?? []).flatMap((source) =>
        source.hazards.flatMap((h) => h.impacts.map((impact, i) => ({ key: `${source.id}|${h.code}|${impact.code}|${i}`, source, hazard: h.code, impact }))),
    );
    const factors = data?.riskConfiguration?.factors || DEFAULT_FACTORS;
    const threshold = data?.riskConfiguration?.tolerableMax ?? data?.riskConfiguration?.bands?.[1]?.max ?? 50;
    const sourceProgress = (data?.items ?? []).map((source) => progressOf(source, label('energy', source.energyCode)));
    const completion = completionOf(sourceProgress);
    const controlsText = (r: ReviewRow) => r.impact.controls.map((c) => label('controls', c)).join('; ');

    const download = async (format: 'excel' | 'pdf') => {
        if (!data || exporting) return;
        setExporting(format);
        setExportError('');
        try {
            await downloadReport({ format, data, rows, factors, threshold, hierarchy, workCenterId, completion, sourceProgress, label });
        } catch (err) {
            setExportError(messageOf(err, `Could not create the ${format === 'excel' ? 'Excel' : 'PDF'} report.`));
        } finally {
            setExporting('');
        }
    };

    const ratingColumns = (prefix: 'before' | 'after'): Array<Column<ReviewRow>> =>
        factors.map((f) => ({
            key: `${prefix}_${f.code}`,
            label: `${prefix === 'before' ? 'Before' : 'After'} ${f.label} (${f.code})`,
            type: 'number' as const,
            hidden: true,
            value: (r: ReviewRow) => (prefix === 'before' ? r.impact.initialRisk : r.impact.residualRisk)?.ratings?.[f.code] ?? null,
        }));

    const columns: Array<Column<ReviewRow>> = [
        {
            key: 'activity',
            label: 'Activity',
            value: (r) => label('energy', r.source.energyCode),
            render: (r) => (
                <span className='block min-w-[10rem]'>
                    <span className='block font-medium text-ink'>{label('energy', r.source.energyCode)}</span>
                    <span className='block text-xs text-muted'>{[r.source.assemblyName, r.source.activityType].filter(Boolean).join(' · ') || 'Assembly activity'}</span>
                </span>
            ),
        },
        { key: 'assembly', label: 'Assembly', hidden: true, value: (r) => r.source.assemblyName ?? '' },
        { key: 'activityType', label: 'Activity type', hidden: true, value: (r) => r.source.activityType ?? '' },
        { key: 'maintenanceType', label: 'Maintenance type', hidden: true, value: (r) => r.source.maintenanceType ?? '' },
        { key: 'hazard', label: 'Hazard', value: (r) => label('hazards', r.hazard) },
        { key: 'impact', label: 'Impact', value: (r) => label('impacts', r.impact.code) },
        ...ratingColumns('before'),
        { key: 'initial', label: 'Initial risk', type: 'number', value: (r) => r.impact.initialRisk?.score ?? null, render: (r) => <RiskChip risk={r.impact.initialRisk ?? null} /> },
        { key: 'initialBand', label: 'Initial band', hidden: true, value: (r) => r.impact.initialRisk?.band ?? '' },
        { key: 'initialTolerability', label: 'Initial tolerability', hidden: true, value: (r) => tolerability(r.impact.initialRisk ?? null, threshold) },
        {
            key: 'controls',
            label: 'Controls',
            value: controlsText,
            render: (r) => (r.impact.controls.length ? <span className='block max-w-[18rem] whitespace-normal text-sm text-soft'>{controlsText(r)}</span> : <span className='text-muted'>—</span>),
        },
        { key: 'controlCount', label: 'Control count', type: 'number', hidden: true, value: (r) => r.impact.controls.length },
        ...ratingColumns('after'),
        { key: 'residual', label: 'Residual risk', type: 'number', value: (r) => r.impact.residualRisk?.score ?? null, render: (r) => <RiskChip risk={r.impact.residualRisk ?? null} /> },
        { key: 'residualBand', label: 'Residual band', hidden: true, value: (r) => r.impact.residualRisk?.band ?? '' },
        {
            key: 'residualTolerability',
            label: 'Residual tolerability',
            value: (r) => tolerability(r.impact.residualRisk ?? null, threshold),
            render: (r) => <TolerabilityText risk={r.impact.residualRisk ?? null} threshold={threshold} />,
        },
    ];

    const completionColumns: Array<Column<SourceProgress>> = [
        { key: 'activity', label: 'Activity', value: (s) => s.label, render: (s) => <span className='font-medium text-ink'>{s.label}</span> },
        { key: 'configuration', label: 'Configuration %', type: 'number', value: (s) => s.configuration },
        { key: 'assessment', label: 'Assessment %', type: 'number', value: (s) => s.assessment },
        {
            key: 'overall',
            label: 'Overall %',
            type: 'number',
            value: (s) => s.overall,
            render: (s) => (
                <span className='flex min-w-[7rem] items-center gap-2'>
                    <Progress value={s.overall} />
                    <span className='w-10 shrink-0 text-right text-xs text-soft'>{s.overall}%</span>
                </span>
            ),
        },
        { key: 'configured', label: 'Configured items', hidden: true, value: (s) => `${s.configured}/${s.required}` },
        { key: 'assessed', label: 'Ratings done', hidden: true, value: (s) => `${s.assessed}/${s.assessRequired}` },
    ];

    const reportActions = (
        <>
            <Button type='button' variant='secondary' className='px-3' busy={exporting === 'excel'} disabled={!data || !!exporting} onClick={() => void download('excel')} aria-label='Download Excel report'>
                {exporting !== 'excel' && <FileSpreadsheet className='h-4 w-4' />}
                <span className='hidden sm:inline'>Excel report</span>
            </Button>
            <Button type='button' variant='secondary' className='px-3' busy={exporting === 'pdf'} disabled={!data || !!exporting} onClick={() => void download('pdf')} aria-label='Download PDF report'>
                {exporting !== 'pdf' && <FileText className='h-4 w-4' />}
                <span className='hidden sm:inline'>PDF</span>
            </Button>
        </>
    );

    const tableHeight = embedded ? 'h-[calc(100dvh-25rem)]' : 'h-[calc(100dvh-22rem)]';
    const body =
        loading && !data ? (
            <Spinner />
        ) : error || !data ? (
            <Alert tone='error'>{error || 'Could not load the risk review.'}</Alert>
        ) : (
            <>
                {exportError && <Alert tone='error'>{exportError}</Alert>}
                <CompletionCard completion={completion} count={rows.length} threshold={threshold} />
                {view === 'assessments' || embedded ? (
                    <RichTable
                        id='saf.activity.review'
                        title='Impact assessments'
                        columns={columns}
                        rows={rows}
                        rowKey={(r) => r.key}
                        onRowClick={setSelected}
                        actions={reportActions}
                        empty='No impact assessments yet'
                        fileName={`activity-risk-review-${workCenterId}`}
                        height={tableHeight}
                    />
                ) : (
                    <RichTable
                        id='saf.activity.completion'
                        title='Completion by activity'
                        columns={completionColumns}
                        rows={sourceProgress}
                        rowKey={(s) => s.id}
                        actions={reportActions}
                        empty='No assembly activities under this equipment unit'
                        fileName={`activity-risk-completion-${workCenterId}`}
                        height={tableHeight}
                    />
                )}
            </>
        );

    const sheet = selected && <ImpactSheet row={selected} factors={factors} threshold={threshold} label={label} onClose={() => setSelected(null)} />;

    if (embedded) {
        return (
            <section className='space-y-3' aria-label='Hazard review'>
                <h2 className='text-base font-semibold text-ink'>Hazard review</h2>
                {body}
                {sheet}
            </section>
        );
    }

    const place = hierarchy.length ? hierarchy[hierarchy.length - 1] : null;
    return (
        <Screen
            title='Activity-based risk review'
            eyebrow={place ? `${place.name} (${place.code})` : undefined}
            subtitle={data ? `${rows.length} impact assessments · ${sourceProgress.length} activities` : undefined}
            onBack={onBack}
            toolbar={
                <Segmented<View>
                    label='Review views'
                    value={view}
                    onChange={setView}
                    options={[
                        { value: 'assessments', label: 'Assessments', count: data ? rows.length : undefined },
                        { value: 'completion', label: 'Completion', count: data ? sourceProgress.length : undefined },
                    ]}
                />
            }
        >
            {body}
            {sheet}
        </Screen>
    );
}
