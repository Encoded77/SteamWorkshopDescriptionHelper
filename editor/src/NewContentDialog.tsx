import { useState } from 'react';
import { api, type Content, type ContentType } from './api';
import { AssetPicker } from './fields';
import { requiredAsset, templateFor, useSchema } from './schema';

/**
 * Types and their starting shapes come from the schema, so a type added there
 * is immediately creatable here rather than missing until someone notices.
 */
export function NewContentDialog({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (name: string) => void | Promise<void>;
}) {
  const types = useSchema();
  const [name, setName] = useState('');
  const [type, setType] = useState<ContentType>('block');
  const [asset, setAsset] = useState('');
  const [error, setError] = useState<string | null>(null);

  const info = types.find((t) => t.type === type) ?? types[0];
  const needs = requiredAsset(info);

  async function create() {
    if (!info) return;
    try {
      const result = await api.createContent(name.trim(), templateFor(info, asset) as Content);
      if (result.ok) {
        await onCreated(name.trim());
      } else {
        setError((result.errors ?? ['Could not create.']).join('\n'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="modal">
      <div className="modal__panel" style={{ width: 460 }}>
        <strong>New image</strong>

        {error && (
          <div className="errors" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        <div className="field" style={{ marginTop: 12 }}>
          <label>File name</label>
          <input
            type="text"
            value={name}
            placeholder="04-work-tab"
            onChange={(e) => setName(e.target.value)}
          />
          <p className="hint">
            Becomes <code>content/&lt;name&gt;.yaml</code> and the key used by
            <code> {'{{image:name}}'}</code> placeholders. A numeric prefix keeps the list in the
            order you want to read it.
          </p>
        </div>

        <div className="field">
          <label>Type</label>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setAsset('');
              setError(null);
            }}
          >
            {types.map((t) => (
              <option key={t.type} value={t.type}>
                {t.type}
              </option>
            ))}
          </select>
        </div>

        {needs && (
          <AssetPicker
            label={needs === 'icon' ? 'Icon' : 'Screenshot'}
            value={asset}
            // Screenshots need intrinsic dimensions for annotations and fits.
            annotatableOnly={needs === 'screenshot'}
            hint={`Required. Add files to assets/${needs === 'icon' ? 'icons' : 'screenshots'}/ if the list is empty.`}
            onChange={setAsset}
          />
        )}

        <div className="row">
          <div className="spacer" />
          <button onClick={onCancel}>Cancel</button>
          <button
            className="primary"
            onClick={() => void create()}
            disabled={!name.trim() || !info || (needs !== null && !asset)}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
