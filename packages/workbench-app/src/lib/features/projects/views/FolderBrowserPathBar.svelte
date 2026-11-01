<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import CornerDownLeft from "@lucide/svelte/icons/corner-down-left";
import Folder from "@lucide/svelte/icons/folder";
import Pencil from "@lucide/svelte/icons/pencil";
import { listDirectories } from "$lib/api";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { cn } from "@nervekit/ui-kit/utils";
import type { FolderBrowser } from "$lib/features/projects/state/folder-browser.svelte";
import {
  completionQuery,
  pathCrumbs,
  resolveTypedPath,
  THIS_PC,
  toDisplayPath,
} from "$lib/features/projects/state/folder-browser-path";

type Props = {
  browser: FolderBrowser;
  /** Editable text mode. Bindable so Mod+L can switch it on. */
  editing?: boolean;
};

let { browser, editing = $bindable(false) }: Props = $props();

const MAX_COMPLETIONS = 8;
const listboxId = "folder-browser-path-completions";

let draft = $state("");
let pathError = $state<string>();
let completions = $state<string[]>([]);
let highlighted = $state(-1);
let input = $state<HTMLInputElement | null>(null);
let crumbsEl = $state<HTMLElement | undefined>();
let cachedDir:
  | { dir: string; names: { name: string; path: string }[] }
  | undefined;
let completionToken = 0;
let completionTimer: ReturnType<typeof setTimeout> | undefined;

const ctx = $derived(browser.ctx);
const rootLabel = $derived(
  ctx.platform === "darwin"
    ? (browser.locations?.locations.find((l) => l.kind === "root")?.label ??
        "Macintosh HD")
    : "/",
);
const crumbs = $derived(
  browser.cwd === undefined ? [] : pathCrumbs(browser.cwd, ctx, rootLabel),
);

function start() {
  if (browser.cwd === undefined) return;
  const shown = browser.cwd === THIS_PC ? "" : toDisplayPath(browser.cwd, ctx);
  draft =
    shown && !shown.endsWith(ctx.separator) ? shown + ctx.separator : shown;
  pathError = undefined;
  highlighted = -1;
  cachedDir = undefined;
  editing = true;
}

function stop() {
  editing = false;
  pathError = undefined;
  completions = [];
  clearTimeout(completionTimer);
}

$effect(() => {
  if (!editing) return;
  const el = input;
  if (!el) return;
  el.focus();
  // Select all, as file dialogs do: typing replaces, End appends.
  el.select();
});

// Keep the deepest crumb visible when the trail overflows.
$effect(() => {
  void crumbs;
  if (crumbsEl) crumbsEl.scrollLeft = crumbsEl.scrollWidth;
});

$effect(() => {
  if (!editing) return;
  const value = draft;
  const showHidden = browser.showHidden;
  void showHidden;
  clearTimeout(completionTimer);
  const query = completionQuery(value, ctx);
  if (!query) {
    completions = [];
    return;
  }
  const token = ++completionToken;
  completionTimer = setTimeout(async () => {
    try {
      if (cachedDir?.dir !== query.dir) {
        const listing = await listDirectories(query.dir, false);
        cachedDir = {
          dir: query.dir,
          names: listing.entries.map((e) => ({ name: e.name, path: e.path })),
        };
      }
      if (token !== completionToken) return;
      const prefix =
        ctx.caseInsensitive || ctx.platform === "win32"
          ? query.prefix.toLowerCase()
          : query.prefix;
      completions = cachedDir.names
        .filter((e) =>
          (ctx.caseInsensitive || ctx.platform === "win32"
            ? e.name.toLowerCase()
            : e.name
          ).startsWith(prefix),
        )
        .slice(0, MAX_COMPLETIONS)
        .map((e) => e.path);
      highlighted = -1;
    } catch {
      if (token === completionToken) completions = [];
    }
  }, 120);
  return () => clearTimeout(completionTimer);
});

async function commit(path: string) {
  pathError = undefined;
  const failure = await browser.goTyped(path);
  if (failure) pathError = failure;
  else stop();
}

function acceptCompletion(path: string) {
  draft = path + ctx.separator;
  highlighted = -1;
  input?.focus();
}

function onkeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    stop();
  } else if (event.key === "Enter") {
    event.preventDefault();
    const chosen = completions[highlighted];
    void commit(chosen ?? resolveTypedPath(draft, ctx));
  } else if (event.key === "ArrowDown" && completions.length) {
    event.preventDefault();
    highlighted = (highlighted + 1) % completions.length;
  } else if (event.key === "ArrowUp" && completions.length) {
    event.preventDefault();
    highlighted = highlighted <= 0 ? completions.length - 1 : highlighted - 1;
  } else if (event.key === "Tab" && completions.length && !event.shiftKey) {
    event.preventDefault();
    const chosen = completions[highlighted >= 0 ? highlighted : 0];
    if (chosen) acceptCompletion(chosen);
  }
}

export function beginEditing() {
  start();
}
</script>

<div class="relative min-w-0 flex-1">
  {#if editing}
    <div class="relative">
      <Input
        bind:ref={input}
        bind:value={draft}
        ariaLabel="Folder path"
        class="pr-7 font-mono"
        role="combobox"
        aria-expanded={completions.length > 0}
        aria-controls={listboxId}
        aria-invalid={pathError ? true : undefined}
        autocomplete="off"
        spellcheck={false}
        {onkeydown}
        onblur={stop}
      />
      <CornerDownLeft
        class="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
    {#if pathError}
      <p
        class="absolute top-full right-0 left-0 z-10 mt-1 rounded-md border bg-popover px-2 py-1 text-ui text-destructive shadow-overlay"
        role="alert"
      >
        {pathError}
      </p>
    {:else if completions.length}
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Path suggestions"
        class="absolute top-full right-0 left-0 z-10 mt-1 flex flex-col rounded-md border bg-popover p-1 shadow-overlay"
      >
        {#each completions as path, index (path)}
          <li role="option" aria-selected={index === highlighted}>
            <button
              type="button"
              tabindex="-1"
              class={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left font-mono text-ui hover:bg-hover",
                index === highlighted && "bg-selected",
              )}
              onmousedown={(event) => event.preventDefault()}
              onclick={() => void commit(path)}
            >
              <Folder
                class="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span class="truncate">{toDisplayPath(path, ctx)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <!-- Clicking the empty area is a pointer convenience; Mod+L and the pencil
         are the keyboard routes into the same mode. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="group flex h-control cursor-text items-center gap-0.5 overflow-hidden rounded-md border border-input bg-input-background px-1"
      onclick={(event) => {
        if (event.target === event.currentTarget) start();
      }}
    >
      <nav
        bind:this={crumbsEl}
        aria-label="Folder path"
        class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
      >
        {#each crumbs as crumb, index (crumb.path + index)}
          {#if index > 0}
            <ChevronRight
              class="size-3 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          {/if}
          <button
            type="button"
            class={cn(
              "shrink-0 rounded-sm px-1 font-mono text-ui hover:bg-hover",
              index === crumbs.length - 1
                ? "text-foreground"
                : "text-muted-foreground",
            )}
            aria-current={index === crumbs.length - 1 ? "page" : undefined}
            onclick={() => void browser.go(crumb.path)}>{crumb.label}</button
          >
        {/each}
      </nav>
      <button
        type="button"
        class="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
        aria-label="Edit path"
        onclick={start}
      >
        <Pencil class="size-3" aria-hidden="true" />
      </button>
    </div>
  {/if}
</div>
