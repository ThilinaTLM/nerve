import {
  SUBSCRIPTION_USAGE_EVENT,
  type SubscriptionUsage,
  type SubscriptionUsageProvider,
} from "@nerve/shared";
import type { AuthManager } from "../auth.js";
import type { EventBus } from "../events.js";
import { fetchAnthropicUsage } from "./anthropic-client.js";
import {
  fetchCodexUsage,
  mergeCodexUsage,
  parseCodexUsageHeaders,
  writeCodexUsageCache,
} from "./codex-client.js";

const POLL_INTERVAL_MS = 30_000;

export interface SubscriptionUsageServiceDeps {
  auth: AuthManager;
  events: EventBus;
  /** Directory for persisted usage caches (e.g. `<dataDir>/cache/usage`). */
  cacheDir: string;
}

/**
 * Polls provider subscription usage (Anthropic 5h/7d, Codex primary/secondary)
 * for providers that are in active use, and publishes
 * {@link SUBSCRIPTION_USAGE_EVENT} as snapshots refresh.
 *
 * A provider becomes "active" once an agent runs with it ({@link touchProvider}).
 * Codex also receives live header updates via {@link applyCodexHeaders}.
 */
export class SubscriptionUsageService {
  readonly #deps: SubscriptionUsageServiceDeps;
  readonly #snapshots = new Map<SubscriptionUsageProvider, SubscriptionUsage>();
  readonly #active = new Set<SubscriptionUsageProvider>();
  readonly #inFlight = new Set<SubscriptionUsageProvider>();
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(deps: SubscriptionUsageServiceDeps) {
    this.#deps = deps;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      for (const provider of this.#active) {
        void this.refresh(provider);
      }
    }, POLL_INTERVAL_MS);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  /** Current snapshots for all providers with known usage. */
  getSnapshots(): SubscriptionUsage[] {
    return [...this.#snapshots.values()];
  }

  /** Mark a model provider as active and refresh its usage immediately. */
  touchProvider(provider: string): void {
    if (provider !== "anthropic" && provider !== "openai-codex") return;
    this.#active.add(provider);
    void this.refresh(provider);
  }

  /** Apply a Codex usage snapshot derived from provider response headers. */
  applyCodexHeaders(headers: Record<string, string>): void {
    const parsed = parseCodexUsageHeaders(headers);
    if (!parsed) return;
    this.#active.add("openai-codex");
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

  private async refresh(provider: SubscriptionUsageProvider): Promise<void> {
    if (this.#inFlight.has(provider)) return;
    this.#inFlight.add(provider);
    try {
      if ((await this.#deps.auth.credentialType(provider)) !== "oauth") return;
      const token = await this.#deps.auth.getApiKey(provider);
      if (!token) return;
      const data =
        provider === "anthropic"
          ? await fetchAnthropicUsage(token, this.#deps.cacheDir)
          : await fetchCodexUsage(token, this.#deps.cacheDir);
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
    } finally {
      this.#inFlight.delete(provider);
    }
  }
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
