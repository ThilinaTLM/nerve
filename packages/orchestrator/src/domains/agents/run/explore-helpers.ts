import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  AgentRecord,
  ExploreStepPayload,
  ExploreUsageStatsPayload,
  ModelSelection,
} from "@nerve/shared";
import { promptText } from "../../../prompt-text.js";
import type { ExploreProgressUpdate } from "../../tools/tool-service.js";
import type {
  ExploreReport,
  ExploreRunPlan,
  ExploreTask,
  SubagentRunOutput,
  SubagentRunSpec,
} from "./subagent-runner.js";

const EXPLORE_CONTEXT_MIN_LENGTH = 40;
const EXPLORE_TASK_MIN_LENGTH = 15;
const EXPLORE_SPLIT_RATIONALE_MIN_LENGTH = 40;
const EXPLORE_MAX_PARALLEL_TASKS = 5;
const EXPLORE_MAX_RECORDED_STEPS = 50;

export function exploreRunPlanArg(
  args: Record<string, unknown>,
): ExploreRunPlan {
  const hasTask = typeof args.task === "string" && args.task.trim().length > 0;
  const hasTasks = Array.isArray(args.tasks);
  if (hasTask === hasTasks) {
    throw new Error("Explore requires exactly one of 'task' or 'tasks'.");
  }

  const context = optionalString(args.context);
  if (!context || context.length < EXPLORE_CONTEXT_MIN_LENGTH) {
    throw new Error(
      "Explore requires context summarizing the parent agent's initial grep/find/read work, what it found, and what remains unclear.",
    );
  }

  if (hasTask) {
    const task = String(args.task).trim();
    validateExploreTask(task, "Task");
    return {
      mode: "single",
      context,
      tasks: [{ task, label: optionalString(args.label) }],
    };
  }

  const tasks = args.tasks as unknown[];
  if (tasks.length < 2) {
    throw new Error(
      "Parallel explore requires at least 2 tasks. Use 'task' for single-agent exploration.",
    );
  }
  if (tasks.length > EXPLORE_MAX_PARALLEL_TASKS) {
    throw new Error(
      `Explore supports at most ${EXPLORE_MAX_PARALLEL_TASKS} parallel tasks.`,
    );
  }

  const splitRationale = optionalString(args.split_rationale);
  if (
    !splitRationale ||
    splitRationale.length < EXPLORE_SPLIT_RATIONALE_MIN_LENGTH
  ) {
    throw new Error(
      "Parallel explore requires split_rationale explaining why the tasks are independent and why this is the right number of sub-agents.",
    );
  }

  const normalized = tasks.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Explore task ${index + 1} must be an object.`);
    }
    const record = item as Record<string, unknown>;
    const task = optionalString(record.task);
    if (!task) throw new Error(`Explore task ${index + 1} requires 'task'.`);
    validateExploreTask(task, `Task ${index + 1}`);
    return { task, label: optionalString(record.label) };
  });

  const dedupeKeys = normalized.map((task) =>
    normalizeTaskForDedupe(task.task),
  );
  if (new Set(dedupeKeys).size !== dedupeKeys.length) {
    throw new Error("Parallel explore tasks must be distinct.");
  }

  return { mode: "parallel", context, splitRationale, tasks: normalized };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

export function abortError(): Error {
  const error = new Error("Agent run aborted.");
  error.name = "AbortError";
  return error;
}

function validateExploreTask(task: string, label: string): void {
  if (task.trim().length < EXPLORE_TASK_MIN_LENGTH) {
    throw new Error(
      `${label} is too vague. Make it specific enough for a child agent to investigate independently.`,
    );
  }
}

function normalizeTaskForDedupe(task: string): string {
  return task.toLowerCase().replace(/\s+/g, " ").trim();
}

export function exploreUserPrompt(
  task: ExploreTask,
  plan: ExploreRunPlan,
): string {
  return [
    task.label ? `Exploration label: ${task.label}` : undefined,
    "Parent agent context:",
    plan.context,
    plan.splitRationale
      ? ["", "Parallel split rationale:", plan.splitRationale].join("\n")
      : undefined,
    "",
    "Exploration task:",
    task.task,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export function publishExploreProgress(
  onProgress: ((update: ExploreProgressUpdate) => void) | undefined,
  update: Omit<ExploreProgressUpdate, "type" | "timestamp">,
): void {
  onProgress?.({
    type: "explore_progress",
    timestamp: new Date().toISOString(),
    ...update,
  });
}

/** Display label for the sub-agent's model, e.g. `provider/model-id`. */
export function exploreModelLabel(
  selection: ModelSelection | undefined,
): string | undefined {
  return selection ? `${selection.provider}/${selection.modelId}` : undefined;
}

export function exploreProgressFromHarnessEvent(
  event: unknown,
  child: AgentRecord,
  spec: SubagentRunSpec,
): Omit<ExploreProgressUpdate, "type" | "timestamp"> | undefined {
  if (!event || typeof event !== "object") return undefined;
  const record = event as Record<string, unknown>;
  const base = {
    agentId: child.id,
    taskIndex: spec.taskIndex,
    taskCount: spec.taskCount,
    label: spec.label,
    model: exploreModelLabel(child.model),
  };
  if (record.type === "tool_call") {
    const toolName =
      typeof record.toolName === "string" ? record.toolName : "tool";
    return {
      ...base,
      phase: "tool_call",
      message: summarizeToolCall(toolName, asRecord(record.input) ?? {}),
    };
  }
  if (record.type === "tool_result") {
    const toolName =
      typeof record.toolName === "string" ? record.toolName : "tool";
    return {
      ...base,
      phase: "tool_result",
      message: summarizeToolResult(toolName, record.details),
    };
  }
  if (
    record.type === "message_start" &&
    messageRole(record.message) === "assistant"
  ) {
    return {
      ...base,
      phase: "assistant",
      message: "Assistant response started.",
    };
  }
  return undefined;
}

function summarizeToolCall(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case "read":
      return `read ${stringValue(args.path) ?? "file"}${rangeSuffix(args)}`;
    case "grep":
      return `grep ${quoteValue(args.pattern)}${pathSuffix(args)}`;
    case "find":
      return `find ${quoteValue(args.pattern)}${pathSuffix(args)}`;
    case "ls":
      return `list ${stringValue(args.path) ?? "."}`;
    case "task_logs":
      return `inspect task logs${stringValue(args.mode) ? ` (${stringValue(args.mode)})` : ""}`;
    case "task_list":
      return "list managed tasks";
    default:
      return `ran ${toolName}`;
  }
}

function summarizeToolResult(toolName: string, details: unknown): string {
  const result = asRecord(asRecord(details)?.result);
  if (toolName === "grep") {
    const matches = Array.isArray(result?.matches)
      ? result.matches.length
      : undefined;
    return matches === undefined
      ? "grep completed"
      : `grep completed with ${matches} matches`;
  }
  if (toolName === "find") {
    const entries = Array.isArray(result?.entries)
      ? result.entries.length
      : undefined;
    return entries === undefined
      ? "find completed"
      : `find completed with ${entries} paths`;
  }
  if (toolName === "ls") {
    const entries = Array.isArray(result?.entries)
      ? result.entries.length
      : undefined;
    return entries === undefined
      ? "list completed"
      : `list completed with ${entries} entries`;
  }
  if (toolName === "read") return "read completed";
  return `${toolName} completed`;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function emptyExploreUsage(): ExploreUsageStatsPayload {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: 0,
    turns: 0,
  };
}

export function addExploreUsage(
  a: ExploreUsageStatsPayload,
  b: ExploreUsageStatsPayload,
): ExploreUsageStatsPayload {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: Math.max(a.totalTokens, b.totalTokens),
    cost: a.cost + b.cost,
    turns: a.turns + b.turns,
  };
}

export function pushExploreStep(
  steps: ExploreStepPayload[],
  step: ExploreStepPayload,
): void {
  steps.push(step);
  if (steps.length > EXPLORE_MAX_RECORDED_STEPS) steps.shift();
}

export function toolNameFromHarnessEvent(event: unknown): string | undefined {
  return stringValue(asRecord(event)?.toolName);
}

export function exploreAssistantMetadata(message: AssistantMessage): {
  usage?: ExploreUsageStatsPayload;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
} {
  const usageRecord = asRecord((message as { usage?: unknown }).usage);
  const cost = asRecord(usageRecord?.cost);
  return {
    usage: usageRecord
      ? {
          input: numberValue(usageRecord.input),
          output: numberValue(usageRecord.output),
          cacheRead: numberValue(usageRecord.cacheRead),
          cacheWrite: numberValue(usageRecord.cacheWrite),
          totalTokens:
            numberValue(usageRecord.totalTokens) ||
            numberValue(usageRecord.input) +
              numberValue(usageRecord.output) +
              numberValue(usageRecord.cacheRead) +
              numberValue(usageRecord.cacheWrite),
          cost: numberValue(cost?.total),
          turns: 1,
        }
      : undefined,
    model: stringValue((message as { model?: unknown }).model),
    stopReason: stringValue((message as { stopReason?: unknown }).stopReason),
    errorMessage: stringValue(
      (message as { errorMessage?: unknown }).errorMessage,
    ),
  };
}

function quoteValue(value: unknown): string {
  const text = stringValue(value);
  return text ? JSON.stringify(truncateInline(text, 80)) : "pattern";
}

function pathSuffix(args: Record<string, unknown>): string {
  const path = stringValue(args.path);
  const paths = Array.isArray(args.paths)
    ? args.paths.filter((value) => typeof value === "string")
    : [];
  if (path) return ` in ${path}`;
  if (paths.length > 0) return ` in ${paths.length} paths`;
  return "";
}

function rangeSuffix(args: Record<string, unknown>): string {
  const offset = typeof args.offset === "number" ? args.offset : undefined;
  const limit = typeof args.limit === "number" ? args.limit : undefined;
  if (offset === undefined && limit === undefined) return "";
  return ` (${offset ?? 1}${limit ? `+${limit}` : ""})`;
}

export function messageRole(message: unknown): string | undefined {
  return asRecord(message)?.role as string | undefined;
}

export function safeReportFileName(
  labelOrTask: string,
  index: number,
  agentId: string,
): string {
  const slug = labelOrTask
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${String(index + 1).padStart(2, "0")}-${slug || "explore"}-${agentId}.md`;
}

export function formatExploreReportFile(
  task: ExploreTask,
  plan: ExploreRunPlan,
  output: SubagentRunOutput,
): string {
  return [
    `# Explore report: ${task.label ?? task.task}`,
    "",
    `- Child agent: \`${output.agent.id}\``,
    `- Created: ${new Date().toISOString()}`,
    `- Mode: ${plan.mode}`,
    `- Status: ${output.status}`,
    output.model ? `- Model: ${output.model}` : undefined,
    output.stopReason ? `- Stop reason: ${output.stopReason}` : undefined,
    output.errorMessage ? `- Error: ${output.errorMessage}` : undefined,
    output.usage ? `- Usage: ${formatExploreUsage(output.usage)}` : undefined,
    `- Task: ${task.task}`,
    `- Context: ${plan.context}`,
    plan.splitRationale
      ? `- Split rationale: ${plan.splitRationale}`
      : undefined,
    "",
    "---",
    "",
    output.report,
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function formatExploreUsage(usage: ExploreUsageStatsPayload): string {
  const parts: string[] = [];
  if (usage.turns)
    parts.push(`${usage.turns} turn${usage.turns === 1 ? "" : "s"}`);
  if (usage.input) parts.push(`input ${usage.input}`);
  if (usage.output) parts.push(`output ${usage.output}`);
  if (usage.cacheRead) parts.push(`cache read ${usage.cacheRead}`);
  if (usage.cacheWrite) parts.push(`cache write ${usage.cacheWrite}`);
  if (usage.totalTokens) parts.push(`context ${usage.totalTokens}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  return parts.join(", ") || "none";
}

export function formatExploreFailureReport(errorMessage: string): string {
  return [
    "# Findings",
    "",
    "## Summary",
    "- Explore agent failed before producing a successful report.",
    "",
    "## Relevant files",
    "- None identified before failure.",
    "",
    "## Architecture notes",
    "- Not available because the child agent run failed.",
    "",
    "## Evidence",
    `- Error: ${errorMessage}`,
    "",
    "## Open questions / risks",
    "- Re-run the focused exploration or inspect the child conversation for partial progress.",
  ].join("\n");
}

export function summaryPreview(report: string): string {
  return truncateInline(
    report
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .filter((line) => line && !line.startsWith("- `"))
      .slice(0, 4)
      .join(" "),
    280,
  );
}

function truncateInline(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

export function exploreSystemPrompt(): string {
  return promptText`
    You are an Explore Agent specialized in reading and mapping codebases for a parent coding agent.
    Your job is to investigate the assigned area thoroughly using only the read-only tools made available to you.
    You cannot edit files, write files, run shell commands, start tasks, cancel tasks, ask the user questions, or change runtime state.
    Strategy:
    1. Start with grep/find/ls to locate relevant code quickly.
    2. Read targeted sections, not entire files, unless the file is small and central.
    3. Follow imports, references, call sites, tests, and schema definitions to understand connections.
    4. Gather concrete evidence from file paths, symbols, and nearby code.
    5. Stay scoped to the assigned task; if the task is broad, sample intelligently and call out gaps.
    6. Do not ask the user questions; make reasonable assumptions and state them.
    Return a concise but useful report in exactly this markdown structure:

    # Findings

    ## Summary
    - One to five bullets with the key answer.

    ## Relevant files
    - \`path/to/file\`: why it matters.

    ## Architecture notes
    - Important flows, ownership boundaries, data shapes, or extension points.

    ## Evidence
    - \`path/to/file:line-or-symbol\` — specific observation.

    ## Open questions / risks
    - Unknowns, ambiguity, or follow-up checks. Use \`None\` if there are none.
  `;
}

export function assistantMessageText(message: AssistantMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const record = block as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function formatExploreReports(reports: ExploreReport[]): string {
  if (reports.length === 1) {
    const report = reports[0];
    return [`Explore report from ${report.agentId}`, "", report.report].join(
      "\n",
    );
  }
  return reports
    .map((report, index) =>
      [
        `# Explore report ${index + 1}: ${report.label ?? report.task}`,
        "",
        `Child agent: ${report.agentId}`,
        `Status: ${report.status}`,
        "",
        report.report,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}
