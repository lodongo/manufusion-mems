import { useState, type ReactNode } from 'react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Spinner, useLoad } from '../admin/kit';
import { Screen } from '../components/screen';
import { Alert } from '../components/ui';
import EngineeringDocumentLinks from './EngineeringDocumentLinks';
import SheqSdsRegistry from './SheqSdsRegistry';
import DigitalRcaDraft from './DigitalRcaDraft';
import DigitalFormWorkspace from './DigitalFormWorkspace';
import DigitalFormReviews from './DigitalFormReviews';
import DigitalFormSignatures from './DigitalFormSignatures';
import DigitalRcaWorkspace from './DigitalRcaWorkspace';
import DocumentList, { type ListView, type ReviewItem } from './docs/DocumentList';
import DocumentDetail from './docs/DocumentDetail';
import NewDocumentSheet from './docs/NewDocumentSheet';
import DocSettings from './docs/DocSettings';
import type { DocRow, DocTemplate, ScopeNode } from './docs/docUi';

// Documentation & Records (DOC). The Documents section is the document handler: the register as a rich table, a
// "start here" guide, a template-based New document flow and one screen per document that walks it through its
// lifecycle (draft → independent review → sign-off → chart-of-authority approval → effective). The other DOC
// sections keep their own tools inside the same page frame.

type Mode = 'register' | 'engineering' | 'sds' | 'rca' | 'review' | 'knowledge' | 'forms' | 'config';
interface Setup {
    config: { enabledClassCodes: string[]; defaultReviewMonths: number; enabledSubmodules?: string[] };
    locations: ScopeNode[];
    templates: DocTemplate[];
    scanning?: { enabled: boolean };
}

const PAGES: Record<Exclude<Mode, 'register' | 'review' | 'config'>, { title: string; subtitle: string; intro: string }> = {
    engineering: { title: 'Engineering & equipment library', subtitle: 'Documents linked to assets and equipment models', intro: 'Link effective documents (manuals, drawings, procedures) to the assets and equipment models they describe, so technicians find them from the asset.' },
    sds: { title: 'SHEQ SDS / MSDS', subtitle: 'Safety data sheets', intro: 'Register safety data sheets for the chemicals and materials used at your locations.' },
    rca: { title: 'Digital RCA & investigations', subtitle: 'Structured root-cause analysis', intro: 'Start an investigation, work through the DMAIC stages with evidence, then submit it for independent review like any controlled document.' },
    knowledge: { title: 'Knowledge & troubleshooting', subtitle: 'Equipment knowledge', intro: 'Open Asset management and choose an equipment item to see its technical dossier, maintenance evidence and troubleshooting search.' },
    forms: { title: 'Digital forms & records', subtitle: 'Online forms and their records', intro: 'Build online form templates, fill in records, and route them for review and signature.' },
};

function Frame({ mode, children }: { mode: keyof typeof PAGES; children: ReactNode }) {
    const p = PAGES[mode];
    return (
        <Screen title={p.title} subtitle={p.subtitle}>
            <p className='rounded-2xl border border-line bg-panel p-4 text-sm text-soft'>{p.intro}</p>
            {children}
        </Screen>
    );
}

export default function DocumentRegistryPage({ canConfigure, canReview, mode = 'register', documentId = '' }: { canConfigure: boolean; canReview: boolean; mode?: Mode; documentId?: string }) {
    const docs = useLoad(() => callBackend<{ documents: Array<DocRow & { id?: string }> }>('/api/org/drkms/documents/list', {}), []);
    const setup = useLoad(() => callBackend<Setup>('/api/org/drkms/setup', {}), []);
    const reviews = useLoad(() => (mode === 'register' || mode === 'review' ? callBackend<{ schedule: ReviewItem[] }>('/api/org/drkms/documents/review-schedule', {}) : Promise.resolve({ schedule: [] })), [mode]);
    const inbox = useLoad(() => (mode === 'register' || mode === 'review' ? callBackend<{ assignments: Array<{ signatureStatus: string }> }>('/api/org/drkms/signatures/my-inbox', {}) : Promise.resolve({ assignments: [] })), [mode]);
    const [view, setView] = useState<ListView>(mode === 'review' ? 'review' : 'mine');
    const [creating, setCreating] = useState(false);

    const base = mode === 'review' ? 'doc_review' : 'doc_register';
    const open = (id: string) => navigate(`organization_home/${base}/${id}`);
    const back = () => {
        docs.reload();
        navigate(`organization_home/${base}`);
    };

    if (setup.loading && !setup.data) return <Spinner />;
    if (setup.error) return <Alert tone='error'>{setup.error}</Alert>;
    const config = setup.data?.config;
    if (mode !== 'config' && mode !== 'review' && config?.enabledSubmodules && !config.enabledSubmodules.includes(mode))
        return <Alert tone='info'>This document section is turned off in Document settings.</Alert>;

    if (mode === 'config') {
        if (!canConfigure) return <Alert tone='error'>You need the document configuration right to change these settings.</Alert>;
        return config ? <DocSettings config={config} scanningEnabled={!!setup.data?.scanning?.enabled} onSaved={setup.reload} /> : <Spinner />;
    }

    if ((mode === 'register' || mode === 'review') && documentId) {
        if (!/^[a-f0-9]{20}$/.test(documentId)) return <Alert tone='error'>Unknown document link.</Alert>;
        return <DocumentDetail key={documentId} documentId={documentId} onBack={back} onOpenDocument={open} />;
    }

    if (mode === 'register' || mode === 'review') {
        const rows: DocRow[] = (docs.data?.documents ?? []).map((d) => ({ ...d, documentId: d.documentId || d.id || '' }));
        return (
            <>
                <DocumentList
                    documents={rows}
                    loading={docs.loading && !docs.data}
                    error={docs.error || ''}
                    reviews={reviews.data?.schedule ?? []}
                    toSign={(inbox.data?.assignments ?? []).filter((a) => a.signatureStatus === 'pending').length}
                    canCreate={(setup.data?.locations.length ?? 0) > 0}
                    canReview={canReview}
                    view={view}
                    onView={setView}
                    onOpen={open}
                    onNew={() => setCreating(true)}
                />
                {creating && setup.data && (
                    <NewDocumentSheet
                        templates={setup.data.templates ?? []}
                        enabledClasses={setup.data.config.enabledClassCodes}
                        locations={setup.data.locations}
                        onClose={() => setCreating(false)}
                        onCreated={(id) => {
                            setCreating(false);
                            docs.reload();
                            open(id);
                        }}
                    />
                )}
            </>
        );
    }

    const documents = (docs.data?.documents ?? []).map((d) => ({ ...d, documentId: d.documentId || d.id || '' }));
    if (mode === 'engineering') return <Frame mode='engineering'><EngineeringDocumentLinks documents={documents} /></Frame>;
    if (mode === 'sds') return <Frame mode='sds'><SheqSdsRegistry canConfigure={canConfigure} /></Frame>;
    if (mode === 'rca')
        return (
            <Frame mode='rca'>
                <DigitalRcaDraft locations={setup.data?.locations ?? []} onCreated={docs.reload} />
                <DigitalRcaWorkspace documents={documents} />
            </Frame>
        );
    if (mode === 'knowledge') return <Frame mode='knowledge'>{null}</Frame>;
    return (
        <Frame mode='forms'>
            <DigitalFormSignatures />
            <DigitalFormWorkspace locations={setup.data?.locations ?? []} />
            {canReview && <DigitalFormReviews />}
        </Frame>
    );
}
