import type { OrchestrationToolName } from "@nervekit/contracts/tools";
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
} from "./tool-lifecycle-contracts";

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
  const tasks = source.strings("tasks") ?? [];
  return {
    primary:
      tasks.length === 1
        ? tasks[0]!
        : tasks.length > 1
          ? `${tasks.length} tasks`
          : "active tasks",
    count: tasks.length,
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
  const ready = source.record("ready");
  const readiness =
    ready?.kind === "url" && typeof ready.url === "string"
      ? ready.url
      : ready?.kind === "pattern" && typeof ready.pattern === "string"
        ? ready.pattern
        : ready?.kind === "detected_url"
          ? "first detected URL"
          : undefined;
  const readinessTimeout =
    ready && typeof ready.timeoutMs === "number"
      ? durationMs(ready.timeoutMs)
      : undefined;
  const secondary: MetaItem[] = [];
  if (cwd) secondary.push({ text: `cwd ${cwd}`, mono: true });
  if (readiness) secondary.push({ text: `ready: ${readiness}` });
  if (source.number("timeoutMs") !== undefined)
    secondary.push({
      text: `runtime ${durationMs(source.number("timeoutMs"))}`,
    });
  if (envKeys.length > 0)
    secondary.push({ text: plural(envKeys.length, "env key") });
  const commandLines = lineCount(command) ?? 0;
  // Stage-independent so the block never appears/disappears mid-lifecycle.
  let body: ToolArgumentBody = codeBody(command, "bash", {
    force: (command?.length ?? 0) > 500,
    label: "Command",
  });
  if (body.kind === "none" && stage === "approval") {
    body = keyValues([
      ["Working directory", cwd ?? "project root", true],
      ["Readiness", readiness],
      ["Readiness timeout", readinessTimeout],
      ["Runtime timeout", durationMs(source.number("timeoutMs"))],
      ["Environment keys", envKeys.join(", ")],
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
    argumentRegion: "until-result",
    completedView: "task_action",
    present: taskStartPresentation,
  }),
  task_status: spec({
    name: "task_status",
    argumentRegion: "none",
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
    argumentRegion: "none",
    completedView: "task_logs",
    emptyResult: "No log events",
    present: (source, stage) => {
      const secondary: MetaItem[] = [];
      if (source.string("mode"))
        secondary.push({ text: source.string("mode")! });
      if (source.number("cursor") !== undefined)
        secondary.push({ text: `cursor ${source.number("cursor")}` });
      if (source.string("contains"))
        secondary.push({ text: "substring filter" });
      if (source.number("contextLines") !== undefined)
        secondary.push({ text: `context ${source.number("contextLines")}` });
      if (source.number("limit") !== undefined)
        secondary.push({ text: `max ${source.number("limit")}` });
      return argumentPresentation({
        primaryArg: textArg(source.string("task"), "Task logs"),
        secondary,
        body:
          stage === "approval"
            ? keyValues([
                ["Task", source.string("task")],
                ["Mode", source.string("mode") ?? "recent"],
                ["Cursor", source.number("cursor")],
                ["Contains", source.string("contains")],
              ])
            : undefined,
      });
    },
  }),
  task_control: spec({
    name: "task_control",
    argumentRegion: "none",
    completedView: "task_action",
    present: (source, stage) => {
      const action = source.string("action") ?? "stop";
      if (action === "restart") {
        return argumentPresentation({
          primaryArg: textArg(source.string("task"), "Task"),
          secondary: [{ text: "restart", tone: "warning" }],
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
        });
      }

      const secondary: MetaItem[] = [{ text: "stop", tone: "warning" }];
      return argumentPresentation({
        primaryArg: textArg(source.string("task"), "Task"),
        secondary,
        body:
          stage === "approval"
            ? keyValues([["Task", source.string("task")]])
            : undefined,
        safetyNotes: [
          "Requests cancellation of the selected supervised task process.",
        ],
      });
    },
  }),
  explore: spec({
    name: "explore",
    argumentRegion: "until-result",
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
      const splitRationale = source.string("split_rationale");
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
        safetyNotes: [
          "Delegates read-only investigation to child agents.",
          ...(stage === "approval" && splitRationale
            ? [`Why parallel: ${boundedText(splitRationale)}`]
            : []),
        ],
      });
    },
  }),
  plan_mode_enter: spec({
    name: "plan_mode_enter",
    argumentRegion: "until-result",
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
    argumentRegion: "until-result",
    completedView: "plan_mode",
    present: (source) => {
      const path = source.string("file_path");
      return argumentPresentation({
        primaryArg: path
          ? { text: path.split(/[\\/]/).pop() || path, openPath: path }
          : textArg("Plan review"),
        secondary: path ? [{ text: path, mono: true, openPath: path }] : [],
      });
    },
  }),
  plan_mode_force_exit: spec({
    name: "plan_mode_force_exit",
    argumentRegion: "until-result",
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
