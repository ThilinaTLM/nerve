<script lang="ts">
import {
  colorThemeKind,
  colorThemeSchema,
  type ColorTheme,
} from "@nervekit/contracts/settings";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Select from "@nervekit/ui-kit/components/ui/select";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { cn } from "@nervekit/ui-kit/utils";
import MoonIcon from "@lucide/svelte/icons/moon";
import SunIcon from "@lucide/svelte/icons/sun";
import { onMount } from "svelte";
import {
  appearanceState,
  applyAppearance,
} from "$lib/platform/appearance/appearance.svelte";
import { dismissStartupSplash } from "$lib/app/shell/startup-splash";
import ComponentCatalog from "./ComponentCatalog.svelte";
import {
  COMPONENTS_PATH,
  WIREFRAMES_PATH,
  labRouteFromPath,
} from "./lab-route";
import Wireframes from "./Wireframes.svelte";

const route = labRouteFromPath(window.location.pathname);
// The bootstrap already applied the user's theme; the lab starts from it.
let theme = $state<ColorTheme>(
  colorThemeSchema.safeParse(document.documentElement.dataset.theme).data ??
    appearanceState.theme,
);
const dark = $derived(colorThemeKind[theme] === "dark");

// Lab theme selection applies to the document but is never persisted.
$effect(() => applyAppearance(theme));
onMount(dismissStartupSplash);
</script>

<svelte:head>
  <title>Design Lab · nerve</title>
</svelte:head>

<Tooltip.Provider>
  <div
    class="flex h-dvh flex-col overflow-hidden bg-background text-foreground"
  >
    <header
      class="flex shrink-0 flex-wrap items-center gap-3 border-b bg-panel px-4 py-2"
    >
      <span class="text-ui font-medium">Design Lab</span>
      <span class="text-ui text-muted-foreground">Development only</span>
      <nav class="flex items-center gap-2" aria-label="Design Lab">
        {#each [{ path: COMPONENTS_PATH, title: "Components", page: "components" }, { path: WIREFRAMES_PATH, title: "Wireframes", page: "wireframes" }] as item (item.path)}
          <a
            href={item.path}
            aria-current={route?.page === item.page ? "page" : undefined}
            class={cn(
              "rounded-md px-2 py-1 text-ui text-muted-foreground hover:bg-muted hover:text-foreground",
              route?.page === item.page && "bg-selected text-foreground",
            )}
          >
            {item.title}
          </a>
        {/each}
      </nav>
      <div class="ml-auto flex items-center gap-2">
        <Select.Root type="single" bind:value={theme}>
          <Select.Trigger aria-label="Theme"
            ><span>{theme}</span></Select.Trigger
          >
          <Select.Content>
            {#each colorThemeSchema.options as option (option)}
              <Select.Item value={option} label={option} />
            {/each}
          </Select.Content>
        </Select.Root>
        <Button
          variant="outline"
          size="icon"
          ariaLabel={dark ? "Switch to Nerve Light" : "Switch to Nerve Dark"}
          onclick={() => {
            theme = dark ? "nerve-light" : "nerve-dark";
          }}
        >
          {#if dark}<SunIcon />{:else}<MoonIcon />{/if}
        </Button>
      </div>
    </header>
    <div class="min-h-0 flex-1">
      {#if route?.page === "components"}
        <ComponentCatalog />
      {:else if route?.page === "wireframes"}
        <Wireframes name={route.name} />
      {:else}
        <main class="flex flex-col gap-3 p-6">
          <h1 class="text-title font-medium">Lab page not found</h1>
          <a href={COMPONENTS_PATH} class="text-ui text-primary underline"
            >Open the component catalog</a
          >
        </main>
      {/if}
    </div>
  </div>
</Tooltip.Provider>
