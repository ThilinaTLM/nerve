<script lang="ts">
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Folder from "@lucide/svelte/icons/folder";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import FolderX from "@lucide/svelte/icons/folder-x";
import HardDrive from "@lucide/svelte/icons/hard-drive";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { cn } from "@nervekit/ui-kit/utils";
import type { FolderBrowser } from "$lib/features/projects/state/folder-browser.svelte";
import { toDisplayPath } from "$lib/features/projects/state/folder-browser-path";
import { signalMeta } from "./directory-picker-helpers";
import ProjectIcon from "./ProjectIcon.svelte";

type Props = {
  browser: FolderBrowser;
  /** Project id for a folder that is already a known project. */
  projectIdForPath: (path: string) => string | undefined;
  el?: HTMLDivElement | undefined;
};

let { browser, projectIdForPath, el = $bindable() }: Props = $props();

let newName = $state("");
let newNameInput = $state<HTMLInputElement | null>(null);

const activeIndex = $derived(
  browser.entries.findIndex((entry) => entry.path === browser.selectedPath),
);
const activeId = $derived(
  activeIndex >= 0 ? `folder-row-${activeIndex}` : undefined,
);
const displayCwd = $derived(
  browser.cwd === undefined ? "" : toDisplayPath(browser.cwd, browser.ctx),
);

$effect(() => {
  if (!browser.creating) return;
  newName = "";
  newNameInput?.focus();
});

$effect(() => {
  if (!activeId) return;
  el?.querySelector(`#${activeId}`)?.scrollIntoView({ block: "nearest" });
});

function onCreateKeydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    browser.cancelCreate();
  } else if (event.key === "Enter") {
    event.preventDefault();
    void browser.create(newName);
  }
}
</script>

{#snippet signalBadges(signals: readonly string[])}
  {#each new Set(signals) as signal (signal)}
    {@const meta = signalMeta[signal as keyof typeof signalMeta]}
    {#if meta}
      {@const Icon = meta.icon}
      <Badge variant={meta.tone ?? "neutral"} title={meta.title}>
        <Icon />{meta.label}
      </Badge>
    {/if}
  {/each}
{/snippet}

<div
  bind:this={el}
  tabindex="-1"
  class="min-h-0 flex-1 overflow-y-auto p-1.5 outline-none"
>
  {#if browser.creating}
    <div class="mb-1 flex flex-col gap-1">
      <div
        class="flex items-center gap-2 rounded-md border border-ring px-2 py-0.5"
      >
        <FolderPlus
          class="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          bind:ref={newNameInput}
          bind:value={newName}
          ariaLabel="New folder name"
          placeholder="New folder name"
          class="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          disabled={browser.creatingBusy}
          onkeydown={onCreateKeydown}
        />
        <span class="shrink-0 text-xs text-muted-foreground max-sm:hidden"
          >Enter to create</span
        >
      </div>
      {#if browser.createError}
        <p class="px-2 text-xs text-destructive" role="alert">
          {browser.createError}
        </p>
      {/if}
    </div>
  {/if}

  {#if browser.loading && !browser.listing && !browser.atThisPC}
    <div class="flex flex-col gap-1 p-1" role="status" aria-label="Loading">
      {#each [0, 1, 2, 3, 4, 5, 6, 7] as index (index)}
        <Skeleton class="h-8 bg-muted/50" />
      {/each}
    </div>
  {:else if browser.error}
    <div
      class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
      role="alert"
    >
      <TriangleAlert class="size-6 text-destructive" aria-hidden="true" />
      <span class="text-sm">Can't read {displayCwd}</span>
      <span class="max-w-md text-xs text-muted-foreground">{browser.error}</span
      >
      <div class="flex gap-1">
        {#if browser.parent !== undefined}
          <Button variant="ghost" size="sm" onclick={() => void browser.up()}>
            <ArrowUp />Parent folder
          </Button>
        {/if}
        <Button
          variant="outline"
          size="sm"
          onclick={() => void browser.refresh()}
        >
          <RefreshCw />Retry
        </Button>
      </div>
    </div>
  {:else if browser.entries.length === 0}
    <div
      class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
    >
      <FolderX class="size-6 text-muted-foreground" aria-hidden="true" />
      <span class="text-sm">
        {browser.filter.trim()
          ? `No folders match "${browser.filter.trim()}"`
          : browser.atThisPC
            ? "No drives found"
            : "No subfolders"}
      </span>
      {#if !browser.atThisPC}
        <span class="text-xs text-muted-foreground"
          >You can still open {displayCwd} itself.</span
        >
      {/if}
    </div>
  {:else}
    <div
      class="flex flex-col outline-none"
      tabindex="0"
      role="listbox"
      aria-label="Folders"
      aria-busy={browser.loading}
      aria-activedescendant={activeId}
    >
      {#each browser.entries as entry, index (entry.path)}
        {@const projectId = projectIdForPath(entry.path)}
        {@const selected = browser.selectedPath === entry.path}
        <!-- Keyboard use goes through the listbox (arrows, Enter, →); the row
           handlers are the pointer equivalents. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          id={`folder-row-${index}`}
          role="option"
          aria-selected={selected}
          tabindex="-1"
          class={cn(
            "group flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted max-sm:py-2",
            selected && "bg-selected hover:bg-selected",
          )}
          onclick={() => browser.select(entry.path)}
          ondblclick={() => void browser.go(entry.path)}
        >
          {#if browser.atThisPC}
            <HardDrive
              class="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          {:else if projectId}
            <ProjectIcon {projectId} class="size-4 rounded-sm" />
          {:else if entry.signals.length}
            <FolderOpen
              class="size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
          {:else}
            <Folder
              class="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          {/if}
          <span
            class={cn(
              "truncate text-sm",
              entry.hidden && "text-muted-foreground",
            )}>{entry.name}</span
          >
          <span class="ml-auto flex shrink-0 gap-1 max-sm:hidden">
            {@render signalBadges(entry.signals)}
          </span>
          <button
            type="button"
            tabindex="-1"
            class="shrink-0 rounded-sm text-muted-foreground opacity-0 group-hover:opacity-100 max-sm:ml-auto max-sm:opacity-100"
            aria-label={`Open folder ${entry.name}`}
            onclick={(event) => {
              event.stopPropagation();
              void browser.go(entry.path);
            }}
          >
            <ChevronRight class="size-4" aria-hidden="true" />
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>
