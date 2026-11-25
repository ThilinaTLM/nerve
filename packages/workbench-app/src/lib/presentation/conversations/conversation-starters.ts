import CodeIcon from "@lucide/svelte/icons/code-xml";
import HammerIcon from "@lucide/svelte/icons/hammer";
import NetworkIcon from "@lucide/svelte/icons/network";
import RouteIcon from "@lucide/svelte/icons/route";
import type { Component } from "svelte";

/** A built-in lead profile offered as a button on the empty conversation launchpad. */
export type ConversationStarter = {
  profile: "coding" | "planning" | "lead" | "forge";
  label: string;
  icon: Component<{ class?: string }>;
  /** When to pick this profile, in the user's terms. */
  tagline: string;
};

export const conversationStarters: readonly ConversationStarter[] = [
  {
    profile: "coding",
    label: "Coding",
    icon: CodeIcon,
    tagline: "For everyday work: features, fixes and refactors.",
  },
  {
    profile: "planning",
    label: "Planning",
    icon: RouteIcon,
    tagline: "For bigger changes you want to think through before building.",
  },
  {
    profile: "lead",
    label: "Lead",
    icon: NetworkIcon,
    tagline: "For large efforts a team of agents can split and verify.",
  },
  {
    profile: "forge",
    label: "Forge",
    icon: HammerIcon,
    tagline:
      "For making Nerve fit your workflow: skills, extensions, profiles.",
  },
];
