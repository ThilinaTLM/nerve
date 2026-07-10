<script lang="ts">
import type { LiveToolCallDraft } from "../../../state/transcript-types";
import {
  DRAFT_PREVIEW_LINES,
  summarizeToolDraft,
} from "../../views/tool-draft-progress";
import { extname } from "../../views/lang";
import {
  confluenceDraftSummaryBody,
  isConfluenceToolName,
  isJiraToolName,
  jiraDraftSummaryBody,
} from "../../views/atlassian-tool-summary";
import ResultCodeBlock from "./ResultCodeBlock.svelte";
import ToolStatusIcon from "./ToolStatusIcon.svelte";

type Props = {
  draft: LiveToolCallDraft;
  cwd?: string;
};

let { draft, cwd }: Props = $props();

const summary = $derived(summarizeToolDraft(draft, cwd));
const draftPreviewLanguage = $derived(
  summary.previewLanguage ?? extname(summary.path),
);
const draftArgsPreview = $derived(summary.argsPreview);
const draftArgsLanguage = $derived(summary.argsPreviewLanguage);
const isExecutionDraft = $derived(
  summary.kind === "bash" || summary.kind === "python",
);
const atlassianDraftSummary = $derived.by(() => {
  if (isJiraToolName(draft.toolName)) return jiraDraftSummaryBody(draft);
  if (isConfluenceToolName(draft.toolName))
    return confluenceDraftSummaryBody(draft);
  return undefined;
});
const headerArg = $derived.by(() => {
  if (summary.path) return summary.path;
  if (isExecutionDraft) {
    return (
      summary.inlineInput ??
      (summary.inputMode === "inline" ? "inline" : undefined)
    );
  }
  if (summary.kind === "generic") return summary.path;
  return undefined;
});
// Transient settle only on a real drafting -> done change. Initialize the
// tracker to the current value so a draft that mounts already done does not
// fire a spurious settle.
let settling = $state(false);
let previousDone: boolean | undefined;
$effect(() => {
  const done = summary.done;
  if (previousDone === undefined) {
    previousDone = done;
    return;
  }
  if (!previousDone && done) settling = true;
  previousDone = done;
});
</script>

<article
  class={`tool-draft-card draft-${summary.kind}`}
  class:state-settling={settling}
  data-state={summary.done ? "complete" : "drafting"}
  onanimationend={(event) => {
    if (event.target === event.currentTarget) settling = false;
  }}
>
  <div class="tool-header">
    <ToolStatusIcon
      tone={summary.done ? "good" : "running"}
      pulse={!summary.done}
      size={14}
      class="mr-1.5 align-middle"
    />
    <span class="badge">{summary.toolName}</span>
    {#if headerArg}
      <span class="arg" title={headerArg}>{headerArg}</span>
    {:else if summary.kind === "generic"}
      <span class="arg">Preparing arguments…</span>
    {/if}
  </div>

  {#if summary.kind === "write" || summary.kind === "edit"}
    {#if summary.preview !== undefined && summary.preview.length > 0}
      <ResultCodeBlock
        code={summary.preview}
        language={draftPreviewLanguage}
        trim={false}
        highlight={false}
        wrap
        overflow="hidden"
        tail
        fixedRows={DRAFT_PREVIEW_LINES}
      />
    {:else if draftArgsPreview}
      <ResultCodeBlock
        code={draftArgsPreview}
        language={draftArgsLanguage}
        trim={false}
        highlight={false}
        wrap
        overflow="hidden"
        tail
        fixedRows={DRAFT_PREVIEW_LINES}
      />
    {:else}
      <div class="draft-progress" aria-live="polite">
        <span>Waiting for generated lines…</span>
      </div>
    {/if}
  {:else if isExecutionDraft}
    {#if summary.inputPreview !== undefined && summary.inputPreview.length > 0}
      <ResultCodeBlock
        code={summary.inputPreview}
        language={summary.language}
        trim={false}
        highlight={false}
        wrap
        overflow="hidden"
        tail
        fixedRows={DRAFT_PREVIEW_LINES}
      />
    {:else if !summary.inlineInput}
      <div class="draft-progress" aria-live="polite">
        <span>{summary.statusText}</span>
        {#if !summary.done}<span class="progress-caret" aria-hidden="true"
          ></span>{/if}
      </div>
      {#if draftArgsPreview}
        <ResultCodeBlock
          code={draftArgsPreview}
          language={draftArgsLanguage}
          trim={false}
          highlight={false}
          wrap
          overflow="hidden"
          tail
          fixedRows={DRAFT_PREVIEW_LINES}
        />
      {/if}
    {/if}
  {:else if atlassianDraftSummary}
    <ResultCodeBlock
      code={atlassianDraftSummary}
      trim={false}
      highlight={false}
      wrap
      overflow="hidden"
      fixedRows={DRAFT_PREVIEW_LINES}
    />
  {:else if draftArgsPreview}
    <ResultCodeBlock
      code={draftArgsPreview}
      language={draftArgsLanguage}
      trim={false}
      highlight={false}
      wrap
      overflow="hidden"
      tail
      fixedRows={DRAFT_PREVIEW_LINES}
    />
  {:else}
    <div class="draft-progress" aria-live="polite">
      <span>Waiting for arguments…</span>
      {#if !summary.done}<span class="progress-caret" aria-hidden="true"
        ></span>{/if}
    </div>
  {/if}

  {#if summary.meta.length > 0}
    <div class="chips">
      {#each summary.meta as item, i (i)}
        <span class={`chip tone-${item.tone ?? "default"}`}>{item.text}</span>
      {/each}
    </div>
  {/if}
</article>

<style>
.tool-draft-card {
  display: grid;
  gap: 0.4rem;
  width: 100%;
  padding: 0.6rem 0.75rem;
  background: color-mix(in oklab, var(--background) 94%, var(--sidebar));
}

/* Brief opacity/transform settle when the draft completes.
   * Neutralized by the global prefers-reduced-motion rule in base.css. */
.tool-draft-card.state-settling {
  animation: transcript-state-settle 180ms ease-out;
}

.tool-header {
  min-width: 0;
  line-height: 1.5;
}

.badge {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 650;
  color: var(--foreground);
}

.arg {
  margin-left: 0.5rem;
  color: var(--muted-foreground);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.draft-progress {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  border: 1px solid color-mix(in oklab, var(--border) 58%, transparent);
  border-radius: var(--radius-sm);
  background: var(--sidebar);
  color: var(--sidebar-foreground);
  padding: 0.5rem 0.58rem;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.4;
}

.progress-spinner {
  flex: none;
  width: 0.72rem;
  height: 0.72rem;
  border: 1px solid
    color-mix(in oklab, var(--muted-foreground) 32%, transparent);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.progress-caret {
  width: 0.38rem;
  height: 0.9rem;
  background: var(--primary);
  animation: pulse 1s steps(2, start) infinite;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
}

.chip {
  display: inline-flex;
  min-height: 1.25rem;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--sidebar);
  color: var(--muted-foreground);
  padding: 0.075rem 0.45rem;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

.chip.tone-success {
  color: var(--success);
  border-color: color-mix(in oklab, var(--success) 35%, var(--border));
}

.chip.tone-warning {
  color: var(--warning);
  border-color: color-mix(in oklab, var(--warning) 35%, var(--border));
}

.chip.tone-error {
  color: var(--destructive);
  border-color: color-mix(in oklab, var(--destructive) 35%, var(--border));
}

.chip.tone-info {
  color: var(--info);
  border-color: color-mix(in oklab, var(--info) 35%, var(--border));
}
</style>
