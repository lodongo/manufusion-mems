import type { PermGroup, PermDef } from './permissionPolicy';
import { ROLE_TEMPLATES, sodConflicts } from './permissionPolicy';

/** Recommended, optional starting points. Existing approved roles retain stable IDs.
 * Uncovered permissions are offered in supplementary stage-based roles, but a missing
 * template never prevents an organization from using or customizing MEMS. */
export type StandardRoleTemplate = {
  id: string; module: string; name: string; description: string; permissions: string[];
};
type Stage = 'Viewer' | 'Executor' | 'Verifier' | 'Approver' | 'Administrator';
const STAGES: Stage[] = ['Viewer', 'Executor', 'Verifier', 'Approver', 'Administrator'];
const stageFor = (permission: PermDef): Stage => {
  const s = (permission.key + ' ' + permission.label).toLowerCase();
  if (/approv|authoriz|sign.off|release posting|post approval/.test(s)) return 'Approver';
  if (/verif|reconcil|evaluat|audit trail|review completed/.test(s)) return 'Verifier';
  if (/configur|setup|setting|administ|manage users|manage roles|subscription|\.roles|\.users|\.modules|\.structure|\.workflows|\.billing|\.scope\./.test(s)) return 'Administrator';
  if (/\.view\b|\.history\b|read.only|view |list |browse /.test(s) && !/create|edit|manage|delete|submit|post/.test(s)) return 'Viewer';
  return 'Executor';
};

export function standardRoleTemplates(groups: PermGroup[]): StandardRoleTemplate[] {
  const enabled = new Map(groups.map(g => [g.module, new Set(g.permissions.map(p => p.key))]));
  const templates: StandardRoleTemplate[] = [];
  const assigned = new Set<string>();
  // Explicit least-privilege role. Never bundles employee access or approval rights.
  if (enabled.get('HRM')?.has('HRM.shell.view')) {
    templates.push({ id: 'std_hrm_shell_viewer', module: 'HRM', name: 'HR – Workspace Access', description: 'Open HR submodules. Employee record viewing and changes require separately authorized permissions.', permissions: ['HRM.shell.view'] });
    assigned.add('HRM.shell.view');
    if(enabled.get('HRM')?.has('HRM.rules.approve')){
      templates.push({id:'std_hrm_privacy_approver',module:'HRM',name:'HR – Privacy Officer Approver',
        description:'Independently approve or reject HR access policy changes; cannot approve own submissions.',
        permissions:['HRM.shell.view','HRM.rules.approve']});
      assigned.add('HRM.rules.approve');
    }
    if(enabled.get('HRM')?.has('HRM.skills.manage')){
      templates.push({
        id:'std_hrm_skills_administrator',module:'HRM',name:'HR – Skills Administrator',
        description:'Maintain the tenant skills catalogue; manager confirmation remains tied to the actual reporting hierarchy.',
        permissions:['HRM.shell.view','HRM.skills.manage'],
      });
      assigned.add('HRM.skills.manage');
    }
  }
  for (const template of ROLE_TEMPLATES) {
    const valid = enabled.get(template.module);
    if (!valid) continue;
    const permissions = [...new Set(template.permissions)].filter(p => valid.has(p));
    if (!permissions.length || sodConflicts(permissions).length) continue;
    templates.push({
      id: 'std_' + template.id, module: template.module,
      name: template.name, description: template.description, permissions,
    });
    permissions.forEach(key => assigned.add(key));
  }
  // Extend the curated catalogue using only real permission keys offered by active modules.
  // Supplemental roles never combine known maker/checker or initiator/approver conflicts.
  for (const group of groups) {
    const uncovered = group.permissions.filter(p => !assigned.has(p.key));
    for (const stage of STAGES) {
      const eligible = uncovered.filter(p => stageFor(p) === stage);
      if (!eligible.length) continue;
      const bins: string[][] = [];
      for (const p of eligible) {
        let bin = bins.find(keys => sodConflicts([...keys, p.key]).length === 0);
        if (!bin) { bin = []; bins.push(bin); }
        bin.push(p.key);
      }
      for (let i = 0; i < bins.length; i++) {
        const permissions = bins[i];
        // A concise, recognizable supplemental template; avoid wildcard privileges.
        templates.push({
          id: 'std_extra_' + group.module.toLowerCase() + '_' + stage.toLowerCase() + (i ? '_' + (i + 1) : ''),
          module: group.module,
          name: group.name + ' – ' + stage + (i ? ' ' + (i + 1) : ''),
          description: 'Suggested ' + stage.toLowerCase() + ' access for additional current ' + group.name + ' transactions. Review and customize as needed.',
          permissions,
        });
      }
    }
  }
  return templates;
}
