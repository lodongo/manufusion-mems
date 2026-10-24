import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const configured=[
 ['backend/corporateBudgetRoutes.ts',10],
 ['backend/corporateAllocationRoutes.ts',6],
 ['backend/corporateIntercompanyRoutes.ts',15],
 ['backend/corporateAllocationExecutionRoutes.ts',2],
];
test('Corporate finance endpoints declare their own FIN route-level permissions',()=>{
 for(const [file,expected] of configured){
  const source=readFileSync(file,'utf8');
  const declarations=[...source.matchAll(/['"]((?:POST|GET) \/api\/org\/corporate\/[^'"]+)['"]\s*:\s*\[/g)];
  assert.equal(declarations.length,expected,file+': corporate endpoint inventory changed; review new endpoints');
  for(const match of declarations){
   const next=source.slice(match.index,match.index+260);
   assert.match(next,/:\s*\[\s*orgRoute\(\s*['"]org\.corporate\.[^'"]+['"]\s*,\s*['"]FIN\.[^'"]+['"]\s*,/,
    file+' '+match[1]+' needs an explicit FIN permission at the route boundary');
  }
 }
});

test('P6 bilateral GL preview and posted reconciliation require access to both entities',()=>{
 const code=readFileSync('backend/corporateIntercompanyRoutes.ts','utf8');
 const preview=code.slice(code.indexOf("'POST /api/org/corporate/ic/vouchers/preview':"),code.indexOf("'POST /api/org/corporate/ic/post/status':"));
 const posted=code.slice(code.indexOf("'POST /api/org/corporate/ic/posted-reconciliation':"),code.indexOf("'POST /api/org/corporate/ic/reconciliation':"));
 const preflight=code.slice(code.indexOf("'POST /api/org/corporate/ic/post/readiness':"),code.indexOf("'POST /api/org/corporate/ic/post/propose':"));
 assert.match(preview,/for\(const le of \[v\.providerLegalEntityId,v\.beneficiaryLegalEntityId\]\)/);
 assert.match(preview,/throw new HttpError\(403/);
 assert.match(posted,/for\(const party of parties\)await canRead\(ctx,party\)/);
 assert.match(preflight,/await canRead\(ctx,v\.providerLegalEntityId\)/);
 assert.match(preflight,/await canRead\(ctx,v\.beneficiaryLegalEntityId\)/);
});
