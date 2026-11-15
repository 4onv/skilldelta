import assert from 'node:assert/strict';
import test from 'node:test';
import { singleByteRange } from './solution.mjs';

test('returns inclusive bounds for all three forms', () => {
  assert.deepEqual(singleByteRange('\t ByTeS=0002-0005 ', 10), { start: 2, end: 5 });
  assert.deepEqual(singleByteRange('bytes=8-', 10), { start: 8, end: 9 });
  assert.deepEqual(singleByteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(singleByteRange('bytes=0-0', 1), { start: 0, end: 0 });
});

test('clamps huge ends and suffixes before converting the bounds', () => {
  assert.deepEqual(singleByteRange('bytes=2-99999999999999999999999', 10), { start: 2, end: 9 });
  assert.deepEqual(singleByteRange('bytes=-99999999999999999999999', 10), { start: 0, end: 9 });
  assert.equal(singleByteRange('bytes=99999999999999999999999-', 10), null);
  assert.deepEqual(singleByteRange('bytes=9007199254740988-9007199254740994', Number.MAX_SAFE_INTEGER),
    { start: 9_007_199_254_740_988, end: 9_007_199_254_740_990 });
});

test('rejects unsupported or unsatisfiable ranges and invalid lengths', () => {
  for (const value of [null, 3, 'bytes=10-', 'bytes=2-1', 'bytes=-0', 'bytes=-',
    'bytes=1 -2', 'bytes=1-2,3-4', 'bytes=1.0-2', 'bytes=+1-2', 'bytes=1-2\n', 'items=1-2', 'bytes=١-٢']) {
    assert.equal(singleByteRange(value, 10), null, JSON.stringify(value));
  }
  assert.equal(singleByteRange('bytes=0-', 0), null);
  for (const invalid of [-1, NaN, 0.5, '0', 2 ** 53]) {
    assert.throws(() => singleByteRange(null, invalid), RangeError);
  }
});
