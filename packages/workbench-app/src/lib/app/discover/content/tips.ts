import type { DiscoverTipEntry } from "./entries.js";

/** Evergreen, one-line habits that make everyday work faster. */
export const discoverTipsCatalog: readonly DiscoverTipEntry[] = [
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
    title: "Tune tools and skills per conversation",
    summary:
      "Open Tools and skills beside the composer to enable only what this conversation needs. Changes apply to the next run.",
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
    version: 1,
    title: "Set permissions once, not per prompt",
    summary:
      "A default rule set plus a few exceptions removes most approval prompts.",
    action: {
      kind: "settings",
      pageId: "permissions",
      sectionId: "rule-sets",
      label: "Review permissions",
    },
  },
];
