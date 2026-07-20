import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ContentListItem, type DescriptionState } from './api';

/** Description authoring with a live character budget against Steam's limit. */
export function DescriptionPanel({ files }: { files: ContentListItem[] }) {
  const [state, setState] = useState<DescriptionState | null>(null);
  const [source, setSource] = useState('');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.readDescription();
      setState(next);
      setSource(next.source);
      setUrls(next.urls);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Assembled server-side, so the count includes [img] tags.
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(async () => {
      try {
        const next = await api.saveDescription({ source, urls });
        setState(next);
        setDirty(false);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [source, urls, dirty]);

  /** Inserts a placeholder at the caret. */
  function insert(name: string) {
    const el = box.current;
    const token = `{{image:${name}}}`;
    if (!el) {
      setSource((s) => `${s}\n${token}\n`);
      setDirty(true);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setSource((s) => `${s.slice(0, start)}${token}${s.slice(end)}`);
    setDirty(true);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }

  if (!state) {
    return <p className="hint">{error ?? 'Loading…'}</p>;
  }

  const pct = Math.min(100, Math.round((state.chars / state.limit) * 100));
  const over = state.chars > state.limit;
  const level = over ? 'over' : pct > 85 ? 'warn' : '';

  return (
    <div style={{ maxWidth: 900 }}>
      {error && <div className="errors">{error}</div>}

      <div className="row" style={{ marginBottom: 6 }}>
        <strong>
          {state.chars.toLocaleString()} / {state.limit.toLocaleString()} characters
        </strong>
        <span className="preview-caption">
          {over ? `over by ${state.chars - state.limit}` : `${state.limit - state.chars} remaining`}
          {' · '}
          {state.resolved} image{state.resolved === 1 ? '' : 's'} resolved
        </span>
        <div className="spacer" />
        {dirty && <span className="preview-caption">saving…</span>}
      </div>

      <div className="meter">
        <div className={`meter__fill ${level}`} style={{ width: `${pct}%` }} />
      </div>

      {state.missing.length > 0 && (
        <div className="errors" style={{ marginTop: 12 }}>
          {`Unresolved images — add a URL below or they stay as literal placeholders:\n`}
          {state.missing.map((m) => `  - ${m}`).join('\n')}
        </div>
      )}

      <h2 className="section-title">Description source</h2>
      <textarea
        ref={box}
        className="mono"
        rows={18}
        value={source}
        onChange={(e) => {
          setSource(e.target.value);
          setDirty(true);
        }}
      />

      <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
        <span className="preview-caption" style={{ width: '100%' }}>
          Insert placeholder
        </span>
        {files.map((f) => (
          <button key={f.name} onClick={() => insert(f.name)}>
            {f.name}
          </button>
        ))}
      </div>

      <h2 className="section-title">Image URLs</h2>
      <p className="hint" style={{ marginBottom: 10 }}>
        Upload each PNG to Steam as a workshop screenshot and paste its
        <code> steamuserimages-a.akamaihd.net</code> address here. Avoid Imgur — it is
        region-blocked for UK users, which silently breaks images for part of your audience.
      </p>

      {files.map((f) => (
        <div className="field" key={f.name}>
          <label>{f.name}</label>
          <input
            type="text"
            value={urls[f.name] ?? ''}
            placeholder="https://steamuserimages-a.akamaihd.net/ugc/…"
            onChange={(e) => {
              const next = { ...urls };
              if (e.target.value.trim() === '') delete next[f.name];
              else next[f.name] = e.target.value.trim();
              setUrls(next);
              setDirty(true);
            }}
          />
        </div>
      ))}

      <h2 className="section-title">Assembled output</h2>
      <textarea className="mono" rows={10} readOnly value={state.output} />
      <p className="hint">
        Written to <code>out/description.bbcode</code> on every save. Paste this into Steam.
      </p>
    </div>
  );
}
