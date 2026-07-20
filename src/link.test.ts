import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepoSpec } from './link.js';

/* The repo reference ends up in every published URL. */

const expected = { owner: 'Encoded77', name: 'SteamWorkshopAssets' };

test('accepts the HTTPS clone URL', () => {
  assert.deepEqual(
    parseRepoSpec('https://github.com/Encoded77/SteamWorkshopAssets.git'),
    expected,
  );
});

test('accepts the browser URL without .git', () => {
  assert.deepEqual(parseRepoSpec('https://github.com/Encoded77/SteamWorkshopAssets'), expected);
});

test('accepts a trailing slash', () => {
  assert.deepEqual(parseRepoSpec('https://github.com/Encoded77/SteamWorkshopAssets/'), expected);
});

test('accepts the SSH clone URL', () => {
  assert.deepEqual(
    parseRepoSpec('git@github.com:Encoded77/SteamWorkshopAssets.git'),
    expected,
  );
});

test('accepts bare owner/name', () => {
  assert.deepEqual(parseRepoSpec('Encoded77/SteamWorkshopAssets'), expected);
});

test('trims surrounding whitespace', () => {
  assert.deepEqual(parseRepoSpec('  Encoded77/SteamWorkshopAssets  '), expected);
});

test('rejects a non-GitHub host', () => {
  assert.throws(
    () => parseRepoSpec('https://gitlab.com/Encoded77/SteamWorkshopAssets.git'),
    /Only GitHub/,
  );
});

test('rejects a URL with extra path segments', () => {
  assert.throws(
    () => parseRepoSpec('https://github.com/Encoded77/SteamWorkshopAssets/tree/main/Mod'),
    /owner\/name/,
  );
});

test('rejects nonsense', () => {
  assert.throws(() => parseRepoSpec('SteamWorkshopAssets'), /Expected owner\/name/);
  assert.throws(() => parseRepoSpec(''), /required/);
});
