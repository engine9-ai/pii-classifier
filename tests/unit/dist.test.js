import nodetest from 'node:test';
import assert from 'node:assert/strict';
import * as built from '../../dist/index.js';
import * as source from '../../src/index.ts';

const { it } = nodetest;

it('dist exports what src exports and behaves the same', () => {
  assert.deepEqual(Object.keys(built).sort(), Object.keys(source).sort());
  const text = 'Card 4539 1488 0343 6467, jane@example.org, 203.0.113.9';
  assert.deepEqual(built.redactText(text), source.redactText(text));
});
