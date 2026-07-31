import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { isDescriptionImage, loadContent } from './content.js';
import { GitHub, gitBlobSha, type TreeChange } from './github.js';
import { writeYamlNew, writeYamlPreserving } from './server/yamlwrite.js';
import { assembleToFile } from './bbcode.js';
import * as repo from './gitrepo.js';
import type { Workspace } from './workspace.js';

/*
 * Mirrors the whole project folder into the assets repo, then rewrites
 * urls.yaml with jsDelivr URLs pinned to the resulting commit SHA. Pinning to a
 * SHA rather than a branch keeps URLs immutable, which jsDelivr's caching
 * requires.
 *
 * Sources travel with their renders: publishing only the PNGs left the repo
 * holding output whose inputs were months out of date.
 */

export interface PublishResult {
  /** Commit the URLs are pinned to; the branch may be one commit ahead of it. */
  sha: string;
  /** Repo-relative paths written in this publish. */
  uploaded: string[];
  unchanged: string[];
  /** Repo-relative paths removed because they no longer exist locally. */
  deleted: string[];
  urls: Record<string, string>;
  committed: boolean;
  /** The local clone was fast-forwarded onto the pushed commit; no manual catch-up needed. */
  cloneSynced: boolean;
  /** Present when the clone was not synced and the user has to catch up by hand. */
  cloneSyncNote?: string;
}

export function jsDelivrUrl(repo: string, sha: string, path: string): string {
  return `https://cdn.jsdelivr.net/gh/${repo}@${sha}/${path}`;
}

/**
 * Derived from content files, not from out/ — which accumulates orphaned
 * renders whose content file was deleted or renamed.
 */
export async function publishableNames(contentDir: string): Promise<string[]> {
  const entries = await readdir(contentDir).catch(() => []);
  return entries
    .filter((f) => ['.yaml', '.yml'].includes(extname(f).toLowerCase()))
    .map((f) => f.replace(/\.ya?ml$/i, ''))
    .sort();
}

/** Names whose PNG exists in out/, plus those that have not been rendered. */
export async function publishablePngs(
  contentDir: string,
  outDir: string,
): Promise<{ ready: string[]; missing: string[]; stale: string[] }> {
  const names = await publishableNames(contentDir);
  const present = new Set(
    (await readdir(outDir).catch(() => [])).filter((f) => f.toLowerCase().endsWith('.png')),
  );

  const ready: string[] = [];
  const missing: string[] = [];
  const stale: string[] = [];

  for (const name of names) {
    if (!present.has(`${name}.png`)) {
      missing.push(name);
      continue;
    }
    ready.push(name);

    // A render older than its content file is the previous version.
    const [content, png] = await Promise.all([
      contentMtime(contentDir, name),
      stat(join(outDir, `${name}.png`)).then((s) => s.mtimeMs),
    ]);
    if (content !== null && content > png) stale.push(name);
  }

  return { ready, missing, stale };
}

async function contentMtime(contentDir: string, name: string): Promise<number | null> {
  for (const ext of ['.yaml', '.yml']) {
    const found = await stat(join(contentDir, `${name}${ext}`)).then(
      (s) => s.mtimeMs,
      () => null,
    );
    if (found !== null) return found;
  }
  return null;
}

/**
 * A PNG sitting directly in the project's `out/` with no content file behind
 * it. Nested paths are left alone: `out/identity/` holds specimen sheets, which
 * `.gitignore` already excludes and which have no content file by design.
 */
export function isOrphanRender(
  repoPath: string,
  project: string,
  publishable: Set<string>,
): boolean {
  const prefix = `${project}/out/`;
  if (!repoPath.startsWith(prefix) || !repoPath.toLowerCase().endsWith('.png')) return false;
  const name = repoPath.slice(prefix.length);
  if (name.includes('/')) return false;
  return !publishable.has(name.replace(/\.png$/i, ''));
}

export interface SyncPlan {
  update: string[];
  unchanged: string[];
  /** Deliberately not named `deleted`: these have not happened yet. */
  delete: string[];
}

/**
 * What one project's folder has to do to the repo to match it. Deletions are
 * confined to that project's prefix — a bug here would remove another mod's
 * files, or the repo's own, so it is kept apart from the I/O and tested.
 */
export function planSync(opts: {
  project: string;
  local: Map<string, string>;
  remote: Map<string, string>;
  generated: Set<string>;
}): SyncPlan {
  const { project, local, remote, generated } = opts;
  const update: string[] = [];
  const unchanged: string[] = [];

  for (const [path, sha] of local) {
    if (generated.has(path)) continue;
    if (remote.get(path) === sha) unchanged.push(path);
    else update.push(path);
  }

  /*
   * Anything the repo still holds under this project that is no longer on disk:
   * renders whose content file was deleted, and files from tools that no longer
   * write there. The generated pair is excluded because it is committed
   * separately, after this commit's SHA exists to pin URLs to.
   */
  const remove = [...remote.keys()].filter(
    (p) => p.startsWith(`${project}/`) && !local.has(p) && !generated.has(p),
  );

  return { update: update.sort(), unchanged: unchanged.sort(), delete: remove.sort() };
}

export interface PendingChanges {
  /** Render names (out/<name>.png) whose bytes differ from the repo. */
  images: string[];
  /** Non-image source files (description text, content yaml, assets) that differ. */
  sources: string[];
  /** Repo files under the project no longer present locally, which publish would remove. */
  deletes: string[];
}

/**
 * Splits planSync's flat update list into image renders and everything else. The
 * editor shows the two differently, and only the images carry a name the render
 * list can badge. Pure, so it is unit-tested without reaching the network.
 */
export function splitPending(
  project: string,
  update: string[],
): { images: string[]; sources: string[] } {
  const outPrefix = `${project}/out/`;
  const images: string[] = [];
  const sources: string[] = [];
  for (const p of update) {
    if (p.startsWith(outPrefix) && p.toLowerCase().endsWith('.png'))
      images.push(p.slice(outPrefix.length).replace(/\.png$/i, ''));
    else sources.push(p);
  }
  return { images: images.sort(), sources: sources.sort() };
}

/**
 * The read-only half of {@link publish}: what a publish would change, without
 * writing anything. The editor's publish button uses it to know whether there is
 * anything to do. It has to weigh every project file, not just the rendered
 * PNGs — a text-only edit to description.txt changes no image but is still a real
 * change, and an image-only view of "pending" left the button dead for it.
 */
export async function pendingSync(
  ws: Workspace,
  token: string,
  ready: string[],
): Promise<PendingChanges> {
  const gh = new GitHub(ws.repo, token);
  const headSha = await gh.headCommitSha(ws.branch);
  const existing = new Map(
    (await gh.listTree(await gh.treeShaOfCommit(headSha)))
      .filter((e) => e.type === 'blob')
      .map((e) => [e.path, e.sha]),
  );

  const generatedPaths = new Set([
    `${ws.project}/description/urls.yaml`,
    `${ws.project}/out/description.bbcode`,
  ]);

  const publishable = new Set(ready);
  const local = new Map<string, string>();
  for (const repoPath of await localProjectFiles(ws)) {
    if (isOrphanRender(repoPath, ws.project, publishable)) continue;
    local.set(repoPath, gitBlobSha(await readFile(join(ws.root, repoPath))));
  }

  const plan = planSync({ project: ws.project, local, remote: existing, generated: generatedPaths });
  const { images, sources } = splitPending(ws.project, plan.update);
  return { images, sources, deletes: plan.delete };
}

export interface PublishOptions {
  /** Report the plan without creating blobs, commits, or generated files. */
  dryRun?: boolean;
}

export async function publish(
  ws: Workspace,
  token: string,
  onProgress: (line: string) => void = () => {},
  options: PublishOptions = {},
): Promise<PublishResult> {
  const dryRun = options.dryRun ?? false;
  if (!token) {
    throw new Error(
      'No GITHUB_TOKEN set.\n' +
        '  Copy .env.example to .env and add a fine-grained token with\n' +
        '  "Contents: Read and write" on the workshop-assets repo only.',
    );
  }
  if (ws.repo.startsWith('CHANGE-ME/')) {
    throw new Error(
      `swdh.workspace.json still has the placeholder repo name.\n` +
        `  Set "repo" to your actual "owner/workshop-assets".`,
    );
  }

  const { ready, missing, stale } = await publishablePngs(ws.contentDir, ws.outDir);
  if (missing.length > 0) {
    throw new Error(
      `These content files have no rendered PNG — run a build first:\n` +
        missing.map((m) => `  - ${m}`).join('\n'),
    );
  }
  if (stale.length > 0) {
    throw new Error(
      `These content files changed after their PNG was rendered — run a build first,\n` +
        `or publishing would upload the previous version:\n` +
        stale.map((s) => `  - ${s}`).join('\n'),
    );
  }
  if (ready.length === 0) {
    throw new Error(`No content in ${ws.project}/content/.`);
  }

  const gh = new GitHub(ws.repo, token);

  onProgress(`Reading ${ws.repo}@${ws.branch}…`);
  const headSha = await gh.headCommitSha(ws.branch);
  await assertCloneCurrent(ws, headSha);

  const baseTreeSha = await gh.treeShaOfCommit(headSha);
  const existing = new Map(
    (await gh.listTree(baseTreeSha)).filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]),
  );

  /*
   * urls.yaml and description.bbcode embed the SHA of the commit being built,
   * so they cannot be part of it. Held back here and written in a second commit
   * below, rather than being published a version behind on every run.
   */
  const generatedPaths = new Set([
    `${ws.project}/description/urls.yaml`,
    `${ws.project}/out/description.bbcode`,
  ]);

  /*
   * Orphaned renders are excluded rather than mirrored: publishing one puts a
   * binary in git history permanently for content that no longer exists. Being
   * absent from the local set, any already in the repo are deleted from it.
   */
  const publishable = new Set(ready);
  const contents = new Map<string, Buffer>();
  for (const repoPath of await localProjectFiles(ws)) {
    if (isOrphanRender(repoPath, ws.project, publishable)) {
      onProgress(`  orphan   ${repoPath} (no content file)`);
      continue;
    }
    contents.set(repoPath, await readFile(join(ws.root, repoPath)));
  }

  const plan = planSync({
    project: ws.project,
    local: new Map([...contents].map(([p, c]) => [p, gitBlobSha(c)])),
    remote: existing,
    generated: generatedPaths,
  });

  const changed = plan.update.map((repoPath) => ({ repoPath, content: contents.get(repoPath)! }));
  const { unchanged, delete: deleted } = plan;

  let sha = headSha;
  let committed = false;

  if (dryRun) {
    for (const file of changed) onProgress(`  would update  ${file.repoPath}`);
    for (const path of deleted) onProgress(`  would delete  ${path}`);
    if (changed.length === 0 && deleted.length === 0) {
      onProgress('  everything already matches the repo');
    }
    onProgress(`\n  urls.yaml and description.bbcode would be rewritten and committed.`);
    return {
      sha: headSha,
      uploaded: changed.map((c) => c.repoPath),
      unchanged,
      deleted,
      urls: {},
      committed: false,
      cloneSynced: false,
    };
  }

  if (changed.length === 0 && deleted.length === 0) {
    onProgress('Every file already matches the repo; nothing to commit.');
  } else {
    onProgress(`Syncing ${changed.length} file(s), removing ${deleted.length}…`);
    const entries: TreeChange[] = [];
    for (const file of changed) {
      entries.push({ path: file.repoPath, sha: await gh.createBlob(file.content) });
      onProgress(`  updated  ${file.repoPath}`);
    }
    for (const path of deleted) {
      entries.push({ path, sha: null });
      onProgress(`  deleted  ${path}`);
    }

    onProgress('Creating commit…');
    const treeSha = await gh.createTree(baseTreeSha, entries);
    sha = await gh.createCommit(
      `Publish ${ws.project} (${changed.length} changed, ${deleted.length} removed)`,
      treeSha,
      headSha,
    );
    await gh.updateRef(ws.branch, sha);
    committed = true;
  }

  // URLs can only be written now: the SHA does not exist until the commit does.
  //
  // Only description images get one. Carousel and preview images are uploaded
  // to Steam by hand, so mapping them would fill urls.yaml with entries the
  // description can never reference — and make the "never referenced" report
  // useless by always firing.
  const urls: Record<string, string> = {};
  for (const name of ready) {
    const content = await loadContent(join(ws.contentDir, `${name}.yaml`)).catch(() => null);
    if (content && !isDescriptionImage(content)) continue;
    urls[name] = jsDelivrUrl(ws.repo, sha, `${ws.project}/out/${name}.png`);
  }

  const urlsFile = join(ws.descriptionDir, 'urls.yaml');
  const original = await readFile(urlsFile, 'utf8').catch(() => null);
  const urlsText = original === null ? writeYamlNew(urls) : writeYamlPreserving(original, urls);
  await writeFile(urlsFile, urlsText, 'utf8');

  const assembled = await assembleToFile(
    join(ws.descriptionDir, 'description.txt'),
    urlsFile,
    join(ws.outDir, 'description.bbcode'),
  );

  /*
   * A second commit, because both files embed the SHA of the first one and so
   * cannot be part of it. Without this they stay dirty in the working tree
   * after every publish, leaving generated files to be committed by hand.
   */
  const generated = await commitGenerated(gh, ws, sha, [
    { path: `${ws.project}/description/urls.yaml`, content: Buffer.from(urlsText, 'utf8') },
    {
      path: `${ws.project}/out/description.bbcode`,
      content: Buffer.from(assembled.output, 'utf8'),
    },
  ], onProgress);

  // Publishing pushed 1-2 commits through the API, so the clone's HEAD is now
  // behind the branch even though its files already match. Realign it here so
  // the next publish is not refused and the user never has to `git pull` a
  // publish commit into local edits — the source of the merge conflicts.
  const { cloneSynced, cloneSyncNote } = await syncClone(ws, token, committed || generated, onProgress);

  return {
    sha,
    uploaded: changed.map((c) => c.repoPath),
    unchanged,
    deleted,
    urls,
    committed: committed || generated,
    cloneSynced,
    cloneSyncNote,
  };
}

/**
 * Fast-forwards the local clone onto the freshly pushed branch head, leaving the
 * working tree untouched. Never fails the publish: the commit is already on
 * GitHub, so any problem here just falls back to the manual catch-up note.
 */
async function syncClone(
  ws: Workspace,
  token: string,
  didCommit: boolean,
  onProgress: (line: string) => void,
): Promise<{ cloneSynced: boolean; cloneSyncNote?: string }> {
  if (!didCommit) return { cloneSynced: false };

  const manual =
    `Catch up by hand — this discards nothing, it only moves the branch pointer:\n` +
    `    git -C ${ws.root} fetch origin ${ws.branch}\n` +
    `    git -C ${ws.root} reset --mixed origin/${ws.branch}`;

  try {
    // Token in the URL, so a clone whose remote is SSH or private still fetches.
    const fetchUrl = `https://x-access-token:${token}@github.com/${ws.repo}.git`;
    const result = await repo.fastForwardClone(ws.root, ws.branch, fetchUrl);

    if (result.ok) {
      onProgress(`Local clone fast-forwarded to ${(result.to ?? '').slice(0, 7)} — ready for the next publish.`);
      return { cloneSynced: true };
    }

    const note = `Local clone not synced: ${result.reason}.\n${manual}`;
    onProgress(note);
    return { cloneSynced: false, cloneSyncNote: note };
  } catch {
    // Redacted: a raw git error can echo the token-bearing fetch URL.
    const note = `Local clone not synced (unexpected git error).\n${manual}`;
    onProgress(note);
    return { cloneSynced: false, cloneSyncNote: note };
  }
}

/**
 * Everything under the project folder that git would keep, so `.gitignore`
 * decides what is project material rather than a second list here that would
 * drift from it.
 */
async function localProjectFiles(ws: Workspace): Promise<string[]> {
  if (!(await repo.isRepo(ws.root))) {
    throw new Error(
      `${ws.root} is not a git repository, so publishing cannot tell project files\n` +
        `  from scratch files. Run "swdh link <repo-url>" to set it up.`,
    );
  }
  return repo.projectFiles(ws.root, ws.project);
}

/**
 * Publishing writes through the API, so local files win every path it touches
 * and stale ones would overwrite — or, being a mirror, delete — work the clone
 * has not seen. Uncommitted changes are fine and expected; it is the commit the
 * clone sits on that has to match.
 */
async function assertCloneCurrent(ws: Workspace, remoteSha: string): Promise<void> {
  const { synced, behind, ahead } = await repo.divergence(ws.root, remoteSha);
  if (synced) return;

  const head = `${ws.repo}@${ws.branch} is at ${remoteSha.slice(0, 7)}`;

  // Ahead only: nothing on the branch is missing locally, but publishing would
  // build on a commit that does not contain the local ones and strand them.
  if (behind === 0 && ahead > 0) {
    throw new Error(
      `Local clone has ${ahead} commit(s) the branch does not, and ${head}.\n` +
        `  Publishing would build on it and leave the two diverged.\n\n` +
        `    git -C ${ws.root} push\n\n` +
        `  then publish again.`,
    );
  }

  const missing = behind === null ? 'commits' : `${behind} commit(s)`;
  throw new Error(
    `Local clone is missing ${missing} from the branch; ${head}.\n` +
      `  Publishing replaces and deletes files using the local copy, so it would\n` +
      `  undo whatever those commits changed. Catch the clone up first — fetch, then\n` +
      `  move the branch pointer WITHOUT a merge, so your uncommitted edits are kept\n` +
      `  and nothing conflicts:\n\n` +
      `    git -C ${ws.root} fetch origin ${ws.branch}\n` +
      `    git -C ${ws.root} reset --mixed origin/${ws.branch}\n\n` +
      `  then publish again. Avoid \`git pull\`: it merges the last publish commit into\n` +
      `  your edits, which is what turns into a conflict. (After a normal publish the\n` +
      `  clone is fast-forwarded for you; this only shows when it fell behind another way.)` +
      (ahead > 0
        ? `\n\n  The clone also has ${ahead} commit(s) of its own, which reset --mixed turns\n` +
          `  back into uncommitted changes. To keep them as commits, rebase onto\n` +
          `  origin/${ws.branch} instead.`
        : ''),
  );
}

/** Commits urls.yaml and description.bbcode on top of the image commit. */
async function commitGenerated(
  gh: GitHub,
  ws: Workspace,
  parentSha: string,
  files: Array<{ path: string; content: Buffer }>,
  onProgress: (line: string) => void,
): Promise<boolean> {
  const treeSha = await gh.treeShaOfCommit(parentSha);
  const existing = new Map(
    (await gh.listTree(treeSha)).filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]),
  );

  const changed = files.filter((f) => existing.get(f.path) !== gitBlobSha(f.content));
  if (changed.length === 0) return false;

  onProgress('Committing urls.yaml and description.bbcode…');
  const entries: Array<{ path: string; sha: string }> = [];
  for (const file of changed) {
    entries.push({ path: file.path, sha: await gh.createBlob(file.content) });
  }

  const sha = await gh.createCommit(
    `Publish ${ws.project} description`,
    await gh.createTree(treeSha, entries),
    parentSha,
  );
  await gh.updateRef(ws.branch, sha);
  return true;
}
