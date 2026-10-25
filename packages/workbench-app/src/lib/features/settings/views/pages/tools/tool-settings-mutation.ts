import {
  applySettingsMutation,
  canonicalSettingsEntries,
  leadSettingsOverridesSchema,
  type LeadSettingsOverrides,
} from "@nervekit/contracts/agent-configuration";
import { canonicalSettingRequired } from "$lib/presentation/composer/capability-tool-locks";

/** A cleared optional form field resets this scope's choice instead of writing undefined. */
export function toolSettingsMutation(
  name: keyof NonNullable<LeadSettingsOverrides["tools"]>,
  value: unknown,
  own: LeadSettingsOverrides,
  requiredPointers: readonly string[] = [],
) {
  // Match the JSON wire representation: undefined means a cleared form field.
  const draft = leadSettingsOverridesSchema.parse(
    JSON.parse(JSON.stringify({ tools: { [name]: value } })),
  );
  // Dialogs are seeded with effective values. Required units must never be
  // persisted as local choices, even when the user only edited another field.
  const changes = applySettingsMutation(draft, {
    expectedRevision: 0,
    expectedDigest: "missing",
    changes: {},
    resets: canonicalSettingsEntries(draft)
      .filter(([pointer]) =>
        canonicalSettingRequired(pointer, requiredPointers),
      )
      .map(([pointer]) => `/overrides${pointer}`),
  });
  const nextPointers = new Set(
    canonicalSettingsEntries(changes).map(([pointer]) => pointer),
  );
  const before = own.tools?.[name];
  const resets = before
    ? canonicalSettingsEntries({ tools: { [name]: before } })
        .filter(
          ([pointer]) =>
            !nextPointers.has(pointer) &&
            !canonicalSettingRequired(pointer, requiredPointers),
        )
        .map(([pointer]) => `/overrides${pointer}`)
    : [];
  return { changes, resets };
}
