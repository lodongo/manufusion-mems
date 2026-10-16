import {
    DOCUMENT_NAME_ROOT,
    FIRESTORE_BASE,
    HttpError,
    encodeFields,
    fieldEq,
    getDoc,
    googleRequest,
    nowIso,
    runQuery,
    str,
    type Doc,
    type Fields,
} from './core';
import type { OrgContext } from './guards';

// Organization administrators are designated people, not inherited job-role grants.
// Every administrator membership change updates the organization and affected user
// in one Firestore commit. The organization's update-time precondition serializes
// competing promotions, demotions, disabling and removals.
export const MAX_ORG_ADMINS = 3;
export const MIN_ACTIVE_ORG_ADMINS = 1;

export const isOrgAdmin = (role: string): boolean => role === 'org_super_admin' || role === 'org_admin';
const isActiveAdmin = (data: Fields) => isOrgAdmin(str(data.role)) && str(data.status) !== 'disabled';

export function adminTotals(users: Doc[]) {
    return {
        designated: users.filter((u) => isOrgAdmin(str(u.data.role))).length,
        active: users.filter((u) => isActiveAdmin(u.data)).length,
    };
}

export async function guardedAdminChange(
    ctx: OrgContext,
    change: { action: 'create' | 'update' | 'delete'; uid: string; fields?: Fields; expected?: Doc }
): Promise<void> {
    if (ctx.role !== 'org_super_admin') throw new HttpError(403, 'Only an organization super administrator may change administrator access.');
    const org = await getDoc('organizations/' + ctx.orgId);
    if (!org) throw new HttpError(404, 'Organization not found.');
    const originalCreator = str(org.data.createdBy);
    if (originalCreator && change.uid === originalCreator) {
        if (change.action === 'delete') throw new HttpError(403, 'The original organization creator cannot be deleted.');
        if (change.action === 'update' && (!isOrgAdmin(str(change.fields?.role)) || str(change.fields?.status) === 'disabled')) {
            throw new HttpError(403, 'The original creator must remain an active organization super administrator.');
        }
    }
    // Fetch the organization version BEFORE the membership list so any overlapping
    // privileged change invalidates this request rather than using a stale count.
    const users = await runQuery({
        from: [{ collectionId: 'users' }],
        where: fieldEq('orgId', ctx.orgId),
    });
    const current = users.find((user) => user.id === change.uid);
    if (change.action === 'create' ? !!current : !current || !change.expected || change.expected.updateTime !== current.updateTime) {
        throw new HttpError(409, 'The user or administrator list changed. Refresh and try again.');
    }
    if (change.action !== 'delete' && (!change.fields || typeof change.fields !== 'object')) {
        throw new HttpError(400, 'Administrator changes require user details.');
    }

    const projected = users
        .filter((u) => u.id !== change.uid)
        .map((u) => u.data);
    if (change.action === 'create') projected.push(change.fields!);
    if (change.action === 'update') projected.push({ ...current!.data, ...change.fields! });
    const designated = projected.filter((data) => isOrgAdmin(str(data.role))).length;
    const active = projected.filter(isActiveAdmin).length;
    if (designated > MAX_ORG_ADMINS) {
        throw new HttpError(409, 'An organization can have no more than three designated super administrators, including disabled accounts. Remove administrator rights from another account first.');
    }
    if (active < MIN_ACTIVE_ORG_ADMINS) {
        throw new HttpError(409, 'At least one active organization super administrator must remain.');
    }

    const docName = DOCUMENT_NAME_ROOT + '/users/' + change.uid;
    const userWrite = change.action === 'delete'
        ? { delete: docName, currentDocument: { updateTime: current!.updateTime } }
        : change.action === 'create'
            ? { update: { name: docName, fields: encodeFields(change.fields!) }, currentDocument: { exists: false } }
            : {
                update: { name: docName, fields: encodeFields(change.fields!) },
                updateMask: { fieldPaths: Object.keys(change.fields!) },
                currentDocument: { updateTime: current!.updateTime },
            };
    const res = await googleRequest(FIRESTORE_BASE + ':commit', 'POST', {
        writes: [
            {
                update: {
                    name: DOCUMENT_NAME_ROOT + '/organizations/' + ctx.orgId,
                    fields: encodeFields({ adminRosterUpdatedAt: nowIso(), adminRosterUpdatedBy: ctx.uid }),
                },
                updateMask: { fieldPaths: ['adminRosterUpdatedAt', 'adminRosterUpdatedBy'] },
                currentDocument: { updateTime: org.updateTime },
            },
            userWrite,
        ],
    });
    if (!res.ok) {
        if (res.status === 409 || res.status === 412) {
            throw new HttpError(409, 'The administrator list changed. Refresh and try again.');
        }
        if (res.status === 400) {
            const detail = await res.text();
            if (detail.includes('FAILED_PRECONDITION') || detail.includes('ABORTED')) {
                throw new HttpError(409, 'The administrator list changed. Refresh and try again.');
            }
            console.error('Administrator update was rejected', detail.slice(0, 350));
            throw new HttpError(502, 'Administrator update was rejected. No administrator rights were changed.');
        }
        console.error('Administrator transaction unavailable', res.status);
        throw new HttpError(503, 'Administrator changes are temporarily unavailable. No permissions were changed.');
    }
}
