<!--
  Search, provider and capability filters shared by the ModelPicker popover
  and the inline scope editor. Providers form an open-ended list, so they live
  in a dropdown; the three capabilities are icon toggles. Everything sits on
  one line when the container is wide and wraps the filters under the search
  field otherwise. Required capabilities stay pressed and locked so a tool's
  constraint is visible instead of silently narrowing the list.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import Brain from "@lucide/svelte/icons/brain";
import Braces from "@lucide/svelte/icons/braces";
import Image from "@lucide/svelte/icons/image";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import * as Select from "@nervekit/ui-kit/components/ui/select";
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
  class: className,
  leading,
  searchRef = $bindable(null),
  onSearchKeydown,
  controls,
  activeDescendant,
}: Props = $props();

const providerFacets = $derived(modelProviderFacets(entries));
const providerLabel = $derived(
  provider === "all"
    ? "All providers"
    : (providerFacets.find((facet) => facet.id === provider)?.label ??
        provider),
);
const capabilityIcons = {
  vision: Image,
  reasoning: Brain,
  "long-context": Braces,
};

function capabilityTitle(capability: ModelCapability): string {
  const label = modelCapabilityLabels[capability];
  if (requiredCapabilities.includes(capability)) {
    return `${label} — required by this tool`;
  }
  if (capability === "long-context") {
    return `${label}: ${formatTokenCapacity(LONG_CONTEXT_TOKENS)} tokens or more`;
  }
  return `Only ${label.toLowerCase()} models`;
}
</script>

<div class={cn("@container", className)}>
  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
    <div
      class="flex min-w-0 basis-full items-center gap-1.5 @xl:basis-0 @xl:flex-1"
    >
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
    <div class="flex min-w-0 flex-1 items-center gap-1.5 @xl:flex-none">
      {#if providerFacets.length > 2}
        <Select.Root
          type="single"
          value={provider}
          onValueChange={(value) => {
            if (value) provider = value;
          }}
        >
          <Select.Trigger
            size="sm"
            aria-label="Filter by provider"
            class="min-w-0 flex-1 @xl:w-44 @xl:flex-none"
          >
            <span class="truncate">{providerLabel}</span>
          </Select.Trigger>
          <Select.Content>
            {#each providerFacets as facet (facet.id)}
              <Select.Item
                value={facet.id}
                label={facet.id === "all" ? "All providers" : facet.label}
              >
                <span class="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span class="truncate"
                    >{facet.id === "all" ? "All providers" : facet.label}</span
                  >
                  <span class="text-xs text-muted-foreground tabular-nums"
                    >{facet.count}</span
                  >
                </span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      {/if}
      <ToggleGroup.Root
        type="multiple"
        size="sm"
        spacing={1}
        variant="chip"
        value={capabilities}
        aria-label="Filter by capability"
        class="ml-auto flex-none"
        onValueChange={(value) => {
          const next = [
            ...(value as ModelCapability[]),
            ...requiredCapabilities,
          ];
          capabilities = modelCapabilities.filter((item) =>
            next.includes(item),
          );
        }}
      >
        {#each modelCapabilities as capability (capability)}
          {@const Icon = capabilityIcons[capability]}
          <ToggleGroup.Item
            value={capability}
            disabled={requiredCapabilities.includes(capability)}
            title={capabilityTitle(capability)}
            aria-label={capabilityTitle(capability)}
            class="flex-none disabled:opacity-100"
          >
            <Icon class="size-3.5" aria-hidden="true" />
          </ToggleGroup.Item>
        {/each}
      </ToggleGroup.Root>
    </div>
  </div>
</div>
