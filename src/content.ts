import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { readFile } from 'node:fs/promises';
import { extname, resolve as resolvePath } from 'node:path';
import { html, inline, raw, type RawHtml } from './html.js';
import { imageSize, type Size } from './imagesize.js';
import { annotatedImage } from './annotate.js';

/*
 * One YAML file under content/ describes one output PNG.
 * `.strict()` throughout, so a misspelled key fails instead of being ignored.
 */

/** Highlighted region, in source-image pixels. */
const AnnotationSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    text: z.string().min(1),
    side: z.enum(['top', 'right', 'bottom', 'left']).default('right'),
    /** Free label position in source pixels; omitted pins it to the `side` border. */
    at: z
      .object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() })
      .strict()
      .optional(),
  })
  .strict();

const ImageSpec = z
  .object({
    /** Relative to the project root, e.g. assets/screenshots/foo.png */
    src: z.string().min(1).describe('asset:screenshot'),
    caption: z.string().optional(),
    annotations: z.array(AnnotationSchema).optional(),
    /** Darkening outside the highlights, 0 to 1. 0 disables it. */
    dim: z.number().min(0).max(1).default(0.66),
  })
  .strict();

const BlockItem = z.union([
  z.object({ p: z.string().min(1) }).strict(),
  z.object({ list: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ image: ImageSpec }).strict(),
]);

const Banner = z
  .object({
    type: z.literal('banner'),
    title: z.string().min(1),
    kicker: z.string().optional(),
  })
  .strict();

const Block = z
  .object({
    type: z.literal('block'),
    title: z.string().optional(),
    body: z.array(BlockItem).min(1),
  })
  .strict();

const Card = z
  .object({
    type: z.literal('card'),
    title: z.string().min(1),
    eyebrow: z.string().optional(),
    icon: z.string().min(1).describe('asset:icon'),
    body: z.array(BlockItem).min(1),
  })
  .strict();

/** One step of a `steps` walkthrough. Body and illustration are both optional. */
const Step = z
  .object({
    title: z.string().min(1),
    body: z.string().min(1).optional(),
    /** Small monospace chip on the step, e.g. a trigger or a reward. */
    tag: z.string().min(1).optional(),
    /** Optional illustration, using the same spec as block and card images. */
    image: ImageSpec.optional(),
  })
  .strict();

/**
 * An ordered, visual walkthrough of one complex feature: what block and card
 * cannot express. `spine` is a vertical numbered list; `chips` is a compact
 * horizontal strip whose extra constraints (<=4 steps, no annotations) are
 * enforced in build.ts, not here, because a discriminatedUnion member cannot be
 * a refined (ZodEffects) schema.
 */
const Steps = z
  .object({
    type: z.literal('steps'),
    title: z.string().min(1),
    eyebrow: z.string().optional(),
    icon: z.string().min(1).describe('asset:icon').optional(),
    layout: z.enum(['spine', 'chips']).default('spine'),
    steps: z.array(Step).min(2).max(8),
  })
  .strict();

/* Preview surfaces: RimWorld About/Preview.png, fixed 640x360. */

/** Which part of a screenshot survives when the visible area is not 16:9. */
const Crop = z.enum(['center', 'top', 'bottom']).default('center');

const PreviewTitle = z
  .object({
    type: z.literal('preview-title'),
    name: z.string().min(1),
    tagline: z.string().optional(),
    kicker: z.string().optional(),
    /** Diagonal corner ribbon, e.g. "1.6". */
    flag: z.string().optional(),
  })
  .strict();

const PreviewScreenshot = z
  .object({
    type: z.literal('preview-screenshot'),
    screenshot: z.string().min(1).describe('asset:screenshot'),
    /** Keep to a few words: previews display small. */
    overlay: z.string().optional(),
    crop: Crop,
    /** `contain` suits a pre-cropped region, where cropping again defeats the point. */
    fit: z.enum(['cover', 'contain']).default('cover'),
    annotations: z.array(AnnotationSchema).optional(),
    dim: z.number().min(0).max(1).default(0.66),
    flag: z.string().optional(),
  })
  .strict();

const PreviewFullbleed = z
  .object({
    type: z.literal('preview-fullbleed'),
    screenshot: z.string().min(1).describe('asset:screenshot'),
    mark: z.string().optional(),
    crop: Crop,
    flag: z.string().optional(),
  })
  .strict();

/** Workshop gallery image: uploaded to Steam by hand, never referenced by the description. */
const Carousel = z
  .object({
    type: z.literal('carousel'),
    screenshot: z.string().min(1).describe('asset:screenshot'),
    /** Large heading above the screenshot, e.g. the feature this slide shows. */
    title: z.string().min(1).optional(),
    caption: z.string().optional(),
    annotations: z.array(AnnotationSchema).optional(),
    dim: z.number().min(0).max(1).default(0.66),
    /*
     * Identical across the carousel so the set is one size. Stay close to the
     * screenshots' own dimensions: a much larger canvas cannot be filled
     * without upscaling, leaving a small picture in an empty frame.
     */
    width: z.number().int().min(320).max(2560).default(1100),
    height: z.number().int().min(320).max(1440).default(850),
    /** Fill the canvas past the screenshot's own size, at the cost of softer text. */
    upscale: z.boolean().default(false),
  })
  .strict();

export const ContentSchema = z.discriminatedUnion('type', [
  Banner,
  Block,
  Card,
  Steps,
  PreviewTitle,
  PreviewScreenshot,
  PreviewFullbleed,
  Carousel,
]);
export type Content = z.infer<typeof ContentSchema>;
export type BlockItemT = z.infer<typeof BlockItem>;
export type ImageSpecT = z.infer<typeof ImageSpec>;

/** Fixed canvas, and a hard file size limit. */
export function isPreview(content: Content): boolean {
  return content.type.startsWith('preview-');
}

export function isCarousel(content: Content): boolean {
  return content.type === 'carousel';
}

/** Embedded in the description, so only these need a hosted URL. */
export function isDescriptionImage(content: Content): boolean {
  return !isPreview(content) && !isCarousel(content);
}

export async function loadContent(file: string): Promise<Content> {
  const text = await readFile(file, 'utf8');

  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (err) {
    throw new Error(`${file}: invalid YAML\n  ${err instanceof Error ? err.message : String(err)}`);
  }

  const result = ContentSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`${file}: does not match the content schema\n${issues}`);
  }
  return result.data;
}

export { inline } from './html.js';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** Inlined as a data URI, so rendering never depends on filesystem access. */
export async function embedAsset(src: string, projectRoot: string): Promise<string> {
  const ext = extname(src).toLowerCase();
  const mime = MIME[ext];
  if (!mime) {
    throw new Error(
      `Unsupported asset type "${ext}" for ${src}. Supported: ${Object.keys(MIME).join(', ')}`,
    );
  }

  const abs = resolvePath(projectRoot, src);
  let data: Buffer;
  try {
    data = await readFile(abs);
  } catch {
    throw new Error(`Asset not found: ${src}\n  Looked in: ${abs}`);
  }
  return `data:${mime};base64,${data.toString('base64')}`;
}

/** Also reports the intrinsic size that annotation coordinates resolve against. */
export async function embedImage(
  src: string,
  projectRoot: string,
): Promise<{ uri: string; size: Size }> {
  const abs = resolvePath(projectRoot, src);
  let data: Buffer;
  try {
    data = await readFile(abs);
  } catch {
    throw new Error(`Asset not found: ${src}\n  Looked in: ${abs}`);
  }
  return { uri: await embedAsset(src, projectRoot), size: imageSize(data, src) };
}

/** Body items, shared by blocks and cards. */
export async function renderBody(items: BlockItemT[], projectRoot: string): Promise<RawHtml> {
  const parts: RawHtml[] = [];
  for (const item of items) {
    if ('p' in item) {
      parts.push(html`<p>${inline(item.p)}</p>`);
    } else if ('list' in item) {
      parts.push(
        html`<ul class="swdh-list">
          ${item.list.map((li) => html`<li>${inline(li)}</li>`)}
        </ul>`,
      );
    } else {
      const spec = item.image;
      let media: RawHtml;

      if (spec.annotations?.length) {
        // Annotations need the intrinsic size, so PNG/JPEG only.
        const { uri, size } = await embedImage(spec.src, projectRoot);
        media = annotatedImage({
          dataUri: uri,
          natural: size,
          annotations: spec.annotations,
          label: spec.src,
          dim: spec.dim,
        });
      } else {
        // No header read, so SVG stays usable.
        const uri = await embedAsset(spec.src, projectRoot);
        media = html`<img src="${uri}" alt="" />`;
      }

      parts.push(
        html`<figure class="swdh-figure">
          ${media}
          ${spec.caption ? html`<figcaption>${inline(spec.caption)}</figcaption>` : ''}
        </figure>`,
      );
    }
  }
  return raw(parts.map((p) => p.value).join('\n'));
}
