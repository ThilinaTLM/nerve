<script lang="ts">
import Folder from "@lucide/svelte/icons/folder";
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
  class="relative flex h-full min-h-full items-center justify-center overflow-hidden p-6 text-center"
>
  {#if launchpad}
    <div
      class="pointer-events-none absolute inset-x-8 top-1/2 h-px max-w-5xl -translate-y-32 bg-gradient-to-r from-transparent via-border to-transparent"
      aria-hidden="true"
    ></div>
    <div
      class="pointer-events-none absolute left-1/2 top-1/2 size-80 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-border/60"
      aria-hidden="true"
    ></div>
  {/if}

  <div
    class={`brand-signal-enter relative flex w-full flex-col items-center ${launchpad ? "max-w-3xl" : "max-w-2xl"}`}
  >
    <div
      class={`relative flex items-center justify-center ${launchpad ? "size-20" : "size-14"}`}
    >
      <div
        class={`absolute rotate-6 rounded-2xl border bg-muted/50 ${launchpad ? "size-16" : "size-12"}`}
        aria-hidden="true"
      ></div>
      <div
        class={`absolute -rotate-6 rounded-2xl border border-border/70 bg-background ${launchpad ? "size-14" : "size-10"}`}
        aria-hidden="true"
      ></div>
      <NerveBadge
        class={launchpad ? "relative z-10 size-12" : "relative z-10 size-9"}
      />
    </div>

    {#if launchpad}
      <p
        class="mt-4 text-xs font-medium uppercase tracking-widest text-muted-foreground"
      >
        Workspace ready
      </p>
    {/if}
    <h2
      class={`${launchpad ? "mt-2 text-2xl" : "mt-4 text-xl"} font-semibold tracking-tight text-foreground`}
    >
      {title}
    </h2>
    <p class="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
      {message}
    </p>

    {#if starters.length > 0}
      <div
        class="mt-6 flex flex-wrap justify-center gap-2"
        role="group"
        aria-label="Conversation starters"
      >
        {#each starters as starter (starter.id)}
          {@const Icon = starter.icon}
          <button
            type="button"
            class="group inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-card px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50"
            disabled={startersDisabled}
            onclick={() => onSelectStarter?.(starter)}
          >
            <Icon
              class="size-4 text-primary"
              strokeWidth={2.2}
              aria-hidden="true"
            />
            <span>{starter.label}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if projectLabel}
      <div
        class={`${starters.length > 0 || launchpad ? "mt-4" : "mt-3"} inline-flex max-w-md items-center gap-1.5 rounded-full border bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground`}
        title={projectPath}
        aria-label={projectPath
          ? `Current project ${projectPath}`
          : `Current project ${projectLabel}`}
      >
        <Folder
          class="size-3.5 shrink-0"
          strokeWidth={2.2}
          aria-hidden="true"
        />
        <span class="truncate font-mono text-foreground">{projectLabel}</span>
      </div>
    {/if}

    {#if footer}
      <div class={`${launchpad ? "mt-6" : "mt-5"} flex flex-col items-center`}>
        {@render footer()}
      </div>
    {/if}
  </div>
</div>
