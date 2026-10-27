import AssetDictionaryBrowser, { GL_LABELS, MATERIAL_LABELS, SERVICE_LABELS } from '../components/AssetDictionaryBrowser';
import { PageTitle } from '../admin/kit';

// Read-only views of the MEMS module lists: material and service master catalogs (Procurement, PRC) and the
// GL account master (Finance, FIN), used as the reference when the organization creates its own records.

const VIEW = {
    materials: {
        title: 'Materials Master', 
        subtitle: 'MEMS reference for material master data: what to record for each kind of material, with codes, profiles and required attributes.',
        api: '/api/org/procurement/catalog',
        labels: MATERIAL_LABELS,
    },
    services: {
        title: 'Service catalog',
        subtitle: 'MEMS reference for service master data: what to specify for each kind of service, with codes, profiles and required attributes.',
        api: '/api/org/procurement/catalog',
        labels: SERVICE_LABELS,
    },
    gl_accounts: {
        title: 'GL account master',
        subtitle: 'MEMS reference chart of accounts: classes, categories, groups and GL accounts with normal balance, role, posting rules, IFRS presentation and the attributes to configure when you adopt an account.',
        api: '/api/org/finance/catalog',
        labels: GL_LABELS,
    },
};

export default function ProcurementCatalog({ kind }: { kind: 'materials' | 'services' | 'gl_accounts' }) {
    const v = VIEW[kind];
    return (
        <div className='space-y-3'>
            <PageTitle title={v.title} subtitle={v.subtitle} />
            <AssetDictionaryBrowser key={kind} treePath={`${v.api}/tree`} classPath={`${v.api}/item`} body={{ kind }} labels={v.labels} industryFilterEnabled />
        </div>
    );
}
