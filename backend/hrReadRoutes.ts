import { HttpError, fieldEq, getDoc, isObj, listDocs, runQuery, str } from './core';
import { orgRoute, hasPerm, type OrgContext } from './guards';
import { canReadHrBasicProfile } from './hrAccessPolicy';
import { hrSiteOf, managedRoots, underManagedRoot } from './hrHierarchy';
import { managerFor } from './hrEmployeeRoutes';
import { resolveHrManager } from './hrManagerResolver';
import { currentHrRules } from './hrRulesRoutes';
import { hrVisibleTabs } from './hrPrivacyRules';
import { buildFitIndex, makeSkillFit } from './hrSkillFit';
import { signedUrl } from './structure';
import { computeRoleStaffing } from './hrRoleStaffingOutlook';

// Read-only HR endpoints. No salaries, banking, medical, disciplinary,
// contact details, identity documents or unrelated security information.
function publicEmployee(user: { id: string; data: Record<string, unknown> }) {
  const d = user.data;
  const assignments = Array.isArray(d.assignments) ? d.assignments.filter(isObj) : [];
  const primary = assignments.find(a => str(a.type) === 'primary');
  return { uid: user.id, name: [str(d.firstName),str(d.lastName)].filter(Boolean).join(' '),
    employeeNumber: str(d.employeeNumber), status: str(d.status),
    jobRole: str(primary?.positionCode) };
}
function assignedNodeIds(ctx: OrgContext): string[] {
  const direct = Array.isArray(ctx.me.data.assignments) ? ctx.me.data.assignments.filter(isObj) : [];
  return direct.filter(a=>str(a.type)==='primary').map(a=>str(a.nodeId)).filter(Boolean);
}
export const hrReadRoutes = {
  'POST /api/org/hr/structure': [
    orgRoute('org.hr.structure', 'HRM.shell.view', async ctx => {
      const docs=await listDocs(`organizations/${ctx.orgId}/structure`);
      const nodeMap=new Map(docs.map(d=>[d.id,d.data]));
      const permittedSites=new Set(assignedNodeIds(ctx).map(id=>hrSiteOf(id,nodeMap)).filter(Boolean));
      if(!permittedSites.size && ctx.role!=='org_super_admin') return {nodes:[],readOnly:true};
      const nodes=docs.filter(d=>str(d.data.status)!=='inactive' &&
        (ctx.role==='org_super_admin'||permittedSites.has(hrSiteOf(d.id,nodeMap)))).map(d=>({
        id:d.id,name:str(d.data.name),code:str(d.data.code),level:str(d.data.level),
        parentId:str(d.data.parentId),status:str(d.data.status)||'active'
      }));
      return { nodes, readOnly:true };
    }),
  ],
  'POST /api/org/hr/roles': [
    orgRoute('org.hr.roles', 'HRM.shell.view', async ctx => {
      const docs=await listDocs(`organizations/${ctx.orgId}/positions`);
      // HRM.shell.view alone grants the role catalogue, not staffing analytics.
      // Aggregate counts are available only with establishment administration rights.
      const staffingAllowed=ctx.role==='org_super_admin'||hasPerm(ctx.directPermissions,'ADM.structure');
      let people:Awaited<ReturnType<typeof runQuery>>=[];
      let names=new Map<string,string>();
      if(staffingAllowed){
        const [users,units]=await Promise.all([
          runQuery({from:[{collectionId:'users'}],where:fieldEq('orgId',ctx.orgId)}),
          listDocs(`organizations/${ctx.orgId}/structure`),
        ]);
        people=users;
        names=new Map(units.map(u=>[u.id,str(u.data.name)||str(u.data.code)||u.id]));
      }
      const asOf=new Date().toISOString().slice(0,10);
      return { roles:docs.map(d=>({
        code:d.id,title:str(d.data.title),description:str(d.data.description),
        parentCode:str(d.data.parentCode),operatingLevel:str(d.data.operatingLevel),
        defaultNodeId:str(d.data.defaultNodeId),
        requiredSkillCount:Array.isArray(d.data.coreSkills)
          ?new Set(d.data.coreSkills.filter((x):x is string=>typeof x==='string'&&!!x.trim()).map(x=>x.trim())).size:0,
        gradeMappings:isObj(d.data.jobGradeByLegalEntity)
          ?Object.values(d.data.jobGradeByLegalEntity).filter(v=>!!str(v)).length:0,
        staffing:staffingAllowed?
          computeRoleStaffing(d.id,d.data.staffingPlan,people,names,asOf):null,
      })),readOnly:true,staffingAllowed };
    }),
  ],
  'POST /api/org/hr/employee/portal': [
    orgRoute('org.hr.employee.portal', 'HRM.shell.view', async ctx => {
      const uid=str(ctx.body.uid).trim();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid))
        throw new HttpError(400,'Select a valid employee.');
      const employee=uid===ctx.uid ? ctx.me : await getDoc(`users/${uid}`);
      if (!employee || str(employee.data.orgId)!==ctx.orgId || str(employee.data.status)==='disabled')
        throw new HttpError(404,'Employee not found.');
      const [nodeDocs, positionDocs, skillDocs]=await Promise.all([
        listDocs(`organizations/${ctx.orgId}/structure`),
        listDocs(`organizations/${ctx.orgId}/positions`),
        listDocs(`organizations/${ctx.orgId}/hr_skill_proposals`),
      ]);
      const nodes=new Map(nodeDocs.map(d=>[d.id,d.data]));
      const positions=new Map(positionDocs.map(d=>[d.id,d.data]));
      const assignments=Array.isArray(employee.data.assignments)
        ? employee.data.assignments.filter(isObj).filter(a=>str(a.type)==='primary')
        : [];
      const ownSiteIds=new Set(assignedNodeIds(ctx).map(id=>hrSiteOf(id,nodes)).filter(Boolean));
      const managed=ctx.role==='org_super_admin' ? new Set<string>()
        : managedRoots(ctx.uid,assignedNodeIds(ctx),nodes);
      const isSelf=uid===ctx.uid;
      const isSuperAdmin=ctx.role==='org_super_admin';
      const sitePermitted=hasPerm(ctx.directPermissions,'HRM.employee.site.read') &&
        assignments.some(a=>{const site=hrSiteOf(str(a.nodeId),nodes);return !!site && ownSiteIds.has(site);});
      const rules=await currentHrRules(ctx.orgId);
      const isDirectManager=!isSelf && (await managerFor(ctx,employee.data,nodes))===ctx.uid;
      const indirectManager=rules.managerIndirectReports&&hasPerm(ctx.directPermissions,'HRM.manager.hierarchy.read') &&
        assignments.some(a=>underManagedRoot(str(a.nodeId),managed,nodes));
      const managerPermitted=isDirectManager||indirectManager;
      if(!isSelf && !isSuperAdmin && !sitePermitted && !managerPermitted)
        throw new HttpError(403,'Employee record outside your HR authorization scope.');
      // Use only the verified shared employee record, organization and job-role masters.
      // No bank, payroll, family, medical, disciplinary or personal contact fields are returned.
      const deployments=assignments.map(a=>{
        const nodeId=str(a.nodeId);
        const node=nodes.get(nodeId);
        const positionCode=str(a.positionCode);
        const position=positions.get(positionCode);
        return {
          nodeId, location: str(node?.name)||nodeId, level:str(node?.level),
          positionCode, positionTitle:str(position?.title)||positionCode,
          startDate:str(a.startsOn), endDate:str(a.endsOn),
          siteId:hrSiteOf(nodeId,nodes),
        };
      });
      const roleCodes=[...new Set(deployments.map(d=>d.positionCode).filter(Boolean))];
      const roles=roleCodes.map(code=>{
        const p=positions.get(code);
        return {code,title:str(p?.title)||code,description:str(p?.description),
          reportsToCode:str(p?.parentCode),operatingLevel:str(p?.operatingLevel),
          requiredSkillCodes:Array.isArray(p?.coreSkills)
            ? [...new Set(p.coreSkills.filter((x):x is string=>typeof x==='string').map(x=>x.trim()).filter(Boolean))]
            : []};
      });
      const requiredSkills=[...new Set(roleCodes.flatMap(code=>{
        const skills=positions.get(code)?.coreSkills;
        return Array.isArray(skills)?skills.filter((x):x is string=>typeof x==='string').map(x=>x.trim()).filter(Boolean):[];
      }))];
      const scope=isSuperAdmin?'superadmin':isSelf?'self':managerPermitted?'manager':'hr';
      const initial=assignments[0];
      const ancestors:string[]=[];
      if(initial){
        const seen=new Set<string>();
        let id=str(initial.nodeId);
        while(id&&!seen.has(id)){
          seen.add(id);const node=nodes.get(id);
          if(!node||str(node.status)==='inactive')break;
          ancestors.push(id);id=str(node.parentId);
        }
      }
      // A direct manager is resolved from the same hierarchy/manager role rules used
      // by HR approval workflows, not inferred from the job title or reporting label.
      // Resolve only after the employee's HR profile read authorization succeeded.
      const managerUsers=await runQuery({from:[{collectionId:'users'}],where:fieldEq('orgId',ctx.orgId)});
      const managerMatch=resolveHrManager(uid,{...employee.data,uid},nodes,managerUsers);
      const managerRecord=managerMatch.reason==='resolved'
        ?managerUsers.find(person=>person.id===managerMatch.uid):undefined;
      const managerAssignments=Array.isArray(managerRecord?.data.assignments)
        ?managerRecord.data.assignments.filter(isObj):[];
      const managerPrimary=managerAssignments.find(a=>str(a.type)==='primary');
      const managerName=managerRecord
        ?[str(managerRecord.data.firstName),str(managerRecord.data.lastName)].filter(Boolean).join(' '):'';
      const directManager={
        name:managerName,
        role:str(positions.get(str(managerPrimary?.positionCode))?.title),
        status:managerRecord?'resolved':managerMatch.reason==='ambiguous'?'ambiguous':'unassigned',
      };
      const departmentId=ancestors.find(id=>str(nodes.get(id)?.level)==='department');
      const siteId=ancestors.find(id=>str(nodes.get(id)?.level)==='site');
      const operatingScope={
        name:deployments[0]?.location||'',
        level:deployments[0]?.level||'',
      };
      return {
        profile: {
          uid, name:[str(employee.data.firstName),str(employee.data.lastName)].filter(Boolean).join(' '),
          employeeNumber:str(employee.data.employeeNumber),status:str(employee.data.status),
          directManager,
          primaryRole:deployments[0]?.positionTitle||'', primaryLocation:deployments[0]?.location||'',
          // Reuse the stored account photo displayed in the MEMS header. Only return a
          // signed URL after this employee has passed the HR access checks above.
          photoUrl:str(employee.data.photoPath).startsWith('users/'+uid+'/')
            ? await signedUrl(str(employee.data.photoPath)) : '',
          department:str(nodes.get(departmentId||'')?.name),site:str(nodes.get(siteId||'')?.name),operatingScope,
        },
        deployments, roles, requiredSkills,
        skillFit:makeSkillFit(uid,employee.data,positions,skillDocs),
        access: {
          scope,allowedTabs:hrVisibleTabs(scope,rules),
          selfServiceTabs:hrVisibleTabs('self',rules),
          isOwnRecord:isSelf,
          readOnlyTabs:['roles','basic'],
          canVerifyEvidence:isSuperAdmin||hasPerm(ctx.directPermissions,'HRM.records.verify'),
        },
      };
    }),
  ],
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
      if (ctx.role!=='org_super_admin' && !hasPerm(ctx.directPermissions,'HRM.manager.hierarchy.read'))
        throw new HttpError(403,'Direct manager view security role required.');
      const nodes=new Map((await listDocs(`organizations/${ctx.orgId}/structure`)).map(d=>[d.id,d.data]));
      const actorNodes=assignedNodeIds(ctx);
      const allowedRoots=managedRoots(ctx.uid,actorNodes,nodes);
      const [users,roleDocs,skillDocs]=await Promise.all([
        runQuery({from:[{collectionId:'users'}],where:fieldEq('orgId',ctx.orgId)}),
        listDocs(`organizations/${ctx.orgId}/positions`),
        listDocs(`organizations/${ctx.orgId}/hr_skill_proposals`),
      ]);
      const fit=buildFitIndex(users,roleDocs,skillDocs);
      const resolved=await Promise.all(users.filter(u=>u.id!==ctx.uid&&str(u.data.status)!=='disabled').map(async u=>{
        const assignment=Array.isArray(u.data.assignments)?u.data.assignments.filter(isObj):[];
        const direct=await managerFor(ctx,u.data,nodes,users)===ctx.uid;
        const inherited=assignment.some(a=>str(a.type)==='primary'&&underManagedRoot(str(a.nodeId),allowedRoots,nodes));
        return {user:u,allowed:direct||inherited};
      }));
      const employees=resolved.filter(x=>x.allowed||ctx.role==='org_super_admin')
        .map(x=>({...publicEmployee(x.user),skillFit:fit.get(x.user.id)}));
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
      const ownSites=new Set(assignedNodeIds(ctx).map(id=>hrSiteOf(id,nodes)).filter(Boolean));
      if (!ownSites.size && ctx.role!=='org_super_admin') throw new HttpError(403,'Verified site assignment is required.');
      const [users,roleDocs,skillDocs]=await Promise.all([
        runQuery({from:[{collectionId:'users'}],where:fieldEq('orgId',ctx.orgId)}),
        listDocs(`organizations/${ctx.orgId}/positions`),
        listDocs(`organizations/${ctx.orgId}/hr_skill_proposals`),
      ]);
      const fit=buildFitIndex(users,roleDocs,skillDocs);
      const records=users.filter(u=>{
        if(str(u.data.status)==='disabled')return false;
        const a=Array.isArray(u.data.assignments)?u.data.assignments.filter(isObj).filter(v=>str(v.type)==='primary'):[];
        return ctx.role==='org_super_admin'||a.some(v=>{const site=hrSiteOf(str(v.nodeId),nodes);return !!site && ownSites.has(site);});
      }).map(u=>({...publicEmployee(u),skillFit:fit.get(u.id)}));
      return { employees:records, readOnly:true, sites:[...ownSites] };
    }),
  ],
};
