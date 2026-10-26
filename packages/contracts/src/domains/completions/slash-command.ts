import { agentProfileNameSchema } from "../agent-profiles/constants.js";
import type { CompletionItem } from "./completion.js";

export const slashCommandNames = [
  "plan",
  "profile",
  "compact",
  "abort",
  "new",
] as const;

export type SlashCommandName = (typeof slashCommandNames)[number];

export type SlashCommand =
  | { name: Exclude<SlashCommandName, "profile"> }
  | { name: "profile"; profile: string };

export const slashCommandCompletionItems = [
  {
    label: "/plan",
    detail: "Switch to the Planning profile",
    info: "Changes the active composer to the Planning profile without sending a prompt.",
    kind: "slash",
  },
  {
    label: "/profile <name>",
    detail: "Switch agent profile",
    info: "Switches the active composer to the named agent profile without sending a prompt.",
    kind: "slash",
  },
  {
    label: "/compact",
    detail: "Compact conversation context",
    info: "Summarizes earlier messages to reduce context usage.",
    kind: "slash",
  },
  {
    label: "/abort",
    detail: "Stop the active run",
    info: "Cancels the active agent run.",
    kind: "slash",
  },
  {
    label: "/new",
    detail: "Start a new conversation",
    info: "Opens a new conversation in the active project.",
    kind: "slash",
  },
] satisfies readonly CompletionItem[];

/** Expand the profile argument from the available lead profiles. */
export function slashCommandItemsForProfiles(
  items: readonly CompletionItem[],
  profiles: readonly { name: string; label: string; description?: string }[],
): CompletionItem[] {
  return items.flatMap((item) =>
    item.label === "/profile <name>"
      ? profiles.map((profile) => ({
          kind: "slash" as const,
          label: `/profile ${profile.name}`,
          detail: `Switch to ${profile.label}`,
          info: profile.description,
        }))
      : [item],
  );
}

export function parseSlashCommand(text: string): SlashCommand | undefined {
  const match = /^\/([a-z]+)(?:\s+(\S+))?$/.exec(text.trim());
  const name = match?.[1];
  if (name === "profile") {
    const profile = agentProfileNameSchema.safeParse(match?.[2]);
    return profile.success ? { name, profile: profile.data } : undefined;
  }
  if (match?.[2] || !slashCommandNames.some((command) => command === name))
    return undefined;
  return { name: name as Exclude<SlashCommandName, "profile"> };
}
