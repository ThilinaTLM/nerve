import {
  applySettingsMutation,
  canonicalSettingsEntries,
  normalizeSettingsOverrides,
  type LeadSettingsOverrides,
} from "@nervekit/contracts/agent-configuration";

/** A sparse view only: persisted redundancy is cleaned by the server on save.
 * The caller must supply the layer below the edited scope, never its effective
 * settings. Requirements are not part of that baseline. */
export function settingsOverrideView(
  overrides: LeadSettingsOverrides,
  inherited: LeadSettingsOverrides | undefined,
): LeadSettingsOverrides {
  return inherited === undefined
    ? overrides
    : normalizeSettingsOverrides(overrides, inherited);
}

/** Pending drafts have no server save boundary, so normalize each local edit. */
export function mutateDraftSettings(
  overrides: LeadSettingsOverrides,
  changes: LeadSettingsOverrides,
  resets: string[],
  inherited: LeadSettingsOverrides | undefined,
): LeadSettingsOverrides {
  return settingsOverrideView(
    applySettingsMutation(overrides, {
      expectedRevision: 0,
      expectedDigest: "missing",
      changes,
      resets,
    }),
    inherited,
  );
}

/** A retried draft replaces its previously saved choices, rather than merging
 * them. Compare canonical units so atomic settings stay whole and resets never
 * overlap a desired contribution. The caller supplies the current document CAS. */
export function replacementSettingsMutation(
  current: LeadSettingsOverrides,
  desired: LeadSettingsOverrides,
): { changes: LeadSettingsOverrides; resets: string[] } {
  const desiredPointers = new Set(
    canonicalSettingsEntries(desired).map(([pointer]) => pointer),
  );
  return {
    changes: desired,
    resets: canonicalSettingsEntries(current)
      .filter(([pointer]) => !desiredPointers.has(pointer))
      .map(([pointer]) => `/overrides${pointer}`),
  };
}
