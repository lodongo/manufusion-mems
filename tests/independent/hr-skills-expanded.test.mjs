import test from 'node:test';
import assert from 'node:assert/strict';
import { HR_SKILL_EXPANDED, HR_SKILL_EXPANDED_COUNTS } from '../../backend/hrSkillsExpanded.ts';

test('universal replacement has at least 2000 codified selectable skills', () => {
  assert.ok(HR_SKILL_EXPANDED.length >= 2000);
  assert.equal(new Set(HR_SKILL_EXPANDED.map(x => x.code)).size, HR_SKILL_EXPANDED.length);
  assert.ok(HR_SKILL_EXPANDED.every(x => /^HR_NSK_\d{3}_\d{3}$/.test(x.code) && x.label && x.description && x.active));
});

test('substantive soft skills are in the reference catalogue', () => {
  const cats = new Set(HR_SKILL_EXPANDED.map(x => x.category));
  for(const name of ['Personal effectiveness','Interpersonal and relational','Leadership and management','Human resources']) assert.ok(cats.has(name),name);
  const soft = HR_SKILL_EXPANDED.filter(x => ['Personal effectiveness','Interpersonal and relational','Leadership and management'].includes(x.category));
  assert.ok(soft.length >= 500, `Expected at least 500 human and relational competencies, got ${soft.length}`);
});

test('all industries and skill hierarchy categories are present', () => {
  assert.ok(HR_SKILL_EXPANDED_COUNTS.categories >= 20);
  assert.ok(HR_SKILL_EXPANDED_COUNTS.subcategories >= 100);
  assert.ok(new Set(HR_SKILL_EXPANDED.map(x => x.subcategory)).size >= 100);
});

test('replacement cannot silently give legacy role skills a different meaning', () => {
  assert.ok(HR_SKILL_EXPANDED.every(x => x.code.startsWith('HR_NSK_')));
  assert.ok(HR_SKILL_EXPANDED.every(x => !x.code.startsWith('HR_SK_')));
});
