import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** RimWorld rejects an About/Preview.png larger than this. */
export const PREVIEW_BYTE_LIMIT = 1024 * 1024;

export interface OptimizeResult {
  bytes: number;
  /** Set when quantization ran, describing the quality range that succeeded. */
  quantizedAt: string | null;
}

/** Progressively wider ranges; the first that fits wins, so loss is minimal. */
const QUALITY_STEPS = ['80-95', '65-90', '50-80', '40-70', '25-60'];

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

/**
 * Quantizes a PNG's palette in place until it fits, or does nothing if it
 * already does. The caller is told when it happened, since banding is visible.
 */
export async function ensureUnderLimit(
  path: string,
  limit: number = PREVIEW_BYTE_LIMIT,
): Promise<OptimizeResult> {
  let bytes = await fileSize(path);
  if (bytes <= limit) return { bytes, quantizedAt: null };

  for (const quality of QUALITY_STEPS) {
    try {
      await run('pngquant', [
        `--quality=${quality}`,
        '--speed',
        '1',
        '--force',
        '--strip',
        '--output',
        path,
        '--',
        path,
      ]);
    } catch (err) {
      // 99 means the quality floor was unreachable; try the next range.
      const code = (err as { code?: number }).code;
      if (code === 99) continue;
      throw new Error(
        `pngquant failed on ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    bytes = await fileSize(path);
    if (bytes <= limit) return { bytes, quantizedAt: quality };
  }

  throw new Error(
    `${path} is ${fmt(bytes)} and cannot be brought under ${fmt(limit)} by quantization.\n` +
      `  The screenshot is likely too visually complex. Try a simpler scene, or one with\n` +
      `  fewer distinct colours (less foliage, fewer overlapping items).`,
  );
}

export function fmt(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)}MB`
    : `${Math.round(bytes / 1024)}KB`;
}
