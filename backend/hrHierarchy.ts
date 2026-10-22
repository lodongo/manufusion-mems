/** Organization hierarchy traversal for HR reads. Deny on missing or inactive ancestors. */
export type HrNode = { level?: unknown; parentId?: unknown; status?: unknown; managerUid?: unknown };
const val = (v: unknown) => typeof v === 'string' ? v : '';
export function hrSiteOf(nodeId: string, nodes: Map<string, HrNode>): string {
  const visited = new Set<string>();
  let id = nodeId;
  while (id && !visited.has(id)) {
    visited.add(id);
    const node = nodes.get(id);
    if (!node || val(node.status) === 'inactive') return '';
    if (val(node.level) === 'site') return id;
    id = val(node.parentId);
  }
  return '';
}
/** Manager must have a primary assignment anchored at a node for which
 * the organizational structure explicitly records them as manager. */
export function managedRoots(uid: string, primaryNodeIds: string[], nodes: Map<string, HrNode>): Set<string> {
  return new Set(primaryNodeIds.filter(id => {
    const node = nodes.get(id);
    return !!node && val(node.status) !== 'inactive' && val(node.managerUid) === uid && !!hrSiteOf(id,nodes);
  }));
}
export function underManagedRoot(nodeId: string, roots: Set<string>, nodes: Map<string, HrNode>): boolean {
  const visited = new Set<string>();
  let id = nodeId;
  while (id && !visited.has(id)) {
    visited.add(id);
    const node = nodes.get(id);
    if (!node || val(node.status) === 'inactive') return false;
    if (roots.has(id)) return true;
    id = val(node.parentId);
  }
  return false;
}
