/** Pure validation of inherited document applicability. */
export type Location = { id: string; level: string; parentId: string; status: string };
const parentTypes: Record<string, string[]> = {
  legal_entity: ['group'],
  site: ['legal_entity'],
  department: ['site'],
  cost_center: ['department'],
};
export function validateDocumentLocation(id: string, nodes: Location[]): string[] {
  const byId = new Map(nodes.map(n => [n.id,n]));
  const visited = new Set<string>();
  const chain: string[] = [];
  let node = byId.get(id);
  if (!node || !parentTypes[node.level]) throw new Error('Choose a valid document location.');
  while(node) {
    if(visited.has(node.id)) throw new Error('Organization hierarchy contains a cycle.');
    if(node.status === 'inactive') throw new Error('Inactive location in organization hierarchy.');
    visited.add(node.id); chain.unshift(node.id);
    if(!node.parentId || node.parentId === 'root'){
      if(node.level !== 'legal_entity' && node.level !== 'group') throw new Error('Required parent location is missing.');
      break;
    }
    const parent = byId.get(node.parentId);
    if(!parent) throw new Error('Parent location does not exist.');
    if(parentTypes[node.level] && !parentTypes[node.level].includes(parent.level)) throw new Error('Incorrect parent location type.');
    node=parent;
  }
  return chain;
}
