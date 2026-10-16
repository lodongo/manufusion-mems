import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root=resolve(import.meta.dirname,'../..');
function files(folder){
    const result=[];
    for(const name of readdirSync(join(root,folder),{withFileTypes:true})){
        const path=join(folder,name.name);
        if(name.isDirectory())result.push(...files(path));
        else result.push(path);
    }
    return result;
}
const read=(path)=>readFileSync(join(root,path),'utf8');

test('recovered business modules and regression suite are retained',()=>{
    assert.ok(files('backend').length>=80);
    assert.ok(files('src/org').length>=90);
    assert.ok(JSON.parse(read('tests/tests.json')).length>=40);
    assert.ok(read('backend/finCore.ts').includes('fin_postkeys'));
    assert.ok(read('backend/guards.ts').includes('verifyIdToken'));
});

test('no migrated module imports AppDeploy client/server SDK',()=>{
    const relevant=[...files('src'),...files('backend')].filter(p=>/\.[jt]sx?$/.test(p));
    const wrong=relevant.filter(path=>/from\s+['"]@appdeploy\//.test(read(path)));
    assert.deepEqual(wrong,[]);
    assert.ok(read('backend/platform/sdk.ts').includes('getSignedUrl'));
    assert.ok(read('src/lib/httpClient.ts').includes("'/api/'"));
});

test('live Firestore project is guarded at API boundary and defaults are not production credentials',()=>{
    const server=read('backend/platform/server.ts');
    assert.ok(server.includes("MEMS_FIREBASE_PROJECT_ID === 'mems2026'"));
    assert.ok(server.includes('MEMS_ALLOW_LIVE_DATA'));
    assert.ok(read('backend/core.ts').includes('googleAuth.getClient()'));
    assert.ok(!read('src/firebase.ts').includes('AIzaSy'));
    assert.ok(!read('src/firebase.ts').includes('mems2026.firebaseapp.com'));
    assert.ok(existsSync(join(root,'.gitignore')));
});

test('cloud storage paths and signed URL expiry are bounded',()=>{
    const adapter=read('backend/platform/sdk.ts');
    assert.ok(adapter.includes('safeObjectPath'));
    assert.ok(adapter.includes("action: 'read'"));
    assert.ok(adapter.includes('15 * 60 * 1000'));
    assert.ok(adapter.includes("cacheControl: 'private,no-store'"));
});

test('runtime and frontend scripts point at independent hosting',()=>{
    const pkg=JSON.parse(read('package.json'));
    assert.equal(pkg.name,'mems-independent');
    assert.ok(pkg.dependencies['@google-cloud/storage']);
    assert.ok(pkg.dependencies['google-auth-library']);
    assert.ok(pkg.scripts.start.includes('backend/platform/server.ts'));
    assert.ok(!read('src/lib/backend.ts').includes('@appdeploy/client'));
    assert.ok(!read('backend/index.ts').includes('@appdeploy/sdk'));
    assert.ok(read('Dockerfile').includes('USER node'));
});
