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

/** One prepared step: numbering and media are resolved by the build layer. */
export interface StepView {
  n: number;
  title: string;
  body?: string;
  tag?: string;
  /** An <img> (chips) or a swdh-figure (spine); already embedded. */
  media?: RawHtml;
}

export interface StepsOptions {
  title: string;
  eyebrow?: string;
  /** Optional, unlike card: a walkthrough does not always need a glyph. */
  icon?: RawHtml;
  layout: 'spine' | 'chips';
  steps: StepView[];
  ticked?: boolean;
}

export function steps(o: StepsOptions): RawHtml {
  const head = html`<div class="swdh-steps__head ${o.icon ? 'swdh-steps__head--icon' : ''}">
    ${o.icon ? html`<div class="swdh-steps__icon">${o.icon}</div>` : ''}
    <div class="swdh-steps__heading">
      ${o.eyebrow ? html`<div class="swdh-steps__eyebrow">${inline(o.eyebrow)}</div>` : ''}
      <h2 class="swdh-steps__title">${inline(o.title)}</h2>
    </div>
  </div>`;

  const list = o.layout === 'chips' ? stepChips(o.steps) : stepSpine(o.steps);

  return html`<section class="swdh-panel ${o.ticked === false ? '' : 'swdh-panel--ticked'} swdh-steps swdh-steps--${o.layout}">
  ${head}
  ${list}
</section>`;
}

/** Vertical numbered list; the connecting spine is drawn in CSS. */
function stepSpine(items: StepView[]): RawHtml {
  return html`<ol class="swdh-steps__list">
    ${items.map(
      (s) => html`<li class="swdh-step ${s.media ? 'swdh-step--img' : ''}">
      <div class="swdh-step__marker">${s.n}</div>
      <div class="swdh-step__content">
        <div class="swdh-step__text">
          ${s.tag ? html`<span class="swdh-step__tag">${inline(s.tag)}</span>` : ''}
          <div class="swdh-step__title">${inline(s.title)}</div>
          ${s.body ? html`<p class="swdh-step__body">${inline(s.body)}</p>` : ''}
        </div>
        ${s.media ? html`<div class="swdh-step__media">${s.media}</div>` : ''}
      </div>
    </li>`,
    )}
  </ol>`;
}

/** Compact horizontal cells. Column count is set inline: it varies with length. */
function stepChips(items: StepView[]): RawHtml {
  const cols = `grid-template-columns: repeat(${items.length}, minmax(0, 1fr));`;
  return html`<ol class="swdh-steps__chips" style="${cols}">
    ${items.map(
      (s) => html`<li class="swdh-chip">
      ${s.media ?? ''}
      <div class="swdh-chip__in">
        <div class="swdh-chip__num">${String(s.n).padStart(2, '0')}</div>
        <div class="swdh-chip__title">${inline(s.title)}</div>
        ${s.body ? html`<p class="swdh-chip__body">${inline(s.body)}</p>` : ''}
      </div>
    </li>`,
    )}
  </ol>`;
}
