import {
  canonicalSettingsEntries,
  type LeadSettingsOverrides,
  type ResolutionResult,
} from "@nervekit/contracts/agent-configuration";
/** Reset only editable choices. Requirements and choices hidden beneath them survive. */
export function editableCapabilityResets(
  overrides: LeadSettingsOverrides,
  resolution: ResolutionResult,
): string[] {
  const requirements = Object.entries(resolution.provenance)
    .filter(([, value]) => value.source === "requirement")
    .map(([pointer]) => pointer);
  const overlaps = (a: string, b: string) =>
    a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  return canonicalSettingsEntries(overrides)
    .map(([pointer]) => pointer)
    .filter((pointer) => /^\/(tools|skills|subagents)\//.test(pointer))
    .filter(
      (pointer) =>
        !requirements.some((required) => {
          const skillDefault = /^\/skills\/defaults\/([^/]+)$/.exec(required);
          return (
            overlaps(pointer, required) ||
            !!(skillDefault && overlaps(pointer, `/skills/${skillDefault[1]}`))
          );
        }),
    )
    .map((pointer) => `/overrides${pointer}`);
}
