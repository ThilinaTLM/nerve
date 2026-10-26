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
 * Persistent entity rows own prompt/stop arguments, keyed by array index from
 * the first partial frame through settlement. Completed SubagentToolView must
 * not duplicate these rows: enrich the persistent entities with live agents
 * (agentName), and append only result context/errors. Never swap row owners.
 */
const subagentPrompt = spec({
  name: "subagent_prompt",
  argumentRegion: "persistent",
  completedView: "subagent",
  present: (source, stage) => {
    const assignments = source.objectArraySources("assignments", Infinity);
    return argumentPresentation({
      primaryArg: textArg(
        assignments.length > 0
          ? plural(assignments.length, "sub-agent")
          : undefined,
      ),
      body:
        assignments.length > 0
          ? {
              kind: "entities",
              items: assignments.map((item, index) => ({
                key: String(index),
                title: item.string("name"),
                detail: item.string("profile"),
                body: item.string("prompt"),
                agentName: item.string("name"),
                status: {
                  tone: "neutral",
                  label: stage === "drafting" ? "Drafting" : "Pending",
                },
              })),
              context:
                source.string("context") !== undefined
                  ? { label: "Shared context", text: source.string("context") }
                  : undefined,
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
    argumentRegion: "persistent",
    completedView: "subagent",
    present: (source) => {
      const names = source.strings("names") ?? [];
      return argumentPresentation({
        primaryArg: textArg(
          names.length > 0 ? plural(names.length, "sub-agent") : undefined,
        ),
        body: names.length
          ? {
              kind: "entities",
              items: names.map((name, index) => ({
                key: String(index),
                title: name,
                agentName: name,
              })),
            }
          : undefined,
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
    present: (source) => {
      // Recorded ID-based calls stay readable; this is not an execution alias.
      const name = source.string("name") ?? source.string("id");
      const runId = source.string("runId");
      return argumentPresentation({
        primaryArg: textArg(
          [source.string("action"), name].filter(Boolean).join(" "),
        ),
        secondary: runId ? [{ key: "run-id", text: `Run: ${runId}` }] : [],
      });
    },
  }),
  plan_present: spec({
    name: "plan_present",
    argumentRegion: "until-result",
    completedView: "plan_present",
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
