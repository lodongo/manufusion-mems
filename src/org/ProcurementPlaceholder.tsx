import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { Badge } from '../admin/kit';
import { Screen } from '../components/screen';

// Placeholder screens for procurement submodules whose functions are not built yet. Their security roles and chart of
// authority rules are already configured, so access can be planned and assigned before the screens ship.

interface Info {
    name: string;
    summary: string;
    roles: Array<{ name: string; permission: string; does: string }>;
    authority: string;
}

const INFO: Record<string, Info> = {
    procurement_vendors: {
        name: 'Vendors',
        summary: 'Vendor register, onboarding approval, status and performance.',
        roles: [
            { name: 'Vendor Clerk', permission: 'PRC.vendors.manage', does: 'Creates and maintains vendors.' },
            { name: 'Vendor Approver', permission: 'PRC.vendors.approve', does: 'Approves new and changed vendors. Cannot create or edit them.' },
        ],
        authority: 'A vendor is approved by someone other than the person who created it. Holding both create and approve is flagged as a conflict.',
    },
    procurement_quotations: {
        name: 'Quotations',
        summary: 'Quotation capture against acknowledged requirements, and comparison.',
        roles: [{ name: 'Quotations Officer', permission: 'PRC.quotes.manage', does: 'Records and compares quotations.' }],
        authority: 'Prices appear here for the first time, so value limits are defined in the chart of authority before this goes live.',
    },
    procurement_requisitions: {
        name: 'Purchase requisitions',
        summary: 'Converts an acknowledged requirement into a priced requisition for approval.',
        roles: [
            { name: 'Requisition Officer', permission: 'PRC.prq.manage', does: 'Prepares requisitions from requirements and quotations.' },
            { name: 'Requisition Approver', permission: 'PRC.prq.approve', does: 'Approves requisitions within a value limit. Cannot prepare them.' },
        ],
        authority: 'Approval follows a value ladder that is defined before go-live. The person who approves a requisition does not approve the resulting order.',
    },
    procurement_orders: {
        name: 'Purchase orders',
        summary: 'Issues approved requisitions to vendors as orders.',
        roles: [
            { name: 'Purchase Order Officer', permission: 'PRC.po.manage', does: 'Prepares and issues orders.' },
            { name: 'Purchase Order Approver', permission: 'PRC.po.approve', does: 'Approves orders within a value limit. Cannot prepare them.' },
        ],
        authority: 'Approval follows a value ladder that is defined before go-live, separate from the requisition ladder.',
    },
};

export default function ProcurementPlaceholder({ section }: { section: string }) {
    const info = INFO[section];
    if (!info) return <Alert tone='error'>This workspace is not available.</Alert>;
    return (
        <Screen title={info.name} subtitle='Placeholder: roles are ready, functions are not built yet' onBack={() => navigate('organization_home')}>
            <Alert tone='info'>{info.summary} The screens and actions for this submodule are not available yet. Its security roles and chart of authority rules are already configured so you can plan access.</Alert>
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-4'>
                <h2 className='text-sm font-semibold text-ink'>Security roles ready to assign</h2>
                <ul className='divide-y divide-line'>
                    {info.roles.map((r) => (
                        <li key={r.permission} className='space-y-1 py-2 text-sm'>
                            <p className='font-medium text-ink'>{r.name} <Badge tone='muted'>Placeholder</Badge></p>
                            <p className='text-xs text-muted'>{r.does}</p>
                            <p className='font-mono text-xs text-soft'>{r.permission}</p>
                        </li>
                    ))}
                </ul>
            </section>
            <section className='space-y-1 rounded-2xl border border-line bg-panel p-4'>
                <h2 className='text-sm font-semibold text-ink'>Chart of authority</h2>
                <p className='text-sm text-soft'>{info.authority}</p>
            </section>
        </Screen>
    );
}
