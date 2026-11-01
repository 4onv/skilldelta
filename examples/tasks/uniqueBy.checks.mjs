import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueBy } from './solution.mjs';

test('keeps the first item for each key in stable order without mutation', () => {
  const first = { id: 2, value: 'first' };
  const second = { id: 1, value: 'second' };
  const duplicate = { id: 2, value: 'discard' };
  const input = Object.freeze([first, second, duplicate]);
  const result = uniqueBy(input, item => item.id);
  assert.deepEqual(result, [first, second]);
  assert.equal(result[0], first);
  assert.equal(result[1], second);
  assert.notEqual(result, input);
  assert.equal(input.length, 3);
});

test('uses SameValueZero without string coercion for arbitrary keys', () => {
  const shared = {};
  const other = {};
  const symbol = Symbol('key');
  const items = [1, '1', NaN, NaN, 0, -0, shared, other, shared, symbol, symbol, '__proto__'];
  assert.deepEqual(uniqueBy(items, item => item), [1, '1', NaN, 0, shared, other, symbol, '__proto__']);
});

test('calls the selector exactly once per item with its index', () => {
  const calls = [];
  assert.deepEqual(uniqueBy(['a', 'b', 'c'], (item, index) => {
    calls.push([item, index]);
    return index % 2;
  }), ['a', 'b']);
  assert.deepEqual(calls, [['a', 0], ['b', 1], ['c', 2]]);
});

test('validates both arguments even when the array is empty', () => {
  for (const value of [undefined, null, 'abc', {}, new Set()]) {
    assert.throws(() => uniqueBy(value, item => item), TypeError);
  }
  for (const keyFn of [undefined, null, 'id', 1, {}]) {
    assert.throws(() => uniqueBy([], keyFn), TypeError);
  }
  assert.deepEqual(uniqueBy([], item => item), []);
});

test('propagates selector errors unchanged', () => {
  const failure = new Error('selector failed');
  assert.throws(() => uniqueBy([1], () => { throw failure; }), error => error === failure);
});
