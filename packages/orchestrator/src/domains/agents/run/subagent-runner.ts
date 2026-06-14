import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AgentHarness,
  Conversation,
  JsonlConversationStorage,
  NodeExecutionEnv,
  resolveAgentModel,
} from "@nerve/agent";
import type {
  AgentRecord,
  ConversationRecord,
  CreateAgentRequest,
  Mode,
  ModelSelection,
  PermissionLevel,
  ThinkingLevel,
  WorkspaceScope,
} from "@nerve/shared";
import { createId } from "@nerve/shared";
import type { AuthManager } from "../../../auth.js";
import type { EventBus } from "../../../infrastructure/events/index.js";
import {
  type InitializedStorage,
  pathExists,
} from "../../../infrastructure/storage/index.js";
import type { ApplicationLogger } from "../../../logging.js";
import { loadHarnessResources } from "../../../resource-loader.js";
import type { RuntimeState } from "../../../runtime/runtime-state.js";
import type { HarnessManager } from "../../conversations/harness-manager.js";
import {
  activeToolNamesForAgent,
  createAgentToolsForAgent,
} from "../../tools/agent-tool-adapter.js";
import type {
  ExploreProgressUpdate,
  ToolService,
} from "../../tools/tool-service.js";
import type { SubscriptionUsageService } from "../../usage/subscription-usage-service.js";
import type { AppendEntryFn } from "./message-mirror.js";

export type SubagentHistoryMode = "fresh" | "copy_parent";

export interface SubagentRunSpec {
  kind: string;
  parent: AgentRecord;
  projectId: string;
  projectDir: string;
  workerId?: string;
  mode: Mode;
  permissionLevel: PermissionLevel;
  prompt: string;
  systemPrompt: string;
  historyMode: SubagentHistoryMode;
  model?: ModelSelection;
  thinkingLevel?: ThinkingLevel;
  workspaceScope?: WorkspaceScope;
  task?: string;
  label?: string;
  taskIndex?: number;
  taskCount?: number;
  onProgress?: (update: ExploreProgressUpdate) => void;
}

export interface SubagentRunOutput {
  agent: AgentRecord;
  report: string;
}

export interface ExploreTask {
  task: string;
  context?: string;
  label?: string;
}

export interface ExploreReport {
  agentId: string;
  task: string;
  label?: string;
  report: string;
  reportPath: string;
  summaryPreview?: string;
}

export interface SubagentRunnerDeps {
  storage: InitializedStorage;
  events: EventBus;
  auth: AuthManager;
  tools: ToolService;
  harnessManager: HarnessManager;
  state: RuntimeState;
  createAgent: (
    request: CreateAgentRequest,
    options?: { allowChildAuthorityExceed?: boolean },
  ) => Promise<AgentRecord>;
  setAgentStatus: (
    agent: AgentRecord,
    status: AgentRecord["status"],
  ) => Promise<void>;
  appendEntry: AppendEntryFn;
  getConversation: (conversationId: string) => ConversationRecord;
  updateConversation: (conversation: ConversationRecord) => Promise<void>;
  subscriptionUsage: SubscriptionUsageService;
  logger: ApplicationLogger;
}

export class SubagentRunner {
  constructor(private readonly deps: SubagentRunnerDeps) {}

  async runExplore(
    parent: AgentRecord,
    args: Record<string, unknown>,
    options: { onProgress?: (update: ExploreProgressUpdate) => void } = {},
  ): Promise<{
    reports: ExploreReport[];
    contentBlocks: [{ type: "text"; text: string }];
  }> {
    const tasks = exploreTasksArg(args);
    const batchId = createId("run");
    publishExploreProgress(options.onProgress, {
      taskCount: tasks.length,
      phase: "queued",
      message: `Starting ${tasks.length} explore ${tasks.length === 1 ? "agent" : "agents"}.`,
    });
    const reports = await Promise.all(
      tasks.map(async (task, index) => {
        publishExploreProgress(options.onProgress, {
          taskIndex: index,
          taskCount: tasks.length,
          label: task.label,
          phase: "started",
          message: `Explore ${index + 1}/${tasks.length} started: ${task.label ?? task.task}`,
        });
        const output = await this.runSubagent({
          kind: "explore",
          parent,
          projectId: parent.projectId,
          projectDir: parent.projectDir,
          workerId: parent.workerId,
          mode: "coding",
          permissionLevel: "read_only",
          prompt: exploreUserPrompt(task),
          systemPrompt: exploreSystemPrompt(),
          historyMode: "fresh",
          model: this.deps.storage.settings.exploreAgent.model,
          thinkingLevel: this.deps.storage.settings.exploreAgent.thinkingLevel,
          workspaceScope: parent.workspaceScope,
          task: task.task,
          label: task.label,
          taskIndex: index,
          taskCount: tasks.length,
          onProgress: options.onProgress,
        });
        const reportPath = await this.writeExploreReport({
          batchId,
          task,
          index,
          output,
        });
        publishExploreProgress(options.onProgress, {
          agentId: output.agent.id,
          taskIndex: index,
          taskCount: tasks.length,
          label: task.label,
          phase: "completed",
          message: `Report written: ${reportPath}`,
        });
        return {
          agentId: output.agent.id,
          task: task.task,
          label: task.label,
          report: output.report,
          reportPath,
          summaryPreview: summaryPreview(output.report),
        };
      }),
    );

    const summary = formatExploreReports(reports);
    await this.deps.events.publish("agent.explore_completed", {
      parentAgentId: parent.id,
      reports,
    });
    return {
      reports,
      contentBlocks: [{ type: "text", text: summary }],
    };
  }

  async runSubagent(spec: SubagentRunSpec): Promise<SubagentRunOutput> {
    const child = await this.deps.createAgent(
      {
        conversationId: spec.parent.conversationId,
        projectId: spec.projectId,
        projectDir: spec.projectDir,
        workerId: spec.workerId,
        parentAgentId: spec.parent.id,
        task: spec.task ?? spec.prompt,
        mode: spec.mode,
        permissionLevel: spec.permissionLevel,
        workspaceScope: spec.workspaceScope,
        model: spec.model,
        thinkingLevel: spec.thinkingLevel,
        systemPrompt: spec.systemPrompt,
      },
      { allowChildAuthorityExceed: true },
    );
    await this.deps.events.publish("agent.subagent_started", {
      parentAgentId: spec.parent.id,
      childAgentId: child.id,
      kind: spec.kind,
      task: spec.task ?? spec.prompt,
    });
    publishExploreProgress(spec.onProgress, {
      agentId: child.id,
      taskIndex: spec.taskIndex,
      taskCount: spec.taskCount,
      label: spec.label,
      phase: "started",
      message: `Agent ${child.id} started.`,
    });

    const runId = createId("run");
    try {
      await this.deps.setAgentStatus(child, "running");
      const storage = await this.openChildStorage(child, spec.historyMode);
      const conversation = new Conversation(storage);
      const model = resolveAgentModel(child.model);
      this.deps.subscriptionUsage.touchProvider(model.provider);
      const env = new NodeExecutionEnv({ cwd: child.projectDir });
      const resources = await loadHarnessResources(child.projectDir);
      const activeToolNames = activeToolNamesForAgent(child);
      const harness = new AgentHarness({
        env,
        conversation,
        resources: { skills: resources.skills },
        tools: createAgentToolsForAgent(child, this.deps.tools, {
          runId,
          hidden: true,
        }),
        activeToolNames,
        model,
        thinkingLevel: child.thinkingLevel,
        getApiKeyAndHeaders: async (requestModel) => {
          if (requestModel.provider === "nerve-faux") return undefined;
          const apiKey = await this.deps.auth.getApiKey(requestModel.provider);
          return apiKey ? { apiKey } : undefined;
        },
        systemPrompt: () => spec.systemPrompt,
      });
      harness.subscribe((event) => {
        const update = exploreProgressFromHarnessEvent(event, child, spec);
        if (update) publishExploreProgress(spec.onProgress, update);
      });
      const assistant = await harness.prompt(spec.prompt);
      const report = assistantMessageText(assistant).trim();
      if (!report) throw new Error("Explore agent completed without a report.");
      await this.deps.setAgentStatus(child, "idle");
      await this.deps.events.publish("agent.subagent_completed", {
        parentAgentId: spec.parent.id,
        childAgentId: child.id,
        kind: spec.kind,
        summary: report,
      });
      publishExploreProgress(spec.onProgress, {
        agentId: child.id,
        taskIndex: spec.taskIndex,
        taskCount: spec.taskCount,
        label: spec.label,
        phase: "assistant",
        message: "Final report received.",
      });
      return { agent: child, report };
    } catch (error) {
      const latest = this.deps.state.agents.get(child.id) ?? child;
      await this.deps.setAgentStatus(latest, "error").catch(() => undefined);
      publishExploreProgress(spec.onProgress, {
        agentId: child.id,
        taskIndex: spec.taskIndex,
        taskCount: spec.taskCount,
        label: spec.label,
        phase: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
      await this.deps.logger.warn("Subagent run failed", {
        agentId: child.id,
        conversationId: child.conversationId,
        projectId: child.projectId,
        runId,
        context: {
          kind: spec.kind,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    } finally {
      await this.deps.updateConversation({
        ...this.deps.getConversation(spec.parent.conversationId),
        activeAgentId: spec.parent.id,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private async writeExploreReport(input: {
    batchId: string;
    task: ExploreTask;
    index: number;
    output: SubagentRunOutput;
  }): Promise<string> {
    const dir = join(
      this.deps.storage.paths.home,
      "explore-reports",
      input.output.agent.conversationId,
      input.batchId,
    );
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const fileName = safeReportFileName(
      input.task.label ?? input.task.task,
      input.index,
      input.output.agent.id,
    );
    const reportPath = join(dir, fileName);
    await writeFile(
      reportPath,
      formatExploreReportFile(input.task, input.output),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    return reportPath;
  }

  private async openChildStorage(
    child: AgentRecord,
    historyMode: SubagentHistoryMode,
  ): Promise<JsonlConversationStorage> {
    const childDir = join(this.deps.storage.paths.home, "agents", child.id);
    await mkdir(childDir, { recursive: true, mode: 0o700 });
    const childPath = join(childDir, "conversation.jsonl");
    const env = new NodeExecutionEnv({ cwd: child.projectDir });
    if (historyMode === "copy_parent") {
      const parentPath = this.deps.harnessManager.conversationPath(
        child.conversationId,
      );
      if ((await pathExists(parentPath)) && !(await pathExists(childPath))) {
        await copyFile(parentPath, childPath);
        return JsonlConversationStorage.open(env, childPath);
      }
    }
    if (!(await pathExists(childPath))) {
      return JsonlConversationStorage.create(env, childPath, {
        cwd: child.projectDir,
        conversationId: child.conversationId,
        parentConversationPath: this.deps.harnessManager.conversationPath(
          child.conversationId,
        ),
      });
    }
    return JsonlConversationStorage.open(env, childPath);
  }
}

export function exploreTasksArg(args: Record<string, unknown>): ExploreTask[] {
  const hasTask = typeof args.task === "string" && args.task.trim().length > 0;
  const hasTasks = Array.isArray(args.tasks);
  if (hasTask === hasTasks) {
    throw new Error("Explore requires exactly one of 'task' or 'tasks'.");
  }
  if (hasTask) {
    return [
      {
        task: String(args.task).trim(),
        context: optionalString(args.context),
        label: optionalString(args.label),
      },
    ];
  }
  const tasks = args.tasks as unknown[];
  if (tasks.length === 0) throw new Error("Explore tasks cannot be empty.");
  return tasks.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Explore task ${index + 1} must be an object.`);
    }
    const record = item as Record<string, unknown>;
    const task = optionalString(record.task);
    if (!task) throw new Error(`Explore task ${index + 1} requires 'task'.`);
    return {
      task,
      context: optionalString(record.context),
      label: optionalString(record.label),
    };
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function exploreUserPrompt(task: ExploreTask): string {
  return [
    task.label ? `Exploration label: ${task.label}` : undefined,
    "Exploration task:",
    task.task,
    task.context
      ? ["", "Additional context:", task.context].join("\n")
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function publishExploreProgress(
  onProgress: ((update: ExploreProgressUpdate) => void) | undefined,
  update: Omit<ExploreProgressUpdate, "type" | "timestamp">,
): void {
  onProgress?.({
    type: "explore_progress",
    timestamp: new Date().toISOString(),
    ...update,
  });
}

function exploreProgressFromHarnessEvent(
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
    case "process_logs":
      return `inspect process logs${stringValue(args.mode) ? ` (${stringValue(args.mode)})` : ""}`;
    case "process_list":
      return "list managed processes";
    case "ask_user":
      return "asked for clarification";
    case "todos_set":
      return "updated local explore checklist";
    case "todos_get":
      return "read local explore checklist";
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
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

function messageRole(message: unknown): string | undefined {
  return asRecord(message)?.role as string | undefined;
}

function safeReportFileName(
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

function formatExploreReportFile(
  task: ExploreTask,
  output: SubagentRunOutput,
): string {
  return [
    `# Explore report: ${task.label ?? task.task}`,
    "",
    `- Child agent: \`${output.agent.id}\``,
    `- Created: ${new Date().toISOString()}`,
    `- Task: ${task.task}`,
    task.context ? `- Context: ${task.context}` : undefined,
    "",
    "---",
    "",
    output.report,
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function summaryPreview(report: string): string {
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
  return [
    "You are an Explore Agent specialized in reading and mapping codebases for a parent coding agent.",
    "Your job is to investigate the requested area thoroughly using only read-only tools.",
    "Do not edit files, write files, run shell commands, start processes, stop processes, or change runtime state.",
    "Prefer targeted read, grep, find, and ls calls. Gather concrete evidence from file paths, symbols, and nearby code.",
    "Stay scoped to the requested project and working directory. If the task is broad, sample intelligently and call out gaps.",
    "Do not ask the user questions unless absolutely blocked; make reasonable assumptions and state them.",
    "Return a concise but useful report in exactly this markdown structure:",
    "",
    "# Findings",
    "",
    "## Summary",
    "- One to five bullets with the key answer.",
    "",
    "## Relevant files",
    "- `path/to/file`: why it matters.",
    "",
    "## Architecture notes",
    "- Important flows, ownership boundaries, data shapes, or extension points.",
    "",
    "## Evidence",
    "- `path/to/file:line-or-symbol` — specific observation.",
    "",
    "## Open questions / risks",
    "- Unknowns, ambiguity, or follow-up checks. Use `None` if there are none.",
  ].join("\n");
}

function assistantMessageText(message: AssistantMessage): string {
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

function formatExploreReports(reports: ExploreReport[]): string {
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
        "",
        report.report,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}
