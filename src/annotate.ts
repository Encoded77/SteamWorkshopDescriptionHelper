import { html, inline, raw, type RawHtml } from './html.js';
import type { Size } from './imagesize.js';

/*
 * Coordinates are authored in source-image pixels and converted here to
 * percentages of the rendered box, so they hold at any render scale.
 */

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** Where the leader touches the label, in source-image pixels. */
export interface LabelAnchor {
  x: number;
  y: number;
}

export interface Annotation {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  /**
   * Which face of the highlight the leader leaves by, and so which face of the
   * label it enters. Also the image border the label pins to when unplaced.
   */
  side: Side;
  /**
   * Free position for the label, anywhere in the image. Omitted pins it to the
   * `side` border, centred on the highlight — which is what makes two
   * highlights at a similar height collide. Placing one is the fix.
   */
  at?: LabelAnchor;
}

export interface AnnotatedImageOptions {
  dataUri: string;
  natural: Size;
  annotations: Annotation[];
  /**
   * Fixed canvas to contain the image within, for preview surfaces. Omitted for
   * description blocks, where images flow at full column width.
   */
  containIn?: { width: number; height: number };
  /** Content file name, used in coordinate errors. */
  label: string;
  /** Strength of the dim outside the highlights, 0 to 1. 0 disables it. */
  dim?: number;
  /** Permit enlarging past the screenshot's own size to fill `containIn`. */
  upscale?: boolean;
}

const pct = (n: number): string => `${(n * 100).toFixed(4)}%`;

/** Gap between a pinned label and the edge of the image it sits against. */
const LABEL_INSET = 8;

/**
 * How far the leader runs straight out of the highlight before it turns toward
 * a placed label, as a fraction of the dimension it crosses. Proportional
 * rather than a fixed pixel count, so the elbow keeps its shape whether the
 * image renders 630px wide in a description or 1100px in the carousel.
 */
const STUB_FRACTION = 0.03;
const STUB_MIN = 8;

const isVertical = (side: Side): boolean => side === 'left' || side === 'right';

/** The point on the highlight the leader leaves from. */
function exitPoint(a: Annotation): { x: number; y: number } {
  const cx = a.x + a.width / 2;
  const cy = a.y + a.height / 2;
  switch (a.side) {
    case 'right':
      return { x: a.x + a.width, y: cy };
    case 'left':
      return { x: a.x, y: cy };
    case 'bottom':
      return { x: cx, y: a.y + a.height };
    case 'top':
      return { x: cx, y: a.y };
  }
}

export function annotatedImage(o: AnnotatedImageOptions): RawHtml {
  const { width: W, height: H } = o.natural;
  validate(o.annotations, o.natural, o.label);

  // A contained image is letterboxed, so the wrapper is sized to the fitted box
  // rather than the canvas. Computing it here keeps the annotation overlay
  // exactly coincident with the image, which is what makes percentage
  // coordinates land correctly.
  // Capped at the screenshot's own width, so a wider panel never stretches it.
  let wrapperStyle = `aspect-ratio: ${W} / ${H}; max-width: ${W}px; margin-inline: auto;`;
  if (o.containIn) {
    const fit = Math.min(o.containIn.width / W, o.containIn.height / H);
    const scale = o.upscale ? fit : Math.min(fit, 1);
    wrapperStyle = `width: ${Math.round(W * scale)}px; height: ${Math.round(H * scale)}px;`;
  }

  const parts: RawHtml[] = [
    html`<img class="anno__img" src="${o.dataUri}" alt="" />`,
  ];

  const dim = o.dim ?? 0.66;
  if (o.annotations.length > 0) {
    if (dim > 0) parts.push(dimOverlay(o.annotations, o.natural, dim));
    for (const a of o.annotations) {
      parts.push(box(a, o.natural));
      parts.push(leader(a, o.natural));
      parts.push(labelEl(a, o.natural));
    }
  }

  return html`<div class="anno" style="${wrapperStyle}">${parts}</div>`;
}

/** One path covering the image, with the highlights punched out (even-odd fill). */
function dimOverlay(annotations: Annotation[], natural: Size, strength: number): RawHtml {
  const { width: W, height: H } = natural;
  const outer = `M0 0H${W}V${H}H0Z`;
  const holes = annotations
    .map((a) => `M${a.x} ${a.y}H${a.x + a.width}V${a.y + a.height}H${a.x}Z`)
    .join('');

  return raw(
    `<svg class="anno__dim" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"` +
      ` style="--anno-dim: ${strength}">` +
      `<path fill-rule="evenodd" d="${outer}${holes}"/></svg>`,
  );
}

function box(a: Annotation, n: Size): RawHtml {
  const style =
    `left: ${pct(a.x / n.width)}; top: ${pct(a.y / n.height)};` +
    ` width: ${pct(a.width / n.width)}; height: ${pct(a.height / n.height)};`;
  return html`<div class="anno__box" style="${style}"></div>`;
}

const seg = (style: string): RawHtml => html`<div class="anno__leader" style="${style}"></div>`;

/** Leader segments are authored in source pixels, like everything else. */
const hseg = (x1: number, x2: number, y: number, n: Size): RawHtml =>
  seg(
    `left: ${pct(Math.min(x1, x2) / n.width)}; width: ${pct(Math.abs(x2 - x1) / n.width)};` +
      ` top: ${pct(y / n.height)}; height: 1px;`,
  );

const vseg = (y1: number, y2: number, x: number, n: Size): RawHtml =>
  seg(
    `top: ${pct(Math.min(y1, y2) / n.height)}; height: ${pct(Math.abs(y2 - y1) / n.height)};` +
      ` left: ${pct(x / n.width)}; width: 1px;`,
  );

function leader(a: Annotation, n: Size): RawHtml {
  return a.at ? placedLeader(a, a.at, n) : pinnedLeader(a, n);
}

/**
 * Unplaced: one line from the highlight to the image edge. The label's opaque
 * ground covers the far end, so the line needs no knowledge of its width, and
 * the end stops at LABEL_INSET rather than the border so it finishes underneath
 * the label instead of poking out past it.
 */
function pinnedLeader(a: Annotation, n: Size): RawHtml {
  const cx = pct((a.x + a.width / 2) / n.width);
  const cy = pct((a.y + a.height / 2) / n.height);
  let style: string;

  switch (a.side) {
    case 'right':
      style = `top: ${cy}; left: ${pct((a.x + a.width) / n.width)}; right: ${LABEL_INSET}px; height: 1px;`;
      break;
    case 'left':
      style = `top: ${cy}; left: ${LABEL_INSET}px; right: calc(100% - ${pct(a.x / n.width)}); height: 1px;`;
      break;
    case 'top':
      style = `left: ${cx}; top: ${LABEL_INSET}px; bottom: calc(100% - ${pct(a.y / n.height)}); width: 1px;`;
      break;
    case 'bottom':
      style = `left: ${cx}; top: ${pct((a.y + a.height) / n.height)}; bottom: ${LABEL_INSET}px; width: 1px;`;
      break;
  }
  return seg(style);
}

/**
 * Placed: out of the highlight perpendicular to its face, along to the label's
 * position, then in to the anchor. The anchor is exactly where the last segment
 * ends, so the leader always meets the label whatever the text does to its size.
 * Collapses to one segment when the two already line up.
 */
function placedLeader(a: Annotation, at: LabelAnchor, n: Size): RawHtml {
  const from = exitPoint(a);
  const stub = Math.max(STUB_MIN, (isVertical(a.side) ? n.width : n.height) * STUB_FRACTION);
  const parts: RawHtml[] = [];

  if (isVertical(a.side)) {
    if (Math.abs(at.y - from.y) < 0.5) {
      parts.push(hseg(from.x, at.x, from.y, n));
    } else {
      const turn =
        a.side === 'right'
          ? Math.min(from.x + stub, at.x)
          : Math.max(from.x - stub, at.x);
      parts.push(hseg(from.x, turn, from.y, n));
      parts.push(vseg(from.y, at.y, turn, n));
      parts.push(hseg(turn, at.x, at.y, n));
    }
  } else {
    if (Math.abs(at.x - from.x) < 0.5) {
      parts.push(vseg(from.y, at.y, from.x, n));
    } else {
      const turn =
        a.side === 'bottom'
          ? Math.min(from.y + stub, at.y)
          : Math.max(from.y - stub, at.y);
      parts.push(vseg(from.y, turn, from.x, n));
      parts.push(hseg(from.x, at.x, turn, n));
      parts.push(vseg(turn, at.y, at.x, n));
    }
  }

  return raw(parts.map((p) => p.value).join(''));
}

function labelEl(a: Annotation, n: Size): RawHtml {
  const style = a.at ? placedLabelStyle(a.side, a.at, n) : pinnedLabelStyle(a, n);
  return html`<div class="anno__label" data-callout style="${style}">${inline(a.text)}</div>`;
}

function pinnedLabelStyle(a: Annotation, n: Size): string {
  const cx = pct((a.x + a.width / 2) / n.width);
  const cy = pct((a.y + a.height / 2) / n.height);
  switch (a.side) {
    case 'right':
      return `top: ${cy}; right: ${LABEL_INSET}px; transform: translateY(-50%);`;
    case 'left':
      return `top: ${cy}; left: ${LABEL_INSET}px; transform: translateY(-50%);`;
    case 'top':
      return `top: ${LABEL_INSET}px; left: ${cx}; transform: translateX(-50%);`;
    case 'bottom':
      return `bottom: ${LABEL_INSET}px; left: ${cx}; transform: translateX(-50%);`;
  }
}

/** The anchor is the face the leader arrives at; the label grows away from it. */
function placedLabelStyle(side: Side, at: LabelAnchor, n: Size): string {
  const x = pct(at.x / n.width);
  const y = pct(at.y / n.height);
  switch (side) {
    case 'right':
      return `left: ${x}; top: ${y}; transform: translateY(-50%);`;
    case 'left':
      return `right: calc(100% - ${x}); top: ${y}; transform: translateY(-50%);`;
    case 'top':
      return `left: ${x}; bottom: calc(100% - ${y}); transform: translateX(-50%);`;
    case 'bottom':
      return `left: ${x}; top: ${y}; transform: translateX(-50%);`;
  }
}

function validate(annotations: Annotation[], n: Size, label: string): void {
  const problems: string[] = [];

  annotations.forEach((a, i) => {
    const where = `annotation ${i + 1} ("${a.text}")`;
    if (a.width <= 0 || a.height <= 0) {
      problems.push(`  - ${where}: width and height must be positive`);
      return;
    }
    if (a.x < 0 || a.y < 0 || a.x + a.width > n.width || a.y + a.height > n.height) {
      problems.push(
        `  - ${where}: region ${a.x},${a.y} ${a.width}x${a.height} ` +
          `falls outside the image (${n.width}x${n.height})`,
      );
    }
    if (a.at) problems.push(...anchorProblems(a, a.at, n, where));
  });

  if (problems.length) {
    throw new Error(`${label}: invalid annotation coordinates\n${problems.join('\n')}`);
  }
}

/**
 * The anchor has to lie beyond the face the leader leaves by, or the elbow
 * doubles back across the highlight it is pointing at.
 */
function anchorProblems(a: Annotation, at: LabelAnchor, n: Size, where: string): string[] {
  if (at.x < 0 || at.y < 0 || at.x > n.width || at.y > n.height) {
    return [
      `  - ${where}: label at ${at.x},${at.y} falls outside the image (${n.width}x${n.height})`,
    ];
  }

  const beyond = {
    right: at.x >= a.x + a.width,
    left: at.x <= a.x,
    bottom: at.y >= a.y + a.height,
    top: at.y <= a.y,
  }[a.side];

  return beyond
    ? []
    : [
        `  - ${where}: label at ${at.x},${at.y} is not to the ${a.side} of the region ` +
          `${a.x},${a.y} ${a.width}x${a.height}; move the label or change side`,
      ];
}
