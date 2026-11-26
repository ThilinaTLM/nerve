import type { Component } from "svelte";

/** One configuration item waiting for the user's trust, as the island lists it. */
export type IslandTrustRow = {
  key: string;
  name: string;
  /** "Sub-agent profile", "Skill". */
  kindLabel: string;
  scopeLabel: "User" | "Project";
  icon: Component;
  /** The first broad item's short form, in warning tone: "Runs without asking". */
  risk?: string;
  /** "changed 2m ago", "added just now". */
  changed?: string;
};

/** One conversation waiting for the user's answer. */
export type IslandConversationRow = {
  key: string;
  conversationId: string;
  title: string;
  project?: string;
  /** "asks a question", "waits for your approval". */
  waits: string;
  /** "2m ago", "just now". */
  time: string;
  icon: Component;
};

/** The two levels that wait for the user; trust is the higher one. */
export type IslandLevel = "trust" | "conversation";

/** The highest level waiting: its tone and count drive the compact bell. */
export function highestLevel(counts: {
  trust: number;
  conversations: number;
}): IslandLevel | undefined {
  if (counts.trust > 0) return "trust";
  if (counts.conversations > 0) return "conversation";
  return undefined;
}

export type IslandArrivalRow =
  | { level: "trust"; row: IslandTrustRow }
  | { level: "conversation"; row: IslandConversationRow };

/** "just now", "5m ago" from the compact relative label. */
export function agoLabel(relative: string): string {
  if (!relative) return "";
  return relative === "now" ? "just now" : `${relative} ago`;
}

/** The marker's text: "3 waiting for your review". */
export function waitingLabel(count: number): string {
  return `${count} waiting for your review`;
}
