import type { OrchestrationToolName } from "@nervekit/contracts";
import type { MetaItem } from "../views/tool-presentation-types";
import type { ToolArgumentSource } from "./argument-source";
import {
  boundedText,
  codeBody,
  keyValues,
  lineCount,
  plural,
  textArg,
} from "./core-specs";
import {
  argumentPresentation,
  type ToolArgumentBody,
  type ToolLifecycleSpec,
  type ToolLifecycleStage,
} from "./types";

function spec<Name extends OrchestrationToolName>(
  value: ToolLifecycleSpec<Name>,
): ToolLifecycleSpec<Name> {
  return value;
}

function durationMs(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value < 1_000 ? `${value}ms` : `${value / 1_000}s`;
}

function taskSelector(source: ToolArgumentSource): {
  primary: string;
  count: number;
} {
  const taskId = source.string("taskId");
  const groupId = source.string("groupId");
  const taskIds = source.strings("taskIds") ?? [];
  const count = taskIds.length || (taskId || groupId ? 1 : 0);
  return {
    primary:
      taskId ??
      (taskIds.length === 1
        ? taskIds[0]
        : taskIds.length > 1
          ? `${taskIds.length} tasks`
          : groupId
            ? `group ${groupId}`
            : "active tasks"),
    count,
  };
}

function taskStartPresentation(
  source: ToolArgumentSource,
  stage: ToolLifecycleStage,
) {
  const command = source.string("command");
  const name = source.string("name");
  const cwd = source.string("cwd");
  const envKeys = source.objectKeys("env");
  const readiness =
    source.string("readyUrl") ??
    source.string("readyPattern") ??
    (source.boolean("readyOnUrl") ? "first detected URL" : undefined);
  const secondary: MetaItem[] = [];
  if (cwd) secondary.push({ text: `cwd ${cwd}`, mono: true });
  if (readiness) secondary.push({ text: `ready: ${readiness}` });
  if (source.number("timeoutMs") !== undefined)
    secondary.push({
      text: `runtime ${durationMs(source.number("timeoutMs"))}`,
    });
  if (envKeys.length > 0)
    secondary.push({ text: plural(envKeys.length, "env key") });
  if (source.boolean("notify") === false)
    secondary.push({ text: "notifications off" });
  const commandLines = lineCount(command) ?? 0;
  let body: ToolArgumentBody = codeBody(command, "bash", {
    force:
      stage === "approval" &&
      (commandLines > 1 || (command?.length ?? 0) > 500),
    label: "Command",
  });
  if (body.kind === "none" && stage === "approval") {
    body = keyValues([
      ["Working directory", cwd ?? "project root", true],
      ["Readiness", readiness],
      ["Readiness timeout", durationMs(source.number("readyTimeoutMs"))],
      ["Runtime timeout", durationMs(source.number("timeoutMs"))],
      ["Environment keys", envKeys.join(", ")],
      ["Notifications", source.boolean("notify") === false ? "off" : "on"],
    ]);
  }
  return argumentPresentation({
    primaryArg: textArg(
      name ?? (commandLines <= 1 ? command : undefined),
      command ? "background task" : "Task",
    ),
    secondary,
    body,
    safetyNotes: [
      "Starts a supervised background process; tool completion only confirms the start request.",
      ...(envKeys.length > 0
        ? [`Environment values are hidden; keys: ${envKeys.join(", ")}.`]
        : []),
    ],
  });
}

export const orchestrationToolLifecycleSpecs = {
  task_start: spec({
    name: "task_start",
    draftBody: "meaningful",
    approvalDetail: "full",
    executionHandoff: "retain-draft-until-output",
    completedView: "task_action",
    present: taskStartPresentation,
  }),
  task_status: spec({
    name: "task_status",
    draftBody: "none",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "task_status",
    emptyResult: "No tasks",
    present: (source, stage) => {
      const selector = taskSelector(source);
      const secondary: MetaItem[] = [];
      if (selector.count > 1)
        secondary.push({ text: plural(selector.count, "selector") });
      if (source.string("status"))
        secondary.push({ text: `status ${source.string("status")}` });
      if (source.number("limit") !== undefined)
        secondary.push({ text: `max ${source.number("limit")}` });
      return argumentPresentation({
        primaryArg: textArg(selector.primary),
        secondary,
        body:
          stage === "approval"
            ? keyValues([["Task selector", selector.primary]])
            : undefined,
      });
    },
  }),
  task_logs: spec({
    name: "task_logs",
    draftBody: "none",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "task_logs",
    emptyResult: "No log events",
    present: (source, stage) => {
      const secondary: MetaItem[] = [];
      if (source.string("mode"))
        secondary.push({ text: source.string("mode")! });
      if (source.number("sinceSeq") !== undefined)
        secondary.push({ text: `after ${source.number("sinceSeq")}` });
      if (source.string("contains"))
        secondary.push({ text: "substring filter" });
      if (source.string("regex")) secondary.push({ text: "regex filter" });
      if (source.number("contextLines") !== undefined)
        secondary.push({ text: `context ${source.number("contextLines")}` });
      if (source.number("limit") !== undefined)
        secondary.push({ text: `max ${source.number("limit")}` });
      return argumentPresentation({
        primaryArg: textArg(source.string("taskId"), "Task logs"),
        secondary,
        body:
          stage === "approval"
            ? keyValues([
                ["Task", source.string("taskId")],
                ["Mode", source.string("mode") ?? "recent"],
                ["Contains", source.string("contains")],
                ["Regular expression", source.string("regex")],
              ])
            : undefined,
      });
    },
  }),
  task_cancel: spec({
    name: "task_cancel",
    draftBody: "none",
    approvalDetail: "full",
    executionHandoff: "result-immediate",
    completedView: "task_action",
    present: (source, stage) => {
      const selector = taskSelector(source);
      const signal = source.string("signal") ?? "SIGTERM";
      const secondary: MetaItem[] = [];
      if (selector.count > 1)
        secondary.push({ text: plural(selector.count, "target") });
      secondary.push({
        text: signal,
        tone: signal === "SIGKILL" ? "error" : "warning",
      });
      if (source.number("timeoutMs") !== undefined)
        secondary.push({
          text: `escalate after ${durationMs(source.number("timeoutMs"))}`,
        });
      return argumentPresentation({
        primaryArg: textArg(selector.primary),
        secondary,
        body:
          stage === "approval"
            ? keyValues([
                [
                  "Targets",
                  (source.strings("taskIds") ?? []).join(", ") ||
                    selector.primary,
                ],
                ["Signal", signal],
                ["Escalation timeout", durationMs(source.number("timeoutMs"))],
                ["Reason", source.string("reason")],
              ])
            : undefined,
        safetyNotes: [
          "Requests cancellation of the selected supervised task process.",
        ],
      });
    },
  }),
  task_restart: spec({
    name: "task_restart",
    draftBody: "none",
    approvalDetail: "full",
    executionHandoff: "result-immediate",
    completedView: "task_action",
    present: (source, stage) =>
      argumentPresentation({
        primaryArg: textArg(source.string("taskId"), "Task"),
        body:
          stage === "approval"
            ? {
                kind: "text-summary",
                text: "The task will restart with its stored launch settings and environment.",
              }
            : undefined,
        safetyNotes: [
          "Reuses the task's stored command, settings, and encrypted environment.",
        ],
      }),
  }),
  explore: spec({
    name: "explore",
    draftBody: "meaningful",
    approvalDetail: "summary",
    executionHandoff: "retain-draft-until-output",
    completedView: "explore",
    present: (source, stage) => {
      const taskRecords = source.recordsArray("tasks") ?? [];
      const labels =
        taskRecords.length > 0
          ? taskRecords.map((task, index) =>
              typeof task.label === "string"
                ? task.label
                : typeof task.task === "string"
                  ? task.task
                  : `Agent ${index + 1}`,
            )
          : source.nestedStrings("label");
      const singleTask = source.string("task");
      const singleLabel = source.string("label");
      const agentCount = labels.length || (singleTask ? 1 : 0);
      const bodyLines =
        labels.length > 0
          ? labels.map((label, index) => `${index + 1}. ${label}`)
          : singleTask
            ? [boundedText(singleTask)!]
            : [];
      if (stage === "approval" && source.string("split_rationale")) {
        bodyLines.push(
          `Why parallel: ${boundedText(source.string("split_rationale"))}`,
        );
      }
      return argumentPresentation({
        primaryArg: textArg(
          singleLabel ??
            (agentCount > 0 ? plural(agentCount, "agent") : undefined),
          "Explore",
        ),
        secondary:
          agentCount > 0
            ? [{ text: plural(agentCount, "read-only agent") }]
            : [],
        body:
          bodyLines.length > 0
            ? { kind: "text-summary", text: bodyLines.join("\n") }
            : undefined,
        safetyNotes: ["Delegates read-only investigation to child agents."],
      });
    },
  }),
  plan_mode_enter: spec({
    name: "plan_mode_enter",
    draftBody: "meaningful",
    approvalDetail: "summary",
    executionHandoff: "result-immediate",
    completedView: "plan_mode",
    present: (source) =>
      argumentPresentation({
        primaryArg: textArg("Enter planning mode"),
        body: source.string("reason")
          ? {
              kind: "text-summary",
              text: boundedText(source.string("reason"))!,
            }
          : undefined,
      }),
  }),
  plan_mode_present: spec({
    name: "plan_mode_present",
    draftBody: "meaningful",
    approvalDetail: "summary",
    executionHandoff: "replace-with-interaction",
    completedView: "plan_mode",
    present: (source) => {
      const path = source.string("file_path");
      return argumentPresentation({
        primaryArg: source.string("title")
          ? textArg(source.string("title"))
          : path
            ? { text: path.split(/[\\/]/).pop() || path, openPath: path }
            : textArg("Plan review"),
        secondary: path ? [{ text: path, mono: true, openPath: path }] : [],
        body: source.string("summary")
          ? {
              kind: "text-summary",
              text: boundedText(source.string("summary"))!,
            }
          : undefined,
      });
    },
  }),
  plan_mode_force_exit: spec({
    name: "plan_mode_force_exit",
    draftBody: "meaningful",
    approvalDetail: "summary",
    executionHandoff: "result-immediate",
    completedView: "plan_mode",
    present: (source) =>
      argumentPresentation({
        primaryArg: textArg("Exit planning mode"),
        body: source.string("reason")
          ? {
              kind: "text-summary",
              text: boundedText(source.string("reason"))!,
            }
          : undefined,
      }),
  }),
} satisfies Record<OrchestrationToolName, ToolLifecycleSpec>;
