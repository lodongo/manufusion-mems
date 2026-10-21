/** Lifecycle of a controlled document as five steps, from stored facts. Pure (shared by the server and the screens). */
export type StepState = 'done' | 'current' | 'todo' | 'blocked';
export interface WorkflowStep { key: 'draft' | 'review' | 'signoff' | 'approval' | 'effective'; label: string; state: StepState; detail: string }

/** Lifecycle steps from the stored facts. Pure, so the screen and the tests agree. */
export function lifecycleSteps(input: {
    status: string;
    files: number;
    filesWaiting: number;
    slots: number;
    slotsSigned: number;
    approvalStatus: string;
    digital: boolean;
}): WorkflowStep[] {
    const { status, files, filesWaiting, slots, slotsSigned, approvalStatus, digital } = input;
    const after = (s: string[]) => s.includes(status);
    const reviewed = after(['technical_verified', 'effective', 'superseded', 'withdrawn', 'archived']);
    const effective = after(['effective', 'superseded', 'withdrawn', 'archived']);
    const draftDetail = digital ? 'Structured digital document' : !files ? 'Upload the document file' : filesWaiting ? `${filesWaiting} file(s) waiting for the malware scan` : !slots ? 'Assign who signs it off' : `${files} file(s) · ${slots} signatory(ies)`;
    const steps: WorkflowStep[] = [
        { key: 'draft', label: 'Prepare draft', state: status === 'draft' ? 'current' : status === 'rejected' ? 'blocked' : 'done', detail: status === 'rejected' ? 'Rejected by the reviewer' : draftDetail },
        { key: 'review', label: 'Independent review', state: status === 'in_review' ? 'current' : reviewed ? 'done' : 'todo', detail: status === 'in_review' ? 'Waiting for a reviewer at this location' : reviewed ? 'Technically verified' : 'Submit when the draft is ready' },
        { key: 'signoff', label: 'Sign-off', state: effective || (reviewed && slots > 0 && slotsSigned === slots) ? 'done' : status === 'technical_verified' ? 'current' : 'todo', detail: slots ? `${slotsSigned} of ${slots} signed` : 'No signatories assigned yet' },
        { key: 'approval', label: 'Publication approval', state: effective || approvalStatus === 'approved' || approvalStatus === 'executed' ? 'done' : ['rejected', 'returned'].includes(approvalStatus) ? 'blocked' : status === 'technical_verified' && slots > 0 && slotsSigned === slots ? 'current' : 'todo', detail: approvalStatus ? `Approval ${approvalStatus.replace(/_/g, ' ')}` : 'Chart of authority approval' },
        { key: 'effective', label: 'Effective', state: effective ? 'done' : 'todo', detail: effective ? `Status: ${status}` : 'Published revision, available to readers' },
    ];
    return steps;
}

