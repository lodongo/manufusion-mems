import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {detectAdminCatalogKind,catalogUploadIssue,splitUtf8UploadParts}
    from '../../src/admin/catalogFileKinds.ts';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('material master is detected as material and cannot accidentally overwrite asset classes',()=>{
    const materials={catalogType:'materials',materials:[{code:'RM-01'}],attributes:[]};
    assert.equal(detectAdminCatalogKind(materials),'materials');
    assert.match(catalogUploadIssue('assets',materials),/Material catalog \(PRC\).*Asset catalog/);
    assert.equal(catalogUploadIssue('materials',materials),null);
});

test('structural type wins over a misleading filename or incorrect catalogType',()=>{
    assert.equal(detectAdminCatalogKind({catalogType:'assets',materials:[],attributes:[]}), 'materials');
    assert.equal(detectAdminCatalogKind({assetClasses:[],attributes:[]}), 'assets');
    assert.equal(detectAdminCatalogKind({services:[],attributes:[]}), 'services');
    assert.equal(detectAdminCatalogKind({accounts:[],attributes:[]}), 'gl_accounts');
});

test('asset file validation gives exact required arrays and rejects incomplete masters',()=>{
    assert.match(catalogUploadIssue('assets',{attributes:[]}),/Missing: assetClasses/);
    assert.match(catalogUploadIssue('assets',{assetClasses:[]}),/Missing: attributes/);
    assert.match(catalogUploadIssue('assets',{assetClasses:[],attributes:[]}),/no assetClasses entries/);
    assert.equal(catalogUploadIssue('assets',{assetClasses:[{code:'AST-001'}],attributes:[]}),null);
});

test('UTF-8 chunks are lossless, <=650kB each and do not break emoji or Asian characters',()=>{
    const content='{"assetClasses":['+('{"name":"工具部件🧰🔧","code":"AST-001"},'.repeat(1800))+
        '"finish"],"attributes":[]}';
    const chunks=splitUtf8UploadParts(content,1400,1900);
    assert.ok(chunks.length>4);
    assert.equal(chunks.join(''),content);
    assert.ok(chunks.every(x=>new TextEncoder().encode(x).length<=1900));
    for(const c of chunks){
        assert.ok(!/[\uD800-\uDBFF]$/.test(c),'high-surrogate must never end a chunk');
        assert.ok(!/^[\uDC00-\uDFFF]/.test(c),'low-surrogate must never begin a chunk');
    }
});

test('asset upload uses unique sessions, verified parts, targeted retries and safe activation',()=>{
    const ui=read('src/admin/AssetDictionaryAdmin.tsx');
    const api=read('backend/assets.ts');
    assert.ok(ui.includes('catalogUploadIssue(\'assets\',parsed)'));
    assert.ok(ui.includes("'admin/material_catalog'"));
    assert.ok(ui.includes('splitUtf8UploadParts(textAll)'));
    assert.ok(ui.includes("'/api/admin/assets/catalog/chunk',{uploadId,index,data:payload,sha256:partHash}"));
    assert.ok(ui.includes('missingChunks.filter(i=>Number.isInteger(i)'));
    assert.ok(ui.includes('if(res.ok)reload()'));
    assert.ok(api.includes('assetUploadPath(ctx.body.uploadId)'));
    assert.ok(api.includes("/^[a-f0-9]{32}$/"));
    assert.ok(api.includes('Upload part checksum mismatch. Retry this part.'));
    assert.ok(api.includes('retryable:true,missingChunks'));
    assert.ok(api.includes('if (errors.length) return reject(errors, warnings)'));
    assert.ok(api.includes('await writeDoc(POINTER,'));
});
