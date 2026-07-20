import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Per-project overrides for the design tokens, in `<project>/swdh.theme.json`.
 * Anything unset falls through to the defaults in tokens.css.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb colour');

export const ThemeSchema = z
  .object({
    /** Primary accent: bars, ticks, list markers, highlight boxes. */
    accent: hex.optional(),
    /** Lighter accent: titles on ribbons, selected states. */
    accentBright: hex.optional(),
    /** Darker accent: icon wells, secondary rules. */
    accentDim: hex.optional(),
    /** Secondary signal, used sparingly against the accent. */
    signal: hex.optional(),
    /** Panel ground. */
    panelBg: hex.optional(),
    /** Primary text. */
    ink: hex.optional(),
    /** Panel border. */
    edge: hex.optional(),
    /** Corner radius in px; 0 keeps the hard-edged look. */
    radius: z.number().int().min(0).max(24).optional(),
    /** Multiplies every text size. Canvases are fixed, so large values can overflow a preview. */
    textScale: z.number().min(0.8).max(1.6).optional(),
  })
  .strict();

export type Theme = z.infer<typeof ThemeSchema>;

export const THEME_FILE = 'swdh.theme.json';

export async function loadTheme(projectDir: string): Promise<Theme> {
  const raw = await readFile(join(projectDir, THEME_FILE), 'utf8').catch(() => null);
  if (raw === null) return {};

  const parsed = ThemeSchema.safeParse(JSON.parse(raw.replace(/^﻿/, '')));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`${THEME_FILE} is invalid\n${issues}`);
  }
  return parsed.data;
}

export async function saveTheme(projectDir: string, theme: Theme): Promise<void> {
  await writeFile(join(projectDir, THEME_FILE), `${JSON.stringify(theme, null, 2)}\n`, 'utf8');
}

/** Emitted after tokens.css, so set values win and the rest fall through. */
export function themeCss(theme: Theme): string {
  const vars: string[] = [];
  const set = (name: string, value: string | undefined) => {
    if (value) vars.push(`  ${name}: ${value};`);
  };

  // The bright and dim variants are derived from the accent unless set
  // explicitly, so changing one colour keeps the three in step.
  set('--c-accent-500', theme.accent);
  set(
    '--c-accent-400',
    theme.accentBright ??
      (theme.accent ? `color-mix(in srgb, ${theme.accent}, white 22%)` : undefined),
  );
  set(
    '--c-accent-700',
    theme.accentDim ??
      (theme.accent ? `color-mix(in srgb, ${theme.accent}, black 45%)` : undefined),
  );
  set('--c-signal-400', theme.signal);
  set('--panel-bg', theme.panelBg);
  set('--c-ink-100', theme.ink);
  set('--c-edge', theme.edge);
  if (theme.radius !== undefined) vars.push(`  --radius: ${theme.radius}px;`);
  if (theme.textScale !== undefined) vars.push(`  --type-scale: ${theme.textScale};`);

  return vars.length ? `:root {\n${vars.join('\n')}\n}` : '';
}
