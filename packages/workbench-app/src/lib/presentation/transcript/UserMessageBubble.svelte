<script lang="ts">
import type { Snippet } from "svelte";
import type { CommandPreparation } from "@nervekit/contracts/core";
import UserMessageContent from "./UserMessageContent.svelte";

type Props = {
  text: string;
  queued?: boolean;
  pending?: boolean;
  commandPreparation?: CommandPreparation;
  actions?: Snippet;
  showActions?: boolean;
  children?: Snippet;
};

let {
  text,
  queued = false,
  pending = false,
  commandPreparation,
  actions,
  showActions = queued,
  children,
}: Props = $props();
</script>

<article
  class="group/user-bubble relative ml-auto w-fit min-w-0 max-w-[70%] rounded-lg rounded-br-sm px-3 py-2 text-body text-foreground @max-[40rem]:max-w-[88%]"
  aria-label={queued ? "Queued user prompt" : "User message"}
  data-queued={queued}
>
  <!-- Both skins stay mounted: changing state only crossfades opacity, never
       border width, padding, content, or the bubble's measured geometry. -->
  <div
    class="delivered-skin pointer-events-none absolute inset-0 rounded-[inherit] border transition-opacity duration-[180ms] motion-reduce:transition-none"
    class:opacity-0={queued}
    aria-hidden="true"
  ></div>
  <div
    class="queued-skin pointer-events-none absolute inset-0 rounded-[inherit] border border-dashed bg-panel transition-opacity duration-[180ms] motion-reduce:transition-none"
    class:opacity-0={!queued}
    aria-hidden="true"
  ></div>
  <div class="relative min-w-0 overflow-hidden">
    {#if text}
      <UserMessageContent {text} {pending} {commandPreparation} />
    {/if}
    {@render children?.()}
  </div>
  {#if actions}
    <div
      class={[
        "pointer-events-none absolute top-0 right-2 z-10 flex -translate-y-1/2 gap-0.5 rounded-md border bg-popover p-0.5 text-popover-foreground opacity-0 shadow-sm transition-opacity duration-[180ms] motion-reduce:transition-none",
        showActions &&
          "group-hover/user-bubble:pointer-events-auto group-hover/user-bubble:opacity-100 group-focus-within/user-bubble:pointer-events-auto group-focus-within/user-bubble:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
      ]}
      inert={!showActions}
      aria-hidden={!showActions}
      role="group"
      aria-label="Queued prompt actions"
    >
      {@render actions()}
    </div>
  {/if}
</article>

<style>
.delivered-skin {
  border-color: var(--border);
  background: var(--selected);
}

.queued-skin {
  border-color: var(--border);
}
</style>
