<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import FilterX from "@lucide/svelte/icons/filter-x";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Tag from "@lucide/svelte/icons/tag";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type {
  ApplicationLogLevel,
  ApplicationLogSource,
} from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { logLevelTone } from "@nervekit/ui-kit/core/utils/status";
import type {
  LogsLevelFilter,
  LogsPaneActions,
  LogsSourceFilter,
} from "./logs-pane-types";

const levels: LogsLevelFilter[] = ["all", "debug", "info", "warn", "error"];
const sources: LogsSourceFilter[] = [
  "all",
  "orchestrator",
  "desktop",
  "web",
  "cli",
];

type LogsToolbarActions = Omit<LogsPaneActions, "onPrune"> & {
  onPrune: () => void;
};

type Props = {
  level: LogsLevelFilter;
  source: LogsSourceFilter;
  component: string;
  contains: string;
  rowCount: number;
  filtersActive: boolean;
  loading: boolean;
  pruning: boolean;
  actions: LogsToolbarActions;
};

let {
  level,
  source,
  component,
  contains,
  rowCount,
  filtersActive,
  loading,
  pruning,
  actions,
}: Props = $props();
</script>

<header
  class="sticky top-0 z-10 grid gap-2 border-b border-border bg-card px-3 py-2.5"
>
  <div class="flex flex-wrap items-center gap-2">
    <ToggleGroup.Root
      type="single"
      size="xs"
      spacing={1}
      variant="outline"
      value={level}
      aria-label="Log level filter"
      onValueChange={(value) => {
        if (value) actions.onLevelChange(value as ApplicationLogLevel | "all");
      }}
    >
      {#each levels as option (option)}
        <ToggleGroup.Item value={option} class="gap-1 capitalize">
          {#if option !== "all"}
            <StatusDot size="xs" tone={logLevelTone(option)} />
          {/if}
          {option}
        </ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>

    <span class="h-5 w-px bg-border" aria-hidden="true"></span>

    <ToggleGroup.Root
      type="single"
      size="xs"
      spacing={1}
      variant="outline"
      value={source}
      aria-label="Log source filter"
      onValueChange={(value) => {
        if (value)
          actions.onSourceChange(value as ApplicationLogSource | "all");
      }}
    >
      {#each sources as option (option)}
        <ToggleGroup.Item value={option} class="capitalize">
          {option}
        </ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>

    <div class="ml-auto flex items-center gap-1.5">
      <span class="text-xs tabular-nums text-muted-foreground">
        {rowCount}
        {rowCount === 1 ? "entry" : "entries"}
      </span>
      {#if filtersActive}
        <Button size="sm" variant="ghost" onclick={actions.onClearFilters}>
          <FilterX class="size-3.5" aria-hidden="true" />Clear
        </Button>
      {/if}
      <Button
        size="sm"
        variant="secondary"
        onclick={actions.onRefresh}
        disabled={loading || pruning}
      >
        {#if loading}
          <Spinner class="size-3.5" />
        {:else}
          <RefreshCw class="size-3.5" aria-hidden="true" />
        {/if}
        {loading ? "Loading" : "Refresh"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onclick={actions.onCopy}
        disabled={rowCount === 0 || pruning}
      >
        <Copy class="size-3.5" aria-hidden="true" />Copy
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onclick={actions.onPrune}
        disabled={loading || pruning}
      >
        <Trash2 class="size-3.5" aria-hidden="true" />
        {pruning ? "Pruning" : "Prune"}
      </Button>
    </div>
  </div>

  <div class="flex flex-nowrap items-center gap-2">
    <SearchInput
      value={contains}
      class="basis-3/5"
      placeholder="Search messages"
      ariaLabel="Search messages"
      onValueChange={actions.onContainsChange}
    />
    <SearchInput
      value={component}
      class="basis-2/5"
      icon={Tag}
      placeholder="Component filter"
      ariaLabel="Component filter"
      onValueChange={actions.onComponentChange}
    />
  </div>
</header>
