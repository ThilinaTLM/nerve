<script lang="ts">
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { Snippet } from "svelte";
import NerveBadge from "../brand/NerveBadge.svelte";
import type { ConversationStarter } from "./conversation-starters";

let {
  title,
  message,
  variant = "conversation",
  projectLabel,
  projectPath,
  starters = [],
  startersDisabled = false,
  onSelectStarter,
  footer,
}: {
  title: string;
  message: string;
  variant?: "launchpad" | "conversation";
  projectLabel?: string;
  projectPath?: string;
  starters?: readonly ConversationStarter[];
  startersDisabled?: boolean;
  onSelectStarter?: (starter: ConversationStarter) => void;
  footer?: Snippet;
} = $props();

const launchpad = $derived(variant === "launchpad");
</script>

<div
  class="@container relative flex h-full min-h-full items-center justify-center overflow-hidden p-6 text-center"
>
  <div class="signal-field absolute inset-0" aria-hidden="true"></div>
  <div
    class={`relative flex w-full flex-col items-center ${launchpad ? "max-w-3xl" : "max-w-2xl"}`}
  >
    <div
      class={`relative flex items-center justify-center ${launchpad ? "size-20" : "size-14"}`}
    >
      <div
        class={`absolute rotate-6 rounded-lg border bg-muted ${launchpad ? "size-16" : "size-12"}`}
        aria-hidden="true"
      ></div>
      <div
        class={`absolute -rotate-6 rounded-lg border border-border-subtle bg-background ${launchpad ? "size-14" : "size-10"}`}
        aria-hidden="true"
      ></div>
      <NerveBadge
        class={launchpad ? "relative z-10 size-12" : "relative z-10 size-9"}
      />
    </div>

    <h2 class="mt-4 text-title text-foreground">
      {title}
    </h2>
    <p class="mt-2 max-w-sm text-ui leading-relaxed text-muted-foreground">
      {message}
    </p>
    {#if projectLabel}
      <p
        class="mt-3 max-w-md truncate text-caption font-medium text-foreground"
        title={projectPath}
      >
        <span class="sr-only">Current project</span>
        {projectLabel}
      </p>
    {/if}
    {#if starters.length > 0}
      <div
        class="mt-6 flex flex-wrap justify-center gap-2"
        role="group"
        aria-label="Conversation starters"
      >
        {#each starters as starter (starter.id)}
          {@const Icon = starter.icon}
          <Button
            type="button"
            variant="outline"
            class="group gap-2 bg-card text-ui shadow-sm hover:border-primary-strong"
            disabled={startersDisabled}
            onclick={() => onSelectStarter?.(starter)}
          >
            <Icon
              class="size-4 text-primary"
              strokeWidth={2.2}
              aria-hidden="true"
            />
            <span>{starter.label}</span>
          </Button>
        {/each}
      </div>
    {/if}

    {#if footer}
      <div class={`${launchpad ? "mt-6" : "mt-5"} flex flex-col items-center`}>
        {@render footer()}
      </div>
    {/if}
  </div>
</div>

<style>
/* Static dot field behind the empty state, fading out from the centre. Idle
   views must not animate. */
.signal-field {
  background-image: radial-gradient(var(--border) 1px, transparent 1.5px);
  background-position: center;
  background-size: 1.375rem 1.375rem;
  mask-image: radial-gradient(circle at center, black, transparent 60%);
}
</style>
