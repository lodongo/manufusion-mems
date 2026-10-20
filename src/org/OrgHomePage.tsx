import { useEffect, useState, type ReactNode } from 'react';
import {
    Activity, ArrowLeft, BookOpen, Boxes, Calculator, ChevronDown, ChevronRight,
    CircleUser, ClipboardCheck, ClipboardList, Home, Layers, LogOut, Menu,
    Package, Search, Settings, ShieldCheck, Wrench, X, Star, Clock3, HeartPulse, Table2, Mail
} from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { hasPerm, type Session } from '../types';
import { firebaseAuth } from '../firebase';
import { Alert } from '../components/ui';
import { Card, Empty, Spinner, useLoad } from '../admin/kit';
import ProfilePage from '../admin/ProfilePage';
import UserSetup from './UserSetup';
import UserHealth from './UserHealth';
import MyTables from './MyTables';
import QuickWorkspace from './QuickWorkspace';
import OrgBrandMark from '../components/OrgBrandMark';
import UserChip from '../components/UserChip';
import MyActivity from './MyActivity';
import WorkRequests from './WorkRequests';
import WorkOrders from './WorkOrders';
import MntHome from './MntHome';
import MntWindows from './MntWindows';
import MntMaterialCandidates from './MntMaterialCandidates';
import MntWorkflowSettings from './MntWorkflowSettings';
import MntTaskValidation from './MntTaskValidation';
import SafConfiguration from './SafConfiguration';
import AssetRegister from './AssetRegister';
import ProcurementCatalog from './ProcurementCatalog';
import MaterialsMaster from './MaterialsMaster';
import InventoryOnHand from './InventoryOnHand';
import InventoryDashboard from './InventoryDashboard';
import InventoryOperations from './InventoryOperations';
import StockTake from './StockTake';
import WorkflowInbox from './WorkflowInbox';
import MyAccess from './MyAccess';
import OrgUserHome from './OrgUserHome';
import OrgMail from './OrgMail';
import PurchaseRequirements from './PurchaseRequirements';
import ProcurementSetup from './ProcurementSetup';
import PurchaseOrders from './PurchaseOrders';
import ProcurementDashboard from './ProcurementDashboard';
import Journals from './Journals';
import FinGl from './FinGl';
import FinTransactionWorkspace from './FinTransactionWorkspace';
import FinCostCenters from './FinCostCenters';
import FinJournal from './FinJournal';
import FinCalendar from './FinCalendar';
import FinTaxes from './FinTaxes';
import FinSetup from './FinSetup';
import FinApprovals from './FinApprovals';
import GoodsIssue from './GoodsIssue';
import ReplenishmentRequests from './ReplenishmentRequests';
import { FinEntityMenu, NotBuilt, OPEN_MENU_EVENT } from './finKit';
import Vendors from './Vendors';
import Quotations from './Quotations';
import BuyerGroups from './BuyerGroups';
import WarehouseOverview from './WarehouseOverview';
import DocumentRegistryPage from './DocumentRegistryPage';
import type { OrgContextData } from './types';

type Module = OrgContextData['modules'][number];
type LinkItem = { label: string; path: string; permission?: string; prefix?: string; everyone?: boolean };
type ModuleMenu = { module: Module; links: LinkItem[]; capabilities: LinkItem[] };

const ROUTE = 'organization_home';
const toHome = (path = '') => navigate(path ? `${ROUTE}/${path}` : ROUTE);

const MODULE_LINKS: Record<string, LinkItem[]> = {
    DOC: [
        {label:'Document register',path:'doc_register',permission:'ADM.document_registry'},
        {label:'Engineering & equipment library',path:'doc_engineering',permission:'ADM.document_registry'},
        {label:'SHEQ SDS / MSDS',path:'doc_sds',permission:'ADM.document_registry'},
        {label:'Digital RCA & investigations',path:'doc_rca',permission:'ADM.document_registry'},
        {label:'Document review & approvals',path:'doc_review',permission:'ADM.document_review'},
        {label:'Knowledge & troubleshooting',path:'doc_knowledge',permission:'ADM.document_registry'},
        {label:'Digital forms & records',path:'doc_forms',permission:'ADM.document_registry'},
    ],
    SAF: [{ label: 'Configuration', path: 'saf_configuration', prefix: 'SAF.' }],
    MNT: [
        { label: 'Maintenance workspace', path: 'mnt', prefix: 'MNT.' },
        { label: 'Work requests', path: 'work_requests', prefix: 'MNT.WR.' },
        { label: 'Work orders', path: 'work_orders', prefix: 'MNT.WO.' },
        { label: 'Maintenance windows', path: 'maintenance_windows', prefix: 'MNT.' },
        { label: 'Workflows and approval roles', path: 'mnt_workflows', permission: 'ADM.workflows' },
        { label: 'Validate new asset tasks', path: 'mnt_task_validation', permission: 'MNT.activities.edit' },
    ],
    AST: [
        { label: 'Asset register', path: 'assets', permission: 'AST.view' },
        { label: 'Awaiting approval', path: 'asset_approvals', permission: 'AST.approve' },
        { label: 'Asset catalog', path: 'asset_dictionary', permission: 'AST.view' },
    ],
    PRC: [
        { label: 'Purchase requirements', path: 'purchase_requirements', everyone: true },
        { label: 'Materials Master', path: 'material_catalog', permission: 'PRC.view' },
        { label: 'Maintenance material candidates', path: 'mnt_material_candidates', permission: 'PRC.materials.manage' },
        { label: 'Service catalog', path: 'service_catalog', permission: 'PRC.view' },
        { label: 'Asset catalog', path: 'asset_dictionary', permission: 'AST.catalog.view' },
        { label: 'Vendors', path: 'procurement_vendors', permission: 'PRC.vendors.view' },
        { label: 'Quotations', path: 'procurement_quotations', permission: 'PRC.quotes.view' },
        { label: 'Purchase requisitions', path: 'procurement_requisitions', everyone: true },
        { label: 'Purchase orders', path: 'procurement_orders', everyone: true },
        { label: 'Procurement dashboard', path: 'procurement_dashboard', everyone: true },
        { label: 'Journals', path: 'fin_journal', everyone: true },
        { label: 'Buyer groups', path: 'procurement_buyers', permission: 'PRC.buyers.manage' },
        { label: 'Warehouses', path: 'warehouse_overview', everyone: true },
        { label: 'Setup', path: 'procurement_setup', permission: 'PRC.setup.view' },
    ],
    INV: [{ label: 'Goods issue', path: 'goods_issue', permission: 'INV.issue' }, { label: 'Replenishment', path: 'replenishment', permission: 'INV.replenishment.view' }],
    FIN: [
        { label: 'GL Accounts', path: 'fin_gl', prefix: 'FIN.' },
        { label: 'Cost Centers', path: 'fin_cc', prefix: 'FIN.' },
        { label: 'Journal', path: 'fin_journal', everyone: true },
        { label: 'Financial Calendar', path: 'fin_calendar', prefix: 'FIN.' },
        { label: 'Budgeting', path: 'fin_budget', prefix: 'FIN.' },
        { label: 'Taxes', path: 'fin_tax', prefix: 'FIN.' },
        { label: 'Reports', path: 'fin_reports', prefix: 'FIN.' },
        { label: 'Setup', path: 'fin_setup', prefix: 'FIN.' },
        { label: 'Accounts Receivable', path: 'fin_ar', prefix: 'FIN.' },
        { label: 'Accounts Payable', path: 'fin_ap', prefix: 'FIN.' },
        { label: 'Asset Finance', path: 'fin_assets', prefix: 'FIN.' },
        { label: 'Finance approvals', path: 'fin_approvals', prefix: 'FIN.' },
        { label: 'GL account master (MEMS)', path: 'gl_accounts', permission: 'FIN.gl.view' },
    ],
};

function hasAny(permissions: string[], code: string): boolean {
    return permissions.includes('*') || permissions.some((p) => p.startsWith(`${code}.`));
}

function canOpen(permissions: string[], link: LinkItem): boolean {
    if (link.everyone) return true;
    if (link.permission) return hasPerm(permissions, link.permission);
    if (link.prefix) {
        return permissions.includes('*') || hasPerm(permissions, link.prefix!.slice(0,-1)+'.view')
            || hasPerm(permissions, link.prefix!.slice(0,-1)+'.admin')
            || permissions.some((p) => p.startsWith(link.prefix!));
    }
    return false;
}

function moduleMenus(data: OrgContextData, canAdmin: boolean): ModuleMenu[] {
    return data.modules
        .filter((module) => module.code !== 'ADM' && (hasAny(data.permissions, module.code) || module.code === 'PRC' || (module.code === 'DOC' && hasAny(data.permissions,'ADM')))
        .map((module) => {
            const links = (MODULE_LINKS[module.code] ?? []).filter((link) => canOpen(data.permissions, link));
            // GL-linked contracts are owned by their operational modules, while
            // financial visibility remains subject to legal-entity permissions.
            const contractOwners = new Set(['FIN','INV','MNT','AST','PRC','PAY','SAL','LOG','MFG','QLT','CST']);
            if(contractOwners.has(module.code) && hasAny(data.permissions,'FIN'))
                links.push({label:'GL-linked transaction handlers',path:`fin_transactions/${module.code}`,prefix:'FIN.'});
            const capabilities = (module.code === 'INV' ? ['Dashboard','On Hand List','Invoices','Stock Take','Stock Movements','Alerts'] : [] as string[]).map((label, index) => ({
                label,
                path: module.code === 'INV' && index === 1 ? 'inventory_on_hand' : `module/${module.code}/feature/${index}`,
                permission: `${module.code}.feature.${index}.view`,
            })).filter((link) => module.code === 'INV' ? hasAny(data.permissions,'INV') : hasPerm(data.permissions, link.permission));
            return { module, links, capabilities };
        })
        .concat(canAdmin && hasAny(data.permissions, 'ADM') ? [{
            module: { code: 'ADM', name: 'Administration & Security', category: 'Core', mandatory: true, features: [] },
            links: [
                { label: 'Organization dashboard', path: 'organization_admin' },
                { label: 'Users', path: 'organization_admin/users' },
                { label: 'Security roles', path: 'organization_admin/roles' },
                { label: 'Modules & subscriptions', path: 'organization_admin/modules' },
            ].filter((link) => link.path === 'organization_admin'
                || (link.path.endsWith('/users') && hasPerm(data.permissions, 'ADM.users'))
                || (link.path.endsWith('/roles') && hasPerm(data.permissions, 'ADM.roles'))
                || (link.path.endsWith('/modules') && hasPerm(data.permissions, 'ADM.modules'))),
            capabilities: [],
        }] : []);
}

function iconFor(code: string): typeof Boxes {
    return ({ MNT: Wrench, AST: Boxes, PRC: Package, FIN: Calculator, ADM: ShieldCheck } as Record<string, typeof Boxes>)[code] ?? Layers;
}

function goTo(path: string) {
    if (path.startsWith('organization_admin')) navigate(path);
    else toHome(path);
}

function ModuleWorkspace({ menu, selectedFeature }: { menu: ModuleMenu; selectedFeature?: number }) {
    const Icon = iconFor(menu.module.code);
    const feature = selectedFeature === undefined ? undefined : menu.capabilities[selectedFeature];
    return (
        <div className='space-y-5'>
            <button onClick={() => selectedFeature === undefined ? toHome() : toHome(`module/${menu.module.code}`)} className='flex items-center gap-2 text-sm text-slate-400 hover:text-white'>
                <ArrowLeft className='h-4 w-4' /> {selectedFeature === undefined ? 'Organization home' : menu.module.name}
            </button>
            <div className='flex items-start gap-3'>
                <div className='rounded-2xl bg-emerald-500/10 p-3 text-emerald-300'><Icon className='h-6 w-6' /></div>
                <div className='min-w-0'>
                    <p className='font-mono text-xs text-emerald-400'>{menu.module.code}</p>
                    <h1 className='text-2xl font-semibold text-white'>{feature?.label ?? menu.module.name}</h1>
                    <p className='mt-1 text-sm text-slate-400'>{feature ? menu.module.name : 'Available workspaces and configured functional areas'}</p>
                </div>
            </div>
            {feature ? (
                <Card>
                    <h2 className='font-semibold text-white'>Configured functional area</h2>
                    <p className='mt-2 text-sm leading-relaxed text-slate-400'>
                        This capability is included in the MEMS module catalogue. A dedicated operational screen has not yet been activated for it. Use an available workspace below where applicable.
                    </p>
                </Card>
            ) : null}
            {menu.links.length > 0 && menu.module.code !== 'INV' && (
                <section className='space-y-3'>
                    <h2 className='text-sm font-semibold uppercase tracking-wide text-slate-400'>Available workspaces</h2>
                    <div className='grid gap-3 sm:grid-cols-2'>
                        {menu.links.map((link) => (
                            <button key={link.path} onClick={() => goTo(link.path)} className='flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 text-left hover:border-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400'>
                                <span className='font-medium text-white'>{link.label}</span>
                                <ChevronRight className='h-4 w-4 shrink-0 text-emerald-400' />
                            </button>
                        ))}
                    </div>
                </section>
            )}
            {menu.capabilities.length > 0 && (
                <section className='space-y-3'>
                    <h2 className='text-sm font-semibold uppercase tracking-wide text-slate-400'>Configured Functional Areas</h2>
                    <div className='divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900'>
                        {menu.capabilities.map((link) => (
                            <button key={link.path} onClick={() => goTo(link.path)} className='flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm text-slate-300 hover:bg-slate-800'>
                                <span>{link.label}</span>
                                <ChevronRight className='h-4 w-4 shrink-0 text-muted' />
                            </button>
                        ))}
                    </div>
                </section>
            )}
            {!menu.links.length && !menu.capabilities.length && <Card><Empty>There are no workspaces configured for this module.</Empty></Card>}
        </div>
    );
}

function MenuSection({ menu, open, activePath, search, onToggle, onSelect, favorites, onFavorite }: {
    menu: ModuleMenu;
    open: boolean;
    activePath: string;
    search: string;
    onToggle: () => void;
    onSelect: (path: string) => void;
    favorites: string[];
    onFavorite: (path: string) => void;
}) {
    const Icon = iconFor(menu.module.code);
    const term = search.trim().toLowerCase();
    const links = [...menu.links, ...menu.capabilities].filter((link) => !term || link.label.toLowerCase().includes(term));
    if (term && !menu.module.name.toLowerCase().includes(term) && !menu.module.code.toLowerCase().includes(term) && !links.length) return null;
    const expanded = term ? true : open;
    return (
        <div className='mb-1'>
            <button
                type='button'
                aria-expanded={expanded}
                onClick={onToggle}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left transition ${activePath.startsWith(`module/${menu.module.code}`) ? 'bg-emerald-500/10 text-emerald-200' : 'text-slate-200 hover:bg-slate-800'}`}
            >
                <Icon className='h-5 w-5 shrink-0 text-emerald-400' />
                <span className='min-w-0 flex-1'>
                    <span className='block truncate text-sm font-semibold'>{menu.module.name}</span>
                    <span className='font-mono text-[11px] text-muted'>{menu.module.code}</span>
                </span>
                {expanded ? <ChevronDown className='h-4 w-4 text-muted' /> : <ChevronRight className='h-4 w-4 text-muted' />}
            </button>
            {expanded && (
                <div className='ml-5 border-l border-slate-700 py-1 pl-3'>
                    <button onClick={() => onSelect(`module/${menu.module.code}`)} className={`mb-0.5 flex min-h-11 w-full items-center rounded-lg px-3 text-left text-xs ${activePath === `module/${menu.module.code}` ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-slate-800'}`}>
                        Module overview
                    </button>
                    {menu.module.code === 'FIN' && <FinEntityMenu onPick={() => onSelect(activePath.startsWith('fin_') ? activePath.split('/')[0] : 'fin_gl')} />}
                    {links.map(link => (
                        <div key={link.path} className='flex min-h-10 items-center gap-1 rounded-lg'>
                            <button onClick={() => onSelect(link.path)} className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-sm ${activePath === link.path || activePath.startsWith(`${link.path}/`) ? 'bg-emerald-500/10 font-medium text-emerald-300' : 'text-slate-300 hover:bg-slate-800'}`}>{link.label}</button>
                            <button type='button' aria-label={favorites.includes(link.path)?'Remove favorite':'Add favorite'} onClick={()=>onFavorite(link.path)} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-amber-400 hover:bg-slate-800'><Star className='h-5 w-5' fill={favorites.includes(link.path)?'currentColor':'none'}/></button>
                        </div>
                    ))}
                    {term && !links.length && <p className='px-3 py-2 text-xs text-muted'>No matching submodules</p>}
                </div>
            )}
        </div>
    );
}

export default function OrgHomePage({
    session, route, canAdmin, onSignOut, onSessionChange,
}: {
    session: Session;
    route: string;
    canAdmin: boolean;
    onSignOut: () => void;
    onSessionChange: (s: Session) => void;
}) {
    const { data, error, loading } = useLoad(() => callBackend<OrgContextData>('/api/org/context'));
    const [menuOpen, setMenuOpen] = useState(false);
    const menuPrefsKey='mems.menu.preferences.'+session.user.uid;
    const personalItems = [
        {key:'mail',label:'Email',Icon:Mail,path:'mail'},
        {key:'my_access',label:'My access',Icon:ShieldCheck,path:'my_access'},
        {key:'activity',label:'My activity',Icon:Activity,path:'activity'},
        {key:'profile',label:'My details',Icon:CircleUser,path:'profile'},
        {key:'my_tables',label:'My Tables',Icon:Table2,path:'my_tables'},
        {key:'my_setup',label:'My setup',Icon:Settings,path:'my_setup'},
        {key:'keep_alive',label:'Keep Alive',Icon:HeartPulse,path:'keep_alive'},
        ...(canAdmin?[{key:'organization_admin',label:'Organization admin',Icon:Settings,path:'organization_admin'}]:[]),
    ];
    const [personalVisible,setPersonalVisible]=useState<string[]>(()=>{
        try { const saved=JSON.parse(localStorage.getItem(menuPrefsKey)||'null'); return Array.isArray(saved?.visible)?saved.visible:['mail','my_tables','my_setup']; }
        catch { return ['mail','my_tables','my_setup']; }
    });
    const [personalCollapsed,setPersonalCollapsed]=useState(()=>{try {return JSON.parse(localStorage.getItem(menuPrefsKey)||'null')?.collapsed!==false;}catch{return true;}});
    const [personalHeight,setPersonalHeight]=useState(()=>{try{return Math.min(55,Math.max(15,Number(JSON.parse(localStorage.getItem(menuPrefsKey)||'null')?.height)||28));}catch{return 28;}});
    const [personalEditing,setPersonalEditing]=useState(false);
    useEffect(()=>{try{localStorage.setItem(menuPrefsKey,JSON.stringify({visible:personalVisible,collapsed:personalCollapsed,height:personalHeight}));}catch{/* local preferences optional */}},[menuPrefsKey,personalVisible,personalCollapsed,personalHeight]);

    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [search, setSearch] = useState('');
    const section = route.split('/')[1] ?? '';
    const [shortcuts,setShortcuts]=useState<{favorites:string[];recent:string[]}>({favorites:[],recent:[]});
    const [shortcutsReady,setShortcutsReady]=useState(false);
    useEffect(()=>{let active=true;setShortcutsReady(false);callBackend<{favorites:string[];recent:string[]}>('/api/org/shortcuts/get').then(v=>{if(active){setShortcuts(v);setShortcutsReady(true);}}).catch(()=>{if(active)setShortcutsReady(false);});return()=>{active=false;};},[session.user.uid]);
    const persistShortcuts=(next:{favorites:string[];recent:string[]})=>{if(!shortcutsReady)return;const value={favorites:next.favorites.slice(0,10),recent:next.recent.slice(0,10)};setShortcuts(value);void callBackend('/api/org/shortcuts/update',value).catch(()=>{void callBackend<{favorites:string[];recent:string[]}>('/api/org/shortcuts/get').then(setShortcuts);});};
    const toggleFavorite=(path:string)=>persistShortcuts({...shortcuts,favorites:shortcuts.favorites.includes(path)?shortcuts.favorites.filter(x=>x!==path):[path,...shortcuts.favorites].slice(0,10)});
    const [hasWorkflow,setHasWorkflow]=useState<boolean|null>(null);
    useEffect(()=>{let alive=true;callBackend<{items:unknown[]}>('/api/org/procurement/workflows/inbox').then(r=>{if(alive)setHasWorkflow(r.items.length>0);}).catch(()=>{if(alive)setHasWorkflow(null);});return()=>{alive=false;};},[session.user.uid]);
    useEffect(()=>{if(!shortcutsReady)return;const p=route.startsWith('organization_home/')?route.slice('organization_home/'.length):'';if(!p||['my_workflow','profile','my_setup','keep_alive','my_tables','quick','mail','activity','favorites','recent'].includes(p))return;const next=[p,...shortcuts.recent.filter(x=>x!==p)].slice(0,10);if(next.join('|')!==shortcuts.recent.join('|'))persistShortcuts({...shortcuts,recent:next});},[route,shortcutsReady]);

    useEffect(() => {
        setMenuOpen(false);
        window.scrollTo(0, 0);
    }, [route]);

    // Finance screens ask for the menu when the person wants to change the legal entity.
    useEffect(() => {
        const open = () => { setMenuOpen(true); setExpanded((prev) => ({ ...prev, FIN: true })); };
        window.addEventListener(OPEN_MENU_EVENT, open);
        return () => window.removeEventListener(OPEN_MENU_EVENT, open);
    }, []);

    useEffect(() => {
        if (!menuOpen) return;
        const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [menuOpen]);

    if (loading && !data) return <Spinner />;
    if (error || !data) return <div className='p-6'><Alert tone='error'>{error || 'Could not load your organization.'}</Alert></div>;

    const menus = moduleMenus(data, canAdmin);
    const currentPath = route.startsWith(`${ROUTE}/`) ? route.slice(ROUTE.length + 1) : '';
    const activeMenu = menus.find((m) =>
        currentPath === `module/${m.module.code}`
        || currentPath.startsWith(`module/${m.module.code}/`)
        || [...m.links,...m.capabilities].some((link) => !link.path.startsWith('organization_admin') && (currentPath === link.path || currentPath.startsWith(`${link.path}/`)))
    );
    const activeModule = currentPath.startsWith('module/') ? menus.find((m) => m.module.code === currentPath.split('/')[1]) : activeMenu;
    const allShortcuts = menus.flatMap(m=>[...m.links,...m.capabilities].filter(x=>!x.path.startsWith('organization_admin')).map(x=>({...x,module:m.module.name})));
    const shortcutInfo=(path:string)=>allShortcuts.find(x=>x.path===path);
    const shortcutList=(paths:string[])=>paths.filter(p=>Boolean(shortcutInfo(p))).map(p=>({...shortcutInfo(p)!,path:p}));
    const showProfile = section === 'profile';
    const showActivity = section === 'activity';
    const needsVerification = Boolean(firebaseAuth.currentUser && !firebaseAuth.currentUser.emailVerified);
    const id = route.split('/')[2];
    const sub = route.split('/')[3];

    let content: ReactNode;
    if (showProfile) content = <ProfilePage session={session} onUpdated={onSessionChange} />;
    else if (section === 'my_setup') content = <UserSetup session={session} onUpdated={onSessionChange} />;
    else if (section === 'keep_alive') content = <UserHealth uid={session.user.uid} />;
    else if (section === 'my_tables') content = <MyTables selectedId={id} canAdmin={canAdmin} allowedPaths={menus.flatMap((m) => [...m.links, ...m.capabilities].filter((l) => !l.path.startsWith('organization_admin')).map((l) => l.path))} />;
    else if (section === 'quick') content = <QuickWorkspace mode={id} id={sub} uid={session.user.uid} />;
    else if (section === 'mail') content = <OrgMail myEmail={session.user.email} initialId={id==='read'?sub:''} />;
    else if (showActivity) content = <MyActivity />;
    else if (section === 'module' && activeModule && activeModule.module.code==='INV' && sub==='feature' && route.split('/')[4]==='0') content = <InventoryDashboard />;
    else if (section === 'module' && activeModule && activeModule.module.code==='INV' && sub==='feature' && route.split('/')[4]==='3') content = <StockTake />;
    else if (section === 'module' && activeModule && activeModule.module.code==='INV' && sub==='feature' && route.split('/')[4]==='4') content = <InventoryOperations mode='movements' />;
    else if (section === 'module' && activeModule && activeModule.module.code==='INV' && sub==='feature' && route.split('/')[4]==='5') content = <InventoryOperations mode='alerts' />;
    else if (section === 'module' && activeModule && activeModule.module.code==='INV' && sub!=='feature') content = <ModuleWorkspace menu={activeModule} />;
    else if (section === 'module' && activeModule) {
        const featureIndex = sub === 'feature' ? Number(route.split('/')[4]) : undefined;
        content = <ModuleWorkspace menu={activeModule} selectedFeature={featureIndex !== undefined && Number.isInteger(featureIndex) && featureIndex >= 0 && featureIndex < activeModule.capabilities.length ? featureIndex : undefined} />;
    } else if (activeMenu && section === 'saf_configuration') content = <SafConfiguration />;
    else if (activeMenu && section === 'maintenance_windows') content = <MntWindows />;
    else if (activeMenu && section === 'mnt_material_candidates') content = <MntMaterialCandidates />;
    else if (activeMenu && section === 'mnt') content = <MntHome />;
    else if (activeMenu && section === 'mnt_workflows') content = <MntWorkflowSettings />;
    else if (activeMenu && section === 'mnt_task_validation') content = <MntTaskValidation />;
    else if (activeMenu && section === 'work_requests') content = <WorkRequests id={id} sub={sub} />;
    else if (activeMenu && section === 'work_orders') content = <WorkOrders id={id} sub={sub} />;
    else if (activeMenu && section === 'assets') content = <AssetRegister view='register' id={id} />;
    else if (activeMenu && section === 'asset_approvals') content = <AssetRegister view='approvals' id={id} />;
    else if (activeMenu && section === 'asset_dictionary') content = <AssetRegister view='dictionary' />;
    else if (activeMenu && section === 'inventory_on_hand') content = <InventoryOnHand />;
    else if (activeMenu && section === 'purchase_requirements') content = <PurchaseRequirements id={id} sub={sub} no={route.split('/')[4]} />;
    else if (activeMenu && section === 'procurement_setup') content = <ProcurementSetup back='organization_home' />;
    else if (activeMenu && section === 'procurement_vendors') content = <Vendors id={id} sub={sub} />;
    else if (activeMenu && section === 'procurement_quotations') content = <Quotations id={id} />;
    else if (activeMenu && section === 'procurement_buyers') content = <BuyerGroups back='organization_home' />;
    else if (activeMenu && section === 'warehouse_overview') content = <WarehouseOverview back='organization_home' />;
    else if (activeMenu && section === 'procurement_requisitions') content = <PurchaseOrders kind='requisitions' id={id} />;
    else if (activeMenu && section === 'procurement_orders') content = <PurchaseOrders kind='orders' id={id} />;
    else if (activeMenu && section === 'procurement_dashboard') content = <ProcurementDashboard />;
    else if (activeMenu && section === 'finance_journals') content = <Journals id={id} />;
    else if (activeMenu && section === 'fin_gl') content = <FinGl tab={id} code={sub} />;
    else if (activeMenu && section === 'fin_transactions') content = <FinTransactionWorkspace module={id||'ALL'} />;
    else if (activeMenu && section === 'fin_cc') content = <FinCostCenters id={id} />;
    else if (activeMenu && section === 'fin_journal') content = <FinJournal id={id} />;
    else if (activeMenu && section === 'fin_calendar') content = <FinCalendar fy={id} no={sub} />;
    else if (activeMenu && section === 'fin_tax') content = <FinTaxes />;
    else if (activeMenu && section === 'fin_setup') content = <FinSetup />;
    else if (activeMenu && section === 'fin_approvals') content = <FinApprovals id={id} />;
    else if (activeMenu && section === 'fin_budget') content = <NotBuilt title='Budgeting' note='Budgets per cost center and GL account, with versions, approval under the finance chart of authority and actual against budget, will be built here.' />;
    else if (activeMenu && section === 'fin_reports') content = <NotBuilt title='Reports' note='Financial statements and management reports will be built here. Meanwhile the trial balance is in Financial Calendar, inside each period.' />;
    else if (activeMenu && section === 'fin_ar') content = <NotBuilt title='Accounts Receivable' note='Customers, customer invoices, receipts and the receivable ledger will be built here.' />;
    else if (activeMenu && section === 'fin_ap') content = <NotBuilt title='Accounts Payable' note='Supplier invoices matched against GR/IR, payments and the payable ledger will be built here. Until then, receipts and accepted services stay on the GR/IR account.' />;
    else if (activeMenu && section === 'fin_assets') content = <NotBuilt title='Asset Finance' note='Capitalisation of assets received (from the asset clearing account), depreciation and disposals will be built here.' />;
    else if (activeMenu && section === 'goods_issue') content = <GoodsIssue />;
    else if (activeMenu && (section === 'replenishment' || section === 'mrp_requests')) content = <ReplenishmentRequests id={id} />;
    else if (section === 'my_access') content = <MyAccess back='organization_home' />;
    else if (section === 'my_workflow') content = <WorkflowInbox />;
    else if (activeMenu && section === 'material_catalog') content = <MaterialsMaster />;
    else if (activeMenu && section === 'service_catalog') content = <ProcurementCatalog kind='services' />;
    else if (activeMenu && section === 'gl_accounts') content = <ProcurementCatalog kind='gl_accounts' />;
    else if (currentPath==='favorites'||currentPath==='recent') content = <div className='space-y-4'>            <section className='rounded-2xl border border-line bg-panel p-4 text-ink'>
                <h2 className='text-lg font-bold text-ink'>Favorites & Recent</h2><p className='mt-1 text-sm text-soft'>Open a submodule in one tap. Use the star beside its title to add or remove a favorite.</p>
                {(['favorites','recent'] as const).filter(kind=>currentPath!=='favorites'&&currentPath!=='recent'||currentPath===kind).map(kind=><div key={kind} className='mt-4'><h3 className='mb-2 flex items-center gap-2 text-sm font-semibold text-ink'>{kind==='favorites'?<Star className='h-4 w-4'/>:<Clock3 className='h-4 w-4'/>}{kind==='favorites'?'Favorites':'Recently opened'}</h3>{shortcutList(shortcuts[kind]).length?<div className='grid gap-2 sm:grid-cols-2'>{shortcutList(shortcuts[kind]).map(item=><div key={item.path} className='flex items-center gap-2 rounded-xl border border-line bg-page p-2'><button onClick={()=>goTo(item.path)} className='min-w-0 flex-1 p-2 text-left'><span className='block truncate text-sm font-semibold text-ink'>{item.label}</span><span className='block truncate text-xs text-muted'>{item.module}</span></button><button aria-label={shortcuts.favorites.includes(item.path)?'Remove favorite':'Add favorite'} onClick={()=>toggleFavorite(item.path)} className='rounded-lg p-2 text-amber-600'><Star className='h-5 w-5' fill={shortcuts.favorites.includes(item.path)?'currentColor':'none'}/></button></div>)}</div>:<p className='text-sm text-muted'>{kind==='favorites'?'No favorites yet. Open a submodule and tap its star.':'Submodules you open will appear here.'}</p>}</div>)}
                {hasWorkflow&&<button onClick={()=>toHome('my_workflow')} className='mt-4 text-sm font-semibold text-[rgb(var(--c-brand))]'>Open My Workflow</button>}
            </section></div>;
    else if (currentPath) content = <Alert tone='error'>This workspace is not available to your user role or is not enabled for your organization.</Alert>;
    else content = (
        <OrgUserHome
            userUid={session.user.uid}
            firstName={session.user.firstName}
            roleName={data.roleName}
            permissions={data.permissions}
            needsVerification={needsVerification}
            email={session.user.email}
            modules={menus.filter((m) => m.module.code !== 'ADM').map((m) => ({ code: m.module.code, name: m.module.name, links: [...m.links, ...m.capabilities].filter((l) => !l.path.startsWith('organization_admin')).map((l) => ({ label: l.label, path: l.path })) }))}
            favorites={shortcutList(shortcuts.favorites)}
            recent={shortcutList(shortcuts.recent)}
            favoritePaths={shortcuts.favorites}
            onOpen={goTo}
            onFavorite={toggleFavorite}
            onNavigate={navigate}
        />
    );

    const currentShortcut = shortcutInfo(currentPath);
    const title = showProfile ? 'My details' : showActivity ? 'My activity' : section === 'my_setup' ? 'My setup' : section === 'keep_alive' ? 'Keep Alive' : section === 'my_tables' ? 'My Tables' : section === 'quick' ? 'Quick links' : section === 'mail' ? 'Email' : section === 'my_access' ? 'My access' : activeMenu?.module.name ?? 'Organization home';
    const nav = (
        <div className='flex h-full flex-col'>
            <div className='border-b border-slate-800 px-4 pb-4 pt-5'>
                <OrgBrandMark branding={session.organization?.branding} fallbackName={data.organization.name} />
                <div className='mt-3'><UserChip session={session} compact onClick={() => toHome('profile')} /></div>
            </div>
            <nav aria-label='Organization modules and submodules' className='min-h-0 flex-1 overflow-y-auto overscroll-contain p-3'>
                <button onClick={() => toHome()} className={`mb-3 flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm ${!currentPath ? 'bg-emerald-500/10 font-medium text-emerald-300' : 'text-slate-300 hover:bg-slate-800'}`}>
                    <Home className='h-[18px] w-[18px]' /> Organization home
                </button>
                <label className='mb-3 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3'>
                    <Search className='h-4 w-4 text-muted' />
                    <input aria-label='Search modules and submodules' value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Find a module or area' className='h-11 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-muted' />
                </label>
                <p className='mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted'>Modules & submodules</p>
                {menus.map((m) => (
                    <MenuSection
                        key={m.module.code}
                        menu={m}
                        search={search}
                        activePath={currentPath}
                        open={expanded[m.module.code] ?? (activeMenu?.module.code === m.module.code)}
                        onToggle={() => setExpanded((prev) => ({ ...prev, [m.module.code]: !(prev[m.module.code] ?? (activeMenu?.module.code === m.module.code)) }))}
                        onSelect={(path) => { setMenuOpen(false); goTo(path); }}
                        favorites={shortcuts.favorites}
                        onFavorite={toggleFavorite}
                    />
                ))}
                {!menus.length && <p className='px-3 py-3 text-sm text-slate-400'>No modules assigned.</p>}
            </nav>
            <div className='shrink-0 border-t border-slate-800 p-2'>
                <div className='flex items-center gap-1'>
                    <button type='button' aria-expanded={!personalCollapsed} onClick={()=>setPersonalCollapsed(x=>!x)} className='flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-slate-300'>
                        {personalCollapsed?<ChevronRight className='h-4 w-4'/>:<ChevronDown className='h-4 w-4'/>} Personal shortcuts
                    </button>
                    <button type='button' aria-label='Customize personal shortcuts' onClick={()=>{setPersonalEditing(x=>!x);setPersonalCollapsed(false);}} className='flex h-11 w-11 items-center justify-center rounded-lg text-slate-300'><Settings className='h-4 w-4'/></button>
                </div>
                {!personalCollapsed&&<div className='min-h-0 overflow-y-auto overscroll-contain' style={{maxHeight:personalHeight+'dvh'}}>
                    {personalEditing&&<div className='space-y-2 rounded-lg border border-line p-2'>
                        <label className='block text-xs text-muted'>Shortcut area height
                            <input type='range' min='15' max='55' value={personalHeight} onChange={e=>setPersonalHeight(Number(e.target.value))} className='mt-1 block w-full'/>
                        </label>
                        {personalItems.map(item=><label key={item.key} className='flex min-h-9 items-center gap-2 text-xs text-ink'>
                            <input type='checkbox' checked={personalVisible.includes(item.key)} onChange={e=>setPersonalVisible(previous=>e.target.checked?[...previous,item.key]:previous.filter(k=>k!==item.key))}/>{item.label}
                        </label>)}
                        <button type='button' onClick={()=>setPersonalEditing(false)} className='min-h-11 w-full rounded-lg border border-line text-sm text-ink'>Done</button>
                    </div>}
                    {personalItems.filter(item=>personalVisible.includes(item.key)).map(item=><button key={item.key} type='button' onClick={()=>{setMenuOpen(false);if(item.path==='organization_admin')navigate(item.path);else toHome(item.path);}} className='flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-slate-300 hover:bg-slate-800'>
                        <item.Icon className='h-[18px] w-[18px] shrink-0'/><span className='min-w-0 truncate'>{item.label}</span>
                    </button>)}
                </div>}
                <button onClick={onSignOut} className='flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-slate-300 hover:bg-slate-800'><LogOut className='h-[18px] w-[18px]'/> Log out</button>
            </div>
        </div>
    );

    return (
        <div className='mems-shell-home min-h-dvh bg-slate-950'>
            <aside className='fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-slate-800 bg-slate-900 lg:block'>{nav}</aside>
            {menuOpen && (
                <div className='fixed inset-0 z-50 lg:hidden'>
                    <button aria-label='Close menu' className='absolute inset-0 bg-black/70' onClick={() => setMenuOpen(false)} />
                    <aside role='dialog' aria-modal='true' aria-label='Modules menu' className='absolute inset-y-0 left-0 w-80 max-w-[88%] border-r border-slate-800 bg-slate-900 shadow-2xl'>
                        <button aria-label='Close menu' onClick={() => setMenuOpen(false)} className='absolute right-2 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800'><X className='h-5 w-5' /></button>
                        {nav}
                    </aside>
                </div>
            )}
            <div className='lg:pl-72'>
                <header className='sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-4 backdrop-blur lg:px-8'>
                    <button onClick={() => setMenuOpen(true)} aria-label='Open modules menu' className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-800 text-slate-200 hover:bg-slate-900 lg:hidden'><Menu className='h-5 w-5' /></button>
                    <div className='min-w-0 flex-1'><p className='truncate text-sm font-semibold text-white'>{title}</p><p className='truncate text-[11px] text-muted'>{data.organization.name}</p></div>
                    {currentShortcut&&<button aria-label={shortcuts.favorites.includes(currentPath)?'Remove favorite':'Add favorite'} title='Favorite this submodule' onClick={()=>toggleFavorite(currentPath)} className='rounded-xl p-2 text-amber-400'><Star className='h-5 w-5' fill={shortcuts.favorites.includes(currentPath)?'currentColor':'none'}/></button>}
                    <UserChip session={session} compact onClick={() => toHome('profile')} />
                    <button type='button' onClick={onSignOut} aria-label='Log out' title='Log out' className='hidden lg:flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-700 px-3 text-sm font-medium text-slate-200 hover:border-slate-500 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'><LogOut className='h-4 w-4' aria-hidden='true'/> Log out</button>
                </header>
                <main className='mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8'>{content}</main>
            </div>
        </div>
    );
}

