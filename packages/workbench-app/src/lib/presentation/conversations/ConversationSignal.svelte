<script lang="ts">
import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
import FolderIcon from "@lucide/svelte/icons/folder";
import ShieldCheckIcon from "@lucide/svelte/icons/shield-check";
import StarIcon from "@lucide/svelte/icons/star";
import NerveBadge from "../brand/NerveBadge.svelte";
import ProjectIcon from "../brand/ProjectIcon.svelte";
import type { ConversationStarter } from "./conversation-starters";
import type { ProjectReviewReminder } from "./conversation-view-contracts.js";

let {
  title,
  message,
  variant = "conversation",
  projectLabel,
  projectPath,
  projectId,
  starters = [],
  defaultStarter,
  startersDisabled = false,
  onSelectStarter,
  review,
}: {
  title: string;
  message: string;
  variant?: "launchpad" | "conversation";
  /** Makes the project the hero; without it the Nerve badge is. */
  projectLabel?: string;
  /** Shown as a tooltip on the project name. */
  projectPath?: string;
  /** Shows the project icon instead of a folder glyph. */
  projectId?: string;
  starters?: readonly ConversationStarter[];
  /** Profile of the starter marked as the default. */
  defaultStarter?: string;
  startersDisabled?: boolean;
  onSelectStarter?: (starter: ConversationStarter) => void;
  review?: ProjectReviewReminder;
} = $props();

const id = $props.id();
const launchpad = $derived(variant === "launchpad");
let pointed = $state<ConversationStarter | undefined>();
// The tagline under the starters follows hover and focus, resting on the
// default starter's.
const tagline = $derived(
  (pointed ?? starters.find((starter) => starter.profile === defaultStarter))
    ?.tagline,
);
</script>

<div
  class="@container relative flex h-full min-h-full flex-col items-center overflow-x-hidden overflow-y-auto p-6 text-center"
>
  <div class="signal-field absolute inset-0" aria-hidden="true"></div>
  <!-- my-auto centres the content and collapses to 0 when it overflows, so
       nothing is clipped above the scroll origin. -->
  <div class="relative my-auto flex w-full max-w-2xl flex-col items-center">
    {#if projectLabel}
      <div class="relative" aria-hidden="true">
        {#if projectId}
          <ProjectIcon
            {projectId}
            name={projectLabel}
            class={`rounded-xl shadow-sm ${launchpad ? "size-16" : "size-14"}`}
          />
        {:else}
          <span
            class={`grid place-items-center rounded-xl border border-border-subtle bg-muted text-muted-foreground shadow-sm ${launchpad ? "size-16" : "size-14"}`}
          >
            <FolderIcon class="size-1/2" />
          </span>
        {/if}
        <NerveBadge
          class="absolute -right-1.5 -bottom-1.5 size-6 rounded-md ring-2 ring-background"
        />
      </div>
      <h2
        class="mt-4 max-w-full truncate text-title font-semibold text-foreground"
        title={projectPath}
      >
        <span class="sr-only">Current project</span>
        {projectLabel}
      </h2>
      <p class="mt-5 text-body text-foreground">{title}</p>
      <p class="mt-1 max-w-sm text-ui leading-relaxed text-muted-foreground">
        {message}
      </p>
    {:else}
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
      <h2 class="mt-4 text-title text-foreground">{title}</h2>
      <p class="mt-2 max-w-sm text-ui leading-relaxed text-muted-foreground">
        {message}
      </p>
    {/if}

    {#if starters.length > 0}
      <div
        class="mt-5 grid grid-cols-2 gap-2 @min-[32rem]:grid-cols-4"
        role="group"
        aria-label="Start a conversation"
      >
        {#each starters as starter (starter.profile)}
          {@const Icon = starter.icon}
          <button
            type="button"
            class="flex h-9 cursor-pointer items-center gap-2 rounded-lg border bg-card pr-3 pl-1.5 text-ui font-medium text-foreground shadow-sm transition-colors outline-none hover:border-primary-strong hover:bg-hover focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50"
            disabled={startersDisabled}
            aria-describedby={`${id}-${starter.profile}`}
            onclick={() => onSelectStarter?.(starter)}
            onpointerenter={() => (pointed = starter)}
            onpointerleave={() => (pointed = undefined)}
            onfocus={() => (pointed = starter)}
            onblur={() => (pointed = undefined)}
          >
            <span
              class="grid size-6 place-items-center rounded-md bg-well"
              aria-hidden="true"
            >
              <Icon class="size-3.5 text-primary" />
            </span>
            {starter.label}
            <!-- Every button reserves the star, so the default arriving after
                 settings load does not widen the grid. -->
            <StarIcon
              class={`size-3 fill-current text-primary ${starter.profile === defaultStarter ? "" : "invisible"}`}
              aria-hidden="true"
            />
            {#if starter.profile === defaultStarter}
              <span class="sr-only">(default)</span>
            {/if}
          </button>
        {/each}
      </div>
      <!-- Outside the buttons so taglines describe them without joining their names. -->
      <div class="sr-only">
        {#each starters as starter (starter.profile)}
          <span id={`${id}-${starter.profile}`}>{starter.tagline}</span>
        {/each}
      </div>
      <p class="mt-3 text-caption text-muted-foreground" aria-hidden="true">
        <!-- A non-breaking space keeps one line's height before the default loads. -->
        {tagline ?? "\u00a0"}
      </p>
    {/if}

    {#if review}
      <!-- Hangs below the centred block, outside its flow: the reminder loads
           after startup and must not shift the content when it arrives. -->
      <div
        class="absolute inset-x-0 top-full flex justify-center pt-6 pb-6 animate-in fade-in-0 duration-300 motion-reduce:animate-none"
      >
        <button
          type="button"
          class="group flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-warning-strong bg-warning-subtle pr-2 pl-2.5 text-caption text-foreground transition-colors outline-none hover:bg-hover focus-visible:ring-3 focus-visible:ring-focus"
          onclick={review.onOpen}
        >
          <ShieldCheckIcon class="size-3.5 text-warning" aria-hidden="true" />
          {review.text}
          <span class="ml-1 flex items-center text-primary">
            Review
            <ChevronRightIcon
              class="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </span>
        </button>
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
