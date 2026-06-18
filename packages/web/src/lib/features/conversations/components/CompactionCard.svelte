<script lang="ts">
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import FileText from "@lucide/svelte/icons/file-text";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Progress } from "$lib/components/ui/progress";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import Markdown from "$lib/Markdown.svelte";
  import type { ProjectRecord } from "$lib/api";
  import type { CompactionNotice } from "$lib/features/state-types";
  import { formatTokens } from "$lib/core/utils/usage";

  type Props = {
    notice: CompactionNotice;
    activeProject?: ProjectRecord;
    onOpenFile?: (path: string, line?: number) => void;
  };

  let { notice, activeProject, onOpenFile }: Props = $props();
  let expanded = $state(false);

  function recordValue(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  }

  function stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }

  const details = $derived(recordValue(notice.details));
  const fileOps = $derived(recordValue(details?.fileOps));
  const compactedMessages = $derived(
    typeof details?.compactedMessages === "number"
      ? details.compactedMessages
      : undefined,
  );
  const splitTurn = $derived(details?.splitTurn === true);
  const summaryText = $derived((notice.summary ?? notice.text ?? "").trim());
  const previewText = $derived(
    summaryText.length > 260 ? `${summaryText.slice(0, 260).trim()}…` : summaryText,
  );
  const canExpand = $derived(summaryText.length > 0);
  const reasonLabel = $derived.by(() => {
    if (notice.reason === "threshold") return "auto compact";
    if (notice.reason === "overflow") return "overflow recovery";
    return "manual compact";
  });
  const badgeTone = $derived.by(() => {
    if (notice.state === "failed") return "danger" as const;
    if (notice.state === "running") return "running" as const;
    return "good" as const;
  });
  const title = $derived.by(() => {
    if (notice.state === "running") return "Compacting context…";
    if (notice.state === "failed") return "Compaction failed";
    return "Context compacted";
  });
  const body = $derived.by(() => {
    if (notice.state === "running") {
      return "Summarizing older transcript content while preserving recent work.";
    }
    if (notice.state === "failed") {
      return notice.errorMessage?.trim() || "Could not compact this conversation.";
    }
    if (notice.reason === "threshold") {
      return "The selected model approached its context window, so older context was summarized.";
    }
    if (notice.reason === "overflow") {
      return "The model hit a context limit; Nerve compacted context and continued.";
    }
    return "Older transcript content was summarized. Recent messages remain verbatim.";
  });
  const contextPercent = $derived.by(() => {
    const used = notice.contextTokens ?? notice.tokensBefore;
    if (!used || !notice.contextWindow) return undefined;
    return Math.round((used / notice.contextWindow) * 100);
  });
  const metadata = $derived.by(() => {
    const items: string[] = [];
    if (typeof notice.tokensBefore === "number") {
      items.push(`${formatTokens(notice.tokensBefore)} before`);
    }
    if (typeof contextPercent === "number") {
      items.push(`${contextPercent}% context`);
    }
    if (typeof notice.keepRecentTokens === "number") {
      items.push(`${formatTokens(notice.keepRecentTokens)} kept recent`);
    }
    if (typeof compactedMessages === "number") {
      items.push(`${compactedMessages} messages compacted`);
    }
    if (splitTurn) items.push("split turn preserved");
    return items;
  });
  const fileRows = $derived([
    { label: "read", paths: stringArray(fileOps?.read) },
    { label: "written", paths: stringArray(fileOps?.written) },
    { label: "edited", paths: stringArray(fileOps?.edited) },
  ].filter((row) => row.paths.length > 0));

  function toggleExpanded() {
    if (canExpand) expanded = !expanded;
  }
</script>

<article
  class={`compaction-card state-${notice.state}`}
  aria-live={notice.state === "completed" ? undefined : "polite"}
>
  <div class="compaction-header">
    <StatusDot
      tone={badgeTone}
      pulse={notice.state === "running"}
      label={title}
    />
    <div class="compaction-title">
      <span>{title}</span>
      <Badge tone={badgeTone} size="xs">{reasonLabel}</Badge>
    </div>
  </div>

  <p class="compaction-body">{body}</p>

  {#if notice.state === "running"}
    <Progress class="compaction-progress" value={62} aria-label="Compaction in progress" />
  {/if}

  {#if notice.state === "failed" && notice.errorMessage}
    <div class="failure-line">
      <AlertTriangle size={14} strokeWidth={2.2} aria-hidden="true" />
      <span>{notice.errorMessage}</span>
    </div>
  {/if}

  {#if metadata.length > 0}
    <div class="metadata-row" aria-label="Compaction metadata">
      {#each metadata as item}
        <span>{item}</span>
      {/each}
    </div>
  {/if}

  {#if notice.state === "completed" && canExpand}
    <div class="summary-shell">
      {#if !expanded && previewText}
        <p class="summary-preview">{previewText}</p>
      {/if}

      <Button
        variant="ghost"
        size="sm"
        class="summary-toggle"
        aria-expanded={expanded}
        aria-controls={`compaction-summary-${notice.id}`}
        onclick={toggleExpanded}
      >
        {#if expanded}
          <ChevronUp size={14} strokeWidth={2.4} /> Hide summary
        {:else}
          <ChevronDown size={14} strokeWidth={2.4} /> Read summary
        {/if}
      </Button>

      {#if expanded}
        <div id={`compaction-summary-${notice.id}`} class="summary-markdown">
          <Markdown
            text={summaryText}
            trimCodeBlocks={false}
            linkBasePath={activeProject?.dir}
            {onOpenFile}
          />
        </div>
      {/if}
    </div>
  {/if}

  {#if fileRows.length > 0}
    <div class="file-ops" aria-label="Compacted file operations">
      {#each fileRows as row}
        <div class="file-row">
          <span class="file-row-label"><FileText size={13} strokeWidth={2.2} /> {row.label}</span>
          <div class="file-paths">
            {#each row.paths as path}
              <button
                type="button"
                class="file-path"
                onclick={() => onOpenFile?.(path)}
                title={path}
              >
                {path}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</article>

<style>
  .compaction-card {
    display: grid;
    gap: 0.65rem;
    width: min(100%, 52rem);
    margin: 0.55rem auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: color-mix(in oklab, var(--card) 94%, var(--muted));
    padding: 0.8rem 0.9rem;
    box-shadow: var(--shadow-sm);
  }

  .compaction-card.state-running {
    border-color: color-mix(in oklab, var(--info) 34%, var(--border));
  }

  .compaction-card.state-failed {
    border-color: color-mix(in oklab, var(--destructive) 32%, var(--border));
  }

  .compaction-header {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.55rem;
  }

  .compaction-title {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    color: var(--foreground);
    font-size: var(--text-sm);
    font-weight: 650;
  }

  .compaction-body,
  .summary-preview {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
    line-height: 1.55;
  }

  .compaction-progress {
    position: relative;
  }

  .compaction-progress :global([data-slot="progress-indicator"]) {
    animation: compaction-progress 1.6s ease-in-out infinite;
  }

  .failure-line {
    display: flex;
    min-width: 0;
    align-items: flex-start;
    gap: 0.45rem;
    color: var(--destructive);
    font-size: var(--text-sm);
  }

  .failure-line span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .metadata-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .metadata-row span {
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--muted);
    color: var(--muted-foreground);
    padding: 0.18rem 0.48rem;
    font-size: var(--text-xs);
  }

  .summary-shell {
    display: grid;
    gap: 0.45rem;
  }

  .summary-toggle {
    justify-self: start;
  }

  .summary-markdown {
    min-width: 0;
    border-top: 1px solid var(--border);
    padding-top: 0.65rem;
    color: color-mix(in oklab, var(--foreground) 92%, transparent);
    font-size: var(--text-sm);
  }

  .file-ops {
    display: grid;
    gap: 0.45rem;
    border-top: 1px solid var(--border);
    padding-top: 0.6rem;
  }

  .file-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.55rem;
    align-items: start;
  }

  .file-row-label {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-weight: 650;
    text-transform: uppercase;
  }

  .file-paths {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .file-path {
    max-width: 18rem;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--background);
    color: var(--foreground);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 0.16rem 0.42rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-path:hover {
    background: var(--muted);
  }

  @keyframes compaction-progress {
    0%,
    100% {
      opacity: 0.58;
    }
    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .compaction-progress :global([data-slot="progress-indicator"]) {
      animation: none;
    }
  }
</style>
