import {
  SUBSCRIPTION_USAGE_EVENT,
  type SubscriptionUsage,
  type SubscriptionUsageProvider,
} from "@nervekit/shared";
import type { AuthManager } from "../../auth.js";
import type { EventBus } from "../../infrastructure/events/index.js";
import { fetchAnthropicUsage as defaultFetchAnthropicUsage } from "./anthropic-client.js";
import {
  fetchCodexUsage as defaultFetchCodexUsage,
  mergeCodexUsage,
  parseCodexUsageHeaders,
  writeCodexUsageCache,
} from "./codex-client.js";

const MIN_REFRESH_INTERVAL_MS = 30_000;
const GLOBAL_PROVIDERS: readonly SubscriptionUsageProvider[] = [
  "anthropic",
  "openai-codex",
];

type FetchUsage = (
  token: string,
  cacheDir: string,
) => Promise<SubscriptionUsage | null>;

export interface SubscriptionUsageServiceDeps {
  auth: AuthManager;
  events: EventBus;
  /** Directory for persisted usage caches (e.g. `<dataDir>/cache/usage`). */
  cacheDir: string;
  fetchAnthropicUsage?: FetchUsage;
  fetchCodexUsage?: FetchUsage;
  now?: () => number;
}

/**
 * Manages provider subscription usage (Anthropic 5h/7d, Codex
 * primary/secondary) for globally supported OAuth providers.
 *
 * Refreshing is request-driven: callers ask for fresh snapshots and the service
 * debounces upstream provider calls to at most one attempt per provider every
 * {@link MIN_REFRESH_INTERVAL_MS}. Codex also receives live header updates via
 * {@link applyCodexHeaders}.
 */
export class SubscriptionUsageService {
  readonly #deps: SubscriptionUsageServiceDeps;
  readonly #snapshots = new Map<SubscriptionUsageProvider, SubscriptionUsage>();
  readonly #inFlight = new Map<SubscriptionUsageProvider, Promise<void>>();
  readonly #lastAttemptAt = new Map<SubscriptionUsageProvider, number>();

  constructor(deps: SubscriptionUsageServiceDeps) {
    this.#deps = deps;
  }

  start(): void {
    // Refreshes are triggered by GET /api/usage/subscription and by agent runs.
  }

  stop(): void {
    // No background timer to stop.
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

  /** Mark a model provider as used and request a debounced refresh. */
  touchProvider(provider: string): void {
    if (!isSubscriptionUsageProvider(provider)) return;
    void this.refreshProvider(provider);
  }

  /** Apply a Codex usage snapshot derived from provider response headers. */
  applyCodexHeaders(headers: Record<string, string>): void {
    const parsed = parseCodexUsageHeaders(headers);
    if (!parsed) return;
    const now = this.now();
    this.#lastAttemptAt.set("openai-codex", now);
    const merged = mergeCodexUsage(
      this.#snapshots.get("openai-codex") ?? null,
      parsed,
    );
    this.#snapshots.set("openai-codex", merged);
    void writeCodexUsageCache(this.#deps.cacheDir, merged);
    void this.#deps.events.publish(SUBSCRIPTION_USAGE_EVENT, merged, {
      durability: "transient",
    });
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
      const token = await this.#deps.auth.getApiKey(provider);
      if (!token) return;
      this.#lastAttemptAt.set(provider, now);
      const fetcher =
        provider === "anthropic"
          ? (this.#deps.fetchAnthropicUsage ?? defaultFetchAnthropicUsage)
          : (this.#deps.fetchCodexUsage ?? defaultFetchCodexUsage);
      const data = await fetcher(token, this.#deps.cacheDir);
      if (!data) return;
      const previous = this.#snapshots.get(provider);
      this.#snapshots.set(provider, data);
      if (!previous || hasChanged(previous, data)) {
        await this.#deps.events.publish(SUBSCRIPTION_USAGE_EVENT, data, {
          durability: "transient",
        });
      }
    } catch {
      // transient failure; keep last-known snapshot
    }
  }

  private now(): number {
    return this.#deps.now?.() ?? Date.now();
  }
}

function isSubscriptionUsageProvider(
  provider: string,
): provider is SubscriptionUsageProvider {
  return provider === "anthropic" || provider === "openai-codex";
}

function hasChanged(a: SubscriptionUsage, b: SubscriptionUsage): boolean {
  return (
    a.session?.usedPercent !== b.session?.usedPercent ||
    a.weekly?.usedPercent !== b.weekly?.usedPercent ||
    a.session?.resetsAt !== b.session?.resetsAt ||
    a.weekly?.resetsAt !== b.weekly?.resetsAt ||
    a.session?.resetAfterSeconds !== b.session?.resetAfterSeconds ||
    a.weekly?.resetAfterSeconds !== b.weekly?.resetAfterSeconds
  );
}
