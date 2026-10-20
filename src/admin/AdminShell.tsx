import { useEffect, useState } from 'react';
import { Activity, Ban, Boxes, Building2, Calculator, CircleUser, ClipboardCheck, Coins, CreditCard, FolderTree, Globe, Hash, Landmark, LayoutDashboard, ListChecks, LogOut, Menu, Package, Palette, Puzzle, ScrollText, Users, Wrench, X } from 'lucide-react';
import AssetDictionaryAdmin from './AssetDictionaryAdmin';
import ProcurementCatalogAdmin from './ProcurementCatalogAdmin';
import { callBackend } from '../lib/backend';
import BillingPage from './BillingPage';
import ExplorerPage from './ExplorerPage';
import { navigate } from '../lib/route';
import { useSite } from '../lib/site';
import { ROLE_LABELS, type Session } from '../types';
import SideNav, { type NavGroup } from '../components/SideNav';
import UserChip from '../components/UserChip';
import DefaultValuesPage from './DefaultValuesPage';
import Dashboard from './Dashboard';
import UsersPage from './UsersPage';
import TenantsPage from './TenantsPage';
import ApplicationsPage from './ApplicationsPage';
import ModulesPage from './ModulesPage';
import SiteSetupPage from './SiteSetupPage';
import ProfilePage from './ProfilePage';
import HealthPage from './HealthPage';
import LogsPage from './LogsPage';
import AppDeployPage from './AppDeployPage';
import SkillsMasterPage from './SkillsMasterPage';
import OperationsCenter from './OperationsCenter';
import FxMonitor from './FxMonitor';
import AutomationCenter from './AutomationCenter';
import TransactionManager from './TransactionManager';
import SecurityDocumentationAdmin from './SecurityDocumentationAdmin';

const DEFAULT_META_LISTS = [
    { key: 'meta.industryCategories', label: 'Industry categories' },
    { key: 'meta.industries', label: 'Industry subcategories' },
    { key: 'meta.companySizes', label: 'Company size' },
    { key: 'meta.legalEntityTypes', label: 'Legal entity type' },
    { key: 'meta.annualTurnover', label: 'Annual turnover (USD)' },
    { key: 'meta.fiscalYearStart', label: 'Financial year starts' },
    { key: 'meta.dateFormats', label: 'Date format' },
    { key: 'meta.userRoles', label: 'User role' },
    { key: 'meta.departments', label: 'Department' },
    { key: 'meta.titles', label: 'Title' },
    { key: 'meta.identityDocumentTypes', label: 'Identity document type' },
    { key: 'meta.languages', label: 'Preferred language' },
];

export default function AdminShell({
    session,
    route,
    onSignOut,
    onSessionChange,
}: {
    session: Session;
    route: string;
    onSignOut: () => void;
    onSessionChange: (session: Session) => void;
}) {
    const { config } = useSite();
    const [open, setOpen] = useState(false);
    const parts = route.split('/');
    const section = parts[0] === 'admin' ? (parts[1] ?? '') : '';
    const id = parts[2];
    const sub = parts[3];
    const role = session.role ?? '';
    const isSuper = role === 'super_admin';
    const canWrite = role === 'super_admin' || role === 'mems_admin';
    const [metaLists, setMetaLists] = useState<Array<{ key: string; label: string }>>(DEFAULT_META_LISTS);

    useEffect(() => {
        callBackend<{ entries?: Array<{ key: string; label: string }> }>('/api/admin/reference/status')
            .then((res) => {
                const meta = (res.entries ?? []).filter((e) => e.key.startsWith('meta.'));
                if (meta.length) setMetaLists(meta);
            })
            .catch(() => undefined);
    }, [route]);

    const groups: NavGroup[] = [
        { title: 'Overview', items: [{ key: '', label: 'Dashboard', Icon: LayoutDashboard }] },
        {
            title: 'Tenants',
            items: [
                { key: 'registrations', label: 'Registrations', Icon: ClipboardCheck },
                { key: 'tenants', label: 'Tenants', Icon: Building2 },
            ],
        },
        {
            title: 'Platform',
            items: [
                { key: 'modules', label: 'Modules', Icon: Puzzle },
                { key: 'transactions', label: 'Transactions Manager', Icon: ListChecks },
                { key: 'security_docs', label: 'Security documentation', Icon: ScrollText },
                { key: 'site', label: 'Site setup', Icon: Palette },
                { key: 'billing', label: 'Billing and payments', Icon: CreditCard },
                ...(isSuper ? [
                    { key: 'operations', label: 'GitHub & Cloud Run', Icon: Activity },
                    { key: 'automation_center', label: 'Automation Center', Icon: Activity },
                    { key: 'fx_monitor', label: 'FX automation and rates', Icon: Coins },
                    { key: 'firestore', label: 'Database explorer', Icon: FolderTree },
                    { key: 'appdeploy', label: 'Hosting migration', Icon: Activity },
                ] : []),
            ],
        },
        {
            title: 'Module lists',
            items: [
                { key: 'asset_catalog', label: 'Asset catalog (PRC)', Icon: Boxes },
                { key: 'material_catalog', label: 'Material catalog (PRC)', Icon: Package },
                { key: 'service_catalog', label: 'Service catalog (PRC)', Icon: Wrench },
                { key: 'gl_accounts', label: 'GL account master (FIN)', Icon: Calculator },
                { key: 'hr_skills', label: 'Skills master (HR)', Icon: ListChecks },
            ],
        },
        {
            title: 'Default values',
            items: [
                { key: 'defaults/countries', label: 'Countries', Icon: Globe },
                { key: 'defaults/currencies', label: 'Currencies', Icon: Coins },
                { key: 'defaults/publicEmailDomains', label: 'Blocked email domains', Icon: Ban },
                { key: 'defaults/banks', label: 'African banks', Icon: Landmark },
                ...metaLists.map((m) => ({ key: `defaults/${m.key}`, label: m.label, Icon: ListChecks })),
                { key: 'defaults/sequences', label: 'Code sequences', Icon: Hash },
            ],
        },
        {
            title: 'People and security',
            items: [
                { key: 'users', label: 'MEMS users', Icon: Users },
                { key: 'logs', label: 'Audit trail', Icon: ScrollText },
                { key: 'health', label: 'System health', Icon: Activity },
            ],
        },
        { title: 'Me', items: [{ key: 'profile', label: 'Personal details', Icon: CircleUser }] },
    ];
    const allItems = groups.flatMap((g) => g.items);

    useEffect(() => {
        setOpen(false);
        window.scrollTo(0, 0);
    }, [route]);

    const go = (key: string) => navigate(key ? `admin/${key}` : 'admin');
    const activeKey = section === 'defaults' ? `defaults/${id || 'countries'}` : section;

    const nav = (
        <nav className='flex h-full flex-col'>
            <div className='border-b border-slate-800 px-4 pb-4 pt-5'>
                <p className='mb-3 text-lg font-semibold tracking-wide text-white'>{config.brandName} Admin</p>
                <UserChip session={session} roleLabel={ROLE_LABELS[role] ?? role} onClick={() => go('profile')} />
            </div>
            <SideNav groups={groups} active={activeKey} onSelect={go} collapsible />
            <div className='border-t border-slate-800 p-2'>
                <button onClick={onSignOut} className='flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-slate-300 active:bg-slate-800'>
                    <LogOut className='h-[18px] w-[18px]' />
                    Log out
                </button>
            </div>
        </nav>
    );

    let content;
    switch (section) {
        case 'users':
            content = <UsersPage id={id} myUid={session.user.uid} isSuper={isSuper} />;
            break;
        case 'tenants':
            content = <TenantsPage id={id} tab={sub} canWrite={canWrite} isSuper={isSuper} />;
            break;
        case 'registrations':
            content = <ApplicationsPage id={id} isSuper={isSuper} />;
            break;
        case 'firestore':
            content = isSuper ? <ExplorerPage /> : <Dashboard />;
            break;
        case 'appdeploy':
            content = isSuper ? <AppDeployPage /> : <Dashboard />;
            break;
        case 'operations':
            content = isSuper ? <OperationsCenter /> : <Dashboard />;
            break;
        case 'fx_monitor':
            content = isSuper ? <FxMonitor /> : <Dashboard />;
            break;
        case 'automation_center':
            content = isSuper ? <AutomationCenter /> : <Dashboard />;
            break;
        case 'transactions':
            content = <TransactionManager />;
            break;
        case 'security_docs':
            content = <SecurityDocumentationAdmin />;
            break;
        case 'modules':
            content = <ModulesPage code={id} tab={sub} canWrite={canWrite} isSuper={isSuper} />;
            break;
        case 'asset_catalog':
            content = <ModulesPage code='PRC' tab='dictionary' canWrite={canWrite} isSuper={isSuper} />;
            break;
        case 'material_catalog':
            content = <ProcurementCatalogAdmin key='materials' kind='materials' canWrite={canWrite} />;
            break;
        case 'service_catalog':
            content = <ProcurementCatalogAdmin key='services' kind='services' canWrite={canWrite} />;
            break;
        case 'gl_accounts':
            content = <ProcurementCatalogAdmin key='gl_accounts' kind='gl_accounts' canWrite={canWrite} />;
            break;
        case 'hr_skills':
            content = <SkillsMasterPage isSuper={isSuper} />;
            break;
        case 'site':
            content = <SiteSetupPage canWrite={canWrite} />;
            break;
        case 'profile':
            content = <ProfilePage session={session} onUpdated={onSessionChange} />;
            break;
        case 'health':
            content = <HealthPage />;
            break;
        case 'billing':
            content = <BillingPage isSuper={isSuper} />;
            break;
        case 'logs':
            content = <LogsPage />;
            break;
        case 'defaults':
            content = <DefaultValuesPage listKey={id && /^(countries|currencies|publicEmailDomains|banks|sequences|meta\.[A-Za-z][A-Za-z0-9_]{0,40})$/.test(id) ? id : 'countries'} canWrite={canWrite} isSuper={isSuper} />;
            break;
        default:
            content = <Dashboard />;
    }

    const current = allItems.find((m) => m.key === activeKey) ?? allItems[0];

    return (
        <div className='mems-shell-admin min-h-dvh bg-slate-950'>
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
                <header className='sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-4 backdrop-blur lg:justify-end'>
                    <button aria-label='Open menu' onClick={() => setOpen(true)} className='flex h-11 w-11 items-center justify-center rounded-lg text-slate-200 lg:hidden'>
                        <Menu className='h-6 w-6' />
                    </button>
                    <span className='min-w-0 flex-1 truncate font-semibold text-white lg:hidden'>{current.label}</span>
                    <div className='lg:hidden'><UserChip session={session} compact onClick={() => go('profile')} /></div>
                    <button type='button' onClick={onSignOut} aria-label='Log out' title='Log out' className='hidden lg:flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-3 text-sm font-medium text-slate-200 hover:bg-slate-800'><LogOut className='h-4 w-4' aria-hidden='true'/> Log out</button>
                </header>
                <main className='mx-auto w-full max-w-4xl px-4 py-6 lg:px-8 lg:py-8'>{content}</main>
            </div>
        </div>
    );
}
