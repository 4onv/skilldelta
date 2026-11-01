import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './solution.mjs';

test('normalizes punctuation, spacing, case, and digits', () => {
  assert.equal(slugify('  Hello, World!  '), 'hello-world');
  assert.equal(slugify('Version 2.0___READY'), 'version-2-0-ready');
  assert.equal(slugify('already-a-slug'), 'already-a-slug');
});

test('uses compatibility decomposition and removes combining marks', () => {
  assert.equal(slugify('Crème brûlée'), 'creme-brulee');
  assert.equal(slugify('Cafe\u0301'), 'cafe');
  assert.equal(slugify('Ｆｕｌｌ １２'), 'full-12');
  assert.equal(slugify('o\u1ab0'), 'o');
});

test('handles empty and non-ASCII-only values without extra transliteration', () => {
  for (const value of ['', ' --- ', '🚀', '東京', '\u0301']) {
    assert.equal(slugify(value), '');
  }
  assert.equal(slugify('Straße'), 'stra-e');
});

test('rejects values that are not primitive strings', () => {
  for (const value of [undefined, null, 42, [], {}, new String('hello')]) {
    assert.throws(() => slugify(value), TypeError);
  }
});
