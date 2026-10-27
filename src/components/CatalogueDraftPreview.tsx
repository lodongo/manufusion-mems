import { useMemo, useState, type ChangeEvent } from 'react';
import { Alert } from './ui';
import { Badge, Card } from '../admin/kit';

type Row = Record<string, unknown>;
type Kind = 'materials' | 'services' | 'gl_accounts' | 'assets';
const ITEMS: Record<Kind, string> = { materials: 'materials', services: 'services', gl_accounts: 'accounts', assets: 'assetClasses' };
const readable = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
const obj = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): Row[] => Array.isArray(value) ? value.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : [];
const text = (value: unknown) => typeof value === 'string' ? value : '';
const display = (value: unknown) => value == null ? 'Not configured' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : typeof value === 'object' ? JSON.stringify(value) : String(value);

/** Reads a financial-integration draft locally, without touching the active master in Firestore. */
export default function CatalogueDraftPreview({ kind }: { kind: Kind }) {
    const [fileName, setFileName] = useState('');
    const [fileData, setFileData] = useState<Row | null>(null);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [industryPreview, setIndustryPreview] = useState('');
    const [showUnmatched, setShowUnmatched] = useState(false);
    const [onlyFinanceExceptions, setOnlyFinanceExceptions] = useState(false);
    const [selectedCode, setSelectedCode] = useState('');
    const [busy, setBusy] = useState(false);
    const rows = useMemo(() => array(fileData?.[ITEMS[kind]]), [fileData, kind]);
    const selected = useMemo(() => rows.find(x => text(x.code) === selectedCode), [rows, selectedCode]);
    const statusOf = (x: Row) => text(kind === 'gl_accounts' ? obj(x.accountDetermination).mappingStatus : obj(obj(x.accounting).glResolution).mappingStatus);
    const financeExceptions = useMemo(() => rows.filter(x => statusOf(x) === 'finance_review_required').length, [rows, kind]);
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return rows.filter(x => {
            const searchMatch = !q || (text(x.code) + ' ' + text(x.name) + ' ' + text(x.description)).toLowerCase().includes(q);
            const industryMatch = !industryPreview || showUnmatched || x.industryScope !== 'INDUSTRY_SPECIFIC' ||
                (Array.isArray(x.industryCodes) && x.industryCodes.some(code => typeof code === 'string' && (code === industryPreview || code.startsWith(industryPreview + '-'))));
            return searchMatch && industryMatch && (!onlyFinanceExceptions || statusOf(x) === 'finance_review_required');
        });
    }, [rows, query, industryPreview, showUnmatched, onlyFinanceExceptions, kind]);
    const branchCounts = useMemo(() => kind !== 'materials' ? null : rows.reduce<Record<string, number>>((a, item) => {
        const c = text(obj(obj(item.accounting).catalogueClassification).majorBranch);
        a[c || 'UNCLASSIFIED'] = (a[c || 'UNCLASSIFIED'] || 0) + 1;
        return a;
    }, {} as Record<string, number>), [rows, kind]);
    const industryCounts = useMemo(() => rows.reduce<Record<string,number>>((acc,item) => {
        const key=item.industryScope==='INDUSTRY_SPECIFIC'?'INDUSTRY_SPECIFIC':'COMMON';
        acc[key]=(acc[key]||0)+1;
        return acc;
    },{} as Record<string,number>),[rows]);
    const missingRoutes = useMemo(() => kind === 'gl_accounts'
        ? rows.filter(r => typeof r.usedInProcurement !== 'boolean' || typeof r.usedInBudget !== 'boolean' || typeof r.usedInProcurementPosting !== 'boolean').length
        : rows.filter(r => !array(obj(obj(r.accounting).glResolution).transactionRoutes).length).length,
        [rows, kind]);
    const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setFileData(null); setError(''); setQuery(''); setSelectedCode(''); setFileName(''); setIndustryPreview(''); setShowUnmatched(false); setOnlyFinanceExceptions(false);
        if (file.size > 48_000_000) return setError('File is larger than the 48 MB preview limit.');
        setBusy(true);
        try {
            const data: unknown = JSON.parse(await file.text());
            const root = obj(data);
            if (!Array.isArray(root[ITEMS[kind]])) throw new Error('This file does not contain the expected ' + ITEMS[kind] + ' array.');
            if (!obj(root.financialIntegration).masterBundleId) throw new Error('The selected file does not contain financial integration metadata.');
            setFileData(root); setFileName(file.name);
        } catch (ex) {
            setError(ex instanceof Error ? ex.message : 'Unable to open the selected JSON file.');
        } finally { setBusy(false); }
    };
    const acc = obj(selected?.accounting), resolution = obj(acc.glResolution), classification = obj(acc.catalogueClassification);
    const determination = obj(selected?.accountDetermination);
    const routes = array(resolution.transactionRoutes);
    return (
        <Card>
            <div className='space-y-2'>
                <h2 className='font-semibold text-white'>Preview new-model financial fields</h2>
                <p className='text-xs text-slate-400'>Inspect an uploaded reference file locally before Finance approval. Preview never imports, enables, or posts a GL account.</p>
                <label className='flex h-11 cursor-pointer items-center justify-center rounded-xl border border-slate-600 bg-slate-800 px-3 text-sm font-medium text-white'>
                    {busy ? 'Reading draft…' : 'Choose draft JSON to preview'}
                    <input type='file' accept='.json,application/json' className='sr-only' onChange={onFile} disabled={busy} />
                </label>
                {error && <Alert tone='error'>{error}</Alert>}
                {fileData && (
                    <div className='space-y-3'>
                        <div className='rounded-xl border border-amber-700/50 bg-amber-900/20 p-3 text-sm text-amber-200'>
                            <strong>{display(obj(fileData.financialIntegration).catalogueRelease)}</strong> · Not active or approved · {fileName}
                        </div>
                        <div className='flex flex-wrap gap-2 text-xs'>
                            <Badge>{rows.length.toLocaleString()} entries</Badge>
                            <Badge tone={missingRoutes ? 'warn' : 'muted'}>{missingRoutes} entries missing financial contract</Badge>
                            <Badge tone={financeExceptions ? 'warn' : 'muted'}>{financeExceptions} Finance mapping exceptions</Badge>
                            {branchCounts && Object.entries(branchCounts).map(([branch, count]) => <Badge key={branch}>{branch}: {Number(count)}</Badge>)}
                            {Object.entries(industryCounts).map(([scope,count])=><Badge key={scope}>{scope==='COMMON'?'Common':'Industry-specific'}: {Number(count)}</Badge>)}
                        </div>
                        <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                            <label className='block text-sm text-slate-300'>Preview defaults for a registered industry
                                <select value={industryPreview} onChange={e => {setIndustryPreview(e.target.value);setShowUnmatched(false);}} className='mt-1 h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-white'>
                                    <option value=''>Every industry</option>
                                    {'ABCDEFGHIJKLMNOPQRSTUV'.split('').map(code => <option key={code} value={'IND-'+code}>IND-{code} · ISIC section {code}</option>)}
                                </select>
                            </label>
                            <div className='flex items-end'>
                                <button type='button' disabled={!industryPreview} onClick={() => setShowUnmatched(v => !v)} className='h-11 w-full rounded-xl border border-slate-600 px-3 text-sm text-emerald-300 disabled:opacity-50'>
                                    {showUnmatched ? 'Show recommended only' : 'Include unmatched entries'}
                                </button>
                            </div>
                        </div>
                        {industryPreview && <p className='text-xs text-slate-400'>Showing common and matching industry entries by default. Unmatched entries remain available for explicit adoption.</p>}
                        <label className='block text-sm text-slate-300'>
                            Search all draft entries
                            <input className='mt-1 h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-white' value={query} onChange={e => setQuery(e.target.value)} placeholder='Search name or code (no automatic focus)' />
                        </label>
                        {financeExceptions > 0 && <button type='button' onClick={() => setOnlyFinanceExceptions(v => !v)} className='min-h-11 rounded-xl border border-amber-700/60 px-3 text-sm text-amber-200'>
                            {onlyFinanceExceptions ? 'Show all draft entries' : 'Review Finance mapping exceptions (' + financeExceptions + ')'}
                        </button>}
                        <p className='text-xs text-slate-400'>{filtered.length.toLocaleString()} matches · showing first 40</p>
                        <div className='max-h-64 space-y-1 overflow-y-auto'>
                            {filtered.slice(0, 40).map(item => <button type='button' key={text(item.code)} onClick={() => setSelectedCode(text(item.code))} className={'w-full rounded-lg border p-2 text-left text-xs '+(selectedCode === item.code ? 'border-emerald-500 bg-slate-800 text-white' : 'border-slate-700 text-slate-300')}>
                                <span className='font-mono'>{text(item.code)}</span> · {text(item.name)} · {item.industryScope==='INDUSTRY_SPECIFIC'?'Industry-specific':'Common'}
                            </button>)}
                        </div>
                        {selected && (
                            <section aria-label='Full draft financial configuration' className='space-y-3 rounded-xl border border-slate-700 p-3 text-sm'>
                                <h3 className='font-semibold text-white'>{text(selected.name)} · {selectedCode}</h3>
                                <div className='grid grid-cols-2 gap-2 text-xs'>
                                    {Object.entries({
                                        'Industry applicability': selected.industryScope,
                                        'Linked industry codes': selected.industryCodes,
                                        'Industry classification review': obj(selected.industryApplicability).reviewStatus,
                                        'MRO / Non-MRO': classification.majorBranch,
                                        'Stores class': classification.storesClassCode,
                                        'Technical class': classification.technicalClassCode,
                                        'Material number pattern': classification.numberingPattern,
                                        'GL mapping status': resolution.mappingStatus || determination.mappingStatus,
                                        'GL determination mode': resolution.mode || determination.procurementSelectionMode,
                                        'Procurement eligible': selected.usedInProcurement,
                                        'Budget eligible': selected.usedInBudget,
                                        'Procurement posting eligible': selected.usedInProcurementPosting,
                                        'Procurement candidate': selected.procurementCandidate,
                                        'Finance review required': selected.pendingFinanceApproval,
                                        'Account purpose': determination.accountPurpose,
                                    }).filter(([,v]) => v !== undefined).map(([label, value]) => (
                                        <div key={label} className='min-w-0 rounded-lg bg-slate-900 p-2'>
                                            <p className='text-slate-400'>{label}</p>
                                            <p className='mt-1 break-words text-slate-100'>{display(value)}</p>
                                        </div>
                                    ))}
                                </div>
                                {!!routes.length && <div className='space-y-1'>
                                    <h4 className='font-semibold'>Applicable GL routes ({routes.length})</h4>
                                    {routes.map((r, i) => <div key={i} className='rounded-lg bg-slate-900 p-2 text-xs'>
                                        <p className='font-medium'>{display(r.event)} · {display(r.glCode)}</p>
                                        <p className='text-slate-300'>{display(r.glName)}</p>
                                        <p className='text-amber-300'>{display(r.status)} · {r.referenceOnlyNotDefaultExpense ? 'Maintenance context required' : 'Reference only until approved'}</p>
                                        {Object.keys(obj(r.runtimeTransactionBinding)).length>0&&<p className='text-slate-300'>MEMS posting: {display(obj(r.runtimeTransactionBinding).memsPostingEvents)} · {display(obj(r.runtimeTransactionBinding).postingIntegrationState)} · {display(obj(r.runtimeTransactionBinding).registryAction)}</p>}
                                    </div>)}
                                </div>}
                                <details className='rounded-lg border border-slate-700 p-2'>
                                    <summary className='cursor-pointer font-medium'>All accounting and catalogue metadata</summary>
                                    <div className='mt-2 space-y-2 text-xs'>
                                        {Object.entries(kind === 'gl_accounts' ? selected : acc).map(([key, value]) => <div key={key} className='border-t border-slate-700 pt-2'>
                                            <p className='font-medium text-slate-300'>{readable(key)}</p>
                                            <p className='mt-1 whitespace-pre-wrap break-all text-slate-400'>{display(value)}</p>
                                        </div>)}
                                    </div>
                                </details>
                            </section>
                        )}
                    </div>
                )}
            </div>
        </Card>
    );
}
