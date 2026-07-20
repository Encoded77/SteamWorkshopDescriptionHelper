import { Command } from 'commander';
import { join } from 'node:path';
import { renderIdentitySheets } from './identity.js';
import { buildAll, describe } from './build.js';
import { startDevServer } from './dev.js';
import { assembleToFile, STEAM_CHAR_LIMIT } from './bbcode.js';
import { makeFixtures } from './fixtures.js';
import { publish } from './publish.js';
import { checkAccess, linkWorkspace } from './link.js';
import { superviseDev } from './supervise.js';
import { loadWorkspace, WORKSPACE_ROOT, type Workspace } from './workspace.js';

/** All paths come from the workspace mounted at /workspace. */

const program = new Command();

program
  .name('swdh')
  .description('Generates branded PNG blocks for Steam Workshop descriptions.')
  .version('0.2.0')
  .option('-p, --project <name>', 'mod folder inside the workspace')
  .option('-w, --workspace <dir>', 'workspace root', WORKSPACE_ROOT);

function opts(): { project?: string; workspace: string } {
  return program.opts();
}

async function workspace(): Promise<Workspace> {
  const { project, workspace: root } = opts();
  const ws = await loadWorkspace(root, project);
  console.log(`  project: ${ws.project}  (${ws.repo}@${ws.branch})\n`);
  return ws;
}

program
  .command('build')
  .description('Render every content/*.yaml to out/.')
  .action(async () => {
    const ws = await workspace();
    const results = await buildAll(ws.contentDir, ws.outDir, ws.projectDir);
    for (const r of results) console.log(describe(r));
    console.log(`\n${results.length} image(s) written to ${ws.project}/out/`);
  });

program
  .command('dev')
  .description('Visual editor with live preview.')
  .action(async () => {
    // The parent process only watches and respawns; the child serves.
    if (!process.env['SWDH_DEV_CHILD']) {
      superviseDev(join(process.cwd(), 'src'));
      return;
    }

    // No project is resolved here: the editor picks one per request.
    await startDevServer({
      workspaceRoot: opts().workspace,
      designDir: join(process.cwd(), 'src/design'),
    });
  });

program
  .command('identity')
  .description('Render the identity specimen sheet (regression check for the design system).')
  .action(async () => {
    const ws = await workspace();
    console.log('Rendering identity specimen...');
    await renderIdentitySheets(join(ws.outDir, 'identity'));
  });

program
  .command('fixtures')
  .description('Generate stand-in screenshots into the project assets folder.')
  .action(async () => {
    const ws = await workspace();
    console.log('Generating fixtures...');
    await makeFixtures(ws.assetsDir);
  });

program
  .command('link')
  .argument('<repo>', 'GitHub URL or owner/name')
  .option('-b, --branch <name>', 'branch to publish to')
  .description('Point the workspace at the GitHub repo that publishes its assets.')
  .action(async (repo: string, cmd: { branch?: string }) => {
    const { workspace: root } = opts();
    const result = await linkWorkspace(root, repo, cmd.branch);

    console.log(`  ${result.previous ? `${result.previous} -> ` : ''}${result.repo}@${result.branch}`);
    console.log(`  written to ${result.file}`);

    if (result.projects.length === 0) {
      console.log(
        `\n  WARNING: no projects in this workspace.\n` +
          `  docker-compose creates the mount directory when it is missing, so a stale\n` +
          `  SWDH_WORKSPACE gives you an empty workspace instead of an error. Check that\n` +
          `  SWDH_WORKSPACE in .env points at your real assets repo.`,
      );
    } else {
      console.log(`  projects: ${result.projects.join(', ')}`);
    }

    const token = process.env['GITHUB_TOKEN'];
    if (!token) {
      console.log(`\n  GITHUB_TOKEN is not set, so access was not checked.`);
      return;
    }

    const access = await checkAccess(result.repo, token);
    console.log(`\n  ${access.ok ? 'Access OK' : 'Cannot publish'}: ${access.detail}`);
    if (!access.ok) process.exitCode = 1;
  });

program
  .command('publish')
  .description('Sync the project folder to the assets repo and pin jsDelivr URLs to that commit.')
  .option('-n, --dry-run', 'report what would change without writing anything')
  .action(async (cmd: { dryRun?: boolean }) => {
    const ws = await workspace();
    const result = await publish(
      ws,
      process.env['GITHUB_TOKEN'] ?? '',
      (line) => console.log(line),
      { dryRun: cmd.dryRun },
    );

    if (cmd.dryRun) {
      console.log(`\n  Dry run: nothing was written.`);
      return;
    }

    console.log(`\n  commit ${result.sha}`);
    console.log(
      `  ${result.uploaded.length} synced, ${result.deleted.length} removed, ` +
        `${result.unchanged.length} unchanged`,
    );
    console.log(`  urls.yaml and description.bbcode rewritten`);

    if (result.committed) {
      console.log(
        `\n  The assets repo has new commits on ${ws.branch}, so your clone is behind and\n` +
          `  the next publish will refuse until it catches up. Every project file on disk\n` +
          `  already matches what was just committed, so this discards nothing:\n\n` +
          `    git -C ${ws.root} checkout -- ${ws.project}\n` +
          `    git -C ${ws.root} pull`,
      );
    }
  });

program
  .command('bbcode')
  .description('Assemble the final description, substituting image placeholders for [img] tags.')
  .action(async () => {
    const ws = await workspace();
    const result = await assembleToFile(
      join(ws.descriptionDir, 'description.txt'),
      join(ws.descriptionDir, 'urls.yaml'),
      join(ws.outDir, 'description.bbcode'),
    );

    const remaining = STEAM_CHAR_LIMIT - result.chars;
    const pct = Math.round((result.chars / STEAM_CHAR_LIMIT) * 100);
    console.log(`  ${result.chars} / ${STEAM_CHAR_LIMIT} characters (${pct}%)`);
    console.log(`  ${remaining >= 0 ? `${remaining} remaining` : `OVER BY ${-remaining}`}`);
    console.log(`  ${result.resolved} image reference(s) resolved`);

    if (result.missing.length) {
      console.log(`\n  Unresolved images (left as placeholders — publish to fill them in):`);
      for (const m of result.missing) console.log(`    - ${m}`);
    }
    if (result.unused.length) {
      console.log(`\n  URL map entries never referenced:`);
      for (const u of result.unused) console.log(`    - ${u}`);
    }

    console.log(`\n  Written to ${ws.project}/out/description.bbcode`);
    if (remaining < 0 || result.missing.length) process.exitCode = 1;
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
