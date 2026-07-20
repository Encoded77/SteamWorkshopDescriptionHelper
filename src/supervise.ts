import { spawn, type ChildProcess } from 'node:child_process';
import chokidar from 'chokidar';

/**
 * Restarts the dev server when its own TypeScript changes; the Node half is
 * otherwise loaded once at boot and a stale schema reports errors against
 * content files that are actually correct.
 *
 * `tsx watch` is not used because its watcher relies on filesystem events,
 * which do not cross a Windows-to-WSL2 bind mount.
 */
export function superviseDev(srcDir: string): void {
  let child: ChildProcess | null = null;
  let restarting = false;

  const args = process.argv.slice(2);

  function start(): void {
    child = spawn('npx', ['tsx', 'src/cli.ts', ...args], {
      stdio: 'inherit',
      // The flag is what stops the child supervising in turn.
      env: { ...process.env, SWDH_DEV_CHILD: '1' },
      // `npx` wraps tsx which wraps node; signalling only the wrapper leaves
      // the server holding the port. Its own group lets the chain be killed.
      detached: true,
    });

    child.on('exit', (code) => {
      // Only follow the child out when it stopped on its own.
      if (restarting) return;
      process.exit(code ?? 0);
    });
  }

  async function restart(path: string): Promise<void> {
    if (restarting || !child) return;
    restarting = true;
    console.log(`\n  ${path} changed — restarting the server...\n`);

    const dead = new Promise<void>((resolve) => child?.once('exit', () => resolve()));
    killGroup(child, 'SIGTERM');
    await dead;

    // The port is not released synchronously with the exit event.
    await new Promise((r) => setTimeout(r, 250));

    restarting = false;
    start();
  }

  function killGroup(proc: ChildProcess, signal: NodeJS.Signals): void {
    if (!proc.pid) return;
    try {
      // Negative pid signals the whole group, which `detached` created.
      process.kill(-proc.pid, signal);
    } catch {
      // Group already gone; fall back to the direct child.
      proc.kill(signal);
    }
  }

  // Polling, for the same bind-mount reason the content watcher polls.
  const watcher = chokidar.watch(srcDir, {
    ignoreInitial: true,
    usePolling: process.env['SWDH_POLL'] !== '0',
    interval: 400,
  });

  let pending: NodeJS.Timeout | null = null;
  const schedule = (path: string) => {
    // CSS is served fresh on every render and already triggers a browser
    // reload, so only TypeScript needs the process to come back up.
    if (!path.endsWith('.ts')) return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => void restart(path), 200);
  };

  watcher.on('add', schedule).on('change', schedule).on('unlink', schedule);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      restarting = true;
      if (child) killGroup(child, signal);
      process.exit(0);
    });
  }

  start();
}
