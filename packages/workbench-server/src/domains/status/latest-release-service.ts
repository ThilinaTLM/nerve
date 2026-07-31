import type { LatestRelease } from "@nervekit/contracts";
import { latestReleaseSchema } from "@nervekit/contracts";
import { z } from "zod";

const LATEST_RELEASE_URL =
  "https://api.github.com/repos/ThilinaTLM/nerve/releases/latest";
const RELEASE_CACHE_TTL_MS = 60 * 60_000;
const RELEASE_REQUEST_TIMEOUT_MS = 10_000;

const githubLatestReleaseSchema = z.object({
  tag_name: z.string().min(1),
  html_url: z.string().url(),
  published_at: z.string().datetime(),
});

type ReleaseFetch = (input: string, init?: RequestInit) => Promise<Response>;

type LatestReleaseServiceOptions = {
  fetch?: ReleaseFetch;
  now?: () => number;
  cacheTtlMs?: number;
};

export class LatestReleaseService {
  readonly #fetch: ReleaseFetch;
  readonly #now: () => number;
  readonly #cacheTtlMs: number;
  #cached?: { value: LatestRelease; fetchedAt: number };
  #inFlight?: Promise<LatestRelease>;

  constructor(options: LatestReleaseServiceOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#cacheTtlMs = options.cacheTtlMs ?? RELEASE_CACHE_TTL_MS;
  }

  async getLatestRelease(): Promise<LatestRelease> {
    if (
      this.#cached &&
      this.#now() - this.#cached.fetchedAt < this.#cacheTtlMs
    ) {
      return this.#cached.value;
    }
    if (this.#inFlight) return this.#inFlight;

    const request = this.#loadLatestRelease();
    this.#inFlight = request;
    try {
      const value = await request;
      this.#cached = { value, fetchedAt: this.#now() };
      return value;
    } finally {
      if (this.#inFlight === request) this.#inFlight = undefined;
    }
  }

  async #loadLatestRelease(): Promise<LatestRelease> {
    const response = await this.#fetch(LATEST_RELEASE_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "nerve-workbench-server",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(RELEASE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `GitHub latest release request failed (${response.status} ${response.statusText})`,
      );
    }

    const release = githubLatestReleaseSchema.parse(await response.json());
    return latestReleaseSchema.parse({
      version: release.tag_name.replace(/^v/, ""),
      releaseUrl: release.html_url,
      publishedAt: release.published_at,
    });
  }
}
