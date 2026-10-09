<script lang="ts">
import type { CoreToolCard } from "../state/transcript-types";
import type {
  ConversationSummary,
  InteractionResolution,
} from "@nervekit/contracts/core";
import type { ConversationPaneActions } from "../conversations/conversation-view-contracts";
import {
  presentToolArguments,
  type ToolLifecycleStage,
} from "./lifecycle/registry";
import ToolArgumentBody from "./tool-call/ToolArgumentBody.svelte";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import CardShell from "../cards/CardShell.svelte";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { statusDot } from "./views/tool-presentation-helpers";
import { parseToolViewCached } from "./views/tool-result-view";
import { toolViewComponent } from "./views/registry";
import ApprovalPrompt from "./tool-call/ApprovalPrompt.svelte";
import AskUserToolView from "./tool-call/AskUserToolView.svelte";
import PlanModeToolView from "./tool-call/PlanModeToolView.svelte";
import ExploreToolView from "./tool-call/ExploreToolView.svelte";
let {
  toolCall,
  children = [],
  actions = {},
}: {
  toolCall: CoreToolCard;
  children?: ConversationSummary[];
  actions?: ConversationPaneActions;
} = $props();
const view = $derived(
  parseToolViewCached(
    toolCall,
    toolCall.liveOutput ? { text: toolCall.liveOutput } : undefined,
  ),
);
const View = $derived(toolViewComponent(view.kind));
const interaction = $derived(toolCall.interaction);
const tone = $derived<StatusTone>(
  toolCall.state === "failed" || toolCall.state === "denied"
    ? "destructive"
    : toolCall.state === "awaiting_approval" ||
        toolCall.state === "awaiting_input" ||
        toolCall.state === "indeterminate"
      ? "warning"
      : toolCall.state === "completed"
        ? statusDot(toolCall, view).tone
        : "info",
);
const busy = $derived(
  ["drafting", "supervising", "ready", "running"].includes(toolCall.state),
);
let detailsOpen = $state(false);
const stage = $derived<ToolLifecycleStage>(
  toolCall.state === "drafting"
    ? "drafting"
    : toolCall.state === "awaiting_approval" || toolCall.state === "supervising"
      ? "approval"
      : busy
        ? "executing"
        : toolCall.state === "completed"
          ? "completed"
          : "failed",
);
const argumentsPresentation = $derived(
  presentToolArguments(
    toolCall.toolName,
    { argsPreview: toolCall.argsPreview, argsText: toolCall.partialArgsText },
    stage,
    toolCall.cwd,
  ),
);
async function resolve(resolution: InteractionResolution) {
  if (toolCall.id) await actions.onResolve?.(toolCall.id, resolution);
}
</script>
<CardShell
  status={toolCall.state}
  dotTone={tone}
  dotPulse={busy}
  statusLabel={toolCall.statusLabel}
  badge={toolCall.toolName}
  arg={argumentsPresentation.primaryArg}
  meta={argumentsPresentation.secondary}
  cardActions={[{ label: "View details", onClick: () => (detailsOpen = true) }]}
  error={toolCall.state === "failed" ||
  toolCall.state === "denied" ||
  toolCall.state === "indeterminate"
    ? toolCall.resultPreview?.content
    : undefined}
  onOpenFile={actions.onOpenFile}
  bodyVisible={true}
  layoutRevision={toolCall.state}
>
  {#if !toolCall.resultPreview && argumentsPresentation.body.kind !== "none"}<ToolArgumentBody
      body={argumentsPresentation.body}
      streaming={toolCall.state === "drafting"}
    />{/if}
  {#if interaction?.kind === "approval"}
    <ApprovalPrompt request={interaction.request} onResolve={resolve} />
  {:else if interaction?.kind === "user_input"}
    <AskUserToolView
      {toolCall}
      view={view.kind === "ask_user"
        ? view
        : {
            kind: "ask_user",
            dismissed: false,
            question: interaction.request.question,
            context: interaction.request.context,
            recommendation: interaction.request.recommendation,
          }}
      questionRecord={{
        toolCallId: toolCall.id!,
        ...interaction.request,
        status: "pending",
      }}
      onAnswerUserQuestion={(_id, answer) =>
        resolve({ kind: "user_input", answers: { answer } })}
      onDismissUserQuestion={() => resolve({ kind: "user_input", answers: {} })}
    />
  {:else if interaction?.kind === "plan_review"}
    <PlanModeToolView
      request={interaction.request}
      onResolve={resolve}
      onOpenFile={actions.onOpenFile}
      onReadFile={actions.onReadFile}
    />
  {:else if toolCall.toolName === "explore" || toolCall.toolName === "subagent"}
    <ExploreToolView
      {toolCall}
      {children}
      onOpenConversation={actions.onOpenConversation}
      onPeekConversation={actions.onPeekConversation}
    />
  {:else}<View {toolCall} {view} onOpenFile={actions.onOpenFile} />{/if}
</CardShell>

<DialogShell
  bind:open={detailsOpen}
  title={`${toolCall.toolName} details`}
  description={toolCall.statusLabel}
  class="max-w-4xl"
>
  <div class="max-h-96 space-y-4 overflow-auto">
    <div>
      <h3 class="text-sm font-semibold">Arguments</h3>
      <pre
        class="overflow-x-auto rounded-md bg-well p-3 text-xs">{JSON.stringify(
          toolCall.argsPreview,
          null,
          2,
        ) || toolCall.partialArgsText}</pre>
    </div>
    {#if toolCall.resultPreview}<div>
        <h3 class="text-sm font-semibold">Result</h3>
        <pre
          class="overflow-x-auto rounded-md bg-well p-3 text-xs">{JSON.stringify(
            toolCall.resultPreview,
            null,
            2,
          )}</pre>
      </div>{/if}
  </div>
</DialogShell>
