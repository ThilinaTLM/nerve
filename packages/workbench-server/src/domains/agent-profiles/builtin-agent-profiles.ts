import {
  agentProfileFileSchema,
  type AgentProfileDraft,
} from "@nervekit/contracts/agent-profiles";
import codingJson from "./builtin/coding.json" with { type: "json" };
import planningJson from "./builtin/planning.json" with { type: "json" };
import exploreJson from "./builtin/explore.json" with { type: "json" };
import developerJson from "./builtin/developer.json" with { type: "json" };
import { loadBundledAgentProfiles } from "./builtin-profile-loader.js";

const files = loadBundledAgentProfiles(
  {
    coding: codingJson,
    planning: planningJson,
    explore: exploreJson,
    developer: developerJson,
  },
  agentProfileFileSchema,
);

/** Host-owned JSON catalog, injected into the transport-neutral profile resolver. */
export const builtInAgentProfiles: readonly AgentProfileDraft[] = Object.freeze(
  files.map(
    (file) =>
      Object.freeze(
        Object.fromEntries(
          Object.entries(file).filter(([key]) => key !== "schemaVersion"),
        ),
      ) as AgentProfileDraft,
  ),
);
