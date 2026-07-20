import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listProjects } from './workspace.js';

/** jsDelivr's /gh/ endpoint only serves GitHub, so other hosts are rejected. */

export interface RepoRef {
  owner: string;
  name: string;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Browser URL, HTTPS or SSH clone URL, or bare "owner/name". */
export function parseRepoSpec(input: string): RepoRef {
  const raw = input.trim();
  if (!raw) throw new Error('A repository is required.');

  let path: string;

  const ssh = raw.match(/^(?:ssh:\/\/)?git@github\.com[:/](.+)$/i);
  const https = raw.match(/^https?:\/\/(?:www\.)?github\.com\/(.+)$/i);

  if (ssh) {
    path = ssh[1]!;
  } else if (https) {
    path = https[1]!;
  } else if (/^[^/]+\/[^/]+$/.test(raw)) {
    path = raw;
  } else if (/^https?:\/\//i.test(raw) || raw.includes('@')) {
    throw new Error(
      `Only GitHub repositories are supported: ${raw}\n` +
        `  jsDelivr serves assets from github.com via its /gh/ endpoint; another host\n` +
        `  would produce URLs that do not resolve.`,
    );
  } else {
    throw new Error(`Could not read "${raw}" as a repository. Expected owner/name or a GitHub URL.`);
  }

  const [owner, rest, ...extra] = path.replace(/\.git$/i, '').replace(/\/+$/, '').split('/');

  if (!owner || !rest || extra.length > 0 || !SEGMENT.test(owner) || !SEGMENT.test(rest)) {
    throw new Error(`Could not read "${raw}" as owner/name.`);
  }

  return { owner, name: rest };
}

export interface LinkResult {
  repo: string;
  branch: string;
  file: string;
  previous: string | null;
  /** Projects visible in the workspace, to catch linking an empty directory. */
  projects: string[];
}

/** Rewrites swdh.workspace.json, keeping any other keys already in it. */
export async function linkWorkspace(
  root: string,
  spec: string,
  branch?: string,
): Promise<LinkResult> {
  const { owner, name } = parseRepoSpec(spec);
  const file = join(root, 'swdh.workspace.json');

  let existing: Record<string, unknown> = {};
  let raw: string | null = null;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    // No file yet is normal — this command creates it.
  }

  if (raw !== null) {
    try {
      // A BOM makes JSON.parse throw; treating that as "no file" would discard
      // every other key in it.
      existing = JSON.parse(raw.replace(/^﻿/, '')) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `${file} exists but is not valid JSON, so linking would discard its contents.\n` +
          `  Fix or delete it first. (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  const previous = typeof existing['repo'] === 'string' ? (existing['repo'] as string) : null;
  const repo = `${owner}/${name}`;
  const resolvedBranch = branch ?? (typeof existing['branch'] === 'string' ? existing['branch'] : 'main');

  const next = { ...existing, repo, branch: resolvedBranch };
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

  // docker-compose creates a missing bind-mount source, so a stale
  // SWDH_WORKSPACE yields an empty workspace rather than an error.
  return { repo, branch: resolvedBranch, file, previous, projects: await listProjects(root) };
}

/** Catches a typo or wrongly-scoped token now rather than at first publish. */
export async function checkAccess(
  repo: string,
  token: string,
): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SteamWorkshopDescriptionHelper',
    },
  });

  if (res.status === 404) {
    return {
      ok: false,
      detail: 'not found — either the name is wrong, or the token is not scoped to this repo',
    };
  }
  if (res.status === 401) return { ok: false, detail: 'token rejected (401)' };
  if (!res.ok) return { ok: false, detail: `GitHub returned ${res.status}` };

  const body = (await res.json()) as {
    private?: boolean;
    default_branch?: string;
    permissions?: { push?: boolean };
  };

  const notes: string[] = [];
  if (!body.permissions?.push) notes.push('token cannot push (needs Contents: Read and write)');
  if (body.private) notes.push('repo is PRIVATE — jsDelivr cannot serve it');

  return notes.length
    ? { ok: false, detail: notes.join('; ') }
    : { ok: true, detail: `public, default branch "${body.default_branch}"` };
}
