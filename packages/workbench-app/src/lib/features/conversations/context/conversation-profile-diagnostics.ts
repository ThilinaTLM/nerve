import type { SubagentProfileDiagnostic } from "@nervekit/contracts/subagents";

/** Document errors copied to every profile are already displayed above the list. */
export function conversationProfileRowDiagnostics(
  diagnostics: readonly SubagentProfileDiagnostic[],
  shared: readonly SubagentProfileDiagnostic[],
): SubagentProfileDiagnostic[] {
  return diagnostics.filter((diagnostic) => {
    // Field/reference context makes an error row-local, even when its code matches.
    if (
      diagnostic.code !== "invalid_document" ||
      diagnostic.field !== undefined ||
      diagnostic.reference !== undefined
    )
      return true;
    return !shared.some(
      (sharedDiagnostic) =>
        sharedDiagnostic.code === diagnostic.code &&
        sharedDiagnostic.source === diagnostic.source &&
        sharedDiagnostic.severity === diagnostic.severity &&
        sharedDiagnostic.message === diagnostic.message &&
        sharedDiagnostic.field === undefined &&
        sharedDiagnostic.reference === undefined,
    );
  });
}
