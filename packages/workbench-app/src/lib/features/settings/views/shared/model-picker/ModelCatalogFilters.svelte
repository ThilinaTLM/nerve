<!--
  Search, provider and capability filters shared by the ModelPicker popover
  and the inline scope editor. Required capabilities stay pressed and locked
  so a tool's constraint is visible instead of silently narrowing the list.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import Brain from "@lucide/svelte/icons/brain";
import Braces from "@lucide/svelte/icons/braces";
import Image from "@lucide/svelte/icons/image";
import Lock from "@lucide/svelte/icons/lock";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { cn } from "@nervekit/ui-kit/utils";
import {
  LONG_CONTEXT_TOKENS,
  modelCapabilities,
  modelCapabilityLabels,
  modelProviderFacets,
  type ModelCapability,
  type ModelCatalogEntry,
} from "$lib/presentation/utils/model-catalog";
import { formatTokenCapacity } from "$lib/presentation/utils/model";

type Props = {
  entries: ModelCatalogEntry[];
  query?: string;
  provider?: string;
  capabilities?: ModelCapability[];
  requiredCapabilities?: ModelCapability[];
  /** Muted text at the end of the capability line, e.g. "12 of 40". */
  countLabel?: string;
  class?: string;
  /** Leading content on the search line (e.g. a view toggle). */
  leading?: Snippet;
  searchRef?: HTMLInputElement | null;
  onSearchKeydown?: (event: KeyboardEvent) => void;
  controls?: string;
  activeDescendant?: string;
};

let {
  entries,
  query = $bindable(""),
  provider = $bindable("all"),
  capabilities = $bindable([]),
  requiredCapabilities = [],
  countLabel,
  class: className,
  leading,
  searchRef = $bindable(null),
  onSearchKeydown,
  controls,
  activeDescendant,
}: Props = $props();

const providerFacets = $derived(modelProviderFacets(entries));
const capabilityIcons = {
  vision: Image,
  reasoning: Brain,
  "long-context": Braces,
};

function capabilityTitle(capability: ModelCapability): string {
  if (requiredCapabilities.includes(capability)) return "Required by this tool";
  if (capability === "long-context") {
    return `Context window of ${formatTokenCapacity(LONG_CONTEXT_TOKENS)} tokens or more`;
  }
  return `Only ${modelCapabilityLabels[capability].toLowerCase()} models`;
}
</script>

<div class={cn("grid gap-1.5", className)}>
  <div class="flex min-w-0 items-center gap-1.5">
    {@render leading?.()}
    <SearchInput
      bind:value={query}
      bind:ref={searchRef}
      size="sm"
      class="flex-1"
      placeholder="Search models"
      ariaLabel="Search models"
      onkeydown={onSearchKeydown}
      {controls}
      {activeDescendant}
    />
  </div>
  {#if providerFacets.length > 2}
    <ToggleGroup.Root
      type="single"
      size="xs"
      spacing={1}
      variant="chip"
      value={provider}
      aria-label="Filter by provider"
      class="flex-wrap justify-start"
      onValueChange={(value) => {
        if (value) provider = value;
      }}
    >
      {#each providerFacets as facet (facet.id)}
        <ToggleGroup.Item value={facet.id} class="flex-none">
          {facet.label}
          <span data-slot="toggle-count">{facet.count}</span>
        </ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
  {/if}
  <div class="flex min-w-0 items-center gap-1">
    <ToggleGroup.Root
      type="multiple"
      size="xs"
      spacing={1}
      variant="chip"
      value={capabilities}
      aria-label="Filter by capability"
      class="flex-wrap justify-start"
      onValueChange={(value) => {
        const next = [...(value as ModelCapability[]), ...requiredCapabilities];
        capabilities = modelCapabilities.filter((item) => next.includes(item));
      }}
    >
      {#each modelCapabilities as capability (capability)}
        {@const locked = requiredCapabilities.includes(capability)}
        {@const Icon = locked ? Lock : capabilityIcons[capability]}
        <ToggleGroup.Item
          value={capability}
          disabled={locked}
          title={capabilityTitle(capability)}
          class="flex-none gap-1 disabled:opacity-100"
        >
          <Icon class="size-3" aria-hidden="true" />
          {modelCapabilityLabels[capability]}
        </ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
    {#if countLabel}
      <span class="ml-auto flex-none text-xs text-muted-foreground tabular-nums"
        >{countLabel}</span
      >
    {/if}
  </div>
</div>
