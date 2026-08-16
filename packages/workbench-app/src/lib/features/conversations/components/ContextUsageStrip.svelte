<script lang="ts">
import type { Snippet } from "svelte";
import type { ContextUsage } from "@nervekit/contracts";
import { cn } from "@nervekit/ui-kit/core/utils";
import { usageTone } from "@nervekit/ui-kit/core/utils/usage";

let {
  contextUsage,
  contextWindow = 0,
  children,
}: {
  contextUsage?: ContextUsage;
  contextWindow?: number;
  /** Rendered inside the gauge, below the token line (compact action). */
  children?: Snippet;
} = $props();

/** Half-circle sweep of the gauge path below (π × r, r = 50). */
const ARC_LENGTH = Math.PI * 50;
const ARC_PATH = "M 10 60 A 50 50 0 0 1 110 60";

const limit = $derived(contextWindow || contextUsage?.contextWindow || 0);
const tokens = $derived(contextUsage?.tokens ?? null);
const percent = $derived(
  tokens != null && limit > 0
    ? (tokens / limit) * 100
    : (contextUsage?.percent ?? null),
);
const hasUsage = $derived(limit > 0 || percent != null);
const clampedPercent = $derived(
  percent == null ? 0 : Math.max(0, Math.min(100, percent)),
);
const percentLabel = $derived(
  percent == null ? "—" : `${Math.round(percent)}%`,
);
const tokensLabel = $derived(
  tokens != null && limit > 0
    ? `${tokens.toLocaleString()} / ${limit.toLocaleString()} tokens`
    : limit > 0
      ? `${limit.toLocaleString()} token window`
      : "Usage unknown",
);
const tone = $derived(usageTone(percent));
const arcClass = $derived(
  tone === "error"
    ? "stroke-destructive-solid"
    : tone === "warning"
      ? "stroke-warning"
      : "stroke-primary",
);
const percentClass = $derived(
  tone === "error"
    ? "text-destructive"
    : tone === "warning"
      ? "text-warning"
      : "text-foreground",
);
</script>

{#if hasUsage}
  <div class="relative mx-auto w-full max-w-56">
    <svg
      viewBox="0 0 120 66"
      class="w-full"
      role="img"
      aria-label={`Context window usage: ${percentLabel} of ${tokensLabel}`}
    >
      <path
        d={ARC_PATH}
        fill="none"
        stroke-width="8"
        stroke-linecap="round"
        class="stroke-muted"
      />
      {#if percent != null}
        <path
          d={ARC_PATH}
          fill="none"
          stroke-width="8"
          stroke-linecap="round"
          class={arcClass}
          stroke-dasharray={ARC_LENGTH}
          stroke-dashoffset={ARC_LENGTH * (1 - clampedPercent / 100)}
        />
      {/if}
    </svg>
    <div
      class="absolute inset-x-4 bottom-0.5 flex min-w-0 flex-col items-center gap-1"
    >
      <span class={cn("text-xl leading-none font-semibold", percentClass)}>
        {percentLabel}
      </span>
      <span class="max-w-full truncate text-xs text-muted-foreground">
        {tokensLabel}
      </span>
      {#if children}
        {@render children()}
      {/if}
    </div>
  </div>
{:else}
  <p class="py-1.5 text-xs text-muted-foreground">
    Context usage is available after the first run.
  </p>
{/if}
