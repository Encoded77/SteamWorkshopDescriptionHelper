import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOrphanRender, planSync } from './publish.js';

const GENERATED = new Set(['ModA/description/urls.yaml', 'ModA/out/description.bbcode']);

function plan(local: Record<string, string>, remote: Record<string, string>) {
  return planSync({
    project: 'ModA',
    local: new Map(Object.entries(local)),
    remote: new Map(Object.entries(remote)),
    generated: GENERATED,
  });
}

test('a file whose blob matches the repo is left alone', () => {
  const p = plan({ 'ModA/content/a.yaml': 'sha1' }, { 'ModA/content/a.yaml': 'sha1' });
  assert.deepEqual(p.update, []);
  assert.deepEqual(p.unchanged, ['ModA/content/a.yaml']);
});

test('changed and new files are both updates', () => {
  const p = plan(
    { 'ModA/content/a.yaml': 'new', 'ModA/assets/b.png': 'fresh' },
    { 'ModA/content/a.yaml': 'old' },
  );
  assert.deepEqual(p.update, ['ModA/assets/b.png', 'ModA/content/a.yaml']);
});

test('a repo file with no local counterpart is deleted', () => {
  const p = plan({}, { 'ModA/out/orphan.png': 'sha' });
  assert.deepEqual(p.delete, ['ModA/out/orphan.png']);
});

test('another project is never touched', () => {
  // The whole repo tree is listed, not just this project's subtree.
  const p = plan({}, { 'ModB/out/x.png': 'sha', 'README.md': 'sha', '.gitignore': 'sha' });
  assert.deepEqual(p.delete, []);
  assert.deepEqual(p.update, []);
});

test('a project whose name is a prefix of another is not touched', () => {
  const p = plan({}, { 'ModAlpha/out/x.png': 'sha' });
  assert.deepEqual(p.delete, []);
});

test('the generated pair is never updated or deleted here', () => {
  // Both are committed separately, after this commit's SHA exists to pin to.
  const p = plan(
    { 'ModA/description/urls.yaml': 'local' },
    { 'ModA/description/urls.yaml': 'remote', 'ModA/out/description.bbcode': 'remote' },
  );
  assert.deepEqual(p.update, []);
  assert.deepEqual(p.delete, []);
  assert.deepEqual(p.unchanged, []);
});

test('a render with no content file behind it is an orphan', () => {
  const live = new Set(['d10-banner']);
  assert.equal(isOrphanRender('ModA/out/d25-gone.png', 'ModA', live), true);
  assert.equal(isOrphanRender('ModA/out/d10-banner.png', 'ModA', live), false);
});

test('only PNGs directly in this project\'s out/ can be orphans', () => {
  const live = new Set<string>();
  // Specimen sheets: no content file by design.
  assert.equal(isOrphanRender('ModA/out/identity/sheet.png', 'ModA', live), false);
  assert.equal(isOrphanRender('ModA/out/description.bbcode', 'ModA', live), false);
  assert.equal(isOrphanRender('ModA/content/a.yaml', 'ModA', live), false);
  assert.equal(isOrphanRender('ModB/out/x.png', 'ModA', live), false);
});

test('an empty repo listing deletes nothing', () => {
  // listTree returns [] when the tree is truncated, which must not read as
  // "the repo holds nothing", or a publish would wipe the project.
  const p = plan({ 'ModA/content/a.yaml': 'sha' }, {});
  assert.deepEqual(p.delete, []);
  assert.deepEqual(p.update, ['ModA/content/a.yaml']);
});
