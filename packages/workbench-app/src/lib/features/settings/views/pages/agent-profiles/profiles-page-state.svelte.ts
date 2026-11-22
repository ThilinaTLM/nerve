import type { ProfileKind } from "./profile-kind";

/** Shared between a profiles page and its header's New profile button. */
export class ProfilesPageState {
  /** A request from the header; the page creates the profile and clears it. */
  newProfile = $state<{ kind: ProfileKind; layer: "user" | "project" }>();
  /** The open project's name, set by the page so the header can offer its level. */
  projectName = $state<string>();
}

export const profilesPageState = new ProfilesPageState();
