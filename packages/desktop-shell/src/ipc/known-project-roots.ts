import { realpath } from "node:fs/promises";
import { projectSchema } from "@nervekit/contracts/core";

export interface DaemonConnection {
  url: string;
  token?: string;
}

export interface KnownProjectRootsOptions {
  /** Current daemon connection; `undefined` while no daemon is available. */
  getDaemon: () => DaemonConnection | undefined;
  ttlMs?: number;
  now?: () => number;
  fetch?: typeof globalThis.fetch;
  realpath?: (path: string) => Promise<string>;
}

const DEFAULT_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 256;

/**
 * Main-process trust anchor for project roots. The renderer only names a
 * project id; the canonical root comes from the daemon over its authenticated
 * HTTP API (short TTL cache) and is realpath'd. Fails closed on any error.
 */
export class KnownProjectRoots {
  readonly #options: KnownProjectRootsOptions;
  readonly #cache = new Map<string, { root: string; expiresAt: number }>();

  constructor(options: KnownProjectRootsOptions) {
    this.#options = options;
  }

  async resolve(projectId: string): Promise<string> {
    const now = (this.#options.now ?? Date.now)();
    const cached = this.#cache.get(projectId);
    if (cached && cached.expiresAt > now) return cached.root;
    this.#cache.delete(projectId);

    const root = await this.#fetchRoot(projectId);
    if (this.#cache.size >= MAX_CACHE_ENTRIES) this.#cache.clear();
    this.#cache.set(projectId, {
      root,
      expiresAt: now + (this.#options.ttlMs ?? DEFAULT_TTL_MS),
    });
    return root;
  }

  invalidate(): void {
    this.#cache.clear();
  }

  async #fetchRoot(projectId: string): Promise<string> {
    const daemon = this.#options.getDaemon();
    if (!daemon)
      throw new Error("Daemon is unavailable; cannot resolve project.");
    const headers: Record<string, string> = {};
    if (daemon.token) headers.authorization = `Bearer ${daemon.token}`;
    const url = new URL(
      `/api/projects/${encodeURIComponent(projectId)}`,
      daemon.url,
    );
    let response: Response;
    try {
      response = await (this.#options.fetch ?? fetch)(url, { headers });
    } catch {
      throw new Error("Daemon is unavailable; cannot resolve project.");
    }
    if (!response.ok)
      throw new Error(`Project lookup failed with status ${response.status}.`);
    const project = projectSchema.parse(await response.json());
    if (project.id !== projectId)
      throw new Error("Daemon returned a different project.");
    return (this.#options.realpath ?? realpath)(project.directory);
  }
}
