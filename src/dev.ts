import { createServer, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import { createServer as createViteServer } from 'vite';
import { handleApi } from './server/api.js';
import { listProjects } from './workspace.js';

/**
 * Editor and preview server. Vite runs in middleware mode inside it, so the UI
 * and /api share one origin and one port, and HMR rides the same http server.
 *
 * Bound to a workspace rather than a project: the project comes from a query
 * parameter, so the editor can switch mods without a restart.
 */

const PORT = 5173;

export interface DevOptions {
  workspaceRoot: string;
  designDir: string;
}

export async function startDevServer(opts: DevOptions): Promise<void> {
  const clients = new Set<ServerResponse>();
  const server = createServer();

  const vite = await createViteServer({
    // From this module's location, not the workspace.
    root: fileURLToPath(new URL('../editor', import.meta.url)),
    appType: 'spa',
    server: {
      middlewareMode: true,
      hmr: { server },
      // Native filesystem events do not cross the bind mount, so without
      // polling Vite never invalidates its module cache for editor/ edits.
      watch: {
        usePolling: process.env['SWDH_POLL'] !== '0',
        interval: 300,
      },
      // Assets reach the browser through /api/asset, not the filesystem.
      fs: { strict: true },
    },
  });

  server.on('request', (req, res) => {
    void (async () => {
      if (req.url === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }

      if (await handleApi(req, res, { workspaceRoot: opts.workspaceRoot })) return;
      vite.middlewares(req, res);
    })();
  });

  const projects = await listProjects(opts.workspaceRoot);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Editor ready at http://localhost:${PORT}`);
    console.log(`  projects: ${projects.join(', ') || 'none found'}\n`);
  });

  // Polling: inotify events do not cross the Windows-to-WSL2 bind mount.
  // Set SWDH_POLL=0 on a native Linux filesystem.
  const watcher = chokidar.watch([opts.workspaceRoot, opts.designDir], {
    ignoreInitial: true,
    usePolling: process.env['SWDH_POLL'] !== '0',
    interval: 300,
    binaryInterval: 1000,
    ignored: (path) => path.includes('/.git/'),
  });

  let pending: NodeJS.Timeout | null = null;
  const notify = () => {
    // Editors write a file in several operations; one save, one reload.
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      for (const client of clients) client.write('data: changed\n\n');
    }, 150);
  };

  watcher.on('add', notify).on('change', notify).on('unlink', notify);
}
