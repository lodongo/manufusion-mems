/**
 * CI guard against newly added organization API endpoints bypassing organization
 * permission enforcement. Old routes are not reclassified by this incremental gate.
 */
import { execFileSync } from 'node:child_process';

export function validateAddedOrgRoutes(diff) {
  const lines=diff.split('\n');
  const problems=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    const route=/^\+\s*['"`]((?:GET|POST|PUT|PATCH|DELETE) \/api\/org\/[^'"`]+)['"`]\s*:\s*\[/.exec(line);
    if(!route)continue;
    const next=lines.slice(i+1,i+14).filter(s=>!s.startsWith('-')).join(' ');
    const guard=/\borgRoute\s*\(\s*['"`][^'"`]+['"`]\s*,\s*['"`][^'"`]+['"`]/.test(next);
    if(!guard)problems.push('New organization endpoint needs explicit orgRoute permission: '+route[1]);
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
