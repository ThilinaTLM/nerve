<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleX from "@lucide/svelte/icons/circle-x";
import ShieldAlert from "@lucide/svelte/icons/shield-alert";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { SvelteSet } from "svelte/reactivity";
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import type { ToolView } from "../views/tool-result-view";
import type { QuickScriptArtifact } from "@nervekit/contracts/tools";
import { COLLAPSED_LINES } from "../views/tool-result-view";
import {
  formatDuration,
  operationLines,
} from "../views/tool-presentation-helpers";
import {
  NO_OUTPUT_TEXT,
  callEdit,
  editStatLabel,
  editStatParts,
  splitEditDiff,
  type QuickScriptCallEdit,
} from "../views/quick-script-calls";
import ToolOutputBlock from "./ToolOutputBlock.svelte";
import ToolSections from "./ToolSections.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "quick_script" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};
let { toolCall, view, expanded = false, onOpenFile }: Props = $props();

// The script itself is the card's persistent argument section. While the
// script runs, a collapsed card keeps the newest calls in view.
const hostCalls = $derived(
  expanded
    ? view.hostCalls
    : view.liveCalls
      ? view.hostCalls.slice(-COLLAPSED_LINES)
      : view.hostCalls.slice(0, COLLAPSED_LINES),
);
const hiddenCalls = $derived(view.hostCalls.length - hostCalls.length);
const firstShown = $derived(view.liveCalls && !expanded ? hiddenCalls : 0);
const scriptFailed = $derived(
  view.status !== undefined && view.status !== "completed",
);
// Before the script runs (and when it never did), the operations the scan found.
const plannedLines = $derived(
  view.hostCalls.length === 0 ? operationLines(view.plannedOperations) : [],
);
// What the agent received. A run that printed nothing returns a placeholder
// line, which the card words for the reader.
const output = $derived(view.output === NO_OUTPUT_TEXT ? "" : view.output);
const finished = $derived(
  view.status !== undefined || toolCall.status === "completed",
);
const hasSummary = $derived(
  view.hostCalls.length > 0 ||
    plannedLines.length > 0 ||
    view.artifacts.length > 0 ||
    view.created.length > 0 ||
    output.length > 0 ||
    finished,
);

// Artifact handles in call summaries become links that open the file in a tab;
// artifacts no call names are listed once after the calls.
const artifactsByHandle = $derived(
  new Map(view.artifacts.map((artifact) => [artifact.handle, artifact])),
);
const ARTIFACT_HANDLE = /(artifact:[A-Za-z0-9._-]+)/;
function summaryParts(text: string) {
  return text
    .split(ARTIFACT_HANDLE)
    .filter(Boolean)
    .map((part) => ({ text: part, artifact: artifactsByHandle.get(part) }));
}
// Exact handle tokens only: `artifact:a1` must not match `artifact:a10`.
const namedHandles = $derived(
  new Set(
    view.hostCalls.flatMap((call) =>
      summaryParts(call.summary ?? "").flatMap((part) =>
        part.artifact ? [part.artifact.handle] : [],
      ),
    ),
  ),
);
const unnamedArtifacts = $derived(
  view.artifacts.filter((artifact) => !namedHandles.has(artifact.handle)),
);

// Edit rows expand to their diff; keyed by call index.
const openEdits = new SvelteSet<number>();
function toggleEdit(index: number) {
  if (openEdits.has(index)) openEdits.delete(index);
  else openEdits.add(index);
}
</script>

{#snippet editDiff(edit: QuickScriptCallEdit)}
  {@const split = splitEditDiff(edit.diff)}
  {@const diffArtifact = edit.diffFile
    ? artifactsByHandle.get(edit.diffFile)
    : undefined}
  <div class="grid min-w-0 gap-1 pt-1 pb-0.5 pl-5.5">
    {#each split.files as file, fileIndex (fileIndex)}
      {#if file.path}
        <p class="m-0 font-mono text-ui text-muted-foreground wrap-anywhere">
          {file.path}
        </p>
      {/if}
      {#if file.diff}
        <ToolOutputBlock text={file.diff} language="diff" expanded />
      {/if}
    {/each}
    {#if split.cut}
      <p class="m-0 text-ui text-muted-foreground">
        Diff cut{#if edit.diffFile}; full diff:
          {#if diffArtifact}{@render artifactLink(diffArtifact)}{:else}<span
              class="font-mono">{edit.diffFile}</span
            >{/if}{/if}
      </p>
    {/if}
  </div>
{/snippet}

{#snippet artifactLink(artifact: QuickScriptArtifact)}
  <button
    type="button"
    class="cursor-pointer border-0 bg-transparent p-0 font-mono text-primary hover:text-primary-strong disabled:cursor-default disabled:text-muted-foreground"
    title="Open in a new tab"
    disabled={!onOpenFile}
    onclick={() => onOpenFile?.(artifact.path)}>{artifact.handle}</button
  >
{/snippet}

{#if hasSummary}
  <ToolSections>
    {#if plannedLines.length > 0}
      <ul class="m-0 list-none p-0 py-1" aria-label="Operations">
        {#each plannedLines as line, index (index)}
          <li
            class="min-w-0 truncate px-2.5 py-0.5 font-mono text-ui text-foreground"
            title={line}
          >
            {line}
          </li>
        {/each}
      </ul>
    {/if}

    {#if view.hostCalls.length > 0}
      <ul class="m-0 list-none p-0 py-1" aria-label="SDK calls">
        {#if firstShown > 0}
          <li class="px-2.5 py-0.5 text-caption text-muted-foreground">
            +{firstShown} earlier
          </li>
        {/if}
        {#each hostCalls as call, index (firstShown + index)}
          {@const edit = callEdit(call)}
          {@const editOpen = openEdits.has(firstShown + index)}
          <li class="min-w-0 px-2.5 py-0.5 text-ui">
            <div
              class="flex min-w-0 items-baseline gap-2"
              title={call.outcome === "running"
                ? undefined
                : [call.targets?.join(", "), call.error]
                    .filter(Boolean)
                    .join(" — ") || undefined}
            >
              {#if call.outcome === "running"}
                <Spinner
                  class="size-3.5 flex-none translate-y-0.5 text-muted-foreground"
                  aria-label="Running"
                />
              {:else if call.outcome === "completed"}
                <CircleCheck
                  class="size-3.5 flex-none translate-y-0.5 text-success"
                  aria-label="Completed"
                />
              {:else if call.outcome === "denied"}
                <ShieldAlert
                  class="size-3.5 flex-none translate-y-0.5 text-warning"
                  aria-label="Denied"
                />
              {:else}
                <CircleX
                  class="size-3.5 flex-none translate-y-0.5 text-destructive"
                  aria-label="Failed"
                />
              {/if}
              <span class="flex-none font-mono text-foreground"
                >{call.method}</span
              >
              <span class="min-w-0 flex-1 truncate text-muted-foreground">
                {#if call.outcome === "completed" || call.outcome === "running"}
                  {#each summaryParts(call.summary ?? "") as part, partIndex (partIndex)}
                    {#if part.artifact}
                      {@render artifactLink(part.artifact)}
                    {:else}{part.text}{/if}
                  {/each}
                {:else}{call.error ?? call.summary ?? ""}{/if}
              </span>
              {#if edit}
                {@const stat = editStatParts(edit)}
                <button
                  type="button"
                  class="flex flex-none cursor-pointer items-baseline gap-1.5 rounded-sm border-0 bg-transparent p-0 text-caption text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-focus"
                  aria-expanded={editOpen}
                  aria-label={`${editOpen ? "Hide" : "Show"} diff: ${editStatLabel(edit)}`}
                  title={editOpen ? "Hide diff" : "Show diff"}
                  onclick={() => toggleEdit(firstShown + index)}
                >
                  <span>{stat.files}</span>
                  <span class="text-success">{stat.added}</span>
                  <span class="text-destructive">{stat.removed}</span>
                  {#if stat.dryRun}<span class="text-info">dry run</span>{/if}
                  <ChevronRight
                    class={`size-3 self-center transition-transform ${editOpen ? "rotate-90" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              {/if}
              {#if call.outcome !== "running"}
                <span
                  class="flex-none text-caption text-muted-foreground tabular-nums"
                  >{formatDuration(call.durationMs)}</span
                >
              {/if}
            </div>
            {#if edit && editOpen}{@render editDiff(edit)}{/if}
          </li>
        {/each}
        {#if hiddenCalls > 0 && firstShown === 0}
          <li class="px-2.5 py-0.5 text-caption text-muted-foreground">
            +{hiddenCalls} more
          </li>
        {/if}
      </ul>
    {/if}

    {#if view.created.length > 0}
      <p
        class="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 px-2.5 py-1 text-ui text-muted-foreground"
      >
        <span>Created</span>
        <span class="min-w-0 text-foreground">{view.created.join(", ")}</span>
      </p>
    {/if}

    {#if unnamedArtifacts.length > 0}
      <p
        class="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 px-2.5 py-1 text-ui text-muted-foreground"
      >
        <span>Files</span>
        {#each unnamedArtifacts as artifact (artifact.handle)}
          {@render artifactLink(artifact)}
        {/each}
      </p>
    {/if}

    {#if output.length > 0}
      <div class="px-2.5 py-2" aria-label="Script output">
        <p class="m-0 mb-1 text-ui text-muted-foreground">Output</p>
        <ToolOutputBlock text={output} {expanded} />
      </div>
    {:else if scriptFailed}
      <p
        class="m-0 px-2.5 py-2 text-ui text-destructive [overflow-wrap:anywhere]"
      >
        {view.error ?? view.status?.replaceAll("_", " ")}
      </p>
    {:else if finished}
      <div
        class="px-2.5 py-2 text-ui text-muted-foreground"
        aria-label="Script output"
      >
        No output.
      </div>
    {/if}
  </ToolSections>
{/if}
