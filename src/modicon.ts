import { Renderer } from './render.js';

/**
 * RimWorld's About/ModIcon.png: the identity's hexagon mark, in a chosen
 * colour. Rendered at 64px (vanilla's size) though the game displays it at 32.
 *
 * Colours are resolved to literals here rather than left as CSS variables,
 * because the SVG is rasterized standalone and also served as a preview.
 */

const DEFAULT_COLOR = '#efa62c';

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parse(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('')}`;
}

function mix(hex: string, target: number, amount: number): string {
  const [r, g, b] = parse(hex);
  return toHex([
    r + (target - r) * amount,
    g + (target - g) * amount,
    b + (target - b) * amount,
  ]);
}

export function modIconSvg(color = DEFAULT_COLOR): string {
  const base = toHex(parse(color));
  const bright = mix(base, 255, 0.28);
  const dim = mix(base, 0, 0.45);

  return `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M24 4 42 14v20L24 44 6 34V14z" stroke="${base}" stroke-width="2"/>
  <circle cx="24" cy="24" r="7" stroke="${bright}" stroke-width="2"/>
  <path d="M24 4v13M42 14 30 21M42 34 30 27M24 44V31M6 34l12-7M6 14l12 7" stroke="${dim}" stroke-width="1.5"/>
</svg>`;
}

/** Transparent PNG; no fixed canvas, which the renderer treats as opaque. */
export async function renderModIcon(
  color: string,
  outPath: string,
  size = 64,
): Promise<number> {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent}
    #capture{width:${size}px;height:${size}px;display:grid;place-items:center}
    svg{width:${size}px;height:${size}px;display:block}
  </style></head><body><div id="capture">${modIconSvg(color)}</div></body></html>`;

  const renderer = new Renderer();
  await renderer.open();
  try {
    const result = await renderer.render({ html, outPath, scale: 1 });
    return result.bytes;
  } finally {
    await renderer.close();
  }
}
