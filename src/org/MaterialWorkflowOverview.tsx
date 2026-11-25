import { AlertTriangle, Settings2, Users } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { navigate } from '../lib/route';

// Read-only view of the two Materials Master workflows: PRC-001 (new material) and PRC-002 (warehouse extension).
// Each level shows whether it reviews or approves, who it is assigned to and who holds it today, and flags a level
// nobody can act on. Changing a workflow is done by workflow administrators in Administration › Workflows, where every
// change needs a reason, is versioned and audited.

interface Level { level: number; action: string; mode: string; assignee: string; people: string[]; gap: string }
interface Flow { code: string; name: string; configured: boolean; enabled: boolean; version: number; updatedAt: string; changeReason: string; approvalMode: string; approvalRule: string; levels: Level[] }

export default function MaterialWorkflowOverview() {
    const { data, loading, error } = useLoad(() => callBackend<{ workflows: Flow[]; canConfigure: boolean }>('/api/org/procurement/materials/workflow/overview'));
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the workflows.'}</Alert>;
    return (
        <div className='space-y-3'>
            <p className='text-xs text-muted'>Requesters can never approve their own request, and one person cannot decide two levels of the same request. Decisions are approve, return for correction, or reject.</p>
            {data.workflows.map((w) => (
                <section key={w.code} className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                    <div className='flex flex-wrap items-start justify-between gap-2'>
                        <div className='min-w-0'>
                            <p className='font-mono text-xs text-muted'>{w.code}{w.version ? ` · version ${w.version}` : ''}</p>
                            <h2 className='text-sm font-semibold text-ink'>{w.name}</h2>
                            <p className='text-xs text-soft'>{w.approvalMode === 'parallel' ? 'Levels decide in any order' : 'Levels decide in order'} · {w.approvalRule === 'any' ? 'any one approval completes it' : 'every level must approve'}</p>
                        </div>
                        <Badge tone={w.enabled ? 'brand' : 'danger'}>{w.enabled ? 'Enabled' : w.configured ? 'Disabled' : 'Not configured'}</Badge>
                    </div>
                    {!w.enabled && <Alert tone='warn'>Requests cannot be submitted until this workflow is enabled and configured.</Alert>}
                    <ol className='space-y-2'>
                        {w.levels.map((l) => (
                            <li key={l.level} className='rounded-xl border border-line bg-page p-3'>
                                <div className='flex flex-wrap items-center justify-between gap-2'>
                                    <p className='text-sm font-semibold text-ink'>Level {l.level} · {l.action === 'review' ? 'Review and recommend' : 'Approve'}</p>
                                    <Badge tone={l.gap ? 'danger' : 'muted'}>{l.mode === 'role' ? 'Position' : l.mode === 'user' ? 'Named person' : 'Reporting line'}</Badge>
                                </div>
                                <p className='mt-1 text-xs text-soft'>{l.assignee}</p>
                                {l.mode !== 'manager' && (
                                    <p className='mt-1 flex items-start gap-1.5 text-xs text-ink'>
                                        <Users aria-hidden className='mt-0.5 h-3.5 w-3.5 shrink-0 text-muted' />
                                        {l.people.length ? l.people.join(', ') : 'Nobody'}
                                    </p>
                                )}
                                {l.gap && <p className='mt-1 flex items-start gap-1.5 text-xs font-medium text-red-500'><AlertTriangle aria-hidden className='mt-0.5 h-3.5 w-3.5 shrink-0' />{l.gap}</p>}
                            </li>
                        ))}
                    </ol>
                    {w.changeReason && <p className='text-xs text-muted'>Last change{w.updatedAt ? ' ' + new Date(w.updatedAt).toLocaleDateString() : ''}: {w.changeReason}</p>}
                </section>
            ))}
            {data.canConfigure && (
                <Button variant='secondary' className='w-full sm:w-auto' onClick={() => navigate('organization_admin/workflows')}>
                    <Settings2 className='h-4 w-4' /> Configure levels and approvers
                </Button>
            )}
        </div>
    );
}
