import { useEffect, useState } from 'react';
import { FilePlus2, RefreshCw, FileText } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { PageTitle, Card, useLoad } from '../admin/kit';

type ScopeNode = { id: string; name: string; level: string; parentId: string };
type DocumentSetup = { config: { enabledClassCodes: string[]; defaultReviewMonths: number }; locations: ScopeNode[] };
type DocumentRow = {
  documentId: string; title: string; classCode: string; status: string;
  revision: string; updatedAt: string;
};
const CLASSES = [
 ['POL','Policy'], ['STR','Strategy'], ['PRG','Management program'],
 ['MAN','Management manual'], ['PLN','Management plan'], ['PRC','Procedure'],
 ['SOP','Standard operating procedure'], ['WIN','Work instruction'],
 ['STD','Internal standard'], ['SPC','Specification'], ['FRM','Form'],
 ['TMP','Template'], ['REG','Register'], ['REC','Record'], ['RPT','Report'],
] as const;

export default function DocumentRegistryPage({ canConfigure }: { canConfigure: boolean }) {
  const { data, error, loading, reload } = useLoad(
    () => callBackend<{ documents: DocumentRow[] }>('/api/org/drkms/documents/list', {}), []
  );
  const setup = useLoad(() => callBackend<DocumentSetup>('/api/org/drkms/setup', {}), []);
  const [scopeNodeId, setScopeNodeId] = useState('');
  const [searchLocation, setSearchLocation] = useState('');
  const [locationLevel, setLocationLevel] = useState('legal_entity');
  const nodes = setup.data?.locations ?? [];
  const scopedNodes = nodes.filter(n => n.level === locationLevel && n.name.toLowerCase().includes(searchLocation.toLowerCase()));
  const chosen = nodes.find(n => n.id === scopeNodeId);
  useEffect(() => { if (chosen && chosen.level !== locationLevel) setScopeNodeId(''); }, [locationLevel, chosen]);
  const [title, setTitle] = useState('');
  const [classCode, setClassCode] = useState('PRC');
  const [busy, setBusy] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [reviewMonths, setReviewMonths] = useState(24);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [notice, setNotice] = useState('');
  const [createError, setCreateError] = useState('');
  const updateSettings = async () => {
    setConfigBusy(true); setSettingsError(''); setSettingsNotice('');
    try {
      await callBackend('/api/org/drkms/configure', {
        enabledClassCodes: setup.data?.config.enabledClassCodes ?? CLASSES.map(([code]) => code),
        defaultReviewMonths: reviewMonths,
      });
      setSettingsNotice('Document settings saved.');
      setup.reload();
    } catch (err) { setSettingsError(err instanceof Error ? err.message : 'Unable to save settings.'); }
    finally { setConfigBusy(false); }
  };
  const create = async () => {
    if (busy || title.trim().length < 3 || !scopeNodeId) return;
    setBusy(true); setCreateError(''); setNotice('');
    try {
      await callBackend('/api/org/drkms/documents/create-draft', { title: title.trim(), classCode, scopeNodeId });
      setTitle('');
      setNotice('Draft document registered. Content editing, file uploads and publication are not yet available.');
      reload();
    } catch (err) { setCreateError(err instanceof Error ? err.message : 'Could not create document.'); }
    finally { setBusy(false); }
  };
  return <div className='space-y-4'>
    <PageTitle title='Document Registry' subtitle='Controlled document identities · Foundation release (drafts only)' />
    {canConfigure && <Card>
      <h2 className='mb-2 text-base font-semibold text-white'>Organization document settings</h2>
      <p className='mb-3 text-xs text-slate-400'>Global document classifications are inherited; locations come from the existing organization hierarchy.</p>
      <label className='block text-sm text-slate-200'>Default review cycle (months)
        <input type='number' min={1} max={120} value={reviewMonths}
          onChange={e => setReviewMonths(Number(e.target.value))}
          className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'/>
      </label>
      <button type='button' disabled={configBusy || !Number.isInteger(reviewMonths) || reviewMonths < 1 || reviewMonths > 120}
        onClick={() => void updateSettings()} className='mt-3 min-h-11 rounded-lg border border-slate-600 px-4 text-sm font-semibold text-white'>
        {configBusy ? 'Saving…' : 'Save settings'}
      </button>
      <p className='mt-2 text-xs text-slate-400'>Current saved review cycle: {setup.data?.config.defaultReviewMonths ?? 24} months</p>
      {settingsNotice && <p role='status' className='mt-2 text-sm text-green-300'>{settingsNotice}</p>}
      {settingsError && <p role='alert' className='mt-2 text-sm text-red-300'>{settingsError}</p>}
    </Card>}
    <Card>
      <h2 className='mb-3 text-base font-semibold text-white'>Register a document draft</h2>
      <div className='grid min-w-0 gap-3'>
        <label className='block text-sm text-slate-200'>Document title
          <input value={title} maxLength={200} onChange={e => setTitle(e.target.value)}
            placeholder='e.g. Maintenance Planning Procedure'
            className='mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-600 bg-slate-900 px-3 text-white' />
        </label>
        <label className='block text-sm text-slate-200'>Document classification
          <select value={classCode} onChange={e => setClassCode(e.target.value)}
            className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'>
            {CLASSES.filter(([code]) => !setup.data || setup.data.config.enabledClassCodes.includes(code)).map(([code,label]) => <option key={code} value={code}>{code} — {label}</option>)}
          </select>
        </label>
        <label className='block text-sm text-slate-200'>Applicability level
          <select value={locationLevel} onChange={e => { setLocationLevel(e.target.value); setScopeNodeId(''); }} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'>
            <option value='legal_entity'>Legal entity</option><option value='site'>Site</option><option value='department'>Department</option><option value='cost_center'>Cost center</option>
          </select>
        </label>
        <label className='block text-sm text-slate-200'>Search locations
          <input value={searchLocation} onChange={e => setSearchLocation(e.target.value)} placeholder='Filter locations (optional)' className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'/>
        </label>
        <label className='block text-sm text-slate-200'>Applicable organizational location
          <select value={scopeNodeId} onChange={e => setScopeNodeId(e.target.value)}
            className='mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'>
            <option value=''>Select location</option>
            {scopedNodes.map(n => <option key={n.id} value={n.id}>{n.level.replaceAll('_',' ')} — {n.name}</option>)}
          </select>
          <span className='mt-1 block text-xs text-slate-400'>Only locations at the chosen level appear. Hierarchy is validated by MEMS.</span>
        </label>
        {setup.error && <p role='alert' className='text-sm text-red-300'>{setup.error}</p>}
        <button type='button' disabled={busy || title.trim().length < 3 || !scopeNodeId || setup.loading}
          onClick={() => void create()}
          className='flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50'>
          <FilePlus2 size={18} />{busy ? 'Registering…' : 'Create draft'}
        </button>
      </div>
      {notice && <p role='status' className='mt-3 text-sm text-green-300'>{notice}</p>}
      {createError && <p role='alert' className='mt-3 text-sm text-red-300'>{createError}</p>}
    </Card>
    <Card>
      <div className='mb-3 flex items-center justify-between gap-2'>
        <h2 className='font-semibold text-white'>Registered documents</h2>
        <button type='button' aria-label='Refresh documents' onClick={reload}
          className='rounded-lg border border-slate-600 p-2 text-slate-200'><RefreshCw size={18}/></button>
      </div>
      {loading && <p className='text-sm text-slate-300'>Loading documents…</p>}
      {error && <p role='alert' className='text-sm text-red-300'>{error}</p>}
      {!loading && !error && !data?.documents.length && <p className='text-sm text-slate-400'>No registered documents yet.</p>}
      <div className='space-y-2'>
        {(data?.documents ?? []).map(d => <div key={d.documentId} className='min-w-0 rounded-lg border border-slate-700 p-3'>
          <div className='flex items-start gap-2'><FileText className='mt-0.5 shrink-0 text-blue-300' size={18}/>
            <div className='min-w-0 flex-1'>
              <p className='break-words font-medium text-white'>{d.title}</p>
              <p className='mt-1 break-all text-xs text-slate-400'>{d.classCode} · {d.documentId}</p>
              <p className='mt-1 text-xs text-slate-400'>Revision {d.revision} · {d.status}</p>
            </div>
          </div>
        </div>)}
      </div>
    </Card>
    <p className='text-xs text-slate-400'>Restricted to dedicated document permissions for the foundation stage. No files or published revisions are created here.</p>
  </div>;
}
