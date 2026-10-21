<script lang="ts">
import type { ComponentProps } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import CardFooter from "$lib/presentation/cards/CardFooter.svelte";
import CardHeader from "$lib/presentation/cards/CardHeader.svelte";
import CardShell from "$lib/presentation/cards/CardShell.svelte";
import MetaChip from "$lib/presentation/cards/MetaChip.svelte";
import StatusGlyph from "$lib/presentation/cards/StatusGlyph.svelte";
import ToolCallCard from "$lib/presentation/tools/ToolCallCard.svelte";
import ResultCodeBlock from "$lib/presentation/tools/tool-call/ResultCodeBlock.svelte";
import TodoChecklist from "$lib/presentation/tools/tool-call/TodoChecklist.svelte";
import ToolCallDetailsDialog from "$lib/presentation/tools/tool-call/ToolCallDetailsDialog.svelte";
import ToolOutputBlock from "$lib/presentation/tools/tool-call/ToolOutputBlock.svelte";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";
import * as fx from "./tool-card-fixtures";
import * as vfx from "./tool-card-view-fixtures";

type CardProps = ComponentProps<typeof ToolCallCard>;
type LabeledCard = { label: string; props: CardProps };

const noop = () => {};

const cwd = fx.SAMPLE_CWD;

const bashCases: LabeledCard[] = [
  { label: "Drafting", props: { draft: fx.bashDraftStreaming, cwd } },
  {
    label: "ask_user — drafting",
    props: { draft: fx.askUserDraftStreaming, cwd },
  },
  { label: "Checking", props: { toolCall: fx.bashSupervising, cwd } },
  {
    label: "Awaiting approval",
    props: {
      toolCall: fx.bashWaiting,
      pendingApproval: fx.bashWaitingApproval,
      cwd,
      onGrantApproval: noop,
      onDenyApproval: noop,
    },
  },
  {
    label: "Awaiting approval — persistent grants (split button)",
    props: {
      toolCall: fx.bashWaitingPersistent,
      pendingApproval: fx.bashWaitingPersistentApproval,
      cwd,
      onGrantApproval: noop,
      onDenyApproval: noop,
    },
  },
  { label: "Queued", props: { toolCall: fx.bashQueued, cwd } },
  { label: "Running", props: { toolCall: fx.bashRunning, cwd } },
  {
    label: "Running — live output",
    props: { toolCall: fx.bashRunningLive, liveOutput: fx.bashLiveOutput, cwd },
  },
  { label: "Completed", props: { toolCall: fx.bashCompleted, cwd } },
  {
    label: "Completed — after approval (risk chip stays)",
    props: { toolCall: fx.bashCompletedAfterApproval, cwd },
  },
  {
    label: "Completed — long output (collapsed window)",
    props: { toolCall: fx.bashLongOutput, cwd },
  },
  {
    label: "Completed — long command (wraps)",
    props: { toolCall: fx.bashLongCommand, cwd },
  },
  { label: "Non-zero exit", props: { toolCall: fx.bashNonZeroExit, cwd } },
  { label: "Failed", props: { toolCall: fx.bashFailed, cwd } },
  {
    label: "Completed — multiline command (own section)",
    props: { toolCall: vfx.bashMultiline, cwd },
  },
  { label: "python — running", props: { toolCall: vfx.pythonRunning, cwd } },
  {
    label: "python — completed",
    props: { toolCall: vfx.pythonCompleted, cwd },
  },
  {
    label: "launch — completed",
    props: { toolCall: vfx.launchCompleted, cwd },
  },
];

const fileCases: LabeledCard[] = [
  {
    label: "read — completed",
    props: { toolCall: vfx.readText, cwd, onOpenFile: noop },
  },
  {
    label: "read — line range, truncated",
    props: { toolCall: vfx.readRange, cwd, onOpenFile: noop },
  },
  { label: "read — running", props: { toolCall: vfx.readRunning, cwd } },
  {
    label: "edit — completed",
    props: { toolCall: vfx.editCompleted, cwd, onOpenFile: noop },
  },
  {
    label: "edit — multiple operations",
    props: { toolCall: vfx.editMultiOp, cwd, onOpenFile: noop },
  },
  {
    label: "edit — failed (error is the last section)",
    props: { toolCall: vfx.editFailed, cwd, onOpenFile: noop },
  },
  {
    label: "edit — drafting (streamed diff)",
    props: { draft: vfx.editDraft, cwd },
  },
  {
    label: "write — completed",
    props: { toolCall: vfx.writeCompleted, cwd, onOpenFile: noop },
  },
  { label: "write — running", props: { toolCall: vfx.writeRunning, cwd } },
];

const searchCases: LabeledCard[] = [
  {
    label: "grep — completed",
    props: { toolCall: vfx.grepCompleted, cwd, onOpenFile: noop },
  },
  {
    label: "ls — completed",
    props: { toolCall: vfx.lsCompleted, cwd, onOpenFile: noop },
  },
  {
    label: "find — completed",
    props: { toolCall: vfx.findCompleted, cwd, onOpenFile: noop },
  },
  {
    label: "web_search — running",
    props: { toolCall: vfx.webSearchRunning, cwd },
  },
  {
    label: "web_search — completed",
    props: { toolCall: vfx.webSearchCompleted, cwd },
  },
  {
    label: "web_fetch — completed",
    props: { toolCall: vfx.webFetchCompleted, cwd, onOpenFile: noop },
  },
  {
    label: "web_fetch — failed",
    props: { toolCall: vfx.webFetchFailed, cwd },
  },
  {
    label: "jira_create_issue — drafting",
    props: { draft: vfx.jiraCreateDraft, cwd },
  },
  {
    label: "jira_create_issue — completed",
    props: { toolCall: vfx.jiraCreateCompleted, cwd },
  },
  {
    label: "jira_search_issues — completed",
    props: { toolCall: vfx.jiraSearchCompleted, cwd },
  },
  {
    label: "confluence_search_pages — completed",
    props: { toolCall: vfx.confluenceSearchCompleted, cwd },
  },
  {
    label: "generate_image — running",
    props: { toolCall: vfx.generateImageRunning, cwd },
  },
  {
    label: "generate_image — completed",
    props: { toolCall: vfx.generateImageCompleted, cwd, onOpenFile: noop },
  },
  {
    label: "explain_image — completed",
    props: { toolCall: vfx.explainImageCompleted, cwd, onOpenFile: noop },
  },
];

const interactionCases: LabeledCard[] = [
  {
    label: "ask_user — awaiting answer",
    props: {
      toolCall: fx.askUserPending,
      pendingUserQuestion: fx.askUserQuestion,
      cwd,
      onAnswerUserQuestion: noop,
      onDismissUserQuestion: noop,
    },
  },
  {
    label: "ask_user — several questions",
    props: {
      toolCall: fx.askUserMultiPending,
      pendingUserQuestion: fx.askUserMultiQuestion,
      cwd,
      onAnswerUserQuestion: noop,
      onDismissUserQuestion: noop,
    },
  },
  {
    label: "ask_user — answered",
    props: { toolCall: fx.askUserAnswered, cwd },
  },
  {
    label: "ask_user — dismissed",
    props: { toolCall: fx.askUserDismissed, cwd },
  },
  {
    label: "ask_user — legacy result",
    props: { toolCall: fx.askUserLegacy, cwd },
  },
  {
    label: "plan_present — awaiting review",
    props: {
      toolCall: fx.planPending,
      pendingPlanReview: fx.planReview,
      cwd,
      onAcceptPlanReview: noop,
      onAcceptPlanReviewInNewChat: noop,
      onRejectPlanReview: noop,
    },
  },
  {
    label: "plan_present — accepted",
    props: { toolCall: fx.planAccepted, cwd, onOpenFile: noop },
  },
  { label: "todos — checklist", props: { toolCall: vfx.todosCompleted, cwd } },
  {
    label: "subagent — running",
    props: { toolCall: fx.subagentRunning, cwd },
  },
  {
    label: "subagent_prompt — drafting",
    props: { draft: fx.subagentPromptDraft, cwd },
  },
  {
    label: "subagent — completed",
    props: { toolCall: fx.subagentPrompt, cwd },
  },
  {
    label: "subagent_prompt — rejected assignment",
    props: { toolCall: fx.subagentPromptRejected, cwd },
  },
  {
    label: "subagent_status — listing",
    props: { toolCall: fx.subagentStatus, cwd },
  },
  {
    label: "subagent_stop — outcomes",
    props: { toolCall: fx.subagentStop, cwd },
  },
];

const contextCases: CardProps[] = [
  { toolCall: vfx.grepCompleted, cwd, onOpenFile: noop },
  { toolCall: vfx.readRange, cwd, onOpenFile: noop },
  { toolCall: vfx.editCompleted, cwd, onOpenFile: noop },
  { toolCall: fx.bashCompleted, cwd },
  { toolCall: fx.bashNonZeroExit, cwd },
  { toolCall: fx.subagentRunning, cwd },
  { toolCall: vfx.todosCompleted, cwd },
  {
    toolCall: fx.bashWaiting,
    pendingApproval: fx.bashWaitingApproval,
    cwd,
    onGrantApproval: noop,
    onDenyApproval: noop,
  },
];

const longOutputText = Array.from(
  { length: 24 },
  (_, i) => `line ${i + 1}: the quick brown fox jumps over the lazy dog`,
).join("\n");
const ansiText =
  "\u001b[32m✓\u001b[0m passed\n\u001b[31m✗\u001b[0m failed  \u001b[2mdim detail\u001b[0m";
const codeSample = `export function toolPresentation(view: ToolView, call: ToolCall) {
  const { tone, pulse } = statusDot(call, view);
  return { badge: call.toolName, meta: [], dotTone: tone, dotPulse: pulse };
}`;

const diffSnippet =
  '-  accent: "text-primary",\n+  accent: "text-muted-foreground",';

const dialogCall = fx.bashNonZeroExit;
const dialogDetails = fx.sampleDetails(dialogCall);
let detailsOpen = $state(false);
</script>

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="In context"
    description="A 720px transcript column as in the app: tool cards stacked between assistant text, no surface of their own."
  >
    <GallerySpecimen
      title="Tool calls in a transcript column"
      source="presentation/tools/ToolCallCard"
      usage="1 file · conversation"
      layout="bare"
    >
      <div class="flex w-[720px] max-w-full flex-col gap-3">
        {#each contextCases as props, index (index)}
          <ToolCallCard {...props} />
        {/each}
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Card anatomy"
    description="Shared by every tool call and transcript notice: status glyph, mono tool name, muted argument, recessed body, chip footer."
  >
    <GallerySpecimen
      title="StatusGlyph"
      description="Only the tones and states tool cards use: running (info, spins), completed, failed, awaiting user."
      source="presentation/cards/StatusGlyph"
      usage="2 files · tools"
    >
      <div class="flex items-center gap-2">
        <StatusGlyph tone="info" pulse size={14} label="running" />
        <span class="text-xs text-muted-foreground">running</span>
      </div>
      <div class="flex items-center gap-2">
        <StatusGlyph tone="success" size={14} label="completed" />
        <span class="text-xs text-muted-foreground">completed</span>
      </div>
      <div class="flex items-center gap-2">
        <StatusGlyph tone="destructive" size={14} label="failed" />
        <span class="text-xs text-muted-foreground">failed</span>
      </div>
      <div class="flex items-center gap-2">
        <StatusGlyph tone="warning" waitingForUser size={14} label="waiting" />
        <span class="text-xs text-muted-foreground">waiting for user</span>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="MetaChip"
      description="Neutral count, warning, destructive exit code, mono id, and a file-path button."
      source="presentation/cards/MetaChip"
      usage="1 file · tools"
    >
      <MetaChip item={{ text: "42 lines" }} />
      <MetaChip item={{ text: "truncated", tone: "warning" }} />
      <MetaChip item={{ text: "exit 1", tone: "destructive" }} />
      <MetaChip item={{ text: "task_01GALLERY", mono: true }} />
      <MetaChip
        item={{
          text: "full output",
          mono: true,
          openPath: "/home/dev/nerve/.nerve/out.log",
        }}
        onOpenFile={noop}
      />
    </GallerySpecimen>

    <GallerySpecimen
      title="CardHeader"
      description="Inline flow so long arguments wrap flush left; path arguments render as links."
      source="presentation/cards/CardHeader"
      usage="1 file · tools"
      layout="stack"
      class="max-w-[720px]"
    >
      <CardHeader
        dotTone="info"
        dotPulse
        statusLabel="Running"
        badge="grep"
        arg={{ text: "dotTone", openPath: "/home/dev/nerve/src" }}
        onOpenFile={noop}
      />
      <CardHeader
        dotTone="success"
        statusLabel="Completed"
        badge="read"
        arg={{
          text: "src/lib/presentation/cards/CardShell.svelte",
          openPath:
            "/home/dev/nerve/src/lib/presentation/cards/CardShell.svelte",
        }}
        onOpenFile={noop}
      />
      <CardHeader
        dotTone="warning"
        statusLabel="Needs approval"
        badge="bash"
        arg={{ text: "rm -rf node_modules" }}
        waitingForUser
      />
      <CardHeader
        dotTone="success"
        statusLabel="Completed"
        badge="bash"
        arg={{ text: fx.LONG_COMMAND }}
      />
    </GallerySpecimen>

    <GallerySpecimen
      title="CardFooter"
      description="Chips left; passive card actions right."
      source="presentation/cards/CardFooter"
      usage="4 files · tools"
      layout="stack"
      class="max-w-[720px]"
    >
      <CardFooter
        meta={[{ text: "42 lines" }, { text: "truncated", tone: "warning" }]}
      />
      <CardFooter
        meta={[{ text: "2 lines" }]}
        cardActions={[{ label: "View details", onClick: noop }]}
      />
    </GallerySpecimen>

    <GallerySpecimen
      title="CardShell"
      description="Running, completed with body and footer, failed with error preview, and awaiting approval."
      source="presentation/cards/CardShell"
      usage="2 files · tools, conversation"
      layout="stack"
      class="max-w-[720px]"
    >
      <CardShell
        status="running"
        dotTone="info"
        dotPulse
        badge="bash"
        arg={{ text: "pnpm build" }}
        meta={[{ text: "12s" }]}
      />
      <CardShell
        status="completed"
        dotTone="success"
        badge="bash"
        arg={{ text: "pnpm test" }}
        bodyVisible
        meta={[{ text: "2 lines" }]}
        cardActions={[{ label: "View details", onClick: noop }]}
      >
        <pre
          class="m-0 rounded-sm border border-border bg-well p-2.5 font-mono text-xs leading-snug">✔ 4 passed
ℹ duration_ms 118.4</pre>
      </CardShell>
      <CardShell
        status="failed"
        dotTone="destructive"
        badge="write"
        arg={{ text: "/etc/hosts" }}
        error="EACCES: permission denied, open '/etc/hosts'"
        meta={[{ text: "exit 1", tone: "destructive" }]}
      />
      <CardShell
        status="waiting"
        dotTone="warning"
        badge="bash"
        arg={{ text: "rm -rf node_modules" }}
        meta={[{ text: "destructive", tone: "destructive" }]}
      />
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Tool calls"
    description="ToolCallCard for the tools that appear in real transcripts, in key states only. Real parsing and presentation run on static records; callbacks are no-ops."
  >
    <GallerySpecimen
      title="bash"
      description="Drafting, awaiting approval (single and persistent grants), running, completed, long output, non-zero exit, failed."
      source="presentation/tools/tool-call/BashToolView"
      usage="1 file · tools"
      layout="stack"
      class="max-w-[720px]"
    >
      {#each bashCases as c (c.label)}
        <div class="grid gap-1">
          <span class="text-xs text-muted-foreground">{c.label}</span>
          <ToolCallCard {...c.props} />
        </div>
      {/each}
    </GallerySpecimen>

    <GallerySpecimen
      title="read · edit · write"
      source="presentation/tools/tool-call/ReadToolView, EditToolView, WriteToolView"
      usage="1 file each · tools"
      layout="stack"
      class="max-w-[720px]"
    >
      {#each fileCases as c (c.label)}
        <div class="grid gap-1">
          <span class="text-xs text-muted-foreground">{c.label}</span>
          <ToolCallCard {...c.props} />
        </div>
      {/each}
    </GallerySpecimen>

    <GallerySpecimen
      title="grep · find · web_search · web_fetch"
      source="presentation/tools/tool-call/GrepToolView, FindToolView, WebSearchToolView, WebFetchToolView"
      usage="1 file each · tools"
      layout="stack"
      class="max-w-[720px]"
    >
      {#each searchCases as c (c.label)}
        <div class="grid gap-1">
          <span class="text-xs text-muted-foreground">{c.label}</span>
          <ToolCallCard {...c.props} />
        </div>
      {/each}
    </GallerySpecimen>

    <GallerySpecimen
      title="ask_user · plan_present · todos · subagent"
      source="presentation/tools/tool-call/AskUserToolView, PlanPresentToolView, TodoToolView, SubagentToolView"
      usage="1 file each · tools"
      layout="stack"
      class="max-w-[720px]"
    >
      {#each interactionCases as c (c.label)}
        <div class="grid gap-1">
          <span class="text-xs text-muted-foreground">{c.label}</span>
          <ToolCallCard {...c.props} />
        </div>
      {/each}
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Output blocks and details"
    description="The recessed output well inside cards, the checklist, and the View details dialog."
  >
    <GallerySpecimen
      title="ToolOutputBlock"
      description="Collapsed window showing the head vs. the tail of long output, and terminal (ANSI) mode."
      source="presentation/tools/tool-call/ToolOutputBlock"
      usage="12 files · tools, conversation"
      layout="stack"
      class="max-w-[720px]"
    >
      <ToolOutputBlock text={longOutputText} />
      <ToolOutputBlock text={longOutputText} direction="tail" />
      <ToolOutputBlock text={ansiText} terminal />
    </GallerySpecimen>

    <GallerySpecimen
      title="ResultCodeBlock"
      description="Highlighted code on the well surface; plain and with a diff."
      source="presentation/tools/tool-call/ResultCodeBlock"
      usage="8 files · tools, dialogs, conversation"
      layout="stack"
      class="max-w-[720px]"
    >
      <ResultCodeBlock code={codeSample} language="ts" />
      <ResultCodeBlock code={diffSnippet} language="diff" />
    </GallerySpecimen>

    <GallerySpecimen
      title="TodoChecklist"
      description="Default scale (card body) and dense (composer popover)."
      source="presentation/tools/tool-call/TodoChecklist"
      usage="3 files · tools, composer"
      layout="stack"
      class="max-w-[720px]"
    >
      <TodoChecklist
        items={[
          { todo: "Read the existing card components", done: true },
          { todo: "Render the lifecycle states", done: false },
        ]}
      />
      <TodoChecklist
        dense
        items={[
          { todo: "Dense item, done", done: true },
          { todo: "Dense item, open", done: false },
        ]}
      />
    </GallerySpecimen>

    <GallerySpecimen
      title="ToolCallDetailsDialog"
      description="Opened from a card's “View details”. The full record is passed in directly here."
      source="presentation/tools/tool-call/ToolCallDetailsDialog"
      usage="1 file · tools"
    >
      <Button variant="outline" onclick={() => (detailsOpen = true)}>
        Open details
      </Button>
      <ToolCallDetailsDialog
        bind:open={detailsOpen}
        previewToolCall={dialogCall}
        details={dialogDetails}
        onOpenFile={noop}
      />
    </GallerySpecimen>
  </GalleryGroup>
</div>
