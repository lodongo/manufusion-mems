import type { PermGroup } from './permissionPolicy';
import { sodConflicts } from './permissionPolicy';

/** Conservative role blueprints. Only permissions actually present in the enabled module
 * catalogue are included; unknown or future transaction actions are never granted.
 * Each blueprint is independent of the employee self-service baseline. */
export type StandardRoleTemplate = {
  id: string; module: string; name: string; description: string;
  permissions: string[];
};

type Stage = 'viewer' | 'executor' | 'verifier' | 'approver' | 'administrator';
const STAGES: Stage[] = ['viewer', 'executor', 'verifier', 'approver', 'administrator'];
const TITLE: Record<Stage, string> = {
  viewer: 'Viewer', executor: 'Executor', verifier: 'Verifier',
  approver: 'Approver', administrator: 'Administrator',
};
const classify = (key: string, label: string): Stage => {
  const x = (key + ' ' + label).toLowerCase();
  if (/approve|authorize|sign.off|release|reopen/.test(x)) return 'approver';
  if (/verify|evaluate|reconcil|audit|review counts|risk.assess/.test(x)) return 'verifier';
  if (/\.admin\b|\.configure\b|\.setup\.manage\b|\.authority\.manage\b|\.buyers\.manage\b|\.roles\b|\.settings\b|\.modules\b|\.structure\b|\.users\b|\.workflows\b|configure|configuration|setup:|manage users|manage security/.test(x)) return 'administrator';
  if (/\.view\b|\.history\b|view |read.only|read only/.test(x)) return 'viewer';
  return 'executor';
};

export function standardRoleTemplates(groups: PermGroup[]): StandardRoleTemplate[] {
  const templates: StandardRoleTemplate[] = [];
  for (const group of groups) {
    const module = group.module;
    const pools = new Map<Stage, string[]>(STAGES.map(stage => [stage, []]));
    for (const permission of group.permissions) {
      const stage = classify(permission.key, permission.label);
      pools.get(stage)!.push(permission.key);
    }
    for (const stage of STAGES) {
      const permissions: string[] = [];
      for (const key of pools.get(stage)!) {
        if (sodConflicts([...permissions, key]).length === 0) permissions.push(key);
      }
      if (!permissions.length) continue;
      templates.push({
        id: `std_${module.toLowerCase()}_${stage}`,
        module, name: `${group.name} – ${TITLE[stage]}`,
        description: `MEMS standard ${stage} transaction role for ${group.name}. No other role privileges are inherited.`,
        permissions,
      });
    }
  }
  return templates;
}
