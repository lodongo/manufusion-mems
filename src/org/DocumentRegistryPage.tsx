import { useEffect, useState } from 'react';
import { FilePlus2, RefreshCw, FileText } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { PageTitle, Card, useLoad } from '../admin/kit';
import DocumentSourceStaging from './DocumentSourceStaging';
import EngineeringDocumentLinks from './EngineeringDocumentLinks';
import SheqSdsRegistry from './SheqSdsRegistry';
import DigitalRcaDraft from './DigitalRcaDraft';
import DigitalRcaWorkspace from './DigitalRcaWorkspace';
import EffectiveDocumentFiles from './EffectiveDocumentFiles';

type ScopeNode = { id: string; name: string; level: string; parentId: string };
type DocumentSetup = { config: { enabledClassCodes: string[]; defaultReviewMonths: number; enabledSubmodules?: string[] }; locations: ScopeNode[] };
type DocumentRow = {
  documentId: string; title: string; classCode: string; status: string;
  revision: string; updatedAt: string; subtypeCode?:string; dmaicStage?:string;methodCode?:string;frameworkCode?:string;
};
const CLASSES = [
 ['POL','Policy'], ['STR','Strategy'], ['PRG','Management program'],
 ['MAN','Management manual'], ['PLN','Management plan'], ['PRC','Procedure'],
 ['SOP','Standard operating procedure'], ['WIN','Work instruction'],
 ['STD','Internal standard'], ['SPC','Specification'], ['FRM','Form'],
 ['TMP','Template'], ['REG','Register'], ['REC','Record'], ['RPT','Report'],
] as const;

export default function DocumentRegistryPage({ canConfigure, canReview, mode = 'register' }: { canConfigure: boolean; canReview: boolean; mode?: 'register'|'engineering'|'sds'|'rca'|'review'|'knowledge'|'forms'|'config' }) {
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
  const [enabledClasses, setEnabledClasses] = useState<string[]>([]);
  const [enabledSubmodules,setEnabledSubmodules]=useState<string[]>(['register','engineering','sds','rca','review','knowledge','forms']);
  useEffect(()=>{if(setup.data?.config) setEnabledSubmodules(setup.data.config.enabledSubmodules??['register','engineering','sds','rca','review','knowledge','forms']);},[setup.data?.config]);
  useEffect(() => { if (setup.data?.config.defaultReviewMonths) setReviewMonths(setup.data.config.defaultReviewMonths); }, [setup.data?.config.defaultReviewMonths]);
  useEffect(() => { if (setup.data?.config.enabledClassCodes) setEnabledClasses(setup.data.config.enabledClassCodes); }, [setup.data?.config.enabledClassCodes]);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [reviewing, setReviewing] = useState('');
  const [reviewReason,setReviewReason]=useState('');
  const [documentSearch, setDocumentSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const [createError, setCreateError] = useState('');
  const updateSettings = async () => {
    setConfigBusy(true); setSettingsError(''); setSettingsNotice('');
    try {
      await callBackend('/api/org/drkms/configure', {
        enabledClassCodes: enabledClasses,
        defaultReviewMonths: reviewMonths,
        enabledSubmodules,
      });
      setSettingsNotice('Document settings saved.');
      setup.reload();
    } catch (err) { setSettingsError(err instanceof Error ? err.message : 'Unable to save settings.'); }
    finally { setConfigBusy(false); }
  };
  const reviewDecision=async(documentId:string,decision:'return'|'reject'|'verify')=>{
    setReviewing(documentId);setCreateError('');setNotice('');
    try{
      await callBackend('/api/org/drkms/documents/review-decision',{documentId,decision,reason:reviewReason.trim()});
      setNotice('Review decision recorded. Publication remains subject to independent CoA authorization.');
      setReviewReason('');reload();
    }catch(err){setCreateError(err instanceof Error?err.message:'Could not record review decision.');}
    finally{setReviewing('');}
  };
  const submitReview = async (documentId:string) => {
    setReviewing(documentId);setCreateError('');setNotice('');
    try{
      await callBackend('/api/org/drkms/documents/submit-review',{documentId});
      setNotice('Draft submitted for review. Approval and publication remain disabled until workflow configuration is completed.');
      reload();
    }catch(error){setCreateError(error instanceof Error?error.message:'Could not submit for review.');}
    finally{setReviewing('');}
  };
  const create = async () => {
    if (busy || title.trim().length < 3 || !scopeNodeId) return;
    setBusy(true); setCreateError(''); setNotice('');
    try {
      await callBackend('/api/org/drkms/documents/create-draft', { title: title.trim(), classCode, scopeNodeId });
      setTitle('');
      setNotice('Draft document registered. Stage controlled sources before review; publication requires an approved CoA transaction.');
      reload();
    } catch (err) { setCreateError(err instanceof Error ? err.message : 'Could not create document.'); }
    finally { setBusy(false); }
  };
  if(mode!=='config' && setup.data?.config.enabledSubmodules &&
    !setup.data.config.enabledSubmodules.includes(mode)) return <div className='rounded-xl border border-slate-700 p-4 text-sm text-slate-200'>This DOC submodule is disabled in organization configuration.</div>;
  return <div className='space-y-4'>
    <PageTitle title={({register:'Document register',engineering:'Engineering & equipment library',sds:'SHEQ SDS / MSDS',rca:'Digital RCA & investigations',review:'Review & approvals',knowledge:'Knowledge & troubleshooting',forms:'Digital forms & records',config:'DOC configuration'} as Record<string,string>)[mode]} subtitle='Documentation & Records (DOC) · Controlled enterprise knowledge' />
    {(mode==='config'||mode==='register') && canConfigure && <Card>
      <h2 className='mb-2 text-base font-semibold text-white'>Organization document settings</h2>
      <p className='mb-3 text-xs text-slate-400'>Global document classifications are inherited; locations come from the existing organization hierarchy.</p>
      <label className='block text-sm text-slate-200'>Default review cycle (months)
        <input type='number' min={1} max={120} value={reviewMonths}
          onChange={e => setReviewMonths(Number(e.target.value))}
          className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'/>
      </label>
      <fieldset className='mt-3 space-y-2'><legend className='mb-2 text-sm font-medium text-slate-200'>Enabled document classes</legend>
        <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
          {CLASSES.map(([code,label])=><label key={code} className='flex min-h-11 items-center gap-2 rounded-lg border border-slate-700 p-2 text-sm text-slate-200'>
            <input type='checkbox' checked={enabledClasses.includes(code)} onChange={e=>setEnabledClasses(old=>e.target.checked?[...old,code]:old.filter(x=>x!==code))} className='h-4 w-4' />
            <span>{code} · {label}</span>
          </label>)}
        </div>
        <p className='text-xs text-slate-400'>Other global classifications retain their existing enabled status.</p>
      </fieldset>
      <fieldset className='mt-3 space-y-2'><legend className='text-sm font-medium text-slate-200'>Enabled DOC submodules</legend>
        {([['register','Document register'],['engineering','Engineering & equipment library'],['sds','SHEQ SDS / MSDS'],['rca','Digital RCA & investigations'],['review','Review & approvals'],['knowledge','Knowledge & troubleshooting'],['forms','Digital forms & records']] as const).map(([key,label])=><label key={key} className='flex min-h-10 items-center gap-2 text-sm text-slate-200'>
          <input type='checkbox' checked={enabledSubmodules.includes(key)} onChange={e=>setEnabledSubmodules(old=>e.target.checked?[...old,key]:old.filter(v=>v!==key))}/>{label}
        </label>)}
      </fieldset>
      <button type='button' disabled={configBusy || enabledClasses.length===0 || !Number.isInteger(reviewMonths) || reviewMonths < 1 || reviewMonths > 120}
        onClick={() => void updateSettings()} className='mt-3 min-h-11 rounded-lg border border-slate-600 px-4 text-sm font-semibold text-white'>
        {configBusy ? 'Saving…' : 'Save settings'}
      </button>
      <p className='mt-2 text-xs text-slate-400'>Current saved review cycle: {setup.data?.config.defaultReviewMonths ?? 24} months</p>
      {settingsNotice && <p role='status' className='mt-2 text-sm text-green-300'>{settingsNotice}</p>}
      {settingsError && <p role='alert' className='mt-2 text-sm text-red-300'>{settingsError}</p>}
    </Card>}
    {mode==='register' && <Card>
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
    </Card>}
    {(mode==='register'||mode==='engineering') && <DocumentSourceStaging documents={data?.documents ?? []} />}
    {mode==='engineering' && <EngineeringDocumentLinks documents={data?.documents ?? []} />}
    {mode==='sds' && <SheqSdsRegistry canConfigure={canConfigure} />}
    {mode==='rca' && <><DigitalRcaDraft locations={setup.data?.locations ?? []} onCreated={reload} /><DigitalRcaWorkspace documents={data?.documents ?? []}/></>}
    {(mode==='register'||mode==='review') && <Card>
      <div className='mb-3 flex items-center justify-between gap-2'>
        <h2 className='font-semibold text-white'>{mode==='review'?'Document review queue':'Registered documents'}</h2>
        <button type='button' aria-label='Refresh documents' onClick={reload}
          className='rounded-lg border border-slate-600 p-2 text-slate-200'><RefreshCw size={18}/></button>
      </div>
      {loading && <p className='text-sm text-slate-300'>Loading documents…</p>}
      {error && <p role='alert' className='text-sm text-red-300'>{error}</p>}
      {!loading && !error && !data?.documents.length && <p className='text-sm text-slate-400'>No registered documents yet.</p>}
      <div className='mb-3 grid min-w-0 gap-2'>
        <input value={documentSearch} onChange={e=>setDocumentSearch(e.target.value)} placeholder='Search title, code or ID'
          aria-label='Search registered documents'
          className='min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'/>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}
          aria-label='Filter document status'
          className='min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'>
          <option value='all'>All statuses</option><option value='draft'>Drafts</option>
          <option value='in_review'>Submitted for review</option>
        </select>
      </div>
      <div className='space-y-2'>
        {(data?.documents ?? []).filter(d=>(mode!=='review'||d.status==='in_review'||d.status==='technical_verified') && (statusFilter==='all'||d.status===statusFilter) &&
           [d.title,d.classCode,d.documentId].some(v=>String(v??'').toLowerCase().includes(documentSearch.trim().toLowerCase()))).map(d => <div key={d.documentId} className='min-w-0 rounded-lg border border-slate-700 p-3'>
          <div className='flex items-start gap-2'><FileText className='mt-0.5 shrink-0 text-blue-300' size={18}/>
            <div className='min-w-0 flex-1'>
              <p className='break-words font-medium text-white'>{d.title}</p>
              <p className='mt-1 break-all text-xs text-slate-400'>{d.classCode} · {d.documentId}</p>
              <p className='mt-1 text-xs text-slate-400'>Revision {d.revision} · {d.status}</p>
              {d.status==='in_review' && canReview && <div className='mt-2 space-y-2'>
                <label className='block text-xs text-slate-200'>Review reason
                  <textarea rows={2} value={reviewReason} onChange={e=>setReviewReason(e.target.value)}
                    className='mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-2 text-white' placeholder='Reason for return or rejection'/>
                </label>
                <div className='flex flex-wrap gap-2'>
                  <button type='button' disabled={!!reviewing||reviewReason.trim().length<10} onClick={()=>void reviewDecision(d.documentId,'verify')} className='min-h-10 rounded-lg border border-blue-500 px-3 text-xs text-blue-200 disabled:opacity-50'>Technically verify</button>
                  <button type='button' disabled={!!reviewing||reviewReason.trim().length<10} onClick={()=>void reviewDecision(d.documentId,'return')} className='min-h-10 rounded-lg border border-slate-600 px-3 text-xs text-white disabled:opacity-50'>Return for changes</button>
                  <button type='button' disabled={!!reviewing||reviewReason.trim().length<10} onClick={()=>void reviewDecision(d.documentId,'reject')} className='min-h-10 rounded-lg border border-red-700 px-3 text-xs text-red-200 disabled:opacity-50'>Reject</button>
                </div>
              </div>}
              {d.status==='effective' && <EffectiveDocumentFiles documentId={d.documentId} />}
              {d.status==='draft' && <button type='button' disabled={!!reviewing} onClick={()=>void submitReview(d.documentId)} className='mt-2 min-h-10 rounded-lg border border-blue-500 px-3 text-xs font-semibold text-blue-200 disabled:opacity-40'>{reviewing===d.documentId?'Submitting…':'Submit for review'}</button>}
            </div>
          </div>
        </div>)}
      </div>
    </Card>}
    {mode==='knowledge' && <Card><p className='text-sm text-slate-200'>Open Asset Management and select an equipment item to access its scoped technical dossier, maintenance evidence and troubleshooting search. Full manual indexing and AI diagnosis are not yet enabled.</p></Card>}
    {mode==='forms' && <Card><p className='text-sm text-slate-200'>Controlled digital form schemas and OCR contracts are in development. Executable forms and OCR processing are not yet released.</p></Card>}
    <p className='text-xs text-slate-400'>Restricted to dedicated document permissions for the foundation stage. Files are available only after controlled verification and approved publication.</p>
  </div>;
}
