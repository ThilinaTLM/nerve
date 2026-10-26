/**
 * Static sample data for the ToolCards gallery section. Everything here is a
 * pure product of the presentation-owned record types, so cards render with no
 * daemon, store, or transport behind them.
 */
import type {
  ApprovalWithToolCall,
  ToolCallDetails,
  ToolCallRecord,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "$lib/presentation/state/tool-types";
import type { ToolDraftViewModel } from "$lib/presentation/state/active-run";
import type { ConversationLiveToolOutputSnapshot } from "$lib/presentation/view-models/conversation";
import type { PlanReviewRecord } from "$lib/presentation/state/tool-types";

export const SAMPLE_CWD = "/home/dev/nerve";

const CONVERSATION_ID = "conv_gallery";
const AGENT_ID = "agent_gallery";
const PROJECT_ID = "proj_gallery";

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

type CallInput = {
  id: string;
  toolName: string;
  status?: ToolCallTranscriptRecord["status"];
  args?: unknown;
  result?: unknown;
  error?: string;
  /** Milliseconds the call has existed; drives the live elapsed chip. */
  ageMs?: number;
  interaction?: ToolCallTranscriptRecord["interaction"];
  execution?: ToolCallTranscriptRecord["execution"];
  previewOverflow?: ToolCallTranscriptRecord["previewOverflow"];
  supervision?: ToolCallTranscriptRecord["supervision"];
  /** Open call still being checked by the supervisor. */
  supervising?: boolean;
  /** Execution time of a settled call; sets `startedAt`/`settledAt`. */
  durationMs?: number;
};

export function sampleCall(input: CallInput): ToolCallTranscriptRecord {
  const created = isoAgo(input.ageMs ?? 4_000);
  const status = input.status ?? "completed";
  // Settled calls carry an execution window so the lead chip shows a duration.
  const settled = ["completed", "failed", "cancelled"].includes(status);
  const durationMs = input.durationMs ?? (settled ? 1_300 : undefined);
  return {
    id: input.id,
    agentId: AGENT_ID,
    conversationId: CONVERSATION_ID,
    projectId: PROJECT_ID,
    toolName: input.toolName,
    cwd: SAMPLE_CWD,
    status: input.status ?? "completed",
    revision: 1,
    attempt: 1,
    createdAt: created,
    updatedAt: created,
    argsPreview: input.args,
    resultPreview: input.result,
    error: input.error,
    interaction: input.interaction,
    execution: input.execution,
    previewOverflow: input.previewOverflow,
    supervision: input.supervision,
    supervising: input.supervising,
    ...(durationMs === undefined
      ? {}
      : {
          startedAt: created,
          settledAt: new Date(Date.parse(created) + durationMs).toISOString(),
        }),
  };
}

const approvedDestructive = {
  decision: "approval",
  effectiveRisk: "destructive",
} as const;

/** Full (non-preview) record, as the details dialog fetches it. */
export function sampleDetails(call: ToolCallTranscriptRecord): ToolCallDetails {
  const { argsPreview, resultPreview, previewOverflow, ...rest } = call;
  void previewOverflow;
  const full: ToolCallRecord = {
    ...rest,
    args: argsPreview,
    result: resultPreview,
  };
  const byteLength = JSON.stringify(resultPreview ?? null).length;
  return {
    toolCall: full,
    completeResult: {
      status: "inline",
      hasResult: resultPreview !== undefined,
      byteLength,
      mediaType: "application/json",
      encoding: "utf-8",
    },
  };
}

export function sampleDraft(input: {
  toolName: string;
  argsText: string;
  done?: boolean;
  args?: Record<string, unknown>;
}): ToolDraftViewModel {
  return {
    key: `tool-slot:live_${input.toolName}:0`,
    runId: "run_gallery",
    conversationId: CONVERSATION_ID,
    turnId: "turn_gallery",
    liveMessageId: `live_${input.toolName}`,
    messageOrdinal: 1,
    startedAt: isoAgo(2_000),
    block: {
      kind: "tool_call_draft",
      contentBlockId: `block_${input.toolName}`,
      contentIndex: 0,
      toolName: input.toolName,
      argsText: input.argsText,
      args: input.args,
      progressRevision: 1,
      done: input.done ?? false,
    },
  };
}

export function sampleLiveOutput(
  toolCallId: string,
  text: string,
  extra: Partial<ConversationLiveToolOutputSnapshot> = {},
): ConversationLiveToolOutputSnapshot {
  return {
    toolCallId,
    text,
    updatedAt: new Date().toISOString(),
    chunks: [{ stream: "stdout", text, ts: new Date().toISOString() }],
    ...extra,
  };
}

export function sampleApproval(
  toolCallId: string,
  options: {
    risk?: ApprovalWithToolCall["risk"];
    reason: string;
    persistent?: boolean;
    toolName?: string;
    pattern?: string;
  },
): ApprovalWithToolCall {
  const toolName = options.toolName ?? "bash";
  return {
    toolCallId,
    agentId: AGENT_ID,
    conversationId: CONVERSATION_ID,
    projectId: PROJECT_ID,
    risk: options.risk,
    reason: options.reason,
    status: "pending",
    requestedAt: isoAgo(1_500),
    offeredScopes: options.persistent
      ? ["single_call", "always_conversation", "always_project", "always_user"]
      : ["single_call"],
    suggestedExceptions: [],
    suggestedRules: options.persistent
      ? [
          {
            id: `rule_${toolCallId}`,
            enabled: true,
            priority: 10,
            enforcement: "overridable",
            when: {
              toolNames: [toolName],
              primaryArgument: {
                operator: "equals",
                value: options.pattern ?? "pnpm test",
              },
            },
            decision: "allow",
          },
        ]
      : [],
    permissionRuleSetId: options.persistent ? "coding_default" : undefined,
  };
}

// ---------------------------------------------------------------------------
// Shared payload helpers
// ---------------------------------------------------------------------------

const text = (value: string) => ({ content: value });

export const LONG_COMMAND =
  "pnpm exec tsx --test packages/workbench-app/src/lib/presentation/tools/views/tool-activity-state.test.ts packages/workbench-app/src/lib/presentation/tools/views/tool-draft-progress.test.ts packages/workbench-app/src/lib/presentation/tools/lifecycle/registry.test.ts";

const TEST_OUTPUT = `▶ tool lifecycle visual stage
  ✔ shows cancellation separately from failure without pulsing (1.2ms)
  ✔ keeps genuine recovery uncertainty ahead of terminal status (0.4ms)
▶ tool argument lifecycle
  ✔ hides rejected assignment context while retaining the error (0.9ms)
  ✔ keeps persistent argument bodies through completion (0.3ms)
ℹ tests 4
ℹ pass 4
ℹ fail 0
ℹ duration_ms 118.4`;

const FAILING_TEST_OUTPUT = `▶ registry
  ✔ resolves every catalog tool (0.8ms)
  ✖ presents unknown tools conservatively (2.1ms)
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    + actual - expected
    + 'tool'
    - 'recorded tool'
ℹ tests 2
ℹ pass 1
ℹ fail 1`;

const LONG_OUTPUT = Array.from(
  { length: 42 },
  (_, index) =>
    `[${String(index + 1).padStart(2, "0")}] compiled src/lib/presentation/tools/tool-call/Module${index}.svelte in ${(index % 7) + 3}ms`,
).join("\n");

// ---------------------------------------------------------------------------
// Per-tool fixtures
// ---------------------------------------------------------------------------

export const bashCompleted = sampleCall({
  id: "tool_bash_ok",
  toolName: "bash",
  args: { command: "pnpm exec tsx --test tool-activity-state.test.ts" },
  result: text(TEST_OUTPUT),
  durationMs: 4_200,
});

/** Approval was required, then granted: the risk chip stays after completion. */
export const bashCompletedAfterApproval = sampleCall({
  id: "tool_bash_ok_approved",
  toolName: "bash",
  args: { command: "rm -rf node_modules && pnpm install" },
  result: text(TEST_OUTPUT),
  durationMs: 18_400,
  supervision: approvedDestructive,
});

export const bashSupervising = sampleCall({
  id: "tool_bash_check",
  toolName: "bash",
  status: "committed",
  supervising: true,
  args: { command: "pnpm exec tsx --test registry.test.ts" },
});

export const bashQueued = sampleCall({
  id: "tool_bash_queued",
  toolName: "bash",
  status: "committed",
  args: { command: "pnpm build" },
  supervision: { decision: "approval", effectiveRisk: "command" },
});

export const bashLongCommand = sampleCall({
  id: "tool_bash_long",
  toolName: "bash",
  args: { command: LONG_COMMAND },
  result: text(TEST_OUTPUT),
});

export const bashNonZeroExit = sampleCall({
  id: "tool_bash_exit",
  toolName: "bash",
  args: { command: "pnpm exec tsx --test registry.test.ts" },
  result: { content: FAILING_TEST_OUTPUT, exitCode: 1 },
});

export const bashLongOutput = sampleCall({
  id: "tool_bash_longout",
  toolName: "bash",
  args: { command: "pnpm build" },
  result: text(LONG_OUTPUT),
});

export const bashRunning = sampleCall({
  id: "tool_bash_run",
  toolName: "bash",
  status: "running",
  ageMs: 47_000,
  args: { command: "pnpm build" },
});

export const bashRunningLive = sampleCall({
  id: "tool_bash_live",
  toolName: "bash",
  status: "running",
  ageMs: 12_000,
  args: { command: "pnpm build" },
});
export const bashLiveOutput = sampleLiveOutput(
  "tool_bash_live",
  LONG_OUTPUT.split("\n").slice(0, 14).join("\n"),
);
export const bashWaiting = sampleCall({
  id: "tool_bash_wait",
  toolName: "bash",
  status: "waiting",
  args: { command: "rm -rf node_modules && pnpm install" },
  supervision: approvedDestructive,
  interaction: {
    kind: "approval",
    status: "pending",
    requestedAt: isoAgo(2_000),
    updatedAt: isoAgo(2_000),
    request: {
      risk: "destructive",
      reason: "Deletes a directory tree inside the project.",
      offeredScopes: ["single_call"],
      suggestedExceptions: [],
      suggestedRules: [],
    },
  },
});
export const bashWaitingApproval = sampleApproval("tool_bash_wait", {
  risk: "destructive",
  reason: "Deletes a directory tree inside the project.",
});

export const bashWaitingPersistent = sampleCall({
  id: "tool_bash_wait2",
  toolName: "bash",
  status: "waiting",
  args: { command: "pnpm test" },
  supervision: { decision: "approval", effectiveRisk: "command" },
  interaction: {
    kind: "approval",
    status: "pending",
    requestedAt: isoAgo(2_000),
    updatedAt: isoAgo(2_000),
    request: {
      risk: "command",
      reason: "Runs a command in the project workspace.",
      offeredScopes: ["single_call", "always_project"],
      suggestedExceptions: [],
      suggestedRules: [],
    },
  },
});
export const bashWaitingPersistentApproval = sampleApproval("tool_bash_wait2", {
  risk: "command",
  reason: "Runs a command in the project workspace.",
  persistent: true,
});

export const bashFailed = sampleCall({
  id: "tool_bash_fail",
  toolName: "bash",
  status: "failed",
  durationMs: 840,
  args: { command: "pnpm exec tsx --test missing.test.ts" },
  error:
    "Command exited with code 1\nError: Cannot find module './missing.test.ts'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)\n    at Module._load (node:internal/modules/cjs/loader:1051:27)",
});

export const bashDraftStreaming = sampleDraft({
  toolName: "bash",
  argsText: '{"command":"pnpm exec tsx --test src/lib/presentation/tools/vie',
  args: { command: "pnpm exec tsx --test src/lib/presentation/tools/vie" },
});

const askUserSingleQuestion = {
  id: "location",
  question: "Should the gallery live under $lib/app or $lib/presentation?",
  context:
    "The gallery imports presentation, ui-kit and contracts, but nothing from features.",
  recommendation: "$lib/app — it is allowed to import presentation.",
  options: [
    {
      label: "$lib/app",
      description: "May import presentation",
      recommended: true,
    },
    { label: "$lib/presentation", description: "Stays stateless" },
  ],
};
const askUserMultiQuestions = [
  askUserSingleQuestion,
  {
    id: "tests",
    question: "Which tests should run before the change merges?",
    options: [
      { label: "Unit only" },
      { label: "Unit + browser", recommended: true },
    ],
  },
  { id: "notes", question: "Anything else the gallery should cover?" },
];

const askUserInteraction = (
  status: "pending" | "resolved" | "cancelled",
  questions: ReadonlyArray<(typeof askUserMultiQuestions)[number]>,
): ToolCallTranscriptRecord["interaction"] => ({
  kind: "user_input",
  status,
  requestedAt: isoAgo(5_000),
  updatedAt: isoAgo(1_000),
  request: { questions: [...questions], required: true },
});

export const askUserPending = sampleCall({
  id: "tool_ask_wait",
  toolName: "ask_user",
  status: "waiting",
  args: { questions: [askUserSingleQuestion] },
  interaction: askUserInteraction("pending", [askUserSingleQuestion]),
});
export const askUserQuestion: UserQuestionRecord = {
  toolCallId: "tool_ask_wait",
  agentId: AGENT_ID,
  conversationId: CONVERSATION_ID,
  projectId: PROJECT_ID,
  questions: [askUserSingleQuestion],
  status: "pending",
  requestedAt: isoAgo(5_000),
  updatedAt: isoAgo(1_000),
};

export const askUserMultiPending = sampleCall({
  id: "tool_ask_multi",
  toolName: "ask_user",
  status: "waiting",
  args: { questions: askUserMultiQuestions },
  interaction: askUserInteraction("pending", askUserMultiQuestions),
});
export const askUserMultiQuestion: UserQuestionRecord = {
  toolCallId: "tool_ask_multi",
  agentId: AGENT_ID,
  conversationId: CONVERSATION_ID,
  projectId: PROJECT_ID,
  questions: askUserMultiQuestions,
  status: "pending",
  requestedAt: isoAgo(5_000),
  updatedAt: isoAgo(1_000),
};

export const askUserAnswered = sampleCall({
  id: "tool_ask_ok",
  toolName: "ask_user",
  args: { questions: askUserMultiQuestions },
  result: {
    questions: [
      {
        id: "location",
        question: askUserSingleQuestion.question,
        answer: {
          option: "$lib/app",
          text: "Keep the gallery out of features.",
        },
      },
      {
        id: "tests",
        question: askUserMultiQuestions[1].question,
        skipped: true,
      },
      {
        id: "notes",
        question: askUserMultiQuestions[2].question,
        answer: { text: "Cover the voice states too." },
      },
    ],
  },
});

export const askUserDismissed = sampleCall({
  id: "tool_ask_dismissed",
  toolName: "ask_user",
  args: { questions: [askUserSingleQuestion] },
  result: {
    questions: [{ id: "location", question: askUserSingleQuestion.question }],
    dismissed: true,
  },
});

/** Legacy flat call and result, as persisted before multi-question support. */
export const askUserLegacy = sampleCall({
  id: "tool_ask_legacy",
  toolName: "ask_user",
  args: { question: "Which package manager should the script use?" },
  result: {
    question: "Which package manager should the script use?",
    response: "pnpm — the workspace is already pinned to it.",
  },
});

export const askUserDraftStreaming = sampleDraft({
  toolName: "ask_user",
  argsText:
    '{"questions":[{"id":"location","question":"Should the gallery live under $lib/app or $lib/presentation?","options":[{"label":"$lib/app","description":"May import"},{"label":"$lib/pres',
});

const subagentAssignments = [
  {
    name: "reviewer",
    profile: "reviewer",
    prompt: "Review the diff in packages/ui-kit for token misuse.",
  },
  {
    name: "tester",
    profile: "coder",
    prompt: "Add focused unit tests for the new lifecycle indicator.",
  },
];

export const subagentRunning = sampleCall({
  id: "tool_sub_run",
  toolName: "subagent_prompt",
  status: "running",
  ageMs: 18_000,
  args: {
    context: "Polish pass: audit the shared UI kit before the gallery lands.",
    assignments: subagentAssignments,
  },
});

export const subagentPrompt = sampleCall({
  id: "tool_sub_prompt",
  toolName: "subagent_prompt",
  args: {
    context: "Polish pass: audit the shared UI kit before the gallery lands.",
    assignments: subagentAssignments,
  },
  result: {
    ...text(
      "reviewer (reviewer): created\ntester (coder): follow-up queued (running)",
    ),
    details: {
      assignments: [
        { name: "reviewer", profile: "reviewer", disposition: "created" },
        { name: "tester", profile: "coder", disposition: "follow_up" },
      ],
    },
  },
});

export const subagentPromptDraft = sampleDraft({
  toolName: "subagent_prompt",
  argsText:
    '{"context":"Polish pass: audit the shared UI kit before the gallery lands.","assignments":[{"name":"reviewer","profile":"reviewer","prompt":"Review the diff in packages/ui-kit for token',
});

export const subagentPromptRejected = sampleCall({
  id: "tool_sub_rejected",
  toolName: "subagent_prompt",
  args: { assignments: subagentAssignments },
  result: {
    ...text("reviewer (reviewer): created\ntester: rejected"),
    details: {
      assignments: [
        { name: "reviewer", profile: "reviewer", disposition: "created" },
        {
          name: "tester",
          profile: "coder",
          disposition: "rejected",
          reason: "Profile coder is unavailable in this project.",
        },
      ],
    },
  },
});

export const subagentStatus = sampleCall({
  id: "tool_sub_status",
  toolName: "subagent_status",
  args: {},
  result: {
    ...text(
      "reviewer · reviewer · running · ctx 34% · active 20s ago\ntester · coder · idle · ctx 12% · active 4m ago",
    ),
    details: {
      agents: [
        {
          name: "reviewer",
          profile: "reviewer",
          state: "running",
          contextPercent: 34,
          lastActivityAt: isoAgo(20_000),
        },
        {
          name: "tester",
          profile: "coder",
          state: "idle",
          contextPercent: 12,
          lastActivityAt: isoAgo(240_000),
        },
      ],
    },
  },
});

export const subagentStop = sampleCall({
  id: "tool_sub_stop",
  toolName: "subagent_stop",
  args: { names: ["reviewer", "tester", "ghost"] },
  result: {
    ...text("reviewer: stopped\ntester: already idle\nghost: not found"),
    details: {
      results: [
        { name: "reviewer", outcome: "stopped", runMs: 94_000 },
        { name: "tester", outcome: "already_idle" },
        { name: "ghost", outcome: "not_found" },
      ],
    },
  },
});

const PLAN_CONTENT = `## Plan: UI gallery

1. Scaffold the gallery route (dev only)
2. Register one section per component family
3. Audit sections for token violations

**Risks:** none — gallery code is excluded from production builds.`;

export const planPending = sampleCall({
  id: "tool_plan_wait",
  toolName: "plan_present",
  status: "waiting",
  args: { file_path: ".nerve/plans/ui-gallery.md" },
  interaction: {
    kind: "plan_review",
    status: "pending",
    requestedAt: isoAgo(4_000),
    updatedAt: isoAgo(4_000),
    request: {
      planPath: ".nerve/plans/ui-gallery.md",
      slug: "ui-gallery",
      allowNewConversation: true,
      title: "UI gallery",
      summary: PLAN_CONTENT,
    },
  },
});
export const planReview: PlanReviewRecord = {
  id: "plan_review_gallery",
  targetProfile: { name: "coding", digest: "a".repeat(64) },
  toolCallId: "tool_plan_wait",
  agentId: AGENT_ID,
  conversationId: CONVERSATION_ID,
  projectId: PROJECT_ID,
  slug: "ui-gallery",
  planPath: ".nerve/plans/ui-gallery.md",
  title: "UI gallery",
  summary: PLAN_CONTENT,
  content: PLAN_CONTENT,
  status: "pending",
  requestedAt: isoAgo(4_000),
  updatedAt: isoAgo(4_000),
} as PlanReviewRecord;

export const planAccepted = sampleCall({
  id: "tool_plan_ok",
  toolName: "plan_present",
  args: { file_path: ".nerve/plans/ui-gallery.md" },
  result: {
    outcome: "accepted",
    review: {
      id: "plan_review_gallery",
      targetProfile: { name: "coding", digest: "a".repeat(64) },
      status: "accepted",
      planPath: ".nerve/plans/ui-gallery.md",
      content: PLAN_CONTENT,
    },
    contentBlocks: [
      { type: "text", text: "Plan accepted. Begin implementation." },
    ],
  },
});
