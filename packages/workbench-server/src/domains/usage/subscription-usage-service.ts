import {
  SUBSCRIPTION_USAGE_EVENT,
  type SubscriptionUsage,
  type SubscriptionUsageProvider,
} from "@nervekit/contracts/usage";
import type { WorkbenchNoticePublisher } from "../../infrastructure/events/index.js";
import type { AuthManager } from "../auth/index.js";
import { fetchAnthropicUsage } from "./anthropic-client.js";
import { fetchCodexUsage } from "./codex-client.js";
import { fetchCopilotUsage } from "./copilot-client.js";

const MIN_REFRESH_INTERVAL_MS = 30_000;
const GLOBAL_PROVIDERS: readonly SubscriptionUsageProvider[] = [
  "anthropic",
  "openai-codex",
  "github-copilot",
];

/**
 * Resolves the provider's usage credentials. Returns the fetch to run, or
 * `undefined` when no usable credential is stored.
 */
export type SubscriptionUsageSource = (
  auth: AuthManager,
) => Promise<
  ((cacheDir: string) => Promise<SubscriptionUsage | null>) | undefined
>;

function bearerSource(
  provider: SubscriptionUsageProvider,
  fetchUsage: (
    token: string,
    cacheDir: string,
  ) => Promise<SubscriptionUsage | null>,
): SubscriptionUsageSource {
  return async (auth) => {
    const token = await auth.getApiKey(provider);
    return token ? (cacheDir) => fetchUsage(token, cacheDir) : undefined;
  };
}

/** Copilot's quota endpoint takes the stored GitHub token, not the exchanged Copilot token. */
const copilotSource: SubscriptionUsageSource = async (auth) => {
  const credential = await auth.getCredential("github-copilot");
  if (credential?.type !== "oauth") return undefined;
  const githubToken = credential.refresh;
  if (typeof githubToken !== "string" || !githubToken) return undefined;
  const enterpriseUrl =
    typeof credential.enterpriseUrl === "string"
      ? credential.enterpriseUrl
      : undefined;
  return (cacheDir) =>
    fetchCopilotUsage({ githubToken, enterpriseUrl }, cacheDir);
};

const DEFAULT_SOURCES: Record<
  SubscriptionUsageProvider,
  SubscriptionUsageSource
> = {
  anthropic: bearerSource("anthropic", fetchAnthropicUsage),
  "openai-codex": bearerSource("openai-codex", fetchCodexUsage),
  "github-copilot": copilotSource,
};

export interface SubscriptionUsageServiceDeps {
  auth: AuthManager;
  events: WorkbenchNoticePublisher;
  /** Directory for persisted usage caches (e.g. `<dataDir>/cache/usage`). */
  cacheDir: string;
  /** Overrides per provider; defaults to the live provider endpoints. */
  sources?: Partial<Record<SubscriptionUsageProvider, SubscriptionUsageSource>>;
  now?: () => number;
}

/**
 * Manages provider subscription usage (Anthropic and Codex time windows,
 * Copilot monthly allowances) for globally supported OAuth providers.
 *
 * Refreshing is request-driven: clients poll for fresh snapshots and the service
 * debounces upstream provider calls to at most one attempt per provider every
 * {@link MIN_REFRESH_INTERVAL_MS}.
 */
export class SubscriptionUsageService {
  readonly #deps: SubscriptionUsageServiceDeps;
  readonly #snapshots = new Map<SubscriptionUsageProvider, SubscriptionUsage>();
  readonly #inFlight = new Map<SubscriptionUsageProvider, Promise<void>>();
  readonly #lastAttemptAt = new Map<SubscriptionUsageProvider, number>();
  #stopped = false;

  constructor(deps: SubscriptionUsageServiceDeps) {
    this.#deps = deps;
  }

  start(): void {
    // Refreshes are triggered by client `usage.subscription.get` requests.
  }

  /** Rejects new refreshes and waits for in-flight ones, so no fetch or cache write outlives shutdown. */
  async stop(): Promise<void> {
    this.#stopped = true;
    await Promise.allSettled([...this.#inFlight.values()]);
  }

  /** Current snapshots, optionally refreshing all globally supported providers. */
  async getSnapshots(
    options: { refresh?: boolean } = {},
  ): Promise<SubscriptionUsage[]> {
    if (options.refresh) {
      await Promise.all(
        GLOBAL_PROVIDERS.map((provider) => this.refreshProvider(provider)),
      );
    }
    return this.configuredSnapshots();
  }

  private async configuredSnapshots(): Promise<SubscriptionUsage[]> {
    const snapshots: SubscriptionUsage[] = [];
    for (const provider of GLOBAL_PROVIDERS) {
      if ((await this.#deps.auth.credentialType(provider)) !== "oauth") {
        this.#snapshots.delete(provider);
        continue;
      }
      const snapshot = this.#snapshots.get(provider);
      if (snapshot) snapshots.push(snapshot);
    }
    return snapshots;
  }

  private refreshProvider(provider: SubscriptionUsageProvider): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    const existing = this.#inFlight.get(provider);
    if (existing) return existing;

    const refresh = this.performRefresh(provider).finally(() => {
      this.#inFlight.delete(provider);
    });
    this.#inFlight.set(provider, refresh);
    return refresh;
  }

  private async performRefresh(
    provider: SubscriptionUsageProvider,
  ): Promise<void> {
    try {
      if ((await this.#deps.auth.credentialType(provider)) !== "oauth") {
        this.#snapshots.delete(provider);
        return;
      }
      const now = this.now();
      const lastAttemptAt = this.#lastAttemptAt.get(provider);
      if (
        lastAttemptAt !== undefined &&
        now - lastAttemptAt < MIN_REFRESH_INTERVAL_MS
      ) {
        return;
      }
      const source =
        this.#deps.sources?.[provider] ?? DEFAULT_SOURCES[provider];
      const fetchUsage = await source(this.#deps.auth);
      if (!fetchUsage) return;
      this.#lastAttemptAt.set(provider, now);
      const data = await fetchUsage(this.#deps.cacheDir);
      if (!data) return;
      const previous = this.#snapshots.get(provider);
      this.#snapshots.set(provider, data);
      if (!previous || hasChanged(previous, data)) {
        await this.#deps.events.publish(SUBSCRIPTION_USAGE_EVENT, data);
      }
    } catch {
      // transient failure; keep last-known snapshot
    }
  }

  private now(): number {
    return this.#deps.now?.() ?? Date.now();
  }
}

function hasChanged(a: SubscriptionUsage, b: SubscriptionUsage): boolean {
  return (
    a.planType !== b.planType ||
    JSON.stringify(a.quotas) !== JSON.stringify(b.quotas)
  );
}
