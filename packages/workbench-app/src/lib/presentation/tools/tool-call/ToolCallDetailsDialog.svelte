<script lang="ts">
import { onDestroy } from "svelte";
import Check from "@lucide/svelte/icons/check";
import Copy from "@lucide/svelte/icons/copy";
import ExternalLink from "@lucide/svelte/icons/external-link";
import WrapText from "@lucide/svelte/icons/wrap-text";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import * as Tabs from "@nervekit/ui-kit/components/ui/tabs";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { GroupLabel } from "@nervekit/ui-kit/components/composites/group-label";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { writeClipboardText } from "@nervekit/ui-kit/browser/clipboard";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { cn } from "@nervekit/ui-kit/utils";
import type {
  ToolCallDetails,
  ToolCallTranscriptRecord,
} from "../../state/tool-types";
import CardSheet from "../../cards/CardSheet.svelte";
import MetaChip from "../../cards/MetaChip.svelte";
import StatusGlyph from "../../cards/StatusGlyph.svelte";
import { toolPresentationCached } from "../views/tool-presentation";
import {
  formatBytes,
  formatDuration,
} from "../views/tool-presentation-helpers";
import { parseToolViewCached } from "../views/tool-result-view";
import { toolViewComponent } from "../views/registry";
import { getConversationUiCapabilities } from "../../context.svelte";
import AgentPreviewSection from "./AgentPreviewSection.svelte";
import ArgumentsSection from "./ArgumentsSection.svelte";
import CompleteResultSection from "./CompleteResultSection.svelte";
import {
  agentPreviewText,
  availableToolDetailSections,
  hasFormattedToolView,
  initialToolDetailSection,
  resolveToolDetailSection,
  serializeToolArguments,
  type ToolDetailSection,
} from "./tool-details-state";

type Props = {
  open?: boolean;
  previewToolCall: ToolCallTranscriptRecord;
  details?: ToolCallDetails;
  loading?: boolean;
  error?: string;
  onOpenFile?: (path: string, line?: number) => void;
  onRetry?: () => void | Promise<void>;
  onOpenChange?: (open: boolean) => void;
};

let {
  open = $bindable(false),
  previewToolCall,
  details,
  loading = false,
  error,
  onOpenFile,
  onRetry,
  onOpenChange,
}: Props = $props();

const SECTION_LABELS: Record<ToolDetailSection, string> = {
  formatted: "Output",
  "agent-preview": "Agent preview",
  arguments: "Arguments",
  "complete-result": "Raw result",
};
const COMMAND_CLAMP_CHARS = 300;

const capabilities = getConversationUiCapabilities();
const displayToolCall = $derived(details?.toolCall ?? previewToolCall);
const view = $derived(parseToolViewCached(displayToolCall));
const presentation = $derived(toolPresentationCached(view, displayToolCall));
const ToolView = $derived(toolViewComponent(view.kind));
const hasStoredPreview = $derived(displayToolCall.resultPreview !== undefined);
const formatted = $derived(
  Boolean(details && hasFormattedToolView(view, hasStoredPreview)),
);
const completeResult = $derived(details?.completeResult);
const sections = $derived(
  availableToolDetailSections({
    formatted,
    agentPreview: details?.toolCall.agentPreview !== undefined,
    arguments: details?.toolCall.args !== undefined,
    completeResult: Boolean(completeResult?.hasResult),
  }),
);

let chosenSection = $state<ToolDetailSection | undefined>(undefined);
const activeSection = $derived(
  resolveToolDetailSection(
    sections,
    chosenSection,
    initialToolDetailSection(view, hasStoredPreview),
  ),
);
// The raw result loads on first visit and then stays mounted.
let rawVisited = $state(false);
$effect(() => {
  if (activeSection === "complete-result") rawVisited = true;
});

let wrap = $state(true);
let commandExpanded = $state(false);
let rawText = $state("");

// The command block is only for tools whose primary input is a script.
const command = $derived(
  view.kind === "bash"
    ? { label: "Command", text: view.command ?? "" }
    : view.kind === "python"
      ? { label: "Code", text: view.code ?? "" }
      : undefined,
);
const commandLong = $derived(
  Boolean(command) &&
    (command!.text.split("\n").length > 3 ||
      command!.text.length > COMMAND_CLAMP_CHARS),
);

const exitCode = $derived(
  view.kind === "bash" || view.kind === "python" ? view.exitCode : undefined,
);
const statusBadge = $derived<{ text: string; tone: StatusTone }>(
  exitCode !== undefined
    ? {
        text: `exit ${exitCode}`,
        tone: exitCode === 0 ? "success" : "destructive",
      }
    : { text: displayToolCall.status, tone: presentation.dotTone },
);

const description = $derived.by(() => {
  const text = command
    ? displayToolCall.cwd
    : (presentation.primaryArg?.text ?? displayToolCall.cwd);
  const firstLine = text?.split("\n", 1)[0] ?? "";
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine;
});

const openPath = $derived(presentation.primaryArg?.openPath);
const openLine = $derived(presentation.primaryArg?.line);

const agentText = $derived(agentPreviewText(details?.toolCall.agentPreview));
const resultText = $derived(
  view.kind === "bash" || view.kind === "python" ? view.output : agentText,
);
const argumentsText = $derived(
  serializeToolArguments(details?.toolCall.args).text,
);
const paneText = $derived(
  activeSection === "formatted"
    ? resultText
    : activeSection === "agent-preview"
      ? agentText
      : activeSection === "arguments"
        ? argumentsText
        : activeSection === "complete-result"
          ? rawText
          : "",
);
const wrappable = $derived(
  activeSection !== undefined && activeSection !== "formatted",
);

const footerMeta = $derived.by(() => {
  const execution = displayToolCall.execution;
  const elapsed =
    execution?.startedAt && execution.endedAt
      ? Date.parse(execution.endedAt) - Date.parse(execution.startedAt)
      : Number.NaN;
  const duration = elapsed >= 0 ? formatDuration(elapsed) : undefined;
  const lines =
    (view.kind === "bash" || view.kind === "python") && view.outputLineCount > 0
      ? `${view.outputLineCount.toLocaleString()} ${view.outputLineCount === 1 ? "line" : "lines"}`
      : undefined;
  const age = relativeTimeLabel(displayToolCall.updatedAt);
  return [
    duration,
    lines,
    age ? (age === "now" ? "just now" : `${age} ago`) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
});

// Card chips that carry information the footer text does not (truncated,
// LLM-trimmed, saved files...). Exit, duration and line counts are already
// shown in the title badge and footer meta.
const extraMeta = $derived(
  presentation.meta.filter(
    (item) =>
      item.text !== statusBadge.text &&
      !/^exit \d+$/.test(item.text) &&
      !/^[\d,]+ lines?$/.test(item.text) &&
      !/^\d[\d.]*\s?(ms|s|m|h)\b/.test(item.text),
  ),
);

let copiedKey = $state<string | undefined>(undefined);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
onDestroy(() => clearTimeout(copiedTimer));

async function copy(key: string, text: string): Promise<void> {
  if (!text) return;
  try {
    await writeClipboardText(text);
  } catch {
    return;
  }
  copiedKey = key;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copiedKey = undefined), 1600);
}
</script>

{#snippet leading()}
  <StatusGlyph
    tone={presentation.dotTone}
    pulse={presentation.dotPulse}
    glyph={presentation.glyph}
    label={displayToolCall.status}
    size={16}
  />
{/snippet}

{#snippet titleExtra()}
  <Badge variant={statusBadge.tone} class="font-mono">{statusBadge.text}</Badge>
{/snippet}

{#snippet headerActions()}
  {#if details && resultText}
    <IconAction
      icon={copiedKey === "result" ? Check : Copy}
      label={copiedKey === "result" ? "Copied" : "Copy result"}
      onclick={() => void copy("result", resultText)}
    />
  {/if}
{/snippet}

{#snippet footer()}
  <span class="text-ui text-muted-foreground">{footerMeta}</span>
  {#each extraMeta as item, index (index)}
    <MetaChip {item} {onOpenFile} />
  {/each}
  <span class="flex-1"></span>
  <button
    type="button"
    class="flex min-w-0 items-center gap-1 rounded-sm text-ui text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-focus"
    title="Copy tool call id"
    aria-label={`Copy tool call id ${displayToolCall.id}`}
    onclick={() => void copy("id", displayToolCall.id)}
  >
    <span class="truncate font-mono">{displayToolCall.id}</span>
    {#if copiedKey === "id"}
      <Check class="size-3 shrink-0 text-success" aria-hidden="true" />
    {:else}
      <Copy class="size-3 shrink-0" aria-hidden="true" />
    {/if}
  </button>
{/snippet}

<DialogShell
  bind:open
  title={displayToolCall.toolName}
  {description}
  size="wide"
  flush={Boolean(details)}
  class={details ? "h-[min(40rem,calc(100dvh-2rem))]" : undefined}
  {leading}
  {titleExtra}
  headerActions={details ? headerActions : undefined}
  footer={details ? footer : undefined}
  {onOpenChange}
>
  {#if loading && !details}
    <div
      class="flex min-h-40 items-center justify-center text-ui text-muted-foreground"
    >
      Loading tool details…
    </div>
  {:else if error && !details}
    <div class="grid gap-3">
      <p class="m-0 text-ui text-destructive">{error}</p>
      <Button variant="outline" class="w-fit" onclick={() => void onRetry?.()}
        >Retry</Button
      >
    </div>
  {:else if details}
    <div class="flex h-full min-h-0 flex-col gap-3 p-3">
      {#if command && command.text}
        <section class="grid gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <GroupLabel label={command.label} />
            <div class="flex items-center gap-1">
              {#if commandLong}
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-muted-foreground"
                  aria-expanded={commandExpanded}
                  onclick={() => (commandExpanded = !commandExpanded)}
                  >{commandExpanded ? "Show less" : "Show all"}</Button
                >
              {/if}
              <IconAction
                icon={copiedKey === "command" ? Check : Copy}
                label={copiedKey === "command"
                  ? "Copied"
                  : `Copy ${command.label.toLowerCase()}`}
                onclick={() => void copy("command", command.text)}
              />
            </div>
          </div>
          <div class="rounded-md border bg-well px-2.5 py-2">
            <pre
              class={cn(
                "m-0 font-mono text-ui break-all whitespace-pre-wrap",
                !commandExpanded && "line-clamp-3",
              )}>{command.text}</pre>
          </div>
        </section>
      {/if}

      {#if displayToolCall.error}
        <Callout tone="destructive" text={displayToolCall.error} />
      {/if}

      {#if activeSection}
        <Tabs.Root
          value={activeSection}
          onValueChange={(next) => (chosenSection = next as ToolDetailSection)}
          class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border"
        >
          <div class="flex items-stretch">
            <Tabs.List class="flex-1">
              {#each sections as section (section)}
                <Tabs.Trigger value={section} class="data-active:bg-well">
                  {SECTION_LABELS[section]}
                  {#if section === "complete-result" && completeResult}
                    <span class="text-muted-foreground"
                      >{formatBytes(completeResult.byteLength)}</span
                    >
                  {/if}
                </Tabs.Trigger>
              {/each}
            </Tabs.List>
            <div
              class="flex items-center gap-1 bg-chrome-track px-1.5 shadow-[inset_0_-1px_0_var(--color-border)]"
            >
              {#if wrappable}
                <IconAction
                  icon={WrapText}
                  label="Wrap lines"
                  active={wrap}
                  onclick={() => (wrap = !wrap)}
                />
              {/if}
              <IconAction
                icon={copiedKey === "pane" ? Check : Copy}
                label={copiedKey === "pane" ? "Copied" : "Copy"}
                disabled={!paneText}
                onclick={() => void copy("pane", paneText)}
              />
              {#if openPath && onOpenFile}
                <IconAction
                  icon={ExternalLink}
                  label="Open in editor"
                  onclick={() => onOpenFile(openPath, openLine)}
                />
              {/if}
            </div>
          </div>
          <div class="min-h-0 flex-1 overflow-auto bg-well">
            {#each sections as section (section)}
              <Tabs.Content value={section}>
                {#if section !== activeSection && !(section === "complete-result" && rawVisited)}
                  <!-- Inactive panes stay unmounted; the raw result keeps its loaded chunks. -->
                {:else if section === "formatted"}
                  <!-- The pane is the sheet; views join it without their own frame. -->
                  <CardSheet class="rounded-none border-0">
                    <ToolView
                      toolCall={details.toolCall}
                      {view}
                      expanded={true}
                      {onOpenFile}
                    />
                  </CardSheet>
                {:else if section === "agent-preview"}
                  <AgentPreviewSection
                    preview={details.toolCall.agentPreview}
                    projection={details.toolCall.agentProjection}
                    result={details.toolCall.result}
                    {wrap}
                  />
                {:else if section === "arguments"}
                  <ArgumentsSection value={details.toolCall.args} {wrap} />
                {:else if completeResult && rawVisited}
                  <CompleteResultSection
                    toolCallId={details.toolCall.id}
                    descriptor={completeResult}
                    read={capabilities.readToolCallResult}
                    {wrap}
                    onTextChange={(text) => (rawText = text)}
                  />
                {/if}
              </Tabs.Content>
            {/each}
          </div>
        </Tabs.Root>
      {:else if !displayToolCall.error}
        <Empty.Root class="border">
          <Empty.Header>
            <Empty.Title>No details retained</Empty.Title>
            <Empty.Description
              >This tool call has no output or arguments to show.</Empty.Description
            >
          </Empty.Header>
        </Empty.Root>
      {/if}
    </div>
  {/if}
</DialogShell>
