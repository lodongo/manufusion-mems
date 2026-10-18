import { useState } from 'react';
import { callBackend } from '../lib/backend';
import GovernanceReports from './GovernanceReports';
import TransactionBlueprints from './TransactionBlueprints';
import GovernancePolicyAdmin from './GovernancePolicyAdmin';
import GovernanceCutoverAdmin from './GovernanceCutoverAdmin';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { navigate } from '../lib/route';

type Tab = 'transactions' | 'permissions' | 'authority' | 'workflows' | 'documentation' | 'reports';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'transactions', label: 'Transactions' },
  { key: 'permissions', label: 'Security' },
  { key: 'authority', label: 'Authority' },
  { key: 'workflows', label: 'Workflows' },
  { key: 'documentation', label: 'Documents' },
  { key: 'reports', label: 'Audit reports' },
];

const panels: Record<Tab, { title: string; description: string; details: string[] }> = {
  transactions: {
    title: 'Transaction Registry',
    description: 'Browse transaction definitions and installed permission mappings by module and submodule. Endpoint verification controls activation.',
    details: ['Transaction activation requires verified backend enforcement.', 'Existing permission mappings are retained; endpoint verification remains required.', 'The catalogue distinguishes current permission references from reserved designs.'],
  },
  permissions: {
    title: 'Security Permissions',
    description: 'Security Roles determine the actions an employee can perform within an authorized organizational scope.',
    details: ['Existing Security Roles continue to control operational access.', 'Transaction permissions are organized by module and action in the catalogue.', 'Additional governance controls will require independent approval before activation.'],
  },
  authority: {
    title: 'Chart of Authority',
    description: 'The planned unified authority engine will evaluate amount bands, organizational inheritance, mandatory specialist streams and governance rules.',
    details: ['CoA rules select required streams and levels, not named approvers.', 'Currency evidence and site-specific overrides will be recorded.', 'Rule changes will be simulated and independently approved before activation.'],
  },
  reports: {
    title: 'Governance auditing and reporting',
    description: 'Review the current configuration and inspect historical audit events by selected period.',
    details: ['Historical events are retrieved by date in bounded batches; source reconciliation is pending.', 'Current previews are not certified, shareable public reports.', 'Publication requires complete evidence, approval and redaction.'],
  },
  documentation: {
    title: 'Legal-entity module documentation',
    description: 'Draft and version module governance documents separately for every legal entity. Drafts do not change permissions, authority limits or workflows.',
    details: ['Documents use major.minor.patch versions.', 'Activation requires separate platform certification and legal-entity sign-off.', 'Export and controlled approval remain in development.'],
  },
  workflows: {
    title: 'Workflow Configuration',
    description: 'Workflows resolve authorized approvers and execute the approval requirements produced by the Chart of Authority.',
    details: ['Flexible levels and mixed sequential/parallel routing are being built.', 'Job roles, managers, named employees and groups are supported in the target architecture.', 'The configured workflow editor remains available; unified routing integration is being verified.'],
  },
};

export default function TransactionGovernance({ canRoles, canWorkflow }: { canRoles: boolean; canWorkflow: boolean }) {
  const [active, setActive] = useState<Tab>('transactions');
  const [reviewModule,setReviewModule] = useState('MNT');
  const [entity, setEntity] = useState('');
  const [docModule, setDocModule] = useState('PRC');
  const [docVersion, setDocVersion] = useState('1.0.0');
  const [docStatus, setDocStatus] = useState('');
  const [docBusy, setDocBusy] = useState(false);
  const createDraft = async () => {
    setDocBusy(true); setDocStatus('');
    try {
      const response = await callBackend<{ id: string }>('/api/org/governance/documents/draft', { legalEntityId: entity.trim(), moduleCode: docModule, documentVersion: docVersion.trim() });
      setDocStatus('Draft created: ' + response.id + '. Approval and activation are not available yet.');
    } catch (e) { setDocStatus(e instanceof Error ? e.message : 'Could not create draft.'); }
    finally { setDocBusy(false); }
  };
  const current = panels[active];
  const go = (page: string) => navigate('organization_admin/' + page);

  return (
    <div className='w-full min-w-0 max-w-6xl mx-auto space-y-4 px-1 pb-8'>
      <header className='space-y-2'>
        <h1 className='text-xl sm:text-2xl font-bold text-ink'>Transaction Governance</h1>
        <p className='text-sm text-soft'>One place for transaction permissions, authority and approval workflows.</p>
      </header>
      <section className='rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100' role='status'>
        <div className='flex items-start gap-2'>
          <AlertTriangle className='h-5 w-5 shrink-0' aria-hidden='true'/>
          <div className='min-w-0'>
            <p className='text-sm font-semibold'>Unified governance activation pending verification</p>
            <p className='text-xs leading-relaxed mt-1'>Existing transaction controls remain in effect. Complete backend integration, security tests and production certification before activating unified governance.</p>
          </div>
        </div>
      </section>
      <nav aria-label='Governance areas' className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2'>
        {TABS.map(t => <button key={t.key} type='button' aria-current={active === t.key ? 'page' : undefined} onClick={() => setActive(t.key)}
          className={`min-w-0 rounded-lg px-3 py-3 text-sm font-semibold border ${active === t.key ? 'border-[rgb(var(--c-brand))] bg-[rgb(var(--c-brand)/0.08)] text-[rgb(var(--c-brand))]' : 'border-[rgb(var(--c-border))] text-ink'}`}>{t.label}</button>)}
      </nav>
      <section className='rounded-xl border border-[rgb(var(--c-border))] p-4 space-y-3'>
        <h2 className='text-lg font-bold text-ink'>{current.title}</h2>
        <p className='text-sm text-soft'>{current.description}</p>
        <ul className='list-disc pl-5 space-y-2 text-sm text-ink'>{current.details.map(d => <li key={d}>{d}</li>)}</ul>
        {active === 'permissions' && canRoles && <button type='button' onClick={() => go('roles')} className='inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold text-ink'>Open Security Roles <ArrowRight size={16}/></button>}
        {active === 'workflows' && canWorkflow && <button type='button' onClick={() => go('workflows')} className='inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold text-ink'>Open Workflow Configuration <ArrowRight size={16}/></button>}
      </section>
      {active === 'permissions' && canWorkflow && <GovernancePolicyAdmin initialModule={reviewModule} />}
      {active === 'authority' && canWorkflow && <GovernanceCutoverAdmin onReviewBinding={module=>{setReviewModule(module);setActive('permissions');}} />}
      {active === 'reports' && <GovernanceReports />}
      {active === 'documentation' && <section className='rounded-xl border border-[rgb(var(--c-border))] p-4 space-y-3'>
        <h2 className='font-semibold text-ink'>Create a controlled draft</h2>
        <p className='text-xs text-soft'>Use the legal entity ID from Organization Design. Only authorized governance administrators can create drafts.</p>
        <label className='block text-sm text-ink'>Legal entity ID<input value={entity} onChange={e=>setEntity(e.target.value)} placeholder='Legal entity ID' className='mt-1 w-full rounded-lg border border-[rgb(var(--c-border))] bg-transparent p-3 text-base'/></label>
        <label className='block text-sm text-ink'>Module<select value={docModule} onChange={e=>setDocModule(e.target.value)} className='mt-1 w-full rounded-lg border border-[rgb(var(--c-border))] bg-transparent p-3 text-base'>{['PRC','MNT','INV','AST','FIN','SAF','WHS'].map(m=><option key={m} value={m}>{m}</option>)}</select></label>
        <label className='block text-sm text-ink'>Document version<input value={docVersion} onChange={e=>setDocVersion(e.target.value)} placeholder='1.0.0' className='mt-1 w-full rounded-lg border border-[rgb(var(--c-border))] bg-transparent p-3 text-base'/></label>
        <button type='button' disabled={docBusy || !entity.trim() || !/^\\d+\\.\\d+\\.\\d+$/.test(docVersion)} onClick={createDraft} className='rounded-lg bg-[rgb(var(--c-brand))] text-white px-4 py-3 text-sm font-semibold disabled:opacity-50'>Create draft only</button>
        {docStatus && <p role='status' className='text-sm text-ink break-words'>{docStatus}</p>}
      </section>}
      {active === 'transactions' && <TransactionBlueprints />}

    </div>
  );
}
