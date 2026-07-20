import { html, inline, type RawHtml } from './html.js';

/** All three share .swdh-panel, so ground, edge and ticks are defined once. */

export interface BannerOptions {
  title: string;
  /** Right-aligned monospace text, e.g. a mod name. */
  kicker?: string;
  ticked?: boolean;
}

export function banner(o: BannerOptions): RawHtml {
  return html`<section class="swdh-panel ${o.ticked === false ? '' : 'swdh-panel--ticked'} swdh-banner">
  <h1 class="swdh-banner__title">${inline(o.title)}</h1>
  ${o.kicker ? html`<span class="swdh-banner__kicker">${inline(o.kicker)}</span>` : ''}
</section>`;
}

export interface BlockOptions {
  title?: string;
  /** Built by the content layer, not hand-written. */
  body: RawHtml;
  ticked?: boolean;
}

export function block(o: BlockOptions): RawHtml {
  return html`<section class="swdh-panel ${o.ticked === false ? '' : 'swdh-panel--ticked'} swdh-block">
  <div class="swdh-prose">
    ${o.title ? html`<h2 class="swdh-block__title">${inline(o.title)}</h2>` : ''}
    ${o.body}
  </div>
</section>`;
}

export interface CardOptions {
  title: string;
  /** Small accent line above the title, e.g. a DLC requirement. */
  eyebrow?: string;
  /** Contents of the square slot: an <img> or inline SVG. */
  icon: RawHtml;
  body: RawHtml;
  ticked?: boolean;
}

export function card(o: CardOptions): RawHtml {
  return html`<section class="swdh-panel ${o.ticked === false ? '' : 'swdh-panel--ticked'} swdh-card">
  <div class="swdh-card__icon">${o.icon}</div>
  <div class="swdh-card__head">
    ${o.eyebrow ? html`<div class="swdh-card__eyebrow">${inline(o.eyebrow)}</div>` : ''}
    <h2 class="swdh-card__title">${inline(o.title)}</h2>
  </div>
  <div class="swdh-card__body swdh-prose">${o.body}</div>
</section>`;
}
