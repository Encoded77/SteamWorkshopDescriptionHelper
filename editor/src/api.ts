/** Typed client for the editor API. Mirrors src/server/api.ts. */

/** Not enumerated here: the list comes from /api/schema at runtime. */
export type ContentType = string;

export interface FieldInfo {
  key: string;
  kind: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'other';
  optional: boolean;
  default?: unknown;
  values?: string[];
  /** Set when the field holds a path to an asset. */
  asset?: string;
}

export interface TypeInfo {
  type: ContentType;
  surface: 'description' | 'preview' | 'carousel';
  canvas?: { width: number; height: number };
  fields: FieldInfo[];
}

export interface ContentListItem {
  name: string;
  type: ContentType | null;
  valid: boolean;
}

export interface Annotation {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  side: 'top' | 'right' | 'bottom' | 'left';
  /** Free label position; omitted pins it to the `side` border, centred on the region. */
  at?: { x: number; y: number };
}

export interface ImageItem {
  image: { src: string; caption?: string; annotations?: Annotation[]; dim?: number };
}
export type BodyItem = { p: string } | { list: string[] } | ImageItem;

/** Loosely typed: the server's Zod schema is the authority on shape. */
export type Content = Record<string, unknown> & { type: ContentType };

export interface AssetInfo {
  path: string;
  width?: number;
  height?: number;
}

export interface DescriptionState {
  source: string;
  urls: Record<string, string>;
  limit: number;
  chars: number;
  missing: string[];
  unused: string[];
  resolved: number;
  output: string;
}

/** Per-project design token overrides; anything unset uses the defaults. */
export interface Theme {
  accent?: string;
  accentBright?: string;
  accentDim?: string;
  signal?: string;
  panelBg?: string;
  ink?: string;
  edge?: string;
  radius?: number;
  textScale?: number;
}

export interface PublishStatus {
  project: string;
  repo: string;
  branch: string;
  /** Presence only — the token value never leaves the server. */
  hasToken: boolean;
  repoConfigured: boolean;
  modsMounted: boolean;
  /** Mod folders found under SWDH_MODS, for the Preview.png export. */
  modFolders: string[];
  /** Content files with no rendered PNG yet. */
  notRendered: string[];
  /** Rendered before their content file changed. */
  stale: string[];
  /** Images differing from the repo. null when it could not be determined. */
  pending: string[] | null;
  images: Array<{
    name: string;
    file: string;
    /** Only 'description' images are embedded in the description and get a URL. */
    kind: 'description' | 'carousel' | 'preview' | 'unknown';
    url: string | null;
  }>;
}

export interface PublishResult {
  sha: string;
  uploaded: string[];
  unchanged: string[];
  deleted: string[];
  urls: Record<string, string>;
  committed: boolean;
  log: string[];
}

/*
 * The active project is sent with every request rather than held on the server,
 * so two tabs can edit different mods without fighting over shared state.
 */
let activeProject: string | null = null;

export function setActiveProject(name: string): void {
  activeProject = name;
}

function scoped(path: string): string {
  if (!activeProject) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}project=${encodeURIComponent(activeProject)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(scoped(path), {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
  return body as T;
}

export const api = {
  /** Not project-scoped: describes the content types themselves. */
  schema: () => request<{ types: TypeInfo[] }>('/api/schema'),

  /** Not project-scoped: this is what the switcher is populated from. */
  listProjects: () =>
    request<{ projects: string[]; preferred: string | null }>('/api/projects'),

  listContent: () => request<ContentListItem[]>('/api/content'),

  readContent: (name: string) =>
    request<{ name: string; raw: string; data: Content }>(`/api/content/${name}`),

  saveContent: (name: string, data: Content) =>
    request<{ ok: boolean; errors?: string[]; raw?: string }>(`/api/content/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ data }),
    }),

  createContent: (name: string, data: Content) =>
    request<{ ok: boolean; errors?: string[]; name?: string }>('/api/content', {
      method: 'POST',
      body: JSON.stringify({ name, data }),
    }),

  deleteContent: (name: string) =>
    request<{ ok: boolean }>(`/api/content/${name}`, { method: 'DELETE' }),

  /** Renders unsaved editor state through the real exporter markup path. */
  previewDraft: (data: Content) =>
    request<{ ok: boolean; html?: string; errors?: string[] }>('/api/preview', {
      method: 'POST',
      body: JSON.stringify({ data }),
    }),

  listAssets: () => request<AssetInfo[]>('/api/assets'),

  assetUrl: (path: string) => scoped(`/api/asset?path=${encodeURIComponent(path)}`),

  build: () =>
    request<{ results: Array<{ name: string; line: string; preview: boolean }> }>('/api/build', {
      method: 'POST',
    }),

  publishStatus: () => request<PublishStatus>('/api/publish'),

  publish: () =>
    request<PublishResult>('/api/publish', { method: 'POST' }),

  exportPreview: (name: string, modFolder: string) =>
    request<{ ok: boolean; target: string }>('/api/export-preview', {
      method: 'POST',
      body: JSON.stringify({ name, modFolder }),
    }),

  /** The same glyph the writer rasterizes, so the preview cannot drift. */
  modIconUrl: (color: string) => `/api/modicon?color=${encodeURIComponent(color)}`,

  writeModIcon: (color: string, modFolder?: string) =>
    request<{ ok: boolean; target: string; bytes: number }>('/api/modicon', {
      method: 'POST',
      body: JSON.stringify({ color, modFolder }),
    }),

  readTheme: () => request<{ theme: Theme }>('/api/theme'),

  saveTheme: (theme: Theme) =>
    request<{ ok: boolean; errors?: string[]; theme?: Theme }>('/api/theme', {
      method: 'PUT',
      body: JSON.stringify({ theme }),
    }),

  readDescription: () => request<DescriptionState>('/api/description'),

  saveDescription: (patch: { source?: string; urls?: Record<string, string> }) =>
    request<DescriptionState>('/api/description', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
};
