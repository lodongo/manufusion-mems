// ---------------------------------------------------------------------------
// Automatic teams from the organization's reporting lines (pure: no I/O, shared with tests).
//
// A person's reporting line comes from active job-role assignments: assignment.positionCode in a structure
// node, and position.parentCode (the role it reports to).
//   reportees  people in a role that reports directly to one of my roles, in my node or below it
//   team       everyone below me, at any depth, in my node or below it
//   peers      people reporting to the same person as me: their role reports to the same role as mine, and
//              they sit under the same manager (the person holding that role above us); when the managing
//              role is vacant, peers are those in the same node under the same reporting role
//   managers   the people holding the role mine reports to, in my node or above it
// ---------------------------------------------------------------------------

export interface Assignment { role: string; node: string }
export interface RosterEntry { uid: string; assignments: Assignment[] }
export interface AutoTeams { reportees: string[]; team: string[]; peers: string[]; managers: string[] }
export const AUTO_TEAM_KINDS = ['reportees', 'peers', 'team'] as const;
export type AutoTeamKind = (typeof AUTO_TEAM_KINDS)[number];

/** Assignments in force today (start and end dates are inclusive, ISO yyyy-mm-dd). */
export function activeAssignments(raw: unknown, today: string): Assignment[] {
    const list = Array.isArray(raw) ? raw : [];
    return list
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && !Array.isArray(a))
        .filter((a) => String(a.positionCode ?? '') && String(a.nodeId ?? ''))
        .filter((a) => (!String(a.startsOn ?? '') || String(a.startsOn) <= today) && (!String(a.endsOn ?? '') || String(a.endsOn) >= today))
        .map((a) => ({ role: String(a.positionCode), node: String(a.nodeId) }));
}

export function computeAutoTeams(meUid: string, roster: RosterEntry[], parentOfRole: Map<string, string>, parentOfNode: Map<string, string>): AutoTeams {
    const within = (child: string, root: string) => {
        let node = child;
        for (let i = 0; i < 40 && node; i++) {
            if (node === root) return true;
            const next = parentOfNode.get(node);
            if (!next || next === node) break;
            node = next;
        }
        return false;
    };
    const depthBelow = (role: string, ancestor: string) => {
        let cursor = role;
        for (let level = 1; level <= 30; level++) {
            const next = parentOfRole.get(cursor) || '';
            if (!next || next === cursor) return 0;
            if (next === ancestor) return level;
            cursor = next;
        }
        return 0;
    };
    const me = roster.find((r) => r.uid === meUid);
    const mine = me?.assignments ?? [];
    const reportees = new Set<string>();
    const team = new Set<string>();
    const peers = new Set<string>();
    const managers = new Set<string>();
    for (const person of roster) {
        if (person.uid === meUid) continue;
        for (const a of person.assignments) {
            for (const m of mine) {
                // Below me.
                if (within(a.node, m.node)) {
                    const depth = depthBelow(a.role, m.role);
                    if (depth) team.add(person.uid);
                    if (depth === 1) reportees.add(person.uid);
                }
                // Above me: the person holding the role my role reports to.
                const myParent = parentOfRole.get(m.role) || '';
                if (myParent && a.role === myParent && within(m.node, a.node)) managers.add(person.uid);
            }
        }
    }
    // Peers report to the same person: same reporting role, under one of my managers (or my own node if vacant).
    const managerNodes = roster.filter((r) => managers.has(r.uid)).flatMap((r) => r.assignments);
    for (const person of roster) {
        if (person.uid === meUid || managers.has(person.uid)) continue;
        for (const a of person.assignments) {
            for (const m of mine) {
                const parent = parentOfRole.get(m.role) || '';
                if (!parent || parentOfRole.get(a.role) !== parent) continue;
                const bosses = managerNodes.filter((x) => x.role === parent && within(m.node, x.node));
                const sameManager = bosses.length ? bosses.some((b) => within(a.node, b.node)) : a.node === m.node;
                if (sameManager) peers.add(person.uid);
            }
        }
    }
    const sorted = (s: Set<string>) => [...s].sort();
    return { reportees: sorted(reportees), team: sorted(team), peers: sorted(peers), managers: sorted(managers) };
}

export const AUTO_TEAM_LABEL: Record<AutoTeamKind, { mine: string; theirs: (owner: string) => string; detail: string }> = {
    reportees: { mine: 'My reportees', theirs: (o) => `${o}'s reportees`, detail: 'People who report directly to you' },
    peers: { mine: 'My peers', theirs: (o) => `${o}'s peers`, detail: 'Colleagues reporting to the same person as you' },
    team: { mine: 'My extended team', theirs: (o) => `${o}'s extended team`, detail: 'Everyone in your reporting line, at every level' },
};
