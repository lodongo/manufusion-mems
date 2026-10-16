import { Card, PageTitle } from '../admin/kit';

const PLANS: Record<string, { title: string; summary: string; model: Array<[string, string]>; rules: string[] }> = {
    delegations: {
        title: 'Delegation',
        summary: 'Temporarily hand some or all of your rights to a colleague, for example while on leave. Actions taken record "on behalf of".',
        model: [
            ['Delegator', 'The user giving the rights'],
            ['Delegate', 'The user receiving the rights (same organization)'],
            ['Scope', 'Whole role, selected permissions, or selected approval steps'],
            ['Period', 'Start and end date; expires automatically'],
            ['Limit', 'Optional amount ceiling in base currency'],
            ['Reason and approval', 'Reason is required; delegation itself can require approval'],
        ],
        rules: [
            'A delegate never gets more rights than the delegator holds.',
            'Delegated rights add to, never replace, the delegate\'s own role.',
            'Every approval made under delegation is audited with both names.',
        ],
    },
    workflows: {
        title: 'Workflows & approvals',
        summary: 'Define how documents move from draft to approved, per module and document type.',
        model: [
            ['Document type', 'e.g. purchase requisition (PRC), payment voucher (FIN), journal (FIN)'],
            ['Trigger', 'Submit, amount threshold, or field change'],
            ['Steps', 'Sequential or parallel; any-one or all-must-approve'],
            ['Approver', 'By role, named user, department head, or chart of authority'],
            ['SLA and escalation', 'Hours before reminder and escalation to the next level'],
            ['Outcomes', 'Approve, reject, return for changes, with mandatory comment on reject'],
        ],
        rules: [
            'A user can never approve a document they created (segregation of duties).',
            'Approval requests are stored per organization with full history.',
            'Every approval, rejection and escalation is audited.',
        ],
    },
    authority: {
        title: 'Chart of authority',
        summary: 'A matrix of who may approve what, and up to which amount, in the organization\'s base currency.',
        model: [
            ['Document type', 'Linked to a workflow'],
            ['Amount band', 'From and to, in base currency with USD equivalent'],
            ['Approver level', 'Role or position for each band (e.g. Supervisor, Manager, Director)'],
            ['Number of approvers', 'Single or dual sign-off per band'],
            ['Effective dates', 'Versioned so history is preserved'],
        ],
        rules: [
            'Workflows look up the chart of authority to choose approvers automatically.',
            'Changes to the chart itself require super admin approval and are audited.',
        ],
    },
};

export default function PlannedPage({ kind }: { kind: 'delegations' | 'workflows' | 'authority' }) {
    const plan = PLANS[kind];
    return (
        <div className='space-y-4'>
            <PageTitle title={plan.title} subtitle='Planned · structure reserved, awaiting final rules' />
            <Card>
                <p className='text-sm text-slate-300'>{plan.summary}</p>
            </Card>
            <Card>
                <h2 className='mb-2 font-semibold text-white'>What each record will hold</h2>
                {plan.model.map(([field, desc]) => (
                    <div key={field} className='border-b border-slate-800 py-2 last:border-0'>
                        <p className='text-sm font-medium text-white'>{field}</p>
                        <p className='text-xs text-slate-400'>{desc}</p>
                    </div>
                ))}
            </Card>
            <Card>
                <h2 className='mb-2 font-semibold text-white'>Rules</h2>
                <ul className='list-disc space-y-1 pl-5 text-sm text-slate-300'>
                    {plan.rules.map((r) => (
                        <li key={r}>{r}</li>
                    ))}
                </ul>
            </Card>
        </div>
    );
}
