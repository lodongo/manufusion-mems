import { useEffect, useState } from 'react';
import { HeartPulse, BookOpen, Boxes, Briefcase, Calculator, ClipboardList, CircleUser, ClipboardCheck, CreditCard, Eye, GitBranch, History, Home, Layers, LayoutDashboard, Landmark, LogOut, Menu, Network, Package, PackageCheck, PackagePlus, Palette, Puzzle, ScrollText, Settings, ShieldCheck, Table2, Users, Workflow, Wrench, X } from 'lucide-react';
import AssetRegister from './AssetRegister';
import MaterialWorkflow from './MaterialWorkflow';
import TransactionGovernance from './TransactionGovernance';
import TransactionBlueprints from './TransactionBlueprints';
import WorkflowInbox from './WorkflowInbox';
import ProcurementCatalog from './ProcurementCatalog';
import WorkRequests from './WorkRequests';
import WorkOrders from './WorkOrders';
import MntHome from './MntHome';
import MntWindows from './MntWindows';
import SafConfiguration from './SafConfiguration';
import OrgModules from './OrgModules';
import OrgSubscription from './OrgSubscription';
import UserChip from '../components/UserChip';
import SideNav, { type NavGroup, type NavItem } from '../components/SideNav';
import StructurePage from './StructurePage';
import CorporateGovernancePage from './CorporateGovernancePage';
import CorporateFinancialControlsPage from './CorporateFinancialControlsPage';
import PositionsPage from './PositionsPage';
import OdChart from './OdChart';
import OrgSettings from './OrgSettings';
import HrEducationAdmin from './HrEducationAdmin';
import MyActivity from './MyActivity';
import OrgBrandMark from '../components/OrgBrandMark';
import OrgBranding from './OrgBranding';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { ROLE_LABELS, hasPerm, type Session } from '../types';
import { Alert } from '../components/ui';
import { Spinner, useLoad } from '../admin/kit';
import ProfilePage from '../admin/ProfilePage';
import UserSetup from './UserSetup';
import UserHealth from './UserHealth';
import OrgOverview from './OrgOverview';
import SetupGuide, { type SetupProgress } from './SetupGuide';
import OrgUsers from './OrgUsers';
import OrgRoles from './OrgRoles';
import SecurityKnowledgeBase from './SecurityKnowledgeBase';
import OrgAudit from './OrgAudit';
import PlannedPage from './PlannedPage';
import type { OrgContextData } from './types';

type MenuItem = NavItem & { perm?: string; module?: string };

const MENU: Array<{ title: string; items: MenuItem[] }> = [

    {
        title: 'Overview',
        items: [{ key: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard }],
    },
    {
        title: 'Organization design',
        items: [
            { key: 'structure', label: 'Design', Icon: Layers, perm: 'ADM.structure' },
            { key: 'corporate_governance', label: 'Corporate Office & Governance', Icon: Landmark, perm: 'ADM.structure' },
        ],
    },
    {
        title: 'Job roles (ROL_)',
        items: [
            { key: 'positions', label: 'Design', Icon: Briefcase, perm: 'ADM.structure' },
        ],
    },
    {
        title: 'Assets (AST)',
        items: [
            { key: 'assets', label: 'Asset register', Icon: Boxes, perm: 'AST.view', module: 'AST' },
            { key: 'asset_approvals', label: 'Awaiting approval', Icon: ClipboardCheck, perm: 'AST.approve', module: 'AST' },
            { key: 'asset_dictionary', label: 'Asset catalog', Icon: BookOpen, perm: 'AST.view', module: 'AST' },
        ],
    },
    {
        title: 'Safety (SAF)',
        items: [{ key: 'saf_configuration', label: 'Risk matrix configuration', Icon: ShieldCheck, perm: 'SAF.', module: 'SAF' }],
    },
    {
        title: 'Maintenance (MNT)',
        items: [
            { key: 'mnt', label: 'Maintenance workspace', Icon: Wrench, perm: 'MNT.', module: 'MNT' },
            { key: 'work_requests', label: 'Work requests', Icon: Wrench, perm: 'MNT.', module: 'MNT' },
            { key: 'work_orders', label: 'Work orders', Icon: ClipboardList, perm: 'MNT.', module: 'MNT' },
            { key: 'maintenance_windows', label: 'Maintenance windows', Icon: ClipboardList, perm: 'MNT.', module: 'MNT' },
        ],
    },
    {
        title: 'Procurement (PRC)',
        items: [
            { key: 'material_catalog', label: 'Material catalog', Icon: Package, perm: 'PRC.view', module: 'PRC' },
            { key: 'service_catalog', label: 'Service catalog', Icon: Wrench, perm: 'PRC.view', module: 'PRC' },
        ],
    },
    {
        title: 'Finance (FIN)',
        items: [
            { key: 'gl_accounts', label: 'GL account master', Icon: Calculator, perm: 'FIN.view', module: 'FIN' },
            { key: 'corporate_finance', label: 'Corporate budgets & allocation', Icon: Landmark, perm: 'FIN.', module: 'FIN' },
        ],
    },
    {
        title: 'HR administration',
        items: [{ key: 'hr_education_config', label: 'Education hierarchy & job grades', Icon: BookOpen, perm: 'ADM.settings' }],
    },
    {
        title: 'People and access',
        items: [
            { key: 'users', label: 'Users', Icon: Users, perm: 'ADM.users' },
            { key: 'roles', label: 'Security roles', Icon: ShieldCheck, perm: 'ADM.roles' },
            { key: 'security_docs', label: 'Documentation', Icon: BookOpen },
        ],
    },
    {
        title: 'Modules and subscription',
        items: [
            { key: 'modules', label: 'All modules', Icon: Puzzle, perm: 'ADM.modules' },
            { key: 'modules_available', label: 'Not adopted', Icon: PackagePlus, perm: 'ADM.modules' },
            { key: 'modules_adopted', label: 'Adopted', Icon: PackageCheck, perm: 'ADM.modules' },
            { key: 'subscription', label: 'Subscription', Icon: CreditCard, perm: 'ADM.billing' },
        ],
    },
    {
        title: 'Governance',
        items: [
            { key: 'delegations', label: 'Delegation', Icon: Network, perm: 'ADM.delegations' },
            { key: 'transaction_governance', label: 'Transaction governance', Icon: ShieldCheck, perm: 'ADM.workflows' },
            { key: 'transaction_catalogue', label: 'Transaction access', Icon: Table2, perm: 'ADM.roles' },
            { key: 'workflows', label: 'Workflow configuration', Icon: GitBranch, perm: 'ADM.workflows' },
            { key: 'authority', label: 'Chart of authority', Icon: Table2, perm: 'ADM.authority' },
            { key: 'audit', label: 'Audit trail', Icon: ScrollText, perm: 'ADM.audit' },
        ],
    },
    {
        title: 'Setup',
        items: [
            { key: 'branding', label: 'Branding', Icon: Palette, perm: 'ADM.settings' },
            { key: 'settings', label: 'Settings', Icon: Settings, perm: 'ADM.settings' },
        ],
    },
    {
        title: 'Me',
        items: [
            { key: 'profile', label: 'My details', Icon: CircleUser },
            { key: 'my_setup', label: 'My setup', Icon: Settings },
            { key: 'my_tables', label: 'My Tables', Icon: Table2 },
            { key: 'keep_alive', label: '↳ Keep Alive', Icon: HeartPulse },
            { key: 'activity', label: 'My activity', Icon: History },
        ],
    },
];

const TITLES: Record<string, string> = {
    dashboard: 'Organization dashboard',
    my_setup: 'My setup',
    my_tables: 'My Tables',
    keep_alive: 'Keep Alive',
    structure: 'Organization design',
    corporate_governance: 'Corporate Office & Governance',
    structure_view: 'Organization structure',
    positions: 'Job roles',
    positions_view: 'Job role structure',
    roles: 'Security roles',
    hr_education_config: 'Education hierarchy & job grades',
    transaction_governance: 'Transaction governance',
    transaction_catalogue: 'Transaction access',
    modules: 'All modules',
    modules_available: 'Modules not adopted',
    modules_adopted: 'Adopted modules',
    assets: 'Asset register',
    asset_approvals: 'Assets awaiting approval',
    asset_dictionary: 'Asset catalog',
    material_catalog: 'Material catalog',
    service_catalog: 'Service catalog',
    gl_accounts: 'GL account master',
    work_requests: 'Work requests',
    work_orders: 'Work orders',
};

function RedirectMyTables() {
    useEffect(() => { navigate('organization_home/my_tables'); }, []);
    return <Spinner />;
}

export default function OrgShell({ session, route, onSignOut, onSessionChange }: { session: Session; route: string; onSignOut: () => void; onSessionChange: (s: Session) => void }) {
    const { data, error, loading } = useLoad(() => callBackend<OrgContextData>('/api/org/context'));
    const setup = useLoad(() => callBackend<SetupProgress>('/api/org/setup/progress'), [session.organization?.id]);
    const [open, setOpen] = useState(false);
    const parts = route.split('/');
    const section = parts[0] === 'organization_admin' ? (parts[1] ?? '') : '';
    const id = parts[2];

    useEffect(() => {
        setOpen(false);
        window.scrollTo(0, 0);
    }, [route]);
    const lastKey = 'mems.lastDesign.' + (session.organization?.id || 'unknown') + '.' + session.user.uid;
    useEffect(() => {
        const selected = route.startsWith('organization_admin/') ? route.slice('organization_admin/'.length) : '';
        if (selected.startsWith('structure') || selected.startsWith('positions')) {
            try { localStorage.setItem(lastKey, route); } catch { /* navigation still works */ }
        }
    }, [route, lastKey]);
    useEffect(() => {
        if (section || setup.loading || !setup.data) return;
        let last = '';
        try { last = localStorage.getItem(lastKey) ?? ''; } catch { /* optional */ }
        navigate(last.startsWith('organization_admin/structure') || last.startsWith('organization_admin/positions') ? last : setup.data.nextRoute);
    }, [section, setup.loading, setup.data, lastKey]);


    if (loading && !data) return <Spinner />;
    if (error || !data) return <div className='p-6'><Alert tone='error'>{error || 'Could not load your organization.'}</Alert></div>;

    const enabledCodes = new Set(data.modules.map((m) => m.code));
    const basicsOnly = setup.data?.ready === false;
    const allowedSetup = new Set(['structure', 'positions', 'profile', 'my_setup', 'keep_alive', 'activity', 'security_docs']);
    const groups: NavGroup[] = MENU.map((g) => ({ title: g.title, items: g.items.filter((m) => (!basicsOnly || allowedSetup.has(m.key)) && (!m.perm || (m.perm.endsWith('.') ? data.permissions.some((p) => p === '*' || p.startsWith(m.perm as string)) : hasPerm(data.permissions, m.perm))) && (!m.module || enabledCodes.has(m.module))) }));
    const items = groups.flatMap((g) => g.items);
    const active = items.some((m) => m.key === section) ? section : '';
    const canDesign = hasPerm(data.permissions, 'ADM.structure');

    let content;
    switch (active) {
        case 'dashboard':
            content = <OrgOverview ctx={data} hasBranding={!!session.organization?.branding?.preset && !!session.organization?.branding?.displayName} />;
            break;
        case 'users':
            content = <OrgUsers id={id} myUid={session.user.uid} myRole={data.role} canRoles={hasPerm(data.permissions, 'ADM.roles')} />;
            break;
        case 'modules':
            content = <OrgModules key='all' view='all' />;
            break;
        case 'modules_available':
            content = <OrgModules key='available' view='available' />;
            break;
        case 'modules_adopted':
            content = <OrgModules key='adopted' view='adopted' />;
            break;
        case 'subscription':
            content = <OrgSubscription />;
            break;
        case 'assets':
            content = <AssetRegister view='register' id={id} />;
            break;
        case 'asset_approvals':
            content = <AssetRegister view='approvals' id={id} />;
            break;
        case 'asset_dictionary':
            content = <AssetRegister view='dictionary' />;
            break;
        case 'material_catalog':
            content = <ProcurementCatalog key='materials' kind='materials' />;
            break;
        case 'service_catalog':
            content = <ProcurementCatalog key='services' kind='services' />;
            break;
        case 'gl_accounts':
            content = <ProcurementCatalog key='gl_accounts' kind='gl_accounts' />;
            break;
        case 'saf_configuration':
            content = <SafConfiguration />;
            break;
        case 'maintenance_windows':
            content = <MntWindows />;
            break;
        case 'mnt':
            content = <MntHome />;
            break;
        case 'work_requests':
            content = <WorkRequests id={id} sub={parts[3]} />;
            break;
        case 'work_orders':
            content = <WorkOrders id={id} sub={parts[3]} />;
            break;
        case 'positions':
            content = <PositionsPage canEdit={canDesign} code={id} />;
            break;
        case 'positions_view':
            content = <OdChart show='roles' />;
            break;
        case 'roles':
            content = <OrgRoles id={id} />;
            break;
        case 'security_docs':
            content = <SecurityKnowledgeBase canInspect={hasPerm(data.permissions, 'ADM.roles')} />;
            break;

        case 'transaction_catalogue':
            content = <TransactionBlueprints />;
            break;
        case 'transaction_governance':
            content = <TransactionGovernance canRoles={hasPerm(data.permissions, 'ADM.roles')} canWorkflow={hasPerm(data.permissions, 'ADM.workflows')} />;
            break;
        case 'workflows':
            content = <MaterialWorkflow />;
            break;
        case 'delegations':
        case 'authority':
            content = <PlannedPage kind={active} />;
            break;
        case 'audit':
            content = <OrgAudit />;
            break;
        case 'corporate_governance':
            content = <CorporateGovernancePage canEdit={canDesign}/>;
            break;
        case 'corporate_finance':
            content = <CorporateFinancialControlsPage canEdit={hasPerm(data.permissions,'FIN.setup.manage') || hasPerm(data.permissions,'FIN.cc.manage')}/>;
            break;
        case 'structure':
            content = <StructurePage nodeId={id} sub={parts[3]} canEdit={canDesign} />;
            break;
        case 'structure_view':
            content = <OdChart show='structure' />;
            break;
        case 'hr_education_config':
            content = <HrEducationAdmin />;
            break;
        case 'settings':
            content = <OrgSettings />;
            break;
        case 'activity':
            content = <MyActivity />;
            break;
        case 'branding':
            content = <OrgBranding onSaved={(branding) => session.organization && onSessionChange({ ...session, organization: { ...session.organization, branding } })} />;
            break;
        case 'profile':
            content = <ProfilePage session={session} onUpdated={onSessionChange} />;
            break;
        case 'my_setup':
            content = <UserSetup session={session} onUpdated={onSessionChange} />;
            break;
        case 'my_tables':
            content = <RedirectMyTables />;
            break;
        case 'keep_alive':
            content = <UserHealth uid={session.user.uid} />;
            break;
        default:
            content = <OrgOverview ctx={data} hasBranding={!!session.organization?.branding?.preset && !!session.organization?.branding?.displayName} />;
    }

    if (basicsOnly && section && !allowedSetup.has(section)) {
        content = <SetupGuide progress={setup.data!} />;
    }
    const go = (key: string) => navigate(key ? `organization_admin/${key}` : 'organization_admin');

    const nav = (
        <nav className='flex h-full flex-col'>
            <div className='space-y-3 border-b border-slate-800 px-4 pb-4 pt-5'>
                <OrgBrandMark branding={session.organization?.branding} fallbackName={data.organization.name} />
                <UserChip session={session} roleLabel={data.roleName || ROLE_LABELS[data.role]} onClick={() => go('profile')} />
            </div>
            <SideNav groups={groups} active={active} onSelect={go} />
            <div className='space-y-0.5 border-t border-slate-800 p-2'>
                <button onClick={() => navigate('organization_home')} className='flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-slate-300 active:bg-slate-800'>
                    <Home className='h-[18px] w-[18px]' />
                    Organization home
                </button>
                <button onClick={onSignOut} className='flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-slate-300 active:bg-slate-800'>
                    <LogOut className='h-[18px] w-[18px]' />
                    Log out
                </button>
            </div>
        </nav>
    );

    const current = items.find((m) => m.key === active) ?? items[0];
    const headerTitle = TITLES[active] ?? current?.label;

    return (
        <div className='mems-shell-org min-h-dvh bg-slate-950'>
            <aside className='fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-800 bg-slate-900 lg:block'>{nav}</aside>
            {open && (
                <div className='fixed inset-0 z-40 lg:hidden'>
                    <button aria-label='Close menu' className='absolute inset-0 bg-black/60' onClick={() => setOpen(false)} />
                    <aside className='absolute inset-y-0 left-0 w-72 max-w-[85%] border-r border-slate-800 bg-slate-900'>
                        <button aria-label='Close menu' onClick={() => setOpen(false)} className='absolute right-3 top-4 z-10 flex h-11 w-11 items-center justify-center text-slate-400'>
                            <X className='h-5 w-5' />
                        </button>
                        {nav}
                    </aside>
                </div>
            )}
            <div className='lg:pl-64'>
                <header className='sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-4 backdrop-blur lg:hidden'>
                    <button aria-label='Open menu' onClick={() => setOpen(true)} className='flex h-11 w-11 items-center justify-center rounded-lg text-slate-200'>
                        <Menu className='h-6 w-6' />
                    </button>
                    <span className='min-w-0 flex-1 truncate font-semibold text-white'>{headerTitle}</span>
                    <UserChip session={session} compact onClick={() => go('profile')} />
                </header>
                <main className='w-full min-w-0 max-w-none px-4 py-6 lg:px-6 xl:px-8 lg:py-8'>

                    {content}
                </main>
            </div>
        </div>
    );
}

