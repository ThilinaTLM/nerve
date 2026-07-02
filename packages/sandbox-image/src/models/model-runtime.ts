import type { SandboxConfigV1 } from "@nervekit/shared";
import { effectiveModelCatalog } from "./model-catalog.js";
export function validateModelRuntime(config: SandboxConfigV1): void {
  effectiveModelCatalog(config);
}
