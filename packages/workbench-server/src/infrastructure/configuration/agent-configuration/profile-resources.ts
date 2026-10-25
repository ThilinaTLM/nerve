import type { ResolutionOptions } from "@nervekit/contracts/agent-configuration";
import type { AgentProfileCatalog } from "./profile-catalog.js";
import { ScopeUnavailableError } from "../scoped-store/scoped-document-store.js";

export interface ResourceSnapshot {
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
