import type { OrchestrationToolName } from "@nervekit/contracts/tools";
import { plural, textArg } from "./core-specs";
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
 * Assignments are listed by name while the call is drafted or running; the
 * result view then renders one row per assignment, so the argument body goes.
 */
const subagentPrompt = spec({
  name: "subagent_prompt",
  argumentRegion: "until-result",
  completedView: "subagent",
  present: (source) => {
    const assignments = (source.recordsArray("assignments") ?? []).flatMap(
      (assignment) =>
        typeof assignment.name === "string"
          ? [
              {
                name: assignment.name,
                line:
                  typeof assignment.profile === "string"
                    ? `${assignment.name} (${assignment.profile})`
                    : assignment.name,
              },
            ]
          : [],
    );
    return argumentPresentation({
      primaryArg: textArg(
        assignments.length === 1
          ? assignments[0].name
          : assignments.length > 1
            ? plural(assignments.length, "sub-agent")
            : undefined,
      ),
      body:
        assignments.length > 0
          ? {
              kind: "text-summary",
              text: assignments.map((item) => item.line).join("\n"),
            }
          : undefined,
    });
  },
});

export const orchestrationToolLifecycleSpecs = {
  subagent_prompt: subagentPrompt,
  subagent_status: spec({
    name: "subagent_status",
    argumentRegion: "none",
    completedView: "subagent",
    present: (source) =>
      argumentPresentation({ primaryArg: textArg(source.string("name")) }),
  }),
  subagent_stop: spec({
    name: "subagent_stop",
    argumentRegion: "none",
    completedView: "subagent",
    present: (source) => {
      const names = source.strings("names") ?? [];
      return argumentPresentation({
        primaryArg: textArg(names.length > 0 ? names.join(", ") : undefined),
      });
    },
  }),

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
} satisfies Record<OrchestrationToolName, ToolLifecycleSpec>;
