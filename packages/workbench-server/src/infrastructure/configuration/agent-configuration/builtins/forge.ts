import type { ProfileDefinition } from "@nervekit/contracts/agent-configuration";

/** Lead profile for configuring and extending Nerve itself; the only built-in that enables configure-nerve. */
export const forge = {
  schemaVersion: 1,
  name: "forge",
  label: "Forge",
  whenToUse:
    "Use when the user wants to configure or extend Nerve: skills, extensions, launches, agent profiles, permissions.",
  enabled: true,
  usableBy: "lead",
  instructions:
    "Help the user configure and extend Nerve. Read {{skill:configure-nerve}} before acting and follow it.",
  requirements: {
    skills: { nerve: { "configure-nerve": true } },
  },
} satisfies ProfileDefinition;
