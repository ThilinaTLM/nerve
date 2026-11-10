import type { ValidatedToolArtifact } from "@nervekit/contracts/tools";
import type { CandidateContext } from "./types.js";
import { record } from "./candidate-values.js";

export function artifacts(context: CandidateContext): ValidatedToolArtifact[] {
  const values = [...context.validatedArtifacts];
  if (
    context.completePayload &&
    !values.some((artifact) => artifact.id === context.completePayload?.id)
  )
    values.push(context.completePayload);
  return values;
}

export function stripArtifactLocations(
  value: unknown,
  artifacts: readonly ValidatedToolArtifact[],
): Record<string, unknown> {
  const locations = new Set(
    artifacts.flatMap((artifact) => {
      if (artifact.access.kind === "agent_file") return [artifact.access.path];
      if (artifact.access.kind === "metadata_only" && artifact.access.location)
        return [artifact.access.location];
      return [];
    }),
  );
  const visit = (input: unknown): unknown => {
    if (typeof input === "string")
      return locations.has(input) ? undefined : input;
    if (Array.isArray(input))
      return input.map(visit).filter((item) => item !== undefined);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .map(([key, nested]) => [key, visit(nested)] as const)
        .filter((entry) => entry[1] !== undefined),
    );
  };
  return record(visit(value));
}

/** `Fetched content (3120 lines) saved to /p/a.md; read or grep it.` */
export function savedFileNotice(
  label: string,
  path: string,
  artifact: Pick<ValidatedToolArtifact, "recommendedTools" | "size">,
): string {
  const lines = artifact.size?.lines;
  const tools = artifact.recommendedTools;
  return `${label}${lines !== undefined ? ` (${lines} lines)` : ""} saved to ${path}${tools.length > 0 ? `; ${tools.join(" or ")} it` : ""}.`;
}

export function artifactNoticeLines(
  values: readonly ValidatedToolArtifact[],
  role?: ValidatedToolArtifact["role"],
): string[] {
  return values
    .filter(
      (artifact) =>
        artifact.availability === "available" &&
        (!role || artifact.role === role),
    )
    .map((artifact) => {
      if (artifact.access.kind === "agent_file")
        return savedFileNotice(artifact.label, artifact.access.path, artifact);
      if (
        role === "primary_result" &&
        artifact.access.kind === "metadata_only" &&
        artifact.access.location
      )
        return `${artifact.label}: ${artifact.access.location} (metadata only)`;
      return "";
    })
    .filter(Boolean);
}
