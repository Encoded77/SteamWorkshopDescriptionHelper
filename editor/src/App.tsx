import { useCallback, useEffect, useState } from 'react';
import { api, setActiveProject, type Content, type ContentListItem } from './api';
import { Preview } from './Preview';
import { ContentForm } from './ContentForm';
import { DescriptionPanel } from './DescriptionPanel';
import { NewContentDialog } from './NewContentDialog';
import { PublishPanel } from './PublishPanel';
import { SettingsPanel } from './SettingsPanel';

type Tab = 'images' | 'description' | 'publish' | 'output' | 'settings';

const LAST_PROJECT = 'swdh.project';

export function App() {
  const [tab, setTab] = useState<Tab>('images');
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [files, setFiles] = useState<ContentListItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Content | null>(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [buildLog, setBuildLog] = useState<string[]>([]);
  const [building, setBuilding] = useState(false);

  const refreshFiles = useCallback(async () => {
    setFiles(await api.listContent());
  }, []);

  // Nothing else may load until a project is chosen, or requests would resolve
  // against whichever one the server happens to default to.
  useEffect(() => {
    void (async () => {
      const { projects: found, preferred } = await api.listProjects();
      setProjects(found);
      const remembered = localStorage.getItem(LAST_PROJECT);
      const initial =
        (remembered && found.includes(remembered) && remembered) ||
        (preferred && found.includes(preferred) && preferred) ||
        found[0] ||
        null;
      if (initial) {
        setActiveProject(initial);
        setProject(initial);
      }
    })();
  }, []);

  function switchProject(name: string) {
    if (name === project) return;
    setActiveProject(name);
    localStorage.setItem(LAST_PROJECT, name);
    setProject(name);
    // Nothing from the previous mod may survive the switch.
    setSelected(null);
    setDraft(null);
    setDirty(false);
    setErrors([]);
    setBuildLog([]);
    setFiles([]);
  }

  useEffect(() => {
    if (project) void refreshFiles();
  }, [project, refreshFiles]);

  // Pushed by the server when anything changes on disk, so edits made outside
  // the editor appear without a refresh.
  useEffect(() => {
    if (!project) return;
    const events = new EventSource('/api/events');
    events.onmessage = () => {
      void refreshFiles();
    };
    return () => events.close();
  }, [project, refreshFiles]);

  const open = useCallback(async (name: string) => {
    // The file list is always visible, so opening from another tab has to
    // bring the editor with it.
    setTab('images');
    setSelected(name);
    setErrors([]);
    setDirty(false);
    try {
      const { data } = await api.readContent(name);
      setDraft(data);
    } catch (err) {
      setDraft(null);
      setErrors([err instanceof Error ? err.message : String(err)]);
    }
  }, []);

  async function save() {
    if (!selected || !draft) return;
    try {
      const result = await api.saveContent(selected, draft);
      if (result.ok) {
        setDirty(false);
        setErrors([]);
        await refreshFiles();
      } else {
        setErrors(result.errors ?? ['Save failed.']);
      }
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    }
  }

  async function remove() {
    if (!selected) return;
    if (!confirm(`Delete ${selected}.yaml? This cannot be undone.`)) return;
    await api.deleteContent(selected);
    setSelected(null);
    setDraft(null);
    await refreshFiles();
  }

  async function runBuild() {
    setBuilding(true);
    setBuildLog([]);
    try {
      const { results } = await api.build();
      setBuildLog(results.map((r) => r.line));
      setTab('output');
    } catch (err) {
      setBuildLog([err instanceof Error ? err.message : String(err)]);
      setTab('output');
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar__brand">SWDH</span>
        <select
          className="topbar__project"
          value={project ?? ''}
          onChange={(e) => switchProject(e.target.value)}
          title="Mod being edited"
        >
          {projects.length === 0 && <option value="">no projects</option>}
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <div className="tabs">
          {(['images', 'description', 'publish', 'output', 'settings'] as Tab[]).map((t) => (
            <button
              key={t}
              className="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="spacer" />
        {dirty && <span className="preview-caption">unsaved</span>}
        <button onClick={runBuild} disabled={building}>
          {building ? 'Rendering…' : 'Render PNGs'}
        </button>
      </header>

      <aside className="sidebar">
        <div className="row" style={{ marginBottom: 8 }}>
          <button style={{ width: '100%' }} onClick={() => setCreating(true)}>
            + New image
          </button>
        </div>
        <ul className="filelist">
          {files.map((f) => (
            <li key={f.name}>
              <button aria-current={selected === f.name} onClick={() => void open(f.name)}>
                {f.name}
                <span className={`type${f.valid ? '' : ' invalid'}`}>
                  {f.valid ? f.type : 'invalid — cannot parse'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="main">
        {tab === 'images' && (
          <>
            <section className="pane">
              {errors.length > 0 && <div className="errors">{errors.join('\n')}</div>}

              {draft ? (
                <>
                  <div className="row" style={{ marginBottom: 12 }}>
                    <button className="primary" onClick={() => void save()} disabled={!dirty}>
                      Save
                    </button>
                    <div className="spacer" />
                    <button className="danger" onClick={() => void remove()}>
                      Delete
                    </button>
                  </div>

                  <ContentForm
                    value={draft}
                    onChange={(next) => {
                      setDraft(next);
                      setDirty(true);
                    }}
                  />
                </>
              ) : (
                <p className="hint">
                  Select an image on the left, or create a new one. Files are plain YAML in
                  <code> content/</code> — the editor reads and writes them in place, so the CLI
                  and anything generated for you keep working.
                </p>
              )}
            </section>

            <section className="pane pane--preview">
              <Preview data={draft} />
            </section>
          </>
        )}

        {/* Keyed on the project so a switch remounts them with clean state. */}
        {tab === 'description' && (
          <section className="pane" style={{ gridColumn: '1 / -1' }}>
            <DescriptionPanel key={project} files={files} />
          </section>
        )}

        {tab === 'publish' && (
          <section className="pane" style={{ gridColumn: '1 / -1' }}>
            <PublishPanel key={project} />
          </section>
        )}

        {tab === 'settings' && (
          <section className="pane" style={{ gridColumn: '1 / -1' }}>
            <SettingsPanel key={project} />
          </section>
        )}

        {tab === 'output' && (
          <section className="pane" style={{ gridColumn: '1 / -1' }}>
            <h2 className="section-title">Last render</h2>
            {buildLog.length === 0 ? (
              <p className="hint">
                Nothing rendered yet this session. Press <strong>Render PNGs</strong> to write
                everything in <code>content/</code> to <code>out/</code>.
              </p>
            ) : (
              <pre className="errors" style={{ background: 'var(--panel)', borderColor: 'var(--edge)', color: 'var(--ink-dim)' }}>
                {buildLog.join('\n')}
              </pre>
            )}
          </section>
        )}
      </main>

      {creating && (
        <NewContentDialog
          onCancel={() => setCreating(false)}
          onCreated={async (name) => {
            setCreating(false);
            await refreshFiles();
            await open(name);
          }}
        />
      )}
    </div>
  );
}
