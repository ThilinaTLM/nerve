<script lang="ts">
  import type { ContextUsage } from "$lib/api";
  import { formatTokens, usageTone } from "$lib/core/utils/usage";

  type Props = {
    contextUsage?: ContextUsage;
    contextWindow?: number;
  };

  let { contextUsage, contextWindow = 0 }: Props = $props();

  const contextLimit = $derived(
    contextWindow || contextUsage?.contextWindow || 0,
  );
  const tokens = $derived(contextUsage?.tokens ?? null);
  const percent = $derived.by(() => {
    if (tokens != null && contextLimit > 0) {
      return (tokens / contextLimit) * 100;
    }
    return contextUsage?.percent ?? null;
  });
  const ringPercent = $derived(
    percent == null ? 0 : Math.max(0, Math.min(100, percent)),
  );
  const tone = $derived(usageTone(percent));
  const percentLabel = $derived(
    percent == null ? "?%" : `${Math.round(percent)}%`,
  );
  const title = $derived.by(() => {
    if (tokens != null && contextLimit > 0) {
      return `Context: ${tokens.toLocaleString()} / ${contextLimit.toLocaleString()} tokens`;
    }
    if (contextLimit > 0) {
      return `Context usage unknown / ${contextLimit.toLocaleString()} tokens`;
    }
    return "Context window unknown";
  });
  const windowLabel = $derived(
    contextLimit > 0 ? formatTokens(contextLimit) : "—",
  );
</script>

{#if contextLimit > 0 || percent != null}
  <span
    class="composer-tab context-usage-tab"
    data-tone={tone}
    style={`--ctx-fill: ${ringPercent}%;`}
    {title}
    aria-label={`${title}. ${percentLabel} of context window.`}
  >
    <span class="ctx-ring" aria-hidden="true">
      <span class="ctx-ring-core"></span>
    </span>
    <span class="ctx-percent">{percentLabel}</span>
    <span class="ctx-window">/{windowLabel}</span>
  </span>
{/if}

<style>
  .context-usage-tab {
    cursor: default;
    padding: 0 0.48rem;
  }

  .ctx-ring {
    --ctx-color: var(--muted-foreground);
    display: inline-grid;
    width: 0.8rem;
    height: 0.8rem;
    place-items: center;
    border-radius: 999px;
    background: conic-gradient(
      var(--ctx-color) var(--ctx-fill),
      color-mix(in oklab, var(--border) 82%, transparent) 0
    );
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--foreground) 7%, transparent) inset;
  }

  .ctx-ring-core {
    width: 0.48rem;
    height: 0.48rem;
    border-radius: inherit;
    background: var(--card);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--foreground) 4%, transparent);
  }

  .ctx-percent {
    color: var(--foreground);
  }

  .ctx-window {
    color: var(--muted-foreground);
    font-weight: 500;
  }

  .context-usage-tab[data-tone="warning"] .ctx-ring {
    --ctx-color: var(--warning);
  }

  .context-usage-tab[data-tone="warning"] .ctx-percent {
    color: var(--warning);
  }

  .context-usage-tab[data-tone="error"] .ctx-ring {
    --ctx-color: var(--destructive);
  }

  .context-usage-tab[data-tone="error"] .ctx-percent {
    color: var(--destructive);
  }

  @media (max-width: 639px) {
    .ctx-window {
      display: none;
    }
  }
</style>
