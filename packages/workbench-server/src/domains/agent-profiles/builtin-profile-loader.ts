type NamedProfile = { name: string };

/** Validate bundled JSON using the profile-file schema before publishing an immutable catalog. */
export function loadBundledAgentProfiles<T extends NamedProfile>(
  files: Readonly<Record<string, unknown>>,
  schema: { parse(value: unknown): T },
): readonly T[] {
  return Object.freeze(
    Object.entries(files).map(([name, document]) => {
      const profile = schema.parse(document);
      if (profile.name !== name)
        throw new Error(
          `Bundled agent profile ${name}.json declares the name "${profile.name}".`,
        );
      return deepFreeze(profile);
    }),
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
