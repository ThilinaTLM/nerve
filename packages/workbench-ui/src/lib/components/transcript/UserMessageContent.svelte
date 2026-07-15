<script lang="ts">
import PlainText from "@nervekit/ui-kit/core/components/PlainText.svelte";
import CommandBlockCard from "./CommandBlockCard.svelte";
import { segmentUserMessageText } from "./user-message-content.js";

type Props = {
  text: string;
  /** True while the row is optimistic and its command blocks are executing. */
  pending?: boolean;
};

let { text, pending = false }: Props = $props();

const segments = $derived(segmentUserMessageText(text));
const plainOnly = $derived(
  segments.length === 1 && segments[0].kind === "text",
);
</script>

{#if plainOnly}
  <PlainText {text} />
{:else}
  <div class="flex min-w-0 flex-col gap-2">
    {#each segments as segment, index (index)}
      {#if segment.kind === "text"}
        <PlainText text={segment.text} />
      {:else if segment.kind === "command_result"}
        <CommandBlockCard
          phase="done"
          command={segment.command}
          status={segment.status}
          exitCode={segment.exitCode}
          output={segment.output}
        />
      {:else}
        <CommandBlockCard
          phase={pending ? "running" : "static"}
          command={segment.command}
        />
      {/if}
    {/each}
  </div>
{/if}
