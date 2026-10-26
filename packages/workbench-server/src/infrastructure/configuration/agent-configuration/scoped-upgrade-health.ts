import { basename } from "node:path";
import { legacyConfigurationFileSchema } from "@nervekit/contracts/agent-configuration";
import { LegacyScopeError } from "../../migrations/steps/0002-agent-profiles/released-scope.js";
import type {
  DocumentIssue,
  ScopeHealth,
} from "../scoped-store/scoped-document-store.js";

export function upgradeBlock(
  error: unknown,
  fallbackPath: string,
): { path: string; digest?: string; issues: DocumentIssue[] } {
  const issue = error instanceof LegacyScopeError ? error.issues[0] : undefined;
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
