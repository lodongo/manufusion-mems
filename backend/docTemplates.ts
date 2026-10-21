/**
 * Standard document templates (DOC). A template is a starting point for a controlled document: its class,
 * the sections the document must contain (with guidance), the usual sign-off authorities and a review cycle.
 * Creating a draft from a template records the template code and outline on the draft; the author downloads the
 * outline as a Word document, writes the content and uploads the finished file as the controlled source.
 */
export interface DocTemplateSection { heading: string; guidance: string }
export interface DocTemplate {
    code: string;
    classCode: string;
    name: string;
    purpose: string;
    reviewMonths: number;
    signOff: string[];
    sections: DocTemplateSection[];
}

const S = (heading: string, guidance: string): DocTemplateSection => ({ heading, guidance });
const COMMON_END = [
    S('Definitions and abbreviations', 'Terms a reader needs to understand this document.'),
    S('References', 'Related policies, procedures, standards, legislation and forms (with their codes).'),
    S('Revision history', 'Revision, date, summary of change, author and approver.'),
];

export const DOC_TEMPLATES: DocTemplate[] = [
    {
        code: 'TPL-POL', classCode: 'POL', name: 'Policy', reviewMonths: 36, signOff: ['Prepared by', 'Approved by (Managing Director)'],
        purpose: 'A short statement of intent and commitment from top management.',
        sections: [S('Purpose', 'Why the policy exists and what it commits the organization to.'), S('Scope', 'Sites, departments, people and activities covered.'), S('Policy statement', 'The commitments, in plain numbered statements.'), S('Responsibilities', 'Who owns, implements and monitors the policy.'), S('Compliance and review', 'How compliance is checked and when the policy is reviewed.'), ...COMMON_END],
    },
    {
        code: 'TPL-PRC', classCode: 'PRC', name: 'Procedure', reviewMonths: 24, signOff: ['Prepared by', 'Reviewed by', 'Approved by'],
        purpose: 'How a process is carried out across functions, with responsibilities and records.',
        sections: [S('Purpose', 'What the procedure achieves.'), S('Scope', 'Where and when it applies; what is excluded.'), S('Responsibilities', 'Roles (job roles, not names) and what each does.'), S('Procedure', 'Numbered steps in order: who does what, inputs, outputs, decisions.'), S('Records', 'Records produced, where they are kept and for how long.'), S('Key performance indicators', 'How the process performance is measured.'), ...COMMON_END],
    },
    {
        code: 'TPL-SOP', classCode: 'SOP', name: 'Standard operating procedure', reviewMonths: 24, signOff: ['Prepared by', 'Technical review', 'Approved by'],
        purpose: 'Exact steps to perform a routine operation safely and consistently.',
        sections: [S('Purpose and scope', 'The operation, equipment and area covered.'), S('Safety and PPE', 'Hazards, permits, isolations and required protective equipment.'), S('Tools, materials and competence', 'What is needed and who is competent to do it.'), S('Steps', 'Numbered steps with checks, limits and photos where helpful.'), S('Acceptance criteria', 'How the operator knows the job is done right.'), S('Abnormal situations', 'What to do when something goes wrong; who to call.'), ...COMMON_END],
    },
    {
        code: 'TPL-WIN', classCode: 'WIN', name: 'Work instruction', reviewMonths: 24, signOff: ['Prepared by', 'Approved by (Supervisor)'],
        purpose: 'A single task at the workplace, shown step by step (often with pictures).',
        sections: [S('Task', 'The task, the equipment and where it is done.'), S('Before you start', 'Safety, isolations, tools and materials.'), S('Steps', 'Short numbered steps, one action each, with pictures.'), S('Checks', 'What to check before handing over.'), ...COMMON_END],
    },
    {
        code: 'TPL-MAN', classCode: 'MAN', name: 'Management system manual', reviewMonths: 36, signOff: ['Prepared by', 'Approved by (Managing Director)'],
        purpose: 'Describes the management system, its scope and how its processes interact.',
        sections: [S('Organization and context', 'Who we are, interested parties and their needs.'), S('Scope of the management system', 'Sites, products, services and exclusions.'), S('Leadership and policy', 'Management commitment and the policies in force.'), S('Planning', 'Risks, opportunities and objectives.'), S('Support', 'Resources, competence, awareness, communication and documented information.'), S('Operation', 'The core processes and how they interact.'), S('Performance evaluation', 'Monitoring, internal audit and management review.'), S('Improvement', 'Nonconformity, corrective action and continual improvement.'), ...COMMON_END],
    },
    {
        code: 'TPL-PLN', classCode: 'PLN', name: 'Management plan', reviewMonths: 12, signOff: ['Prepared by', 'Approved by'],
        purpose: 'What will be done, by whom, by when and with which resources to meet an objective.',
        sections: [S('Objective', 'The measurable objective this plan delivers.'), S('Actions', 'Action, owner, due date and resources (a table works best).'), S('Risks', 'Main risks to delivery and how they are controlled.'), S('Monitoring', 'How progress is tracked and reported.'), ...COMMON_END],
    },
    {
        code: 'TPL-STD', classCode: 'STD', name: 'Internal standard', reviewMonths: 36, signOff: ['Prepared by', 'Technical review', 'Approved by'],
        purpose: 'A mandatory technical or quality requirement the organization applies.',
        sections: [S('Purpose and scope', 'What the standard governs.'), S('Requirements', 'Numbered "shall" requirements with values and tolerances.'), S('Verification', 'How conformity is checked and recorded.'), S('Deviations', 'How a deviation is requested and approved.'), ...COMMON_END],
    },
    {
        code: 'TPL-SPC', classCode: 'SPC', name: 'Specification', reviewMonths: 24, signOff: ['Prepared by', 'Technical review', 'Approved by'],
        purpose: 'The characteristics a material, product, equipment or service must meet.',
        sections: [S('Item', 'What is specified (code, description, application).'), S('Characteristics', 'Properties, dimensions, ratings, with limits and test methods.'), S('Packaging, marking and documents', 'Labels, certificates and documents required on delivery.'), S('Acceptance', 'Inspection and acceptance criteria.'), ...COMMON_END],
    },
    {
        code: 'TPL-FRM', classCode: 'FRM', name: 'Form', reviewMonths: 24, signOff: ['Prepared by', 'Approved by'],
        purpose: 'A blank form used to capture a record. For an online form, use Digital forms & records.',
        sections: [S('Form title and code', 'Name and document code printed on the form.'), S('Fields', 'Each field, its type and whether it is mandatory.'), S('Sign-off', 'Who signs the completed form.'), S('Retention', 'How long completed forms are kept and where.')],
    },
    {
        code: 'TPL-REG', classCode: 'REG', name: 'Register', reviewMonths: 12, signOff: ['Prepared by', 'Approved by'],
        purpose: 'A controlled list (for example a risk, legal or equipment register).',
        sections: [S('Purpose', 'What the register records and why.'), S('Columns', 'Each column and how it is filled in.'), S('Ownership and updates', 'Who maintains it and how often.'), S('Entries', 'The register itself (a spreadsheet is usually best).')],
    },
    {
        code: 'TPL-RPT', classCode: 'RPT', name: 'Report', reviewMonths: 12, signOff: ['Prepared by', 'Reviewed by'],
        purpose: 'Findings, results or status for a period or an event.',
        sections: [S('Summary', 'The main findings and decisions needed, in a few lines.'), S('Background', 'Why the report was prepared; the period or event covered.'), S('Findings', 'Facts, data and analysis.'), S('Conclusions and recommendations', 'What it means and what should be done, with owners.'), S('Appendices', 'Supporting data and evidence.')],
    },
    {
        code: 'TPL-GDL', classCode: 'GDL', name: 'Guideline', reviewMonths: 36, signOff: ['Prepared by', 'Approved by'],
        purpose: 'Recommended practice (advisory, not mandatory).',
        sections: [S('Purpose and scope', 'What the guideline helps with.'), S('Guidance', 'Recommended practices, examples and tips.'), ...COMMON_END],
    },
    {
        code: 'TPL-CHK', classCode: 'CHK', name: 'Checklist', reviewMonths: 24, signOff: ['Prepared by', 'Approved by'],
        purpose: 'Items to check, each with an accept / reject answer.',
        sections: [S('Use', 'When the checklist is used and by whom.'), S('Items', 'Numbered check items with the expected condition.'), S('Sign-off', 'Who signs the completed checklist.')],
    },
    {
        code: 'TPL-BLANK', classCode: '', name: 'Blank document', reviewMonths: 24, signOff: ['Approved by'],
        purpose: 'Any class, no prescribed sections. Use it when you already have the finished file.',
        sections: [],
    },
];

export const templateByCode = (code: string) => DOC_TEMPLATES.find((t) => t.code === code);
