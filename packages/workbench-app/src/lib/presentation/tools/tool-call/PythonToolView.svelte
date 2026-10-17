<script lang="ts">
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import type { ToolView } from "../views/tool-result-view";
import ToolOutputBlock from "./ToolOutputBlock.svelte";
import ToolSections from "./ToolSections.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "python" }>;
  expanded?: boolean;
};
let { toolCall, view, expanded = false }: Props = $props();

// The inline script is its own `Script` section (the argument body in the
// card, rendered here when expanded), so the output is captioned.
const hasScriptSection = $derived(
  view.inputMode !== "file" &&
    Boolean(view.code) &&
    (/[\r\n]/.test(view.code ?? "") || (view.code?.length ?? 0) > 500),
);
const showScript = $derived(
  expanded && hasScriptSection && /[\r\n]/.test(view.code ?? ""),
);
</script>

{#if showScript || view.output.length > 0 || toolCall.status === "completed"}
  <ToolSections>
    {#if showScript}
      <div class="px-2.5 py-2" aria-label="Python script">
        <p class="m-0 mb-1 text-xs font-medium text-muted-foreground">Script</p>
        <ToolOutputBlock text={view.code ?? ""} language="python" {expanded} />
      </div>
    {/if}

    {#if view.output.length > 0}
      <div class="px-2.5 py-2" aria-label="Python output">
        {#if hasScriptSection}
          <p class="m-0 mb-1 text-xs font-medium text-muted-foreground">
            Output
          </p>
        {/if}
        <ToolOutputBlock
          text={view.output}
          direction="tail"
          {expanded}
          live={toolCall.status === "running"}
          terminal
        />
      </div>
    {:else if toolCall.status === "completed"}
      <div
        class="px-2.5 py-2 text-xs text-muted-foreground"
        aria-label="Python output"
      >
        No output.
      </div>
    {/if}
  </ToolSections>
{/if}
