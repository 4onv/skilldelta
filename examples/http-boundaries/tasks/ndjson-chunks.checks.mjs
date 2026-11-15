import assert from 'node:assert/strict';
import test from 'node:test';
import { readNdjson } from './solution.mjs';

const encode = text => new TextEncoder().encode(text);
async function collect(values) {
  const result = [];
  for await (const value of values) result.push(value);
  return result;
}

test('decodes split UTF-8, split CRLF, blank lines, and an unterminated final value', async () => {
  const bytes = encode('{"city":"東京","symbol":"🌱"}\r\n \t\nfalse\nnull');
  const chunks = Array.from(bytes, byte => Uint8Array.of(byte));
  assert.deepEqual(await collect(readNdjson(chunks)), [{ city: '東京', symbol: '🌱' }, false, null]);
  assert.deepEqual(await collect(readNdjson([])), []);
});

test('yields buffered lines before pulling another chunk from an async source', async () => {
  let requested = 0;
  async function* chunks() {
    requested++;
    yield encode('1\n2\n');
    requested++;
    yield encode('3');
  }
  const iterator = readNdjson(chunks());
  assert.deepEqual(await iterator.next(), { value: 1, done: false });
  assert.equal(requested, 1);
  assert.deepEqual(await iterator.next(), { value: 2, done: false });
  assert.equal(requested, 1);
  assert.deepEqual(await iterator.next(), { value: 3, done: false });
  assert.equal((await iterator.next()).done, true);
});

test('enforces physical byte limits before discarding whitespace or decoding', async () => {
  assert.deepEqual(await collect(readNdjson([encode('"é"\r'), encode('\n')], 4)), ['é']);
  await assert.rejects(collect(readNdjson([encode('"é"\n')], 3)), RangeError);
  await assert.rejects(collect(readNdjson([encode('    \r\n')], 3)), RangeError);
  await assert.rejects(collect(readNdjson([encode('1\r')], 1)), RangeError);
  await assert.rejects(collect(readNdjson([], 0)), RangeError);
});

test('preserves earlier values and stops on the first invalid line or chunk', async () => {
  const values = readNdjson([encode('1\n'), Uint8Array.of(0xc3, 0x28, 0x0a), encode('3\n')]);
  assert.deepEqual(await values.next(), { value: 1, done: false });
  await assert.rejects(values.next(), SyntaxError);
  for (const input of ['1\n\ufeff2\n', ']\n', '\u00a0\n']) {
    await assert.rejects(collect(readNdjson([encode(input)])), SyntaxError);
  }
  await assert.rejects(collect(readNdjson(['1\n'])), TypeError);
});
