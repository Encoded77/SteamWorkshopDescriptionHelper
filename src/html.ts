/**
 * Tagged-template HTML builder. Interpolated strings are escaped; markup must
 * be wrapped in `raw()`, so every unescaped insertion is visible at its call site.
 */

export class RawHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function raw(value: string): RawHtml {
  return new RawHtml(value);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Interpolatable = string | number | RawHtml | null | undefined | Interpolatable[];

function resolve(value: Interpolatable): string {
  if (value === null || value === undefined) return '';
  if (value instanceof RawHtml) return value.value;
  if (Array.isArray(value)) return value.map(resolve).join('');
  if (typeof value === 'number') return String(value);
  return escapeHtml(value);
}

/**
 * `**bold**` and `_highlight_` only. Escaped before markers expand, so content
 * cannot inject markup. Lives here rather than with the schema so every
 * template can use it without importing the content layer.
 */
export function inline(text: string): RawHtml {
  const escaped = escapeHtml(text);
  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const withEm = withBold.replace(/(^|[\s(])_(.+?)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
  return raw(withEm);
}

export function html(strings: TemplateStringsArray, ...values: Interpolatable[]): RawHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    out += resolve(values[i]) + (strings[i + 1] ?? '');
  }
  return new RawHtml(out);
}
