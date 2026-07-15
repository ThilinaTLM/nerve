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
const isExecutionDraft = $derived(
  summary.kind === "bash" || summary.kind === "python",
);
const atlassianDraftSummary = $derived.by(() => {
  if (isJiraToolName(draft.toolName)) return jiraDraftSummaryBody(draft);
  if (isConfluenceToolName(draft.toolName))
    return confluenceDraftSummaryBody(draft);
  return undefined;
});
</script>

{#if summary.kind === "write" || summary.kind === "edit"}
  {#if summary.preview}
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
  {:else if summary.argsPreview}
    <ResultCodeBlock
      code={summary.argsPreview}
      language={summary.argsPreviewLanguage}
      trim={false}
      highlight={false}
      wrap
      overflow="hidden"
      tail
      fixedRows={DRAFT_PREVIEW_LINES}
    />
  {/if}
{:else if isExecutionDraft}
  {#if summary.inputPreview}
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
  {:else if summary.argsPreview}
    <ResultCodeBlock
      code={summary.argsPreview}
      language={summary.argsPreviewLanguage}
      trim={false}
      highlight={false}
      wrap
      overflow="hidden"
      tail
      fixedRows={DRAFT_PREVIEW_LINES}
    />
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
{:else if summary.argsPreview}
  <ResultCodeBlock
    code={summary.argsPreview}
    language={summary.argsPreviewLanguage}
    trim={false}
    highlight={false}
    wrap
    overflow="hidden"
    tail
    fixedRows={DRAFT_PREVIEW_LINES}
  />
{/if}
