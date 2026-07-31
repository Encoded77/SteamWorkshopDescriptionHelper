import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { buildDocument } from './document.js';
import { banner, block, card, steps } from './components.js';
import { coverShot, previewFullbleed, previewScreenshot, previewTitle, type Crop } from './previews.js';
import { annotatedImage, type Annotation } from './annotate.js';
import { loadTheme, themeCss } from './theme.js';
import { html, raw, type RawHtml } from './html.js';
import { Renderer, PREVIEW_HEIGHT, PREVIEW_WIDTH } from './render.js';
import { PREVIEW_BYTE_LIMIT, fmt, type OptimizeResult } from './optimize.js';
import {
  embedAsset,
  embedImage,
  inline,
  isPreview,
  loadContent,
  renderBody,
  type Content,
} from './content.js';

/* Carousel vertical budget, in canvas pixels. The title and caption bands are
 * kept in step with the type sizes in annotate.css; see the carousel case. */
const CAROUSEL_PAD = 24;
const CAROUSEL_GAP = 14;
const CAROUSEL_TITLE_BAND = 64;
const CAROUSEL_CAPTION_BAND = 92;

/** Cover is a plain image; contained or annotated needs the intrinsic size. */
async function previewMedia(
  src: string,
  fit: 'cover' | 'contain',
  crop: Crop,
  annotations: Annotation[],
  projectRoot: string,
  dim?: number,
): Promise<RawHtml> {
  if (fit === 'cover' && annotations.length === 0) {
    return coverShot(await embedAsset(src, projectRoot), crop);
  }

  const { uri, size } = await embedImage(src, projectRoot);
  const inner = annotatedImage({
    dataUri: uri,
    natural: size,
    annotations,
    containIn: { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT },
    label: src,
    dim,
  });
  return html`<div class="preview-contain">${inner}</div>`;
}

/**
 * SVG icons are inlined rather than embedded as a data URI: an <img> is an
 * isolated document and cannot see the page's CSS variables, so a themed accent
 * would never reach it.
 */
async function iconMarkup(src: string, projectRoot: string): Promise<RawHtml> {
  if (extname(src).toLowerCase() === '.svg') {
    return raw(await readFile(resolve(projectRoot, src), 'utf8'));
  }
  return html`<img src="${await embedAsset(src, projectRoot)}" alt="" />`;
}

/** Wraps a component in the element the renderer screenshots. */
function capture(inner: RawHtml, size: { width: number; height?: number }): RawHtml {
  const style = size.height
    ? `width: ${size.width}px; height: ${size.height}px;`
    : `width: ${size.width}px;`;
  return html`<div id="capture" style="${style}">${inner}</div>`;
}

export async function contentToHtml(content: Content, projectRoot: string): Promise<string> {
  let component: RawHtml;

  switch (content.type) {
    case 'banner':
      component = banner({ title: content.title, kicker: content.kicker });
      break;

    case 'block':
      component = block({
        title: content.title,
        body: await renderBody(content.body, projectRoot),
      });
      break;

    case 'card':
      component = card({
        title: content.title,
        eyebrow: content.eyebrow,
        icon: await iconMarkup(content.icon, projectRoot),
        body: await renderBody(content.body, projectRoot),
      });
      break;

    case 'steps': {
      if (content.layout === 'chips') {
        if (content.steps.length > 4) {
          throw new Error(
            `layout: chips supports at most 4 steps (${content.steps.length} given).\n` +
              `  Use layout: spine for longer sequences — the column has no room for 5 chips.`,
          );
        }
        const annotated = content.steps.find((s) => s.image?.annotations?.length);
        if (annotated) {
          throw new Error(
            `layout: chips cannot carry annotated images ("${annotated.title}").\n` +
              `  A chip's image is a small cap with no room for callouts. Use layout: spine,\n` +
              `  or drop the annotations from that step.`,
          );
        }
      }

      // Spine reuses the block/card image path, so captions and annotations
      // behave identically; a chip takes a plain cover image instead.
      const stepViews = await Promise.all(
        content.steps.map(async (s, i) => ({
          n: i + 1,
          title: s.title,
          body: s.body,
          tag: s.tag,
          media: s.image
            ? content.layout === 'chips'
              ? html`<img class="swdh-chip__img" src="${await embedAsset(s.image.src, projectRoot)}" alt="" />`
              : await renderBody([{ image: s.image }], projectRoot)
            : undefined,
        })),
      );

      component = steps({
        title: content.title,
        eyebrow: content.eyebrow,
        icon: content.icon ? await iconMarkup(content.icon, projectRoot) : undefined,
        layout: content.layout,
        steps: stepViews,
      });
      break;
    }

    case 'preview-title':
      component = previewTitle({
        name: content.name,
        tagline: content.tagline,
        kicker: content.kicker,
        flag: content.flag,
      });
      break;

    case 'preview-screenshot': {
      const annotations = content.annotations ?? [];

      if (annotations.length && content.fit !== 'contain') {
        throw new Error(
          `Annotated preview requires "fit: contain".\n` +
            `  With "fit: cover" the image is cropped to fill the canvas, so annotation\n` +
            `  coordinates would no longer land where you placed them — and a highlight\n` +
            `  could be cropped out of the image entirely.`,
        );
      }

      component = previewScreenshot({
        media: await previewMedia(
          content.screenshot,
          content.fit,
          content.crop,
          annotations,
          projectRoot,
          content.dim,
        ),
        overlay: content.overlay,
        flag: content.flag,
      });
      break;
    }

    case 'preview-fullbleed':
      component = previewFullbleed({
        media: coverShot(await embedAsset(content.screenshot, projectRoot), content.crop),
        mark: content.mark,
        flag: content.flag,
      });
      break;

    case 'carousel': {
      const { uri, size } = await embedImage(content.screenshot, projectRoot);

      // The image box is computed here so the annotation overlay coincides with
      // it, so the title and caption bands must be subtracted from the canvas.
      // Bands are generous (title one line, caption up to two) — over-reserving
      // only shrinks the centred image a little; under-reserving clips it, since
      // the panel hides overflow. Kept in step with the sizes in annotate.css.
      let reservedV = CAROUSEL_PAD * 2;
      if (content.title) reservedV += CAROUSEL_TITLE_BAND + CAROUSEL_GAP;
      if (content.caption) reservedV += CAROUSEL_CAPTION_BAND + CAROUSEL_GAP;

      component = html`<div class="swdh-panel swdh-panel--ticked swdh-carousel">
        ${content.title
          ? html`<div class="swdh-carousel__title">${inline(content.title)}</div>`
          : ''}
        ${annotatedImage({
          dataUri: uri,
          natural: size,
          annotations: content.annotations ?? [],
          label: content.screenshot,
          dim: content.dim,
          upscale: content.upscale,
          containIn: { width: content.width - CAROUSEL_PAD * 2, height: content.height - reservedV },
        })}
        ${content.caption
          ? html`<div class="swdh-carousel__caption">${inline(content.caption)}</div>`
          : ''}
      </div>`;
      break;
    }
  }

  const size = isPreview(content)
    ? { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }
    : content.type === 'carousel'
      ? { width: content.width, height: content.height }
      : { width: 630 };

  return buildDocument({
    body: capture(component, size),
    themeCss: themeCss(await loadTheme(projectRoot)),
  });
}

export interface BuildResult {
  name: string;
  outPath: string;
  height: number;
  bytes: number;
  preview: boolean;
  width: number;
  optimize: OptimizeResult | null;
}

/** One-line status suitable for CLI output. */
export function describe(r: BuildResult): string {
  const dims = `${r.width}x${r.height}`;
  const quant = r.optimize?.quantizedAt ? `  quantized @ q${r.optimize.quantizedAt}` : '';
  return `  ${r.name.padEnd(28)} ${dims.padEnd(11)} ${fmt(r.bytes).padStart(7)}${quant}`;
}

/** Renders every content file, sharing one browser across all of them. */
export async function buildAll(
  contentDir: string,
  outDir: string,
  projectRoot: string,
): Promise<BuildResult[]> {
  const entries = (await readdir(contentDir)).filter((f) =>
    ['.yaml', '.yml'].includes(extname(f).toLowerCase()),
  );

  if (entries.length === 0) {
    throw new Error(`No .yaml files found in ${contentDir}`);
  }

  const renderer = new Renderer();
  await renderer.open();
  const results: BuildResult[] = [];

  try {
    for (const entry of entries.sort()) {
      const name = basename(entry, extname(entry));
      const content = await loadContent(join(contentDir, entry));
      const preview = isPreview(content);

      // Previews and carousel images have a fixed canvas; description images flow.
      const fixed = preview
        ? { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }
        : content.type === 'carousel'
          ? { width: content.width, height: content.height }
          : undefined;

      const outcome = await renderer.render({
        html: await contentToHtml(content, projectRoot),
        outPath: join(outDir, `${name}.png`),
        label: entry,
        ...(fixed ? { fixed } : { width: 630 }),
        // Only previews carry a hard cap: RimWorld rejects an
        // About/Preview.png over 1MB. Carousel sizes are reported, not capped —
        // Steam's gallery limit is not something to guess at.
        ...(preview ? { maxBytes: PREVIEW_BYTE_LIMIT } : {}),
      });
      results.push({ name, preview, width: fixed?.width ?? 630, ...outcome });
    }
  } finally {
    await renderer.close();
  }

  return results;
}
