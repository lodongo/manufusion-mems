// ---------------------------------------------------------------------------
// Workflow actions engine (rules in workflowActionsCore.ts, one adapter per workflow in workflowAdapters.ts).
//
// Who must act is never guessed: each adapter asks the module's own "may this person act now" rule, evaluated for every
// active employee with their real security roles, job roles, locations and work groups. The engine
//   - creates the action and delivers it once (deterministic id) as internal email, To-do / action tracker and chat;
//   - closes it, everywhere, only when the record has moved past that step in its module;
//   - keeps open emails unread and undeletable, and the To-do impossible to close by hand;
//   - in test mode (platform testing override on for the organization) sends every new action to the organization
//     super admin(s) instead of the people who would normally act (they are recorded on the action).
// Triggers: after every successful change made through an organization route of a workflow module (hook in orgRoute),
// and a sweep every 15 minutes (automation job wf.actions-sweep) for changes made by automations. Every creation,
// delivery and closing is audited.
// ---------------------------------------------------------------------------
import { HttpError, encodeValue, fieldEq, getDoc, isObj, listDocs, nowIso, runQuery, str, updateFields, writeDoc, type Doc } from './core';
import { effectiveAccess, hasPerm, normalizeOrgRole, orgRoute, type OrgContext } from './guards';
import { audit } from './audit';
import { canAt, nodePath, type Scope } from './access';
import { allowedNodeIds } from './positions';
import { orgUsers } from './org';
import { testModeActiveFor } from './testModeCore';
import {
    SYSTEM_NAME, SYSTEM_UID, actionIdOf, chatClosedText, chatMessageIdOf, chatOpenText, chooseRecipients, mailHtml, mailIdOf, outcomeOf, planFor, roomIdOf, taskIdOf,
    type Candidate, type OpenTask, type TaskView,
} from './workflowActionsCore';

type Obj = Record<string, unknown>;
const TASKS = (o: string) => `organizations/${o}/workflow_tasks`;
const MAIL = (o: string, uid: string) => `organizations/${o}/mailboxes/${uid}/items`;
const ACTIONS = (o: string) => `organizations/${o}/chat_actions`;
const ROOMS = (o: string) => `organizations/${o}/chat_rooms`;

// ----- People who could act -----

export interface Person { uid: string; user: Doc; ctx: OrgContext; superAdmin: boolean; name: string; email: string }
const nameOf = (u: Doc) => [str(u.data.firstName), str(u.data.lastName)].filter(Boolean).join(' ') || str(u.data.displayName) || str(u.data.email) || u.id;
const peopleCache = new Map<string, { at: number; people: Person[] }>();
/** Every active employee with a context built from their own access (as if they had signed in). Cached for a minute. */
async function peopleOf(orgId: string, org: Doc, base: Partial<OrgContext>): Promise<Person[]> {
    const hit = peopleCache.get(orgId);
    if (hit && Date.now() - hit.at < 60_000) return hit.people;
    const users = (await orgUsers(orgId)).filter((u) => str(u.data.orgId) === orgId && !['disabled', 'inactive', 'suspended', 'deleted'].includes(str(u.data.status)) && str(u.data.role) !== 'applicant');
    const people: Person[] = [];
    for (let i = 0; i < users.length; i += 10) {
        const batch = await Promise.all(
            users.slice(i, i + 10).map(async (u) => {
                try {
                    const role = normalizeOrgRole(str(u.data.role));
                    const access = await effectiveAccess(orgId, role, u, org.data.modules);
                    const ctx = {
                        ...base, uid: u.id, me: u, org, orgId, role, roleName: access.roleName, permissions: access.permissions, directPermissions: access.directPermissions,
                        grants: access.grants, workGroupPolicy: access.workGroupPolicy, testMode: false, bypassed: [], body: {},
                        actor: { uid: u.id, email: str(u.data.email), role, orgId },
                    } as unknown as OrgContext;
                    return { uid: u.id, user: u, ctx, superAdmin: role === 'org_super_admin', name: nameOf(u), email: str(u.data.email).toLowerCase() } as Person;
                } catch {
                    return null;
                }
            })
        );
        people.push(...batch.filter((p): p is Person => !!p));
    }
    peopleCache.set(orgId, { at: Date.now(), people });
    return people;
}

export interface Env {
    orgId: string;
    org: Doc;
    base: OrgContext;
    people: Person[];
    byUid: Map<string, Person>;
    superAdmins: string[];
    memo: Map<string, unknown>;
    /** Everyone for whom `rule` holds (rules may be async). */
    who(rule: (p: Person) => boolean | Promise<boolean>): Promise<Candidate[]>;
    /** Holds `perm` anywhere (security role or job role). */
    holds(p: Person, perm: string): boolean;
    /** Holds `perm` at a place (organization unit, cost centre, warehouse) the way the module checks it. */
    at(p: Person, perm: string, nodeId: string): Promise<boolean>;
    /** Holders of a job role (position); TEST_MODE steps go to the organization super admins. */
    positionHolders(code: string): Candidate[];
    uids(...ids: string[]): Candidate[];
}
async function envFor(orgId: string, org: Doc, base: OrgContext): Promise<Env> {
    const people = await peopleOf(orgId, org, base);
    const byUid = new Map(people.map((p) => [p.uid, p]));
    const memo = new Map<string, unknown>();
    const scopes = new Map<string, Promise<Scope>>();
    const scopeOf = (p: Person) => {
        if (!scopes.has(p.uid)) scopes.set(p.uid, p.superAdmin ? Promise.resolve('all' as const) : allowedNodeIds(orgId, p.user).catch(() => new Set<string>()));
        return scopes.get(p.uid)!;
    };
    const pathOf = (nodeId: string) => {
        const k = `path:${nodeId}`;
        if (!memo.has(k)) memo.set(k, nodePath(orgId, nodeId).catch(() => []));
        return memo.get(k) as Promise<string[]>;
    };
    const { myPositions } = await import('./purchaseOrders');
    const env: Env = {
        orgId, org, base, people, byUid, memo,
        superAdmins: people.filter((p) => p.superAdmin).map((p) => p.uid),
        async who(rule) {
            const out: Candidate[] = [];
            for (let i = 0; i < people.length; i += 15) {
                const res = await Promise.all(people.slice(i, i + 15).map(async (p) => { try { return await rule(p); } catch { return false; } }));
                res.forEach((ok, j) => ok && out.push({ uid: people[i + j].uid, superAdmin: people[i + j].superAdmin }));
            }
            return out;
        },
        holds: (p, perm) => p.superAdmin || hasPerm(p.ctx.permissions, perm),
        async at(p, perm, nodeId) {
            if (p.superAdmin) return true;
            if (!nodeId) return false;
            const [path, scope] = await Promise.all([pathOf(nodeId), scopeOf(p)]);
            if (path.length && path[path.length - 1] === nodeId) return canAt(p.ctx, perm, path, scope);
            // A place outside the organization design (a warehouse record): the right must be held and the place in scope.
            return hasPerm(p.ctx.permissions, perm) && (scope === 'all' || scope.has(nodeId));
        },
        positionHolders(code) {
            if (!code) return [];
            if (code === 'TEST_MODE') return people.filter((p) => p.superAdmin).map((p) => ({ uid: p.uid, superAdmin: true }));
            return people.filter((p) => myPositions(p.user).includes(code)).map((p) => ({ uid: p.uid, superAdmin: p.superAdmin }));
        },
        uids: (...ids) => ids.filter((u) => byUid.has(u)).map((u) => ({ uid: u, superAdmin: byUid.get(u)!.superAdmin })),
    };
    return env;
}

// ----- Adapters -----

export interface Stage {
    /** Changes whenever the step changes (include the cycle: submission time, level, version). */
    key: string;
    label: string;
    /** Who must act now; evaluated only when the action is created or (in a sweep) re-checked. */
    eligible: () => Promise<Candidate[]>;
    details?: Array<{ label: string; value: string }>;
    link?: string;
    linkLabel?: string;
}
export interface Adapter {
    key: string;
    module: string;
    label: string;
    collection: (orgId: string) => string;
    /** Live records: status values (queried), or a filter over the whole collection. */
    statuses?: string[];
    statusField?: string;
    live?: (d: Obj) => boolean;
    /** Route names that can change these records. */
    routes: RegExp;
    link: string;
    linkLabel: string;
    ref: (id: string, d: Obj) => string;
    title: (id: string, d: Obj) => string;
    stage: (env: Env, id: string, d: Obj) => Promise<Stage | null>;
    /** Who did it, for the closing note. */
    by?: (d: Obj) => string;
}

async function liveRecords(orgId: string, a: Adapter): Promise<Map<string, Doc>> {
    const out = new Map<string, Doc>();
    if (a.statuses?.length) {
        const field = a.statusField ?? 'status';
        const coll = a.collection(orgId);
        const parent = coll.slice(0, coll.lastIndexOf('/'));
        const collectionId = coll.slice(coll.lastIndexOf('/') + 1);
        for (const s of a.statuses) {
            const docs = await runQuery({ from: [{ collectionId }], where: fieldEq(field, s) }, parent).catch(() => [] as Doc[]);
            for (const d of docs) if (!a.live || a.live(d.data)) out.set(d.id, d);
        }
    } else {
        for (const d of await listDocs(a.collection(orgId)).catch(() => [] as Doc[])) if (!a.live || a.live(d.data)) out.set(d.id, d);
    }
    return out;
}
async function openTasksOf(orgId: string, adapter: string): Promise<Doc[]> {
    return runQuery({ from: [{ collectionId: 'workflow_tasks' }], where: { compositeFilter: { op: 'AND', filters: [fieldEq('adapter', adapter), fieldEq('status', 'open')] } } }, `organizations/${orgId}`).catch(() => [] as Doc[]);
}
const fieldOf = (d: Obj, path: string) => path.split('.').reduce<unknown>((v, k) => (isObj(v) ? v[k] : undefined), d);

// ----- Delivery -----

const systemActor = (orgId: string) => ({ uid: SYSTEM_UID, email: 'workflow@mems.local', role: 'system', orgId });
async function auditTask(env: Env, action: string, taskId: string, label: string, details: string) {
    await audit([{ category: 'workflow', action: `workflow.action.${action}`, actor: env.base.actor?.uid ? env.base.actor : systemActor(env.orgId), meta: env.base.meta ?? null, orgId: env.orgId, target: { type: 'workflow_action', id: taskId, label: label.slice(0, 160) }, details: details.slice(0, 1500) }]).catch(() => undefined);
}

async function ensureRoom(env: Env, uid: string) {
    const id = roomIdOf(uid);
    const path = `${ROOMS(env.orgId)}/${id}`;
    const room = await getDoc(path);
    if (room) {
        // The person left the room: put them back, it is how their workflow actions reach them in chat.
        if (!(Array.isArray(room.data.members) ? room.data.members.map(str) : []).includes(uid)) await updateFields(path, { members: [uid], updatedAt: nowIso() });
        return room;
    }
    const now = nowIso();
    await writeDoc(path, { kind: 'group', title: 'Workflow actions', description: 'Actions waiting for you in MEMS. Each closes automatically when its step is completed in its module.', members: [uid], admins: [], pendingInvites: [], createdBy: SYSTEM_UID, sendPolicy: 'admins', infoPolicy: 'admins', workflowRoom: true, ownerUid: uid, openActions: 0, createdAt: now, updatedAt: now, lastMessage: '', lastSenderUid: '', lastMessageId: '', lastMessageAt: '' }, { exists: false });
    return getDoc(path);
}
async function chatPost(env: Env, uid: string, messageId: string, text: string, taskId: string, status: 'open' | 'closed', delta: number) {
    try {
        const room = await ensureRoom(env, uid);
        if (!room) return;
        const now = nowIso();
        const wrote = await writeDoc(`${ROOMS(env.orgId)}/${room.id}/messages/${messageId}`, { senderUid: SYSTEM_UID, text, systemUpdate: true, workflowTaskId: taskId, workflowStatus: status, replyTo: '', attachment: {}, reactions: {}, deletedForAll: false, createdAt: now, deletedAt: '' }, { exists: false });
        if (!wrote) return;
        const open = Math.max(0, (Number(room.data.openActions) || 0) + delta);
        await updateFields(`${ROOMS(env.orgId)}/${room.id}`, { lastMessage: text.slice(0, 100), lastSenderUid: SYSTEM_UID, lastMessageId: messageId, lastMessageAt: now, updatedAt: now, openActions: open, title: open ? `Workflow actions · ${open} open` : 'Workflow actions' });
        const { notifyRoom } = await import('./chatCommon');
        await notifyRoom(env.base, room, { event: 'message' }).catch(() => undefined);
    } catch (e) {
        console.error('Workflow chat delivery failed', e instanceof Error ? e.message : 'unknown');
    }
}

interface TaskDoc extends Obj {
    adapter: string; module: string; label: string; refId: string; ref: string; title: string; stageKey: string; stageLabel: string; link: string; linkLabel: string;
    status: 'open' | 'closed'; recipients: string[]; intended: string[]; testMode: boolean; details: Array<{ label: string; value: string }>; recordStatus: string;
    createdAt: string; updatedAt: string; closedAt: string; outcome: string; withdrawn: string[];
}
const view = (t: TaskDoc, env: Env): TaskView => ({ module: t.module, label: t.label, ref: t.ref, title: t.title, stageLabel: t.stageLabel, link: t.link, linkLabel: t.linkLabel, createdAt: t.createdAt, testMode: t.testMode, intendedNames: t.intended.map((u) => env.byUid.get(u)?.name ?? u).slice(0, 5), details: t.details });

/** Record type of each workflow adapter, for the live record reference (see recordSearch.ts). */
const RECORD_TYPE: Record<string, string> = { 'prc.requirement': 'PR', 'prc.order': 'PO', 'prc.requisition': 'PRQ', 'prc.vendor': 'VEN', 'fin.ap_invoice': 'INV', 'mnt.wr': 'WR', 'mnt.wo': 'WO', 'inv.material_creation': 'MAT', 'inv.stock_take': 'PI', 'inv.stock_adjustment': 'ADJ', 'ast.asset': 'AST', 'pln.plan': 'SOP', 'pln.requirement': 'CMR' };
export const recordTokenFor = (adapter: string, refId: string) => (RECORD_TYPE[adapter] && /^[A-Za-z0-9_.-]{1,100}$/.test(refId) ? `[[${RECORD_TYPE[adapter]}:${refId}]]` : '');
async function deliver(env: Env, id: string, t: TaskDoc, uids: string[]) {
    const now = nowIso();
    const v = view(t, env);
    // To-do / action tracker: one action with an assignment per recipient (accepted; it cannot be declined or closed by hand).
    const actionPath = `${ACTIONS(env.orgId)}/${actionIdOf(id)}`;
    const action = await getDoc(actionPath);
    // The record itself as a live reference: email, To-do and chat show its current status with an Open button.
    const token = recordTokenFor(t.adapter, t.refId);
    const description = `${t.module} · ${t.label}\nReference ${t.ref}${token ? ` ${token}` : ''}\nYour step: ${t.stageLabel}\nComplete it in ${t.linkLabel}; this closes automatically when the step is done.`;
    if (!action) {
        await writeDoc(actionPath, { kind: 'monitored_action', source: 'workflow', sourceId: id, header: t.title, body: description, title: t.title, description, requesterUid: SYSTEM_UID, recipientUids: t.recipients, deadline: '', photoPath: '', mailThreadId: '', mailSubject: '', referenceId: t.ref, roomId: '', createdAt: now, updatedAt: now, canceled: false, workflowTaskId: id, workflowStatus: 'open', workflowLink: t.link, workflowLinkLabel: t.linkLabel, workflowModule: t.module, workflowStage: t.stageLabel, workflowOutcome: '' }, { exists: false });
    } else await updateFields(actionPath, { recipientUids: [...new Set([...(Array.isArray(action.data.recipientUids) ? action.data.recipientUids.map(str) : []), ...uids])], updatedAt: now });
    for (const uid of uids) {
        const p = env.byUid.get(uid);
        if (!p) continue;
        await writeDoc(`${actionPath}/assignments/${uid}`, { decision: 'accepted', status: 'open', reviewNote: '', progressNotes: [], updatedAt: now, acceptedAt: now, closedAt: '', acknowledgedAt: '', acknowledgementNote: '', workflow: true }).catch(() => undefined);
        // Internal email: stays unread and cannot be deleted while the action is open.
        await writeDoc(`${MAIL(env.orgId, uid)}/${mailIdOf(id, uid)}`, {
            fromUid: SYSTEM_UID, fromName: SYSTEM_NAME, fromEmail: 'workflow@mems.local', to: [p.email], cc: [], bcc: [],
            subject: `Action required: ${t.title}`.slice(0, 200), html: mailHtml(v) + (token ? `<p>Record: ${token}</p>` : ''), excerpt: `${t.module} · ${t.ref} · ${t.stageLabel}`.slice(0, 250), attachments: [], priority: 'high',
            threadId: id, inReplyTo: '', actionId: actionIdOf(id), sentAt: now, updatedAt: now, starred: false, flagged: true, focus: true, category: 'Action',
            allowReply: false, allowReplyAll: false, allowDelete: false, folder: 'inbox', read: false,
            workflowTaskId: id, workflowStatus: 'open', workflowLink: t.link, workflowLinkLabel: t.linkLabel, workflowModule: t.module, workflowRef: t.ref, workflowStage: t.stageLabel, workflowOutcome: '',
        }, { exists: false }).catch(() => undefined);
        await chatPost(env, uid, chatMessageIdOf(id, uid, 'open'), chatOpenText(v) + (token ? `\n${token}` : ''), id, 'open', +1);
    }
}

async function withdrawFrom(env: Env, id: string, t: TaskDoc, uids: string[], outcome: string) {
    const now = nowIso();
    for (const uid of uids) {
        const a = await getDoc(`${ACTIONS(env.orgId)}/${actionIdOf(id)}/assignments/${uid}`);
        if (a && !str(a.data.acknowledgedAt)) await updateFields(`${ACTIONS(env.orgId)}/${actionIdOf(id)}/assignments/${uid}`, { status: 'closed', closedAt: now, acknowledgedAt: now, acknowledgementNote: outcome, updatedAt: now });
        const m = await getDoc(`${MAIL(env.orgId, uid)}/${mailIdOf(id, uid)}`);
        if (m && str(m.data.workflowStatus) === 'open') await updateFields(`${MAIL(env.orgId, uid)}/${mailIdOf(id, uid)}`, { workflowStatus: 'closed', workflowOutcome: outcome, workflowClosedAt: now, allowDelete: true, read: true, flagged: false, updatedAt: now });
        await chatPost(env, uid, chatMessageIdOf(id, uid, 'closed'), chatClosedText(t, outcome), id, 'closed', -1);
    }
}

async function closeTask(env: Env, doc: Doc, outcome: string) {
    const t = doc.data as TaskDoc;
    const now = nowIso();
    if (!(await writeDoc(`${TASKS(env.orgId)}/${doc.id}`, { ...t, status: 'closed', closedAt: now, updatedAt: now, outcome }, { updateTime: doc.updateTime }))) return;
    await withdrawFrom(env, doc.id, t, t.recipients.filter((u) => !(t.withdrawn ?? []).includes(u)), outcome);
    await updateFields(`${ACTIONS(env.orgId)}/${actionIdOf(doc.id)}`, { workflowStatus: 'closed', workflowOutcome: outcome, updatedAt: now }).catch(() => undefined);
    await auditTask(env, 'closed', doc.id, `${t.module} ${t.ref}: ${t.stageLabel}`, outcome);
}

// ----- Reconciliation -----

async function reconcileAdapter(env: Env, a: Adapter, recheck: boolean, deadline: number, opts: { first?: Set<string>; maxCreate?: number } = {}) {
    const [live, open] = await Promise.all([liveRecords(env.orgId, a), openTasksOf(env.orgId, a.key)]);
    const byRef = new Map<string, Doc[]>();
    for (const t of open) (byRef.get(str(t.data.refId)) ?? byRef.set(str(t.data.refId), []).get(str(t.data.refId))!).push(t);
    // Records named in the request first, so the one just changed is handled within the time box.
    const ids = [...new Set([...live.keys(), ...byRef.keys()])].sort((x, y) => Number(opts.first?.has(y) ?? false) - Number(opts.first?.has(x) ?? false));
    let created = 0;
    let closed = 0;
    const testMode = await testModeActiveFor(env.orgId).catch(() => false);
    for (const id of ids) {
        if (Date.now() > deadline) break;
        const tasks = byRef.get(id) ?? [];
        // A backlog (records waiting since before an action existed) is left to the sweep, outside requests.
        if (opts.maxCreate !== undefined && created >= opts.maxCreate && !tasks.length) continue;
        let doc = live.get(id) ?? null;
        const isLive = !!doc;
        if (!doc && tasks.length) doc = await getDoc(`${a.collection(env.orgId)}/${id}`);
        let stage: Stage | null = null;
        try {
            stage = isLive && doc ? await a.stage(env, id, doc.data) : null;
        } catch (e) {
            console.error(`Workflow adapter ${a.key} failed for ${id}`, e instanceof Error ? e.message : 'unknown');
            continue;
        }
        const openTasks: OpenTask[] = tasks.map((t) => ({ id: t.id, stageKey: str(t.data.stageKey), recipients: Array.isArray(t.data.recipients) ? t.data.recipients.map(str) : [], testMode: t.data.testMode === true }));
        const keep = stage ? openTasks.find((t) => t.stageKey === stage!.key) : undefined;
        // Eligibility is evaluated when the action is created, and on sweeps to follow role changes (outside test mode).
        const needPeople = !!stage && (!keep || (recheck && !keep.testMode));
        const chosen = needPeople ? chooseRecipients(await stage!.eligible(), testMode, env.superAdmins) : null;
        const plan = planFor(stage && chosen ? { key: stage.key, label: stage.label, recipients: chosen.recipients } : stage ? { key: stage.key, label: stage.label, recipients: keep?.recipients ?? [] } : null, openTasks, !!doc);
        const status = str(doc?.data ? fieldOf(doc.data, a.statusField ?? 'status') : '');
        for (const c of plan.close) {
            const t = tasks.find((x) => x.id === c.id)!;
            const by = doc && a.by ? a.by(doc.data) : '';
            await closeTask(env, t, outcomeOf(str(t.data.recordStatus), status, c.reason !== 'withdrawn', by));
            closed++;
        }
        if (plan.create && stage && chosen) {
            const now = nowIso();
            const d = doc!.data;
            const task: TaskDoc = {
                adapter: a.key, module: a.module, label: a.label, refId: id, ref: a.ref(id, d), title: a.title(id, d), stageKey: stage.key, stageLabel: stage.label,
                link: stage.link ?? a.link, linkLabel: stage.linkLabel ?? a.linkLabel, status: 'open', recipients: chosen.recipients, intended: chosen.intended, testMode: chosen.testMode,
                details: stage.details ?? [], recordStatus: status, createdAt: now, updatedAt: now, closedAt: '', outcome: '', withdrawn: [],
            };
            let tid = taskIdOf(a.key, id, stage.key);
            let ok = await writeDoc(`${TASKS(env.orgId)}/${tid}`, task, { exists: false });
            if (!ok) {
                // Same record and step closed earlier (a returned item came back to the same step): a new cycle gets a new id.
                const prior = await getDoc(`${TASKS(env.orgId)}/${tid}`);
                if (prior && str(prior.data.status) === 'closed') {
                    tid = taskIdOf(a.key, id, `${stage.key}#${prior.data.closedAt}`);
                    ok = await writeDoc(`${TASKS(env.orgId)}/${tid}`, task, { exists: false });
                }
            }
            if (ok) {
                await deliver(env, tid, task, task.recipients);
                await auditTask(env, 'created', tid, `${task.module} ${task.ref}: ${task.stageLabel}`, `Recipients: ${task.recipients.map((u) => env.byUid.get(u)?.name ?? u).join(', ')}${task.testMode ? ` (test mode; normally ${task.intended.map((u) => env.byUid.get(u)?.name ?? u).join(', ') || 'nobody eligible'})` : ''}`);
                created++;
            }
        }
        if (plan.keep && (plan.add.length || plan.remove.length)) {
            const t = tasks.find((x) => x.id === plan.keep)!;
            const td = t.data as TaskDoc;
            const recipients = [...new Set([...td.recipients.filter((u) => !plan.remove.includes(u)), ...plan.add])];
            const withdrawn = [...new Set([...(td.withdrawn ?? []), ...plan.remove])].filter((u) => !plan.add.includes(u));
            if (await writeDoc(`${TASKS(env.orgId)}/${t.id}`, { ...td, recipients, withdrawn, updatedAt: nowIso() }, { updateTime: t.updateTime })) {
                if (plan.add.length) await deliver(env, t.id, { ...td, recipients }, plan.add);
                if (plan.remove.length) await withdrawFrom(env, t.id, td, plan.remove, 'Closed for you: you are no longer the person who must act on this step.');
                await auditTask(env, 'reassigned', t.id, `${td.module} ${td.ref}: ${td.stageLabel}`, `Added ${plan.add.join(', ') || '-'}; removed ${plan.remove.join(', ') || '-'}`);
            }
        }
    }
    return { created, closed };
}

const READ_ONLY = /\.(list|get|view|search|status|options|summary|context|references|preview|position|dashboard|describe|passed|inbox|my|mine|people|history|analytics|overview|report|lookup|calendar|subscribe|unsubscribe|read|trace|export|download|templates?)$/;
/** Base context for runs without a signed-in person (the sweep): the first active organization super admin. */
async function systemBase(orgId: string, org: Doc): Promise<OrgContext | null> {
    const users = await orgUsers(orgId);
    const admin = users.find((u) => normalizeOrgRole(str(u.data.role)) === 'org_super_admin' && str(u.data.status) !== 'disabled');
    if (!admin) return null;
    const access = await effectiveAccess(orgId, 'org_super_admin', admin, org.data.modules);
    return { uid: admin.id, me: admin, org, orgId, role: 'org_super_admin', roleName: access.roleName, permissions: access.permissions, directPermissions: access.directPermissions, grants: access.grants, workGroupPolicy: access.workGroupPolicy, testMode: false, bypassed: [], body: {}, actor: systemActor(orgId), meta: null, domain: '' } as unknown as OrgContext;
}

/** Called by orgRoute after a successful change: reconciles the workflows that route can touch (time-boxed). */
export async function syncWorkflowActions(ctx: OrgContext, routeName: string): Promise<void> {
    if (READ_ONLY.test(routeName) || routeName.startsWith('org.workflow.actions') || routeName.startsWith('chat.') || routeName.startsWith('mail.') || routeName.startsWith('actions.')) return;
    const { ADAPTERS } = await import('./workflowAdapters');
    const touched = ADAPTERS.filter((a) => a.routes.test(routeName));
    if (!touched.length) return;
    const deadline = Date.now() + 4_000;
    const first = new Set<string>();
    for (const v of Object.values(ctx.body ?? {})) if (typeof v === 'string' && v.length <= 120) first.add(v);
    const run = (async () => {
        const env = await envFor(ctx.orgId, ctx.org, ctx);
        for (const a of touched) {
            if (Date.now() > deadline) break;
            try {
                await reconcileAdapter(env, a, false, deadline, { first, maxCreate: 6 });
            } catch (e) {
                console.error(`Workflow actions for ${a.key} not reconciled`, e instanceof Error ? e.message : 'unknown');
            }
        }
    })();
    await Promise.race([run.catch(() => undefined), new Promise((r) => setTimeout(r, 4_500))]);
}

/** Full reconciliation of one organization (sweep and the administrator's "reconcile now"). */
export async function sweepOrganization(orgId: string, deadline: number, base?: OrgContext) {
    const org = base?.org ?? (await getDoc(`organizations/${orgId}`));
    if (!org) return { created: 0, closed: 0, adapters: 0 };
    const ctx = base ?? (await systemBase(orgId, org));
    if (!ctx) return { created: 0, closed: 0, adapters: 0 };
    const { ADAPTERS } = await import('./workflowAdapters');
    peopleCache.delete(orgId);
    const env = await envFor(orgId, org, ctx);
    const total = { created: 0, closed: 0, adapters: 0 };
    for (const a of ADAPTERS) {
        if (Date.now() > deadline) break;
        try {
            const r = await reconcileAdapter(env, a, true, deadline);
            total.created += r.created;
            total.closed += r.closed;
            total.adapters++;
        } catch (e) {
            console.error(`Workflow sweep ${a.key} failed in ${orgId}`, e instanceof Error ? e.message : 'unknown');
        }
    }
    return total;
}

/** The automation job: every organization, resumable by organization cursor. */
export async function sweepAll(deadline: number, cursor: string) {
    const orgs = (await listDocs('organizations')).filter((o) => !['suspended', 'pending_approval', 'rejected'].includes(str(o.data.status))).map((o) => o.id).sort();
    const todo = cursor ? orgs.filter((id) => id >= cursor) : orgs;
    const total = { organizations: 0, created: 0, closed: 0 };
    let next = '';
    for (const orgId of todo) {
        if (Date.now() > deadline - 5_000) {
            next = orgId;
            break;
        }
        const r = await sweepOrganization(orgId, deadline - 5_000);
        total.organizations++;
        total.created += r.created;
        total.closed += r.closed;
    }
    return { ...total, next };
}

// ----- Routes -----

const taskOut = (d: Doc, env?: { names: Map<string, string> }) => {
    const t = d.data as TaskDoc;
    return {
        id: d.id, adapter: t.adapter, module: t.module, label: t.label, ref: t.ref, title: t.title, stage: t.stageLabel, link: t.link, linkLabel: t.linkLabel,
        status: t.status, createdAt: t.createdAt, closedAt: t.closedAt, outcome: t.outcome, testMode: t.testMode === true,
        recipients: (t.recipients ?? []).map((u) => ({ uid: u, name: env?.names.get(u) ?? '', withdrawn: (t.withdrawn ?? []).includes(u) })),
        intended: (t.intended ?? []).map((u) => ({ uid: u, name: env?.names.get(u) ?? '' })),
        ageHours: Math.round(((t.status === 'open' ? Date.now() : Date.parse(t.closedAt) || Date.now()) - (Date.parse(t.createdAt) || Date.now())) / 3_600_000),
    };
};
async function names(orgId: string) {
    return new Map((await orgUsers(orgId)).map((u) => [u.id, nameOf(u)]));
}

export const workflowActionRoutes = {
    // My workflow actions (open first, then closed in the last 90 days).
    'POST /api/org/workflow/actions/mine': [
        orgRoute('org.workflow.actions.mine', null, async (ctx) => {
            const docs = await runQuery({ from: [{ collectionId: 'workflow_tasks' }], where: { fieldFilter: { field: { fieldPath: 'recipients' }, op: 'ARRAY_CONTAINS', value: encodeValue(ctx.uid) } } }, `organizations/${ctx.orgId}`);
            const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
            const rows = docs.filter((d) => str(d.data.status) === 'open' || str(d.data.closedAt) >= since).filter((d) => !(Array.isArray(d.data.withdrawn) && d.data.withdrawn.map(str).includes(ctx.uid) && str(d.data.status) === 'open'));
            const n = await names(ctx.orgId);
            const canManage = ctx.role === 'org_super_admin' || hasPerm(ctx.directPermissions, 'ADM.workflows');
            return { canManage, actions: rows.map((d) => taskOut(d, { names: n })).sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'open' ? -1 : 1)) };
        }),
    ],
    // Organization tracker of every workflow action (administrators of workflows and the audit).
    'POST /api/org/workflow/actions/all': [
        orgRoute('org.workflow.actions.all', 'ADM.workflows', async (ctx) => {
            const docs = await listDocs(TASKS(ctx.orgId));
            const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
            const n = await names(ctx.orgId);
            return { actions: docs.filter((d) => str(d.data.status) === 'open' || str(d.data.closedAt) >= since).map((d) => taskOut(d, { names: n })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2000) };
        }),
    ],
    // Reconcile now (after changing roles or the chart of authority): creates missing actions and closes finished ones.
    'POST /api/org/workflow/actions/reconcile': [
        orgRoute('org.workflow.actions.reconcile', 'ADM.workflows', async (ctx) => {
            const r = await sweepOrganization(ctx.orgId, Date.now() + 50_000, ctx);
            await audit([{ category: 'workflow', action: 'workflow.action.reconcile', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { type: 'organization', id: ctx.orgId }, details: `Created ${r.created}, closed ${r.closed} across ${r.adapters} workflows` }]);
            return r;
        }),
    ],
};

/** Mail and to-do rules shared with mail.ts and actionHub.ts. */
export const isOpenWorkflowItem = (d: Obj) => str(d.workflowStatus) === 'open';
export const isWorkflowAction = (d: Obj) => str(d.source) === 'workflow';
export function refuseManualWorkflowChange(d: Obj) {
    if (isWorkflowAction(d)) throw new HttpError(409, `This is a workflow action. It closes automatically when the step is completed in ${str(d.workflowLinkLabel) || 'its module'}.`);
}
