import { HttpError, fieldEq, isObj, listDocs, runQuery, str } from './core';
import { orgRoute, hasPerm, type OrgContext } from './guards';
import { canReadHrBasicProfile } from './hrAccessPolicy';

// Read-only HR endpoints. No salaries, banking, medical, disciplinary,
// contact details, identity documents or unrelated security information.
function publicEmployee(user: { id: string; data: Record<string, unknown> }) {
  const d = user.data;
  const assignments = Array.isArray(d.assignments) ? d.assignments.filter(isObj) : [];
  const primary = assignments.find(a => str(a.type) === 'primary');
  return { uid: user.id, name: [str(d.firstName),str(d.lastName)].filter(Boolean).join(' '),
    employeeNumber: str(d.employeeNumber), status: str(d.status),
    jobRole: str(primary?.positionCode), assignmentNodeId: str(primary?.nodeId) };
}
function assignedNodeIds(ctx: OrgContext): string[] {
  const direct = Array.isArray(ctx.me.data.assignments) ? ctx.me.data.assignments.filter(isObj) : [];
  return direct.filter(a=>str(a.type)==='primary').map(a=>str(a.nodeId)).filter(Boolean);
}
function lookupSite(nodeId: string, nodes: Map<string,Record<string,unknown>>): string {
  let id=nodeId;
  const visited=new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    const n=nodes.get(id);
    if (!n) return '';
    if (str(n.level)==='site') return id;
    id=str(n.parentId);
  }
  return '';
}
export const hrReadRoutes = {
  'POST /api/org/hr/self': [
    orgRoute('org.hr.self', null, async ctx => {
      const read=canReadHrBasicProfile(
        {tenantId:ctx.orgId,uid:ctx.uid,siteIds:[],permissions:[]},
        {tenantId:ctx.orgId,employeeUid:ctx.uid,siteId:'',managerAncestorUids:[]},'self');
      if (!read.allowed) throw new HttpError(403,'HR self service unavailable.');
      return { employee: publicEmployee(ctx.me), readOnly: true };
    }),
  ],
  'POST /api/org/hr/manager-team': [
    orgRoute('org.hr.manager_team', 'HRM.manager.hierarchy.read', async ctx => {
      if (!hasPerm(ctx.directPermissions,'HRM.manager.hierarchy.read'))
        throw new HttpError(403,'Direct manager view security role required.');
      const nodes=new Map((await listDocs(`organizations/${ctx.orgId}/structure`)).map(d=>[d.id,d.data]));
      const actorNodes=assignedNodeIds(ctx);
      const allowedRoots=new Set(actorNodes.filter(id=>str(nodes.get(id)?.managerUid)===ctx.uid));
      if(!allowedRoots.size) throw new HttpError(403,'No verified managed organizational assignment.');
      const descendsFrom=(nodeId:string):boolean=>{
        let id=nodeId;
        const seen=new Set<string>();
        while(id&&!seen.has(id)){
          if(allowedRoots.has(id))return true;
          seen.add(id);
          const node=nodes.get(id);
          if(!node||str(node.status)==='inactive')return false;
          id=str(node.parentId);
        }
        return false;
      };
      const users=await runQuery({from:[{collectionId:'users'}],where:fieldEq('orgId',ctx.orgId)});
      const employees=users.filter(u=>u.id!==ctx.uid&&str(u.data.status)!=='disabled').filter(u=>{
        const a=Array.isArray(u.data.assignments)?u.data.assignments.filter(isObj):[];
        return a.some(v=>str(v.type)==='primary'&&descendsFrom(str(v.nodeId)));
      }).map(publicEmployee);
      return { employees, readOnly:true };
    }),
  ],
  'POST /api/org/hr/site-directory': [
    orgRoute('org.hr.site_directory', 'HRM.employee.site.read', async ctx => {
      // Require explicit directly assigned HR security rights; occupational
      // role mappings cannot silently grant site-wide personnel access.
      if (!hasPerm(ctx.directPermissions,'HRM.employee.site.read') && ctx.role!=='org_super_admin')
        throw new HttpError(403,'Direct HR security role required.');
      const nodes=new Map((await listDocs(`organizations/${ctx.orgId}/structure`)).map(d=>[d.id,d.data]));
      const ownSites=new Set(assignedNodeIds(ctx).map(id=>lookupSite(id,nodes)).filter(Boolean));
      if (!ownSites.size) throw new HttpError(403,'Verified site assignment is required.');
      const users=await runQuery({from:[{collectionId:'users'}],where:fieldEq('orgId',ctx.orgId)});
      const records=users.filter(u=>{
        if(str(u.data.status)==='disabled')return false;
        const a=Array.isArray(u.data.assignments)?u.data.assignments.filter(isObj).filter(v=>str(v.type)==='primary'):[];
        return a.some(v=>{const site=lookupSite(str(v.nodeId),nodes);return !!site && ownSites.has(site);});
      }).map(publicEmployee);
      return { employees:records, readOnly:true, sites:[...ownSites] };
    }),
  ],
};
