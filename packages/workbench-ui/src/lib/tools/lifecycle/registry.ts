import { toolNameSchema, type ToolName } from "@nervekit/contracts";
import {
  toolArgumentSource,
  type ToolArgumentSourceInput,
} from "./argument-source";
import { confluenceToolLifecycleSpecs } from "./confluence-specs";
import { coreToolLifecycleSpecs } from "./core-specs";
import { jiraToolLifecycleSpecs } from "./jira-specs";
import { orchestrationToolLifecycleSpecs } from "./orchestration-specs";
import {
  argumentPresentation,
  type ToolArgumentPresentation,
  type ToolLifecycleSpec,
  type ToolLifecycleStage,
  type UnknownToolLifecycleSpec,
} from "./types";

export const toolLifecycleRegistry = {
  ...coreToolLifecycleSpecs,
  ...orchestrationToolLifecycleSpecs,
  ...jiraToolLifecycleSpecs,
  ...confluenceToolLifecycleSpecs,
} satisfies Record<ToolName, ToolLifecycleSpec>;

export const unknownToolLifecycleSpec: UnknownToolLifecycleSpec = {
  name: "unknown",
  draftBody: "meaningful",
  approvalDetail: "full",
  executionHandoff: "retain-draft-until-output",
  completedView: "generic",
  emptyResult: "No output",
  present: (source) => {
    const entries = source.structuredEntries();
    const primary = entries.find(
      (entry) => !entry.redacted && entry.value !== "[unavailable]",
    );
    return argumentPresentation({
      primaryArg: primary ? { text: primary.value } : undefined,
      secondary: [{ text: "recorded tool", tone: "warning" }],
      body:
        entries.length > 0
          ? {
              kind: "key-values",
              items: entries.map((entry) => ({
                label: entry.key,
                value: entry.value,
                mono: true,
                tone: entry.redacted ? "warning" : undefined,
              })),
            }
          : undefined,
      safetyNotes: [
        "This tool is not in the active catalog. Review Details before approving it.",
      ],
    });
  },
};

export function isKnownToolName(name: string): name is ToolName {
  return toolNameSchema.safeParse(name).success;
}

export function toolLifecycleSpec(
  name: string,
): ToolLifecycleSpec | UnknownToolLifecycleSpec {
  return isKnownToolName(name)
    ? toolLifecycleRegistry[name]
    : unknownToolLifecycleSpec;
}

export function presentToolArguments(
  name: string,
  input: ToolArgumentSourceInput,
  stage: ToolLifecycleStage,
  cwd?: string,
): ToolArgumentPresentation {
  return toolLifecycleSpec(name).present(toolArgumentSource(input), stage, cwd);
}

export * from "./types";
export {
  isSuspiciousKey,
  isSuspiciousValue,
  redactStructuredValue,
  toolArgumentSource,
  ToolArgumentSource,
} from "./argument-source";
export type {
  RedactedStructuredEntry,
  ToolArgumentSourceInput,
} from "./argument-source";
