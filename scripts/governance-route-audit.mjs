/**
 * Enterprise-wide transaction route inventory. Static discovery only.
 *
 * Run with: npm run audit:routes
 * This deliberately DOES NOT claim a route is protected or verified simply
 * because it contains a permission string. Dynamic guards require review.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const backend = 'backend';
const names = readdirSync(backend).filter(x => x.endsWith('.ts') && !x.endsWith('.test.ts'));
const router = readFileSync(join(backend, 'index.ts'), 'utf8');
const wired = new Set([...router.matchAll(/\.\.\.(\w+Routes)\b/g)].map(x => x[1]));
const records = [];
const routeDeclarations = [];

const imported = new Map();
for (const m of router.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([^']+)'/g)) {
  for (const name of m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0])) imported.set(name, m[2]);
}
for (const name of names) {
  const content = readFileSync(join(backend, name), 'utf8');
  for (const hit of content.matchAll(/['\"]((?:GET|POST|PUT|PATCH|DELETE)\s+\/api\/[^'\"]+)['\"]\s*:\s*\[/g)) {
    routeDeclarations.push({ source: name, route: hit[1] });
  }
  for (const m of content.matchAll(/['"]((?:GET|POST|PUT|PATCH|DELETE)\s+\/api\/[^'"]+)['"]\s*:\s*\[\s*(\w+)\s*\(\s*['"]([^'"]+)['"]\s*,\s*(['"][^'"]*['"]|null)/g)) {
    const [, path, guard, routeName, permissionRaw] = m;
    const method = path.split(' ')[0];
    const url = path.slice(method.length + 1);
    const groups = [...content.matchAll(/export\s+const\s+(\w+Routes)\s*=/g)].map(x=>x[1]);
    const wiredHere = name === 'index.ts' || groups.some(x => wired.has(x) && imported.get(x) === name.replace(/\.ts$/, ''));
    const module = url.split('/')[3]?.toUpperCase() || 'UNKNOWN';
    const permission = permissionRaw === 'null' ? null : permissionRaw.slice(1,-1);
    records.push({path:url,method,module,name:routeName,source:name,guard,permission,assessment:wiredHere ? 'requires_runtime_verification' : 'unwired_or_unresolved'});
  }
}
records.sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
const warnings = [
  ...records.filter(r=>r.permission === null).map(r=>'No direct route permission (possibly internal authorization): '+r.method+' '+r.path),
  ...records.filter(r=>r.assessment!=='requires_runtime_verification').map(r=>'Unwired or unresolved: '+r.method+' '+r.path),
];
const duplicates = new Map();
for(const r of records){const k=r.method+' '+r.path;duplicates.set(k,(duplicates.get(k)||0)+1);}
for(const [route,count] of duplicates){if(count>1)warnings.push('Duplicate route declaration: '+route);}
const indexed = new Set(records.map(r => r.source + ':' + r.method + ' ' + r.path));
const unclassified = routeDeclarations.filter(r => !indexed.has(r.source + ':' + r.route));
for(const route of unclassified)warnings.push('Unclassified backend declaration: ' + route.source + ' ' + route.route);
const summary={scannedFiles:names.length,declaredRoutes:routeDeclarations.length,discoveredStaticRoutes:records.length,unclassifiedRoutes:unclassified.length,routeGroupsWired:wired.size,permissionDeclared:records.filter(r=>r.permission!==null).length,permissionNotDeclared:records.filter(r=>r.permission===null).length,warnings:warnings.length};
const output={generatedAt:new Date().toISOString(),disclaimer:'Static inventory only. Dynamic endpoint coverage, actual permissions, classification and protection are NOT verified.',summary,routes:records,unclassified,warnings};
if(process.argv.includes('--json')) process.stdout.write(JSON.stringify(output,null,2)+'\n');
else {
  process.stdout.write(JSON.stringify(summary,null,2)+'\n');
  process.stdout.write('Run npm run audit:routes -- --json for complete inventory.\n');
}
if(records.length===0){process.stderr.write('No routes discovered; discovery cannot be trusted.\n');process.exitCode=1;}
