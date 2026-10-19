import { HttpError, isObj, str, type Obj } from './core';

export const rows = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
export const texts = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
export const object = (v: unknown): Obj => (isObj(v) ? v : {});
export const identifier = (v: unknown): string => {
    const id = str(v);
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new HttpError(400, 'Invalid record identifier.');
    return id;
};
export function quantity(v: unknown, allowZero = false): number {
    if (v === null || v === undefined || v === '')
        throw new HttpError(400, 'Enter the quantity explicitly, including zero where applicable.');
    const n = Number(v);
    if (!Number.isFinite(n) || n < (allowZero ? 0 : 0.001) || n > 1e6) throw new HttpError(400, 'Enter a valid quantity.');
    return Math.round(n * 1e6) / 1e6;
}
export function requiredText(v: unknown, label: string, min = 3, max = 2000): string {
    const t = str(v).trim();
    if (t.length < min || t.length > max) throw new HttpError(400, `${label}: enter ${min} to ${max} characters.`);
    return t;
}

export interface ScheduleTask {
    id: string;
    woCode: string;
    taskId: string;
    description: string;
    hours: number;
    dependencies: string[];
    offset: number;
    personnel: string[];
    tools: string[];
    executionPriority?: number;
    safety: boolean;
    status?: string;
}
export interface ScheduledTask extends ScheduleTask {
    start: number;
    finish: number;
    latestStart: number;
    float: number;
    critical: boolean;
}
/** CPM forward/backward passes on a DAG. Offsets constrain earliest starts, not priority. */
export function criticalPath(input: ScheduleTask[], windowHours = Infinity) {
    if (!input.length || input.length > 400) throw new HttpError(400, 'Schedule 1 to 400 tasks.');
    const byId = new Map(input.map((t) => [t.id, t]));
    if (byId.size !== input.length) throw new HttpError(400, 'Duplicate scheduled task.');
    const ordered: ScheduleTask[] = [],
        visiting = new Set<string>(),
        seen = new Set<string>();
    const visit = (t: ScheduleTask) => {
        if (visiting.has(t.id)) throw new HttpError(400, 'Task dependency cycle detected.');
        if (seen.has(t.id)) return;
        if (!Number.isFinite(t.hours) || t.hours <= 0 || !Number.isFinite(t.offset) || t.offset < 0)
            throw new HttpError(400, 'Task duration must be positive and start offset cannot be negative.');
        visiting.add(t.id);
        for (const id of t.dependencies) {
            const p = byId.get(id);
            if (!p) throw new HttpError(400, 'Dependency must be a selected task.');
            visit(p);
        }
        visiting.delete(t.id);
        seen.add(t.id);
        ordered.push(t);
    };
    input.forEach(visit);
    const result = new Map<string, ScheduledTask>();
    for (const t of ordered) {
        const start = Math.max(t.offset, ...t.dependencies.map((id) => result.get(id)!.finish));
        result.set(t.id, { ...t, start, finish: start + t.hours, latestStart: 0, float: 0, critical: false });
    }
    const duration = Math.max(...[...result.values()].map((t) => t.finish));
    for (const t of [...ordered].reverse()) {
        const r = result.get(t.id)!;
        const successors = [...result.values()].filter((x) => x.dependencies.includes(t.id));
        r.latestStart = (successors.length ? Math.min(...successors.map((x) => x.latestStart)) : duration) - t.hours;
        r.float = Math.max(0, r.latestStart - r.start);
        r.critical = r.float < 1e-6;
    }
    const tasks = input.map((t) => result.get(t.id)!);
    const conflicts: string[] = [];
    for (let i = 0; i < tasks.length; i++)
        for (const b of tasks.slice(i + 1)) {
            const a = tasks[i];
            if (a.start < b.finish && b.start < a.finish) {
                const shared = [...a.personnel.filter((p) => b.personnel.includes(p)), ...a.tools.filter((p) => b.tools.includes(p))];
                if (shared.length) conflicts.push(`${a.description} / ${b.description}: shared ${shared.join(', ')}`);
            }
        }
    if (duration > windowHours + 1e-6) conflicts.push('Tasks extend beyond the maintenance window.');
    return { tasks, duration, conflicts, criticalTaskIds: tasks.filter((t) => t.critical).map((t) => t.id) };
}

export function taskCompletion(task: Obj, feedback: Obj) {
    for (const key of ['workPerformed', 'findings', 'results', 'remarks']) requiredText(feedback[key], key);
    if (!str(feedback.outstandingDefects).trim() || !str(feedback.followUp).trim())
        throw new HttpError(400, 'Record outstanding defects and follow-up actions, or explicitly enter None.');
    for (const service of rows(task.services)) {
        const f = rows(feedback.services).find((x) => x.id === service.id);
        if (!f || f.accepted !== true) throw new HttpError(400, 'Every service requires accepted execution feedback.');
        for (const key of ['provider', 'scopeDelivered', 'results', 'acceptance', 'completedAt', 'outstandingIssues'])
            requiredText(f[key], `Service ${key}`);
        if (!Number.isFinite(Date.parse(str(f.completedAt)))) throw new HttpError(400, 'Enter the service completion date.');
    }
}
export function reconcileQuantities(issued: number, consumed: unknown, returned: unknown) {
    const actual = quantity(consumed, true),
        unused = quantity(returned, true);
    if (Math.abs(actual + unused - issued) > 1e-6)
        throw new HttpError(409, 'Actual consumption plus returned quantity must equal the quantity issued.');
    return { consumed: actual, returned: unused };
}
export function safetyDeclaration(body: Obj) {
    if (body.declaration === 'none') {
        if (body.noIncidentsConfirmed !== true)
            throw new HttpError(400, 'Explicitly confirm: No safety incidents or near misses occurred during this maintenance activity.');
    } else if (body.declaration === 'reported') {
        for (const k of ['classification', 'narrative', 'occurredAt', 'immediateControls', 'incidentId'])
            requiredText(body[k], `Incident ${k}`);
        if (!Number.isFinite(Date.parse(str(body.occurredAt)))) throw new HttpError(400, 'Enter the incident date and time.');
        if (body.clearanceConfirmed !== true) throw new HttpError(409, 'Incident containment and safety clearance are required.');
    } else throw new HttpError(400, 'Choose an explicit incident or no-incident declaration.');
}
export function closurePrerequisites(wo: Obj) {
    const tasks = rows(wo.assessmentTasks),
        execution = object(wo.taskExecution);
    if (!tasks.length) throw new HttpError(409, 'Complete the task assessment first.');
    for (const t of tasks) {
        const e = object(execution[str(t.id)]);
        if (e.status !== 'completed') throw new HttpError(409, `Complete task: ${str(t.description)}.`);
        taskCompletion(t, object(e.feedback));
        if (e.reconciled !== true) throw new HttpError(409, 'Reconcile actual spares and BOM for every task.');
    }
    if (!object(wo.safetySignoff).at) throw new HttpError(409, 'Safety sign-off is required.');
    if (!object(wo.handover).at || object(wo.handover).accepted !== true)
        throw new HttpError(409, 'Accepted equipment handover is required.');
    if (!wo.windowId) throw new HttpError(409, 'An approved maintenance window is required.');
}
