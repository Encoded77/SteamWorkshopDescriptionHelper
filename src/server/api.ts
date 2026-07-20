import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, writeFile, readdir, unlink, stat, mkdir } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ContentSchema, type Content } from '../content.js';
import { contentToHtml, buildAll, describe } from '../build.js';
import { imageSize } from '../imagesize.js';
import { assemble, loadUrlMap, STEAM_CHAR_LIMIT } from '../bbcode.js';
import { writeYamlNew, writeYamlPreserving } from './yamlwrite.js';
import { publish, publishablePngs } from '../publish.js';
import { GitHub, gitBlobSha } from '../github.js';
import { isCarousel, isDescriptionImage, loadContent } from '../content.js';
import { ThemeSchema, loadTheme, saveTheme } from '../theme.js';
import { describeContentSchema } from '../schemainfo.js';
import { modIconSvg, renderModIcon } from '../modicon.js';
import { listProjects, loadWorkspace, type Workspace } from '../workspace.js';
import { copyFile, mkdir as mkdirp } from 'node:fs/promises';

/** The server is bound to a workspace, not a project. */
export interface ApiDeps {
  workspaceRoot: string;
}

/** Resolved per request, so the editor can switch projects without a restart. */
interface ApiContext {
  contentDir: string;
  descriptionDir: string;
  outDir: string;
  projectRoot: string;
  workspace: Workspace;
}

async function resolveContext(deps: ApiDeps, project: string | null): Promise<ApiContext> {
  const ws = await loadWorkspace(deps.workspaceRoot, project ?? undefined);
  return {
    workspace: ws,
    contentDir: ws.contentDir,
    descriptionDir: ws.descriptionDir,
    outDir: ws.outDir,
    projectRoot: ws.projectDir,
  };
}

/** Content file names are used to build paths, so they are strictly bounded. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

/** Returns false for non-API paths, so the caller falls through to Vite. */
export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ApiDeps,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;

  try {
    await route(req, res, deps, url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) json(res, 400, { error: message });
  }
  return true;
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ApiDeps,
  url: URL,
): Promise<void> {
  const path = url.pathname.replace(/^\/api\//, '');
  const method = req.method ?? 'GET';
  const segments = path.split('/').filter(Boolean);

  // Project-independent: the editor builds its per-type behaviour from this.
  if (segments[0] === 'schema' && method === 'GET') {
    return json(res, 200, { types: describeContentSchema() });
  }

  // Answered before resolving a project, since it is what the editor uses to
  // pick one.
  if (segments[0] === 'projects' && method === 'GET') {
    return json(res, 200, {
      projects: await listProjects(deps.workspaceRoot),
      preferred: process.env['SWDH_PROJECT'] ?? null,
    });
  }

  const ctx = await resolveContext(deps, url.searchParams.get('project'));

  // ---- content collection ------------------------------------------------
  if (segments[0] === 'content' && segments.length === 1) {
    if (method === 'GET') return json(res, 200, await listContent(ctx));
    if (method === 'POST') {
      const body = (await readJson(req)) as { name?: string; data?: unknown };
      return json(res, 200, await createContent(ctx, body.name, body.data));
    }
  }

  // ---- single content file ----------------------------------------------
  if (segments[0] === 'content' && segments.length === 2) {
    const name = safeName(segments[1]!);
    if (method === 'GET') return json(res, 200, await readContent(ctx, name));
    if (method === 'PUT') {
      const body = (await readJson(req)) as { data?: unknown };
      return json(res, 200, await updateContent(ctx, name, body.data));
    }
    if (method === 'DELETE') {
      await unlink(contentPath(ctx, name));
      return json(res, 200, { ok: true });
    }
  }

  // ---- preview HTML: the exact markup the exporter rasterizes ------------
  if (segments[0] === 'preview' && segments.length === 2) {
    const name = safeName(segments[1]!);
    const { data } = await readContent(ctx, name);
    const html = await contentToHtml(data, ctx.projectRoot);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }

  // Preview of unsaved editor state, through the same markup path as export.
  if (segments[0] === 'preview' && segments.length === 1 && method === 'POST') {
    const body = (await readJson(req)) as { data?: unknown };
    const parsed = ContentSchema.safeParse(body.data);
    if (!parsed.success) {
      return json(res, 200, { ok: false, errors: issues(parsed.error.issues) });
    }
    try {
      const html = await contentToHtml(parsed.data, ctx.projectRoot);
      return json(res, 200, { ok: true, html });
    } catch (err) {
      // Asset and annotation problems are normal mid-edit, not server failures.
      return json(res, 200, { ok: false, errors: [err instanceof Error ? err.message : String(err)] });
    }
  }

  // ---- assets ------------------------------------------------------------
  if (segments[0] === 'assets' && method === 'GET') {
    return json(res, 200, await listAssets(ctx));
  }

  if (segments[0] === 'asset' && method === 'GET') {
    const rel = url.searchParams.get('path') ?? '';
    return serveAsset(res, ctx, rel);
  }

  // ---- build -------------------------------------------------------------
  if (segments[0] === 'build' && method === 'POST') {
    const results = await buildAll(ctx.contentDir, ctx.outDir, ctx.projectRoot);
    return json(res, 200, {
      results: results.map((r) => ({ ...r, line: describe(r).trim() })),
    });
  }

  // ---- description + urls ------------------------------------------------
  if (segments[0] === 'description') {
    if (method === 'GET') return json(res, 200, await readDescription(ctx));
    if (method === 'PUT') {
      const body = (await readJson(req)) as { source?: string; urls?: Record<string, string> };
      if (typeof body.source === 'string') {
        await writeFile(join(ctx.descriptionDir, 'description.txt'), body.source, 'utf8');
      }
      if (body.urls) {
        await writeUrlMap(ctx, body.urls);
      }
      const state = await readDescription(ctx);
      // Keep out/description.bbcode in step with the editor.
      await mkdir(ctx.outDir, { recursive: true });
      await writeFile(join(ctx.outDir, 'description.bbcode'), state.output, 'utf8');
      return json(res, 200, state);
    }
  }

  // ---- theme -------------------------------------------------------------
  if (segments[0] === 'theme') {
    if (method === 'GET') {
      return json(res, 200, { theme: await loadTheme(ctx.projectRoot) });
    }
    if (method === 'PUT') {
      const body = (await readJson(req)) as { theme?: unknown };
      const parsed = ThemeSchema.safeParse(body.theme ?? {});
      if (!parsed.success) {
        return json(res, 200, { ok: false, errors: issues(parsed.error.issues) });
      }
      await saveTheme(ctx.projectRoot, parsed.data);
      return json(res, 200, { ok: true, theme: parsed.data });
    }
  }

  // ---- mod icon ----------------------------------------------------------
  if (segments[0] === 'modicon') {
    // Preview: the same glyph the writer rasterizes, so the form cannot drift.
    if (method === 'GET') {
      const svg = modIconSvg(url.searchParams.get('color') ?? undefined);
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-store',
      });
      res.end(svg);
      return;
    }
    if (method === 'POST') {
      const body = (await readJson(req)) as { color?: string; modFolder?: string };
      return json(res, 200, await writeModIcon(ctx, body.color, body.modFolder));
    }
  }

  // ---- publish -----------------------------------------------------------
  if (segments[0] === 'publish') {
    if (method === 'GET') return json(res, 200, await publishStatus(ctx));
    if (method === 'POST') {
      const log: string[] = [];
      const result = await publish(ctx.workspace, process.env['GITHUB_TOKEN'] ?? '', (line) =>
        log.push(line),
      );
      return json(res, 200, { ...result, log });
    }
  }

  // ---- export a preview render to a mod's About/Preview.png --------------
  if (segments[0] === 'export-preview' && method === 'POST') {
    const body = (await readJson(req)) as { name?: string; modFolder?: string };
    return json(res, 200, await exportPreview(ctx, body.name, body.modFolder));
  }

  json(res, 404, { error: `No API route for ${method} ${url.pathname}` });
}

/* ---------------------------------------------------------------------------
 * Publish
 * ------------------------------------------------------------------------ */

/**
 * Which images differ from the repo. Null when it cannot be determined, so the
 * UI can say "unknown" rather than imply there is nothing to do.
 */
async function pendingUpload(ctx: ApiContext, ready: string[]): Promise<string[] | null> {
  const ws = ctx.workspace;
  const token = process.env['GITHUB_TOKEN'];
  if (!token || ws.repo.startsWith('CHANGE-ME/')) return null;

  try {
    const gh = new GitHub(ws.repo, token);
    const head = await gh.headCommitSha(ws.branch);
    const tree = await gh.listTree(await gh.treeShaOfCommit(head));
    const existing = new Map(
      tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha] as const),
    );

    const pending: string[] = [];
    for (const name of ready) {
      const data = await readFile(join(ctx.outDir, `${name}.png`));
      if (existing.get(`${ws.project}/out/${name}.png`) !== gitBlobSha(data)) pending.push(name);
    }
    return pending;
  } catch {
    return null;
  }
}

/** Mod folders under the SWDH_MODS mount, identified by an About/ directory. */
async function modFolders(): Promise<string[]> {
  if (!process.env['SWDH_MODS']) return [];
  const entries = await readdir('/mods', { withFileTypes: true }).catch(() => []);

  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const hasAbout = await stat(join('/mods', entry.name, 'About')).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (hasAbout) found.push(entry.name);
  }
  return found.sort();
}

async function publishStatus(ctx: ApiContext) {
  const ws = ctx.workspace;
  // Derived from content files, so orphaned renders in out/ are never offered
  // for publishing.
  const { ready, missing, stale } = await publishablePngs(ctx.contentDir, ctx.outDir);
  const urls = await loadUrlMap(join(ctx.descriptionDir, 'urls.yaml'));

  const images = [];
  for (const name of ready) {
    const content = await loadContent(join(ctx.contentDir, `${name}.yaml`)).catch(() => null);
    const kind = !content
      ? 'unknown'
      : isDescriptionImage(content)
        ? 'description'
        : isCarousel(content)
          ? 'carousel'
          : 'preview';
    // A URL only means anything for images the description embeds.
    images.push({ name, file: `${name}.png`, kind, url: kind === 'description' ? (urls[name] ?? null) : null });
  }

  return {
    project: ws.project,
    repo: ws.repo,
    branch: ws.branch,
    // Presence only — the token value never leaves the server.
    hasToken: Boolean(process.env['GITHUB_TOKEN']),
    repoConfigured: !ws.repo.startsWith('CHANGE-ME/'),
    modsMounted: Boolean(process.env['SWDH_MODS']),
    modFolders: await modFolders(),
    /** Content files with no rendered PNG yet — publishing is blocked until built. */
    notRendered: missing,
    /** Rendered before their content file changed — publishing is blocked. */
    stale,
    /** Differ from the repo. null when it could not be determined. */
    pending: await pendingUpload(ctx, ready),
    images,
  };
}

/**
 * Writes About/ModIcon.png. The mod folder defaults to the project name, which
 * is what they are named after.
 */
async function writeModIcon(ctx: ApiContext, color: unknown, modFolder: unknown) {
  if (!process.env['SWDH_MODS']) {
    throw new Error(
      'SWDH_MODS is not set, so the container cannot see your mods folder.\n' +
        '  Add SWDH_MODS=<path to the folder containing your mods> to .env and restart.',
    );
  }

  const folder =
    typeof modFolder === 'string' && modFolder.trim() ? modFolder.trim() : ctx.workspace.project;
  if (!SAFE_NAME.test(folder)) throw new Error(`Invalid mod folder "${folder}".`);

  const aboutDir = join('/mods', folder, 'About');
  const exists = await stat(aboutDir).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!exists) throw new Error(`No About/ directory in ${folder} — is that the right mod folder?`);

  const target = join(aboutDir, 'ModIcon.png');
  const bytes = await renderModIcon(typeof color === 'string' ? color : '#efa62c', target);
  return { ok: true, target: `${folder}/About/ModIcon.png`, bytes };
}

/**
 * Copies a render to a mod's About/Preview.png, which RimWorld's uploader
 * publishes. Only reachable when SWDH_MODS is set.
 */
async function exportPreview(ctx: ApiContext, name: unknown, modFolder: unknown) {
  if (!process.env['SWDH_MODS']) {
    throw new Error(
      'SWDH_MODS is not set, so the container cannot see your mods folder.\n' +
        '  Add SWDH_MODS=<path to the folder containing your mods> to .env and restart.',
    );
  }
  if (typeof name !== 'string' || typeof modFolder !== 'string' || !modFolder.trim()) {
    throw new Error('Both an image name and a mod folder are required.');
  }
  if (!SAFE_NAME.test(modFolder)) {
    throw new Error(`Invalid mod folder "${modFolder}".`);
  }

  const source = join(ctx.outDir, `${safeName(name)}.png`);
  const aboutDir = join('/mods', modFolder, 'About');
  await mkdirp(aboutDir, { recursive: true });
  const target = join(aboutDir, 'Preview.png');
  await copyFile(source, target);

  return { ok: true, target: `${modFolder}/About/Preview.png` };
}

/* ---------------------------------------------------------------------------
 * Content
 * ------------------------------------------------------------------------ */

function contentPath(ctx: ApiContext, name: string): string {
  return join(ctx.contentDir, `${name}.yaml`);
}

function safeName(raw: string): string {
  const name = raw.replace(/\.ya?ml$/i, '');
  if (!SAFE_NAME.test(name)) {
    throw new Error(`Invalid content name "${raw}".`);
  }
  return name;
}

async function listContent(ctx: ApiContext) {
  const files = (await readdir(ctx.contentDir)).filter((f) =>
    ['.yaml', '.yml'].includes(extname(f).toLowerCase()),
  );

  const items = [];
  for (const file of files.sort()) {
    const name = file.replace(/\.ya?ml$/i, '');
    const raw = await readFile(join(ctx.contentDir, file), 'utf8');
    const parsed = ContentSchema.safeParse(parseYaml(raw));
    // Invalid files stay listed so they can be opened and repaired.
    items.push({ name, type: parsed.success ? parsed.data.type : null, valid: parsed.success });
  }
  return items;
}

async function readContent(ctx: ApiContext, name: string) {
  const raw = await readFile(contentPath(ctx, name), 'utf8');
  const parsed = ContentSchema.safeParse(parseYaml(raw));
  if (!parsed.success) {
    throw new Error(`${name}.yaml does not match the schema:\n${issues(parsed.error.issues).join('\n')}`);
  }
  return { name, raw, data: parsed.data as Content };
}

async function updateContent(ctx: ApiContext, name: string, data: unknown) {
  const parsed = ContentSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, errors: issues(parsed.error.issues) };
  }

  const file = contentPath(ctx, name);
  const original = await readFile(file, 'utf8').catch(() => null);
  const text =
    original === null ? writeYamlNew(parsed.data) : writeYamlPreserving(original, parsed.data);

  await writeFile(file, text, 'utf8');
  return { ok: true, raw: text };
}

async function createContent(ctx: ApiContext, rawName: unknown, data: unknown) {
  if (typeof rawName !== 'string') throw new Error('A name is required.');
  const name = safeName(rawName);

  const exists = await stat(contentPath(ctx, name)).then(
    () => true,
    () => false,
  );
  if (exists) throw new Error(`${name}.yaml already exists.`);

  const parsed = ContentSchema.safeParse(data);
  if (!parsed.success) return { ok: false, errors: issues(parsed.error.issues) };

  await writeFile(contentPath(ctx, name), writeYamlNew(parsed.data), 'utf8');
  return { ok: true, name };
}

/* ---------------------------------------------------------------------------
 * Assets
 * ------------------------------------------------------------------------ */

async function listAssets(ctx: ApiContext) {
  const root = join(ctx.projectRoot, 'assets');
  const found: Array<{ path: string; width?: number; height?: number }> = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!IMAGE_EXT.has(extname(entry.name).toLowerCase())) continue;

      const rel = relative(ctx.projectRoot, full).split(sep).join('/');
      // SVGs have no header to read, so they are listed without a size.
      try {
        const size = imageSize(await readFile(full), rel);
        found.push({ path: rel, width: size.width, height: size.height });
      } catch {
        found.push({ path: rel });
      }
    }
  }

  await walk(root);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

async function serveAsset(res: ServerResponse, ctx: ApiContext, rel: string): Promise<void> {
  const abs = resolve(ctx.projectRoot, rel);
  if (!abs.startsWith(resolve(ctx.projectRoot) + sep)) {
    return json(res, 400, { error: 'Path escapes the project directory.' });
  }
  if (!IMAGE_EXT.has(extname(abs).toLowerCase())) {
    return json(res, 400, { error: 'Not an image.' });
  }

  try {
    const data = await readFile(abs);
    res.writeHead(200, { 'Content-Type': mimeFor(abs), 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    json(res, 404, { error: `Asset not found: ${rel}` });
  }
}

function mimeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

/* ---------------------------------------------------------------------------
 * Description
 * ------------------------------------------------------------------------ */

async function readDescription(ctx: ApiContext) {
  const sourceFile = join(ctx.descriptionDir, 'description.txt');
  const urlsFile = join(ctx.descriptionDir, 'urls.yaml');

  const source = await readFile(sourceFile, 'utf8').catch(() => '');
  const urls = await loadUrlMap(urlsFile);
  const result = assemble(source, urls);

  return {
    source,
    urls,
    limit: STEAM_CHAR_LIMIT,
    chars: result.chars,
    missing: result.missing,
    unused: result.unused,
    resolved: result.resolved,
    output: result.output,
  };
}

/** Preserves the file's own comments when adding an entry. */
async function writeUrlMap(ctx: ApiContext, urls: Record<string, string>): Promise<void> {
  const file = join(ctx.descriptionDir, 'urls.yaml');
  const original = await readFile(file, 'utf8').catch(() => null);
  const text = original === null ? writeYamlNew(urls) : writeYamlPreserving(original, urls);
  await writeFile(file, text, 'utf8');
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

function issues(list: Array<{ path: (string | number)[]; message: string }>): string[] {
  return list.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 5 * 1024 * 1024) throw new Error('Request body too large.');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}
