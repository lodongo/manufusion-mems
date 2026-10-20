// ---------------------------------------------------------------------------
// Outlook-style mailbox rules, junk and Focused Inbox, applied when a message is delivered (pure: shared with tests).
//   1. Blocked sender (not also a safe sender)  → Junk Email
//   2. Rules in order: conditions all match → actions (move, mark read, flag, categorise, Focused / Other);
//      "stop processing more rules" ends the run
//   3. Focused Inbox: safe senders and high importance are Focused; a rule may send mail to Other
// ---------------------------------------------------------------------------

export const MAIL_CATEGORIES = ['Action', 'Follow up', 'Information', 'Urgent', 'Project', 'Finance', 'Maintenance'] as const;
export const SWIPE_ACTIONS = ['archive', 'delete', 'flag', 'read', 'move', 'none'] as const;

export interface MailRule {
    id: string;
    name: string;
    enabled: boolean;
    /** Conditions (all that are set must match). */
    from: string;
    subjectContains: string;
    bodyContains: string;
    hasAttachment: boolean;
    highImportance: boolean;
    sentOnlyToMe: boolean;
    /** Actions. */
    moveTo: string;
    markRead: boolean;
    flag: boolean;
    category: string;
    focus: '' | 'focused' | 'other';
    stop: boolean;
}

export interface IncomingMail {
    fromEmail: string;
    subject: string;
    excerpt: string;
    hasAttachment: boolean;
    priority: string;
    to: string[];
    cc: string[];
    recipient: string;
}

export interface Delivery { folder: string; read: boolean; flagged: boolean; category: string; focus: boolean; rules: string[]; junk: boolean }

export function ruleMatches(rule: MailRule, mail: IncomingMail): boolean {
    if (!rule.enabled) return false;
    const conditions = [rule.from, rule.subjectContains, rule.bodyContains].some(Boolean) || rule.hasAttachment || rule.highImportance || rule.sentOnlyToMe;
    if (!conditions) return false;
    const has = (text: string, part: string) => text.toLowerCase().includes(part.toLowerCase());
    if (rule.from && mail.fromEmail.toLowerCase() !== rule.from.toLowerCase()) return false;
    if (rule.subjectContains && !has(mail.subject, rule.subjectContains)) return false;
    if (rule.bodyContains && !has(mail.excerpt, rule.bodyContains)) return false;
    if (rule.hasAttachment && !mail.hasAttachment) return false;
    if (rule.highImportance && mail.priority !== 'high') return false;
    if (rule.sentOnlyToMe && !(mail.to.length === 1 && mail.to[0] === mail.recipient && !mail.cc.length)) return false;
    return true;
}

export function deliver(mail: IncomingMail, prefs: { blockedSenders: string[]; safeSenders: string[]; rules: MailRule[]; focusedInbox: boolean }, folderExists: (id: string) => boolean): Delivery {
    const from = mail.fromEmail.toLowerCase();
    const safe = prefs.safeSenders.includes(from);
    if (prefs.blockedSenders.includes(from) && !safe) return { folder: 'junk', read: false, flagged: false, category: '', focus: false, rules: [], junk: true };
    const out: Delivery = { folder: 'inbox', read: false, flagged: false, category: '', focus: true, rules: [], junk: false };
    let focus: '' | 'focused' | 'other' = '';
    for (const rule of prefs.rules) {
        if (!ruleMatches(rule, mail)) continue;
        out.rules.push(rule.id);
        if (rule.moveTo && folderExists(rule.moveTo)) out.folder = rule.moveTo;
        if (rule.markRead) out.read = true;
        if (rule.flag) out.flagged = true;
        if (rule.category) out.category = rule.category;
        if (rule.focus) focus = rule.focus;
        if (rule.stop) break;
    }
    // Focused Inbox: everything is Focused unless a rule sends it to Other (safe senders and high importance stay Focused).
    out.focus = !prefs.focusedInbox || focus !== 'other' || safe || mail.priority === 'high';
    return out;
}
