import { useState, type ChangeEvent } from 'react';
import CatalogueDraftPreview from '../components/CatalogueDraftPreview';
import { CheckCircle2, Download, Eye, FileUp, ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { downloadBlob } from '../lib/xlsx';
import { Alert } from '../components/ui';
import AssetDictionaryBrowser, { GL_LABELS, MATERIAL_LABELS, SERVICE_LABELS } from '../components/AssetDictionaryBrowser';
import { fmtDate } from './format';
import { Button, Card, PageTitle, Spinner, useLoad } from './kit';
import { appConfirm } from '../components/dialogs';

// MEMS admin: module lists - the material and service catalogs (Procurement, PRC) and the GL account master
// (Finance, FIN). One file per list lives in the database. Uploading a file checks it (structure, codes, references,
// SHA-256 checksum) and replaces the list straight away; organizations with the module enabled read it.
// Every upload, rejection and download is recorded in the audit trail.

export type CatalogKind = 'materials' | 'services' | 'gl_accounts';
type Kind = CatalogKind;

interface CatalogStatus {
    loaded: boolean;
    version: string;
    name: string;
    fileName: string;
    loadedAt: string;
    loadedBy: string;
    size: number;
    sha256: string;
    stats: Record<string, number>;
}

interface UploadResult {
    ok: boolean;
    errors: string[];
    warnings: string[];
    stats: Record<string, number>;
}

const CHUNK_CHARS = 400_000;

const TEXT: Record<Kind, { title: string; subtitle: string; item: string; items: string; file: string; module: string; api: string; levels: [string, string, string] }> = {
    materials: {
        title: 'Material catalog',
        subtitle: 'The material master reference in the database: categories, subcategories, families, generic materials and their attributes. Organizations use it to create material records for buying and stock.',
        item: 'material',
        items: 'materials',
        file: 'mems_material_catalog',
        module: 'PRC',
        api: '/api/admin/procurement/catalog',
        levels: ['categories', 'subcategories', 'families'],
    },
    services: {
        title: 'Service catalog',
        subtitle: 'The service master reference in the database: categories, subcategories, families, generic services and their attributes. Organizations use it to create service records, contracts and orders.',
        item: 'service',
        items: 'services',
        file: 'mems_service_catalog',
        module: 'PRC',
        api: '/api/admin/procurement/catalog',
        levels: ['categories', 'subcategories', 'families'],
    },
    gl_accounts: {
        title: 'GL account master',
        subtitle: 'The general ledger reference chart in the database: account classes, categories, groups and GL accounts with their properties and configuration attributes. Organizations adopt and configure accounts from it for their chart of accounts.',
        item: 'GL account',
        items: 'accounts',
        file: 'mems_gl_account_master',
        module: 'FIN',
        api: '/api/admin/finance/catalog',
        levels: ['classes', 'categories', 'groups'],
    },
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

const statsLine = (s: Record<string, number>, t: { items: string; levels: [string, string, string] }) =>
    `${s.categories ?? 0} ${t.levels[0]} · ${s.subcategories ?? 0} ${t.levels[1]} · ${s.families ?? 0} ${t.levels[2]} · ${s.items ?? 0} ${t.items} · ${s.attributes ?? 0} attributes · ${s.profiles ?? 0} profiles`;

export default function ProcurementCatalogAdmin({ kind, canWrite }: { kind: Kind; canWrite: boolean }) {
    const t = TEXT[kind];
    const { data, error, loading, reload } = useLoad(() => callBackend<CatalogStatus>(`${t.api}/status`, { kind }), [kind]);
    const [progress, setProgress] = useState('');
    const [uploadError, setUploadError] = useState('');
    const [result, setResult] = useState<UploadResult | null>(null);
    const [browse, setBrowse] = useState(false);
    const [busy, setBusy] = useState(false);

    const upload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setUploadError('');
        setResult(null);
        if (file.size > 48_000_000) return setUploadError('The file is larger than 48 MB.');
        try {
            setProgress('Reading the file…');
            const textAll = await file.text();
            let parsed: Record<string, unknown>;
            try {
                parsed = JSON.parse(textAll) as Record<string, unknown>;
            } catch {
                throw new Error('The file is not valid JSON.');
            }
            if (typeof parsed.catalogType === 'string' && parsed.catalogType !== kind) {
                const other = TEXT[parsed.catalogType as Kind]?.title ?? parsed.catalogType;
                throw new Error(`This is a ${other} file. Open the ${other} to upload it.`);
            }
            if (!Array.isArray(parsed.attributes) || !(Array.isArray(parsed[t.items === 'accounts' ? 'accounts' : kind]) || Array.isArray(parsed.items))) throw new Error(`The file has no ${t.items} or attributes.`);
            if (parsed.financialIntegration && (parsed.financialIntegration as Record<string,unknown>).catalogueRelease !== 'APPROVED')
                throw new Error('This financial master is a Finance-review draft. Complete Finance sign-off and publish an APPROVED release before activating it.');
            if (data?.loaded && !(await appConfirm(`This replaces the ${t.title.toLowerCase()} in the database. Continue?`))) {
                setProgress('');
                return;
            }
            const bytes = new TextEncoder().encode(textAll);
            const sha256 = await sha256Hex(bytes);
            const chunks: string[] = [];
            for (let i = 0; i < textAll.length; i += CHUNK_CHARS) chunks.push(textAll.slice(i, i + CHUNK_CHARS));
            await callBackend(`${t.api}/begin`, { kind, size: bytes.length, sha256, totalChunks: chunks.length, fileName: file.name.slice(0, 120) });
            for (let i = 0; i < chunks.length; i++) {
                setProgress(`Uploading part ${i + 1} of ${chunks.length}…`);
                await callBackend(`${t.api}/chunk`, { kind, index: i, data: chunks[i] });
            }
            setProgress('Checking and saving to the database…');
            const res = await callBackend<UploadResult>(`${t.api}/finish`, { kind });
            setResult(res);
            reload();
        } catch (err) {
            setUploadError(err instanceof Error ? err.message : 'Upload failed.');
        } finally {
            setProgress('');
        }
    };

    const download = async () => {
        setBusy(true);
        setUploadError('');
        try {
            const catalog = await callBackend<Record<string, unknown>>(`${t.api}/export`, { kind });
            downloadBlob(new Blob([JSON.stringify(catalog, null, 1)], { type: 'application/json' }), `${t.file}_${new Date().toISOString().slice(0, 10)}.json`);
        } catch (err) {
            setUploadError(err instanceof Error ? err.message : 'Download failed.');
        } finally {
            setBusy(false);
        }
    };

    if (browse) {
        return (
            <div className='space-y-3'>
                <button type='button' onClick={() => setBrowse(false)} className='text-sm text-slate-400'>
                    ← {t.title}
                </button>
                <AssetDictionaryBrowser treePath={`${t.api}/tree`} classPath={`${t.api}/item`} body={{ kind }} labels={kind === 'materials' ? MATERIAL_LABELS : kind === 'services' ? SERVICE_LABELS : GL_LABELS} />
            </div>
        );
    }

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || `Could not load the ${t.title.toLowerCase()}.`}</Alert>;

    return (
        <div className='space-y-3'>
            <PageTitle title={`${t.title} (${t.module})`} subtitle={t.subtitle} />
            <Card>
                {data.loaded ? (
                    <>
                        <p className='flex items-center gap-2 text-sm text-emerald-300'>
                            <CheckCircle2 className='h-4 w-4 shrink-0' />
                            In the database and available to organizations
                        </p>
                        <p className='mt-1 text-xs text-slate-400'>
                            {data.name || data.fileName || t.title}
                            {data.version ? ` · ${data.version}` : ''} · loaded {fmtDate(data.loadedAt)} by {data.loadedBy}
                        </p>
                        <p className='mt-1 text-xs text-slate-400'>{statsLine(data.stats, t)}</p>
                        {data.sha256 && (
                            <p className='mt-1 flex items-center gap-1 break-all font-mono text-[11px] text-slate-600'>
                                <ShieldCheck className='h-3 w-3 shrink-0' />
                                SHA-256 {data.sha256}
                            </p>
                        )}
                    </>
                ) : (
                    <p className='text-sm text-amber-300'>No {t.title.toLowerCase()} in the database yet. Upload the catalog file to make it available to organizations.</p>
                )}
                <div className='mt-3 grid gap-2 sm:grid-cols-3'>
                    {canWrite && (
                        <label className={`flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-onbrand ${progress ? 'pointer-events-none opacity-60' : ''}`}>
                            <FileUp className='h-4 w-4' />
                            {progress || (data.loaded ? 'Upload to replace' : 'Upload catalog file')}
                            <input type='file' accept='application/json,.json' className='sr-only' onChange={upload} disabled={!!progress} />
                        </label>
                    )}
                    {data.loaded && (
                        <Button variant='secondary' onClick={() => setBrowse(true)}>
                            <Eye className='h-4 w-4' />
                            Browse
                        </Button>
                    )}
                    {data.loaded && (
                        <Button variant='secondary' busy={busy} onClick={download}>
                            <Download className='h-4 w-4' />
                            Download
                        </Button>
                    )}
                </div>
                {uploadError && (
                    <div className='mt-3'>
                        <Alert tone='error'>{uploadError}</Alert>
                    </div>
                )}
                {result && (
                    <div className='mt-3 space-y-2'>
                        {result.ok ? (
                            <Alert tone='info'>Saved to the database and available now: {statsLine(result.stats, t)}.</Alert>
                        ) : (
                            <Alert tone='error'>The file was not saved because of the problems below. The catalog in the database was not changed.</Alert>
                        )}
                        {[...result.errors, ...result.warnings].length > 0 && (
                            <ul className='max-h-48 list-disc space-y-1 overflow-y-auto overscroll-contain pl-5 text-xs text-slate-300'>
                                {result.errors.map((m, i) => (
                                    <li key={`e${i}`} className='text-red-300'>
                                        {m}
                                    </li>
                                ))}
                                {result.warnings.map((m, i) => (
                                    <li key={`w${i}`} className='text-amber-300'>
                                        {m}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </Card>
            <CatalogueDraftPreview kind={kind} />
        </div>
    );
}
