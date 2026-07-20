import { createHash } from 'node:crypto';

/**
 * Minimal Git Data API client. The Contents API would commit per file, spreading
 * one publish across several SHAs; a tree plus one commit gives a single SHA.
 *
 * The token is never logged — error messages here must stay free of it.
 */

const API = 'https://api.github.com';

export interface TreeEntry {
  path: string;
  sha: string;
  type: string;
}

/** One path in a new tree: a blob id to write it, or null to delete it. */
export interface TreeChange {
  path: string;
  sha: string | null;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class GitHub {
  constructor(
    private readonly repo: string,
    private readonly token: string,
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'SteamWorkshopDescriptionHelper',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new GitHubError(explain(res.status, body.message, this.repo), res.status);
    }
    return (await res.json()) as T;
  }

  async headCommitSha(branch: string): Promise<string> {
    const ref = await this.call<{ object: { sha: string } }>(
      `/repos/${this.repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    return ref.object.sha;
  }

  async treeShaOfCommit(commitSha: string): Promise<string> {
    const commit = await this.call<{ tree: { sha: string } }>(
      `/repos/${this.repo}/git/commits/${commitSha}`,
    );
    return commit.tree.sha;
  }

  /** Recursive listing, used to skip files whose contents already match. */
  async listTree(treeSha: string): Promise<TreeEntry[]> {
    const tree = await this.call<{ tree: TreeEntry[]; truncated?: boolean }>(
      `/repos/${this.repo}/git/trees/${treeSha}?recursive=1`,
    );
    // Truncated makes "unchanged" unreliable, so upload everything instead.
    return tree.truncated ? [] : tree.tree;
  }

  async createBlob(content: Buffer): Promise<string> {
    const blob = await this.call<{ sha: string }>(`/repos/${this.repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
    });
    return blob.sha;
  }

  /** A null sha removes the path from the base tree. */
  async createTree(baseTree: string, entries: TreeChange[]): Promise<string> {
    const tree = await this.call<{ sha: string }>(`/repos/${this.repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTree,
        tree: entries.map((e) => ({ path: e.path, mode: '100644', type: 'blob', sha: e.sha })),
      }),
    });
    return tree.sha;
  }

  async createCommit(message: string, treeSha: string, parent: string): Promise<string> {
    const commit = await this.call<{ sha: string }>(`/repos/${this.repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: treeSha, parents: [parent] }),
    });
    return commit.sha;
  }

  async updateRef(branch: string, commitSha: string): Promise<void> {
    await this.call(`/repos/${this.repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commitSha, force: false }),
    });
  }
}

/** Git's blob id, so unchanged files are detected without uploading them. */
export function gitBlobSha(content: Buffer): string {
  return createHash('sha1')
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest('hex');
}

function explain(status: number, message: string | undefined, repo: string): string {
  switch (status) {
    case 401:
      return 'GitHub rejected the token (401). Check GITHUB_TOKEN in .env — it may be expired or mistyped.';
    case 403:
      return (
        `GitHub refused the request (403). Either the rate limit is exhausted, or the token ` +
        `lacks "Contents: Read and write" on ${repo}.`
      );
    case 404:
      return (
        `${repo} not found (404). Either the name is wrong in swdh.workspace.json, or the ` +
        `token is not scoped to that repository. A fine-grained token sees only repos you granted it.`
      );
    case 409:
      return (
        `The branch moved while publishing (409). Someone or something else pushed; pull and ` +
        `publish again.`
      );
    case 422:
      return `GitHub rejected the data (422): ${message ?? 'unprocessable'}. The branch may be empty — push an initial commit first.`;
    default:
      return `GitHub API error ${status}: ${message ?? 'unknown'}`;
  }
}
