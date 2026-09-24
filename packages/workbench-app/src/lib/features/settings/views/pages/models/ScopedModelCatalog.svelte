<!--
  Inline scope editor for the Models page: the catalog itself is the list.
  Checking a model adds it to the composer scope (saved immediately), and the
  star marks the default model for new agents together with its reasoning level.
-->
<script lang="ts">
import Star from "@lucide/svelte/icons/star";
import type { ModelInfo, ModelSelection, ThinkingLevel } from "$lib/api";
import { VirtualScroller } from "@nervekit/ui-kit/components/composites/virtual-list";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { modelKey } from "$lib/presentation/utils/model";
import {
  buildModelCatalog,
  modelSupportsReasoning,
  type ModelCapability,
} from "$lib/presentation/utils/model-catalog";
import ModelCatalogFilters from "../../shared/model-picker/ModelCatalogFilters.svelte";
import ModelCatalogRow from "../../shared/model-picker/ModelCatalogRow.svelte";
import {
  scopedCatalogRows,
  toggleScopedModel,
  type ScopedCatalogView,
} from "../../shared/model-picker/model-picker";
import DefaultModelStar from "./DefaultModelStar.svelte";

type Props = {
  /** Authenticated, non-faux models. */
  models: ModelInfo[];
  scopedModels: ModelSelection[];
  defaultModel?: ModelSelection;
  defaultThinkingLevel: ThinkingLevel;
  onScopedModelsChange: (next: ModelSelection[]) => void;
  onMakeDefault: (
    selection: ModelSelection,
    model: ModelInfo,
    level: ThinkingLevel,
  ) => void;
};

let {
  models,
  scopedModels,
  defaultModel,
  defaultThinkingLevel,
  onScopedModelsChange,
  onMakeDefault,
}: Props = $props();

let viewChoice = $state<ScopedCatalogView>();
let query = $state("");
let provider = $state("all");
let capabilities = $state<ModelCapability[]>([]);

const view = $derived<ScopedCatalogView>(
  viewChoice ?? (scopedModels.length > 0 ? "scoped" : "all"),
);
const catalog = $derived(buildModelCatalog(models));
const rows = $derived(
  scopedCatalogRows({
    entries: catalog,
    scoped: scopedModels,
    view,
    query,
    provider,
    capabilities: new Set(capabilities),
  }),
);
const defaultKey = $derived(defaultModel ? modelKey(defaultModel) : undefined);
const scopeEmpty = $derived(scopedModels.length === 0);

function toggle(selection: ModelSelection, checked: boolean): void {
  onScopedModelsChange(toggleScopedModel(scopedModels, selection, checked));
}
</script>

<div class="overflow-hidden rounded-md border border-border bg-card">
  <ModelCatalogFilters
    class="border-b border-border/60 p-2"
    entries={catalog}
    bind:query
    bind:provider
    bind:capabilities
    countLabel={`${rows.length} shown`}
  >
    {#snippet leading()}
      <ToggleGroup.Root
        type="single"
        size="sm"
        spacing={1}
        variant="chip"
        value={view}
        aria-label="Show models"
        class="flex-none"
        data-tour-id="setup-scoped-models-view"
        onValueChange={(next) => {
          if (next) viewChoice = next as ScopedCatalogView;
        }}
      >
        <ToggleGroup.Item value="scoped" class="gap-1.5">
          Scoped <span data-slot="toggle-count">{scopedModels.length}</span>
        </ToggleGroup.Item>
        <ToggleGroup.Item value="all" class="gap-1.5">
          All <span data-slot="toggle-count">{catalog.length}</span>
        </ToggleGroup.Item>
      </ToggleGroup.Root>
    {/snippet}
  </ModelCatalogFilters>

  <div data-tour-id="setup-scoped-models-catalog">
    <Tooltip.Provider delayDuration={300} disableHoverableContent>
      {#if rows.length === 0}
        <div
          class="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground"
        >
          {#if view === "scoped" && scopeEmpty}
            <span class="flex-1"
              >No scope set. Every authenticated model is offered in the
              composer.</span
            >
            <Button
              size="xs"
              variant="outline"
              onclick={() => (viewChoice = "all")}>Browse all models</Button
            >
          {:else}
            No models match the current filters.
          {/if}
        </div>
      {:else}
        <VirtualScroller
          items={rows}
          getKey={(row) => row.key}
          estimateSize={() => 32}
          gap={0}
          viewportClass="max-h-[min(55vh,26rem)]"
          viewportAriaLabel="Model catalog"
        >
          {#snippet row({ item })}
            {@const label = item.entry?.displayName ?? item.selection.modelId}
            {@const isDefault = item.key === defaultKey}
            {@const model = item.entry?.model}
            <ModelCatalogRow
              mode="checkbox"
              {label}
              detail={item.entry?.providerLabel ?? item.selection.provider}
              title={`${item.selection.provider}/${item.selection.modelId}`}
              {model}
              selected={item.checked}
              onclick={() => toggle(item.selection, !item.checked)}
            >
              {#snippet trailing()}
                {#if item.stale}
                  <Badge variant="warning">Unavailable</Badge>
                {:else if model && (item.checked || scopeEmpty)}
                  {#if isDefault && modelSupportsReasoning(model)}
                    <Badge variant="accent" class="capitalize"
                      >{defaultThinkingLevel}</Badge
                    >
                  {/if}
                  <DefaultModelStar
                    {label}
                    {model}
                    {isDefault}
                    currentThinkingLevel={defaultThinkingLevel}
                    onSelect={(level) =>
                      onMakeDefault(item.selection, model, level)}
                  />
                {/if}
              {/snippet}
            </ModelCatalogRow>
          {/snippet}
        </VirtualScroller>
      {/if}
    </Tooltip.Provider>
  </div>

  <p
    class="flex items-center gap-1.5 border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground"
    data-tour-id="setup-scoped-models-default"
  >
    {#if scopeEmpty}
      Nothing checked — the composer offers every authenticated model.
    {:else}
      {scopedModels.length} scoped
    {/if}
    <span aria-hidden="true">·</span>
    <Star class="size-3" aria-hidden="true" />
    marks the default for new agents
  </p>
</div>
