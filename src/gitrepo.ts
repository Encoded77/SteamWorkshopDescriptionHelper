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
