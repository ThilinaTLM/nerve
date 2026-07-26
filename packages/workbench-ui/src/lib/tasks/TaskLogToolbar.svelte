<script lang="ts">
import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
import Copy from "@lucide/svelte/icons/copy";
import Regex from "@lucide/svelte/icons/regex";
import Search from "@lucide/svelte/icons/search";
import WrapText from "@lucide/svelte/icons/wrap-text";
import X from "@lucide/svelte/icons/x";
import { untrack } from "svelte";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import {
  emptyTaskLogFilter,
  isTaskLogFilterActive,
  type TaskLogFilterState,
  type TaskLogLevelFilter,
  type TaskLogStreamFilter,
} from "./task-log-filter.js";

type Props = {
  filter: TaskLogFilterState;
  onFilterChange: (filter: TaskLogFilterState) => void;
  matchCount: number;
  totalCount: number;
  filterError?: string;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
  wrap: boolean;
  onWrapChange: (wrap: boolean) => void;
  onCopy?: () => void;
  canSearchHistory?: boolean;
  searchingHistory?: boolean;
  onSearchHistory?: () => void;
  historyNotice?: string;
  onBackToLive?: () => void;
};

let {
  filter,
  onFilterChange,
  matchCount,
  totalCount,
  filterError,
  follow,
  onFollowChange,
  wrap,
  onWrapChange,
  onCopy,
  canSearchHistory = false,
  searchingHistory = false,
  onSearchHistory,
  historyNotice,
  onBackToLive,
}: Props = $props();

let text = $state(untrack(() => filter.text));
let debounce: ReturnType<typeof setTimeout> | undefined;

function commitText(next: string) {
  text = next;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => onFilterChange({ ...filter, text: next }), 120);
}

$effect(() => () => {
  if (debounce) clearTimeout(debounce);
});

const levels: { value: TaskLogLevelFilter; label: string; title: string }[] = [
  { value: "all", label: "All", title: "Show every level" },
  { value: "warn", label: "Warn", title: "Warnings and errors" },
  { value: "error", label: "Error", title: "Errors only" },
];
const streams: { value: TaskLogStreamFilter; label: string; title: string }[] =
  [
    { value: "all", label: "Both", title: "Both output streams" },
    { value: "stdout", label: "Out", title: "Standard output" },
    { value: "stderr", label: "Err", title: "Standard error" },
  ];
const active = $derived(isTaskLogFilterActive(filter));
</script>

<div
  class="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5"
>
  <div class="relative min-w-40 flex-1">
    <Search
      class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
    />
    <Input
      size="sm"
      value={text}
      class="pl-7 text-xs"
      placeholder={filter.useRegex ? "Filter by regex" : "Filter output"}
      ariaLabel="Filter task output"
      oninput={(event) => commitText(event.currentTarget.value)}
    />
  </div>
  <Button
    size="icon-xs"
    variant={filter.useRegex ? "secondary" : "ghost"}
    ariaLabel="Use regular expression"
    title="Use regular expression"
    onclick={() => onFilterChange({ ...filter, useRegex: !filter.useRegex })}
    ><Regex class="size-3.5" /></Button
  >

  <div class="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
    {#each levels as option (option.value)}
      <Button
        size="xs"
        variant={filter.level === option.value ? "secondary" : "ghost"}
        title={option.title}
        onclick={() => onFilterChange({ ...filter, level: option.value })}
        >{option.label}</Button
      >
    {/each}
  </div>
  <div class="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
    {#each streams as option (option.value)}
      <Button
        size="xs"
        variant={filter.stream === option.value ? "secondary" : "ghost"}
        title={option.title}
        onclick={() => onFilterChange({ ...filter, stream: option.value })}
        >{option.label}</Button
      >
    {/each}
  </div>

  {#if filterError}
    <span class="truncate text-xs text-destructive" title={filterError}
      >Invalid pattern</span
    >
  {:else if active}
    <Badge tone="neutral" size="xs">{matchCount} / {totalCount}</Badge>
    <Button
      size="icon-xs"
      variant="ghost"
      ariaLabel="Clear filters"
      title="Clear filters"
      onclick={() => {
        text = "";
        onFilterChange({ ...emptyTaskLogFilter });
      }}><X class="size-3.5" /></Button
    >
  {/if}

  {#if historyNotice}
    <span class="truncate text-xs text-muted-foreground">{historyNotice}</span>
    <Button size="xs" variant="ghost" onclick={() => onBackToLive?.()}
      >Back to live output</Button
    >
  {:else if canSearchHistory}
    <Button
      size="xs"
      variant="ghost"
      disabled={searchingHistory}
      title="Search the full retained log on the server"
      onclick={() => onSearchHistory?.()}
      >{searchingHistory ? "Searching…" : "Search full history"}</Button
    >
  {/if}

  <div class="ml-auto flex items-center gap-0.5">
    <Button
      size="icon-xs"
      variant={follow ? "secondary" : "ghost"}
      ariaLabel="Follow new output"
      title="Follow new output"
      onclick={() => onFollowChange(!follow)}
      ><ArrowDownToLine class="size-3.5" /></Button
    >
    <Button
      size="icon-xs"
      variant={wrap ? "secondary" : "ghost"}
      ariaLabel="Wrap long lines"
      title="Wrap long lines"
      onclick={() => onWrapChange(!wrap)}><WrapText class="size-3.5" /></Button
    >
    <Button
      size="icon-xs"
      variant="ghost"
      ariaLabel="Copy visible output"
      title="Copy visible output"
      onclick={() => onCopy?.()}><Copy class="size-3.5" /></Button
    >
  </div>
</div>
