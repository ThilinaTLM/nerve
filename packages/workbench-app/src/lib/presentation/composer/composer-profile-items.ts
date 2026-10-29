import type { ComposerAgentProfile } from "../conversations/conversation-view-contracts.js";

export function composerProfileItems(profiles: ComposerAgentProfile[]) {
  return profiles.map((profile) => ({
    ...profile,
    key: profile.name,
    group:
      profile.source === "builtin"
        ? "Built-in"
        : profile.source === "user"
          ? "Personal"
          : profile.source === "project"
            ? "Project"
            : "Profiles",
    detail: profile.whenToUse,
  }));
}
