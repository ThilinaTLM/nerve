<script lang="ts">
  import { type StatusTone } from "@nervekit/workbench-ui/components/ui/status-dot";
  import type { CompactionNotice } from "../../state/transcript-types";
  import { formatTokens } from "@nervekit/workbench-ui/core/utils/usage";
  import CardShell from "../../tools/components/tool-call/CardShell.svelte";
  import type { MetaItem } from "../../tools/views/tool-presentation";

  type Props = {
    notice: CompactionNotice;
  };

  let { notice }: Props = $props();

  function recordValue(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  }

  const details = $derived(recordValue(notice.details));
  const compactedMessages = $derived(
    typeof details?.compactedMessages === "number"
      ? details.compactedMessages
      : undefined,
  );

  const reasonLabel = $derived.by(() => {
    if (notice.reason === "threshold") return "auto compact";
    if (notice.reason === "overflow") return "overflow recovery";
    return "manual";
  });

  const dotTone = $derived.by<StatusTone>(() => {
    if (notice.state === "failed") return "danger";
    if (notice.state === "running") return "running";
    return "good";
  });

  const contextPercent = $derived.by(() => {
    const used = notice.contextTokens ?? notice.tokensBefore;
    if (!used || !notice.contextWindow) return undefined;
    return Math.round((used / notice.contextWindow) * 100);
  });

  /** First meaningful lines of the summary, stripped of markdown scaffolding. */
  const summaryLead = $derived.by(() => {
    const text = (notice.summary ?? notice.text ?? "").trim();
    if (!text) return "";
    const meaningful: string[] = [];
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("---")) continue;
      if (/^generated locally/i.test(line)) continue;
      if (/^treat this as a context checkpoint/i.test(line)) continue;
      const cleaned = line
        .replace(/^[-*]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/^\[[ xX]\]\s+/, "")
        .replace(/\*\*/g, "")
        .trim();
      if (!cleaned) continue;
      meaningful.push(cleaned);
      if (meaningful.length >= 2) break;
    }
    const lead = meaningful.join(" ");
    return lead.length > 180 ? `${lead.slice(0, 180).trim()}…` : lead;
  });

  const chips = $derived.by<MetaItem[]>(() => {
    const items: MetaItem[] = [];
    if (typeof notice.tokensBefore === "number") {
      items.push({ text: `${formatTokens(notice.tokensBefore)} before` });
    }
    if (typeof notice.tokensAfter === "number") {
      items.push({ text: `≈${formatTokens(notice.tokensAfter)} after` });
    }
    if (typeof notice.freedTokens === "number" && notice.freedTokens > 0) {
      items.push({ text: `${formatTokens(notice.freedTokens)} freed`, tone: "success" });
    }
    if (typeof compactedMessages === "number") {
      items.push({ text: `${compactedMessages} messages` });
    }
    if (typeof contextPercent === "number") {
      items.push({ text: `${contextPercent}% context` });
    }
    return items;
  });

  const errorMessage = $derived(
    notice.errorMessage?.trim() || "Could not compact this conversation.",
  );
</script>

<div class="compaction-block">
  <CardShell
    status={notice.state === "completed" ? undefined : notice.state}
    dotTone={dotTone}
    dotPulse={notice.state === "running"}
    badge="compact"
    arg={{ text: reasonLabel }}
    error={notice.state === "failed" ? errorMessage : undefined}
    meta={notice.state === "completed" ? chips : []}
  >
    {#if notice.state === "running"}
      <p class="lead">Summarizing recent work…</p>
    {:else if notice.state === "completed" && summaryLead}
      <p class="lead">{summaryLead}</p>
    {/if}
  </CardShell>
</div>

<style>
  /* Set the compaction block apart with the same rhythm as message turns. */
  .compaction-block {
    margin-block: 0.5rem;
  }

  .lead {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
    line-height: 1.5;
  }
</style>
