import {
  canonicalSettingsEntries,
  type LeadSettingsOverrides,
  type ResolutionResult,
} from "@nervekit/contracts/agent-configuration";

/** Required provenance is already expressed in canonical merge units. */
export function requiredCanonicalPointers(
  provenance: ResolutionResult["provenance"] = {},
): string[] {
  return Object.entries(provenance)
    .filter(([, source]) => source.source === "requirement")
    .map(([pointer]) => pointer);
}

/** Atomic units also lock their descendants (model, image settings, autoPromotion). */
export function canonicalSettingRequired(
  pointer: string,
  required: readonly string[],
): boolean {
  return required.some(
    (unit) => pointer === unit || pointer.startsWith(`${unit}/`),
  );
}

/** Row resets affect editable local units, never hidden choices under requirements. */
export function editableToolOverrideResets(
  names: readonly string[],
  overrides: LeadSettingsOverrides = {},
  provenance: ResolutionResult["provenance"] = {},
): string[] {
  const required = requiredCanonicalPointers(provenance);
  return canonicalSettingsEntries(overrides)
    .filter(([pointer]) =>
      names.some((name) => pointer.startsWith(`/tools/${name}/`)),
    )
    .filter(([pointer]) => !canonicalSettingRequired(pointer, required))
    .map(([pointer]) => `/overrides${pointer}`);
}

/** Only enabled merge units lock a tool row's enabled switch. */
export function capabilityToolLocks(
  names: readonly string[],
  provenance: ResolutionResult["provenance"] = {},
): { enabledBy?: string } {
  for (const name of names) {
    const source = provenance[`/tools/${name}/enabled`];
    if (source?.source === "requirement")
      return { enabledBy: source.profile ?? "the active profile" };
  }
  return { enabledBy: undefined };
}
