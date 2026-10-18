import type { PermGroup } from './permissionPolicy';
import { ROLE_TEMPLATES, sodConflicts } from './permissionPolicy';

/** Curated, transaction-accurate built-in templates. Never infer permissions from a label:
 * several transactions have sensitive side effects and must stay in separate roles. */
export type StandardRoleTemplate = {
  id: string; module: string; name: string; description: string; permissions: string[];
};

export function standardRoleTemplates(groups: PermGroup[]): StandardRoleTemplate[] {
  const enabled = new Map(groups.map(g => [g.module, new Set(g.permissions.map(p => p.key))]));
  return ROLE_TEMPLATES.flatMap(template => {
    const valid = enabled.get(template.module);
    if (!valid) return [];
    const permissions = [...new Set(template.permissions)].filter(p => valid.has(p));
    if (!permissions.length || sodConflicts(permissions).length) return [];
    return [{
      id: 'std_' + template.id,
      module: template.module,
      name: template.name,
      description: template.description,
      permissions,
    }];
  });
}
