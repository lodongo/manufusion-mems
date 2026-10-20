import assert from 'node:assert/strict';
import test from 'node:test';
import { DOCUMENT_METADATA_LISTS } from './drkmsDefaults';

test('document master list codes and keys are unique', () => {
  assert.equal(DOCUMENT_METADATA_LISTS.length, 5);
  const keys = DOCUMENT_METADATA_LISTS.map(list => list.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const list of DOCUMENT_METADATA_LISTS) {
    assert.equal(list.appliesTo, 'documents');
    assert.ok(list.items.length > 0);
    assert.equal(new Set(list.items.map(item => item.code)).size, list.items.length, list.key);
    for (const item of list.items) {
      assert.ok(item.code.trim(), list.key);
      assert.ok(item.label.trim(), list.key);
    }
  }
});

test('document types and technical subtypes are separate namespaces', () => {
  const classes = DOCUMENT_METADATA_LISTS.find(x => x.key === 'documentClasses')!;
  const technical = DOCUMENT_METADATA_LISTS.find(x => x.key === 'technicalDocumentTypes')!;
  const classCodes = new Set(classes.items.map(x => x.code));
  assert.ok(classCodes.has('POL'));
  assert.ok(classCodes.has('PRG'));
  assert.ok(classCodes.has('PRC'));
  assert.ok(classCodes.has('WIN'));
  assert.ok(technical.items.some(x => x.code === 'ELD' && x.categoryCode === 'SPC'));
  for (const item of technical.items) assert.ok(classCodes.has(item.categoryCode!), item.code);
});

test('document master defines asset and revision relationships', () => {
  const relationships = DOCUMENT_METADATA_LISTS.find(x => x.key === 'documentRelationships')!;
  assert.ok(relationships.items.some(x => x.description === 'applies_to_asset'));
  assert.ok(relationships.items.some(x => x.description === 'supersedes'));
});
