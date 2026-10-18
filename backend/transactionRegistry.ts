/**
 * Transaction Governance — phase 1 discovery registry.
 *
 * This is a READ-ONLY projection of the existing permission catalogue. It does
 * not activate transactions, grant rights, create workflows or assert that every
 * permission has a verified enforcing endpoint. Those require the endpoint audit.
 *
 * Stable canonical action IDs may be introduced later with an explicit migration
 * mapping. Never silently rename stored security permissions.
 */
import { ADM_PERMISSIONS, BUILT_PERMISSIONS } from './permissionPolicy';

export type RegistryVerification = 'catalogued_unverified' | 'enforcement_verified';
export type ApprovalClassification = 'unconfigured' | 'permission_only' | 'approval_required';

export interface DiscoveredTransactionAction {
    module: string;
    transactionKey: string;
    actionKey: string;
    /** Exact permission key currently stored by security roles. */
    legacyPermission: string;
    label: string;
    sensitive: boolean;
    /** 'manage' and old stock-take codes require explicit handler-level mapping. */
    requiresGranularReview: boolean;
    verification: RegistryVerification;
    approvalClassification: ApprovalClassification;
}

const fromModule = (module: string, entries: ReadonlyArray<{ key: string; label: string; sensitive?: boolean }>): DiscoveredTransactionAction[] =>
    entries.map(({ key, label, sensitive }) => {
        // Known module prefixes can be followed by a transaction segment and
        // operation; historically some permission keys use underscores instead.
        const segments = key.startsWith(module + '.') ? key.slice(module.length + 1).split('.') : [key];
        const transaction = segments.length > 1 ? segments[0] : 'GENERAL';
        return {
            module,
            transactionKey: module + '.' + transaction.toUpperCase(),
            actionKey: key,
            legacyPermission: key,
            label,
            sensitive: sensitive === true,
            requiresGranularReview: /\.manage$|\.admin$|\.edit$|\.create$|\.run$/.test(key) || /^INV_ST_/.test(key),
            verification: 'catalogued_unverified',
            approvalClassification: 'unconfigured',
        };
    });

/** Discovery inventory only; MUST NOT be used to authorize or activate an action. */
export function discoverTransactionActions(): DiscoveredTransactionAction[] {
    const actions = [
        ...fromModule('ADM', ADM_PERMISSIONS),
        ...Object.entries(BUILT_PERMISSIONS).flatMap(([module, entries]) => fromModule(module, entries)),
    ];
    const seen = new Set<string>();
    for (const action of actions) {
        if (seen.has(action.legacyPermission)) throw new Error('Duplicate security permission: ' + action.legacyPermission);
        seen.add(action.legacyPermission);
    }
    return actions.sort((a, b) => a.module.localeCompare(b.module) || a.legacyPermission.localeCompare(b.legacyPermission));
}

/** Group discovery rows by transaction without inventing new security grants. */
export function discoverTransactions(): Array<{ module: string; key: string; actions: DiscoveredTransactionAction[] }> {
    const grouped = new Map<string, DiscoveredTransactionAction[]>();
    for (const action of discoverTransactionActions()) {
        const actions = grouped.get(action.transactionKey) ?? [];
        actions.push(action);
        grouped.set(action.transactionKey, actions);
    }
    return [...grouped].map(([key, actions]) => ({ module: actions[0].module, key, actions }));
}
