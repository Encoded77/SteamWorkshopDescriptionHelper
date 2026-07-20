import { useCallback, useEffect, useState } from 'react';
import { api, type Theme } from './api';

/**
 * Per-project overrides for the design tokens, written to swdh.theme.json.
 * Anything left at its default is omitted from the file entirely.
 */

const DEFAULTS = {
  accent: '#efa62c',
  accentBright: '#ffc35c',
  accentDim: '#9a6612',
  signal: '#62d3e6',
  panelBg: '#0b1015',
  ink: '#e8f0f7',
  edge: '#273747',
} as const;

type ColourKey = keyof typeof DEFAULTS;

const FIELDS: Array<{ key: ColourKey; label: string; hint: string }> = [
  {
    key: 'accent',
    label: 'Accent',
    hint: 'Bars, ticks, list markers, highlight boxes. The bright and dim variants follow this unless set below.',
  },
  { key: 'accentBright', label: 'Accent bright', hint: 'Ribbon text, selected states. Derived from the accent by default.' },
  { key: 'accentDim', label: 'Accent dim', hint: 'Icon wells and secondary rules. Derived from the accent by default.' },
  { key: 'signal', label: 'Signal', hint: 'Secondary colour, used sparingly.' },
  { key: 'panelBg', label: 'Panel ground', hint: 'The background every image sits on.' },
  { key: 'ink', label: 'Ink', hint: 'Primary text.' },
  { key: 'edge', label: 'Edge', hint: 'Panel borders.' },
];

/**
 * Generates About/ModIcon.png. RimWorld displays it at 32px, so both sizes are
 * shown — the glyph's thin spokes are the first thing to go at the small one.
 */
function ModIcon({ accent }: { accent: string }) {
  const [color, setColor] = useState(accent);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function write() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.writeModIcon(color);
      setResult(`${r.target} · ${r.bytes} bytes`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="section-title">Mod icon</h2>

      {error && <div className="errors">{error}</div>}

      <div className="row" style={{ alignItems: 'flex-start', gap: 20, marginBottom: 12 }}>
        <div style={{ textAlign: 'center' }}>
          <img src={api.modIconUrl(color)} width={64} height={64} alt="" />
          <div className="preview-caption">64px</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <img src={api.modIconUrl(color)} width={32} height={32} alt="" />
          <div className="preview-caption">32px, as shown in game</div>
        </div>
      </div>

      <div className="field">
        <label>Icon colour</label>
        <div className="row">
          <input
            type="color"
            value={color}
            style={{ width: 52, padding: 2, height: 30 }}
            onChange={(e) => setColor(e.target.value)}
          />
          <input
            type="text"
            value={color}
            spellCheck={false}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (/^#[0-9a-fA-F]{6}$/.test(v)) setColor(v);
            }}
          />
          <button onClick={() => setColor(accent)} disabled={color === accent}>
            Match accent
          </button>
        </div>
        <p className="hint">
          The ring and spokes are derived from this, the same way the accent drives its own
          variants.
        </p>
      </div>

      <div className="row">
        <button className="primary" onClick={() => void write()} disabled={busy}>
          {busy ? 'Writing…' : 'Write to About/ModIcon.png'}
        </button>
        {result && <span className="preview-caption">wrote {result}</span>}
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Goes to the mod folder matching this project. Needs <code>SWDH_MODS</code> set.
      </p>
    </>
  );
}

export function SettingsPanel() {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTheme((await api.readTheme()).theme);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function commit(next: Theme) {
    setTheme(next);
    setSaving(true);
    try {
      const result = await api.saveTheme(next);
      setError(result.ok ? null : (result.errors ?? ['Could not save.']).join('\n'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!theme) return <p className="hint">{error ?? 'Loading…'}</p>;

  const set = (key: keyof Theme, value: string | number | undefined) => {
    const next = { ...theme };
    // Unset rather than stored, so the file only records real changes.
    if (value === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
    void commit(next);
  };

  const overridden = Object.keys(theme).length;

  return (
    <div style={{ maxWidth: 620 }}>
      {error && <div className="errors">{error}</div>}

      <div className="row" style={{ marginBottom: 12 }}>
        <strong>Visual identity</strong>
        <span className="preview-caption">
          {overridden === 0 ? 'all defaults' : `${overridden} override(s)`}
          {saving ? ' · saving…' : ''}
        </span>
        <div className="spacer" />
        <button onClick={() => void commit({})} disabled={overridden === 0}>
          Reset to defaults
        </button>
      </div>

      <p className="hint" style={{ marginBottom: 14 }}>
        Applies to this project only, saved to <code>swdh.theme.json</code>. Re-render to see it
        in the exported PNGs — the preview updates immediately.
      </p>

      <h2 className="section-title">Colours</h2>
      {FIELDS.map((f) => {
        const value = theme[f.key] ?? DEFAULTS[f.key];
        const isDefault = theme[f.key] === undefined;
        return (
          <div className="field" key={f.key}>
            <label>{f.label}</label>
            <div className="row">
              <input
                type="color"
                value={value}
                style={{ width: 52, padding: 2, height: 30 }}
                onChange={(e) => set(f.key, e.target.value)}
              />
              <input
                type="text"
                value={value}
                spellCheck={false}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) set(f.key, v);
                }}
              />
              <button onClick={() => set(f.key, undefined)} disabled={isDefault}>
                Default
              </button>
            </div>
            <p className="hint">{f.hint}</p>
          </div>
        );
      })}

      <ModIcon accent={theme.accent ?? DEFAULTS.accent} />

      <h2 className="section-title">Text</h2>
      <div className="field">
        <label>Text size</label>
        <div className="row">
          <input
            type="range"
            min={0.8}
            max={1.6}
            step={0.05}
            value={theme.textScale ?? 1}
            style={{ flex: 1 }}
            onChange={(e) => set('textScale', Number(e.target.value))}
          />
          <span className="preview-caption" style={{ minWidth: 44 }}>
            {Math.round((theme.textScale ?? 1) * 100)}%
          </span>
          <button
            onClick={() => set('textScale', undefined)}
            disabled={theme.textScale === undefined}
          >
            Default
          </button>
        </div>
        <p className="hint">
          Scales every text size together — body, titles, captions and callout labels. Previews
          and carousel images have a fixed canvas, so a large value can overflow one; the build
          says which if it does.
        </p>
      </div>

      <h2 className="section-title">Geometry</h2>
      <div className="field">
        <label>Corner radius</label>
        <div className="row">
          <input
            type="number"
            min={0}
            max={24}
            value={theme.radius ?? 0}
            onChange={(e) =>
              set('radius', e.target.value === '' ? undefined : Number(e.target.value))
            }
          />
          <button onClick={() => set('radius', undefined)} disabled={theme.radius === undefined}>
            Default
          </button>
        </div>
        <p className="hint">0 keeps the hard-edged look the rest of the identity is built on.</p>
      </div>
    </div>
  );
}
