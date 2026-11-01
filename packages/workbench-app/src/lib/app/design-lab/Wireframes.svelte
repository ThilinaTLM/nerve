<script lang="ts">
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { WIREFRAMES_PATH } from "./lab-route";
import { WIREFRAMES } from "./wireframes";

let { name }: { name?: string } = $props();
const active = $derived(WIREFRAMES.find((entry) => entry.id === name));
const loading = $derived(active?.load());
</script>

<main class="flex h-full flex-col gap-6 overflow-y-auto p-6">
  <header class="flex flex-col gap-1">
    {#if name}
      <a href={WIREFRAMES_PATH} class="text-ui text-primary underline"
        >All wireframes</a
      >
    {/if}
    <h1 class="text-title font-semibold">
      {active?.title ?? (name ? "Wireframe not found" : "Wireframes")}
    </h1>
    <p class="text-ui text-muted-foreground">
      {active?.summary ??
        "Quick UI experiments using real components and local mock data."}
    </p>
  </header>
  {#if loading}
    {#await loading}
      <div class="flex items-center gap-2 text-ui text-muted-foreground">
        <Spinner /> Loading wireframe…
      </div>
    {:then { default: Wireframe }}
      <div class="min-h-0 flex-1"><Wireframe /></div>
    {:catch error}
      <p class="text-ui text-destructive">
        Failed to load wireframe: {String(error)}
      </p>
    {/await}
  {:else if !name && WIREFRAMES.length === 0}
    <div class="flex flex-col gap-2 rounded-md border bg-card p-4">
      <h2 class="text-ui font-semibold">No local wireframes yet</h2>
      <p class="text-ui text-muted-foreground">
        Add a Svelte component with a kebab-case filename under <code
          >src/lib/app/design-lab/wireframes/</code
        >. It will appear here automatically. This directory is gitignored.
      </p>
    </div>
  {:else if !name}
    <ul class="flex flex-col divide-y rounded-md border bg-card">
      {#each WIREFRAMES as entry (entry.id)}
        <li>
          <a
            href={`${WIREFRAMES_PATH}/${entry.id}`}
            class="flex flex-col gap-1 p-4 hover:bg-muted"
          >
            <span class="text-ui font-medium">{entry.title}</span>
            <span class="text-ui text-muted-foreground">{entry.summary}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
