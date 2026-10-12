<script lang="ts">
import Ban from "@lucide/svelte/icons/ban";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleDashed from "@lucide/svelte/icons/circle-dashed";
import CircleHelp from "@lucide/svelte/icons/circle-help";
import CircleX from "@lucide/svelte/icons/circle-x";
import Clock from "@lucide/svelte/icons/clock";
import type { AsyncBash } from "@nervekit/contracts/core";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { COMMAND_STATE_LABEL } from "../agents/activity-island";

let {
  status,
  animate = true,
}: {
  status: AsyncBash["status"];
  /** Running commands spin only while their surface is live. */
  animate?: boolean;
} = $props();
</script>

<span
  class="flex size-4 shrink-0 items-center justify-center"
  title={COMMAND_STATE_LABEL[status]}
  class:text-info={status === "running"}
  class:text-success={status === "completed"}
  class:text-destructive={status === "failed"}
  class:text-warning={status === "timed_out" || status === "lost"}
  class:text-muted-foreground={status === "cancelled"}
>
  <span class="sr-only">{COMMAND_STATE_LABEL[status]}</span>
  {#if status === "running"}
    {#if animate}<Spinner
        class="size-3.5 motion-reduce:animate-none!"
        role="presentation"
        aria-hidden="true"
      />{:else}<CircleDashed class="size-3.5" aria-hidden="true" />{/if}
  {:else if status === "completed"}<CircleCheck
      class="size-3.5"
      aria-hidden="true"
    />
  {:else if status === "failed"}<CircleX class="size-3.5" aria-hidden="true" />
  {:else if status === "timed_out"}<Clock class="size-3.5" aria-hidden="true" />
  {:else if status === "cancelled"}<Ban class="size-3.5" aria-hidden="true" />
  {:else}<CircleHelp class="size-3.5" aria-hidden="true" />{/if}
</span>
