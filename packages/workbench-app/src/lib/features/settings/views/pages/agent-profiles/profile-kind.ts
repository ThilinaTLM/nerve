/**
 * Agents and Sub-Agents are two settings pages over the same profile files.
 * Each page lists, creates and edits only its own kind; the stored
 * `usableBy` value is the kind. `both` files show on both pages.
 */
import type { ProfileCatalogEntry } from "@nervekit/contracts/agent-configuration";
import type { ProfileUsableBy } from "@nervekit/contracts/agent-configuration";

export type ProfileKind = Exclude<ProfileUsableBy, "both">;

export const PROFILE_KIND_PAGES: Record<ProfileKind, string> = {
  lead: "agents",
  subagent: "sub-agents",
};

export const profileKindText: Record<
  ProfileKind,
  { plural: string; singular: string; singularLower: string }
> = {
  lead: { plural: "Agents", singular: "Agent", singularLower: "agent" },
  subagent: {
    plural: "Sub-Agents",
    singular: "Sub-Agent",
    singularLower: "sub-agent",
  },
};

export function profileKindForPage(pageId: string): ProfileKind {
  return pageId === PROFILE_KIND_PAGES.subagent ? "subagent" : "lead";
}

/** The kind a profile file is stored with; unreadable files have none. */
export function storedUsableBy(
  profile: ProfileCatalogEntry,
): ProfileUsableBy | undefined {
  return profile.definition?.usableBy;
}

/** Whether a profile belongs on the page for `kind`, including `both`. */
export function profileBelongsTo(
  profile: ProfileCatalogEntry,
  kind: ProfileKind,
): boolean {
  const usableBy = storedUsableBy(profile);
  return usableBy === kind || usableBy === "both";
}

/** Profiles for one page, in server order. */
export function profilesOfKind(
  profiles: readonly ProfileCatalogEntry[],
  kind: ProfileKind,
): ProfileCatalogEntry[] {
  return profiles.filter((profile) => profileBelongsTo(profile, kind));
}

/** Readable-name-only entries (no effective or local definition) show on both pages. */
export function unreadableProfiles(
  profiles: readonly ProfileCatalogEntry[],
): ProfileCatalogEntry[] {
  return profiles.filter((profile) => !profile.definition);
}

/** How many profile files a page covers; `both` files count on each page. */
export function profileFileCount(
  files: readonly { usableBy?: ProfileUsableBy }[],
  kind: ProfileKind,
): number {
  return files.filter(
    (file) => file.usableBy === kind || file.usableBy === "both",
  ).length;
}
