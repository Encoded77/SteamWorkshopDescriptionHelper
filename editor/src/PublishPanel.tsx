import { useCallback, useEffect, useState } from 'react';
import { api, type PublishResult, type PublishStatus } from './api';

/**
 * Commits rendered PNGs to the assets repo and rewrites urls.yaml. Separate
 * from rendering, so iterating on a design leaves no binaries in git history.
 */
export function PublishPanel() {
  const [status, setStatus] = useState<PublishStatus | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modFolder, setModFolder] = useState('');
  const [exported, setExported] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.publishStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Workspace project folders are named after the mods they belong to, so the
  // export target is normally already known. The dropdown stays as an override
  // for the case where the two names differ.
  useEffect(() => {
    if (!status || modFolder) return;
    if (status.modFolders.includes(status.project)) setModFolder(status.project);
  }, [status, modFolder]);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.publish());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function exportPreview(name: string) {
    setError(null);
    setExported(null);
    try {
      const r = await api.exportPreview(name, modFolder.trim());
      setExported(r.target);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!status) return <p className="hint">{error ?? 'Loading…'}</p>;

  const blockers: string[] = [];
  if (!status.repoConfigured) blockers.push('swdh.workspace.json still has the placeholder repo name.');
  if (!status.hasToken) blockers.push('GITHUB_TOKEN is not set — copy .env.example to .env and add a token.');
  if (status.notRendered.length)
    blockers.push(`Not rendered yet — press Render PNGs: ${status.notRendered.join(', ')}`);
  if (status.stale.length)
    blockers.push(`Changed since last render — press Render PNGs: ${status.stale.join(', ')}`);

  const previews = status.images.filter((i) => i.kind === 'preview');
  // Only description images are embedded, so only they can lack a URL.
  const unresolved = status.images.filter((i) => i.kind === 'description' && !i.url);
  const pending = status.pending;
  const sourceCount = status.pendingSources?.length ?? 0;
  const deleteCount = status.pendingDeletes?.length ?? 0;
  // A text-only edit to the description changes no image, so the button must also
  // weigh source-file and deletion changes, not just pending image uploads.
  const nothingToPublish =
    pending !== null && pending.length === 0 && sourceCount === 0 && deleteCount === 0;

  const pendingSummary = (() => {
    if (pending === null) return 'cannot reach the repo — publish state unknown';
    const parts: string[] = [];
    if (pending.length) parts.push(`${pending.length} image(s)`);
    if (sourceCount) parts.push(`${sourceCount} source file(s)`);
    if (deleteCount) parts.push(`${deleteCount} to remove`);
    return parts.length ? `${parts.join(', ')} to publish` : 'everything is up to date';
  })();

  return (
    <div style={{ maxWidth: 900 }}>
      {error && <div className="errors">{error}</div>}

      <h2 className="section-title">Target</h2>
      <div className="card">
        <div className="row">
          <span className="preview-caption">
            {status.repo}@{status.branch} · {status.project}
          </span>
          <div className="spacer" />
          <span className="preview-caption">
            token {status.hasToken ? 'present' : 'missing'}
          </span>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          URLs are pinned to the commit SHA rather than the branch, so each published
          description keeps pointing at exactly the image it was written against, and jsDelivr's
          caching can never serve something stale.
        </p>
      </div>

      {blockers.length > 0 && (
        <div className="errors">{blockers.map((b) => `- ${b}`).join('\n')}</div>
      )}

      <h2 className="section-title">Images ({status.images.length})</h2>
      {status.images.length === 0 ? (
        <p className="hint">Nothing rendered yet. Press Render PNGs first.</p>
      ) : (
        <div className="card">
          {status.images.map((img) => {
            const changed = pending?.includes(img.name) ?? false;
            return (
              <div className="row" key={img.name} style={{ padding: '3px 0' }}>
                <span style={{ minWidth: 220 }}>{img.name}</span>
                <span className="preview-caption" style={{ minWidth: 96 }}>
                  {img.kind}
                </span>
                <span className="preview-caption">
                  {changed
                    ? 'changed'
                    : pending === null
                      ? ''
                      : img.kind === 'description'
                        ? img.url
                          ? 'published'
                          : 'in repo, no URL'
                        : 'in repo'}
                </span>
                <div className="spacer" />
                {img.url && (
                  <button onClick={() => void navigator.clipboard.writeText(img.url!)}>
                    Copy URL
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="primary"
          onClick={() => void run()}
          disabled={busy || blockers.length > 0 || status.images.length === 0 || nothingToPublish}
        >
          {busy ? 'Publishing…' : 'Publish to CDN'}
        </button>
        <span className="preview-caption">{pendingSummary}</span>
        {unresolved.length > 0 && pending?.length === 0 && (
          <span className="preview-caption">
            · {unresolved.length} description image(s) still need a URL — publish to write them
          </span>
        )}
      </div>

      {result && (
        <>
          <h2 className="section-title">Result</h2>
          <pre
            className="errors"
            style={{ background: 'var(--panel)', borderColor: 'var(--edge)', color: 'var(--ink-dim)' }}
          >
            {[
              ...result.log,
              '',
              `commit ${result.sha}`,
              `${result.uploaded.length} synced, ${result.deleted.length} removed, ` +
                `${result.unchanged.length} unchanged`,
              'urls.yaml and description.bbcode rewritten',
            ].join('\n')}
          </pre>
          {result.cloneSynced && (
            <p className="hint">
              Your local clone was fast-forwarded onto the pushed commit, so it is current and the
              next publish will not be refused. Working-tree edits were left untouched.
            </p>
          )}
          {!result.cloneSynced && result.cloneSyncNote && (
            <p className="hint" style={{ whiteSpace: 'pre-wrap' }}>
              {result.cloneSyncNote}
            </p>
          )}
        </>
      )}

      <h2 className="section-title">Mod preview image</h2>
      <p className="hint" style={{ marginBottom: 10 }}>
        Preview images never need the CDN — RimWorld's in-game uploader publishes
        <code> About/Preview.png</code> for you. This copies a render into place.
        {!status.modsMounted && ' Set SWDH_MODS in .env to enable it.'}
      </p>

      <div className="field">
        <label>Mod folder</label>
        <select
          value={modFolder}
          disabled={!status.modsMounted || status.modFolders.length === 0}
          onChange={(e) => setModFolder(e.target.value)}
        >
          <option value="">— choose a mod —</option>
          {status.modFolders.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        {status.modsMounted && status.modFolders.length === 0 && (
          <p className="hint">
            No mods found under <code>SWDH_MODS</code>. It should point at the folder that
            <em> contains</em> your mod folders, not at a single mod.
          </p>
        )}

        {modFolder === status.project && (
          <p className="hint">Matched to the current project. Change it only if the names differ.</p>
        )}

        {status.modsMounted &&
          status.modFolders.length > 0 &&
          !status.modFolders.includes(status.project) && (
            <p className="hint">
              No mod folder named <code>{status.project}</code> — pick the matching one.
            </p>
          )}
      </div>

      {previews.length === 0 ? (
        <p className="hint">No preview-* images rendered.</p>
      ) : (
        <div className="card">
          {previews.map((img) => (
            <div className="row" key={img.name} style={{ padding: '3px 0' }}>
              <span style={{ minWidth: 220 }}>{img.name}</span>
              <div className="spacer" />
              <button
                disabled={!status.modsMounted || !modFolder}
                // Says why it is unavailable, rather than sitting greyed out
                // with no explanation — which read as the feature being broken.
                title={
                  !status.modsMounted
                    ? 'Set SWDH_MODS in .env to enable this'
                    : !modFolder
                      ? 'Choose a mod folder above first'
                      : `Write ${img.name}.png to ${modFolder}/About/Preview.png`
                }
                onClick={() => void exportPreview(img.name)}
              >
                Write to About/Preview.png
              </button>
            </div>
          ))}
        </div>
      )}

      {exported && <p className="hint">Wrote {exported}</p>}
    </div>
  );
}
