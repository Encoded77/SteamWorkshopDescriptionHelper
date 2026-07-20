import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitBlobSha } from './github.js';

/*
 * Checked against git's own published blob ids, not values from this
 * implementation, so the test cannot rubber-stamp a wrong algorithm.
 *
 * Run: docker compose run --rm --entrypoint npx swdh tsx --test src/**\/*.test.ts
 */

test('matches git for empty content', () => {
  // `git hash-object -t blob /dev/null`
  assert.equal(gitBlobSha(Buffer.alloc(0)), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});

test('matches git for "hello\\n"', () => {
  // `printf 'hello\n' | git hash-object --stdin`
  assert.equal(gitBlobSha(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('matches git for "what is up, doc?"', () => {
  // The blob id used throughout the Pro Git book's object chapter.
  assert.equal(
    gitBlobSha(Buffer.from('what is up, doc?')),
    'bd9dbf5aae1a3862dd1526723246b20206e5fc37',
  );
});

test('is sensitive to binary content', () => {
  const a = gitBlobSha(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
  const b = gitBlobSha(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]));
  assert.notEqual(a, b);
});
