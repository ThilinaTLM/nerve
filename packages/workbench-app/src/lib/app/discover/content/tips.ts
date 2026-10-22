import type { DiscoverTipEntry } from "./entries.js";

/** Evergreen, one-line habits that make everyday work faster. */
export const discoverTipsCatalog: readonly DiscoverTipEntry[] = [
  {
    id: "user-controlled-planning",
    version: 2,
    title: "You choose which profile runs",
    summary:
      "Pick Coding, Planning or a custom profile beside the composer, press Shift+Tab, or type /plan. The agent can present a plan for review but cannot switch profiles for you.",
  },
  {
    id: "html-previews",
    version: 1,
    title: "Inspect HTML in a sandboxed preview",
    summary:
      "Open an HTML file in the workspace and use its preview to inspect the rendered page in a sandboxed frame.",
  },
  {
    id: "voice-transcription",
    version: 1,
    title: "Keep dictation under your control",
    summary:
      "Voice input trims leading and trailing silence before transcription. Cancel an unwanted recording or transcription instead of waiting for text you do not need.",
  },
  {
    id: "agent-profiles",
    version: 1,
    title: "Give teammates a reusable profile",
    summary:
      "Configure a profile's instructions, model, permissions, tools, and skills in Settings → Sub-Agents. Profiles configure new teammates; follow-ups keep the existing teammate's context.",
    action: {
      kind: "settings",
      pageId: "sub-agents",
      sectionId: "sub-agents",
      label: "Configure Sub-agents",
    },
  },
  {
    id: "subagent-assignment-context",
    version: 1,
    title: "Delegate context, not just a task name",
    summary:
      "Sub-agents cannot see the lead's conversation. Include relevant paths, findings, and constraints, and assign separate editing scopes because teammates share your worktree.",
  },
  {
    id: "launch-configs",
    version: 1,
    title: "Save repeatable commands as launch configs",
    summary:
      "Use Launches for project dev servers and other reusable commands. Ask the agent to check launch status before starting another run; the launch tool runs existing configs, not new definitions.",
  },
  {
    id: "async-bash",
    version: 1,
    title: "Let background commands report back",
    summary:
      "Ask the agent to run ad hoc shell work in the background with bash. Exit notices arrive automatically; async_bash reads logs or stops a run when needed, without repeated status checks.",
  },
  {
    id: "activity-island",
    version: 1,
    title: "Inspect activity without losing the lead",
    summary:
      "Use Agents and Commands beside the composer to open teammate transcripts or background output. Back to lead returns to the main conversation; Jump to latest catches up with the transcript.",
  },
  {
    id: "focused-model-list",
    version: 1,
    title: "Keep model selection focused",
    summary:
      "Scope the composer to the models you actually use so switching stays fast.",
    action: {
      kind: "settings",
      pageId: "models",
      sectionId: "models",
      label: "Configure models",
    },
  },
  {
    id: "tool-selection",
    version: 2,
    title: "Tune capabilities per conversation",
    summary:
      "Open Capabilities beside the composer to enable only what this conversation needs. Changes apply to the next run.",
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
    version: 2,
    title: "Set permissions once, not per prompt",
    summary:
      "Choose a default permission rule set, then edit user or project overrides for tools and conditions that need different decisions. Review these rules in Settings → Permissions.",
    action: {
      kind: "settings",
      pageId: "permission-rules",
      sectionId: "rule-sets",
      label: "Review permissions",
    },
  },
];
