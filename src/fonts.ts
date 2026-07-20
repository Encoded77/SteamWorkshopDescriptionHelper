import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface FontSpec {
  family: string;
  /** The @fontsource package providing the file. */
  pkg: string;
  weight: number;
  subset?: string;
}

/**
 * Inlined as base64 data URIs: nothing to await, so a screenshot cannot race an
 * unloaded font, and nothing resolves through fontconfig.
 */
export function fontFaceCss(specs: FontSpec[]): string {
  return specs.map(toFontFace).join('\n');
}

function toFontFace(spec: FontSpec): string {
  const subset = spec.subset ?? 'latin';
  // @fontsource lays files out as: <pkg>/files/<font-id>-<subset>-<weight>-normal.woff2
  const fontId = spec.pkg.replace(/^@fontsource\//, '');
  const pkgRoot = dirname(require.resolve(`${spec.pkg}/package.json`));
  const file = join(pkgRoot, 'files', `${fontId}-${subset}-${spec.weight}-normal.woff2`);

  let data: Buffer;
  try {
    data = readFileSync(file);
  } catch {
    throw new Error(
      `Missing font file for ${spec.family} ${spec.weight}.\n` +
        `  Expected: ${file}\n` +
        `  The package may not ship this weight/subset combination. Check ` +
        `node_modules/${spec.pkg}/files/ for what is actually available.`,
    );
  }

  return [
    '@font-face {',
    `  font-family: '${spec.family}';`,
    `  font-style: normal;`,
    `  font-weight: ${spec.weight};`,
    `  font-display: block;`,
    `  src: url(data:font/woff2;base64,${data.toString('base64')}) format('woff2');`,
    '}',
  ].join('\n');
}
