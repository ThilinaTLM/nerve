import {
  canonicalSettingsEntries,
  leadSettingsOverridesSchema,
  type LeadSettingsOverrides,
} from "@nervekit/contracts/agent-configuration";
/** A cleared optional form field resets this scope's choice instead of writing undefined. */
export function toolSettingsMutation(
  name: keyof NonNullable<LeadSettingsOverrides["tools"]>,
  value: unknown,
  own: LeadSettingsOverrides,
) {
  // Match the JSON wire representation: undefined means a cleared form field.
  const changes = leadSettingsOverridesSchema.parse(
    JSON.parse(JSON.stringify({ tools: { [name]: value } })),
  );
  const nextPointers = new Set(
    canonicalSettingsEntries(changes).map(([pointer]) => pointer),
  );
  const before = own.tools?.[name];
  const resets = before
    ? canonicalSettingsEntries({ tools: { [name]: before } })
        .filter(([pointer]) => !nextPointers.has(pointer))
        .map(([pointer]) => `/overrides${pointer}`)
    : [];
  return { changes, resets };
}
