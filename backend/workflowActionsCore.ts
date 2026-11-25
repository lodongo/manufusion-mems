// ---------------------------------------------------------------------------
// Workflow actions: pure rules shared by the engine (workflowActions.ts), its adapters and the tests.
//
// Every step of every workflow that waits on an employee (approve a PR, approve a PO level, verify a stock take, review a
// work request, release a plan …) becomes one WORKFLOW ACTION:
//   organizations/{org}/workflow_tasks/{wf_…}      one per record × step (deterministic id: never delivered twice)
// delivered to each person who must act as
//   - an internal email           organizations/{org}/mailboxes/{uid}/items/{wfm_…}   (category Action)
//   - a To-do / action tracker    organizations/{org}/chat_actions/{wfa_…}            (source "workflow")
//   - a chat message              organizations/{org}/chat_rooms/{wfr_…}             ("Workflow actions" room)
// An action is CLOSED only when the record moves past that step in its own module (approved, returned, rejected,
// posted, cancelled …). Opening the email, the to-do or the chat never closes it or marks it done, and none of them
// can be closed by hand. Test mode: while the platform testing override is on for the organization, every action
// created goes to the organization super admin(s), and keeps them as its recipients until it closes.
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto';

export interface Candidate { uid: string; superAdmin: boolean }
export interface OpenTask { id: string; stageKey: string; recipients: string[]; testMode: boolean }
export interface StageOut { key: string; label: string; recipients: string[] }

const hash = (s: string, n: number) => createHash('sha256').update(s).digest('hex').slice(0, n);
/** Deterministic ids: the same record and step always map to the same action, so it is never created twice. */
export const taskIdOf = (adapter: string, refId: string, stageKey: string) => `wf_${hash(`${adapter}|${refId}|${stageKey}`, 32)}`;
export const mailIdOf = (taskId: string, uid: string) => `wfm_${taskId.slice(3, 27)}_${hash(uid, 10)}`;
export const actionIdOf = (taskId: string) => `wfa_${taskId.slice(3)}`;
export const roomIdOf = (uid: string) => `wfr_${hash(uid, 32)}`;
export const chatMessageIdOf = (taskId: string, uid: string, kind: 'open' | 'closed') => `wfc_${kind}_${taskId.slice(3, 27)}_${hash(uid, 8)}`;
export const SYSTEM_UID = 'mems_workflow';
export const SYSTEM_NAME = 'MEMS Workflow';

/**
 * Who receives an action. People who can act and are not organization super admins; a super admin only when nobody else
 * can act (so the step is never orphaned). In test mode every new action goes to the organization super admin(s).
 */
export function chooseRecipients(eligible: Candidate[], testMode: boolean, superAdmins: string[]) {
    const seen = new Set<string>();
    const unique = eligible.filter((c) => c.uid && !seen.has(c.uid) && seen.add(c.uid));
    const regular = unique.filter((c) => !c.superAdmin).map((c) => c.uid);
    const intended = regular.length ? regular : unique.filter((c) => c.superAdmin).map((c) => c.uid);
    if (testMode && superAdmins.length) return { recipients: [...new Set(superAdmins)].sort(), intended: intended.sort(), testMode: true };
    return { recipients: intended.sort(), intended: intended.sort(), testMode: false };
}

export interface Plan {
    close: Array<{ id: string; reason: 'completed' | 'withdrawn' }>;
    create: boolean;
    keep: string;
    add: string[];
    remove: string[];
}
/**
 * What to do for one record: close actions of steps it has left, create the action of its current step, and (outside
 * test mode) deliver to people newly able to act and withdraw it from people who no longer can.
 */
export function planFor(stage: StageOut | null, open: OpenTask[], recordExists: boolean): Plan {
    const plan: Plan = { close: [], create: false, keep: '', add: [], remove: [] };
    for (const t of open) {
        if (stage && t.stageKey === stage.key && !plan.keep) {
            plan.keep = t.id;
            if (!t.testMode && stage.recipients.length) {
                plan.add = stage.recipients.filter((u) => !t.recipients.includes(u));
                plan.remove = t.recipients.filter((u) => !stage.recipients.includes(u));
            }
        } else plan.close.push({ id: t.id, reason: recordExists ? 'completed' : 'withdrawn' });
    }
    if (stage && !plan.keep && stage.recipients.length) plan.create = true;
    return plan;
}

const STATUS_WORDS: Record<string, string> = {
    pending_approval: 'pending approval', approved: 'approved', rejected: 'rejected', returned: 'returned', returned_user: 'returned to the requester',
    cancelled: 'cancelled', canceled: 'cancelled', acknowledged: 'acknowledged by procurement', open: 'approved and open', posted: 'posted', paid: 'paid',
    active: 'approved and active', released: 'released', converted: 'converted', closed: 'closed', completed: 'completed', reconciled: 'reconciled',
    approved_for_posting: 'approved for posting', superseded: 'superseded', withdrawn: 'withdrawn', effective: 'published',
};
export const statusWords = (s: string) => STATUS_WORDS[s] ?? s.replace(/_/g, ' ');
/** The closing note of an action from the record's new state. */
export function outcomeOf(before: string, after: string, exists: boolean, by: string) {
    if (!exists) return 'Closed: the record no longer exists or was withdrawn.';
    const who = by ? ` by ${by}` : '';
    if (before === after) return `Closed: this step was completed${who}.`;
    return `Closed: moved from ${statusWords(before)} to ${statusWords(after)}${who}.`;
}

const esc = (v: string) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export interface TaskView { module: string; label: string; ref: string; title: string; stageLabel: string; link: string; linkLabel: string; createdAt: string; testMode: boolean; intendedNames: string[]; details: Array<{ label: string; value: string }> }
/** The internal email body of a new action. */
export function mailHtml(t: TaskView) {
    const rows = [['Module', t.module], ['Workflow', t.label], ['Reference', t.ref], ['Your step', t.stageLabel], ...t.details.map((d) => [d.label, d.value])]
        .filter(([, v]) => v)
        .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0"><strong>${esc(v)}</strong></td></tr>`)
        .join('');
    const test = t.testMode ? `<p style="color:#b45309"><strong>Test mode:</strong> sent to you as organization super admin${t.intendedNames.length ? ` instead of ${esc(t.intendedNames.join(', '))}` : ''}.</p>` : '';
    return `<p><strong>Action required: ${esc(t.title)}</strong></p><table>${rows}</table>${test}<p>Open <strong>${esc(t.linkLabel)}</strong> in MEMS to complete this step.</p><p style="color:#666">This message, its To-do and its chat stay open until the step is completed in MEMS. Reading them does not complete the action.</p>`;
}
export function chatOpenText(t: TaskView) {
    return `🔔 Action required · ${t.module}\n${t.title}\nReference ${t.ref} · your step: ${t.stageLabel}${t.testMode ? '\n(Test mode: sent to the organization super admin)' : ''}\nComplete it in ${t.linkLabel}. It closes automatically when the step is done.`;
}
export function chatClosedText(t: Pick<TaskView, 'module' | 'ref' | 'title' | 'stageLabel'>, outcome: string) {
    return `✅ ${t.module} · ${t.ref}\n${t.title} · ${t.stageLabel}\n${outcome}`;
}
