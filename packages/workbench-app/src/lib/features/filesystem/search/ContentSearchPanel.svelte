<script lang="ts">
import CaseSensitive from "@lucide/svelte/icons/case-sensitive";
import EyeOff from "@lucide/svelte/icons/eye-off";
import Regex from "@lucide/svelte/icons/regex";
import Search from "@lucide/svelte/icons/search";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import WholeWord from "@lucide/svelte/icons/whole-word";
import X from "@lucide/svelte/icons/x";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import {
  PanelEmpty,
  PanelHeader,
  PanelToolbarButton,
  PanelTree,
  PanelView,
  buildPanelItemTree,
} from "$lib/presentation/panels";
import {
  formatSearchPatternError,
  type SearchPatternError,
} from "./content-search-error";
import { segmentsFromRanges } from "../highlight-segments";
import { MaterialFileIcon } from "$lib/presentation/files";
import type { ContentSearchStatus } from "./content-search-controller.svelte";
import {
  buildSearchResultItems,
  countMatches,
  type SearchResultItem,
} from "./content-search-results";
import type { FilesystemProjectContentSearchResponse } from "@nervekit/contracts/filesystem";

let {
  hasProject,
  query = $bindable(""),
  regex = $bindable(false),
  caseSensitive = $bindable(false),
  wholeWord = $bindable(false),
  includeIgnored = $bindable(false),
  include = $bindable(""),
  exclude = $bindable(""),
  showFilters = $bindable(false),
  status,
  response,
  error,
  patternError,
  inputRef = $bindable(null),
  onChange,
  onSubmit,
  onClear,
  onOpenMatch,
}: {
  hasProject: boolean;
  query?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  includeIgnored?: boolean;
  include?: string;
  exclude?: string;
  showFilters?: boolean;
  status: ContentSearchStatus;
  response?: FilesystemProjectContentSearchResponse;
  error?: string;
  /** Invalid query pattern, reported inline under the field. */
  patternError?: SearchPatternError;
  inputRef?: HTMLInputElement | null;
  /** Any input or option changed. */
  onChange: () => void;
  /** Enter pressed in a field: search now. */
  onSubmit: () => void;
  onClear: () => void;
  onOpenMatch: (path: string, line: number) => void;
} = $props();

const patternErrorId = $props.id();
const items = $derived(buildSearchResultItems(response?.files ?? []));
const nodes = $derived(
  buildPanelItemTree(items, {
    getKey: (item) => item.key,
    getParentKey: (item) => item.parentKey,
    getLabel: (item) => (item.type === "file" ? item.path : item.text),
  }),
);
const matchCount = $derived(countMatches(response?.files ?? []));
const fileCount = $derived(response?.files.length ?? 0);

const toggles = $derived(
  [
    regex && "regex",
    caseSensitive && "case",
    wholeWord && "word",
    includeIgnored && "ignored",
  ].filter((value): value is string => Boolean(value)),
);

function setToggles(values: string[]): void {
  regex = values.includes("regex");
  caseSensitive = values.includes("case");
  wholeWord = values.includes("word");
  includeIgnored = values.includes("ignored");
  onChange();
}

function submitOnEnter(event: KeyboardEvent): void {
  if (event.key !== "Enter") return;
  event.preventDefault();
  onSubmit();
}

function splitPath(path: string): { name: string; directory: string } {
  const slash = path.lastIndexOf("/");
  return { name: path.slice(slash + 1), directory: path.slice(0, slash + 1) };
}

function activate(item: SearchResultItem): void {
  if (item.type === "match") onOpenMatch(item.path, item.line);
}
</script>

{#snippet header()}
  <PanelHeader title="Search">
    {#snippet trailing()}
      <PanelToolbarButton
        icon={SlidersHorizontal}
        label="Files to include or exclude"
        active={showFilters}
        onclick={() => (showFilters = !showFilters)}
      />
      <PanelToolbarButton
        icon={X}
        label="Clear search"
        disabled={query === "" && !response}
        onclick={onClear}
      />
    {/snippet}
  </PanelHeader>
  <div class="grid gap-1.5 pb-2">
    <SearchInput
      bind:value={query}
      bind:ref={inputRef}
      placeholder="Search in files"
      ariaLabel="Search in files"
      invalid={patternError !== undefined}
      describedBy={patternError ? patternErrorId : undefined}
      onValueChange={() => onChange()}
      onkeydown={submitOnEnter}
    />
    {#if patternError}
      <p id={patternErrorId} class="text-caption text-destructive" role="alert">
        {formatSearchPatternError(patternError)}
      </p>
    {/if}
    <ToggleGroup.Root
      type="multiple"
      variant="chip"
      size="sm"
      aria-label="Search options"
      value={toggles}
      onValueChange={setToggles}
    >
      <ToggleGroup.Item value="case" aria-label="Match case" title="Match case">
        <CaseSensitive aria-hidden="true" />
      </ToggleGroup.Item>
      <ToggleGroup.Item
        value="word"
        aria-label="Match whole word"
        title="Match whole word"
      >
        <WholeWord aria-hidden="true" />
      </ToggleGroup.Item>
      <ToggleGroup.Item
        value="regex"
        aria-label="Use regular expression"
        title="Use regular expression"
      >
        <Regex aria-hidden="true" />
      </ToggleGroup.Item>
      <ToggleGroup.Item
        value="ignored"
        aria-label="Include ignored files"
        title="Include ignored files"
      >
        <EyeOff aria-hidden="true" />
      </ToggleGroup.Item>
    </ToggleGroup.Root>
    {#if showFilters}
      <Input
        bind:value={include}
        ariaLabel="Files to include"
        placeholder="Files to include (src/**, *.ts)"
        oninput={() => onChange()}
        onkeydown={submitOnEnter}
      />
      <Input
        bind:value={exclude}
        ariaLabel="Files to exclude"
        placeholder="Files to exclude (**/*.test.ts)"
        oninput={() => onChange()}
        onkeydown={submitOnEnter}
      />
    {/if}
  </div>
{/snippet}

{#snippet highlighted(text: string, ranges: Array<[number, number]>)}
  {#each segmentsFromRanges(text, ranges) as segment, index (index)}
    {#if segment.match}
      <mark class="rounded-sm bg-warning-subtle text-foreground"
        >{segment.text}</mark
      >{:else}{segment.text}{/if}
  {/each}
{/snippet}

<PanelView banner={header}>
  {#if !hasProject}
    <PanelEmpty
      icon={Search}
      title="No project selected"
      description="Select a project to search its files."
    />
  {:else if status === "error"}
    <PanelEmpty
      icon={TriangleAlert}
      title="Search failed"
      description={error}
    />
  {:else if status === "idle" && !response}
    <PanelEmpty
      icon={Search}
      title="Search in files"
      description="Type to search file contents in this project."
    />
  {:else if !response}
    <div class="flex min-h-24 items-center justify-center">
      <Spinner class="size-4 text-muted-foreground" />
    </div>
  {:else}
    <div
      class="flex h-6 shrink-0 items-center gap-1.5 text-caption text-muted-foreground"
      aria-live="polite"
    >
      {#if status === "searching"}<Spinner class="size-3" />{/if}
      <span class="truncate">
        {#if matchCount === 0}
          No results
        {:else}
          {matchCount}{response.truncated ? "+" : ""}
          {matchCount === 1 ? "result" : "results"} in {fileCount}
          {fileCount === 1 ? "file" : "files"}
        {/if}
      </span>
    </div>
    {#if response.truncated}
      <Callout layout="strip" tone="warning" class="mb-1">
        Showing the first results only. Narrow the query or add file filters.
      </Callout>
    {/if}
    {#if matchCount === 0}
      <PanelEmpty
        icon={Search}
        title="No results"
        description={`Nothing matched in ${response.searchedFiles} searched ${response.searchedFiles === 1 ? "file" : "files"}.`}
      />
    {:else}
      <PanelTree
        {nodes}
        ariaLabel="Search results"
        virtualized
        showDisclosure
        getItemTitle={(item) =>
          item.type === "file" ? item.path : `${item.path}:${item.line}`}
        onItemActivate={activate}
      >
        {#snippet itemLeading(item)}
          {#if item.type === "file"}
            <MaterialFileIcon name={splitPath(item.path).name} kind="file" />
          {/if}
        {/snippet}
        {#snippet itemLabel(item)}
          {#if item.type === "file"}
            {@const parts = splitPath(item.path)}
            <span class="text-foreground">{parts.name}</span>
            <span class="text-muted-foreground"> {parts.directory}</span>
          {:else}
            <span class="font-mono"
              >{@render highlighted(item.text, item.ranges)}</span
            >
          {/if}
        {/snippet}
        {#snippet itemBadges(item)}
          {#if item.type === "file"}
            <span class="text-caption text-muted-foreground">{item.count}</span>
          {:else}
            <span class="text-caption text-muted-foreground">{item.line}</span>
          {/if}
        {/snippet}
      </PanelTree>
    {/if}
  {/if}
</PanelView>
