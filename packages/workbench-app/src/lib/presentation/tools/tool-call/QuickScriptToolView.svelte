<script lang="ts">
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleX from "@lucide/svelte/icons/circle-x";
import ShieldAlert from "@lucide/svelte/icons/shield-alert";
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import type { ToolView } from "../views/tool-result-view";
import type { QuickScriptArtifact } from "@nervekit/contracts/tools";
import { COLLAPSED_LINES } from "../views/tool-result-view";
import {
  formatDuration,
  operationLines,
} from "../views/tool-presentation-helpers";
import { cn } from "@nervekit/ui-kit/utils";
import ToolSections from "./ToolSections.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "quick_script" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};
let { view, expanded = false, onOpenFile }: Props = $props();

// The script itself is the card's persistent argument section.
const hostCalls = $derived(
  expanded ? view.hostCalls : view.hostCalls.slice(0, COLLAPSED_LINES),
);
const hiddenCalls = $derived(view.hostCalls.length - hostCalls.length);
const scriptFailed = $derived(
  view.status !== undefined && view.status !== "completed",
);
// Before the script runs (and when it never did), the operations the scan found.
const plannedLines = $derived(
  view.hostCalls.length === 0 ? operationLines(view.plannedOperations) : [],
);
const hasSummary = $derived(
  view.hostCalls.length > 0 ||
    plannedLines.length > 0 ||
    view.pages.length > 0 ||
    view.artifacts.length > 0 ||
    view.created.length > 0 ||
    scriptFailed,
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

function pageLintLabel(fixes: number, warnings: number): string {
  if (warnings > 0)
    return `${warnings} lint warning${warnings === 1 ? "" : "s"}`;
  return fixes > 0 ? `lint fixed ${fixes}` : "lint clean";
}
</script>

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
        {#each hostCalls as call, index (index)}
          <li
            class="flex min-w-0 items-baseline gap-2 px-2.5 py-0.5 text-ui"
            title={[call.targets?.join(", "), call.error]
              .filter(Boolean)
              .join(" — ") || undefined}
          >
            {#if call.outcome === "completed"}
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
              {#if call.outcome === "completed"}
                {#each summaryParts(call.summary ?? "") as part, partIndex (partIndex)}
                  {#if part.artifact}
                    {@render artifactLink(part.artifact)}
                  {:else}{part.text}{/if}
                {/each}
              {:else}{call.error ?? call.summary ?? ""}{/if}
            </span>
            <span
              class="flex-none text-caption text-muted-foreground tabular-nums"
              >{formatDuration(call.durationMs)}</span
            >
          </li>
        {/each}
        {#if hiddenCalls > 0}
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

    {#if view.pages.length > 0}
      <ul class="m-0 list-none p-0 py-1" aria-label="Pages written">
        {#each view.pages as page (page.id)}
          <li class="px-2.5 py-0.5 text-ui">
            <div class="flex min-w-0 items-baseline gap-2">
              <span class="flex-none text-muted-foreground">{page.action}</span>
              <span class="min-w-0 flex-1 truncate text-foreground"
                >{page.title}</span
              >
              <span
                class={cn(
                  "flex-none text-caption",
                  page.warnings.length > 0
                    ? "text-warning"
                    : "text-muted-foreground",
                )}
                >{pageLintLabel(page.fixes.length, page.warnings.length)}</span
              >
            </div>
            {#each page.warnings as warning, index (index)}
              <p
                class="m-0 pl-4 text-caption text-warning [overflow-wrap:anywhere]"
              >
                {warning}
              </p>
            {/each}
          </li>
        {/each}
      </ul>
    {/if}

    {#if scriptFailed}
      <p
        class="m-0 px-2.5 py-2 text-ui text-destructive [overflow-wrap:anywhere]"
      >
        {view.error ?? view.status?.replaceAll("_", " ")}
      </p>
    {/if}
  </ToolSections>
{/if}
