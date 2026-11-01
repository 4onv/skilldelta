import test from 'node:test';
import assert from 'node:assert/strict';
import { chunk } from './solution.mjs';

test('preserves order and a shorter final group', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([1, 2], 1), [[1], [2]]);
  assert.deepEqual(chunk([1, 2], 10), [[1, 2]]);
  assert.deepEqual(chunk([], 3), []);
});

test('returns fresh groups without mutating the input or cloning elements', () => {
  const item = { id: 1 };
  const input = Object.freeze([item, 2, 3]);
  const result = chunk(input, 2);
  assert.notEqual(result, input);
  assert.notEqual(result[0], input);
  assert.equal(result[0][0], item);
  result[0].push(99);
  assert.deepEqual(input, [item, 2, 3]);
});

test('validates the array argument', () => {
  for (const value of [undefined, null, 'abc', {}, new Set([1])]) {
    assert.throws(() => chunk(value, 2), TypeError);
  }
});

test('requires a positive safe integer size, including for empty arrays', () => {
  for (const size of [0, -1, 1.5, NaN, Infinity, '2', undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => chunk([1], size), RangeError);
    assert.throws(() => chunk([], size), RangeError);
  }
  assert.deepEqual(chunk([1], Number.MAX_SAFE_INTEGER), [[1]]);
});
