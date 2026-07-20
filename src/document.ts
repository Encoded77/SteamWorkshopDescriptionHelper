import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fontFaceCss, type FontSpec } from './fonts.js';
import { html, raw, type RawHtml } from './html.js';

const here = dirname(fileURLToPath(import.meta.url));

function designCss(name: string): string {
  return readFileSync(join(here, 'design', name), 'utf8');
}

/** Keep minimal: every entry is inlined into every rendered document. */
export const IDENTITY_FONTS: FontSpec[] = [
  { family: 'Oxanium', pkg: '@fontsource/oxanium', weight: 600 },
  { family: 'Barlow', pkg: '@fontsource/barlow', weight: 400 },
  { family: 'Barlow', pkg: '@fontsource/barlow', weight: 600 },
  { family: 'IBM Plex Mono', pkg: '@fontsource/ibm-plex-mono', weight: 400 },
];

export interface DocumentOptions {
  body: RawHtml;
  /** Appended after the design system. */
  extraCss?: string;
  fonts?: FontSpec[];
  /** Per-project token overrides, emitted after tokens.css. */
  themeCss?: string;
}

export function buildDocument(opts: DocumentOptions): string {
  const fonts = opts.fonts ?? IDENTITY_FONTS;
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
${raw(fontFaceCss(fonts))}
${raw(designCss('tokens.css'))}
${raw(opts.themeCss ?? '')}
${raw(designCss('base.css'))}
${raw(designCss('preview.css'))}
${raw(designCss('annotate.css'))}
${raw(opts.extraCss ?? '')}
    </style>
  </head>
  <body>
${opts.body}
  </body>
</html>`.value;
}
