import {
  canonicalSettingsEntries,
  leadSettingsOverridesSchema,
  type LeadSettingsOverrides,
} from "@nervekit/contracts/agent-configuration";
import type { ConfigurationDiagnostic } from "./document-adapters.js";
import type { ResolutionOptions } from "@nervekit/contracts/agent-configuration";
import type { AgentProfileCatalog } from "./profile-catalog.js";
import { ScopeUnavailableError } from "../scoped-store/scoped-document-store.js";

export interface ResourceSnapshot {
  projectCapabilities?: LeadSettingsOverrides;
  projectDiagnostics?: readonly ConfigurationDiagnostic[];
  options: Pick<
    ResolutionOptions,
    | "process"
    | "eligibleSkills"
    | "clampThinking"
    | "referenceAvailable"
    | "subagentDefaults"
  >;
  /** Captured dependencies only; never polls files. */
  isCurrent(): boolean;
}

/** Valid child definitions contribute defaults, not execution admission policy. */
export async function captureProfileResources(
  catalog: AgentProfileCatalog,
  capture: (projectId?: string) => ResourceSnapshot,
  captureCurrent: () => () => boolean,
  projectId?: string,
): Promise<ResourceSnapshot> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resources = capture(projectId);
    const catalogCurrent = captureCurrent();
    const { profiles } = await catalog.list(projectId, "child");
    if (!resources.isCurrent() || !catalogCurrent()) continue;
    const subagentDefaults = Object.fromEntries(
      Object.entries(profiles).flatMap(([name, profile]) =>
        profile.status === "available"
          ? [[name, profile.definition.enabled ?? true]]
          : [],
      ),
    );
    return {
      options: { ...resources.options, subagentDefaults },
      isCurrent: () => resources.isCurrent() && catalogCurrent(),
    };
  }
  throw new ScopeUnavailableError();
}

/** Compose sparse settings by the resolver's canonical atomic merge units. */
export function projectSettings(
  resources: ResourceSnapshot,
  overrides: LeadSettingsOverrides = {},
): LeadSettingsOverrides {
  const result: Record<string, unknown> = {};
  for (const [pointer, value] of [
    ...canonicalSettingsEntries(resources.projectCapabilities ?? {}),
    ...canonicalSettingsEntries(overrides),
  ]) {
    const parts = pointer
      .slice(1)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
    let node = result;
    for (const part of parts.slice(0, -1)) {
      if (!Object.hasOwn(node, part))
        Object.defineProperty(node, part, {
          value: {},
          enumerable: true,
          configurable: true,
          writable: true,
        });
      node = node[part] as Record<string, unknown>;
    }
    Object.defineProperty(node, parts.at(-1)!, {
      value: structuredClone(value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return leadSettingsOverridesSchema.parse(result);
}
