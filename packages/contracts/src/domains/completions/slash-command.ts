import type { CompletionItem } from "./completion.js";

export const slashCommandNames = ["plan", "code", "compact", "abort"] as const;

export type SlashCommandName = (typeof slashCommandNames)[number];

export type SlashCommand = {
  name: SlashCommandName;
};

export const slashCommandCompletionItems = [
  {
    label: "/plan",
    detail: "Switch to Planning mode",
    info: "Changes the active composer to Planning mode without sending a prompt.",
    kind: "slash",
  },
  {
    label: "/code",
    detail: "Switch to Coding mode",
    info: "Changes the active composer to Coding mode without sending a prompt.",
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
] satisfies readonly CompletionItem[];

const slashCommandNameSet = new Set<string>(slashCommandNames);

export function parseSlashCommand(text: string): SlashCommand | undefined {
  const match = /^\/([a-z]+)$/.exec(text.trim());
  const name = match?.[1];
  if (!name || !slashCommandNameSet.has(name)) return undefined;
  return { name: name as SlashCommandName };
}
