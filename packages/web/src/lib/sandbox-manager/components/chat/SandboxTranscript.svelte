<script lang="ts">
  import Markdown from "$lib/core/components/Markdown.svelte";
  import PlainText from "$lib/core/components/PlainText.svelte";
  import { cn } from "$lib/core/utils.js";
  import type { SandboxTimelineRow } from "../../state/sandbox-ui-types";
  import SandboxToolCallCard from "./SandboxToolCallCard.svelte";
  import SandboxWaitCard from "./SandboxWaitCard.svelte";

  let {
    rows,
    onsubmitInput,
    onresolveApproval,
  }: {
    rows: SandboxTimelineRow[];
    onsubmitInput: (waitId: string, text: string) => void;
    onresolveApproval: (waitId: string, decision: "grant" | "deny") => void;
  } = $props();
</script>

<div class="flex flex-col gap-3">
  {#each rows as row (row.key)}
    {#if row.kind === "message"}
      <div
        class={cn(
          "flex flex-col gap-1",
          row.role === "user" && "items-end",
        )}
      >
        <span class="text-xs text-muted-foreground capitalize">{row.role}</span>
        <div
          class={cn(
            "max-w-[85%] rounded-lg px-3 py-2 text-sm",
            row.role === "user"
              ? "bg-primary text-primary-foreground"
              : "bg-muted",
          )}
        >
          {#if row.role === "user"}
            <PlainText text={row.text} />
          {:else}
            <Markdown text={row.text} streaming={row.streaming} />
          {/if}
        </div>
      </div>
    {:else if row.kind === "tool"}
      <SandboxToolCallCard toolCall={row.toolCall} />
    {:else if row.kind === "wait"}
      <SandboxWaitCard wait={row.wait} {onsubmitInput} {onresolveApproval} />
    {/if}
  {/each}
</div>
