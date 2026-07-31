import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type TypeInfo } from './api';

/**
 * The content schema, fetched once and shared. Everything that used to be a
 * hand-maintained per-type table in the editor reads from here instead, so a
 * new content type cannot be half-supported.
 */

const SchemaContext = createContext<TypeInfo[]>([]);

export function SchemaProvider({ children }: { children: ReactNode }) {
  const [types, setTypes] = useState<TypeInfo[]>([]);

  useEffect(() => {
    void api.schema().then((s) => setTypes(s.types));
  }, []);

  return <SchemaContext.Provider value={types}>{children}</SchemaContext.Provider>;
}

export function useSchema(): TypeInfo[] {
  return useContext(SchemaContext);
}

export function useTypeInfo(type: string | undefined): TypeInfo | undefined {
  return useSchema().find((t) => t.type === type);
}

/** Minimum object that passes validation; asset fields take the caller's pick. */
export function templateFor(info: TypeInfo, asset: string): Record<string, unknown> {
  const out: Record<string, unknown> = { type: info.type };

  for (const field of info.fields) {
    if (field.optional) continue;
    if (field.asset) out[field.key] = asset;
    else if (field.kind === 'string') out[field.key] = placeholder(field.key);
    else if (field.kind === 'number') out[field.key] = 0;
    else if (field.kind === 'boolean') out[field.key] = false;
    // Required arrays need usable entries: a step list wants steps, not body items.
    else if (field.kind === 'array')
      out[field.key] =
        field.key === 'steps'
          ? [{ title: 'First step' }, { title: 'Second step' }]
          : [{ p: 'Text goes here.' }];
  }

  return out;
}

function placeholder(key: string): string {
  if (key === 'title') return 'Section Title';
  if (key === 'name') return 'Mod Name';
  return key;
}

/** Which asset kind a type requires, if any. */
export function requiredAsset(info: TypeInfo | undefined): string | null {
  return info?.fields.find((f) => f.asset && !f.optional)?.asset ?? null;
}

/** Render width for a surface, given the content's own overrides. */
export function canvasWidth(info: TypeInfo | undefined, data: Record<string, unknown>): number {
  if (!info) return 630;
  if (typeof data['width'] === 'number') return data['width'];
  return info.canvas?.width ?? 630;
}
