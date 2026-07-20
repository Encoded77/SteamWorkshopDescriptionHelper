import { html, inline, type RawHtml } from './html.js';

/**
 * Surfaces for RimWorld's About/Preview.png (640x360). Same identity as the
 * description components, but a larger type scale: previews display small.
 */

/** Where a screenshot is anchored when the visible area is not 16:9. */
export type Crop = 'center' | 'top' | 'bottom';

function flagMarkup(flag: string | undefined): RawHtml {
  return flag ? html`<div class="preview-flag"><span>${inline(flag)}</span></div>` : html``;
}

function shotMarkup(dataUri: string, crop: Crop): RawHtml {
  return html`<img class="swdh-preview__shot" src="${dataUri}" alt=""
    style="object-position: ${crop};" />`;
}

export interface PreviewTitleOptions {
  name: string;
  tagline?: string;
  /** Small monospace line under the tagline, e.g. "RimWorld Mod". */
  kicker?: string;
  /** Version ribbon text, e.g. "1.6". */
  flag?: string;
}

export function previewTitle(o: PreviewTitleOptions): RawHtml {
  return html`<div class="swdh-preview">
  <div class="preview-title">
    <div class="preview-title__inner" data-fit="title block">
      <div class="preview-title__name">${inline(o.name)}</div>
      ${o.tagline ? html`<div class="preview-title__tagline">${inline(o.tagline)}</div>` : ''}
      ${o.kicker ? html`<div class="preview-title__kicker">${inline(o.kicker)}</div>` : ''}
    </div>
  </div>
  ${flagMarkup(o.flag)}
</div>`;
}

/** Contained and annotated screenshots are assembled by the caller, which has the size. */
export function coverShot(dataUri: string, crop: Crop): RawHtml {
  return shotMarkup(dataUri, crop);
}

export interface PreviewScreenshotOptions {
  media: RawHtml;
  /** Keep to a few words: it displays small. */
  overlay?: string;
  flag?: string;
}

export function previewScreenshot(o: PreviewScreenshotOptions): RawHtml {
  return html`<div class="swdh-preview">
  ${o.media}
  ${o.overlay
    ? html`<div class="preview-overlay" data-fit="overlay text">
        <div class="preview-overlay__text">${inline(o.overlay)}</div>
      </div>`
    : ''}
  <div class="preview-frame"></div>
  ${flagMarkup(o.flag)}
</div>`;
}

export interface PreviewFullbleedOptions {
  media: RawHtml;
  /** Bottom-left mark; the only identity element besides the frame. */
  mark?: string;
  flag?: string;
}

export function previewFullbleed(o: PreviewFullbleedOptions): RawHtml {
  return html`<div class="swdh-preview">
  ${o.media}
  <div class="preview-frame"></div>
  ${o.mark ? html`<div class="preview-mark">${inline(o.mark)}</div>` : ''}
  ${flagMarkup(o.flag)}
</div>`;
}
