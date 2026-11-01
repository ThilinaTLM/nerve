<script lang="ts">
import UserMessageBubble from "$lib/presentation/transcript/UserMessageBubble.svelte";
import NoticeCard from "$lib/presentation/transcript/notice/NoticeCard.svelte";
import TranscriptContextMenu from "$lib/presentation/transcript/TranscriptContextMenu.svelte";
import { formatInlineCommandResultText } from "@nervekit/contracts/completions";
import type { CommandPreparation } from "@nervekit/contracts/core";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import ConversationBanner from "$lib/presentation/conversations/ConversationBanner.svelte";
import ConversationEmptyState from "$lib/presentation/conversations/ConversationEmptyState.svelte";
import ConversationWelcome from "$lib/features/conversations/views/ConversationWelcome.svelte";
import { shortProjectLabel } from "$lib/domain/projects/project-tree";
import type { ProjectRecord } from "$lib/domain/projects/sidebar-view-models";
import type { TimelineItem } from "$lib/presentation/state/timeline";
import type {
  CompactionNotice,
  RunStatusNotice,
  SystemEventNotice,
  TaskEventNotice,
  TranscriptItem,
} from "$lib/presentation/state/transcript-types";
import RunActivitySlot from "$lib/presentation/transcript/activity/RunActivitySlot.svelte";
import type { RunActivityView } from "$lib/presentation/transcript/activity/run-activity";
import CommandBlockCard from "$lib/presentation/transcript/CommandBlockCard.svelte";
import CompactionNoticeCard from "$lib/presentation/transcript/notice/CompactionNoticeCard.svelte";
import RunStatusNoticeCard from "$lib/presentation/transcript/notice/RunStatusNoticeCard.svelte";
import SystemEventNoticeCard from "$lib/presentation/transcript/notice/SystemEventNoticeCard.svelte";
import TaskNoticeCard from "$lib/presentation/transcript/notice/TaskNoticeCard.svelte";
import ThinkingGroup from "$lib/presentation/transcript/ThinkingGroup.svelte";
import TranscriptList from "$lib/presentation/transcript/TranscriptList.svelte";
import UserMessageContent from "$lib/presentation/transcript/UserMessageContent.svelte";
import UserPromptRow from "$lib/presentation/transcript/UserPromptRow.svelte";
import type { QueuedPromptRecord } from "$lib/presentation/view-models/conversation";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";
import { sampleCall, SAMPLE_CWD } from "./tool-card-fixtures";

const noop = () => {};
const stamp = "2026-10-14T09:30:00.000Z";
const base = { conversationId: "conv_demo", createdAt: stamp };
const welcomeProject: ProjectRecord = {
  id: "proj_nerve",
  name: "nerve",
  directory: "/home/user/Projects/nerve",
  dir: "/home/user/Projects/nerve",
  createdAt: stamp,
  updatedAt: stamp,
};
const welcomeLabel = shortProjectLabel(welcomeProject.dir, "/home/user");

const transcriptMenu = (): ContextMenuItem[] => [
  { label: "Copy", onSelect: noop },
  { label: "Copy as markdown", onSelect: noop },
];

const queued = (
  id: string,
  text: string,
  presentation?: "starting" | "waiting",
): QueuedPromptRecord => ({
  id,
  presentation,
  agentId: "agent_demo",
  conversationId: "conv_demo",
  projectId: "proj_demo",
  behavior: "follow-up",
  text,
  status: "queued",
  createdAt: stamp,
  updatedAt: stamp,
});

const messageItem = (
  overrides: Partial<TranscriptItem> = {},
): TranscriptItem => ({
  id: "entry_msg",
  role: "user",
  text: "Fix the failing reconnect test.",
  createdAt: stamp,
  ...overrides,
});

/* ------------------------------ User messages ------------------------------ */

const commandResultText = [
  "Here is the current state:",
  formatInlineCommandResultText({
    command: "git status --short",
    status: "completed",
    exitCode: 0,
    output: " M src/app.ts\n?? notes.md",
  }),
  formatInlineCommandResultText({
    command: "pnpm test",
    status: "completed",
    exitCode: 1,
    output: "FAIL src/store.test.ts\n  expected 3, received 2",
  }),
  "What should I do next?",
].join("\n");

const rawCommandText =
  "Run these first:\n```!!!\npnpm install\n```\nthen\n```!!!\npnpm build\n```";

const preparation: CommandPreparation = {
  blocks: [
    {
      index: 0,
      command: "pnpm install",
      state: "completed",
      result: { stdout: "Done in 3.1s", stderr: "", exitCode: 0 },
    },
    { index: 1, command: "pnpm build", state: "running", result: null },
  ],
};

const longPrompt =
  "/home/tlm/Projects/nerve/data/storage-4/data/images/image-20261014T080316Z.png the plan mode present tool view not showing the body and footer which it was showing when it is on waiting for approval state. Can we fix that?";

/* ------------------------------ Assistant markdown ------------------------------ */

const assistantMarkdown = `Created [PR #423](https://github.com/example/nerve/pull/423).

- Committed and pushed to \`fix/retain-resolved-plan-review-cards\`
- Working tree clean
- 33 targeted tests and repository checks passed

The core change is in [session-store.ts:42](src/session-store.ts:42):

\`\`\`ts
await store.restoreCursor();
await store.replay();
\`\`\`

| Check | Result |
| --- | --- |
| Unit tests | pass |
| Lint | pass |`;

/* ------------------------------ Thinking ------------------------------ */

const thinkingDone = [
  {
    id: "t1",
    text: "**Evaluating update operations**\n\nI should look at the session store first and check how reconnects are replayed.",
    live: false,
    done: true,
  },
];
const thinkingLive = [
  {
    id: "t3",
    text: "Considering whether the retry should be idempotent",
    live: true,
    done: false,
  },
];

/* ------------------------------ Notices ------------------------------ */

const runStatuses: RunStatusNotice[] = [
  {
    ...base,
    state: "retrying",
    attempt: 2,
    maxRetries: 5,
    errorMessage: "429 Too Many Requests: rate limit exceeded",
    httpStatus: 429,
  },
  {
    ...base,
    state: "failed",
    runId: "run_demo",
    errorMessage: "401 Unauthorized: invalid API key",
    retryable: true,
  },
  {
    ...base,
    state: "interrupted",
    runId: "run_demo",
    retryable: true,
    errorMessage: "The daemon restarted while the run was active.",
  },
];

const taskNotices: TaskEventNotice[] = [
  {
    ...base,
    event: "completed",
    status: "completed",
    exitCode: 0,
    taskId: "task_2",
    taskName: "build",
    commandPreview: "pnpm build",
    output: "built in 4.2s",
  },
  {
    ...base,
    event: "completed",
    status: "exited",
    exitCode: 2,
    taskId: "task_3",
    commandPreview: "pnpm test",
    output: "FAIL src/store.test.ts\n1 failed",
  },
];

const compactions: CompactionNotice[] = [
  {
    id: "c1",
    state: "running",
    reason: "threshold",
    createdAt: new Date().toISOString(),
    summaryPreview:
      "The user asked to refactor the session store…\nKey decisions so far:\n- keep public API",
  },
  {
    id: "c2",
    state: "completed",
    reason: "manual",
    tokensBefore: 168_000,
    tokensAfter: 21_000,
    freedTokens: 147_000,
    contextWindow: 200_000,
    thresholdTokens: 160_000,
    summary:
      "# Checkpoint\n\nRefactored the session store into three modules.\n- persistence\n- replay\n- reconnect\n\nTests pending.",
  },
  {
    id: "c5",
    state: "failed",
    reason: "threshold",
    errorMessage: "The summarization model returned an empty response.",
  },
];

const systemNotices: SystemEventNotice[] = [
  {
    entryId: "s1",
    kind: "branch_summary",
    text: "Summary of the abandoned branch:\n- tried approach A\n- hit a dead end",
    fromEntryId: "entry_0123",
    createdAt: stamp,
  },
  {
    entryId: "s2",
    kind: "subagent_run_event",
    text: 'Sub-agent "research" (explore) completed.\nFound 3 relevant modules.\n[truncated; full response: /reports/research.md]',
    summary: 'Sub-agent "research" (explore) completed.',
    createdAt: stamp,
  },
];

/* ---------------------------- Run activity ---------------------------- */

const activityBase: RunActivityView = {
  mounted: true,
  open: true,
  kind: "active",
  tone: "neutral",
  spinnerRate: 1,
};
const activityViews: { title: string; view: RunActivityView }[] = [
  {
    title: "active",
    view: {
      ...activityBase,
      labelKey: "thinking",
      label: "Thinking…",
      elapsedLabel: "0:12",
    },
  },
  {
    title: "retry (countdown)",
    view: {
      ...activityBase,
      kind: "retry",
      tone: "warning",
      labelKey: "retry",
      label: "Retrying in 4s",
      countdownFraction: 0.6,
      elapsedLabel: "1:03",
    },
  },
  {
    title: "waiting on agents / commands",
    view: {
      ...activityBase,
      kind: "waiting",
      tone: "warning",
      labelKey: "waiting",
      label: "Waiting for",
      spinnerRate: 0.4,
      pending: [
        { kind: "agent", id: "a1", label: "research" },
        { kind: "command", id: "c1", label: "pnpm test" },
      ],
    },
  },
  {
    title: "done",
    view: {
      ...activityBase,
      kind: "done",
      tone: "success",
      labelKey: "done",
      label: "Done",
      elapsedLabel: "0:21",
      spinnerRate: 0,
    },
  },
];

/* ---------------------------- In-context timeline ---------------------------- */

const prCommand =
  'gh pr create --base main --head fix/retain-resolved-plan-review-cards --title "Fix plan review body and footer disappearing after resolution" --body "Persist the reviewed plan snapshot and decision in completed tool-result details."';

const contextTimeline: TimelineItem[] = [
  {
    kind: "message",
    key: "m1",
    item: messageItem({
      id: "m1",
      text: "Commit the changes, push the branch and open a PR against main.",
    }),
  },
  {
    kind: "message",
    key: "th1",
    item: {
      id: "th1",
      role: "assistant",
      displayKind: "thinking",
      text: "**Preparing the pull request**\n\nThe working tree is staged, so I can commit and push, then open the PR with the GitHub CLI.",
      done: true,
      createdAt: stamp,
    },
  },
  {
    kind: "tool",
    key: "tool1",
    toolCall: sampleCall({
      id: "tool_pr",
      toolName: "bash",
      args: { command: prCommand },
      result: {
        content:
          "https://github.com/example/nerve/pull/423\n## fix/retain-resolved-plan-review-cards...origin/fix/retain-resolved-plan-review-cards",
      },
    }),
  },
  {
    kind: "message",
    key: "m2",
    item: {
      id: "m2",
      role: "assistant",
      text: assistantMarkdown,
      createdAt: stamp,
      done: true,
    },
  },
];
const commandStatusOutput = " M src/app.ts\n?? notes.md";
const commandTestOutput = "FAIL src/store.test.ts\n  expected 3, received 2";
</script>

{#snippet guarded(error: unknown)}
  <p class="text-ui text-destructive" role="alert">
    Specimen failed to render: {error instanceof Error
      ? error.message
      : String(error)}
  </p>
{/snippet}

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="In context: transcript column"
    description="A 760px transcript as in the app: user prompt, thinking, bash tool card, assistant markdown summary."
  >
    <GallerySpecimen
      title="TranscriptList"
      description="Real virtualized list; the tool card comes from the tool fixtures."
      source="presentation/transcript/TranscriptList"
      usage="1 file · conversation"
      layout="bare"
    >
      <div
        class="mx-auto h-[800px] w-[760px] max-w-full overflow-hidden rounded-md border bg-background"
      >
        <svelte:boundary failed={guarded}>
          <TranscriptList
            heightCacheKey="gallery-conversation-context"
            timelinePrefix={contextTimeline}
            timelineTail={[]}
            streamingText=""
            sending={false}
            runActivity={{ stopping: false }}
            queuedPrompts={[queued("q1", "After that, also bump the version.")]}
            {transcriptMenu}
            onContinueFromFailure={noop}
            onOpenTask={noop}
            onOpenFile={noop}
          />
        </svelte:boundary>
      </div>
      <p class="mt-2 text-ui text-muted-foreground">
        Working directory {SAMPLE_CWD}
      </p>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="User messages"
    description="Prompt rows in the transcript: delivered, queued, starting and failed."
  >
    <GallerySpecimen
      title="UserPromptRow"
      description="Delivered (long path wraps), queued with hover actions, optimistic starting, failed with provider error."
      source="presentation/transcript/UserPromptRow"
      usage="1 file · conversation"
      layout="stack"
      class="mx-auto w-[760px] max-w-full"
    >
      <UserPromptRow item={messageItem({ id: "u1" })} {transcriptMenu} />
      <UserPromptRow
        item={messageItem({ id: "u0", text: longPrompt })}
        {transcriptMenu}
      />
      <UserPromptRow
        prompt={queued("q1", "Queued follow-up prompt")}
        onForcePush={noop}
        onDiscard={noop}
        onMoveToComposer={noop}
        {transcriptMenu}
      />
      <UserPromptRow
        prompt={queued("q2", "Starting soon…", "starting")}
        item={messageItem({
          id: "u2",
          optimistic: true,
          text: "Starting soon…",
        })}
        {transcriptMenu}
      />
      <UserPromptRow
        item={messageItem({
          id: "u3",
          stopReason: "error",
          errorMessage: "Provider returned HTTP 500.",
        })}
        {transcriptMenu}
      />
    </GallerySpecimen>

    <GallerySpecimen
      title="UserMessageContent"
      description="Inline command results, and raw / pending / per-command-prepared command blocks."
      source="presentation/transcript/UserMessageContent"
      usage="1 file · conversation"
      layout="stack"
      surface="card"
    >
      <UserMessageContent text={commandResultText} />
      <UserMessageContent text={rawCommandText} pending />
      <UserMessageContent
        text={rawCommandText}
        commandPreparation={preparation}
      />
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Assistant output"
    description="Assistant prose is markdown rendered straight on the transcript background; thinking is quiet italic markdown."
  >
    <GallerySpecimen
      title="Assistant markdown"
      description="Paragraph with link, bullet list with inline code, local file link, code block and table."
      source="renderers/markdown/Markdown"
      usage="8 files · conversation, tools, git, editor"
      layout="bare"
    >
      <div class="mx-auto w-[760px] max-w-full p-3">
        <Markdown text={assistantMarkdown} reveal onOpenFile={noop} />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="ThinkingGroup"
      description="Completed and live (breathing caret)."
      source="presentation/transcript/ThinkingGroup"
      usage="1 file · conversation"
      layout="stack"
      class="mx-auto w-[760px] max-w-full"
    >
      <ThinkingGroup items={thinkingDone} />
      <ThinkingGroup items={thinkingLive} />
    </GallerySpecimen>

    <GallerySpecimen
      title="CommandBlockCard"
      description="Running, done ok, done failed."
      source="presentation/transcript/CommandBlockCard"
      usage="1 file · conversation"
      layout="stack"
      class="mx-auto w-[760px] max-w-full"
    >
      <CommandBlockCard command="pnpm install" phase="running" />
      <CommandBlockCard
        command="git status --short"
        phase="done"
        status="completed"
        exitCode={0}
        output={commandStatusOutput}
      />
      <CommandBlockCard
        command="pnpm test"
        phase="done"
        status="completed"
        exitCode={1}
        output={commandTestOutput}
      />
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Notices"
    description="System events share the tool-card anatomy. None appeared in the surveyed conversations, but the code renders them."
  >
    <GallerySpecimen
      title="RunStatusNoticeCard"
      description="Retrying, failed (Continue), interrupted."
      source="presentation/transcript/notice/RunStatusNoticeCard"
      usage="1 file · conversation"
      layout="stack"
      class="mx-auto w-[760px] max-w-full"
    >
      {#each runStatuses as notice (notice.state)}
        <RunStatusNoticeCard
          {notice}
          isLast
          sending={false}
          onContinueFromFailure={noop}
        />
      {/each}
    </GallerySpecimen>

    <GallerySpecimen
      title="TaskNoticeCard"
      description="Completed and exited non-zero."
      source="presentation/transcript/notice/TaskNoticeCard"
      usage="1 file · conversation"
      layout="stack"
      class="mx-auto w-[760px] max-w-full"
    >
      {#each taskNotices as notice (notice.taskId)}
        <TaskNoticeCard {notice} onOpenTask={noop} />
      {/each}
    </GallerySpecimen>

    <GallerySpecimen
      title="CompactionNoticeCard"
      description="Running, completed, failed."
      source="presentation/transcript/notice/CompactionNoticeCard"
      usage="1 file · conversation"
      layout="stack"
      class="mx-auto w-[760px] max-w-full"
    >
      {#each compactions as notice (notice.id)}
        <CompactionNoticeCard {notice} />
      {/each}
    </GallerySpecimen>

    <GallerySpecimen
      title="SystemEventNoticeCard"
      description="Branch summary and sub-agent completed."
      source="presentation/transcript/notice/SystemEventNoticeCard"
      usage="1 file · conversation"
      layout="stack"
      class="mx-auto w-[760px] max-w-full"
    >
      {#each systemNotices as notice (notice.entryId)}
        <SystemEventNoticeCard {notice} onOpenFile={noop} />
      {/each}
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Run activity"
    description="Persistent tail row under the transcript while an agent works."
  >
    <GallerySpecimen
      title="RunActivitySlot"
      description="Active, retry countdown, waiting with pending chips, done."
      source="presentation/transcript/activity/RunActivitySlot"
      usage="1 file · conversation"
      layout="stack"
      class="mx-auto w-[760px] max-w-full"
    >
      {#each activityViews as item (item.title)}
        <div class="flex flex-col">
          <span class="px-3 text-ui text-muted-foreground">{item.title}</span>
          <RunActivitySlot view={item.view} onOpenPending={noop} />
        </div>
      {/each}
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Conversation chrome"
    description="Banner, empty states and the launchpad signal."
  >
    <GallerySpecimen
      title="ConversationWelcome"
      description="Center area with no tab open: the real launchpad with Plan/Code starters. Without a project the starters are disabled."
      source="features/conversations/views/ConversationWelcome"
      usage="1 file · conversation"
      layout="bare"
    >
      <div class="grid gap-4 xl:grid-cols-2">
        <div class="h-96 rounded-md border bg-background">
          <ConversationWelcome
            projectSelected
            projectLabel={welcomeLabel}
            projectPath={welcomeProject.dir}
            onNewChat={noop}
          />
        </div>
        <div class="h-96 rounded-md border bg-background">
          <ConversationWelcome onNewChat={noop} />
        </div>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="New conversation"
      description="A fresh conversation tab (the + button): the real TranscriptList with an empty timeline."
      source="presentation/transcript/TranscriptList"
      usage="1 file · conversation"
      layout="bare"
    >
      <div
        class="mx-auto h-96 w-[760px] max-w-full overflow-hidden rounded-md border bg-background"
      >
        <TranscriptList
          heightCacheKey="gallery-conversation-empty"
          timelinePrefix={[]}
          timelineTail={[]}
          streamingText=""
          sending={false}
          runActivity={{ stopping: false }}
          queuedPrompts={[]}
          activeProject={welcomeProject}
          activeProjectLabel={welcomeLabel}
          {transcriptMenu}
        />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="ConversationBanner"
      description="Muted and warning tones."
      source="presentation/conversations/ConversationBanner"
      usage="1 file · conversation"
      layout="stack"
    >
      <div class="overflow-hidden rounded-md border">
        <ConversationBanner
          title="Read-only"
          message="This conversation belongs to another host."
        />
        <ConversationBanner
          tone="warning"
          title="Offline"
          message="Changes will sync when the daemon reconnects."
        />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="ConversationEmptyState"
      source="presentation/conversations/ConversationEmptyState"
      usage="1 file · conversation"
      layout="bare"
    >
      <div class="mx-auto h-56 w-[760px] max-w-full rounded-md border">
        <ConversationEmptyState />
      </div>
    </GallerySpecimen>
  </GalleryGroup>
  <GalleryGroup title="Shared presentation">
    <GallerySpecimen
      title="UserMessageBubble"
      source="presentation/transcript/UserMessageBubble.svelte"
      layout="stack"
    >
      <UserMessageBubble text="Fix the failing reconnect test." />
      <UserMessageBubble text="Then add a regression test." queued />
    </GallerySpecimen>
    <GallerySpecimen
      title="NoticeCard"
      source="presentation/transcript/notice/NoticeCard.svelte"
      layout="stack"
    >
      <NoticeCard
        notice={{
          kind: "task",
          tone: "success",
          glyph: "bell",
          badge: "task_completed",
          arg: "Unit tests",
          statusLabel: "Completed",
          summary: "All 12 unit tests passed.",
        }}
      />
      <NoticeCard
        notice={{
          kind: "run",
          tone: "destructive",
          glyph: "bell-dot",
          badge: "run_failed",
          statusLabel: "Failed",
          error: "Provider connection lost. Try again.",
        }}
      />
    </GallerySpecimen>
    <GallerySpecimen
      title="TranscriptContextMenu"
      source="presentation/transcript/TranscriptContextMenu.svelte"
      description="Right-click the paragraph to open the transcript menu."
      layout="stack"
    >
      <TranscriptContextMenu
        target={{ kind: "message", item: messageItem() }}
        menu={transcriptMenu}
        ><p>
          Right-click this transcript paragraph to copy it or its selected text.
        </p></TranscriptContextMenu
      >
    </GallerySpecimen>
  </GalleryGroup>
</div>
