/**
 * Draft material security: status gates, creator/delegate rights and maker–checker.
 * Pure policy functions shared by the list, autosave, update, submit and delete routes.
 * Workflow authorization is separate and never implied by a draft permission.
 */
export type MaterialRecord = Record<string, unknown>;
export type MaterialDraftAction = 'edit' | 'delete' | 'submit';

const idOf = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** Once the creation workflow has ever started, this document is no longer a pre-approval draft. */
export function materialApprovalNotStarted(record: MaterialRecord): boolean {
    return record.status === 'draft'
        && !idOf(record.submittedAt)
        && !idOf(record.workflowCode)
        && !record.workflowSnapshot
        && !(Array.isArray(record.approvalHistory) && record.approvalHistory.length > 0)
        && Number(record.approvalLevel ?? 0) === 0;
}

/** Creator AND anyone who has prepared or edited the material remain makers for its lifetime. */
export function materialMakerIds(record: MaterialRecord): string[] {
    const prior = Array.isArray(record.makerUids) ? record.makerUids : [];
    return [...new Set([
        ...prior.map(idOf),
        idOf(record.createdBy),
        idOf(record.updatedBy),
        idOf(record.submittedBy),
    ].filter(Boolean))];
}

export function materialDraftCan(
    record: MaterialRecord,
    uid: string,
    permissions: readonly string[],
    action: MaterialDraftAction,
    organizationSuperAdmin = false,
): boolean {
    if (!materialApprovalNotStarted(record)) return false;
    if (organizationSuperAdmin) return true;
    // Preserve the standard MEMS wildcard semantics for configured organization roles.
    const permits = (key: string): boolean => permissions.includes('*') ||
        permissions.includes(key) ||
        key.split('.').slice(0, -1).some((_, index, parts) =>
            permissions.includes(parts.slice(0, index + 1).join('.') + '.*'));
    if (permits('PRC.admin') || permits('PRC.materials.manage')) return true;
    if (permits('PRC.materials.draft.' + action + '.any')) return true;
    if (idOf(record.createdBy) !== uid) return false;
    return permits('PRC.materials.draft.' + action + '.own')
        || permits('PRC.create');
}

/** Records of approvals and rejections are never retroactively made editable by status changes. */
export function materialMakerCheckerConflict(record: MaterialRecord, uid: string): boolean {
    return materialMakerIds(record).includes(uid)
        || (Array.isArray(record.approvalHistory) && record.approvalHistory.some(
            (event) => event && typeof event === 'object' && idOf((event as Record<string, unknown>).by) === uid
        ));
}
