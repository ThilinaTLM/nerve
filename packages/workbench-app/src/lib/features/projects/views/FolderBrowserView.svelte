<script lang="ts">
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import Eye from "@lucide/svelte/icons/eye";
import EyeOff from "@lucide/svelte/icons/eye-off";
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { SearchInput } from "@nervekit/ui-kit/components/composites/search-input";
import type { FolderBrowser } from "$lib/features/projects/state/folder-browser.svelte";
import FolderBrowserList from "./FolderBrowserList.svelte";
import FolderBrowserPathBar from "./FolderBrowserPathBar.svelte";
import FolderBrowserPlaces from "./FolderBrowserPlaces.svelte";

type Props = {
  browser: FolderBrowser;
  projectDirectories: string[];
  projectIdForPath: (path: string) => string | undefined;
  /** Open the target (selected folder, else the current one). */
  onOpen: () => void;
};

let { browser, projectDirectories, projectIdForPath, onOpen }: Props = $props();

let pathBar = $state<FolderBrowserPathBar>();
let pathEditing = $state(false);
let listEl = $state<HTMLDivElement | undefined>();

function focusList() {
  const listbox = listEl?.querySelector<HTMLElement>("[role=listbox]");
  (listbox ?? listEl)?.focus();
}

let rootEl = $state<HTMLDivElement | undefined>();

// Land on the list once a folder is ready so Enter opens and arrows select.
// The dialog focuses its close button as it opens, so wait a beat and only
// move focus when it is still outside the browser (never steal from a field).
$effect(() => {
  if (browser.cwd === undefined || browser.loading || !listEl) return;
  const timer = setTimeout(() => {
    if (!rootEl?.contains(document.activeElement)) focusList();
  }, 60);
  return () => clearTimeout(timer);
});

// When the path field or the new-folder row goes away its focus is lost to
// the page; hand it back to the list so Enter does not hit a toolbar button.
let wasTyping = false;
$effect(() => {
  const typing = pathEditing || browser.creating;
  if (wasTyping && !typing) {
    requestAnimationFrame(() => {
      // The dialog's focus trap may already have moved focus to its close button.
      if (!rootEl?.contains(document.activeElement)) focusList();
    });
  }
  wasTyping = typing;
});

const canCreate = $derived(!browser.atThisPC && browser.cwd !== undefined);

function moveSelection(delta: 1 | -1) {
  const entries = browser.entries;
  if (!entries.length) return;
  const current = entries.findIndex((e) => e.path === browser.selectedPath);
  const next =
    current < 0
      ? delta === 1
        ? 0
        : entries.length - 1
      : Math.min(entries.length - 1, Math.max(0, current + delta));
  browser.select(entries[next]?.path);
}

function onkeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const inFilter = Boolean(target?.closest("[data-folder-filter]"));
  const inField =
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  // The path and new-folder fields own their keys.
  if (inField && !inFilter) return;
  const mod = event.metaKey || event.ctrlKey;

  if (mod && event.key.toLowerCase() === "l") {
    event.preventDefault();
    pathBar?.beginEditing();
    return;
  }
  if (event.altKey && event.key.toLowerCase() === "d") {
    event.preventDefault();
    pathBar?.beginEditing();
    return;
  }
  if (event.altKey && event.key === "ArrowLeft") {
    event.preventDefault();
    void browser.back();
    return;
  }
  if (event.altKey && event.key === "ArrowRight") {
    event.preventDefault();
    void browser.forward();
    return;
  }
  if ((mod || event.altKey) && event.key === "ArrowUp") {
    event.preventDefault();
    void browser.up();
    return;
  }
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      moveSelection(1);
      break;
    case "ArrowUp":
      event.preventDefault();
      moveSelection(-1);
      break;
    case "ArrowRight":
      if (!inField && browser.selectedPath && !browser.creating) {
        event.preventDefault();
        void browser.go(browser.selectedPath);
      }
      break;
    case "ArrowLeft":
    case "Backspace":
      if (!inField) {
        event.preventDefault();
        void browser.up();
      }
      break;
    case "Enter":
      if (target instanceof HTMLButtonElement) return;
      event.preventDefault();
      if (inFilter && !browser.selectedPath && browser.entries[0]) {
        browser.select(browser.entries[0].path);
      } else {
        onOpen();
      }
      break;
  }
}
</script>

{#snippet filterField(cls: string)}
  <div data-folder-filter class={cls}>
    <SearchInput
      bind:value={browser.filter}
      placeholder="Filter"
      ariaLabel="Filter folders"
    />
  </div>
{/snippet}

<!-- Keys are handled once for the whole browser so arrows work from the
     filter field and the list alike. -->
<div class="flex h-full min-h-0 flex-col" role="presentation" {onkeydown}>
  <div class="flex items-center gap-1 border-b px-3 pb-2">
    <div class="flex items-center gap-1 max-sm:hidden">
      <IconAction
        icon={ArrowLeft}
        label="Back"
        disabled={!browser.history.length}
        onclick={() => void browser.back()}
      />
      <IconAction
        icon={ArrowRight}
        label="Forward"
        disabled={!browser.future.length}
        onclick={() => void browser.forward()}
      />
    </div>
    <IconAction
      icon={ArrowUp}
      label="Parent folder"
      disabled={browser.parent === undefined}
      onclick={() => void browser.up()}
    />
    <FolderBrowserPathBar
      bind:this={pathBar}
      {browser}
      bind:editing={pathEditing}
    />
    {@render filterField("w-40 shrink-0 max-sm:hidden")}
    <IconAction
      icon={browser.showHidden ? Eye : EyeOff}
      label={browser.showHidden ? "Hide hidden folders" : "Show hidden folders"}
      onclick={() => void browser.setShowHidden(!browser.showHidden)}
    />
    <div class="max-sm:hidden">
      <IconAction
        icon={RefreshCw}
        label="Refresh"
        busy={browser.loading}
        onclick={() => void browser.refresh()}
      />
    </div>
    <IconAction
      icon={FolderPlus}
      label="New folder"
      disabled={!canCreate}
      onclick={() => browser.startCreate()}
    />
  </div>

  <div class="flex min-h-0 flex-1 max-sm:flex-col">
    <FolderBrowserPlaces {browser} {projectDirectories} />
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      {@render filterField("px-3 pt-2 sm:hidden")}
      <FolderBrowserList bind:el={listEl} {browser} {projectIdForPath} />
    </div>
  </div>
</div>
