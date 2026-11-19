/** A built-in lead profile offered as a card on the empty conversation launchpad. */
export type ConversationStarter = {
  profile: "coding" | "planning" | "lead" | "forge";
  label: string;
  /** When to pick this profile, in the user's terms. */
  tagline: string;
};

export const conversationStarters: readonly ConversationStarter[] = [
  {
    profile: "coding",
    label: "Coding",
    tagline: "For everyday work: features, fixes and refactors.",
  },
  {
    profile: "planning",
    label: "Planning",
    tagline: "For bigger changes you want to think through before building.",
  },
  {
    profile: "lead",
    label: "Lead",
    tagline: "For large efforts a team of agents can split and verify.",
  },
  {
    profile: "forge",
    label: "Forge",
    tagline:
      "For making Nerve fit your workflow: skills, extensions, profiles.",
  },
];
