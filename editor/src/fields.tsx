import { useEffect, useState } from 'react';
import { api, type AssetInfo } from './api';

/** Shared form primitives. */

export function Text({
  label,
  value,
  onChange,
  hint,
  placeholder,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="text"
        value={value ?? ''}
        placeholder={placeholder}
        // Empty means absent, so optional fields leave the YAML entirely.
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Area({
  label,
  value,
  onChange,
  hint,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  rows?: number;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <textarea rows={rows ?? 3} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Num({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        // Empty clears the field so the schema default applies.
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Check({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean | undefined;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="field">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
        <input
          type="checkbox"
          checked={value ?? false}
          style={{ width: 'auto' }}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/** Assets are listed by the server, which also reports usable dimensions. */
export function useAssets(): AssetInfo[] {
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  useEffect(() => {
    void api.listAssets().then(setAssets);
  }, []);
  return assets;
}

export function AssetPicker({
  label,
  value,
  onChange,
  hint,
  annotatableOnly,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  hint?: string;
  /** Annotations need a header-readable size, which rules SVG out. */
  annotatableOnly?: boolean;
}) {
  const assets = useAssets();
  const usable = annotatableOnly ? assets.filter((a) => a.width && a.height) : assets;

  return (
    <div className="field">
      <label>{label}</label>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">— choose an asset —</option>
        {usable.map((a) => (
          <option key={a.path} value={a.path}>
            {a.path}
            {a.width ? ` (${a.width}×${a.height})` : ''}
          </option>
        ))}
      </select>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
