import assert from 'node:assert/strict';
import test from 'node:test';
import { retryAfterMs } from './solution.mjs';

const now = Date.UTC(2015, 9, 21, 7, 27, 58, 500);

test('parses whole ASCII seconds and preserves the safe integer boundary', () => {
  assert.equal(retryAfterMs(' \t00042\t ', now), 42_000);
  assert.equal(retryAfterMs('0', now), 0);
  assert.equal(retryAfterMs('9007199254740', now), 9_007_199_254_740_000);
  assert.equal(retryAfterMs('9007199254741', now), null);
});

test('accepts exact dates and clamps expired dates', () => {
  assert.equal(retryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT', now), 1500);
  assert.equal(retryAfterMs('\tTue, 20 Oct 2015 00:00:00 GMT ', now), 0);
  assert.equal(retryAfterMs('Thu, 29 Feb 2024 00:00:00 GMT', Date.UTC(2024, 1, 28)), 86_400_000);
  assert.equal(retryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT', Number.MIN_SAFE_INTEGER), null);
});

test('rejects malformed dates, permissive numbers, and wrong argument types', () => {
  for (const value of [null, 3, '+4', '-0', '0x10', '3.5', '2e3', '٤٢', '4\n', '3, 5', ' 4',
    'Tue, 21 Oct 2015 07:28:00 GMT', 'Wed, 21 oct 2015 07:28:00 GMT', 'Fri, 31 Feb 2023 00:00:00 GMT',
    'Wed, 21 Oct 2015 07:28:00 UTC', 'Wed, 21 Oct 2015 07:28:00 GMT\n', 'Wednesday, 21-Oct-15 07:28:00 GMT']) {
    assert.equal(retryAfterMs(value, now), null, JSON.stringify(value));
  }
  for (const invalid of [NaN, Infinity, 0.5, '0', 2 ** 53]) {
    assert.throws(() => retryAfterMs(null, invalid), RangeError);
  }
});
