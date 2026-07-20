import { chromium, type Browser, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ensureUnderLimit, fileSize, type OptimizeResult } from './optimize.js';

/** Steam's description column width. Rendered at 2x for high-DPI displays. */
export const LOGICAL_WIDTH = 630;
export const SCALE = 2;

/** RimWorld's About/Preview.png: 640x360 at 2x is the recommended 1280x720. */
export const PREVIEW_WIDTH = 640;
export const PREVIEW_HEIGHT = 360;

export const STEAM_PAGE_BG = '#1b2838';

export interface RenderJob {
  html: string;
  outPath: string;
  /** Exact canvas size. Content that does not fit is an error, not a crop. */
  fixed?: { width: number; height: number };
  /** Viewport width for flowing renders. Defaults to the description column. */
  width?: number;
  /** Quantize the PNG in place if it exceeds this size. */
  maxBytes?: number;
  /** Device scale factor. Fixtures pass 1 so pixel space equals logical space. */
  scale?: number;
  /** Named in error messages. */
  label?: string;
}

export interface RenderOutcome {
  outPath: string;
  height: number;
  bytes: number;
  optimize: OptimizeResult | null;
}

/** Reuses one Chromium instance; launching costs far more than rendering. */
export class Renderer {
  private browser: Browser | null = null;

  async open(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({
      // Subpixel antialiasing makes output depend on the compositor.
      args: ['--disable-lcd-text', '--font-render-hinting=none'],
    });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  async render(job: RenderJob): Promise<RenderOutcome> {
    if (!this.browser) throw new Error('Renderer.open() must be called before render().');

    const viewport = job.fixed ?? { width: job.width ?? LOGICAL_WIDTH, height: 800 };

    const context = await this.browser.newContext({
      viewport,
      deviceScaleFactor: job.scale ?? SCALE,
      // Pinned so locale-dependent shaping cannot vary between machines.
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });

    const page: Page = await context.newPage();
    try {
      await page.setContent(job.html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);

      const target = page.locator('#capture');
      if ((await target.count()) !== 1) {
        throw new Error(
          `Template must contain exactly one #capture element, found ${await target.count()}.`,
        );
      }

      if (job.fixed) await assertFits(page, job.label ?? job.outPath);
      await assertCalloutsPlaced(page, job.label ?? job.outPath);

      const box = await target.boundingBox();
      const buffer = await target.screenshot({ omitBackground: !job.fixed });

      await mkdir(dirname(job.outPath), { recursive: true });
      await writeFile(job.outPath, buffer);

      let optimize: OptimizeResult | null = null;
      let bytes = await fileSize(job.outPath);
      if (job.maxBytes) {
        optimize = await ensureUnderLimit(job.outPath, job.maxBytes);
        bytes = optimize.bytes;
      }

      return {
        outPath: job.outPath,
        height: box ? Math.round(box.height) : 0,
        bytes,
        optimize,
      };
    } finally {
      await context.close();
    }
  }
}

/** Fails when `data-fit` content exceeds a fixed canvas instead of being cropped. */
async function assertFits(page: Page, label: string): Promise<void> {
  const overflows = await page.evaluate(() => {
    const canvas = document.querySelector('#capture')?.getBoundingClientRect();
    if (!canvas) return [];

    return [...document.querySelectorAll('[data-fit]')]
      .map((el) => {
        // Against the parent's content box: centred content can burst its
        // padded area while still sitting inside the canvas.
        let past = 0;
        const parent = el.parentElement;
        if (parent) {
          const ps = getComputedStyle(parent);
          const available =
            parent.clientHeight - parseFloat(ps.paddingTop) - parseFloat(ps.paddingBottom);
          past = el.scrollHeight - available;
        }

        // Backstops: leaving the canvas, and clipping by an own height cap.
        const rect = el.getBoundingClientRect();
        const outside =
          Math.max(0, canvas.top - rect.top) + Math.max(0, rect.bottom - canvas.bottom);
        const clipped = el.scrollHeight - el.clientHeight;

        return {
          name: el.getAttribute('data-fit') ?? 'content',
          overflow: Math.round(Math.max(past, outside, clipped)),
        };
      })
      .filter((r) => r.overflow > 1);
  });

  if (overflows.length === 0) return;

  const detail = overflows.map((o) => `  - ${o.name}: overflows by ${o.overflow}px`).join('\n');
  throw new Error(
    `${label}: content does not fit the fixed preview canvas\n${detail}\n` +
      `  Shorten the text. Type size is not auto-shrunk, so the set stays consistent.`,
  );
}

/** Callout labels are placed explicitly, so collisions and spill are build errors. */
async function assertCalloutsPlaced(page: Page, label: string): Promise<void> {
  const problems = await page.evaluate(() => {
    const found: string[] = [];

    for (const group of document.querySelectorAll('.anno')) {
      const bounds = group.getBoundingClientRect();
      const rects = [...group.querySelectorAll('[data-callout]')].map((el) => ({
        text: (el.textContent ?? '').trim(),
        r: el.getBoundingClientRect(),
      }));

      for (const { text, r } of rects) {
        const spill =
          Math.max(0, bounds.left - r.left) +
          Math.max(0, r.right - bounds.right) +
          Math.max(0, bounds.top - r.top) +
          Math.max(0, r.bottom - bounds.bottom);
        if (spill > 1) {
          found.push(`label "${text}" extends ${Math.round(spill)}px outside the image`);
        }
      }

      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]!;
          const b = rects[j]!;
          const overlaps =
            a.r.left < b.r.right &&
            b.r.left < a.r.right &&
            a.r.top < b.r.bottom &&
            b.r.top < a.r.bottom;
          if (overlaps) found.push(`labels "${a.text}" and "${b.text}" overlap`);
        }
      }
    }
    return found;
  });

  if (problems.length === 0) return;

  throw new Error(
    `${label}: callout labels are not placed cleanly\n` +
      problems.map((p) => `  - ${p}`).join('\n') +
      `\n  Move a label to a different side, or shorten its text.`,
  );
}
