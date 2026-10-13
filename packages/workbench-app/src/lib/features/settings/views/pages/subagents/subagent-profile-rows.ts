import type { ModelInfo } from "@nervekit/contracts/models";
import type {
  SubagentProfile,
  SubagentProfileConfiguration,
  SubagentProfileScope,
  SubagentProfileDiagnostic,
} from "@nervekit/contracts/subagents";
import { modelDisplayName } from "$lib/presentation/utils/model";

/** Invalid local entries have no parsed local value, but can still be removed whole. */
export function canResetProfileEntry(
  profile: SubagentProfileConfiguration,
  scope: SubagentProfileScope,
): boolean {
  return (
    profile.local !== null ||
    profile.diagnostics.some(
      (item) => item.code === "invalid_entry" && item.source === scope,
    )
  );
}

/** Keep actionable host prose visible; only structured validator payloads need a summary. */
function isTechnicalDiagnostic(message: string): boolean {
  const candidate = message.trim().replace(/^ZodError:\s*/, "");
  if (!candidate.startsWith("[") && !candidate.startsWith("{")) return false;
  try {
    const payload: unknown = JSON.parse(candidate);
    return payload !== null && typeof payload === "object";
  } catch {
    // Truncated validator output is still technical, not actionable prose.
    return /"(?:code|path|issues|schemaVersion)"\s*:/.test(candidate);
  }
}

export function profileDiagnosticSummary(
  diagnostic: SubagentProfileDiagnostic,
): string {
  if (!isTechnicalDiagnostic(diagnostic.message)) return diagnostic.message;
  const source = diagnostic.source ? `${diagnostic.source} ` : "";
  switch (diagnostic.code) {
    case "invalid_document":
      return `The ${source}subagents.json document is invalid or unreadable. Correct or restore it before using or editing profiles.`;
    case "invalid_entry":
      return `This profile entry is invalid. Review its settings in ${source}subagents.json, or reset the entry in its owning scope.`;
    case "incomplete_profile":
      return "This profile is incomplete. Restore its required settings before use.";
    default:
      return "Sub-agent configuration reported a diagnostic. Review the technical details.";
  }
}

/** Document failures are explained once above the list, not repeated in every row. */
export function profileRowDiagnostics(
  profile: SubagentProfileConfiguration,
  documentDiagnostics: readonly SubagentProfileDiagnostic[],
  scope: SubagentProfileScope,
): { diagnostics: SubagentProfileDiagnostic[]; documentBlock?: string } {
  const shared = profile.diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === "invalid_document" &&
      documentDiagnostics.some(
        (document) =>
          document.code === diagnostic.code &&
          document.source === diagnostic.source,
      ),
  );
  const blockers = shared.filter(
    (diagnostic) => diagnostic.severity === "blocking",
  );
  const sources = [
    ...new Set(
      blockers.map((diagnostic) =>
        diagnostic.source
          ? `${diagnostic.source !== scope ? "inherited " : ""}${diagnostic.source}`
          : "sub-agent",
      ),
    ),
  ];
  return {
    diagnostics: profile.diagnostics.filter(
      (diagnostic) => !shared.includes(diagnostic),
    ),
    ...(sources.length
      ? {
          documentBlock: `Blocked by ${sources.join(" and ")} configuration. See the document error above.`,
        }
      : {}),
  };
}

/** One line: model, thinking level when set, and the permission rule set. */
export function profileSummary(
  profile: SubagentProfile,
  models: readonly ModelInfo[],
): string {
  const parts: string[] = [];
  if (profile.model === "lead") parts.push("Lead's model");
  else {
    const match = models.find(
      (model) => `${model.provider}/${model.modelId}` === profile.model,
    );
    parts.push(match ? modelDisplayName(match) : profile.model);
  }
  if (profile.thinking !== "lead") parts.push(`${profile.thinking} thinking`);
  parts.push(profile.permission === "read_only" ? "Read-only" : "Autonomous");
  return parts.join(" · ");
}
