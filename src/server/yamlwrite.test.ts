import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { writeYamlPreserving } from './yamlwrite.js';

/*
 * The editor overwrites hand-written files, so losing comments on save is the
 * failure mode worth testing directly.
 *
 * Run: docker compose run --rm --entrypoint npx swdh tsx --test src/server/*.test.ts
 */

test('keeps comments on untouched keys', () => {
  const original = [
    '# Leading file comment',
    'type: banner',
    'title: Features # trailing comment',
    'kicker: Rebalance Patches',
    '',
  ].join('\n');

  const out = writeYamlPreserving(original, {
    type: 'banner',
    title: 'Features',
    kicker: 'Changed Kicker',
  });

  assert.match(out, /# Leading file comment/);
  assert.match(out, /# trailing comment/);
  assert.equal(parse(out).kicker, 'Changed Kicker');
});

test('keeps comments when a scalar on the commented key changes', () => {
  const original = ['# why this exists', 'title: Old', 'kicker: K', ''].join('\n');
  const out = writeYamlPreserving(original, { title: 'New', kicker: 'K' });

  assert.match(out, /# why this exists/);
  assert.equal(parse(out).title, 'New');
});

test('preserves block scalars that did not change', () => {
  const original = ['type: block', 'body:', '  - p: >-', '      folded text here', ''].join('\n');

  const out = writeYamlPreserving(original, {
    type: 'block',
    title: 'Added',
    body: [{ p: 'folded text here' }],
  });

  assert.match(out, />-/);
  assert.equal(parse(out).title, 'Added');
});

test('adds and removes keys', () => {
  const original = ['type: card', 'title: T', 'eyebrow: E', 'icon: i.png', 'body: []', ''].join('\n');

  const out = writeYamlPreserving(original, {
    type: 'card',
    title: 'T',
    icon: 'i.png',
    body: [],
    // eyebrow removed, so it must disappear
  });

  const parsed = parse(out);
  assert.equal('eyebrow' in parsed, false);
  assert.equal(parsed.title, 'T');
});

test('keeps comments on surviving list items when a sibling changes', () => {
  const original = [
    'type: block',
    'body:',
    '  - list:',
    '      # first item is important',
    '      - alpha',
    '      - beta',
    '',
  ].join('\n');

  const out = writeYamlPreserving(original, {
    type: 'block',
    body: [{ list: ['alpha', 'CHANGED'] }],
  });

  assert.match(out, /# first item is important/);
  assert.deepEqual(parse(out).body[0].list, ['alpha', 'CHANGED']);
});

test('trims list items that were removed', () => {
  const original = ['body:', '  - list:', '      - a', '      - b', '      - c', ''].join('\n');
  const out = writeYamlPreserving(original, { body: [{ list: ['a'] }] });

  assert.deepEqual(parse(out).body[0].list, ['a']);
});

test('round-trips an unchanged file byte for byte', () => {
  const original = [
    '# Header',
    'type: preview-title',
    'name: Rebalance Patches',
    'flag: "1.6"',
    '',
  ].join('\n');

  const out = writeYamlPreserving(original, parse(original));
  assert.equal(out, original);
});
