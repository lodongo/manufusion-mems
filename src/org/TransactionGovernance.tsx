import { useState } from 'react';
import { callBackend } from '../lib/backend';
import GovernanceReports from './GovernanceReports';
import TransactionBlueprints from './TransactionBlueprints';
import { ArrowRight } from 'lucide-react';
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
    description: 'Every transaction of your modules with its state and security access. Live transactions follow their permission; reserved ones can have security roles pre-assigned.',
    details: ['No organization-level transaction binding setup or second-person binding approval is required.', 'Existing role permissions, organizational access rules and business-specific approval workflows remain in force.', 'MEMS Admin manages the platform transaction code catalogue.'],
  },
  permissions: {
    title: 'Security Permissions',
    description: 'Security Roles determine the actions an employee can perform within an authorized organizational scope.',
    details: ['Existing Security Roles continue to control operational access.', 'Transaction permissions are organized by module and action in the catalogue.', 'Business authorization and approval settings remain separate from automatic transaction code registration.'],
  },
  authority: {
    title: 'Chart of Authority',
    description: 'Authority and business approval rules are configured through the appropriate role and workflow settings. Transaction code binding is already handled at platform level.',
    details: ['No activation or manual transaction binding review is needed.', 'Maintain financial approval limits, approver roles and business workflow policies independently.', 'Existing business approval procedures remain operational.'],
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
      {active === 'transactions' && (canRoles ? <TransactionBlueprints /> : <p className='rounded-xl border border-line p-4 text-sm text-soft'>Transaction access is configured by people with the right to manage security roles (ADM.roles).</p>)}

    </div>
  );
}
