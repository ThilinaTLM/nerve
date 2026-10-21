import Code2 from "@lucide/svelte/icons/code-2";
import ListChecks from "@lucide/svelte/icons/list-checks";
import type { Component } from "svelte";

export type ConversationStarter = {
  id: "plan" | "code";
  label: string;
  /** Profile to start in; the default lead profile when omitted. */
  profile?: string;
  icon: Component;
};

export const conversationStarters: readonly ConversationStarter[] = [
  {
    id: "plan",
    label: "Plan",
    profile: "planning",
    icon: ListChecks,
  },
  {
    id: "code",
    label: "Code",
    icon: Code2,
  },
];
