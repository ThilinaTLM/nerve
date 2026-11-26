import type { Source } from "@nervekit/contracts/core";
import type { ProfileCatalogEntry } from "@nervekit/contracts/agent-configuration";
import { profileBelongsTo, type ProfileKind } from "./profile-kind";

export type ProfileOrigin = Source;

/** One list row: a profile as defined in one origin. */
export type ProfileRow = {
  /** Stable, `origin:name`; the id of the open detail item. */
  id: string;
  origin: ProfileOrigin;
  name: string;
  entry: ProfileCatalogEntry;
  /** This copy hides a profile with the same ID from a lower origin. */
  replaces?: "builtin" | "user";
  /** A copy in a higher origin hides this profile in the open project. */
  replacedBy?: "project";
};

export function profileRowId(origin: ProfileOrigin, name: string): string {
  return `${origin}:${name}`;
}

export function parseProfileRowId(
  id: string,
): { origin: ProfileOrigin; name: string } | undefined {
  const at = id.indexOf(":");
  const origin = id.slice(0, at);
  const name = id.slice(at + 1);
  return (origin === "project" || origin === "user" || origin === "builtin") &&
    name
    ? { origin, name }
    : undefined;
}

/**
 * Splits the user view (user and built-in profiles) and the project view of the
 * catalog into one group per origin. A project copy marks the user or built-in
 * profile it hides; the list only offers `kind`, but readable-name-only files
 * show on both pages.
 */
export function groupProfiles(input: {
  user?: readonly ProfileCatalogEntry[];
  project?: readonly ProfileCatalogEntry[];
  /** Only the profiles one page offers; all of them when omitted. */
  kind?: ProfileKind;
}): Record<ProfileOrigin, ProfileRow[]> {
  const projectEntries = (input.project ?? []).filter(
    (entry) => entry.source === "project",
  );
  const projectNames = new Set(projectEntries.map((entry) => entry.name));
  const row = (
    origin: ProfileOrigin,
    entry: ProfileCatalogEntry,
  ): ProfileRow => ({
    id: profileRowId(origin, entry.name),
    origin,
    name: entry.name,
    entry,
    ...(entry.shadows ? { replaces: entry.shadows } : {}),
    ...(origin !== "project" && projectNames.has(entry.name)
      ? { replacedBy: "project" as const }
      : {}),
  });
  const of = (origin: ProfileOrigin, entries: readonly ProfileCatalogEntry[]) =>
    entries
      .filter(
        (entry) =>
          entry.source === origin &&
          (!entry.definition ||
            !input.kind ||
            profileBelongsTo(entry, input.kind)),
      )
      .map((entry) => row(origin, entry));
  return {
    project: of("project", projectEntries),
    user: of("user", input.user ?? []),
    builtin: of("builtin", input.user ?? []),
  };
}
