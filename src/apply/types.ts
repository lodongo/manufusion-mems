export interface DocMeta {
    name: string;
    contentType: string;
    size: number;
    uploadedAt: string;
}

export interface Application {
    uid: string;
    email: string;
    domain: string;
    status: string;
    applicant: Record<string, string>;
    organization: Record<string, string>;
    registration: Record<string, string>;
    headquarters: Record<string, string>;
    identity: Record<string, string>;
    branding: Record<string, string>;
    documents: Record<string, DocMeta>;
    completeness: Record<string, boolean>;
    reviewNote: string;
    reviewedAt: string;
    reviewedBy: string;
    orgId: string;
    orgCode: string;
    createdAt: string;
    updatedAt: string;
    submittedAt: string;
}

export const DOC_SLOTS: Array<{ key: string; label: string; hint: string; required: boolean; imageOnly: boolean; step: 'documents' | 'branding' }> = [
    { key: 'registrationCertificate', label: 'Certificate of registration', hint: 'Certificate of incorporation or business registration', required: true, imageOnly: false, step: 'documents' },
    { key: 'taxCertificate', label: 'Tax certificate', hint: 'Optional, e.g. PIN or TIN certificate', required: false, imageOnly: false, step: 'documents' },
    { key: 'idFront', label: 'ID document (front)', hint: 'National ID, passport or residence permit', required: true, imageOnly: false, step: 'documents' },
    { key: 'idBack', label: 'ID document (back)', hint: 'Optional, if your ID has a back side', required: false, imageOnly: false, step: 'documents' },
    { key: 'logo', label: 'Organization logo', hint: 'PNG with transparent background works best', required: true, imageOnly: true, step: 'branding' },
    { key: 'photo', label: 'Your photo', hint: 'A clear photo of your face', required: true, imageOnly: true, step: 'branding' },
];

export const STEPS = [
    { key: 'applicant', title: 'Your details', hint: 'Tell us who is registering the organization.' },
    { key: 'organization', title: 'Organization', hint: 'The organization you are registering.' },
    { key: 'registration', title: 'Registration', hint: 'How the organization is officially registered.' },
    { key: 'headquarters', title: 'Headquarters', hint: 'Where the organization is based.' },
    { key: 'documents', title: 'Documents', hint: 'Proof of registration and your identity.' },
    { key: 'branding', title: 'Branding', hint: 'Your team will see MEMS in your own brand.' },
    { key: 'review', title: 'Review & submit', hint: 'Check everything, then submit for approval.' },
];

export const STEP_LABELS = STEPS.map((s) => s.title);

export const STATUS_LABELS: Record<string, string> = {
    draft: 'In progress',
    submitted: 'Pending approval',
    returned: 'Returned for changes',
    approved: 'Approved',
    rejected: 'Rejected',
};
