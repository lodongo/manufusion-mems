import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const configured=[
 ['backend/corporateBudgetRoutes.ts',10],
 ['backend/corporateAllocationRoutes.ts',6],
 ['backend/corporateIntercompanyRoutes.ts',14],
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
