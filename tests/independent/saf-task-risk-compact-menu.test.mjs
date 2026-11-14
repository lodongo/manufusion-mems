import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('task risk report opens with compact controls and retains filtering and downloads',()=>{const s=readFileSync('src/org/TaskBasedRiskAssessment.tsx','utf8');const menu=s.slice(s.indexOf('<details className='),s.indexOf('</details>'));assert.ok(menu.includes('Assessment menu'));assert.ok(!menu.includes('<details open'));for(const id of ['risk-search','risk-filter','Maximum tolerable score','Clear filters'])assert.ok(menu.includes(id));assert.ok(s.indexOf('Download Excel')>s.indexOf('</details>'));assert.ok(s.includes('Download PDF'));assert.ok(s.includes('not authorization to execute'));});
