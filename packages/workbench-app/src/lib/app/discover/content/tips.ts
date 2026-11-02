import type { DiscoverTipEntry } from "./entries.js";

/** Evergreen, non-obvious habits that make everyday work faster. */
export const discoverTipsCatalog: readonly DiscoverTipEntry[] = [
  {
    id: "user-controlled-planning",
    version: 3,
    title: "You choose which profile runs",
    summary:
      "Press Shift+Tab to cycle profiles, type /plan for Planning, or /profile followed by a name. The agent can present a plan for review but cannot switch profiles for you.",
  },
  {
    id: "agent-profiles",
    version: 2,
    title: "Give teammates a reusable profile",
    summary:
      "Set a profile's instructions, model, permissions, tools, and skills in Settings → Sub-Agents. New teammates use it; follow-ups keep the teammate's existing context.",
    action: {
      kind: "settings",
      pageId: "sub-agents",
      sectionId: "sub-agents",
      label: "Configure Sub-Agents",
    },
  },
  {
    id: "subagent-assignment-context",
    version: 2,
    title: "Delegate context, not just a task name",
    summary:
      "Sub-Agents cannot see the lead's conversation. Include relevant paths, findings, and constraints, and give each teammate its own files to edit, since they share your worktree.",
  },
  {
    id: "composer-references",
    version: 1,
    title: "Point the agent at exactly what you mean",
    summary:
      "Type @ in the composer to reference a file, pull request, issue, skill, tool, agent, or launch. A bare @ lists recent items.",
  },
  {
    id: "project-skills",
    version: 1,
    title: "Teach Nerve your project conventions",
    summary:
      "Skills add reusable instructions that agents pick up on later runs.",
    action: {
      kind: "settings",
      pageId: "skills",
      sectionId: "skills",
      label: "Manage skills",
    },
  },
  {
    id: "permission-defaults",
    version: 3,
    title: "Set permissions once, not per prompt",
    summary:
      "Choose a default permission rule set for new conversations, then add user or project overrides for tools that need a different decision.",
    action: {
      kind: "settings",
      pageId: "permission-rules",
      sectionId: "rule-sets",
      label: "Review permissions",
    },
  },
];
