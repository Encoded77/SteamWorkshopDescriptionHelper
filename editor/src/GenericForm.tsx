import { AssetPicker, Check, Num, Select, Text } from './fields';
import type { TypeInfo } from './api';

/**
 * Fallback form built from the schema, used when a content type has no
 * hand-written one. It is plainer than a tailored form, but it means a type
 * added to the schema is editable immediately instead of hitting a dead end.
 */
export function GenericForm({
  info,
  value,
  onChange,
}: {
  info: TypeInfo;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const set = (key: string, v: unknown) => {
    const next = structuredClone(value);
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(next);
  };

  return (
    <>
      <p className="hint" style={{ marginBottom: 12 }}>
        Generated from the schema — no tailored form exists for <code>{info.type}</code> yet.
      </p>

      {info.fields.map((f) => {
        const current = value[f.key];

        if (f.asset) {
          return (
            <AssetPicker
              key={f.key}
              label={f.key}
              value={typeof current === 'string' ? current : undefined}
              annotatableOnly={f.asset === 'screenshot'}
              onChange={(v) => set(f.key, v)}
            />
          );
        }

        if (f.kind === 'enum' && f.values) {
          return (
            <Select
              key={f.key}
              label={f.key}
              value={String(current ?? f.default ?? f.values[0])}
              options={f.values}
              onChange={(v) => set(f.key, v)}
            />
          );
        }

        if (f.kind === 'number') {
          return (
            <Num
              key={f.key}
              label={f.key}
              value={typeof current === 'number' ? current : undefined}
              onChange={(v) => set(f.key, v)}
            />
          );
        }

        if (f.kind === 'boolean') {
          return (
            <Check
              key={f.key}
              label={f.key}
              value={typeof current === 'boolean' ? current : undefined}
              onChange={(v) => set(f.key, v)}
            />
          );
        }

        if (f.kind === 'string') {
          return (
            <Text
              key={f.key}
              label={f.key}
              value={typeof current === 'string' ? current : undefined}
              onChange={(v) => set(f.key, v)}
            />
          );
        }

        // Arrays and nested objects need structure this form cannot express.
        return (
          <div className="field" key={f.key}>
            <label>{f.key}</label>
            <p className="hint">
              {f.kind} — edit this field in the YAML file directly.
            </p>
          </div>
        );
      })}
    </>
  );
}
