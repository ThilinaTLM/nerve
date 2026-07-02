import type { SandboxConfigV1 } from "@nervekit/shared";
import { effectiveModelCatalog, type ResolvedModel } from "./model-catalog.js";

export type ResolvedModelRuntime = {
  main: ResolvedModel;
  explore?: ResolvedModel;
  models: ResolvedModel[];
  degraded: boolean;
  limitations: string[];
};

export function resolveModelRuntime(
  config: SandboxConfigV1,
): ResolvedModelRuntime {
  const models = effectiveModelCatalog(config);
  const main = models[0];
  if (!main) throw new Error("Sandbox config did not resolve a main model");
  return {
    main,
    explore: models[1],
    models,
    degraded: false,
    limitations: models.flatMap((model) => model.limitations),
  };
}

export function validateModelRuntime(config: SandboxConfigV1): void {
  resolveModelRuntime(config);
}
