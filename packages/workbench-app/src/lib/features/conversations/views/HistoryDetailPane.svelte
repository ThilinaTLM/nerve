<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import GitBranch from "@lucide/svelte/icons/git-branch";
import Pencil from "@lucide/svelte/icons/pencil";
import Wrench from "@lucide/svelte/icons/wrench";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { GroupLabel } from "@nervekit/ui-kit/components/composites/group-label";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import PlainText from "@nervekit/ui-kit/renderers/plain-text/PlainText.svelte";
import {
  dateTimeLabel,
  relativeTimeLabel,
} from "@nervekit/ui-kit/display/time";
import type {
  ConversationEntry,
  ToolCallTranscriptRecord,
} from "$lib/presentation/view-models/conversation";
import { notify } from "$lib/application/notifications/notify.svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { buildHistoryEntryView } from "./history-entry-view";
import { HISTORY_ICONS } from "./history-icons";
import type { HistoryTreeNode } from "./history-tree";

type Props = {
  node: HistoryTreeNode;
  toolCallsById: Map<string, ToolCallTranscriptRecord>;
  onNavigateToEntry?: (entryId: string | undefined) => void;
  onEditEntry?: (entry: ConversationEntry) => void;
};

let { node, toolCallsById, onNavigateToEntry, onEditEntry }: Props = $props();

const entry = $derived(node.entry);
const view = $derived(
  entry ? buildHistoryEntryView(entry, toolCallsById) : undefined,
);
const roleLabel = $derived(
  node.kind === "start"
    ? "Start of conversation"
    : node.kind === "user"
      ? "You"
      : (node.descriptor?.label ?? "Assistant"),
);
const isLast = $derived(node.role === "tip" || node.head);

async function copyId(id: string) {
  try {
    await writeClipboardText(id);
    notify.success("Copied entry id");
  } catch {
    notify.error("Could not copy to clipboard");
  }
}
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="grid gap-2 border-b border-border-subtle p-3">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span class="text-ui font-medium">{roleLabel}</span>
      {#if node.head}
        <Badge variant="brand">Current</Badge>
      {:else if node.role === "fork"}
        <Badge>{node.childIds.length} branches</Badge>
      {:else if node.role === "tip"}
        <Badge>Branch tip</Badge>
      {:else if !node.current && node.kind !== "start"}
        <Badge>Side branch</Badge>
      {/if}
      <span class="flex-1"></span>
      {#if entry}
        <span
          class="text-caption text-muted-foreground"
          title={dateTimeLabel(entry.createdAt)}
          >{relativeTimeLabel(entry.createdAt)} ago</span
        >
        <IconAction
          icon={Copy}
          label="Copy entry id"
          onclick={() => void copyId(entry.id)}
        />
      {/if}
    </div>
    <div class="flex flex-wrap gap-1.5">
      {#if entry}
        <Button onclick={() => onNavigateToEntry?.(entry.id)}>
          <GitBranch />{isLast ? "Continue here" : "Branch from here"}
        </Button>
        {#if entry.role === "user"}
          <Button variant="outline" onclick={() => onEditEntry?.(entry)}>
            <Pencil />Edit & resend
          </Button>
        {/if}
      {:else}
        <Button onclick={() => onNavigateToEntry?.(undefined)}>
          <GitBranch />Branch from beginning
        </Button>
      {/if}
    </div>
  </div>

  <div class="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-3">
    {#if node.steps.length > 0}
      <!-- Folded steps: summarized here, never in the tree. -->
      <div class="grid gap-1">
        <GroupLabel
          label={node.toolCount > 0
            ? `${node.toolCount} tool ${node.toolCount === 1 ? "step" : "steps"} before this reply`
            : "Steps before this reply"}
        />
        <div class="flex flex-wrap gap-1">
          {#each node.steps as step (step.key)}
            {@const StepIcon = step.tool ? Wrench : HISTORY_ICONS[step.icon]}
            <Badge variant={step.tone}>
              <StepIcon aria-hidden="true" />{step.label}{step.count > 1
                ? ` ×${step.count}`
                : ""}
            </Badge>
          {/each}
        </div>
      </div>
    {/if}

    {#if !entry}
      <p class="text-body text-muted-foreground">
        Branch from the beginning to start a new path. Your next message becomes
        the first entry of that branch; the existing history stays available in
        the tree.
      </p>
    {:else if view}
      <div class="rounded-md bg-well px-3 py-2.5 text-body">
        {#if view.isToolEntry}
          <pre
            class="font-mono text-ui whitespace-pre-wrap break-words">{view.messageText ||
              view.descriptor.preview}</pre>
        {:else if view.messageText}
          {#if entry.role === "user"}
            <PlainText text={view.messageText} />
          {:else}
            <Markdown
              text={view.messageText}
              trimCodeBlocks={entry.role !== "assistant"}
            />
          {/if}
        {:else if !view.thinkingText}
          <span class="text-muted-foreground">
            This entry has no text content.
          </span>
        {/if}
        {#if view.thinkingText}
          <div class="text-muted-foreground" class:mt-3={view.messageText}>
            <span class="mb-1 block text-caption">Thinking</span>
            <Markdown text={view.thinkingText} />
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
