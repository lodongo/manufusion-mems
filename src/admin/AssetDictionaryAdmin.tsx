import { useState, type ChangeEvent } from 'react';
import { CheckCircle2, Download, Eye, FileUp, ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { downloadBlob } from '../lib/xlsx';
import { Alert } from '../components/ui';
import AssetDictionaryBrowser from '../components/AssetDictionaryBrowser';
import { fmtDate } from './format';
import { Button, Card, PageTitle, Spinner, useLoad } from './kit';

// MEMS admin: the asset catalog (asset master data). One catalog lives in the database. Uploading a file checks
// its structure and replaces the catalog straight away; organizations read it from the database to classify their
// equipment units and configure their own assets. Every upload is recorded in the audit trail.

interface CatalogStatus {
    loaded: boolean;
    version: string;
    fileName: string;
    loadedAt: string;
    loadedBy: string;
    size: number;
    sha256: string;
    stats: Record<string, number>;
}

const CHUNK_CHARS = 400_000;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

export default function AssetDictionaryAdmin({ canWrite }: { canWrite: boolean; isSuper?: boolean }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<CatalogStatus>('/api/admin/assets/catalog/status'));
    const [progress, setProgress] = useState('');
    const [uploadError, setUploadError] = useState('');
    const [result, setResult] = useState<{ ok: boolean; errors: string[]; warnings: string[]; stats: Record<string, number> } | null>(null);
    const [browse, setBrowse] = useState(false);
    const [busy, setBusy] = useState(false);

    const upload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setUploadError('');
        setResult(null);
        if (file.size > 12_000_000) return setUploadError('The file is larger than 12 MB.');
        try {
            setProgress('Reading the file…');
            const textAll = await file.text();
            let parsed: { assetClasses?: unknown[]; attributes?: unknown[] };
            try {
                parsed = JSON.parse(textAll);
            } catch {
                throw new Error('The file is not valid JSON.');
            }
            if (!Array.isArray(parsed.assetClasses) || !Array.isArray(parsed.attributes)) throw new Error('The file has no asset classes or attributes.');
            if (data?.loaded && !window.confirm('This replaces the asset catalog in the database. Continue?')) {
                setProgress('');
                return;
            }
            const bytes = new TextEncoder().encode(textAll);
            const sha256 = await sha256Hex(bytes);
            const chunks: string[] = [];
            for (let i = 0; i < textAll.length; i += CHUNK_CHARS) chunks.push(textAll.slice(i, i + CHUNK_CHARS));
            await callBackend('/api/admin/assets/catalog/begin', { size: bytes.length, sha256, totalChunks: chunks.length, fileName: file.name.slice(0, 120) });
            for (let i = 0; i < chunks.length; i++) {
                setProgress(`Uploading part ${i + 1} of ${chunks.length}…`);
                await callBackend('/api/admin/assets/catalog/chunk', { index: i, data: chunks[i] });
            }
            setProgress('Checking and saving to the database…');
            const res = await callBackend<{ ok: boolean; errors: string[]; warnings: string[]; stats: Record<string, number> }>('/api/admin/assets/catalog/finish');
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
            const catalog = await callBackend<Record<string, unknown>>('/api/admin/assets/catalog/export');
            downloadBlob(new Blob([JSON.stringify(catalog, null, 1)], { type: 'application/json' }), `mems_asset_catalog_${new Date().toISOString().slice(0, 10)}.json`);
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
                    ← Asset catalog
                </button>
                <AssetDictionaryBrowser treePath='/api/admin/assets/dictionary/tree' classPath='/api/admin/assets/dictionary/class' />
            </div>
        );
    }

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the asset catalog.'}</Alert>;

    return (
        <div className='space-y-3'>
            <PageTitle title='Asset catalog' subtitle='The asset master data in the database: groups, categories, subcategories, equipment classes and their attributes. Organizations use it to configure their assets.' />
            <Card>
                {data.loaded ? (
                    <>
                        <p className='flex items-center gap-2 text-sm text-emerald-300'>
                            <CheckCircle2 className='h-4 w-4 shrink-0' />
                            In the database and available to organizations
                        </p>
                        <p className='mt-1 text-xs text-slate-400'>
                            {data.fileName || 'Catalog'}
                            {data.version ? ` · ${data.version}` : ''} · loaded {fmtDate(data.loadedAt)} by {data.loadedBy}
                        </p>
                        {data.stats.assetClasses ? (
                            <p className='mt-1 text-xs text-slate-400'>
                                {data.stats.groups} groups · {data.stats.categories} categories · {data.stats.subcategories} subcategories · {data.stats.assetClasses} classes · {data.stats.attributes} attributes
                            </p>
                        ) : null}
                        {data.sha256 && (
                            <p className='mt-1 flex items-center gap-1 break-all font-mono text-[10px] text-slate-600'>
                                <ShieldCheck className='h-3 w-3 shrink-0' />
                                SHA-256 {data.sha256}
                            </p>
                        )}
                    </>
                ) : (
                    <p className='text-sm text-amber-300'>No catalog in the database yet. Upload the catalog file to make it available to organizations.</p>
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
                {uploadError && <div className='mt-3'><Alert tone='error'>{uploadError}</Alert></div>}
                {result && (
                    <div className='mt-3 space-y-2'>
                        {result.ok ? (
                            <Alert tone='info'>
                                Saved to the database and available now: {result.stats.groups} groups, {result.stats.categories} categories, {result.stats.subcategories} subcategories, {result.stats.assetClasses} classes, {result.stats.attributes} attributes.
                            </Alert>
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
        </div>
    );
}
