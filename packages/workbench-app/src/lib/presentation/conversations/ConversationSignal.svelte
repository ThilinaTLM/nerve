<script lang="ts">
import FolderIcon from "@lucide/svelte/icons/folder";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import type { Snippet } from "svelte";
import NerveBadge from "../brand/NerveBadge.svelte";
import ProfileStarterArt from "./ProfileStarterArt.svelte";
import type { ConversationStarter } from "./conversation-starters";

let {
  title,
  message,
  variant = "conversation",
  projectLabel,
  projectPath,
  starters = [],
  defaultStarter,
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
  /** Profile of the starter marked Default. */
  defaultStarter?: string;
  startersDisabled?: boolean;
  onSelectStarter?: (starter: ConversationStarter) => void;
  footer?: Snippet;
} = $props();

const launchpad = $derived(variant === "launchpad");
</script>

<div
  class="@container relative flex h-full min-h-full flex-col items-center overflow-x-hidden overflow-y-auto p-6 text-center"
>
  <div class="signal-field absolute inset-0" aria-hidden="true"></div>
  <!-- my-auto centres the content and collapses to 0 when it overflows, so
       nothing is clipped above the scroll origin. -->
  <div class="relative my-auto flex w-full max-w-2xl flex-col items-center">
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
    {#if starters.length > 0}
      <div
        class="mt-6 grid w-full grid-cols-1 gap-3 @xl:grid-cols-2"
        role="group"
        aria-label="Start a conversation"
      >
        {#each starters as starter (starter.profile)}
          <button
            type="button"
            class="flex min-h-24 cursor-pointer overflow-hidden rounded-lg border bg-card text-left shadow-sm transition-colors outline-none hover:border-primary-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50"
            disabled={startersDisabled}
            onclick={() => onSelectStarter?.(starter)}
          >
            <span
              class="starter-art block w-28 shrink-0 border-r border-border-subtle bg-well"
            >
              <ProfileStarterArt profile={starter.profile} class="size-full" />
            </span>
            <span class="flex min-w-0 flex-1 flex-col justify-center gap-1 p-3">
              <span class="flex items-center gap-2">
                <span class="text-ui font-medium text-foreground"
                  >{starter.label}</span
                >
                {#if starter.profile === defaultStarter}
                  <Badge variant="brand">Default</Badge>
                {/if}
              </span>
              <span class="text-caption text-muted-foreground"
                >{starter.tagline}</span
              >
            </span>
          </button>
        {/each}
      </div>
    {/if}

    {#if footer}
      <div class={`${launchpad ? "mt-6" : "mt-5"} flex flex-col items-center`}>
        {@render footer()}
      </div>
    {/if}
  </div>
  {#if projectLabel}
    <p
      class="relative mt-6 flex max-w-full shrink-0 items-center gap-1.5 text-caption text-muted-foreground"
      title={projectPath}
    >
      <FolderIcon class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="sr-only">Current project</span>
      <span class="truncate">{projectLabel}</span>
    </p>
  {/if}
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
/* Fine dot grid behind each starter card's art. */
.starter-art {
  background-image: radial-gradient(
    var(--border-subtle) 1px,
    transparent 1.5px
  );
  background-size: 0.75rem 0.75rem;
}
</style>
