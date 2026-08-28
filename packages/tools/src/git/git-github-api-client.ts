import { GitWorkflowError } from "./git-errors.js";
import type { GithubRepositoryRef } from "./git-github-parsers.js";
import type { GithubRequestObservation } from "./git-observability.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_TOKEN_TTL_MS = 5 * 60_000;

type TokenEntry = { readonly token: string; readonly expiresAt: number };

type GithubApiClientOptions = {
  readonly tokenProvider: (hostname: string) => Promise<string>;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly tokenTtlMs?: number;
  readonly timeoutMs?: number;
  readonly onRequestCompleted?: (observation: GithubRequestObservation) => void;
};

type RestOptions = {
  readonly method?: "GET" | "POST" | "PUT";
  readonly body?: unknown;
  readonly operation: string;
};

type GraphqlEnvelope<T> = {
  readonly data?: T;
  readonly errors?: readonly { readonly message?: string }[];
};

export class GithubApiClient {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #tokenTtlMs: number;
  readonly #timeoutMs: number;
  readonly #tokens = new Map<string, TokenEntry>();
  readonly #tokenRequests = new Map<string, Promise<string>>();

  constructor(readonly options: GithubApiClientOptions) {
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#tokenTtlMs = options.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async graphql<T>(
    repository: GithubRepositoryRef,
    operation: string,
    query: string,
    variables: Readonly<Record<string, unknown>>,
  ): Promise<T> {
    const envelope = await this.#request<GraphqlEnvelope<T>>(
      repository,
      "https://api.github.com/graphql",
      {
        method: "POST",
        body: { query, variables },
        operation,
      },
    );
    if (envelope.errors?.length || envelope.data === undefined) {
      const detail = envelope.errors
        ?.map((error) => error.message?.trim())
        .filter(Boolean)
        .join("; ")
        .slice(0, 500);
      if (
        detail &&
        /Could not resolve to a (PullRequest|Repository)/i.test(detail)
      )
        throw new GitWorkflowError(
          404,
          "GH_NOT_FOUND",
          "GitHub resource not found.",
        );
      throw new GitWorkflowError(
        502,
        "GH_GRAPHQL_FAILED",
        detail || "GitHub returned an invalid GraphQL response.",
      );
    }
    return envelope.data;
  }

  rest<T>(
    repository: GithubRepositoryRef,
    path: string,
    options: RestOptions,
  ): Promise<T> {
    return this.#request<T>(
      repository,
      `https://api.github.com${path}`,
      options,
    );
  }

  async token(hostname: string): Promise<string> {
    const cached = this.#tokens.get(hostname);
    if (cached && cached.expiresAt > this.#now()) return cached.token;
    const existing = this.#tokenRequests.get(hostname);
    if (existing) return existing;

    const request = (async () => {
      try {
        const token = (await this.options.tokenProvider(hostname)).trim();
        if (!token) throw new Error("GitHub CLI returned an empty token.");
        this.#tokens.set(hostname, {
          token,
          expiresAt: this.#now() + this.#tokenTtlMs,
        });
        return token;
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (/ENOENT|not found|not recognized/i.test(text)) {
          throw new GitWorkflowError(
            503,
            "GH_CLI_UNAVAILABLE",
            "GitHub CLI (gh) is not installed.",
          );
        }
        throw new GitWorkflowError(
          401,
          "GH_AUTH_REQUIRED",
          "Not authenticated. Run `gh auth login`.",
        );
      }
    })();
    this.#tokenRequests.set(hostname, request);
    try {
      return await request;
    } finally {
      if (this.#tokenRequests.get(hostname) === request)
        this.#tokenRequests.delete(hostname);
    }
  }

  async #request<T>(
    repository: GithubRepositoryRef,
    url: string,
    options: RestOptions,
  ): Promise<T> {
    const method = options.method ?? "GET";
    let lastStatus: number | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const startedAt = performance.now();
      try {
        const token = await this.token(repository.hostname);
        const response = await this.#fetch(url, {
          method,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
        lastStatus = response.status;
        if (response.status === 401 && attempt === 0) {
          this.#tokens.delete(repository.hostname);
          this.#observe(
            repository,
            options.operation,
            method,
            startedAt,
            false,
            response.status,
          );
          continue;
        }
        if (!response.ok) throw apiError(response.status, response.headers);
        const value = (await response.json()) as T;
        this.#observe(
          repository,
          options.operation,
          method,
          startedAt,
          true,
          response.status,
        );
        return value;
      } catch (error) {
        if (error instanceof GitWorkflowError) {
          this.#observe(
            repository,
            options.operation,
            method,
            startedAt,
            false,
            lastStatus,
          );
          throw error;
        }
        this.#observe(
          repository,
          options.operation,
          method,
          startedAt,
          false,
          lastStatus,
        );
        throw new GitWorkflowError(
          503,
          "GH_API_UNAVAILABLE",
          error instanceof Error && error.name === "TimeoutError"
            ? "GitHub API request timed out."
            : "Could not reach the GitHub API.",
        );
      }
    }
    throw new GitWorkflowError(
      401,
      "GH_AUTH_REQUIRED",
      "GitHub authentication expired. Run `gh auth refresh` or `gh auth login`.",
    );
  }

  #observe(
    repository: GithubRepositoryRef,
    operation: string,
    method: "GET" | "POST" | "PUT",
    startedAt: number,
    succeeded: boolean,
    status?: number,
  ): void {
    try {
      this.options.onRequestCompleted?.({
        operation,
        method,
        hostname: repository.hostname,
        owner: repository.owner,
        repository: repository.repo,
        durationMs: performance.now() - startedAt,
        succeeded,
        status,
      });
    } catch {
      // Diagnostics must never affect GitHub operations.
    }
  }
}

function apiError(status: number, headers: Headers): GitWorkflowError {
  if (status === 401) {
    return new GitWorkflowError(
      401,
      "GH_AUTH_REQUIRED",
      "GitHub authentication expired. Run `gh auth refresh` or `gh auth login`.",
    );
  }
  if (status === 403) {
    const rateLimited = headers.get("x-ratelimit-remaining") === "0";
    return new GitWorkflowError(
      403,
      rateLimited ? "GH_RATE_LIMITED" : "GH_FORBIDDEN",
      rateLimited
        ? "GitHub API rate limit exceeded. Try again later."
        : "GitHub denied this operation. Check the token permissions.",
    );
  }
  if (status === 404)
    return new GitWorkflowError(
      404,
      "GH_NOT_FOUND",
      "GitHub resource not found.",
    );
  if (status === 409 || status === 422)
    return new GitWorkflowError(
      409,
      "GH_CONFLICT",
      "GitHub rejected the operation because the pull request changed or cannot be merged.",
    );
  if (status === 429)
    return new GitWorkflowError(
      429,
      "GH_RATE_LIMITED",
      "GitHub API rate limit exceeded. Try again later.",
    );
  return new GitWorkflowError(
    status >= 500 ? 503 : 400,
    status >= 500 ? "GH_API_UNAVAILABLE" : "GH_API_FAILED",
    status >= 500
      ? "GitHub API is temporarily unavailable."
      : "GitHub rejected the request.",
  );
}
