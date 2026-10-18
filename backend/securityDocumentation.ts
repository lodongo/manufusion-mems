import { HttpError, getDoc, listDocs, nowIso, randomId, str, updateFields, writeDoc } from './core';
import { orgRoute, staff } from './guards';
import { standardRoleTemplates } from './standardRoleTemplates';
import { buildCatalogue, ROLE_TEMPLATES } from './permissionPolicy';
import { visibleToOrganization } from './documentation/documentationDomain';

const collection = 'security_documentation';
const pathFor = (id: string) => `${collection}/${id}`;
const clean = (value: unknown, max = 50000) => str(value).trim().slice(0,max);
const safeId = (s: string) => /^[a-zA-Z0-9_-]{4,100}$/.test(s);
const sections = (raw: unknown): Array<{ id: string; heading: string; markdown: string }> => {
  if (!Array.isArray(raw) || raw.length > 100) throw new HttpError(400,'Provide up to 100 sections.');
  return raw.map((x, i) => {
    const o = x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string,unknown> : {};
    const heading = clean(o.heading,180);
    if (!heading) throw new HttpError(400,'Every section requires a heading.');
    return { id: clean(o.id,80) || `section-${i+1}`, heading, markdown: clean(o.markdown) };
  });
};
const publicEntry = (id: string, d: Record<string,unknown>) => ({
  id, title: str(d.title), category: str(d.category), version: Number(d.version)||1,
  status: str(d.status), sections: d.sections, updatedAt: str(d.updatedAt),
  publishedAt: str(d.publishedAt), configurationFingerprint: str(d.configurationFingerprint),
});

export const documentationRoutes = {
  'POST /api/admin/security-docs/list': [
    staff('admin.security-docs.list','read', async () => {
      const docs = await listDocs(collection);
      return { documents: docs.filter(d => !str(d.data.organizationId)).map(d => publicEntry(d.id,d.data)) };
    }),
  ],
  'POST /api/admin/security-docs/save': [
    staff('admin.security-docs.save','write', async (ctx) => {
      const body = ctx.body as Record<string,unknown>;
      const id = clean(body.id,100) || randomId();
      if (!safeId(id)) throw new HttpError(400,'Invalid document ID.');
      const existing = await getDoc(pathFor(id));
      if (existing && str(existing.data.status) === 'published') throw new HttpError(409,'Published documents are immutable. Create a new draft revision.');
      const title = clean(body.title,180);
      if (!title) throw new HttpError(400,'Document title required.');
      const now = nowIso();
      await writeDoc(pathFor(id), {
        title, category: clean(body.category,50)||'security',
        audience: 'organization', status: 'draft',
        sections: sections(body.sections), version: existing ? Number(existing.data.version)||1 : 1,
        organizationId: null, createdAt: str(existing?.data.createdAt)||now,
        updatedAt: now, updatedBy: ctx.uid,
      });
      return { id, status: 'draft' };
    }),
  ],
  'POST /api/admin/security-docs/revise': [
    staff('admin.security-docs.revise','write', async (ctx) => {
      const id = clean(ctx.body.id,100);
      const source = safeId(id) ? await getDoc(pathFor(id)) : null;
      if (!source || str(source.data.status) !== 'published') throw new HttpError(404,'Published source not found.');
      const revisionId = randomId();
      await writeDoc(pathFor(revisionId), {
        ...source.data, version: (Number(source.data.version)||1)+1,
        previousRevisionId: id, status: 'draft', publishedAt: '',
        approvedBy: '', publishedBy: '', createdAt: nowIso(), updatedAt: nowIso(),
        updatedBy: ctx.uid,
      },{exists:false});
      return { id: revisionId };
    }),
  ],
  'POST /api/admin/security-docs/approve': [
    staff('admin.security-docs.approve','super', async (ctx) => {
      const id = clean(ctx.body.id,100);
      const doc = safeId(id) ? await getDoc(pathFor(id)) : null;
      if (!doc || str(doc.data.status) !== 'draft') throw new HttpError(409,'Document must be a draft.');
      if (str(doc.data.updatedBy) === ctx.uid) throw new HttpError(403,'Independent approval required.');
      await updateFields(pathFor(id), {status:'approved', approvedBy:ctx.uid,approvedAt:nowIso()});
      return {ok:true};
    }),
  ],
  'POST /api/admin/security-docs/publish': [
    staff('admin.security-docs.publish','super', async (ctx) => {
      const id = clean(ctx.body.id,100);
      const doc = safeId(id) ? await getDoc(pathFor(id)) : null;
      if (!doc || str(doc.data.status) !== 'approved' || !str(doc.data.approvedBy)) throw new HttpError(409,'Independent approval is required.');
      await updateFields(pathFor(id), {status:'published',publishedBy:ctx.uid,publishedAt:nowIso()});
      return {ok:true};
    }),
  ],
  'POST /api/org/security-docs/list': [
    orgRoute('org.security-docs.list',null,async (ctx) => {
      const all = await listDocs(collection);
      return {documents:all.filter(d=>visibleToOrganization({
        status:str(d.data.status) as 'published',
        audience:str(d.data.audience) as 'organization',
        organizationId:str(d.data.organizationId)||null,
      } as Parameters<typeof visibleToOrganization>[0],ctx.orgId)).map(d=>publicEntry(d.id,d.data))};
    }),
  ],
  'POST /api/org/security-docs/configuration': [
    orgRoute('org.security-docs.configuration','ADM.roles',async (ctx) => {
      const [positions, roles] = await Promise.all([
        listDocs(`organizations/${ctx.orgId}/positions`),
        listDocs(`organizations/${ctx.orgId}/roles`),
      ]);
      const mapped = positions.map(p=>({
        id:p.id,title:str(p.data.title),
        securityRoles:['org_user',...(Array.isArray(p.data.securityRoles)?(p.data.securityRoles as string[]):[])].filter((v,i,a)=>a.indexOf(v)===i),
      }));
      return {
        capturedAt:nowIso(),
        roles:roles.map(r=>({id:r.id,name:str(r.data.name),permissions:Array.isArray(r.data.permissions)?r.data.permissions:[]})),
        positions:mapped,
        // Reporting-only: never expose private employees, credentials or other organizations.
      };
    }),
  ],
  'POST /api/admin/security-docs/standard-preview': [
    staff('admin.security-docs.standard-preview','read',async () => ({
      sections: [
        {id:'overview',heading:'Security architecture',markdown:'MEMS separates organizational user roles (positions), security roles, permissions and individual assignments. The Standard User baseline provides self-service only.'},
        {id:'roles',heading:'Curated standard role templates',markdown:ROLE_TEMPLATES.map(t=>`- **${t.module} / ${t.name}**: ${t.description} — ${t.permissions.join(', ')}`).join('\n')},
        {id:'configuration',heading:'Organization-specific configuration',markdown:'The organization administrator can inspect a live scoped configuration snapshot and attach it to a controlled documentation revision.'},
        {id:'sod',heading:'Segregation of duties',markdown:'Creation, verification, approval and posting are separately authorized. Administrative access does not automatically convey approval authority.'},
      ],
    })),
  ],
};
