import { useState, type ChangeEvent } from 'react';
import AssetToolReconciliation from './AssetToolReconciliation';
import CatalogueDraftPreview from '../components/CatalogueDraftPreview';
import { CheckCircle2, Download, Eye, FileUp, ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { downloadBlob } from '../lib/xlsx';
import { Alert } from '../components/ui';
import AssetDictionaryBrowser from '../components/AssetDictionaryBrowser';
import { fmtDate } from './format';
import { Button, Card, PageTitle, Spinner, useLoad } from './kit';
import { appConfirm } from '../components/dialogs';
import { navigate } from '../lib/route';
import { catalogUploadIssue, detectAdminCatalogKind, splitUtf8UploadParts, type AdminCatalogKind } from './catalogFileKinds';

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
    const [wrongFileKind,setWrongFileKind]=useState<AdminCatalogKind|null>(null);
    const [result, setResult] = useState<{ ok: boolean; errors: string[]; warnings: string[]; stats: Record<string, number> } | null>(null);
    const [browse, setBrowse] = useState(false);
    const [reconcile, setReconcile] = useState(false);
    const [busy, setBusy] = useState(false);

    const upload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setUploadError('');
        setWrongFileKind(null);
        setResult(null);
        if (file.size > 48_000_000) return setUploadError('The file is larger than 48 MB.');
        try {
            setProgress('Reading the file…');
            const textAll = await file.text();
            let parsed: unknown;
            try {
                parsed = JSON.parse(textAll);
            } catch {
                throw new Error('The file is not valid JSON.');
            }
            const issue=catalogUploadIssue('assets',parsed);
            if(issue){
                const detected=detectAdminCatalogKind(parsed);
                if(detected&&detected!=='assets')setWrongFileKind(detected);
                throw new Error(issue);
            }
            const root=parsed as Record<string,unknown>;
            if(root.financialIntegration&&
                (root.financialIntegration as Record<string,unknown>).catalogueRelease!=='APPROVED')
                throw new Error('This financial asset master is a Finance-review draft. It cannot replace the active catalogue until approved.');
            if (data?.loaded && !(await appConfirm('This replaces the asset catalog in the database. Continue?'))) {
                setProgress('');
                return;
            }
            const bytes = new TextEncoder().encode(textAll);
            const sha256 = await sha256Hex(bytes);
            const chunks=splitUtf8UploadParts(textAll);
            if(!chunks.length||chunks.length>140)
                throw new Error('This asset master requires too many upload parts. Choose a file under 48 MB.');
            const uploadId=crypto.randomUUID().replace(/-/g,'');
            await callBackend('/api/admin/assets/catalog/begin',
                {uploadId,size:bytes.length,sha256,totalChunks:chunks.length,fileName:file.name.slice(0,120)});
            let acknowledged=0;
            const sendChunk=async(index:number)=>{
                const payload=chunks[index];
                const partHash=await sha256Hex(new TextEncoder().encode(payload));
                for(let attempt=0;attempt<4;attempt++){
                    try{
                        const response=await callBackend<{ok:boolean;index:number;sha256:string}>(
                            '/api/admin/assets/catalog/chunk',{uploadId,index,data:payload,sha256:partHash});
                        if(!response.ok||response.index!==index||response.sha256!==partHash)
                            throw new Error('Upload part was not acknowledged correctly.');
                        setProgress(`Verified ${++acknowledged} of ${chunks.length} upload parts…`);
                        return;
                    }catch(err){
                        if(attempt===3)
                            throw new Error(`Part ${index+1} could not be saved after four attempts: ${err instanceof Error?err.message:String(err)}`);
                        await new Promise(resolve=>setTimeout(resolve,(attempt+1)*500));
                    }
                }
            };
            // Small concurrency avoids overwhelming mobile connections while permitting retries.
            for(let start=0;start<chunks.length;start+=2)
                await Promise.all(Array.from({length:Math.min(2,chunks.length-start)},(_,i)=>sendChunk(start+i)));
            setProgress('Checking integrity and saving to the database…');
            let res=await callBackend<{ok:boolean;errors:string[];warnings:string[];stats:Record<string,number>;
                retryable?:boolean;missingChunks?:number[]}>('/api/admin/assets/catalog/finish',{uploadId});
            for(let pass=0;pass<3&&!res.ok&&res.retryable&&Array.isArray(res.missingChunks)&&res.missingChunks.length;pass++){
                const missing=res.missingChunks.filter(i=>Number.isInteger(i)&&i>=0&&i<chunks.length);
                if(!missing.length)break;
                setProgress(`Repairing ${missing.length} missing upload parts…`);
                for(const index of missing)await sendChunk(index);
                setProgress('Checking repaired upload…');
                res=await callBackend('/api/admin/assets/catalog/finish',{uploadId});
            }
            setResult(res);
            if(res.ok)reload();
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

    if (reconcile) return <AssetToolReconciliation onBack={()=>setReconcile(false)}/>;
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
                            <p className='mt-1 flex items-center gap-1 break-all font-mono text-[11px] text-slate-600'>
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
                {data.loaded && <div className='mt-3 border-t border-line pt-3 space-y-2'><p className='font-medium text-sm'>Tools, workshop & test equipment</p><p className='text-xs text-soft'>Reconcile the maintenance catalogue against existing canonical asset classes before expanding the master. The comparison is read-only and never changes existing class codes or financial integration.</p><Button variant='secondary' onClick={()=>setReconcile(true)}>Review tools & equipment overlap</Button></div>}
                {uploadError&&<div className='mt-3 space-y-2'>
                    <Alert tone='error'>{uploadError}</Alert>
                    {wrongFileKind&&<Button variant='secondary' onClick={()=>navigate(
                        wrongFileKind==='materials'?'admin/material_catalog':
                        wrongFileKind==='services'?'admin/service_catalog':
                        wrongFileKind==='gl_accounts'?'admin/gl_accounts':'admin/asset_catalog'
                    )}>Open the correct catalog</Button>}
                </div>}
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
            <CatalogueDraftPreview kind='assets' />
        </div>
    );
}
