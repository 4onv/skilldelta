import assert from 'node:assert/strict';
import test from 'node:test';
import { planPaste } from './solution.mjs';

const write = (row, column, value) => ({ row, column, value });
const rejected = { ok: false, writes: [] };

test('explicit blank fields write while omitted fields do not', () => {
  const result = planPaste('north\t\t\r\nsouth\t', 4, 5, 1, 2);
  assert.deepEqual(result, { ok: true, writes: [
    write(1, 2, 'north'), write(1, 3, ''), write(1, 4, ''),
    write(2, 2, 'south'), write(2, 3, ''),
  ] });
});

test('one terminator is ignored, and a preceding blank row still writes', () => {
  assert.deepEqual(planPaste('last\r\n', 3, 2, 2, 1), { ok: true, writes: [write(2, 1, 'last')] });
  assert.deepEqual(planPaste('first\n\r\n', 3, 2, 0, 1), {
    ok: true, writes: [write(0, 1, 'first'), write(1, 1, '')],
  });
  assert.deepEqual(planPaste('\n', 1, 1, 0, 0), { ok: true, writes: [write(0, 0, '')] });
});

test('preserves meaningful spaces and quotes literally', () => {
  assert.deepEqual(planPaste('\t "north" \t ', 1, 3, 0, 0), { ok: true, writes: [
    write(0, 0, ''), write(0, 1, ' "north" '), write(0, 2, ' '),
  ] });
});

test('overflow in any row rejects all planned writes', () => {
  assert.deepEqual(planPaste('first\nsecond\tthird', 3, 2, 0, 1), rejected);
  assert.deepEqual(planPaste('first\r\nsecond', 3, 2, 2, 0), rejected);
  assert.deepEqual(planPaste('\t', 1, 1, 0, 0), rejected);
});

test('valid empty content makes no writes and malformed inputs are rejected', () => {
  assert.deepEqual(planPaste('', 1, 1, 0, 0), { ok: true, writes: [] });
  for (const args of [
    ['', 1, 1, 1, 0],
    ['x', 1.2, 1, 0, 0],
    ['x', 1, Number.MAX_SAFE_INTEGER + 1, 0, 0],
    ['x', 1, 1, -1, 0],
    ['x', 1, 1, 0, 0.5],
    ['x\ry', 2, 2, 0, 0],
    [null, 1, 1, 0, 0],
  ]) assert.deepEqual(planPaste(...args), rejected);
  const maximum = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(planPaste('a\tb', maximum, maximum, maximum - 1, maximum - 1), rejected);
});
