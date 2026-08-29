import Code2 from "@lucide/svelte/icons/code-2";
import ListChecks from "@lucide/svelte/icons/list-checks";
import type { Mode } from "@nervekit/contracts/settings";
import type { Component } from "svelte";

export type ConversationStarter = {
  id: "plan" | "code";
  label: string;
  mode: Mode;
  icon: Component;
};

export const conversationStarters: readonly ConversationStarter[] = [
  {
    id: "plan",
    label: "Plan",
    mode: "planning",
    icon: ListChecks,
  },
  {
    id: "code",
    label: "Code",
    mode: "coding",
    icon: Code2,
  },
];
