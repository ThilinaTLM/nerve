import { basename } from "node:path";
import { legacyConfigurationFileSchema } from "@nervekit/contracts/agent-configuration";
import { z } from "zod";
import type {
  DocumentIssue,
  ScopeHealth,
} from "../scoped-store/scoped-document-store.js";

export function upgradeBlock(
  error: unknown,
  fallbackPath: string,
): { path: string; digest?: string; issues: DocumentIssue[] } {
  const parsed = z
    .object({
      issues: z.array(
        z.object({
          path: z.string(),
          digest: z.string().optional(),
          reason: z.string(),
        }),
      ),
    })
    .safeParse(error);
  const issue = parsed.success ? parsed.data.issues[0] : undefined;
  return {
    path: issue?.path ?? fallbackPath,
    digest: issue?.digest,
    issues: [
      {
        code: "legacy-conversion-required",
        pointer: "",
        message:
          issue?.reason ??
          "Scoped conversion blocked; original documents retained",
      },
    ],
  };
}
export function legacyRepairFile<S, D>(state: ScopeHealth<S, D> | undefined) {
  if (
    state?.status !== "unavailable" ||
    !state.issues.some((issue) => issue.code === "legacy-conversion-required")
  )
    return undefined;
  const result = legacyConfigurationFileSchema.safeParse(
    basename(state.path, ".json"),
  );
  return result.success ? result.data : undefined;
}

export async function preparePreferenceScope(
  options: import("./agent-configuration-service.js").AgentConfigurationServiceOptions,
  paths: import("./document-adapters.js").AgentConfigurationPaths,
  store: import("../scoped-store/scoped-document-store.js").ScopedDocumentStore<
    import("./document-adapters.js").AgentScope,
    import("./document-adapters.js").AgentDocument
  >,
  track: (scope: import("./document-adapters.js").AgentScope) => void,
  scope: import("./document-adapters.js").PreferenceScope,
) {
  try {
    if (scope.scope === "user") await options.prepareUser?.();
    else await options.prepareProject?.(scope.projectId);
    return undefined;
  } catch (error) {
    track(scope);
    return store.block(scope, upgradeBlock(error, paths.agent(scope)));
  }
}
