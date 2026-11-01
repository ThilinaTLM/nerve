<script lang="ts">
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cn } from "@nervekit/ui-kit/utils";
import { onMount } from "svelte";
import { hashForSection, sectionIdFromHash } from "./lab-route";
import { GALLERY_GROUPS, GALLERY_SECTIONS } from "./gallery-sections";

let activeId = $state(
  sectionIdFromHash(window.location.hash) ?? GALLERY_SECTIONS[0]!.id,
);
const active = $derived(
  GALLERY_SECTIONS.find((section) => section.id === activeId) ??
    GALLERY_SECTIONS[0]!,
);
const loading = $derived(active.load());

let contentScroller = $state<HTMLDivElement | null>(null);

// Each page opens at its top. Specimens such as tab strips and trees call
// scrollIntoView on their active item while mounting, which scrolls this
// container too, so reset again once the section has settled.
$effect(() => {
  const scroller = contentScroller;
  if (!scroller) return;
  let cancelled = false;
  scroller.scrollTo({ top: 0 });
  void loading.then(() => {
    window.setTimeout(() => {
      if (!cancelled) scroller.scrollTo({ top: 0 });
    }, 150);
  });
  return () => {
    cancelled = true;
  };
});

function selectSection(id: string): void {
  activeId = id;
  window.history.replaceState({}, "", hashForSection(id));
}

onMount(() => {
  const onHashChange = () => {
    const id = sectionIdFromHash(window.location.hash);
    if (id) activeId = id;
  };
  window.addEventListener("hashchange", onHashChange);
  return () => window.removeEventListener("hashchange", onHashChange);
});
</script>

<div class="flex h-full w-full overflow-hidden bg-background text-foreground">
  <aside class="flex w-60 shrink-0 flex-col border-r bg-panel">
    <div class="flex flex-col gap-0.5 border-b px-4 py-3">
      <span class="text-ui font-semibold">Component catalog</span>
      <span class="text-ui text-muted-foreground">
        {GALLERY_SECTIONS.length} pages · dev only
      </span>
    </div>
    <ScrollArea class="min-h-0 flex-1">
      <nav class="flex flex-col gap-4 p-2" aria-label="Catalog sections">
        {#each GALLERY_GROUPS as group (group)}
          <div class="flex flex-col gap-0.5">
            <span class="px-2 pb-1 text-ui font-semibold text-muted-foreground">
              {group}
            </span>
            {#each GALLERY_SECTIONS.filter((section) => section.group === group) as section (section.id)}
              <a
                href={hashForSection(section.id)}
                aria-current={section.id === active.id ? "page" : undefined}
                onclick={(event) => {
                  event.preventDefault();
                  selectSection(section.id);
                }}
                class={cn(
                  "rounded-md px-2 py-1 text-ui text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  section.id === active.id && "bg-selected text-foreground",
                )}
              >
                {section.title}
              </a>
            {/each}
          </div>
        {/each}
      </nav>
    </ScrollArea>
  </aside>

  <div bind:this={contentScroller} class="min-w-0 flex-1 overflow-y-auto">
    <main class="mx-auto flex w-full max-w-5xl flex-col gap-8 px-8 py-6">
      <header class="flex flex-col gap-1">
        <span class="text-ui text-muted-foreground">{active.group}</span>
        <h1 class="text-title font-semibold">{active.title}</h1>
        <p class="text-ui text-muted-foreground">{active.summary}</p>
      </header>
      {#key active.id}
        {#await loading}
          <div class="flex items-center gap-2 text-ui text-muted-foreground">
            <Spinner /> Loading section…
          </div>
        {:then { default: Section }}
          <Section />
        {:catch error}
          <p class="text-ui text-destructive">
            Failed to load section: {String(error)}
          </p>
        {/await}
      {/key}
    </main>
  </div>
</div>
