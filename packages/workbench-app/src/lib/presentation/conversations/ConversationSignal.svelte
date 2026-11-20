<script lang="ts">
import FolderIcon from "@lucide/svelte/icons/folder";
import StarIcon from "@lucide/svelte/icons/star";
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
  /** Profile of the starter marked as the default. */
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
        class="mt-6 grid w-full max-w-md grid-cols-2 gap-3"
        role="group"
        aria-label="Start a conversation"
      >
        {#each starters as starter (starter.profile)}
          <button
            type="button"
            class="group flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-card bg-linear-to-b from-well to-card text-left shadow-sm transition-colors duration-300 outline-none hover:border-primary-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50"
            disabled={startersDisabled}
            onclick={() => onSelectStarter?.(starter)}
          >
            <!-- At rest the art is a soft glow behind the label; hover and focus
                 lift the label away and bring the illustration into focus. -->
            <span
              class="starter-art relative flex h-16 shrink-0 items-center justify-center"
            >
              <ProfileStarterArt
                profile={starter.profile}
                class="absolute inset-0 size-full scale-125 opacity-70 blur-sm transition duration-300 ease-out group-hover:scale-100 group-hover:opacity-100 group-hover:blur-none group-focus-visible:scale-100 group-focus-visible:opacity-100 group-focus-visible:blur-none motion-reduce:transition-none"
              />
              <span
                class="relative text-ui font-medium text-foreground transition duration-300 ease-out group-hover:-translate-y-3 group-hover:opacity-0 group-focus-visible:-translate-y-3 group-focus-visible:opacity-0 motion-reduce:transition-none"
                >{starter.label}</span
              >
              {#if starter.profile === defaultStarter}
                <span class="absolute top-2 right-2" title="Default">
                  <StarIcon
                    class="size-3.5 fill-current text-primary"
                    aria-hidden="true"
                  />
                  <span class="sr-only">Default</span>
                </span>
              {/if}
            </span>
            <span
              class="relative flex-1 px-3 pt-1 pb-3 text-caption text-muted-foreground transition-colors duration-300 group-hover:text-foreground"
              >{starter.tagline}</span
            >
          </button>
        {/each}
      </div>
    {/if}

    {#if projectLabel}
      <p
        class={`${starters.length > 0 ? "mt-4" : "mt-5"} flex max-w-full shrink-0 items-center gap-1.5 text-caption text-muted-foreground`}
        title={projectPath}
      >
        <FolderIcon class="size-3.5 shrink-0" aria-hidden="true" />
        <span class="sr-only">Current project</span>
        <span class="truncate">{projectLabel}</span>
      </p>
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
/* Fine dot grid behind each starter card's art, fading toward the edges. */
.starter-art::before {
  position: absolute;
  inset: 0;
  content: "";
  background-image: radial-gradient(
    var(--border-subtle) 1px,
    transparent 1.5px
  );
  background-size: 0.75rem 0.75rem;
  mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%);
}
</style>
