/**
 * CI guard against newly added organization API endpoints bypassing organization
 * permission enforcement. Old routes are not reclassified by this incremental gate.
 */
import { execFileSync } from 'node:child_process';

export function validateAddedOrgRoutes(diff) {
  const lines=diff.split('\n');
  const problems=[];
  // A route declared on a removed line already existed: a changed line (common in long single-line files) is an
  // edit, not a new route. Only genuinely new declarations are gated, as this incremental check intends.
  const existing=new Set();
  for(const line of lines){
    if(!line.startsWith('-'))continue;
    for(const m of line.matchAll(/['"`]((?:GET|POST|PUT|PATCH|DELETE) \/api\/org\/[^'"`]+)['"`]\s*:\s*\[/g))existing.add(m[1]);
  }
  const ROUTE=/['"`]((?:GET|POST|PUT|PATCH|DELETE) \/api\/org\/[^'"`]+)['"`]\s*:\s*\[/g;
  const GUARD=/\borgRoute\s*\(\s*['"`][^'"`]+['"`]\s*,\s*['"`][^'"`]+['"`]/;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(!line.startsWith('+'))continue;
    const matches=[...line.matchAll(ROUTE)];
    matches.forEach((m,k)=>{
      if(existing.has(m[1]))return;
      // The guard belongs to this declaration: text up to the next declaration on the line, else the next lines.
      const after=line.slice(m.index+m[0].length, k+1<matches.length?matches[k+1].index:undefined);
      const following=k+1<matches.length?'':lines.slice(i+1,i+14).filter(s=>!s.startsWith('-')).join(' ');
      if(!GUARD.test(after+' '+following))problems.push('New organization endpoint needs explicit orgRoute permission: '+m[1]);
    });
  }
  return problems;
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  let diff='';
  try{diff=execFileSync('git',['diff','--no-ext-diff','--unified=0','HEAD^','HEAD','--','backend'],{encoding:'utf8',maxBuffer:8_000_000});}
  catch(e){console.error('Cannot compare new routes with the previous commit; release audit blocked.');process.exit(1);}
  const issues=validateAddedOrgRoutes(diff);
  if(issues.length){console.error(issues.join('\n'));process.exit(1);}
  console.log('New organization route declarations checked for explicit permission guards.');
}
