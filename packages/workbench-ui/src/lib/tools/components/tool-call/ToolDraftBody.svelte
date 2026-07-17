<script lang="ts">
import type { ConversationLiveToolDraftBlockSnapshot } from "@nervekit/contracts";
import {
  DRAFT_PREVIEW_LINES,
  summarizeToolDraft,
} from "../../views/tool-draft-progress";
import ResultCodeBlock from "./ResultCodeBlock.svelte";
import ToolArgumentBody from "./ToolArgumentBody.svelte";

type Props = {
  draft: ConversationLiveToolDraftBlockSnapshot;
  cwd?: string;
};

let { draft, cwd }: Props = $props();

const summary = $derived(summarizeToolDraft(draft, cwd));
</script>

{#if summary.argumentBody && summary.argumentBody.kind !== "none"}
  <ToolArgumentBody
    body={summary.argumentBody}
    fixedRows={DRAFT_PREVIEW_LINES}
    highlight={summary.done}
    streaming={!summary.done}
  />
{:else if summary.argsPreview}
  <!-- Raw structured previews are reserved for removed/custom historical tools. -->
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
