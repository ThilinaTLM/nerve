import type {
  AgentProfileConfiguration,
  AgentProfileDiagnostic,
  AgentProfilesConfiguration,
} from "@nervekit/contracts/agent-profiles";

/** Document errors copied to every profile are already displayed above the list. */
export function conversationProfileRowDiagnostics(
  diagnostics: readonly AgentProfileDiagnostic[],
  shared: readonly AgentProfileDiagnostic[],
): AgentProfileDiagnostic[] {
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

const shortMessages: Record<string, string> = {
  untrusted_project: "Project settings need review",
  unavailable_model: "Model not available",
  unsupported_thinking: "Thinking level not supported by the model",
  incomplete_profile: "Profile is incomplete",
  invalid_entry: "Profile settings are invalid",
  invalid_document: "Settings file is invalid",
  unavailable_tool: "Some tools are unavailable",
  unknown_tool: "Some tools are unavailable",
  unavailable_skill: "Some skills are unavailable",
};

/** A one-line, plain-language label for a diagnostic. */
export function conversationProfileDiagnosticLabel(
  diagnostic: AgentProfileDiagnostic,
): string {
  return (
    shortMessages[diagnostic.code] ??
    diagnostic.message.split(/(?<=\.)\s/)[0] ??
    diagnostic.message
  );
}

export interface ConversationProfileProblem {
  /** The profile cannot be used; its switch is disabled. */
  blocking: boolean;
  /** One short line for the row. */
  message: string;
  /** Full diagnostic text, for a tooltip. */
  detail: string;
}

/** The most important problem of a profile row, if any. */
export function conversationProfileProblem(
  profile: AgentProfileConfiguration,
  shared: readonly AgentProfileDiagnostic[],
): ConversationProfileProblem | undefined {
  const rows = conversationProfileRowDiagnostics(profile.diagnostics, shared);
  const detail = rows.map((diagnostic) => diagnostic.message).join("\n");
  if (profile.trust === "untrusted")
    return {
      blocking: true,
      message: shortMessages.untrusted_project,
      detail: detail || shortMessages.untrusted_project,
    };
  const blocking = rows.find(
    (diagnostic) => diagnostic.severity === "blocking",
  );
  const blocked =
    !profile.effective ||
    profile.diagnostics.some(
      (diagnostic) => diagnostic.severity === "blocking",
    );
  const first = blocking ?? rows[0];
  if (!first)
    // Shared document errors are shown once above the list.
    return blocked
      ? { blocking: true, message: "Unavailable", detail: "Unavailable" }
      : undefined;
  return {
    blocking: blocked,
    message: conversationProfileDiagnosticLabel(first),
    detail,
  };
}

/** Tab count: profiles that are on and usable, out of all listed profiles. */
export function conversationProfileCounts(
  configuration: AgentProfilesConfiguration,
): { enabled: number; total: number } {
  return {
    enabled: configuration.profiles.filter(
      (profile) =>
        profile.effective?.enabled === true &&
        !conversationProfileProblem(profile, configuration.diagnostics)
          ?.blocking,
    ).length,
    total: configuration.profiles.length,
  };
}
