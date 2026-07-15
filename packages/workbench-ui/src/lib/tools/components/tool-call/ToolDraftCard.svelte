<script lang="ts">
import type { ConversationLiveToolDraftBlockSnapshot } from "@nervekit/contracts";
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
import CardShell from "./CardShell.svelte";
import ResultCodeBlock from "./ResultCodeBlock.svelte";

type Props = {
  draft: ConversationLiveToolDraftBlockSnapshot;
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
</script>

<CardShell
  draftPhase={summary.done ? "prepared" : "drafting"}
  dotTone={summary.done ? "good" : "running"}
  dotPulse={!summary.done}
  badge={summary.toolName}
  arg={headerArg
    ? { text: headerArg }
    : summary.kind === "generic"
      ? { text: "Preparing arguments…" }
      : undefined}
  meta={summary.meta}
>
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
      <div class="draft-progress">
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
      <div class="draft-progress">
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
    <div class="draft-progress">
      <span>Waiting for arguments…</span>
      {#if !summary.done}<span class="progress-caret" aria-hidden="true"
        ></span>{/if}
    </div>
  {/if}
</CardShell>

<style>
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

.progress-caret {
  width: 0.38rem;
  height: 0.9rem;
  background: var(--primary);
  animation: pulse 1s steps(2, start) infinite;
}
</style>
