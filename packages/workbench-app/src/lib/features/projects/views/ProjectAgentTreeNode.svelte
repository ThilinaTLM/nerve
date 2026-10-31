<script lang="ts">
import Image from "@lucide/svelte/icons/image";
import { conversationTitleToPlainText } from "@nervekit/contracts/core";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import GitPullRequestCreateArrow from "@lucide/svelte/icons/git-pull-request-create-arrow";
import CircleDot from "@lucide/svelte/icons/circle-dot";
import CirclePlus from "@lucide/svelte/icons/circle-plus";
import Hash from "@lucide/svelte/icons/hash";
import type { ConversationReference } from "@nervekit/contracts/core";
import {
  referenceSlots,
  referenceLabel,
  referenceDescription,
} from "$lib/presentation/conversations/conversation-references";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { cn } from "@nervekit/ui-kit/utils";
import { PanelRow } from "$lib/presentation/panels";
import { ItemSurface } from "$lib/presentation/items";
import type { ConversationActivity } from "$lib/presentation/conversations/conversation-activity";
import { idleConversationActivity } from "$lib/presentation/conversations/conversation-activity";
import type { ConversationRow } from "$lib/domain/projects/project-tree";
import { shortAgentModel } from "$lib/domain/projects/project-tree";
import { permissionRuleSetDisplayName } from "$lib/domain/permissions/rule-set-options";
import ConversationActivityIndicator from "$lib/presentation/conversations/ConversationActivityIndicator.svelte";
import { conversationRowStatusLabel } from "$lib/presentation/conversations/conversation-row-state";
import { conversationTitleDisplaySegments } from "$lib/presentation/conversations/conversation-search";

type Props = {
  row: ConversationRow;
  repoLabels: ReadonlyMap<string, string>;
  currentRepository?: string;
  matchedReference?: string;
  isActive?: boolean;
  /** An open tab fills the idle ring. */
  isOpen?: boolean;
  faded?: boolean;
  activity?: ConversationActivity;
  highlight?: number[];
  menuItems: ContextMenuItem[];
  onMenuOpenChange?: (open: boolean) => void;
  onOpenConversation?: (conversationId: string) => void;
};
let {
  row,
  repoLabels,
  currentRepository,
  matchedReference,
  isActive = false,
  isOpen = false,
  faded = false,
  activity,
  highlight = [],
  menuItems,
  onMenuOpenChange,
  onOpenConversation,
}: Props = $props();
const dotActivity = $derived(
  activity ??
    (row.conversation.completedAt
      ? { ...idleConversationActivity, indicator: "completed" as const }
      : idleConversationActivity),
);
const references = $derived(
  referenceSlots(row.conversation.references, matchedReference),
);
function referenceIcon(reference: ConversationReference) {
  return reference.kind === "pull_request"
    ? reference.relationship === "created"
      ? GitPullRequestCreateArrow
      : GitPullRequest
    : reference.kind === "issue"
      ? reference.relationship === "created"
        ? CirclePlus
        : CircleDot
      : Hash;
}
const status = $derived(conversationRowStatusLabel(dotActivity));
const profile = $derived(
  row.agent?.agentProfile ?? row.conversation.agentProfile,
);
const permission = $derived(
  row.agent?.permissionRuleSetId ?? row.conversation.permissionRuleSetId,
);
const promptAt = $derived(
  row.conversation.lastUserMessageAt ?? row.conversation.createdAt,
);
const exactTime = $derived(
  new Date(promptAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }),
);
const age = $derived(relativeTimeLabel(promptAt));
const plainTitle = $derived(
  conversationTitleToPlainText(row.conversation.title),
);
const tooltip = $derived(
  [
    plainTitle,
    ...row.conversation.references.map(referenceDescription),
    dotActivity.statusText ?? dotActivity.label ?? "Idle",
    `profile: ${profile ?? "unknown"} · rule set: ${permission ? permissionRuleSetDisplayName(permission) : "unknown"}`,
    `model: ${shortAgentModel(row.agent)}`,
    `${row.conversation.childCount} sub-agents`,
    exactTime,
    row.conversation.id,
  ].join("\n"),
);
const titleSegments = $derived(
  conversationTitleDisplaySegments(row.conversation.title, highlight),
);
</script>

<ItemSurface
  tone="row"
  hover="none"
  selected={isActive}
  {menuItems}
  {onMenuOpenChange}
  class={cn(
    "mx-1 my-0.5 flex-col rounded-md px-2.5 py-2 font-normal",
    !isActive && "hover:bg-accent/40",
  )}
  onclick={() => onOpenConversation?.(row.conversation.id)}
>
  <PanelRow
    label={plainTitle}
    labelLines={2}
    dataId={row.conversation.id}
    title={tooltip}
    ariaLabel={tooltip}
    flush
    hoverable={false}
    class="py-0"
    active={isActive}
    tone={faded && !isActive ? "neutral" : "accent"}
    labelClass="font-normal"
    onclick={(event) => {
      event.stopPropagation();
      onOpenConversation?.(row.conversation.id);
    }}
  >
    {#snippet leading()}
      <span class="flex h-4 w-3.5 shrink-0 items-center justify-center">
        <ConversationActivityIndicator
          activity={dotActivity}
          variant="rail"
          {isOpen}
        />
      </span>
    {/snippet}
    {#snippet titleTrailing()}
      <span
        class="shrink-0 text-xs tabular-nums text-muted-foreground"
        title={exactTime}>{age}</span
      >
    {/snippet}
    {#snippet labelContent()}
      {#each titleSegments as segment, index (index)}{#if segment.type === "image"}<span
            role="img"
            aria-label="Image"
            title="Image"
            class="inline-flex align-[-2px] text-muted-foreground"
            ><Image class="size-3" aria-hidden="true" /></span
          >{:else}{#each segment.runs as run, runIndex (runIndex)}{#if run.hit}<mark
                class="rounded-xs bg-primary/25 text-foreground"
                >{run.text}</mark
              >{:else}{run.text}{/if}{/each}{/if}{/each}
    {/snippet}
    {#snippet meta()}
      {#if status || references.shown.length}
        <span
          class="flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground font-normal"
        >
          {#if status}
            <span
              class={cn(
                "flex shrink-0 items-center gap-1",
                dotActivity.tone === "warning" && "text-warning",
                dotActivity.tone === "destructive" &&
                  dotActivity.indicator !== "aborted" &&
                  "text-destructive",
                dotActivity.tone === "success" && "text-success",
                dotActivity.tone === "info" && "text-info",
              )}
            >
              {status}
            </span>
          {/if}
          {#if references.shown.length}
            <span class="flex min-w-0 items-center gap-2.5">
              {#each references.shown as reference (reference.resourceKey)}
                {@const Icon = referenceIcon(reference)}
                <span
                  title={referenceDescription(reference)}
                  class={cn(
                    "inline-flex min-w-0 items-center gap-1 rounded-sm",
                    reference.resourceKey === matchedReference &&
                      "bg-primary/25 px-0.5 text-foreground",
                  )}
                >
                  <Icon class="size-3 shrink-0" aria-hidden="true" />
                  <span class="truncate"
                    >{referenceLabel(
                      reference,
                      repoLabels,
                      currentRepository,
                    )}</span
                  >
                </span>
              {/each}
              {#if references.overflow > 0}
                <span
                  class="shrink-0"
                  title={row.conversation.references
                    .map(referenceDescription)
                    .join("\n")}>+{references.overflow}</span
                >
              {/if}
            </span>
          {/if}
        </span>
      {/if}
    {/snippet}
  </PanelRow>
</ItemSurface>
