import assert from 'node:assert/strict';
import test from 'node:test';
import { createSearch } from './solution.mjs';

const pending = query => ({ query, status: 'pending', results: [], error: null });
const success = (query, results) => ({ query, status: 'success', results, error: null });
const error = query => ({ query, status: 'error', results: [], error: 'Search failed' });

function harness() {
  const requests = [];
  const states = [];
  const controller = createSearch(query => {
    assert.equal(states.at(-1)?.query, query);
    assert.equal(states.at(-1)?.status, 'pending');
    const request = { query, ...Promise.withResolvers() };
    requests.push(request);
    return request.promise;
  }, state => states.push(structuredClone(state)));
  return { requests, states, search: query => controller.search(query) };
}

test('newer results remain after an older success settles', async () => {
  const { requests, states, search } = harness();
  const old = search('alpha');
  const current = search('beta');
  assert.deepEqual(requests.map(request => request.query), ['alpha', 'beta']);
  assert.deepEqual(states, [pending('alpha'), pending('beta')]);
  requests[1].resolve(['new']);
  await current;
  requests[0].resolve(['old']);
  await old;
  assert.deepEqual(states, [pending('alpha'), pending('beta'), success('beta', ['new'])]);
});

test('same-query older failure cannot clear pending or show an error', async () => {
  const { requests, states, search } = harness();
  const old = search('same');
  const current = search('same');
  requests[0].reject(new Error('obsolete'));
  await old;
  assert.deepEqual(states, [pending('same'), pending('same')]);
  requests[1].resolve(['second']);
  await current;
  assert.deepEqual(states, [pending('same'), pending('same'), success('same', ['second'])]);
});

test('current failure stays visible when an older success arrives', async () => {
  const { requests, states, search } = harness();
  const old = search('first');
  const current = search('second');
  requests[1].reject(new Error('failure'));
  await current;
  requests[0].resolve(['obsolete']);
  await old;
  assert.deepEqual(states, [pending('first'), pending('second'), error('second')]);
});

test('synchronous fetch failure becomes a settled current error', async () => {
  const states = [];
  const finder = createSearch(() => { throw new Error('failure'); }, state => states.push(state));
  const work = finder.search('alpha');
  assert.equal(typeof work.then, 'function');
  await work;
  assert.deepEqual(states, [pending('alpha'), error('alpha')]);
});

test('independent search instances can both complete', async () => {
  const left = harness(), right = harness();
  const a = left.search('left'), b = right.search('right');
  left.requests[0].resolve(['L']);
  right.requests[0].resolve(['R']);
  await Promise.all([a, b]);
  assert.deepEqual(left.states, [pending('left'), success('left', ['L'])]);
  assert.deepEqual(right.states, [pending('right'), success('right', ['R'])]);
});
