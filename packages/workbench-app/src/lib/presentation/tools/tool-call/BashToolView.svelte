<script lang="ts">
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import type { ToolView } from "../views/tool-result-view";
import ToolOutputBlock from "./ToolOutputBlock.svelte";
import ToolSections from "./ToolSections.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "bash" }>;
  expanded?: boolean;
};
let { toolCall, view, expanded = false }: Props = $props();

// A single-line command lives in the card header; a longer one is its own
// `Command` section (the argument body in the card, rendered here when
// expanded), so the output is captioned to tell the two apart.
const hasCommandSection = $derived(
  Boolean(view.command) &&
    (/[\r\n]/.test(view.command ?? "") || (view.command?.length ?? 0) > 500),
);
const showCommand = $derived(
  expanded && Boolean(view.command) && /[\r\n]/.test(view.command ?? ""),
);
</script>

{#if showCommand || view.output.length > 0 || toolCall.status === "completed"}
  <ToolSections>
    {#if showCommand}
      <div class="px-2.5 py-2" aria-label="Bash command">
        <p class="m-0 mb-1 text-ui text-muted-foreground">Command</p>
        <ToolOutputBlock text={view.command ?? ""} language="bash" {expanded} />
      </div>
    {/if}

    {#if view.output.length > 0}
      <div class="px-2.5 py-2" aria-label="Command output">
        {#if hasCommandSection}
          <p class="m-0 mb-1 text-ui text-muted-foreground">Output</p>
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
      <div class="px-2.5 py-2 text-ui text-muted-foreground">No output.</div>
    {/if}
  </ToolSections>
{/if}
