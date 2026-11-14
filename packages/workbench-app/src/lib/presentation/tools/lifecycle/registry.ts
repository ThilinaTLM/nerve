import { toolNameSchema } from "@nervekit/contracts/tools";
import { type ToolName } from "@nervekit/contracts/tools";
import {
  toolArgumentSource,
  type ToolArgumentSourceInput,
} from "./argument-source";
import { coreToolLifecycleSpecs } from "./core-specs";
import { orchestrationToolLifecycleSpecs } from "./orchestration-specs";
import { extensionToolLifecycleSpec } from "./extension-spec";
import { isExtensionToolName } from "./extension-tools";
import {
  argumentPresentation,
  type ExtensionToolLifecycleSpec,
  type ToolArgumentPresentation,
  type ToolLifecycleSpec,
  type ToolLifecycleStage,
  type UnknownToolLifecycleSpec,
} from "./tool-lifecycle-contracts";

export const toolLifecycleRegistry = {
  ...coreToolLifecycleSpecs,
  ...orchestrationToolLifecycleSpecs,
} satisfies Record<ToolName, ToolLifecycleSpec>;

export const unknownToolLifecycleSpec: UnknownToolLifecycleSpec = {
  name: "unknown",
  argumentRegion: "until-result",
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

function isCoreToolName(name: string): name is ToolName {
  return toolNameSchema.safeParse(name).success;
}

/** Whether the active catalog has the tool: a core tool or one an extension contributes. */
export function isKnownToolName(name: string): boolean {
  return isCoreToolName(name) || isExtensionToolName(name);
}

export function toolLifecycleSpec(
  name: string,
): ToolLifecycleSpec | ExtensionToolLifecycleSpec | UnknownToolLifecycleSpec {
  if (isCoreToolName(name)) return toolLifecycleRegistry[name];
  return isExtensionToolName(name)
    ? extensionToolLifecycleSpec
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

export * from "./tool-lifecycle-contracts";
export type { ToolArgumentSourceInput } from "./argument-source";
