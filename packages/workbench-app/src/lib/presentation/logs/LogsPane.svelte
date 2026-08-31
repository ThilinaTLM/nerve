<script lang="ts">
import Box from "@lucide/svelte/icons/box";
import Copy from "@lucide/svelte/icons/copy";
import FilterX from "@lucide/svelte/icons/filter-x";
import Gauge from "@lucide/svelte/icons/gauge";
import RadioTower from "@lucide/svelte/icons/radio-tower";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Search from "@lucide/svelte/icons/search";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { SvelteSet } from "svelte/reactivity";
import type { ApplicationLogRecord } from "@nervekit/contracts/logs";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import {
  VirtualScroller,
  type VirtualScrollerController,
} from "@nervekit/ui-kit/components/composites/virtual-list";
import LogRow from "./LogRow.svelte";
import LogsFloatingToolbar from "./LogsFloatingToolbar.svelte";
import type {
  LogsLevelFilter,
  LogsPaneActions,
  LogsPaneModel,
  LogsSourceFilter,
} from "./logs-pane-types";

type LogsViewRow =
  | { kind: "log"; key: string; log: ApplicationLogRecord }
  | { kind: "status"; key: "status" };

type Props = {
  model: LogsPaneModel;
  actions: LogsPaneActions;
};

const levels: LogsLevelFilter[] = ["all", "debug", "info", "warn", "error"];
const sources: LogsSourceFilter[] = [
  "all",
  "orchestrator",
  "desktop",
  "web",
  "cli",
];

let { model, actions }: Props = $props();

let confirmPruneOpen = $state(false);
let findFocusRequest = $state(0);
let paneElement: HTMLElement | null = $state(null);
let selectedText = $state("");
let toolbarVisible = $state(false);
let virtualController = $state<VirtualScrollerController>();
let previousFirstId: string | undefined;
const expanded = new SvelteSet<string>();
const viewRows = $derived.by<LogsViewRow[]>(() => [
  ...model.rows.map((log): LogsViewRow => ({ kind: "log", key: log.id, log })),
  { kind: "status", key: "status" },
]);
const structureVersion = $derived(
  `${model.rows.length}:${model.rows[0]?.id ?? "empty"}:${model.rows.at(-1)?.id ?? "empty"}`,
);
const components = $derived(
  [...new Set(model.rows.map((log) => log.component))].sort((left, right) =>
    left.localeCompare(right),
  ),
);

function handleFindShortcut(event: KeyboardEvent): void {
  if (
    event.key.toLowerCase() !== "f" ||
    (!event.ctrlKey && !event.metaKey) ||
    event.altKey ||
    !paneElement ||
    paneElement.getClientRects().length === 0
  ) {
    return;
  }
  event.preventDefault();
  toolbarVisible = true;
  findFocusRequest += 1;
}

function captureSelection(): void {
  selectedText = window.getSelection()?.toString().trim() ?? "";
}

function toggleRow(id: string): void {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
}

async function prune(): Promise<void> {
  if (await actions.onPrune()) expanded.clear();
}

async function loadEarlier(): Promise<void> {
  if (model.loadingEarlier || !model.hasMoreBefore || model.historyError) {
    return;
  }
  await actions.onLoadEarlier();
}

function nearEnd(viewport: HTMLDivElement): boolean {
  return (
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 160
  );
}

$effect(() => {
  const viewport = virtualController?.getViewportElement();
  const canLoad = Boolean(model.hasMoreBefore && !model.historyError);
  if (!viewport || !canLoad) return;

  const handleScroll = () => {
    if (nearEnd(viewport)) void loadEarlier();
  };
  viewport.addEventListener("scroll", handleScroll, { passive: true });
  const frame = requestAnimationFrame(handleScroll);
  return () => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener("scroll", handleScroll);
  };
});

$effect(() => {
  const controller = virtualController;
  const firstId = model.rows[0]?.id;
  if (!firstId) {
    previousFirstId = undefined;
    return;
  }
  if (!controller || firstId === previousFirstId) return;
  const viewport = controller.getViewportElement();
  if (!viewport) return;

  previousFirstId = firstId;
  viewport.scrollTop = 0;
  const frame = requestAnimationFrame(() => {
    viewport.scrollTop = 0;
  });
  return () => cancelAnimationFrame(frame);
});

$effect(() => {
  const liveIds = new Set(model.rows.map((log) => log.id));
  for (const id of expanded) {
    if (!liveIds.has(id)) expanded.delete(id);
  }
});
</script>

<svelte:window onkeydown={handleFindShortcut} />

<ContextMenu.Root>
  <ContextMenu.Trigger
    class="block size-full select-text"
    oncontextmenu={captureSelection}
  >
    <section
      bind:this={paneElement}
      class="relative size-full min-h-0 overflow-hidden bg-background"
      role="log"
      aria-label="Application logs"
    >
      {#if toolbarVisible}
        <LogsFloatingToolbar
          contains={model.contains}
          rowCount={model.rows.length}
          loading={model.loading}
          focusRequest={findFocusRequest}
          onContainsChange={actions.onContainsChange}
          onClose={() => (toolbarVisible = false)}
        />
      {/if}

      {#if model.error}
        <div
          class={`pointer-events-none absolute inset-x-3 z-20 flex justify-center ${toolbarVisible ? "top-20" : "top-3"}`}
        >
          <div
            class="pointer-events-auto max-w-2xl rounded-md border border-destructive/40 bg-background px-2.5 py-2 text-sm text-destructive shadow-sm"
            role="alert"
          >
            {model.error}
          </div>
        </div>
      {/if}

      <VirtualScroller
        bind:controller={virtualController}
        items={viewRows}
        getKey={(row) => row.key}
        {structureVersion}
        getMeasurementVersion={(row) =>
          row.kind === "log"
            ? `${row.log.id}:${expanded.has(row.log.id)}`
            : `${model.loading}:${model.loadingEarlier}:${model.historyError}:${model.hasMoreBefore}`}
        heightCacheKey="application-logs"
        estimateSize={(index) => (index === viewRows.length - 1 ? 48 : 20)}
        overscan={16}
        anchor="start"
        paddingStart={toolbarVisible ? 76 : 12}
        paddingEnd={8}
        viewportTabIndex={0}
        viewportAriaLabel="Scrollable application logs"
        viewportClass="h-full"
      >
        {#snippet row({ item })}
          {#if item.kind === "log"}
            <LogRow
              log={item.log}
              open={expanded.has(item.log.id)}
              onToggle={() => toggleRow(item.log.id)}
            />
          {:else}
            <div
              class="grid min-h-12 place-items-center px-4 py-2 text-center text-xs text-muted-foreground"
            >
              {#if model.rows.length === 0 && model.loading}
                <span class="inline-flex items-center gap-2">
                  <Spinner class="size-3.5" />Loading logs…
                </span>
              {:else if model.rows.length === 0}
                <span>No application logs match these filters.</span>
              {:else if model.loadingEarlier}
                <span class="inline-flex items-center gap-2">
                  <Spinner class="size-3.5" />Loading older logs…
                </span>
              {:else if model.historyError}
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={actions.onLoadEarlier}
                >
                  Could not load older logs. Retry
                </Button>
              {:else if model.hasMoreBefore}
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={actions.onLoadEarlier}
                >
                  Load older logs
                </Button>
              {:else}
                <span>Beginning of retained logs</span>
              {/if}
            </div>
          {/if}
        {/snippet}
      </VirtualScroller>
    </section>
  </ContextMenu.Trigger>

  <ContextMenu.Content class="w-56">
    <ContextMenu.Item
      disabled={model.loading || model.pruning}
      onSelect={() => void actions.onRefresh()}
    >
      <RefreshCw />
      <span>Refresh</span>
    </ContextMenu.Item>
    <ContextMenu.CheckboxItem
      checked={toolbarVisible}
      onCheckedChange={(checked) => (toolbarVisible = checked)}
    >
      <Search />
      <span>Find in logs</span>
    </ContextMenu.CheckboxItem>

    <ContextMenu.Sub>
      <ContextMenu.SubTrigger class="gap-2">
        <Gauge />
        <span class="flex flex-1 items-center justify-between gap-3">
          <span>Level</span>
          <span class="text-xs capitalize text-muted-foreground">
            {model.level}
          </span>
        </span>
      </ContextMenu.SubTrigger>
      <ContextMenu.SubContent class="w-40">
        <ContextMenu.RadioGroup
          value={model.level}
          onValueChange={(value) =>
            actions.onLevelChange(value as LogsLevelFilter)}
        >
          {#each levels as level (level)}
            <ContextMenu.RadioItem value={level} class="capitalize">
              {level}
            </ContextMenu.RadioItem>
          {/each}
        </ContextMenu.RadioGroup>
      </ContextMenu.SubContent>
    </ContextMenu.Sub>

    <ContextMenu.Sub>
      <ContextMenu.SubTrigger class="gap-2">
        <RadioTower />
        <span class="flex flex-1 items-center justify-between gap-3">
          <span>Source</span>
          <span class="text-xs capitalize text-muted-foreground">
            {model.source}
          </span>
        </span>
      </ContextMenu.SubTrigger>
      <ContextMenu.SubContent class="w-44">
        <ContextMenu.RadioGroup
          value={model.source}
          onValueChange={(value) =>
            actions.onSourceChange(value as LogsSourceFilter)}
        >
          {#each sources as source (source)}
            <ContextMenu.RadioItem value={source} class="capitalize">
              {source}
            </ContextMenu.RadioItem>
          {/each}
        </ContextMenu.RadioGroup>
      </ContextMenu.SubContent>
    </ContextMenu.Sub>

    <ContextMenu.Sub>
      <ContextMenu.SubTrigger class="gap-2">
        <Box />
        <span class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>Component</span>
          <span class="max-w-24 truncate text-xs text-muted-foreground">
            {model.component || "All"}
          </span>
        </span>
      </ContextMenu.SubTrigger>
      <ContextMenu.SubContent class="max-h-80 w-52 overflow-y-auto">
        <ContextMenu.RadioGroup
          value={model.component || "all"}
          onValueChange={(value) =>
            actions.onComponentChange(value === "all" ? "" : value)}
        >
          <ContextMenu.RadioItem value="all">All</ContextMenu.RadioItem>
          {#each components as component (component)}
            <ContextMenu.RadioItem value={component}>
              <span class="truncate">{component}</span>
            </ContextMenu.RadioItem>
          {/each}
        </ContextMenu.RadioGroup>
      </ContextMenu.SubContent>
    </ContextMenu.Sub>

    {#if model.filtersActive}
      <ContextMenu.Item onSelect={actions.onClearFilters}>
        <FilterX />
        <span>Clear filters</span>
      </ContextMenu.Item>
    {/if}

    <ContextMenu.Item
      disabled={!selectedText}
      onSelect={() => void actions.onCopySelection(selectedText)}
    >
      <Copy />
      <span>Copy selection</span>
    </ContextMenu.Item>
    <ContextMenu.Item
      disabled={model.rows.length === 0}
      onSelect={() => void actions.onCopy()}
    >
      <Copy />
      <span>Copy loaded logs</span>
    </ContextMenu.Item>
    <ContextMenu.Item
      variant="destructive"
      disabled={model.loading || model.pruning}
      onSelect={() => (confirmPruneOpen = true)}
    >
      <Trash2 />
      <span
        >{model.filtersActive ? "Prune matching logs" : "Prune all logs"}</span
      >
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>

<ConfirmDialog
  bind:open={confirmPruneOpen}
  title={model.filtersActive ? "Prune matching logs?" : "Prune all logs?"}
  description={model.pruneDescription}
  confirmLabel={model.filtersActive ? "Prune matching logs" : "Prune all logs"}
  destructive
  onConfirm={() => void prune()}
/>
