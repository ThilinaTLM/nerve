<script lang="ts">
import Clock from "@lucide/svelte/icons/clock";
import Download from "@lucide/svelte/icons/download";
import FileText from "@lucide/svelte/icons/file-text";
import Folder from "@lucide/svelte/icons/folder";
import HardDrive from "@lucide/svelte/icons/hard-drive";
import House from "@lucide/svelte/icons/house";
import Monitor from "@lucide/svelte/icons/monitor";
import Server from "@lucide/svelte/icons/server";
import type { Component } from "svelte";
import type { FilesystemLocation, FilesystemPlace } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { cn } from "@nervekit/ui-kit/utils";
import { pathKey } from "$lib/domain/filesystem/project-path";
import type { FolderBrowser } from "$lib/features/projects/state/folder-browser.svelte";
import {
  projectRoots,
  THIS_PC,
  toDisplayPath,
} from "$lib/features/projects/state/folder-browser-path";

type Props = {
  browser: FolderBrowser;
  /** Directories of known projects; their parents become "Project roots". */
  projectDirectories: string[];
};

let { browser, projectDirectories }: Props = $props();

type IconType = Component<{ class?: string; "aria-hidden"?: boolean | "true" }>;
type Item = { key: string; label: string; path: string; icon: IconType };

const PLACE_ICON: Record<FilesystemPlace["id"], IconType> = {
  home: House,
  desktop: Monitor,
  documents: FileText,
  downloads: Download,
  projects: Folder,
};
const LOCATION_ICON: Record<FilesystemLocation["kind"], IconType> = {
  root: HardDrive,
  drive: HardDrive,
  volume: HardDrive,
  removable: HardDrive,
  network: Server,
};

const ctx = $derived(browser.ctx);
const isWindows = $derived(ctx.platform === "win32");
const places = $derived<Item[]>(
  (browser.locations?.places ?? []).map((place) => ({
    key: `place:${place.id}`,
    label: place.label,
    path: place.path,
    icon: PLACE_ICON[place.id],
  })),
);
const locations = $derived<Item[]>([
  ...(isWindows
    ? [{ key: "this-pc", label: "This PC", path: THIS_PC, icon: Monitor }]
    : []),
  ...(browser.locations?.locations ?? []).map((location) => ({
    key: `location:${location.path}`,
    label: location.label,
    path: location.path,
    icon: LOCATION_ICON[location.kind],
  })),
]);
const roots = $derived<Item[]>(
  projectRoots(projectDirectories, ctx).map((path) => ({
    key: `root:${path}`,
    label: toDisplayPath(path, ctx),
    path,
    icon: Clock,
  })),
);

function isCurrent(path: string): boolean {
  return (
    browser.cwd !== undefined &&
    pathKey(path, ctx.caseInsensitive) ===
      pathKey(browser.cwd, ctx.caseInsensitive) &&
    (path !== THIS_PC || browser.cwd === THIS_PC)
  );
}
</script>

{#snippet section(title: string, items: Item[], mono = false)}
  {#if items.length}
    <div class="flex flex-col gap-0.5">
      <span class="px-2 pb-1 text-xs font-medium text-muted-foreground"
        >{title}</span
      >
      {#each items as item (item.key)}
        <button
          type="button"
          class={cn(
            "flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
            isCurrent(item.path) && "bg-selected font-medium text-foreground",
          )}
          aria-current={isCurrent(item.path) ? "true" : undefined}
          title={item.path === THIS_PC ? undefined : item.path}
          onclick={() => void browser.go(item.path)}
        >
          <item.icon class="size-4 shrink-0" aria-hidden="true" />
          <span class={cn("truncate", mono && "font-mono text-xs")}
            >{item.label}</span
          >
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

<nav
  class="flex w-48 shrink-0 flex-col gap-3 overflow-y-auto border-r bg-panel p-2 max-sm:hidden"
  aria-label="Places"
>
  {@render section("Places", places)}
  {@render section(isWindows ? "Drives" : "Locations", locations)}
  {@render section("Project roots", roots, true)}
</nav>

<nav
  class="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2 sm:hidden"
  aria-label="Places"
>
  {#each [...places, ...locations, ...roots] as item (item.key)}
    <Button
      variant={isCurrent(item.path) ? "outline" : "ghost"}
      size="sm"
      class="shrink-0"
      onclick={() => void browser.go(item.path)}
    >
      <item.icon aria-hidden="true" />{item.label}
    </Button>
  {/each}
</nav>
