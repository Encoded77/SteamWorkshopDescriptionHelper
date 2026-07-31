import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

/*
 * Reads the workspace clone through git itself rather than reimplementing it.
 * `.gitignore` in particular has enough corners — negations, directory rules,
 * nested files — that a hand-rolled matcher would quietly disagree with the
 * repo the files are being published to.
 */

const run = promisify(execFile);

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', dir, ...args], { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

export async function isRepo(dir: string): Promise<boolean> {
  return git(dir, ['rev-parse', '--git-dir']).then(
    () => true,
    () => false,
  );
}

export async function headSha(dir: string): Promise<string> {
  return (await git(dir, ['rev-parse', 'HEAD'])).trim();
}

/**
 * Every file under `project` that belongs in the repo: tracked ones plus
 * untracked ones git would not ignore, minus any the index still lists but that
 * no longer exist on disk. Those become deletions, which is how a removed
 * content file reaches the repo.
 */
export async function projectFiles(dir: string, project: string): Promise<string[]> {
  const out = await git(dir, [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    project,
  ]);

  const paths = [...new Set(out.split('\0').filter(Boolean))];
  const present = await Promise.all(
    paths.map((p) => stat(join(dir, p)).then(
      (s) => s.isFile(),
      () => false,
    )),
  );
  return paths.filter((_, i) => present[i]).sort();
}

export interface Divergence {
  /** The clone and the branch are on the same commit. */
  synced: boolean;
  /** Branch commits the clone does not have; null when the remote commit is unknown locally. */
  behind: number | null;
  /** Local commits the branch does not have. */
  ahead: number;
}

/**
 * Whether the clone still reflects the branch being published to. Publishing
 * writes through the API, so anything the clone has not seen would be
 * overwritten or, with deletions, removed outright.
 */
export async function divergence(dir: string, remoteSha: string): Promise<Divergence> {
  const local = await headSha(dir);
  if (local === remoteSha) return { synced: true, behind: 0, ahead: 0 };

  // A remote commit the clone has never fetched cannot be counted against, and
  // its absence already says the clone is out of date.
  const known = await git(dir, ['cat-file', '-e', `${remoteSha}^{commit}`]).then(
    () => true,
    () => false,
  );
  if (!known) return { synced: false, behind: null, ahead: 0 };

  // Symmetric difference: commits on one side only, in each direction.
  const out = await git(dir, ['rev-list', '--left-right', '--count', `${remoteSha}...HEAD`]);
  const [behind = '0', ahead = '0'] = out.trim().split(/\s+/);
  return { synced: false, behind: Number(behind), ahead: Number(ahead) };
}

export interface CloneSync {
  ok: boolean;
  /** HEAD before, for reporting. */
  from?: string;
  /** The branch head the clone was moved onto. */
  to?: string;
  /** Why the fast-forward was skipped, safe to show the user (never a raw git error). */
  reason?: string;
}

/**
 * Move the clone's branch pointer onto the commit publishing just pushed,
 * WITHOUT touching the working tree — the same realign the user would otherwise
 * do by hand, so the next publish is not refused for being behind.
 *
 * Only ever a fast-forward: the published commit is built on the clone's HEAD
 * (publishing refuses otherwise), so `reset --mixed` discards nothing. `fetchUrl`
 * carries the token, so a clone whose own remote is SSH or private still works;
 * fetch failures are swallowed into a redacted reason so the token never leaks
 * into an error message.
 */
export async function fastForwardClone(
  dir: string,
  branch: string,
  fetchUrl: string,
): Promise<CloneSync> {
  // reset moves whatever branch is checked out, so it must be the right one.
  const current = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (current !== branch) {
    return { ok: false, reason: `the clone is on "${current}", not "${branch}"` };
  }

  const before = (await git(dir, ['rev-parse', 'HEAD'])).trim();

  try {
    await git(dir, ['fetch', fetchUrl, branch]);
  } catch {
    // Never surface the raw error: it echoes the token-bearing URL.
    return { ok: false, from: before, reason: 'could not fetch the branch (network or credentials)' };
  }

  const target = (await git(dir, ['rev-parse', 'FETCH_HEAD'])).trim();
  if (target === before) return { ok: true, from: before, to: target };

  const fastForward = await git(dir, ['merge-base', '--is-ancestor', before, target]).then(
    () => true,
    () => false,
  );
  if (!fastForward) {
    return { ok: false, from: before, to: target, reason: 'the branch is not a fast-forward of the clone' };
  }

  await git(dir, ['reset', '--mixed', target]);
  return { ok: true, from: before, to: target };
}
