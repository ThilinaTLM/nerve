<script lang="ts">
import type { CommandPreparation } from "@nervekit/contracts/core";
import PlainText from "@nervekit/ui-kit/renderers/plain-text/PlainText.svelte";
import CommandBlockCard from "./CommandBlockCard.svelte";
import {
  segmentUserMessageText,
  userCommandPresentation,
} from "./user-message-content.js";

type Props = {
  text: string;
  /** True while the row is optimistic and its command blocks are executing. */
  pending?: boolean;
  /** Per-command lifecycle; takes precedence over the optimistic fallback. */
  commandPreparation?: CommandPreparation;
};

let { text, pending = false, commandPreparation }: Props = $props();

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
      {:else}
        {@const commandIndex = segments
          .slice(0, index)
          .filter((segment) => segment.kind !== "text").length}
        <CommandBlockCard
          {...userCommandPresentation(
            segment,
            commandIndex,
            pending,
            commandPreparation,
          )}
        />
      {/if}
    {/each}
  </div>
{/if}
