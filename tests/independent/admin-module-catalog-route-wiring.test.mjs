import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { procurementRoutes } from '../../backend/procurement.ts';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const endpoints=['status','begin','chunk','finish','export','tree','item'];
const types=[
    {kind:'materials',area:'procurement',menu:'material_catalog'},
    {kind:'services',area:'procurement',menu:'service_catalog'},
    {kind:'gl_accounts',area:'finance',menu:'gl_accounts'},
];

test('all seven admin catalog endpoints are mounted for procurement and finance',()=>{
    for(const area of ['procurement','finance']){
        for(const action of endpoints){
            const key=`POST /api/admin/${area}/catalog/${action}`;
            assert.ok(Object.hasOwn(procurementRoutes,key),key+' must be registered');
            assert.ok(Array.isArray(procurementRoutes[key])&&procurementRoutes[key].length,key+' must have a secured handler');
        }
    }
});

test('the MEMS admin pages are routed to their registered server endpoints',()=>{
    const shell=read('src/admin/AdminShell.tsx');
    const page=read('src/admin/ProcurementCatalogAdmin.tsx');
    const index=read('backend/index.ts');
    assert.ok(index.includes('...procurementRoutes'),'catalog routes must be mounted in server');
    for(const {kind,area,menu} of types){
        assert.ok(shell.includes("case '"+menu+"':"),'menu route '+menu);
        assert.ok(shell.includes("kind='"+kind+"'"),'page kind '+kind);
        assert.ok(page.includes("api: '/api/admin/"+area+"/catalog'"),'API base '+area);
        assert.ok(procurementRoutes['POST /api/admin/'+area+'/catalog/status'],'status route for '+kind);
    }
});

test('catalog route access continues through staff read/write guards',()=>{
    const server=read('backend/procurement.ts');
    assert.ok(server.includes("staff(`admin.${area}.catalog.status`, 'read'"));
    assert.ok(server.includes("staff(`admin.${area}.catalog.begin`, 'write'"));
    assert.ok(server.includes("...catalogRoutes('procurement', ['materials', 'services'])"));
    assert.ok(server.includes("...catalogRoutes('finance', ['gl_accounts'])"));
});
