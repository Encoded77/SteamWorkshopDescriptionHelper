import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * The workshop-assets repo, mounted at /workspace, holding swdh.workspace.json
 * and one folder per mod (content, description, assets, out).
 */

export const WORKSPACE_ROOT = '/workspace';

const WorkspaceConfig = z
  .object({
    /** GitHub "owner/name" that jsDelivr URLs are generated against. */
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'must be "owner/name"'),
    branch: z.string().min(1).default('main'),
  })
  .passthrough();

export interface Workspace {
  root: string;
  project: string;
  projectDir: string;
  contentDir: string;
  descriptionDir: string;
  assetsDir: string;
  outDir: string;
  repo: string;
  branch: string;
}

async function isDir(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

/** A project is any top-level folder containing a content/ directory. */
export async function listProjects(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    throw new Error(
      `Workspace not found at ${root}.\n` +
        `  It is bind-mounted from the host by docker-compose. Set SWDH_WORKSPACE\n` +
        `  in .env if your workshop-assets repo is not at ../workshop-assets.`,
    );
  }

  const projects: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (await isDir(join(root, entry.name, 'content'))) projects.push(entry.name);
  }
  return projects.sort();
}

export async function loadWorkspace(root: string, project?: string): Promise<Workspace> {
  const configPath = join(root, 'swdh.workspace.json');

  let config: z.infer<typeof WorkspaceConfig>;
  try {
    config = WorkspaceConfig.parse(JSON.parse(await readFile(configPath, 'utf8')));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(
        `${configPath} is invalid:\n` +
          err.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n'),
      );
    }
    throw new Error(
      `Could not read ${configPath}.\n` +
        `  Expected {"repo": "owner/workshop-assets", "branch": "main"}.`,
    );
  }

  const projects = await listProjects(root);
  if (projects.length === 0) {
    throw new Error(`No projects in ${root}. A project is a folder containing content/.`);
  }

  let chosen = project ?? process.env['SWDH_PROJECT'];
  if (!chosen) {
    // Guessing would silently publish to the wrong mod.
    if (projects.length > 1) {
      throw new Error(
        `Several projects exist; pass --project.\n` +
          projects.map((p) => `  - ${p}`).join('\n'),
      );
    }
    chosen = projects[0]!;
  }

  if (!projects.includes(chosen)) {
    throw new Error(`No project "${chosen}". Available:\n${projects.map((p) => `  - ${p}`).join('\n')}`);
  }

  const projectDir = join(root, chosen);
  return {
    root,
    project: chosen,
    projectDir,
    contentDir: join(projectDir, 'content'),
    descriptionDir: join(projectDir, 'description'),
    assetsDir: join(projectDir, 'assets'),
    outDir: join(projectDir, 'out'),
    repo: config.repo,
    branch: config.branch,
  };
}
