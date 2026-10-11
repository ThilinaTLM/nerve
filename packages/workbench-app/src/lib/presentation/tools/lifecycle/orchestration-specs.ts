import type { AsyncSubagentToolName } from "@nervekit/contracts/tools";

import type { OrchestrationToolName } from "@nervekit/contracts/tools";
import { boundedText, codeBody, plural, textArg } from "./core-specs";
import {
  argumentPresentation,
  type ToolLifecycleSpec,
} from "./tool-lifecycle-contracts";

function spec<Name extends OrchestrationToolName>(
  value: ToolLifecycleSpec<Name>,
): ToolLifecycleSpec<Name> {
  return value;
}

/**
 * Teammates are addressed by name. The assignment prompt stays visible after
 * completion; the result view renders a separate compact output block below it.
 */
function subagentSpec<Name extends AsyncSubagentToolName>(
  name: Name,
): ToolLifecycleSpec<Name> {
  return spec({
    name,
    argumentRegion: name === "subagent_prompt" ? "persistent" : "until-result",
    completedView: "subagent",
    present: (source) => {
      const rawPrompt =
        name === "subagent_prompt" ? source.string("prompt") : undefined;
      const prompt = boundedText(rawPrompt);
      return argumentPresentation({
        primaryArg:
          name === "subagent_list" ? undefined : textArg(source.string("name")),
        body: prompt
          ? codeBody(prompt, "text", { force: true, label: "Assignment" })
          : undefined,
      });
    },
  });
}

export const orchestrationToolLifecycleSpecs = {
  subagent_new: subagentSpec("subagent_new"),
  subagent_prompt: subagentSpec("subagent_prompt"),
  subagent_list: subagentSpec("subagent_list"),
  subagent_status: subagentSpec("subagent_status"),
  subagent_stop: subagentSpec("subagent_stop"),

  async_bash: spec({
    name: "async_bash",
    argumentRegion: "none",
    completedView: "bash",
    present: (source) =>
      argumentPresentation({
        primaryArg: textArg(
          [source.string("action"), source.string("id")]
            .filter(Boolean)
            .join(" "),
        ),
      }),
  }),
  launch: spec({
    name: "launch",
    argumentRegion: "none",
    completedView: "bash",
    present: (source) =>
      argumentPresentation({
        primaryArg: textArg(
          [source.string("action"), source.string("id")]
            .filter(Boolean)
            .join(" "),
        ),
      }),
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
