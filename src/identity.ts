import { join } from 'node:path';
import { buildDocument } from './document.js';
import { banner, block, card } from './components.js';
import { html, raw } from './html.js';
import { Renderer, STEAM_PAGE_BG } from './render.js';

/**
 * Specimen sheet: all three primitives at true column width on Steam's page
 * background. The regression check for any change to tokens or components.
 */

/** Stand-in for a real icon in the card's square slot. */
const PLACEHOLDER_ICON = raw(`
<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" width="40" height="40">
  <path d="M24 4 42 14v20L24 44 6 34V14z" stroke="var(--c-accent-500)" stroke-width="2"/>
  <circle cx="24" cy="24" r="7" stroke="var(--c-accent-400)" stroke-width="2"/>
  <path d="M24 4v13M42 14 30 21M42 34 30 27M24 44V31M6 34l12-7M6 14l12 7" stroke="var(--c-accent-700)" stroke-width="1.5"/>
</svg>`);

const SHEET_CSS = `
  #capture {
    width: 630px;
    background: ${STEAM_PAGE_BG};
    padding: 16px 0 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  /* Approximates Steam's own body text, so panels are judged next to it. */
  .steam-text {
    font-family: Arial, sans-serif;
    font-size: 15px;
    line-height: 1.4;
    color: #acb2b8;
    padding: 2px 0;
  }
`;

const SPECIMEN = html`<div id="capture">
  ${banner({ title: 'Features', kicker: 'Rebalance Patches' })}

  <p class="steam-text">
    Regular description text left in the workshop description, shown here for contrast.
  </p>

  ${block({
    title: 'Compatibility First',
    body: html`<p>
        Every patch is <strong>individually toggleable</strong> and gated on the mod it targets. If
        you do not run the target mod, the patch never loads and produces no errors in your log.
      </p>
      <ul class="swdh-list">
        <li>No global XPath operations that could collide with other patch mods.</li>
        <li>Each target mod is <em>optional</em> — load order is not enforced.</li>
        <li>Settings menu hides toggles whose requirements are not met.</li>
      </ul>`,
  })}

  ${card({
    eyebrow: 'Requires Biotech',
    title: 'Mechanoid Rework',
    icon: PLACEHOLDER_ICON,
    body: html`<p>
      Rebalances mechanoid work speed and bandwidth costs so that a mid-game mechanitor is a
      genuine investment rather than a strictly better colonist. Affects
      <strong>14 mech types</strong>.
    </p>`,
  })}
</div>`;

export async function renderIdentitySheets(outDir: string): Promise<string[]> {
  const renderer = new Renderer();
  await renderer.open();
  try {
    const outPath = join(outDir, 'specimen.png');
    const { height } = await renderer.render({
      html: buildDocument({ body: SPECIMEN, extraCss: SHEET_CSS }),
      outPath,
    });
    console.log(`  specimen -> ${outPath}  (630x${height} logical)`);
    return [outPath];
  } finally {
    await renderer.close();
  }
}
