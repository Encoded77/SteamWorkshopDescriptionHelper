import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * Assembles the description: plain BBCode with {{image:name}} placeholders,
 * each substituted for an [img] tag resolved through urls.yaml.
 */

/** Steam's hard limit on workshop item description length. */
export const STEAM_CHAR_LIMIT = 8000;

const PLACEHOLDER = /\{\{image:([a-zA-Z0-9._-]+)\}\}/g;

const UrlMapSchema = z.record(z.string().min(1), z.string().url());

export interface AssembleResult {
  output: string;
  chars: number;
  /** Placeholders with no entry in urls.yaml, left unsubstituted. */
  missing: string[];
  unused: string[];
  resolved: number;
}

export async function loadUrlMap(file: string): Promise<Record<string, string>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    // Absent is normal before the first publish.
    return {};
  }

  const parsed = parseYaml(text) ?? {};
  const result = UrlMapSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`${file}: invalid URL map\n${issues}`);
  }
  return result.data;
}

export function assemble(source: string, urls: Record<string, string>): AssembleResult {
  const missing = new Set<string>();
  const referenced = new Set<string>();
  let resolved = 0;

  const output = source.replace(PLACEHOLDER, (whole, name: string) => {
    referenced.add(name);
    const url = urls[name];
    if (!url) {
      missing.add(name);
      // Left verbatim, so an unresolved image cannot be pasted unnoticed.
      return whole;
    }
    resolved++;
    return `[img]${url}[/img]`;
  });

  const unused = Object.keys(urls).filter((k) => !referenced.has(k));

  return {
    output,
    chars: output.length,
    missing: [...missing],
    unused,
    resolved,
  };
}

export async function assembleToFile(
  sourceFile: string,
  urlMapFile: string,
  outFile: string,
): Promise<AssembleResult> {
  const source = await readFile(sourceFile, 'utf8');
  const urls = await loadUrlMap(urlMapFile);
  const result = assemble(source, urls);

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, result.output, 'utf8');

  return result;
}
